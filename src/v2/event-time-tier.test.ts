import { describe, it, expect } from 'vitest';
import {
  emitLedger,
  emitEventDateClaims,
  eventDatePredicate,
  eventKindOf,
  eventKindForDateOutput,
  eventKindForFoiDateColumn,
  isoDayFromAttested,
  isoDayFromCellUnderAnyAttestedFormat,
  claimConfidence,
  EVENT_DATE_RULE,
  EVENT_DATE_KINDS,
  EVENT_DATE_PREDICATE_PREFIX,
  type Claim,
  type SourceObservationSet,
} from './claim.ts';
import { explain } from './explain.ts';
import { checkNoInflationClaims } from '../ci/trust-rating.ts';
import { FOI_ENTRY_CONVERSIONS } from '../shared/foi-normalise.ts';
import { loadReferenceData } from '../sources/ofcom-amateur/components.ts';

// Test names follow the project's Subject_Scenario_Outcome convention.
//
// Issue #725 S1 promotes record-embedded EVENT dates to a queryable derived
// tier: per observation, one claim per attested date cell, the event KIND in
// the predicate and the ISO day in the object, wearing the asserting source +
// vintage via provenance. These tests fix the tier's guarantees: attested
// formats only (no guessing, wrong-grammar values fail loud), the
// non-observation semantics of a blank cell, the per-cohort honesty of the
// generic reserved-until kind, the Computed readout and no-inflation
// grounding, and the explain arm's reproduction + epistemics caveats.

const REF = loadReferenceData();

// A register-like source carrying a day-first created/last-modified pair and a
// sparse ISO reservation-window column — the three column shapes the real
// register families attest. The reserved rows deliberately span the
// permanent-SES cohorts (future date + Reserved, past date + Available) so the
// per-cohort honesty of the generic kind is stated as a scenario, not implied.
function registerLikeSource(): SourceObservationSet {
  return {
    sourceFile: 'synthetic/register.csv',
    vintage: '2024-09-10',
    columns: ['Callsign', 'Status', 'Created Date', 'LastModifiedDate', 'Reserved to Date'],
    subjectColumn: 'Callsign',
    headerLine: 1,
    rows: [
      { Callsign: 'M7TEE', Status: 'Allocated', 'Created Date': '23/07/2016', LastModifiedDate: '11/10/2025', 'Reserved to Date': '' },
      { Callsign: 'GB2RHQ', Status: 'Reserved', 'Created Date': '15/01/2019', LastModifiedDate: '15/01/2019 14:32', 'Reserved to Date': '2025-09-27' },
      { Callsign: 'GB0MAC', Status: 'Available', 'Created Date': '', LastModifiedDate: '30/06/2017', 'Reserved to Date': '2017-06-30 00:00:00' },
    ],
    columnInterpretations: [
      { type: 'callsign-token' },
      { type: 'string' },
      { type: 'date', format: 'DD/MM/YYYY' },
      { type: 'date', format: 'DD/MM/YYYY' },
      { type: 'date', format: 'YYYY-MM-DD' },
    ],
    eventDateColumns: [
      { source: 'Created Date', kind: 'record-created' },
      { source: 'LastModifiedDate', kind: 'record-last-modified' },
      { source: 'Reserved to Date', kind: 'reserved-until' },
    ],
  };
}

// A source carrying a licence-version original-start column, whose kind
// carries the #800/#565 epistemics caveats. The header is one the kind's
// authored bindings actually own ('Original Start Date', the 2021 register
// annexes' header) — the Salesforce 'Licence '-prefixed headers now bind the
// LICENCE-scoped kinds instead (issue #725 S2).
function originalStartSource(): SourceObservationSet {
  return {
    sourceFile: 'synthetic/register-annex.csv',
    vintage: '2021-04-21',
    columns: ['Call Sign', 'Original Start Date'],
    subjectColumn: 'Call Sign',
    headerLine: 1,
    rows: [
      { 'Call Sign': 'G3ATI', 'Original Start Date': '1952-10-10' },
    ],
    columnInterpretations: [
      { type: 'callsign-token' },
      { type: 'date', format: 'YYYY-MM-DD' },
    ],
    eventDateColumns: [
      { source: 'Original Start Date', kind: 'licence-version-original-start' },
    ],
  };
}

