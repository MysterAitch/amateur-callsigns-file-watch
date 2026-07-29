// Split of the value-catalogue-fold suite by field family (#929): this file
// carries the `flags` distribution field fold. The small shared support (ref,
// FieldFigures, parseCommittedFieldTable) is duplicated across the three split
// files, each of which runs as its own heavy-fold matrix job so no single job
// carries the whole ~9-minute suite.
import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildValueCatalogueFold,
  foldFieldDistribution,
  FLAGS_FIELD,
  FLAGS_FIELD_PREDICATE,
} from './value-catalogue-fold.ts';
import {
  buildFieldTallies,
  catalogueField,
  VALUE_CATALOGUE_PATH,
  type ValueTally,
} from './value-catalogue.ts';
import { loadReferenceData } from '../sources/ofcom-amateur/components.ts';
import { serialiseClaimsJsonl } from '../v2/serialise.ts';
import {
  PARSE_CALLSIGN_RULE,
  type Claim,
} from '../v2/claim.ts';
import { duckDbAvailable } from '../v2/report-fold.ts';

const ref = loadReferenceData();

interface FieldFigures { records: number; callsigns: number; allocated: number; sources: number; lanes: string[] }

// Parse one committed field table ("## `<field>` — N distinct") back into
// figures per value, reading the same folded golden the freshness gate
// regenerates and diffs, so the equivalence check runs on every CI run whether or
// not DuckDB is present.
function parseCommittedFieldTable(field: string): Map<string, FieldFigures> {
  const markdown = fs.readFileSync(path.resolve(process.cwd(), VALUE_CATALOGUE_PATH), 'utf8');
  const lines = markdown.split('\n');
  const start = lines.findIndex(l => l.startsWith(`## \`${field}\` — `));
  expect(start, `section for ${field}`).toBeGreaterThanOrEqual(0);
  const byValue = new Map<string, FieldFigures>();
  const num = (cell: string): number => Number(cell.trim().replace(/,/g, ''));
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.startsWith('## ')) break;
    // value | records | callsigns | allocated | sources | timeline | lanes
    const m = /^\| `([^`]+)` \| ([\d,]+) \| ([\d,]+) \| ([\d,]+) \| (\d+) \| [^|]* \| (.+) \|$/.exec(line);
    if (m === null) continue;
    byValue.set(m[1], {
      records: num(m[2]), callsigns: num(m[3]), allocated: num(m[4]), sources: num(m[5]),
      lanes: m[6].split(',').map(s => s.trim()).sort(),
    });
  }
  return byValue;
}

// --- The `flags` distribution fold (issue #707) -------------------------------
//
// The `flags` field folds the shared FLAG_PREDICATE by object, UNIONING every
// signal that rides it: the T1 per-token parse flags AND the two higher-tier
// tiers — `stripped-collision` (a within-source cross-row collision) and
// `forbidden-suffix-issued-after-first-known-list` (a temporal finding). Both now
// emit as their own derived claims, so folding by object loses none of the legacy
// UNION's signal — the flag VALUE SET is preserved exactly.
//
// Unlike the parse fields, the flags fold diverges from the legacy tally in BOTH
// directions, each a classified fidelity difference, never an accident:
//
//   - FOLD_LOWER — the legacy tally raised parse flags on the FOI available-pool
//     "available callsigns" tokens (parsed AS callsigns) and unioned raw-trimmed
//     spellings; the raw-keyed fold emits those families raw-only (pool-slots,
//     never parsed) and counts distinct cleaned keys, so it reports FEWER on the
//     flags those tokens carried (forbidden-suffix, rsl-in-register).
//
//   - FOLD_HIGHER — the fold reads the RAW token verbatim, whereas the legacy FOI
//     flag path re-parsed the already-CLEANED callsign (whitespace stripped, case
//     folded), so a raw-only distinction the cleaned form discarded fired no
//     legacy flag; and the fold runs the cross-row collision pass over EVERY
//     register source, where the legacy path ran it on the open-data lane alone.
//     So the fold catches MORE (whitespace, stripped-collision) and fires the
//     temporal flag on the FOI register snapshots that disclose an original-start
//     date, which the legacy FOI path never passed the parser
//     (forbidden-suffix-issued-after-first-known-list).
//
//   - UNCHANGED — the flag rides only register callsign observations both paths
//     count identically, so legacy and folded figures match to the digit.
//
// The classification below PARTITIONS the whole flag vocabulary: a new flag, or a
// flag drifting between classes, trips the partition or a direction assertion
// rather than passing unseen (the surprise-instrumentation discipline).
const FLAG_FOLD_LOWER: readonly string[] = ['forbidden-suffix', 'rsl-in-register'];
const FLAG_FOLD_HIGHER: readonly string[] = [
  'whitespace',
  'stripped-collision',
  'forbidden-suffix-issued-after-first-known-list',
];
const FLAG_FOLD_LOWER_REASON = 'the legacy tally raised this flag on FOI available-pool tokens parsed AS callsigns and unioned raw-trimmed spellings; the raw-keyed fold emits those pool-slots raw-only and counts distinct cleaned keys';
const FLAG_FOLD_HIGHER_REASON = 'the fold reads the RAW token verbatim (the legacy FOI path re-parsed the cleaned callsign) and runs the cross-row collision pass over every register source (the legacy path ran it on the open-data lane alone), so it catches raw distinctions the legacy path lost';

describe('flags distribution — ledger vs legacy classified-equivalence oracle', { tags: ['data-validity'] }, () => {
  // Always-on: reads the committed folded golden and recomputes the legacy flags
  // catalogue live over the real archive (no DuckDB needed for this side).
  let legacyFlags: Map<string, ValueTally>;
  let committedFlags: Map<string, FieldFigures>;
  beforeAll(() => {
    const cells = buildFieldTallies().get(FLAGS_FIELD);
    legacyFlags = new Map((cells === undefined ? [] : catalogueField(FLAGS_FIELD, cells).values).map(v => [v.value, v]));
    committedFlags = parseCommittedFieldTable(FLAGS_FIELD);
  }, 600_000);

  it('Flags_FoldedValueSet_EqualsLegacyValueSet_LosingNoSignal', () => {
    // The union that the emission of the two higher-tier signals makes safe: the
    // fold surfaces EXACTLY the legacy flag vocabulary — no flag invented, and
    // (the point of emitting the two signals first) none silently dropped.
    expect([...committedFlags.keys()].sort()).toEqual([...legacyFlags.keys()].sort());
  });

  it('Flags_Classification_PartitionsTheWholeFlagVocabulary', () => {
    // Every observed flag is classified exactly once; a new/unclassified flag or a
    // duplicate trips here rather than slipping past the direction checks.
    const classified = [...FLAG_FOLD_LOWER, ...FLAG_FOLD_HIGHER];
    expect(new Set(classified).size, 'classification lists overlap').toBe(classified.length);
    const unchanged = [...legacyFlags.keys()].filter(v => !classified.includes(v));
    const partition = [...classified, ...unchanged].sort();
    expect(partition).toEqual([...legacyFlags.keys()].sort());
  });

  it('Flags_FoldLowerClass_FoldedNeverExceedsLegacy', () => {
    // The pool-slot / cleaned-key direction: a raw-keyed fold can only report
    // FEWER on a flag the legacy tally also raised on available-pool callsign
    // tokens. An inversion means the fold gained observations to investigate.
    for (const flag of FLAG_FOLD_LOWER) {
      const f = committedFlags.get(flag);
      const l = legacyFlags.get(flag);
      expect(f, `folded ${flag}`).toBeDefined();
      expect(l, `legacy ${flag}`).toBeDefined();
      expect(f?.records ?? 0, `${flag} records (${FLAG_FOLD_LOWER_REASON})`).toBeLessThanOrEqual(l?.count ?? 0);
      expect(f?.callsigns ?? 0, `${flag} callsigns`).toBeLessThanOrEqual(l?.distinctCallsigns ?? 0);
      expect(f?.allocated ?? 0, `${flag} allocated`).toBeLessThanOrEqual(l?.allocated ?? 0);
    }
    // Non-vacuous: at least one lower-class flag genuinely shrinks, so the class
    // is not silently a no-op hiding a regression.
    const shrank = FLAG_FOLD_LOWER.some(flag => (committedFlags.get(flag)?.records ?? 0) < (legacyFlags.get(flag)?.count ?? 0));
    expect(shrank, 'no FOLD_LOWER flag actually shrank').toBe(true);
  });

  it('Flags_FoldHigherClass_FoldedNeverFallsBelowLegacy_TheRawVerbatimGain', () => {
    // The raw-verbatim / all-source-collision direction: reading the raw token and
    // running the collision pass everywhere can only find MORE, never fewer, of
    // these flags than the legacy path that re-parsed the cleaned callsign.
    for (const flag of FLAG_FOLD_HIGHER) {
      const f = committedFlags.get(flag);
      const l = legacyFlags.get(flag);
      expect(f, `folded ${flag}`).toBeDefined();
      expect(l, `legacy ${flag}`).toBeDefined();
      expect(f?.records ?? 0, `${flag} records (${FLAG_FOLD_HIGHER_REASON})`).toBeGreaterThanOrEqual(l?.count ?? 0);
    }
    // Non-vacuous: at least one higher-class flag genuinely grows.
    const grew = FLAG_FOLD_HIGHER.some(flag => (committedFlags.get(flag)?.records ?? 0) > (legacyFlags.get(flag)?.count ?? 0));
    expect(grew, 'no FOLD_HIGHER flag actually grew').toBe(true);
  });

  it('Flags_UnchangedClass_FoldedMatchesLegacyToTheDigit', () => {
    // A flag riding only register callsign observations both paths count the same
    // way: legacy and folded figures must be identical, so a drift here is a real
    // divergence, not a classified one.
    const classified = new Set([...FLAG_FOLD_LOWER, ...FLAG_FOLD_HIGHER]);
    expect(legacyFlags.size, 'legacy flags tally').toBeGreaterThan(0);
    for (const [flag, l] of legacyFlags) {
      if (classified.has(flag)) continue;
      const f = committedFlags.get(flag);
      expect(f, `folded ${flag}`).toBeDefined();
      expect({ records: f?.records, callsigns: f?.callsigns, allocated: f?.allocated, sources: f?.sources }, `unchanged ${flag}`)
        .toEqual({ records: l.count, callsigns: l.distinctCallsigns, allocated: l.allocated, sources: l.sources });
    }
  });
});

// A hand-built ledger over one register source raising the whole flag union: a
// per-token parse flag, a stripped-collision (a junk twin + its clean row), and a
// temporal forbidden-suffix flag. The fold must union all three under one pass —
// the user-facing behaviour the published `flags` table relies on — verified
// without the whole corpus.
function writeFlagsFixtureLedger(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flags-fold-fixture-'));
  const flag = (rawSubject: string, ordinal: number, object: string, rule: string): Claim =>
    ({ layer: 'derived', rawSubject, predicate: FLAGS_FIELD_PREDICATE, object, provenance: { sourceFile: 'opendata/2025-01-01/raw.csv', ordinal, vintage: '2025-01-01' }, rule });
  const claims: Claim[] = [
    flag('M7ASS', 0, 'forbidden-suffix', PARSE_CALLSIGN_RULE),
    flag('M7ASS', 0, 'forbidden-suffix-issued-after-first-known-list', PARSE_CALLSIGN_RULE),
    flag('G0TQK ', 1, 'stripped-collision', 'stripped-collision'),
  ];
  fs.writeFileSync(path.join(dir, 'fixture.jsonl'), serialiseClaimsJsonl(claims));
  return dir;
}

describe.skipIf(!duckDbAvailable())('flags distribution fold — fixture ledger', { tags: ['unit'] }, () => {
  it('FlagsFold_SyntheticLedger_UnionsParseFlagsStrippedCollisionAndTemporalByObject', () => {
    const dir = writeFlagsFixtureLedger();
    try {
      const cat = foldFieldDistribution(dir, FLAGS_FIELD, FLAGS_FIELD_PREDICATE);
      const byValue = new Map(cat.values.map(v => [v.value, v]));
      // Every signal riding FLAG_PREDICATE is folded by its object, so all three
      // tiers appear in the one distribution.
      expect([...byValue.keys()].sort()).toEqual([
        'forbidden-suffix',
        'forbidden-suffix-issued-after-first-known-list',
        'stripped-collision',
      ]);
      expect(byValue.get('stripped-collision')?.count).toBe(1);
      expect(byValue.get('forbidden-suffix')?.count).toBe(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('FlagsFold_EmptyLedger_YieldsNoFlags', () => {
    // The non-happy path: an empty ledger folds to an empty flag distribution
    // rather than reaching DuckDB with a glob that matches nothing.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flags-fold-empty-'));
    try {
      expect(foldFieldDistribution(dir, FLAGS_FIELD, FLAGS_FIELD_PREDICATE).values).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// The real-archive retirement gate for `flags`: with the pinned DuckDB CLI
// present, folding must reproduce the committed golden's flag figures — the proof
// the fold (not a parse of the golden) produces the numbers.
describe.skipIf(!duckDbAvailable())('flags distribution fold — real-archive retirement gate', { tags: ['data-validity'] }, () => {
  let foldedFlags: Map<string, ValueTally>;
  beforeAll(() => {
    foldedFlags = new Map((buildValueCatalogueFold(undefined, ref).fields.get(FLAGS_FIELD)?.values ?? []).map(v => [v.value, v]));
  }, 600_000);

  it('FlagsFold_RealArchive_ReproducesCommittedGoldenFigures', () => {
    const committed = parseCommittedFieldTable(FLAGS_FIELD);
    expect([...foldedFlags.keys()].sort(), 'flags value set').toEqual([...committed.keys()].sort());
    for (const [value, c] of committed) {
      const f = foldedFlags.get(value);
      expect(f, `folded flags/${value}`).toBeDefined();
      expect({ records: f?.count, callsigns: f?.distinctCallsigns, allocated: f?.allocated, sources: f?.sources }, `flags/${value}`)
        .toEqual({ records: c.records, callsigns: c.callsigns, allocated: c.allocated, sources: c.sources });
    }
  });
});
