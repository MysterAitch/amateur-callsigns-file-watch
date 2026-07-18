import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  emitLedger,
  isFileLevelClaim,
  LISTED_PREDICATE,
  NORMALISES_TO_PREDICATE,
  CLEANED_CALLSIGN_RULE,
  LICENCE_CATEGORY_PREDICATE,
  EVENT_PREDICATE,
  AUTHORED_EVENT_RULE,
  type Claim,
  type SourceObservationSet,
} from '../claim.ts';
import { buildLedger } from '../build-ledger.ts';
import { parseClaimsJsonl } from '../serialise.ts';
import {
  collectIssuanceEventsSources,
  issuanceEventsEntries,
  issuanceEventsSourcesFor,
  loadIssuanceEventsSource,
  ISSUANCE_EVENTS_CLASS,
} from './issuance-events.ts';
import { qualifyingRegisterEntries } from './foi-register.ts';
import { collectAttributeAddendumSources } from './attribute-addendum.ts';
import { defaultFoiDir } from '../../shared/foi-archive.ts';
import { loadReferenceData } from '../../sources/ofcom-amateur/components.ts';
import { parseMarkdownTable, type FoiSourceConversion } from '../../shared/foi-normalise.ts';

// Test names follow the project's Subject_Scenario_Outcome convention.
//
// The scenario is the issuance-events family's claim standing (issues #361 and
// #813 Stage C2): each row is a dated licensing EVENT - a call sign paired with
// the date it was re-issued, reciprocal-licence-issued, or reallocated. The
// subject IS a genuine call sign, so the family is subjectKind 'callsign' and
// rides the full derived layer (normalises_to edges) to JOIN events into the
// call-sign namespace - yet it stays distinct from register STATE, deriving NO
// licence_category tier. Since Stage C2 the family is lossless-canonical: the
// raw layer carries the source's VERBATIM headers and every physical column
// (the transfers table's s.40 'S40' marker columns included), while the
// authored event word - our reading of each disclosure's covering letter, not
// a published cell - rides as a DERIVED claim under a named Looked-up rule.

const REF = loadReferenceData();
const FOI_DIR = defaultFoiDir();

// Stable archived entry keys - the raw source files and columns are read from
// the authored converter binding, never hard-coded in the test.
const REISSUE_ENTRY = 'ofcom-498903--reissued-callsigns-since-2010'; // CSV workbook extract
const RECIPROCAL_ENTRY = 'ofcom-498906--reciprocal-licences-since-2010'; // CSV workbook extract
const TRANSFERS_ENTRY = 'wdtk-251507--reissue-policy'; // markdown-table transcription

const ISSUANCE_EVENTS_ENTRY_KEYS = [REISSUE_ENTRY, RECIPROCAL_ENTRY, TRANSFERS_ENTRY];

// The verbatim published headers (issue #813 Stage C2) - the raw-layer
// predicates and manifest spellings, never the authored output names.
const CSV_DATE_HEADER = 'Original Start Date';
const CSV_CALLSIGN_HEADER = 'Call Sign T-Number';
const TRANSFERS_HEADERS = [
  'Con Id', 'Licence Number', 'Call Signs', 'Licence Product', 'Status',
  'Title', 'First_name', 'Last_name', 'Start date', 'Reason',
];

function sourceFor(entry: string) {
  const source = collectIssuanceEventsSources().find(s => s.entry === entry);
  if (source === undefined) throw new Error(`no issuance-events source for ${entry}`);
  return source;
}

function conversionFor(entry: string): { meta: ReturnType<typeof issuanceEventsEntries>[number]['meta']; conversion: FoiSourceConversion } {
  const found = issuanceEventsEntries(FOI_DIR).find(e => e.entry === entry);
  if (found === undefined) throw new Error(`no issuance-events entry ${entry}`);
  const conversions = issuanceEventsSourcesFor(found.meta);
  expect(conversions.length).toBe(1);
  return { meta: found.meta, conversion: conversions[0] };
}