describe('the authored event-kind classification is total over the authored date columns', { tags: ['unit'] }, () => {
  it('EveryAuthoredDateColumnOutput_AcrossAllFoiConversions_ClassifiesOrIsADocumentedExclusion', () => {
    // The drift guard the registry promises: a date column added to any
    // converter binding must be classified (or excluded with a reason) before
    // the register families can load — eventKindForDateOutput throws on an
    // unclassified output, so this sweep over the REAL authored conversions
    // proves the registry is total today.
    const outputs = new Set<string>();
    for (const conversions of Object.values(FOI_ENTRY_CONVERSIONS)) {
      for (const conversion of conversions) {
        for (const column of conversion.columns) {
          if (column.kind === 'date' || column.kind === 'iso-date') outputs.add(column.output);
        }
      }
    }
    expect(outputs.size).toBeGreaterThan(0);
    for (const output of outputs) {
      expect(() => eventKindForDateOutput(output)).not.toThrow();
    }
  });

  it('EventKindRegistry_WhenAskedForAnUnknownOutput_FailsLoudRatherThanSilentlyEmittingNothing', () => {
    expect(() => eventKindForDateOutput('some_new_date_column')).toThrow(/no authored event-kind classification/);
  });

  it('LicenceScopedDateColumn_WithAnAuthoredEventKindOverride_BindsToTheOverrideNotTheOutputDefault', () => {
    // Issue #725 S2: the same output name can carry a register-record fact in
    // one disclosure and a LICENCE-object fact in another; the per-column
    // override is how the licence-scoped column binds its own kind.
    expect(eventKindForFoiDateColumn({ output: 'created_date', eventKind: 'licence-created' })).toBe('licence-created');
    expect(eventKindForFoiDateColumn({ output: 'created_date' })).toBe('record-created');
  });

  it('EventKindOverride_NamingAnUnreviewedKind_FailsLoudRatherThanMintingAVocabularyEntry', () => {
    expect(() => eventKindForFoiDateColumn({ output: 'created_date', eventKind: 'not-a-kind' })).toThrow(/not an authored event kind/);
  });

  it('LicenceScopedDisclosures_InTheRealConversions_BindTheirDateColumnsToLicenceScopedKinds', () => {
    // The two disclosures whose date columns are licence-scoped (a per-licence
    // sheet with duplicate callsigns; 'Licence '-prefixed Salesforce fields
    // blank across the unlicensed pool) must never share a kind with the
    // register-record columns — the S2 detector's cross-vintage comparison
    // would otherwise read a licence-lifecycle difference as a register
    // revision that never happened.
    const sheet2 = FOI_ENTRY_CONVERSIONS['wdtk-1180568-csv-pair'][1];
    const byOutput = new Map(sheet2.columns.map(c => [c.output, c]));
    expect(eventKindForFoiDateColumn(byOutput.get('created_date') ?? { output: 'created_date' })).toBe('licence-created');
    expect(eventKindForFoiDateColumn(byOutput.get('original_start_date') ?? { output: 'original_start_date' })).toBe('licence-original-start');
    const salesforce = FOI_ENTRY_CONVERSIONS['ofcom-2025-09-11-register'][0];
    const sfByOutput = new Map(salesforce.columns.map(c => [c.output, c]));
    expect(eventKindForFoiDateColumn(sfByOutput.get('last_modified_date') ?? { output: 'last_modified_date' })).toBe('licence-last-modified');
    expect(eventKindForFoiDateColumn(sfByOutput.get('original_start_date') ?? { output: 'original_start_date' })).toBe('licence-original-start');
  });

  it('EventKindRegistry_ForTheIssuanceFamiliesEventDate_IsADocumentedExclusionNotAKind', () => {
    // The issuance rows ARE events and already carry the authored-event word
    // tier; their dates are excluded from S1 rather than baked to a
    // column-generic kind (see EVENT_KIND_BY_DATE_OUTPUT's rationale).
    expect(eventKindForDateOutput('event_date')).toBeNull();
  });

  it('EveryAuthoredKind_IsNamedByThePredicateHelpers_AndAStrayPredicateIsNeverMistakenForOne', () => {
    for (const kind of EVENT_DATE_KINDS) {
      expect(eventKindOf(eventDatePredicate(kind))).toBe(kind);
    }
    expect(eventKindOf('event')).toBeUndefined();
    expect(eventKindOf(`${EVENT_DATE_PREDICATE_PREFIX}not-an-authored-kind`)).toBeUndefined();
    expect(eventKindOf('last_modified_date')).toBeUndefined();
  });
});

