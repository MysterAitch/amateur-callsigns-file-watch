import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import {
  emitLedger,
  normalisationEdgesFor,
  NORMALISES_TO_PREDICATE,
  CLEANED_CALLSIGN_RULE,
  PLACEHOLDER_FORM_RULE,
  type SourceObservationSet,
  type Provenance,
} from './claim.ts';
import { serialiseClaimsJsonl, parseClaimsJsonl, serialiseNQuads } from './serialise.ts';
import { cleanedCallsign, loadReferenceData } from '../sources/ofcom-amateur/components.ts';

// The scenario: two rows of ONE published source carry the same callsign under
// different raw bytes — G0TQK and "G0TQK<NBSP>" — the register variant Roger
// verified against the raw disclosure. Observation-over-subject keying plus a
// rule-attributed normalisation edge must keep the two distinct at the raw
// grain while resolving both to the single entity a user queries.

const ARCHIVE_DIR = path.resolve(import.meta.dirname, '..', '..', 'archive');
const REF = loadReferenceData();

const RAW_EXTRACT = 'foi/ofcom-01420046--allocated-reserved-callsigns/raw-extract-sheet-1-report1646659776237.csv';

describe('G0TQK NBSP twin', () => {
  it('RawTokens_WhenNbspVariantPresent_YieldTwoObservationsBothNormalisingToOneEntity', () => {
    const content = fs.readFileSync(path.join(ARCHIVE_DIR, RAW_EXTRACT), 'utf8');
    const allRows = parse(content, { columns: true, bom: true }) as Record<string, string>[];

    // The twin: every raw row whose cleaned callsign is the entity G0TQK.
    const twinRows = allRows.filter(row => cleanedCallsign(row.Value) === 'G0TQK');
    const rawTokens = twinRows.map(row => row.Value);

    // Two DISTINCT raw tokens, exactly one of which carries the trailing NBSP —
    // the raw distinction the cleaned entity discards but the ledger preserves.
    expect(twinRows.length).toBe(2);
    expect(new Set(rawTokens).size).toBe(2);
    expect(rawTokens.some(token => token === 'G0TQK')).toBe(true);
    expect(rawTokens.some(token => token.includes(' '))).toBe(true);

    const source: SourceObservationSet = {
      sourceFile: RAW_EXTRACT,
      vintage: '2022-03-07',
      columns: ['Value', 'Status', 'Type'],
      subjectColumn: 'Value',
      rows: twinRows,
    };
    const ledger = emitLedger(source, REF);

    // Existence claims prove two distinct raw observations survive verbatim.
    const listedSubjects = ledger.filter(claim => claim.predicate === '@listed').map(claim => claim.rawSubject);
    expect(new Set(listedSubjects).size).toBe(2);

    // Both raw tokens normalise (cleaned-callsign rule) to the SAME entity.
    const cleanedEdges = ledger.filter(claim => claim.predicate === NORMALISES_TO_PREDICATE && claim.rule === CLEANED_CALLSIGN_RULE);
    expect(cleanedEdges.length).toBe(2);
    expect(cleanedEdges.every(edge => edge.object === 'G0TQK')).toBe(true);
    // The edges keep DIFFERENT raw subjects — the join is auditable, not a merge.
    expect(new Set(cleanedEdges.map(edge => edge.rawSubject)).size).toBe(2);

    // Both statuses (Allocated, Reserved) are preserved, one per observation:
    // the "dual status" is honestly two co-temporal observations, not a conflict.
    const statuses = ledger.filter(claim => claim.predicate === 'Status').map(claim => claim.object).sort();
    expect(statuses).toEqual(['Allocated', 'Reserved']);
  });
});

describe('lifted normalisation rules', () => {
  const provenance: Provenance = { sourceFile: 'synthetic', ordinal: 0, vintage: '2026-07-11' };

  it('NormalisationEdges_WhenRegionalRendering_CollapseToOneRslLessPlaceholder', () => {
    // M7TEE and its regional rendering MW7TEE are interchangeable forms of one
    // licence: both must resolve to the RSL-less placeholder M#7TEE, lifting
    // parseCallsign's real logic rather than an eyeballed reimplementation.
    for (const token of ['M7TEE', 'MW7TEE']) {
      const edges = normalisationEdgesFor(token, provenance, REF);
      const placeholder = edges.find(edge => edge.rule === PLACEHOLDER_FORM_RULE);
      expect(placeholder?.entity).toBe('M#7TEE');
    }
  });

  it('NormalisationEdges_WhenHashIsRegionalLocatorSlot_TreatedAsRslNotDamage', () => {
    // The # in M/#PT2FM is a documented RSL-slot marker, not junk: the cleaned
    // form keeps the home callsign and the edge is emitted, never dropped.
    const edges = normalisationEdgesFor('M/#PT2FM', provenance, REF);
    const cleaned = edges.find(edge => edge.rule === CLEANED_CALLSIGN_RULE);
    expect(cleaned?.entity).toBe('M/PT2FM');
  });
});

describe('serialisation', () => {
  const source: SourceObservationSet = {
    sourceFile: 'synthetic/tiny.csv',
    vintage: '2026-07-11',
    columns: ['callsign', 'status'],
    subjectColumn: 'callsign',
    rows: [{ callsign: 'M7TEE', status: 'Allocated' }, { callsign: 'G0TQK ', status: 'Reserved' }],
  };

  it('CanonicalJsonl_WhenSerialisedThenParsed_RoundTripsClaimsLosslessly', () => {
    const ledger = emitLedger(source, REF);
    const jsonl = serialiseClaimsJsonl(ledger);
    // One line per claim, trailing newline.
    expect(jsonl.split('\n').filter(line => line !== '').length).toBe(ledger.length);
    expect(parseClaimsJsonl(jsonl)).toEqual(ledger);
  });

  it('NQuadsExport_WhenDerivedFromLedger_CarriesRawTokenAndNormalisationRule', () => {
    const ledger = emitLedger(source, REF);
    const nquads = serialiseNQuads(ledger);
    // The NBSP-bearing raw token survives verbatim into the RDF literal.
    expect(nquads).toContain('"G0TQK "');
    // Every quad terminates with the mandated ' .' and every derived edge
    // carries its named rule.
    expect(nquads.trim().split('\n').every(line => line.endsWith(' .'))).toBe(true);
    expect(nquads).toContain('"cleaned-callsign"');
  });
});
