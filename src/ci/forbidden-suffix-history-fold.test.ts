import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildForbiddenSuffixHistory,
  buildForbiddenSuffixHistoryFold,
  collectRawDisclosuresFromLedger,
  historyFromDisclosures,
  renderForbiddenSuffixHistory,
  FORBIDDEN_SUFFIX_HISTORY_PATH,
  type ForbiddenLedgerSource,
  type ForbiddenSuffixHistory,
} from './forbidden-suffix-history.ts';
import { emitClaims, type SourceObservationSet } from '../v2/claim.ts';
import { serialiseClaimsJsonl } from '../v2/serialise.ts';
import { duckDbAvailable } from '../v2/report-fold.ts';
import { assertNonEmpty } from '../testing/non-vacuity.ts';

// Issue #361 (migration map step 3): the forbidden-suffix-history report folds
// from the raw-keyed claim ledger rather than the retired normalised suffix
// files. Two read mechanisms fold that ledger (issue #444): the committed report
// through DuckDB (buildForbiddenSuffixHistoryFold, report-fold.ts), and the page
// renderer / reference-data guard through the DuckDB-free in-memory claim fold
// (buildForbiddenSuffixHistory). This is the durable equivalence oracle — both
// mechanisms are pinned to the committed golden byte-for-byte, and to each other.
// Test names follow Subject_Scenario_Outcome.

// --- Fold logic on a controlled ledger --------------------------------------
//
// A hand-built two-disclosure ledger, emitted through the REAL emit path
// (emitClaims over a forbidden SourceObservationSet), then folded. It exercises
// the behaviours the real report depends on without the whole corpus: a
// duplicate suffix row preserved verbatim, the day-first LastModifiedDate
// normalised to the report's ISO form, the cross-disclosure set diff, and the
// union / first-known anti-drift semantics.

// A forbidden disclosure as its RAW source rows (the shape loadForbiddenSource
// produces): a `Name` suffix column, plus a `LastModifiedDate` column where the
// disclosure carries one.
function forbiddenSource(sourceFile: string, vintage: string, rows: Record<string, string>[]): SourceObservationSet {
  const columns = rows.some(r => 'LastModifiedDate' in r) ? ['Name', 'LastModifiedDate'] : ['Name'];
  return { sourceFile, vintage, columns, subjectColumn: 'Name', rows };
}

function writeForbiddenFixtureLedger(): { dir: string; sources: ForbiddenLedgerSource[] } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forbidden-fold-fixture-'));
  const dir = path.join(root, 'ledger');
  fs.mkdirSync(dir, { recursive: true });

  // Disclosure 0 (2016): ABC, ZIT, ZIT (a duplicate row), QNF — no dates.
  const d0 = forbiddenSource('foi/fixture-2016/list.csv', '2016-09', [
    { Name: 'ABC' }, { Name: 'ZIT' }, { Name: 'ZIT' }, { Name: 'QNF' },
  ]);
  // Disclosure 1 (2024): ABC (persists), JIZ (new) — both dated day-first. QNF
  // and ZIT are absent here (de-listed), which the union must NOT treat as
  // un-forbidden. The 2024 vintage is LATER than JIZ's 2020 date, so JIZ's
  // first-known must anchor to the finer date, not the vintage.
  const d1 = forbiddenSource('foi/fixture-2024/list.csv', '2024-12', [
    { Name: 'ABC', LastModifiedDate: '29/07/2016 17:19' },
    { Name: 'JIZ', LastModifiedDate: '10/12/2020 09:10' },
  ]);

  const stem0 = 'forbidden-fixture-2016-list';
  const stem1 = 'forbidden-fixture-2024-list';
  fs.writeFileSync(path.join(dir, `${stem0}.jsonl`), serialiseClaimsJsonl(emitClaims(d0)));
  fs.writeFileSync(path.join(dir, `${stem1}.jsonl`), serialiseClaimsJsonl(emitClaims(d1)));

  const sources: ForbiddenLedgerSource[] = [
    // The date column is declared by name, as the real enumerator lifts it off
    // the authored binding (issue #813 Stage D): the 2016 fixture declares
    // none, the 2024 fixture its LastModifiedDate header.
    { entry: 'fixture-2016', vintage: '2016-09', normalisedFileName: 'normalised--list.csv', jsonlStem: stem0, lastModifiedPredicate: null, emit: () => [] },
    { entry: 'fixture-2024', vintage: '2024-12', normalisedFileName: 'normalised--list.csv', jsonlStem: stem1, lastModifiedPredicate: 'LastModifiedDate', emit: () => [] },
  ];
  return { dir: root, sources };
}