describe('attested date cells become event-time claims; blanks stay non-observations', { tags: ['unit'] }, () => {
  it('RegisterRow_WithDayFirstAttestedDates_YieldsIsoDayEventClaimsPerKind', () => {
    const claims = emitEventDateClaims(registerLikeSource());
    const m7tee = claims.filter(c => c.rawSubject === 'M7TEE');
    expect(m7tee).toEqual([
      expect.objectContaining({ layer: 'derived', predicate: eventDatePredicate('record-created'), object: '2016-07-23', rule: EVENT_DATE_RULE }),
      expect.objectContaining({ layer: 'derived', predicate: eventDatePredicate('record-last-modified'), object: '2025-10-11', rule: EVENT_DATE_RULE }),
    ]);
  });

  it('DateCellWithATimeOfDay_UnderEitherAttestedFormat_TruncatesToTheIsoDay', () => {
    const claims = emitEventDateClaims(registerLikeSource());
    const modified = claims.find(c => c.rawSubject === 'GB2RHQ' && c.predicate === eventDatePredicate('record-last-modified'));
    expect(modified?.object).toBe('2019-01-15');
    const reservedEnd = claims.find(c => c.rawSubject === 'GB0MAC' && c.predicate === eventDatePredicate('reserved-until'));
    expect(reservedEnd?.object).toBe('2017-06-30');
  });

  it('BlankDateCell_WhenEmitted_YieldsNoClaim_AbsenceIsNonObservationNeverAnInventedDate', () => {
    const claims = emitEventDateClaims(registerLikeSource());
    expect(claims.some(c => c.rawSubject === 'M7TEE' && c.predicate === eventDatePredicate('reserved-until'))).toBe(false);
    expect(claims.some(c => c.rawSubject === 'GB0MAC' && c.predicate === eventDatePredicate('record-created'))).toBe(false);
  });

  it('ReservedToDate_AcrossTheThreePermanentSesCohorts_CarriesTheSameGenericKindWithNoCohortVerdict', () => {
    // One column, three meanings by cohort (the permanent-SES finding): a
    // future date beside Reserved is a planned window close, a past date beside
    // Available records a termination. S1 deliberately asserts only the
    // honest generic "reserved-until" for both — deriving the cohort reading
    // from (date vs vintage) x status is S2/S3 work this tier must not bake.
    const claims = emitEventDateClaims(registerLikeSource());
    const reserved = claims.filter(c => c.predicate === eventDatePredicate('reserved-until'));
    expect(reserved.map(c => [c.rawSubject, c.object])).toEqual([
      ['GB2RHQ', '2025-09-27'],
      ['GB0MAC', '2017-06-30'],
    ]);
  });

  it('EventClaim_WhenReadOut_IsComputedAndCarriesItsAssertingVintageViaProvenance', () => {
    const claims = emitEventDateClaims(registerLikeSource());
    expect(claims.length).toBeGreaterThan(0);
    for (const claim of claims) {
      expect(claimConfidence(claim)).toBe('Computed');
      expect(claim.provenance.vintage).toBe('2024-09-10');
      expect(claim.provenance.sourceFile).toBe('synthetic/register.csv');
    }
  });

  it('EventTier_WhenRiddenOverTheFullEmit_AppendsAfterEveryExistingTierAndPassesNoInflation', () => {
    const source = registerLikeSource();
    const full = emitLedger(source, REF);
    const eventClaims = full.filter(c => c.rule === EVENT_DATE_RULE);
    expect(eventClaims.length).toBe(emitEventDateClaims(source).length);
    // Appended LAST: every event claim sits after every non-event claim, so
    // the existing per-source stream prefix is byte-stable.
    const firstEventIndex = full.findIndex(c => c.rule === EVENT_DATE_RULE);
    expect(full.slice(firstEventIndex).every(c => c.rule === EVENT_DATE_RULE)).toBe(true);
    // Every event claim grounds in a raw basis for its subject in the same
    // source — the trust net's no-inflation invariant.
    expect(checkNoInflationClaims(full)).toEqual([]);
  });
});