describe('issuance-events family collection', { tags: ['data-validity'] }, () => {
  it('IssuanceEventsFamily_WhenCollected_CoversEveryIssuanceEventsDisclosureAsCallsigns', () => {
    // The family is discovered from datasetClasses, not a hard-coded list, so a
    // newly-classed disclosure is covered automatically.
    const entries = issuanceEventsEntries();
    expect(entries.map(e => e.entry).sort()).toEqual([...ISSUANCE_EVENTS_ENTRY_KEYS].sort());
    for (const { meta } of entries) {
      expect(meta.datasetClasses).toContain(ISSUANCE_EVENTS_CLASS);
    }

    const sources = collectIssuanceEventsSources();
    // One event-shaped source per entry (each variant binds a single table).
    expect(sources.length).toBe(ISSUANCE_EVENTS_ENTRY_KEYS.length);
    for (const source of sources) {
      expect(source.family).toBe('issuance-events');
      expect(source.subjectKind).toBe('callsign');
      const obs = source.load();
      expect(obs.rows.length).toBeGreaterThan(0);
      // The subject is the source's own verbatim callsign header (issue #813
      // Stage C2) - never the authored 'callsign' output name; the manifest
      // @subject claim handles its placement, not column position.
      expect(['Call Sign T-Number', 'Call Signs']).toContain(obs.subjectColumn);
      expect(obs.sourceFile.startsWith(`foi/${source.entry}/`)).toBe(true);
      // Every observation carries the disclosure's vintage - load-bearing for a
      // dated event snapshot.
      expect(obs.vintage.length).toBeGreaterThan(0);
      // A product/categoryColumn is deliberately NOT set: an issuance event is
      // not a register state, so no licence_category tier is derivable; the
      // disclosed date is an EVENT date, so no originalStartDateColumn either.
      expect(obs.categoryColumn).toBeUndefined();
      expect(obs.originalStartDateColumn).toBeUndefined();
      // The authored event vocabulary rides as a stored fact for the DERIVED
      // tier; the reconstruction routing is attested.
      expect(obs.authoredEvent === undefined ? '' : obs.authoredEvent).not.toBe('');
      expect(obs.repoPath).toBe(`archive/foi/${source.entry}/${obs.sourceFile.split('/').pop() ?? ''}`);
    }
  });

  it('IssuanceEventsFamily_WhenComparedToRegisterAndAddendumFamilies_IsTheSoleEmitter', () => {
    // No issuance-events entry is also a qualifying register entry, so nothing is
    // emitted twice by the register family.
    const registerKeys = new Set(qualifyingRegisterEntries().map(e => e.entry));
    for (const { entry } of issuanceEventsEntries()) {
      expect(registerKeys.has(entry)).toBe(false);
    }

    // wdtk-251507 additionally carries the attribute-addendum class, but its
    // sole table is a markdown-table transcription the register machinery skips,
    // so the attribute-addendum family does NOT emit it - this family is its only
    // emitter.
    const addendumKeys = new Set(collectAttributeAddendumSources().map(s => s.entry));
    expect(addendumKeys.has(TRANSFERS_ENTRY)).toBe(false);
  });
});

