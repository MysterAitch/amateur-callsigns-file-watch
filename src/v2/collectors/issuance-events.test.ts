import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  emitLedger,
  LISTED_PREDICATE,
  NORMALISES_TO_PREDICATE,
  CLEANED_CALLSIGN_RULE,
  LICENCE_CATEGORY_PREDICATE,
} from '../claim.ts';
import { buildLedger } from '../build-ledger.ts';
import {
  collectIssuanceEventsSources,
  issuanceEventsEntries,
  ISSUANCE_EVENTS_CLASS,
} from './issuance-events.ts';
import { qualifyingRegisterEntries } from './foi-register.ts';
import { collectAttributeAddendumSources } from './attribute-addendum.ts';
import { loadReferenceData } from '../../sources/ofcom-amateur/components.ts';

// Test names follow the project's Subject_Scenario_Outcome convention.
//
// The scenario is the issuance-events family's claim standing (issue #361): each
// row is a dated licensing EVENT - a call sign paired with the date it was
// re-issued, reciprocal-licence-issued, or reallocated. The subject IS a genuine
// call sign, so the family is subjectKind 'callsign' and rides the full derived
// layer (normalises_to edges) to JOIN events into the call-sign namespace - yet
// it stays distinct from register STATE, carrying an authored `event` and an
// `event_date` rather than a register status, and deriving NO licence_category
// tier. The raw call-sign and date tokens travel verbatim (timezone/day-first
// artefacts intact); the entry vintage rides every claim.

const REF = loadReferenceData();

// Stable archived entry keys - the raw source files and columns are read from
// the authored converter binding, never hard-coded in the test.
const REISSUE_ENTRY = 'ofcom-498903--reissued-callsigns-since-2010'; // CSV workbook extract
const RECIPROCAL_ENTRY = 'ofcom-498906--reciprocal-licences-since-2010'; // CSV workbook extract
const TRANSFERS_ENTRY = 'wdtk-251507--reissue-policy'; // markdown-table transcription

const ISSUANCE_EVENTS_ENTRY_KEYS = [REISSUE_ENTRY, RECIPROCAL_ENTRY, TRANSFERS_ENTRY];

function sourceFor(entry: string) {
  const source = collectIssuanceEventsSources().find(s => s.entry === entry);
  if (source === undefined) throw new Error(`no issuance-events source for ${entry}`);
  return source;
}

describe('issuance-events family collection', () => {
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
      expect(obs.subjectColumn).toBe('callsign');
      expect(obs.sourceFile.startsWith(`foi/${source.entry}/`)).toBe(true);
      // Every observation carries the disclosure's vintage - load-bearing for a
      // dated event snapshot.
      expect(obs.vintage.length).toBeGreaterThan(0);
      // A product/categoryColumn is deliberately NOT set: an issuance event is
      // not a register state, so no licence_category tier is derivable.
      expect(obs.categoryColumn).toBeUndefined();
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

describe('the CSV workbook exports (ofcom-498903 / ofcom-498906)', () => {
  it('ReIssueEvents_WhenEmitted_CarryVerbatimCallsignEventAndTimezoneArtefactDate', () => {
    const obs = sourceFor(REISSUE_ENTRY).load();
    expect(obs.columns).toEqual(['callsign', 'event', 'event_date']);

    const ledger = emitLedger(obs, REF);
    const listed = ledger.filter(c => c.predicate === LISTED_PREDICATE);
    expect(listed.length).toBe(obs.rows.length);

    // The very first disclosed event, carried verbatim: 2010-01-22,G7DMN.
    const first = listed[0].rawSubject;
    expect(first).toBe('G7DMN');
    const firstAttrs = ledger.filter(c => c.rawSubject === first && c.predicate !== LISTED_PREDICATE && c.layer === 'raw');
    expect(firstAttrs.find(c => c.predicate === 'event')?.object).toBe('reissued');
    expect(firstAttrs.find(c => c.predicate === 'event_date')?.object).toBe('2010-01-22');

    // The stored 23:00:00 timezone artefact travels VERBATIM (never rounded to a
    // guessed day) - the raw layer keeps the distinction the ISO normalisation
    // would smooth over.
    const artefact = ledger.find(c => c.layer === 'raw' && c.predicate === 'event_date' && c.object === '2010-05-19 23:00:00');
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
});

describe('the WDTK heritage-transfers table (wdtk-251507, markdown-table)', () => {
  it('Reallocations_WhenEmitted_CarryVerbatimCallsignDayFirstDateAndDisclosedProduct', () => {
    const obs = sourceFor(TRANSFERS_ENTRY).load();
    // The full disclosed column set, minus the s.40-withheld name columns the
    // binding ignores; the callsign is the subject.
    expect(obs.columns).toEqual([
      'callsign', 'event', 'event_date', 'licence_class', 'status', 'reason', 'licence_number', 'con_id',
    ]);

    const ledger = emitLedger(obs, REF);
    const listed = ledger.filter(c => c.predicate === LISTED_PREDICATE);
    expect(listed.length).toBe(obs.rows.length);

    // The first disclosed transfer, carried verbatim: G8JC, transferred
    // 28/01/2015 (DAY-FIRST, never ISO-reordered here), an Amateur Club Radio
    // Licence. The event vocabulary 'reallocated' is the binding's authored
    // constant from the covering letter.
    const first = listed[0].rawSubject;
    expect(first).toBe('G8JC');
    const attrs = ledger.filter(c => c.rawSubject === first && c.predicate !== LISTED_PREDICATE && c.layer === 'raw');
    const value = (predicate: string) => attrs.find(c => c.predicate === predicate)?.object;
    expect(value('event')).toBe('reallocated');
    expect(value('event_date')).toBe('28/01/2015');
    expect(value('licence_class')).toBe('Amateur Club Radio Licence');
    expect(value('status')).toBe('Live');
    expect(value('reason')).toBe('Letter of consent provided for transfer');
    expect(value('licence_number')).toBe('1-278472477');
    expect(value('con_id')).toBe('1-LSY43');

    // Callsign subject -> normalises_to edge present; still no register category.
    expect(ledger.some(c => c.predicate === NORMALISES_TO_PREDICATE && c.rawSubject === 'G8JC')).toBe(true);
    expect(ledger.some(c => c.predicate === LICENCE_CATEGORY_PREDICATE)).toBe(false);
  });
});

describe('issuance-events family through buildLedger', () => {
  it('IssuanceEventsLedger_WhenBuiltForItsEntries_EmitsRawClaimsWithCallsignNormalisationOnly', () => {
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

      // One JSONL file per source landed on disk (never committed).
      const written = fs.readdirSync(path.join(outputDir, 'ledger')).filter(name => name.endsWith('.jsonl'));
      expect(written.length).toBe(summary.sourcesProcessed);
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  }, 120_000);
});