describe('the tier extracts from attested date columns ONLY — no format guessing', { tags: ['unit'] }, () => {
  it('Binding_OverAColumnAttestedAsString_FailsLoudRatherThanGuessingAFormat', () => {
    const source = registerLikeSource();
    const broken: SourceObservationSet = {
      ...source,
      columnInterpretations: [
        { type: 'callsign-token' },
        { type: 'string' },
        { type: 'string' },
        { type: 'date', format: 'DD/MM/YYYY' },
        { type: 'date', format: 'YYYY-MM-DD' },
      ],
    };
    expect(() => emitEventDateClaims(broken)).toThrow(/only a column attested as a dated format/);
  });

  it('Binding_WhenTheSourceAttestsNoInterpretationAtAll_FailsLoud', () => {
    const source: SourceObservationSet = { ...registerLikeSource(), columnInterpretations: undefined };
    expect(() => emitEventDateClaims(source)).toThrow(/no columnInterpretations hint/);
  });

  it('Binding_OverAHeaderAbsentFromTheSource_FailsLoud', () => {
    const source = registerLikeSource();
    const broken: SourceObservationSet = { ...source, eventDateColumns: [{ source: 'No Such Column', kind: 'record-created' }] };
    expect(() => emitEventDateClaims(broken)).toThrow(/absent from the source headers/);
  });

  it('DateCell_InTheWrongGrammarForItsAttestedFormat_FailsLoudRatherThanBeingReadUnderAnotherGrammar', () => {
    // An ISO-shaped value in a day-first-attested column is an integrity
    // break (every covered source passed the strict converter under the
    // attested grammar), not an invitation to guess.
    expect(() => isoDayFromAttested('2016-07-23', 'DD/MM/YYYY')).toThrow(/unrecognised date format/);
    expect(() => isoDayFromAttested('23/07/2016', 'YYYY-MM-DD')).toThrow(/not a well-formed/);
    expect(() => isoDayFromAttested('N/A', 'DD/MM/YYYY')).toThrow(/unrecognised date format/);
    expect(() => isoDayFromAttested('2016-13-01', 'YYYY-MM-DD')).toThrow(/not a well-formed/);
    expect(() => isoDayFromAttested('23/07/2016', 'MM/DD/YYYY')).toThrow(/unknown attested date format/);
  });

  it('EmptyOrWhitespaceCell_UnderEitherFormat_YieldsNullNeverAThrow', () => {
    expect(isoDayFromAttested('', 'DD/MM/YYYY')).toBeNull();
    expect(isoDayFromAttested('  ', 'YYYY-MM-DD')).toBeNull();
  });

  it('GrammarDispatch_OverTheTwoSyntacticallyDisjointAttestedFormats_IsDeterministic', () => {
    // The explain arm reconstructs without the per-source attestation in hand;
    // that is sound (not guessing) precisely because the two attested grammars
    // cannot both match one cell.
    expect(isoDayFromCellUnderAnyAttestedFormat('23/07/2016')).toBe('2016-07-23');
    expect(isoDayFromCellUnderAnyAttestedFormat('2016-07-23')).toBe('2016-07-23');
    expect(isoDayFromCellUnderAnyAttestedFormat('2017-06-30 00:00:00')).toBe('2017-06-30');
    expect(isoDayFromCellUnderAnyAttestedFormat('not a date')).toBeNull();
    expect(isoDayFromCellUnderAnyAttestedFormat('')).toBeNull();
  });
});

// The column each of the fixture's kinds is authored to read - what the
// explained working must CITE, not merely any cell that happens to hold the
// same day.
const FIXTURE_COLUMN_BY_KIND: Record<string, string> = {
  'record-created': 'Created Date',
  'record-last-modified': 'LastModifiedDate',
  'reserved-until': 'Reserved to Date',
};