describe('the CSV workbook exports (ofcom-498903 / ofcom-498906)', { tags: ['data-validity'] }, () => {
  it('ReIssueEvents_WhenEmitted_CarryVerbatimHeadersDerivedEventAndTimezoneArtefactDate', () => {
    const obs = sourceFor(REISSUE_ENTRY).load();
    // The source's own header set, in source order - the date column comes
    // FIRST in the export; the manifest places the subject, not position.
    expect(obs.columns).toEqual([CSV_DATE_HEADER, CSV_CALLSIGN_HEADER]);
    expect(obs.subjectColumn).toBe(CSV_CALLSIGN_HEADER);
    // The physical source lines are stored facts (issue #431): header on line
    // 1, one line per data row.
    expect(obs.headerLine).toBe(1);
    expect(obs.lineNumbers?.length).toBe(obs.rows.length);

    const ledger = emitLedger(obs, REF);
    const listed = ledger.filter(c => c.predicate === LISTED_PREDICATE);
    expect(listed.length).toBe(obs.rows.length);

    // The very first disclosed event, carried verbatim: 2010-01-22,G7DMN. The
    // date rides its verbatim header; the event word is DERIVED (Looked-up),
    // one claim per row, under the named authored-vocabulary rule.
    const first = listed[0].rawSubject;
    expect(first).toBe('G7DMN');
    const firstRaw = ledger.filter(c => c.rawSubject === first && c.predicate !== LISTED_PREDICATE && c.layer === 'raw');
    expect(firstRaw.find(c => c.predicate === CSV_DATE_HEADER)?.object).toBe('2010-01-22');
    const firstEvent = ledger.find(c => c.rawSubject === first && c.predicate === EVENT_PREDICATE);
    expect(firstEvent?.layer).toBe('derived');
    expect(firstEvent?.rule).toBe(AUTHORED_EVENT_RULE);
    expect(firstEvent?.object).toBe('reissued');

    // NOTHING authored presents As-published: no raw claim carries the event
    // predicate or the authored vocabulary.
    expect(ledger.some(c => c.layer === 'raw' && (c.predicate === EVENT_PREDICATE || c.predicate === 'event_date'))).toBe(false);
    expect(ledger.some(c => c.layer === 'raw' && c.object === 'reissued')).toBe(false);

    // The stored 23:00:00 timezone artefact travels VERBATIM (never rounded to a
    // guessed day) - the raw layer keeps the distinction the ISO normalisation
    // would smooth over.
    const artefact = ledger.find(c => c.layer === 'raw' && c.predicate === CSV_DATE_HEADER && c.object === '2010-05-19 23:00:00');
    expect(artefact).toBeDefined();
    expect(artefact?.rawSubject).toBe('G3ZPS');
    expect(artefact?.provenance.vintage).toBe('2017-11');
  });

  it('ReIssueEvents_WhenEmitted_JoinIntoTheCallsignNamespaceViaNormalisationEdges', () => {
    const obs = sourceFor(REISSUE_ENTRY).load();
    const ledger = emitLedger(obs, REF);

    // subjectKind 'callsign' means the derived layer attaches a cleaned-callsign
    // normalises_to edge to every event's call sign - the auditable join that
    // lets an event be looked up in the register namespace.
    const cleanedEdges = ledger.filter(c => c.predicate === NORMALISES_TO_PREDICATE && c.rule === CLEANED_CALLSIGN_RULE);
    expect(cleanedEdges.length).toBe(obs.rows.length);
    expect(cleanedEdges.find(c => c.rawSubject === 'G7DMN')?.object).toBe('G7DMN');

    // But NOT register state: an issuance event derives no licence_category tier.
    expect(ledger.some(c => c.predicate === LICENCE_CATEGORY_PREDICATE)).toBe(false);
  });

  it('ReciprocalEvents_WhenEmitted_CarryTheirOwnAuthoredVocabularyAsDerived', () => {
    // The sibling export (ofcom-498906): same shape, its OWN covering-letter
    // word - the two CSV exports stay distinguishable at claim level through
    // the derived tier, never through a raw claim.
    const obs = sourceFor(RECIPROCAL_ENTRY).load();
    expect(obs.columns).toEqual([CSV_DATE_HEADER, CSV_CALLSIGN_HEADER]);
    const ledger = emitLedger(obs, REF);
    const events = ledger.filter(c => c.predicate === EVENT_PREDICATE);
    expect(events.length).toBe(obs.rows.length);
    expect(events.every(c => c.layer === 'derived' && c.rule === AUTHORED_EVENT_RULE && c.object === 'reciprocal-licence-issued')).toBe(true);
  });
});