describe.skipIf(!duckDbAvailable())('forbidden-suffix history — fold on a controlled ledger', { tags: ['unit'] }, () => {
  it('FoldedHistory_LedgerWithDuplicateDatedAndDelistedSuffix_PreservesDuplicateNormalisesDateAndKeepsUnion', () => {
    const { dir, sources } = writeForbiddenFixtureLedger();
    try {
      const h = historyFromDisclosures(collectRawDisclosuresFromLedger(path.join(dir, 'ledger'), sources));
      const d2016 = h.disclosures.find(d => d.vintage === '2016-09');
      const d2024 = h.disclosures.find(d => d.vintage === '2024-12');
      expect(d2016).toBeDefined();
      expect(d2024).toBeDefined();

      // The duplicate row is preserved verbatim, never silently deduplicated:
      // 4 rows for 3 distinct suffixes, with ZIT called out.
      expect(d2016?.rowCount).toBe(4);
      expect(d2016?.distinctCount).toBe(3);
      expect(d2016?.duplicates).toEqual(['ZIT']);

      // The set diff 2016 -> 2024: JIZ added, QNF and ZIT removed (ABC persists).
      expect(d2024?.added).toEqual(['JIZ']);
      expect(d2024?.removed).toEqual(['QNF', 'ZIT']);

      // The raw day-first LastModifiedDate is normalised to the report's ISO
      // form via the shared date rule — not re-derived in SQL.
      expect(d2024?.lastModified).toEqual([
        { value: '2016-07-29 17:19', count: 1, suffixes: ['ABC'] },
        { value: '2020-12-10 09:10', count: 1, suffixes: ['JIZ'] },
      ]);

      // Union anti-drift: QNF and ZIT, absent from the later list, stay in the
      // ever-forbidden union — the churn-robust basis for the row-level flag.
      expect(h.everForbiddenUnion).toEqual(['ABC', 'JIZ', 'QNF', 'ZIT']);

      // First-known uses the finest dated provenance: JIZ's 2020 LastModifiedDate
      // beats its 2024 vintage; ABC's 2016-07 date beats even the 2016-09
      // vintage; QNF, undated, falls back to its disclosure vintage.
      expect(h.firstKnownForbidden['JIZ'].dateKey).toBe('2020-12-10');
      expect(h.firstKnownForbidden['ABC'].dateKey).toBe('2016-07-29');
      expect(h.firstKnownForbidden['QNF'].dateKey).toBe('2016-09');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// --- The durable equivalence oracle -----------------------------------------
//
// The retirement gate for this report (issue #361): the ledger fold is
// SEMANTICALLY equivalent to the legacy normalised-file computation, and every
// place they COULD differ is a CLASSIFIED, explained raw-vs-normalised artefact.
// For this report the classification resolves to ZERO residual difference: the
// ledger stores the suffix and the LastModifiedDate verbatim, and the fold re-
// applies the SAME two transforms the normalised store baked in — the verbatim
// column's edge-whitespace trim, and the day-first date rule (parseUkDateTime),
// each on its own authoritative implementation rather than re-derived. So a
// faithful fold reproduces the committed report exactly. This allow-list pins
// the expected per-disclosure figures with the reason they match, so a NEW
// divergence — a drift in the ledger emit, the legacy generator, or the archive
// beyond a regenerated golden — trips CI rather than being noticed by eye.
interface DisclosureExpectation {
  entry: string;
  distinct: number;
  rows: number;
  duplicated: string[];
  added: string[];
  removed: string[];
  reason: string;
}

const VERBATIM_SUFFIX = 'suffix folds verbatim from the raw @listed claim; the fold re-applies the same edge trim the normalised store used, so distinct/rows match exactly';
const VERBATIM_WITH_DUP = 'the 2016 ZIT duplicate is preserved verbatim in the ledger (one @listed claim per row), so rows exceed distinct by exactly one — a faithful data-quality count, not a defect';
const DATED_DISCLOSURE = 'suffixes fold verbatim; the per-suffix LastModifiedDate folds from the raw attribute claim and is re-normalised by the shared day-first date rule, reproducing the ISO display value';

const EXPECTED_DISCLOSURES: DisclosureExpectation[] = [
  { entry: 'wdtk-356636--all-callsigns-plus-forbidden', distinct: 1465, rows: 1466, duplicated: ['ZIT'], added: [], removed: [], reason: VERBATIM_WITH_DUP },
  { entry: 'wdtk-596532--allocated-reserved-forbidden', distinct: 1465, rows: 1465, duplicated: [], added: [], removed: [], reason: VERBATIM_SUFFIX },
  { entry: 'ofcom-756622--published-register-csv', distinct: 1465, rows: 1465, duplicated: [], added: [], removed: [], reason: VERBATIM_SUFFIX },
  { entry: 'ofcom-2024-12--forbidden-suffixes', distinct: 1464, rows: 1464, duplicated: [], added: ['JIZ'], removed: ['QNF', 'ZFJ'], reason: DATED_DISCLOSURE },
];

const EXPECTED_UNION = 1466;
const EXPECTED_CHANGED = ['JIZ', 'QNF', 'ZFJ'];

// Parse the committed report's "## Disclosures" table into figures. The
// committed golden IS the ledger fold's output (writeForbiddenSuffixHistory
// folds it, and the freshness gate regenerates and diffs it), so this reads the
// FOLDED side without re-folding — letting the equivalence check run on every CI
// run, DuckDB present or not.
interface ParsedDisclosure { vintage: string; entry: string; distinct: number; rows: number; duplicated: string[]; added: string[]; removed: string[] }

function suffixCell(cell: string): string[] {
  const trimmed = cell.trim();
  if (trimmed === '—' || trimmed === '') return [];
  return [...trimmed.matchAll(/`([^`]+)`/g)].map(m => m[1]);
}

function parseCommittedGolden(): { disclosures: ParsedDisclosure[]; union: number; changed: string[] } {
  const markdown = fs.readFileSync(path.resolve(process.cwd(), FORBIDDEN_SUFFIX_HISTORY_PATH), 'utf8');
  const lines = markdown.split('\n');
  const num = (cell: string): number => Number(cell.trim().replace(/,/g, ''));
  const disclosures: ParsedDisclosure[] = [];
  const rowRe = /^\| (.+?) \| `([^`]+)` \| ([\d,]+) \| ([\d,]+) \| (.+?) \| (.+?) \| (.+?) \|$/;
  for (const line of lines) {
    const m = rowRe.exec(line);
    if (m === null) continue;
    disclosures.push({
      vintage: m[1].trim(), entry: m[2], distinct: num(m[3]), rows: num(m[4]),
      duplicated: suffixCell(m[5]), added: suffixCell(m[6]), removed: suffixCell(m[7]),
    });
  }
  const unionLine = lines.find(l => /distinct$/.test(l) && /\*\*[\d,]+\*\*/.test(l));
  const union = unionLine === undefined ? -1 : num((/\*\*([\d,]+)\*\*/.exec(unionLine) ?? ['', '-1'])[1]);
  // The changed-suffix matrix rows: `| \`SUF\` | ... |` under the last section.
  const changed = lines
    .map(l => /^\| `([A-Z0-9]+)` \| [·✓]/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map(m => m[1]);
  return { disclosures, union, changed };
}

describe('forbidden-suffix history — DuckDB-free claim fold vs committed golden', { tags: ['data-validity'] }, () => {
  // Always-on (no DuckDB needed): fold the history live over the real archive
  // through the in-memory claim fold, and read the committed folded golden. The
  // committed report is produced by the DuckDB fold, so this pins the DuckDB-free
  // read mechanism to the DuckDB one byte-for-byte without needing DuckDB present.
  let duckDbFreeFold: ForbiddenSuffixHistory;
  let committed: { disclosures: ParsedDisclosure[]; union: number; changed: string[] };
  beforeAll(() => {
    duckDbFreeFold = buildForbiddenSuffixHistory();
    committed = parseCommittedGolden();
  }, 600_000);

  it('ForbiddenSuffixHistory_DuckDbFreeClaimFold_ReproducesCommittedGoldenByteForByte', () => {
    // The load-bearing equivalence assertion: the DuckDB-free in-memory claim fold
    // renders byte-identical to the committed report (the DuckDB fold's output).
    // Both mechanisms fold the same ledger claims and agree on every view — the
    // proof the page renderer and reference-data guard need no DuckDB dependency.
    expect(renderForbiddenSuffixHistory(duckDbFreeFold)).toBe(fs.readFileSync(path.resolve(process.cwd(), FORBIDDEN_SUFFIX_HISTORY_PATH), 'utf8'));
  });

  it('ForbiddenSuffixHistory_CommittedFold_MatchesClassifiedAllowList', () => {
    // The committed golden still matches the classified figures; a drift means
    // the ledger emit or fold changed the numbers without the classification
    // being revisited.
    expect(committed.disclosures.map(d => d.entry)).toEqual(EXPECTED_DISCLOSURES.map(e => e.entry));
    for (const expected of EXPECTED_DISCLOSURES) {
      const actual = committed.disclosures.find(d => d.entry === expected.entry);
      expect(actual, `folded disclosure ${expected.entry}`).toBeDefined();
      expect({ distinct: actual?.distinct, rows: actual?.rows, duplicated: actual?.duplicated, added: actual?.added, removed: actual?.removed }, `${expected.entry} (${expected.reason})`)
        .toEqual({ distinct: expected.distinct, rows: expected.rows, duplicated: expected.duplicated, added: expected.added, removed: expected.removed });
    }
    expect(committed.union).toBe(EXPECTED_UNION);
    expect(committed.changed).toEqual(EXPECTED_CHANGED);
  });

  it('ForbiddenSuffixHistory_DuckDbFreeClaimFold_MatchesClassifiedAllowList', () => {
    // The DuckDB-free claim fold produces the figures the allow-list records; a
    // drift here means the ledger emit or the in-memory join changed the numbers
    // and the classification is stale.
    for (const expected of EXPECTED_DISCLOSURES) {
      const actual = duckDbFreeFold.disclosures.find(d => d.entry === expected.entry);
      expect(actual, `folded disclosure ${expected.entry}`).toBeDefined();
      expect({ distinct: actual?.distinctCount, rows: actual?.rowCount, duplicated: actual?.duplicates, added: actual?.added, removed: actual?.removed }, `${expected.entry} (${expected.reason})`)
        .toEqual({ distinct: expected.distinct, rows: expected.rows, duplicated: expected.duplicated, added: expected.added, removed: expected.removed });
    }
    expect(duckDbFreeFold.everForbiddenUnion.length).toBe(EXPECTED_UNION);
    expect(duckDbFreeFold.changedSuffixes).toEqual(EXPECTED_CHANGED);
  });

  it('ForbiddenSuffixHistory_DuckDbFreeClaimFold_AgreesWithCommittedGoldenFigures', () => {
    // The two read mechanisms fold the same ledger claims and must not drift: the
    // in-memory claim fold's per-disclosure distinct/row counts and union equal the
    // committed golden's (the DuckDB fold's). An inequality means the in-memory join
    // gained or lost observations the DuckDB pass did not — a mis-joined last-modified
    // claim or a dropped trim, not a routine regeneration.
    const foldByEntry = new Map(duckDbFreeFold.disclosures.map(d => [d.entry, d]));
    for (const golden of assertNonEmpty(committed.disclosures, 'committed golden disclosures')) {
      const folded = foldByEntry.get(golden.entry);
      expect(folded, `claim-fold disclosure ${golden.entry}`).toBeDefined();
      expect(folded?.distinctCount, `distinct for ${golden.entry}`).toBe(golden.distinct);
      expect(folded?.rowCount, `rows for ${golden.entry}`).toBe(golden.rows);
    }
    expect(duckDbFreeFold.everForbiddenUnion.length).toBe(committed.union);
  });
});

// The real-archive fold retirement gate: with the pinned DuckDB CLI present (CI
// always; a bare local checkout skips), materialising the forbidden ledger and
// folding it must reproduce the committed golden byte-for-byte. This is the
// proof the DuckDB FOLD — not a parse of the golden — produces the numbers, so the
// report retires the legacy normalised computation. The companion assertion pins
// the two read mechanisms to each other directly: the DuckDB fold and the
// DuckDB-free in-memory claim fold render identically (issue #444).
describe.skipIf(!duckDbAvailable())('forbidden-suffix history — real-archive fold retirement gate', { tags: ['data-validity'] }, () => {
  it('ForbiddenSuffixHistoryFold_RealArchive_ReproducesCommittedGolden', () => {
    const folded = renderForbiddenSuffixHistory(buildForbiddenSuffixHistoryFold());
    expect(folded).toBe(fs.readFileSync(path.resolve(process.cwd(), FORBIDDEN_SUFFIX_HISTORY_PATH), 'utf8'));
  }, 600_000);

  it('ForbiddenSuffixHistory_DuckDbAndDuckDbFreeFolds_RenderIdentically', () => {
    // The two read mechanisms over the same ledger claims — the DuckDB pass and the
    // in-memory claim join — must produce the exact same report. This is the
    // cross-mechanism equality that the retired fold-vs-normalised witness used to
    // triangulate, now asserted directly between the folds themselves.
    expect(renderForbiddenSuffixHistory(buildForbiddenSuffixHistory()))
      .toBe(renderForbiddenSuffixHistory(buildForbiddenSuffixHistoryFold()));
  }, 600_000);
});