describe('the working behind an event-time claim reconstructs from the ledger (issue #433)', { tags: ['unit'] }, () => {
  it('EventClaim_WhenExplained_ReproducesItsIsoDayFromTheKindsOwnDateCell', () => {
    const source = registerLikeSource();
    const ledger = emitLedger(source, REF);
    const eventClaims = ledger.filter(c => c.rule === EVENT_DATE_RULE);
    expect(eventClaims.length).toBeGreaterThan(0);
    for (const claim of eventClaims) {
      const working = explain(claim, ledger, REF);
      expect(working.result).toBe(claim.object);
      const kind = eventKindOf(claim.predicate) ?? '';
      const cell = working.inputs.find(i => i.role === 'date-cell');
      // The cited cell is the KIND'S OWN authored column, never another date
      // column that coincidentally holds the same day.
      expect(cell?.origin).toEqual(expect.objectContaining({ kind: 'raw-claim', sourceFile: 'synthetic/register.csv', predicate: FIXTURE_COLUMN_BY_KIND[kind] }));
      const binding = working.inputs.find(i => i.role === 'authored-event-kind');
      expect(binding?.origin).toEqual(expect.objectContaining({ kind: 'authored-binding', registry: 'EVENT_KIND_BY_DATE_OUTPUT' }));
      expect(working.confidence).toBe('Computed');
    }
  });

  it('TwoDateColumnsHoldingTheSameDay_WhenEachKindIsExplained_EachCitesItsOwnColumn', () => {
    // The mass-update reality (#801, and the 2016 migration cluster) makes
    // created == last-modified the COMMON case, so a value-matched cell lookup
    // would misattribute the last-modified working to the created cell. The
    // GB2RHQ row holds 15/01/2019 in BOTH columns; each kind's working must
    // cite its own column.
    const source = registerLikeSource();
    const ledger = emitLedger(source, REF);
    const gb2rhq = ledger.filter(c => c.rule === EVENT_DATE_RULE && c.rawSubject === 'GB2RHQ');
    const created = gb2rhq.find(c => c.predicate === eventDatePredicate('record-created'));
    const modified = gb2rhq.find(c => c.predicate === eventDatePredicate('record-last-modified'));
    expect(created?.object).toBe('2019-01-15');
    expect(modified?.object).toBe('2019-01-15');
    if (created === undefined || modified === undefined) return;
    const createdCell = explain(created, ledger, REF).inputs.find(i => i.role === 'date-cell');
    const modifiedCell = explain(modified, ledger, REF).inputs.find(i => i.role === 'date-cell');
    expect(createdCell?.origin).toEqual(expect.objectContaining({ predicate: 'Created Date' }));
    expect(modifiedCell?.origin).toEqual(expect.objectContaining({ predicate: 'LastModifiedDate' }));
    // And the cited value is that column's own verbatim cell (the
    // time-bearing last-modified rendering, not the created cell's).
    expect(modifiedCell?.value).toBe('15/01/2019 14:32');
  });

  it('OriginalStartClaim_WhenExplained_StatesTheSurvivingNotOriginalAndPre1977Caveats', () => {
    const source = originalStartSource();
    const ledger = emitLedger(source, REF);
    const claim = ledger.find(c => c.rule === EVENT_DATE_RULE);
    expect(claim).toBeDefined();
    if (claim === undefined) return;
    const working = explain(claim, ledger, REF);
    expect(working.result).toBe('1952-10-10');
    const caveat = working.steps.map(s => s.detail).join(' ');
    expect(caveat).toContain('SURVIVING in this vintage');
    expect(caveat).toContain('#800');
    expect(caveat).toContain('1977');
    expect(caveat).toContain('#565');
  });

  it('EventClaim_WhoseDateCellIsMissingFromTheLedger_FailsLoudAsAnUnexplainableGap', () => {
    const source = registerLikeSource();
    const ledger = emitLedger(source, REF);
    const claim = ledger.find(c => c.rule === EVENT_DATE_RULE);
    expect(claim).toBeDefined();
    if (claim === undefined) return;
    const withoutCells: Claim[] = ledger.filter(c => !(c.layer === 'raw' && c.predicate !== '@listed' && c.provenance.ordinal === claim.provenance.ordinal));
    expect(() => explain(claim, withoutCells, REF)).toThrow(/no raw date cell/);
  });
});