describe('the WDTK heritage-transfers table (wdtk-251507, markdown-table)', { tags: ['data-validity'] }, () => {
  it('Reallocations_WhenEmitted_CarryAllTenVerbatimColumnsIncludingTheS40Markers', () => {
    const obs = sourceFor(TRANSFERS_ENTRY).load();
    // The FULL disclosed column set in source order - including the three
    // s.40-withheld name columns the old projection dropped: 'S40' is the
    // document's own published marker for names withheld under FOIA s.40, and
    // a published byte belongs in the raw layer.
    expect(obs.columns).toEqual(TRANSFERS_HEADERS);
    expect(obs.subjectColumn).toBe('Call Signs');

    const ledger = emitLedger(obs, REF);
    const listed = ledger.filter(c => c.predicate === LISTED_PREDICATE);
    expect(listed.length).toBe(obs.rows.length);

    // The first disclosed transfer, carried verbatim under the table's own
    // headers: G8JC, transferred 28/01/2015 (DAY-FIRST, never ISO-reordered
    // here), an Amateur Club Radio Licence, names withheld as 'S40'.
    const first = listed[0].rawSubject;
    expect(first).toBe('G8JC');
    const attrs = ledger.filter(c => c.rawSubject === first && c.predicate !== LISTED_PREDICATE && c.layer === 'raw');
    const value = (predicate: string) => attrs.find(c => c.predicate === predicate)?.object;
    expect(value('Start date')).toBe('28/01/2015');
    expect(value('Licence Product')).toBe('Amateur Club Radio Licence');
    expect(value('Status')).toBe('Live');
    expect(value('Reason')).toBe('Letter of consent provided for transfer');
    expect(value('Licence Number')).toBe('1-278472477');
    expect(value('Con Id')).toBe('1-LSY43');
    expect(value('Title')).toBe('S40');
    expect(value('First_name')).toBe('S40');
    expect(value('Last_name')).toBe('S40');

    // The authored 'reallocated' word (the covering letter's own vocabulary)
    // is DERIVED, one claim per row - never a raw claim.
    const events = ledger.filter(c => c.predicate === EVENT_PREDICATE);
    expect(events.length).toBe(obs.rows.length);
    expect(events.every(c => c.layer === 'derived' && c.rule === AUTHORED_EVENT_RULE && c.object === 'reallocated')).toBe(true);
    expect(ledger.some(c => c.layer === 'raw' && c.object === 'reallocated')).toBe(false);

    // Callsign subject -> normalises_to edge present; still no register category.
    expect(ledger.some(c => c.predicate === NORMALISES_TO_PREDICATE && c.rawSubject === 'G8JC')).toBe(true);
    expect(ledger.some(c => c.predicate === LICENCE_CATEGORY_PREDICATE)).toBe(false);
  });
});

// ---- Transition equality (issue #813 Stages C2/D) ---------------------------
//
// The hand-over proofs: the lossless emit must be the OLD emit plus/minus
// exactly the enumerated deltas, and the markdown table must carry the whole
// parsed transcription (the pin the deleted oracle mirror once provided).

// The OLD (pre-C2) issuance projection, reconstructed from the authored
// binding over the SAME parsed rows the new loader carries: columns are the
// authored output names, a source-null column takes the authored constant.
// This is the exact reprojection loadIssuanceEventsSource performed before the
// lossless emit, so the multiset comparison below is a true before/after.
function legacyProjection(current: SourceObservationSet, conversion: FoiSourceConversion): SourceObservationSet {
  const columns = conversion.columns.map(column => column.output);
  const rows = current.rows.map(record => {
    const row: Record<string, string> = {};
    for (const column of conversion.columns) {
      row[column.output] = column.source === null
        ? (column.constant ?? '')
        : (record[column.source] ?? '');
    }
    return row;
  });
  return {
    sourceFile: current.sourceFile,
    vintage: current.vintage,
    columns,
    subjectColumn: 'callsign',
    rows,
  };
}

// A position-free multiset key: the claim's assertion and its observation key,
// EXCLUDING the provenance position/viewAnchor enrichment (issue #431: position
// is a finer statement of the same key, deliberately outside the multiset).
function claimKey(claim: Claim): string {
  return JSON.stringify([claim.layer, claim.rawSubject, claim.predicate, claim.object, claim.rule ?? null, claim.provenance.ordinal]);
}

function sortedKeys(claims: readonly Claim[]): string[] {
  return claims.map(claimKey).sort();
}

describe('transition equality: the lossless emit vs the old projection and the whole parsed table', { tags: ['data-validity'] }, () => {
  it('TransfersTable_WhenLoadedByFamily_CarriesTheWholeParsedTableStructurePreserving', () => {
    // The fidelity pin the retired oracle mirror once provided (issue #813
    // Stages C2/D): the family's load is the WHOLE parsed table - every column
    // the transcription holds, in source order, every row cell-for-cell, the
    // s.40 'S40' marker columns included - never a projection. Compared
    // against an independent parse of the raw extract bytes with the same
    // parser the FOI converter uses; the subject is the raw callsign header
    // (the manifest places it), and the byte-level round-trip is the
    // reconstruction oracle's job.
    const { meta, conversion } = conversionFor(TRANSFERS_ENTRY);
    const family = loadIssuanceEventsSource(FOI_DIR, TRANSFERS_ENTRY, meta, conversion);
    const text = fs.readFileSync(path.join(FOI_DIR, TRANSFERS_ENTRY, conversion.sourceFile)).toString(conversion.encoding);
    const parsed = parseMarkdownTable(text, conversion.sourceFile);

    expect(family.columns).toEqual(Object.keys(parsed[0]));
    expect(family.rows).toEqual(parsed);
    expect(family.repoPath).toBe(`archive/foi/${TRANSFERS_ENTRY}/${conversion.sourceFile}`);
    expect(family.subjectColumn).toBe('Call Signs');
  });

  it.each([
    { entry: REISSUE_ENTRY, event: 'reissued', dateHeader: CSV_DATE_HEADER, s40Columns: [] as string[] },
    { entry: RECIPROCAL_ENTRY, event: 'reciprocal-licence-issued', dateHeader: CSV_DATE_HEADER, s40Columns: [] as string[] },
    { entry: TRANSFERS_ENTRY, event: 'reallocated', dateHeader: 'Start date', s40Columns: ['Title', 'First_name', 'Last_name'] },
  ])('IssuanceSource_WhenReEmittedLosslessly_ConservesTheObservationMultisetModuloEnumeratedDeltas ($entry)', ({ entry, event, dateHeader, s40Columns }) => {
    // The before/after conservation proof, with the deltas enumerated and
    // NOTHING else allowed to move:
    //   raw:     + the s.40 'S40' marker cells (transfers table only)
    //            - the authored raw `event` constant (one per row)
    //            ~ the date/product/status/... predicates renamed from output
    //              names to the verbatim headers (objects conserved)
    //   derived: + one `event` claim per row under AUTHORED_EVENT_RULE
    //            = every other derived claim byte-identical (the tiers key off
    //              rawSubject, which is unchanged).
    const { meta, conversion } = conversionFor(entry);
    const current = loadIssuanceEventsSource(FOI_DIR, entry, meta, conversion);
    const legacy = legacyProjection(current, conversion);

    const currentLedger = emitLedger(current, REF).filter(c => !isFileLevelClaim(c));
    const legacyLedger = emitLedger(legacy, REF).filter(c => !isFileLevelClaim(c));

    // RAW conservation. Transform the legacy raw multiset by exactly the
    // enumerated deltas and demand equality with the new one.
    const outputToHeader = new Map(conversion.columns.flatMap(column =>
      (column.source === null ? [] : [[column.output, column.source] as const])));
    const legacyRawTransformed: Claim[] = [];
    for (const claim of legacyLedger) {
      if (claim.layer !== 'raw') continue;
      if (claim.predicate === 'event') continue; // - the authored raw constant
      const renamed = outputToHeader.get(claim.predicate);
      legacyRawTransformed.push(renamed === undefined ? claim : { ...claim, predicate: renamed });
    }
    for (const column of s40Columns) { // + the published S40 marker cells
      current.rows.forEach((row, ordinal) => {
        legacyRawTransformed.push({
          layer: 'raw',
          rawSubject: row[current.subjectColumn] ?? '',
          predicate: column,
          object: row[column] ?? '',
          provenance: { sourceFile: current.sourceFile, ordinal, vintage: current.vintage },
        });
      });
    }
    const currentRaw = currentLedger.filter(c => c.layer === 'raw');
    expect(sortedKeys(currentRaw)).toEqual(sortedKeys(legacyRawTransformed));

    // DERIVED conservation: minus the new event tier, the derived layer is
    // byte-identical (bare provenance, so deep equality - not just keys).
    const currentDerived = currentLedger.filter(c => c.layer === 'derived' && c.rule !== AUTHORED_EVENT_RULE);
    const legacyDerived = legacyLedger.filter(c => c.layer === 'derived');
    expect(currentDerived).toEqual(legacyDerived);

    // And the new tier is exactly one Looked-up claim per row, carrying the
    // binding's covering-letter word.
    const eventClaims = currentLedger.filter(c => c.rule === AUTHORED_EVENT_RULE);
    expect(eventClaims.length).toBe(current.rows.length);
    expect(eventClaims.every(c => c.layer === 'derived' && c.predicate === EVENT_PREDICATE && c.object === event)).toBe(true);
    // The raw event date really did move to the verbatim header.
    expect(currentRaw.some(c => c.predicate === dateHeader)).toBe(true);
  });
});

describe('issuance-events family through buildLedger', { tags: ['data-validity'] }, () => {
  it('IssuanceEventsLedger_WhenBuiltForItsEntries_EmitsVerbatimRawClaimsAndDerivedEventVocabulary', () => {
    const wanted = new Set(ISSUANCE_EVENTS_ENTRY_KEYS);
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'issuance-events-ledger-'));
    try {
      const summary = buildLedger(outputDir, undefined, REF, entry => wanted.has(entry));

      // The selector isolates exactly this family: three entries, every source
      // tagged issuance-events.
      expect(summary.entriesByFamily['issuance-events']).toBe(ISSUANCE_EVENTS_ENTRY_KEYS.length);
      expect(summary.sourcesProcessed).toBe(summary.sourcesByFamily['issuance-events']);
      expect(summary.sourcesProcessed).toBe(ISSUANCE_EVENTS_ENTRY_KEYS.length);

      for (const s of summary.perSource) {
        expect(s.family).toBe('issuance-events');
        expect(s.observations).toBeGreaterThan(0);
        expect(s.rawClaims).toBeGreaterThan(0);
        // Callsign subject: the derived normalisation layer runs (unlike the
        // pool-slot/suffix/aggregate bespoke families, which stay raw-only).
        expect(s.derivedClaims).toBeGreaterThan(0);
        expect(s.vintage.length).toBeGreaterThan(0);
      }
      expect(summary.totalDerivedClaims).toBeGreaterThan(0);

      // The transfers table's persisted raw layer is fully enumerable: 20 rows
      // x (1 @listed + 9 verbatim attribute cells, every cell non-empty) plus
      // the manifest (10 @column + 1 @subject) = 211 raw claims.
      const transfers = summary.perSource.find(s => s.entry === TRANSFERS_ENTRY);
      expect(transfers?.observations).toBe(20);
      expect(transfers?.rawClaims).toBe(20 * 10 + 11);

      // One JSONL file per source landed on disk (never committed); each
      // persisted stream carries the derived event vocabulary and NO raw
      // authored spellings (issue #813 Stage C2).
      const ledgerDir = path.join(outputDir, 'ledger');
      const written = fs.readdirSync(ledgerDir).filter(name => name.endsWith('.jsonl'));
      expect(written.length).toBe(summary.sourcesProcessed);
      for (const file of written) {
        const claims = parseClaimsJsonl(fs.readFileSync(path.join(ledgerDir, file), 'utf8'));
        const observations = claims.filter(c => c.layer === 'raw' && c.predicate === LISTED_PREDICATE && !isFileLevelClaim(c));
        const events = claims.filter(c => c.predicate === EVENT_PREDICATE);
        expect(events.length).toBe(observations.length);
        expect(events.every(c => c.layer === 'derived' && c.rule === AUTHORED_EVENT_RULE)).toBe(true);
        expect(claims.some(c => c.layer === 'raw' && (c.predicate === EVENT_PREDICATE || c.predicate === 'event_date'))).toBe(false);
      }
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  }, 120_000);
});
