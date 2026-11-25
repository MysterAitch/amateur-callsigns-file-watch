import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { assertNonEmpty } from '../testing/non-vacuity.ts';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// WHAT THIS GUARD IS FOR. A sentence that pairs "newest", "latest",
// "current", "newer" or "most recent" with a hand-written date becomes false
// the day the next publication lands, and nothing prompts anyone to change it.
// When it fires, do one of three things, in this order of preference: derive
// the value from the data (a query, a manifest, a generator); or date the
// statement so it is true forever ("the newest held when this was verified,
// 2026-07-29"); or, if the sentence is not about which publication is newest,
// add a reasoned exception to ALLOWED below. It is a wording heuristic with
// named limits (listed under BLIND SPOTS), not a proof that no stale claim
// remains.
//
// Why it is as wide as it is: after the 22 September 2026 publication, pages,
// generator prose, a committed report, a code comment and the hypothesis
// register went on treating 23 June 2026 as current. The first version read
// only site/*.html and site/v1/*.html for "newest"/"latest", and every one of
// those slipped past it: one was in a .js file, one said "current", one said
// "newer", one was a generator's string literal, one was a dataset pinned in an
// example query, and one was missed only on a Windows checkout because each
// carriage return counted against the distance to the date.
//
// BLIND SPOTS - shapes it does not find, each pinned by a constructed case
// below so a change in coverage is visible:
// - the date before the word ("The 2026-06-23 publication is the newest
//   held"), for the reason given at WORD_THEN_DATE;
// - a date in the next sentence ("This is the current register. It was
//   published on 2026-06-23.");
// - more than 80 characters between the word and the date;
// - a year alone ("the latest year held is 2026");
// - synonyms: "last", "up to date", "as of today", "now", "freshest";
// - a hand-written count ("the nine open-data snapshots") or a vintage named
//   as if it were the whole set with no currency word at all.
// And sentences it flags that are not about publications (kept, because
// telling them apart needs meaning, not wording): "its current status was
// first recorded on ...", "the current implementation replaced ... on ...",
// "the latest terms took effect in ...".

// --- What a claim looks like -------------------------------------------------

const MONTHS = 'January|February|March|April|May|June|July|August|September|October|November|December';
const MON = 'Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec';
const MONTH_NUMBER: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

// Every date form the site, reports, docs or code use or could plausibly use.
const DATE = [
  String.raw`\d{1,2}(?:st|nd|rd|th)? (?:${MONTHS}|${MON})\.? \d{4}`,
  String.raw`(?:${MONTHS}|${MON})\.? \d{1,2}(?:st|nd|rd|th)?, \d{4}`,
  String.raw`(?:${MONTHS}|${MON}) \d{4}`,
  String.raw`\d{4}-\d{2}-\d{2}(?!\d)`,
  String.raw`\d{4}-\d{2}(?![\d-])`,
  String.raw`\d{1,2}/\d{1,2}/\d{4}`,
].map((form) => `(?<!\\w)${form}`).join('|');

// A currency word, also as the head of an identifier (latestDateIso,
// NEWEST_DATE) but not as an ordinary longer word ("currently").
const WORD = String.raw`\b(?:[Nn]ewest|NEWEST|[Ll]atest|LATEST|[Cc]urrent|CURRENT|[Nn]ewer|NEWER|[Mm]ost[- ]recent|MOST[-_ ]RECENT)(?:[A-Z_][A-Za-z0-9_]*)?\b`;

// A sentence ends at a full stop followed by a capital (or a markdown opener
// such as ` * [ that a sentence can start with) or by the end of the line, or
// at a blank line. A full stop inside an abbreviation, a decimal, a file name
// or a property access does not end it.
const SENTENCE_END = String.raw`\.(?=\s+[A-Z\x60*\[])|\.(?=[ \t]*(?:\n|$))|\n[ \t]*\n`;
const REACH = String.raw`(?:(?!${SENTENCE_END})[\s\S]){0,80}?`;

// Only the word-then-date order is looked for. A date-then-word matcher
// ("The 2026-06-23 publication is the newest held") was tried: even confined
// to one line and skipping sentences with a dated marker, all six of its hits
// in the covered estate were correct dated statements ("plus 2026-06-23, the
// newest of the nine" after "when this account was written"; an incident note
// "naming 23 June 2026 as the newest publication held"), and none was stale.
// The shape is a named blind spot instead.
const WORD_THEN_DATE = new RegExp(`(${WORD})(${REACH})(${DATE})`, 'g');

// A publication pinned by date in query or filter text: such a query is about
// that one publication, so where it means whichever is newest it must say so in
// the query rather than by date.
const PINNED_DATASET = /\bdataset\s*(?:={1,3}|!==?|[<>]=?|\bIN\s*\(|:)\s*['"`]\d{4}-\d{2}(?:-\d{2})?['"`]/gi;

// Cheaply told apart from a claim that a date is the newest:
// - a comparison with the date ("newer than 2025-06-04", "since 14 May 2021",
//   "valid until 31 December 2029", or an operator: d > '2025-06-04');
const COMPARISON_BEFORE_DATE = /(?:\b(?:than|since|until|before|after)\s+|(?:[<>]=?|[=!]==?)\s*)['"`(]?$/i;
// - a sort order ("newest first: 2026-09-22, 2026-06-23, ...");
const SORT_ORDER_AFTER_WORD = /^[\s-]*first\b/i;
// - a statement dated by its own wording ("the newest held when this was
//   verified (2026-07-29)").
const DATED_MARKER = /\b(?:when|at the time|then)\b/i;

// The narrower pattern this guard started with, kept so the constructed cases
// below show which shapes it let through.
const FIRST_VERSION_PATTERN = new RegExp(`\\b(?:newest|latest)\\b[^.<]{0,80}?(?:\\b\\d{1,2} (?:${MONTHS}) \\d{4}\\b|\\b\\d{4}-\\d{2}-\\d{2}\\b)`, 'gi');

// --- Where claims are looked for ----------------------------------------------

// Hand-written text may not pair a currency word with a date at all: whatever
// date it names, the next publication makes it wrong. Generated text writes
// the date in from the data, so there the date a claim names must be the
// newest any report claims (newestClaimedInReports) - a generated sentence
// that names an older one is prose the generator hard-codes.
type EstateKind = 'hand-written' | 'generated';

interface Estate {
  name: string;
  kind: EstateKind;
  files: () => string[];
}

function filesUnder(dir: string, keep: (file: string) => boolean): string[] {
  return fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? filesUnder(full, keep) : keep(full) ? [full] : [];
    })
    .sort();
}

const isTest = (file: string): boolean => /\.test\.[cm]?[jt]s$/.test(file);

const ESTATES: Estate[] = [
  {
    name: 'site pages and scripts',
    kind: 'hand-written',
    files: () => filesUnder('site', (file) => /\.(?:html|js)$/.test(file) && !isTest(file)),
  },
  {
    name: 'report and page generators',
    kind: 'hand-written',
    files: () => filesUnder(path.join('src', 'ci'), (file) => file.endsWith('.ts') && !isTest(file)),
  },
  {
    name: 'hypothesis register',
    kind: 'hand-written',
    files: () => [path.join('docs', 'hypothesis-register.md')],
  },
  {
    name: 'narratives',
    kind: 'hand-written',
    files: () => filesUnder(path.join('docs', 'narratives'), (file) => file.endsWith('.md')),
  },
  {
    name: 'committed reports',
    kind: 'generated',
    files: () => filesUnder('reports', (file) => file.endsWith('.md')),
  },
];

// --- Claims that are allowed, each with its reason ----------------------------

// Keyed by file and by the start of the claim, never by file alone: a whole
// file exempted would let its next stale sentence through unseen. Where the
// claim text alone is not specific, lineIncludes narrows it to one line.
interface Allowed {
  file: string;
  claimStartsWith: string;
  lineIncludes?: string;
  reason: string;
}

const ALLOWED: Allowed[] = [
  {
    file: path.join('site', 'v1', 'home-sections.js'),
    claimStartsWith: "latestDateIso: '",
    reason: 'a committed default: the deploy overwrites the home page baseline from the holdings manifest, and with scripts on the page replaces these figures from the same manifest',
  },
  {
    file: path.join('site', 'v1', 'home-sections.js'),
    claimStartsWith: "latestMonthLabel: '",
    reason: 'the same committed default, as above',
  },
  {
    file: path.join('site', 'explore.html'),
    claimStartsWith: 'current register that were absent from the August 2019',
    reason: 'the date names the FOI snapshot the current register is compared against; the query selects the newest complete publication itself',
  },
  {
    file: path.join('site', 'explore.js'),
    claimStartsWith: "dataset = '",
    lineIncludes: 'Licence-category mix in one publication',
    reason: 'the example is titled as one publication, not the newest, so pinning a date is what it says',
  },
  {
    file: path.join('src', 'ci', 'reprocessing-stratification.ts'),
    claimStartsWith: 'newer Foundation-era series',
    reason: '"newer" describes the callsign series, and 2024-10 names a reprocessing cohort, not a publication called the newest',
  },
  {
    file: path.join('reports', 'state-at-t.md'),
    claimStartsWith: 'latest on or before t:',
    reason: 'the bounding assertion for the query date t, not a statement about publications',
  },
  {
    file: path.join('reports', 'sequence-analytics.md'),
    claimStartsWith: 'latest allocation day',
    reason: 'the newest allocation date found in the data, not a statement about which publication is newest',
  },
];

// --- Reading a file -----------------------------------------------------------

function normaliseSpace(text: string): string {
  return text.replace(/\s+/g, ' ');
}

// Regular expressions over markup, deliberately: this runs over committed
// source only, the chip and region markers are fixed by their builders, and
// nothing here is rewritten or published.
//
// The "Record as of" chip is rewritten by the build on every page that has one.
function withoutBuildStampedChip(text: string): string {
  return text.replace(/<span class="chip asof"(?:"[^"]*"|[^">])*>.*?<\/span>/g, '');
}

// Regions between <!-- v1-<name>-static: ... --> and <!-- /v1-<name>-static -->
// are replaced at deploy by a render from the data (src/ci/static-region.ts),
// so what the committed copy says there is not what a reader receives.
function withoutBuildStampedRegions(text: string): string {
  let out = '';
  let from = 0;
  const opening = /<!-- (v1-[a-z0-9-]+-static):[^>]*-->/g;
  for (let m = opening.exec(text); m !== null; m = opening.exec(text)) {
    if (m.index < from) continue;
    const closing = `<!-- /${m[1]} -->`;
    const close = text.indexOf(closing, m.index);
    if (close === -1) break;
    out += text.slice(from, m.index);
    from = close + closing.length;
    opening.lastIndex = from;
  }
  return out + text.slice(from);
}

// Markup between a word and its date ("latest snapshot</div><div>2026-06-23")
// is read through, so tags are replaced by a space.
function withoutTags(text: string): string {
  return text.replace(/<[^>]*>/g, ' ');
}

type Format = 'html' | 'text';

function prepared(raw: string, format: Format): string {
  const text = raw.replace(/\r\n/g, '\n');
  return format === 'html' ? withoutTags(withoutBuildStampedRegions(withoutBuildStampedChip(text))) : text;
}

function readPrepared(file: string): string {
  return prepared(fs.readFileSync(file, 'utf8'), file.endsWith('.html') ? 'html' : 'text');
}

// --- The scan ---------------------------------------------------------------

interface Found {
  claim: string;
  line: string;
  // The ISO form of the date the claim names (for a comma-separated run of
  // dates, the newest of the run), used for generated reports.
  claimedIso: string;
}

function toIso(date: string): string {
  const iso = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(date);
  if (iso !== null) return iso[3] === undefined ? `${iso[1]}-${iso[2]}` : `${iso[1]}-${iso[2]}-${iso[3]}`;
  const slashed = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(date);
  if (slashed !== null) return `${slashed[3]}-${slashed[2].padStart(2, '0')}-${slashed[1].padStart(2, '0')}`;
  const month = /[A-Za-z]{3}/.exec(date)?.[0].toLowerCase() ?? '';
  const year = /\d{4}/.exec(date)?.[0] ?? '';
  const day = /\b(\d{1,2})(?:st|nd|rd|th)?\b(?!\d)/.exec(date.replace(year, ''))?.[1];
  const mm = MONTH_NUMBER[month] ?? '00';
  return day === undefined ? `${year}-${mm}` : `${year}-${mm}-${day.padStart(2, '0')}`;
}

// A list such as "(2025-09-11, 2025-11-11, 2026-09-22;" names its newest last.
function newestOfRun(text: string, afterDate: number, firstIso: string): string {
  let newest = firstIso;
  const run = /^`?\s*,\s*`?(\d{4}-\d{2}-\d{2})/;
  let rest = text.slice(afterDate);
  for (let m = run.exec(rest); m !== null; m = run.exec(rest)) {
    if (m[1] > newest) newest = m[1];
    rest = rest.slice(m[0].length);
  }
  return newest;
}

function lineAt(text: string, index: number): string {
  const start = text.lastIndexOf('\n', index) + 1;
  const end = text.indexOf('\n', index);
  return text.slice(start, end === -1 ? text.length : end);
}

const ANY_WORD = new RegExp(WORD, 'g');

function currencyClaims(text: string): Found[] {
  const found: Found[] = [];
  for (const m of text.matchAll(WORD_THEN_DATE)) {
    const [whole, word, , date] = m;
    // Where several currency words precede one date ("latestDateLabel: ...,
    // latestMonthLabel: 'June 2026'"), the claim is the nearest one's.
    const afterFirst = whole.slice(word.length, whole.length - date.length);
    const later = [...afterFirst.matchAll(ANY_WORD)].at(-1);
    const start = later === undefined ? 0 : word.length + (later.index ?? 0);
    const nearestWord = later === undefined ? word : later[0];
    const between = whole.slice(start + nearestWord.length, whole.length - date.length);
    if (COMPARISON_BEFORE_DATE.test(between)) continue;
    if (SORT_ORDER_AFTER_WORD.test(between)) continue;
    if (DATED_MARKER.test(between)) continue;
    const dateEnd = m.index + whole.length;
    found.push({ claim: normaliseSpace(whole.slice(start)), line: lineAt(text, m.index + start), claimedIso: newestOfRun(text, dateEnd, toIso(date)) });
  }
  return found;
}

function pinnedDatasets(text: string): Found[] {
  return [...text.matchAll(PINNED_DATASET)].map((m) => ({ claim: normaliseSpace(m[0]), line: lineAt(text, m.index), claimedIso: '' }));
}

// Every claim in prepared text. For hand-written text each one is an offence
// (pins included); for generated text a currency claim is one only if the date
// it names is older than the anchor.
function claimsIn(text: string, kind: EstateKind, anchor: string): Found[] {
  if (kind === 'generated') return currencyClaims(text).filter((f) => f.claimedIso < anchor);
  return [...currencyClaims(text), ...pinnedDatasets(text)];
}

interface Claim extends Found {
  file: string;
}

function isAllowed(found: Claim): boolean {
  return ALLOWED.some((a) => a.file === found.file && found.claim.startsWith(a.claimStartsWith) && (a.lineIncludes === undefined || found.line.includes(a.lineIncludes)));
}

// The newest date any committed report claims as newest. Reports are anchored
// to each other rather than to archive/: a publication lands there before the
// scheduled report sweep regenerates reports/, so an archive anchor would fail
// every landing pull request on a question the golden-master drift job already
// owns. What this asks is narrower - whether one report's currency sentence
// names an older date than another's, the sign of prose a generator hard-codes.
function newestClaimedInReports(): string {
  const reports = assertNonEmpty(ESTATES.filter((e) => e.kind === 'generated').flatMap((e) => e.files()), 'committed reports');
  let newest = '';
  for (const file of reports) {
    for (const f of currencyClaims(readPrepared(file))) {
      if (!isAllowed({ ...f, file }) && f.claimedIso > newest) newest = f.claimedIso;
    }
  }
  expect(newest, 'no report names a newest publication, so the generated-report rule has nothing to compare against').not.toBe('');
  return newest;
}

function claimsInEstate(estate: Estate, anchor: string): Claim[] {
  return assertNonEmpty(estate.files(), `files in ${estate.name}`)
    .flatMap((file) => claimsIn(readPrepared(file), estate.kind, anchor).map((f) => ({ ...f, file })));
}

// Every claim, allowed or not, so exceptions can be checked for staleness.
function everyClaim(anchor: string): Claim[] {
  return ESTATES.flatMap((estate) => assertNonEmpty(estate.files(), `files in ${estate.name}`).flatMap((file) => {
    const text = readPrepared(file);
    const all = estate.kind === 'generated' ? currencyClaims(text) : claimsIn(text, estate.kind, anchor);
    return all.map((f) => ({ ...f, file }));
  }));
}

// --- The guard ----------------------------------------------------------------

describe('hand-written "newest" claims across the site, generators, docs and reports', { tags: ['unit'] }, () => {
  it('EveryCoveredEstate_OutsideTheAllowedClaims_NeverPairsACurrencyWordWithAStaleDate', () => {
    const anchor = newestClaimedInReports();
    const offenders = ESTATES
      .flatMap((estate) => claimsInEstate(estate, anchor))
      .filter((found) => !isAllowed(found))
      .map((found) => `${found.file}: ${found.claim}`);

    expect(offenders).toEqual([]);
  });

  it('AllowedClaims_StillPresent_SoAnExceptionIsNotLeftBehindOnceFixed', () => {
    const found = everyClaim(newestClaimedInReports());
    const stale = ALLOWED
      .filter((a) => !found.some((f) => isAllowed(f) && f.file === a.file && f.claim.startsWith(a.claimStartsWith) && (a.lineIncludes === undefined || f.line.includes(a.lineIncludes))))
      .map((a) => `${a.file}: "${a.claimStartsWith}" no longer needs its exception - remove it from ALLOWED`);
    expect(stale).toEqual([]);
  });

  it('EveryEstate_IsActuallyScanned_WithFilesToRead', () => {
    for (const estate of ESTATES) {
      expect(estate.files().length, estate.name).toBeGreaterThan(0);
    }
    expect(ESTATES.find((e) => e.name === 'site pages and scripts')?.files().some((f) => f.endsWith('.js'))).toBe(true);
  });
});

// --- The shapes it exists for, with their answers decided beforehand ------------

describe('newest-claim guard - constructed sentences', { tags: ['unit'] }, () => {
  const ANCHOR = '2026-09-22';
  const H: EstateKind = 'hand-written';
  const G: EstateKind = 'generated';

  // Each case: the text, how it is read, how many claims the first version of
  // the guard found (null where not recorded), and how many this one must find.
  // A 0 on a stale sentence is a named blind spot; a 1 on an ordinary one is a
  // named false positive. Both are listed in the file header.
  const CASES: { name: string; text: string; kind: EstateKind; format?: Format; firstVersion?: number; now: number }[] = [
    // The shapes the first version missed in the real estate.
    { name: 'an example query labelled current register with its dataset pinned by date', text: "forbidden-suffix callsigns in the current register that were absent\n<pre><code>SELECT rh.callsign FROM register_history rh\nWHERE rh.dataset = '2026-06-23'</code></pre>", kind: H, firstVersion: 0, now: 1 },
    { name: 'a generator string literal saying newer before a list of dates', text: "'The ceiling is NOT the newest snapshot held. Four newer full exports',\n    '(2025-09-11, 2025-11-11, 2026-01-14, 2026-06-23; 146k–160k subjects each)',", kind: H, firstVersion: 0, now: 1 },
    { name: 'a markdown sentence calling a dated publication current', text: 'sources, including 100 rows of the current `2026-06-23` publication, whereas', kind: H, firstVersion: 0, now: 1 },
    { name: 'script constants whose identifiers start with latest', text: "  latestDateIso: '2026-06-23',\n  latestMonthLabel: 'June 2026',", kind: H, firstVersion: 0, now: 2 },
    { name: 'a hand-written page naming the newest date in a sentence', text: 'The newest publication held (2026-06-23) records 158,318 callsigns', kind: H, firstVersion: 1, now: 1 },
    { name: 'a generated report listing newer exports that stops short of the newest', text: 'Four newer full exports\n(2025-09-11, 2025-11-11, 2026-01-14, 2026-06-23; 146k–160k subjects each)\nare absent because', kind: G, firstVersion: 0, now: 1 },
    { name: 'a generated report listing newer exports that reaches the newest', text: 'Five newer snapshots\nof at least 10,000 subjects (2025-09-11, 2025-11-11, 2026-01-14, 2026-06-23, 2026-09-22; 146,169–163,198 subjects each)\nare absent because', kind: G, firstVersion: 0, now: 0 },
    { name: 'a generated report naming the newest publication by its long-form date', text: 'the latest register, 22 September 2026, carries', kind: G, firstVersion: 1, now: 0 },
    // Closed here (review cases).
    { name: 'tag between word and date', text: '<div class="k">latest snapshot</div><div class="v">2026-06-23</div>', kind: H, format: 'html', firstVersion: 0, now: 1 },
    { name: 'emphasis tag before date', text: 'the newest publication, <strong>23 June 2026</strong>, holds', kind: H, format: 'html', firstVersion: 0, now: 1 },
    { name: 'full stop inside the reach, abbreviation', text: 'the latest register (approx. 158k rows, 2026-06-23) holds', kind: H, firstVersion: 0, now: 1 },
    { name: 'full stop inside the reach, filename', text: 'the newest entry, archive/2026-06-23/raw.csv, holds', kind: H, now: 1 },
    { name: 'full stop inside the reach, decimal', text: 'the current register is 3.1% larger, as of 2026-06-23', kind: H, now: 1 },
    { name: 'JS property access compared with a pinned dataset', text: "if (latest.dataset === '2026-06-23') render();", kind: H, now: 1 },
    { name: 'pinned with triple equals', text: "rows.filter(r => r.dataset === '2026-06-23')", kind: H, now: 1 },
    { name: 'pinned as object key', text: "{ dataset: '2026-06-23' }", kind: H, now: 1 },
    { name: 'pinned with double quotes', text: 'WHERE dataset = "2026-06-23"', kind: H, now: 1 },
    { name: 'pinned with IN', text: "WHERE dataset IN ('2026-06-23')", kind: H, now: 1 },
    { name: 'pinned with greater-or-equal', text: "WHERE dataset >= '2026-06-23'", kind: H, now: 1 },
    { name: 'abbreviated month', text: 'the newest publication (23 Jun 2026) holds', kind: H, now: 1 },
    { name: 'ordinal day', text: 'the newest publication (23rd June 2026) holds', kind: H, now: 1 },
    { name: 'US order', text: 'the newest publication (June 23, 2026) holds', kind: H, now: 1 },
    { name: 'slashed date', text: 'the latest register, 23/06/2026, holds', kind: H, now: 1 },
    { name: 'ISO timestamp', text: "latestFetchedAt: '2026-06-23T09:00:00Z'", kind: H, now: 1 },
    { name: 'month-only ISO key', text: 'the newest publication (2026-06) holds', kind: H, now: 1 },
    { name: 'hyphenated most-recent', text: 'the most-recent publication (2026-06-23) holds', kind: H, now: 1 },
    { name: 'template literal split over lines', text: "const note = `the newest publication held`\n  + ` is ${'2026-06-23'}`;", kind: H, now: 1 },
    { name: 'string concatenation with a dotted call between', text: "'the latest snapshot ' + fmt.date('2026-06-23')", kind: H, now: 1 },
    { name: 'a claim spanning comment lines with Windows line endings', text: ' * does not fire against the current\r\n * (very small, ~9-dataset) held corpus: one neighbour in the same window\r\n * (2025-06-04) is itself', kind: H, now: 1 },
    { name: 'generated stale date with the newest elsewhere in the sentence', text: 'the latest register (`2026-06-23`) is compared with 2026-09-22 below', kind: G, now: 1 },
    // Named blind spots.
    { name: 'BLIND SPOT date before the word', text: 'The 2026-06-23 publication is the newest held.', kind: H, now: 0 },
    { name: 'BLIND SPOT date before the word, long form', text: '23 June 2026 is the most recent publication.', kind: H, now: 0 },
    { name: 'BLIND SPOT generated date before the word', text: '`2026-06-23` is the latest register', kind: G, now: 0 },
    { name: 'BLIND SPOT date in the next sentence', text: 'This is the current register. It was published on 2026-06-23.', kind: H, now: 0 },
    { name: 'BLIND SPOT more than 80 characters between', text: 'the newest publication that this archive holds, counting every open-data release and every disclosure, is dated 2026-06-23', kind: H, now: 0 },
    { name: 'BLIND SPOT year only', text: 'the latest year held is 2026', kind: H, now: 0 },
    { name: 'BLIND SPOT synonym last', text: 'the last publication held (2026-06-23) records', kind: H, now: 0 },
    { name: 'BLIND SPOT synonym up to date', text: 'the register is up to date as of 23 June 2026', kind: H, now: 0 },
    { name: 'BLIND SPOT synonym as of today', text: 'as of today the register (2026-06-23) holds 158,318', kind: H, now: 0 },
    { name: 'BLIND SPOT synonym now', text: 'the register now held is dated 2026-06-23', kind: H, now: 0 },
    { name: 'BLIND SPOT synonym freshest', text: 'the freshest snapshot (2026-06-23) holds', kind: H, now: 0 },
    { name: 'BLIND SPOT hand-written count', text: 'across the nine open-data snapshots', kind: H, now: 0 },
    // Ordinary sentences: not flagged.
    { name: 'currently with an unrelated date', text: 'Ofcom currently requires revalidation; the rule changed on 21 February 2024', kind: H, now: 0 },
    { name: 'identifier compared with a fixture date', text: "const currentRow = rows.find(r => r.start === '2019-08-01');", kind: H, now: 0 },
    { name: 'sort description', text: '// newest first: 2026-09-22, 2026-06-23, 2026-01-14', kind: H, now: 0 },
    { name: 'dated statement', text: 'the newest held when this was verified (2026-07-29)', kind: H, now: 0 },
    { name: 'dated statement with the date first', text: '100 rows of the `2026-06-23` publication (the newest held when this was verified, 2026-07-29)', kind: H, now: 0 },
    { name: 'callsign page copy', text: 'Current holder since 14 May 2021', kind: H, now: 0 },
    { name: 'newer-than comparison', text: 'publications newer than 2025-06-04 carry no touch signal', kind: H, now: 0 },
    { name: 'identifier compared with an operator', text: "const newerThanCeiling = (d) => d > '2025-06-04';", kind: H, now: 0 },
    { name: 'grant validity', text: 'the current cycle of grants is valid until 31 December 2029', kind: H, now: 0 },
    { name: 'a dated snapshot without a currency word', text: 'derived from the held register snapshot dated 23 June 2026 with this site', kind: H, firstVersion: 0, now: 0 },
    // Named false positives.
    { name: 'FALSE POSITIVE current state of a licence', text: 'its current status was first recorded on 12 March 2019', kind: H, now: 1 },
    { name: 'FALSE POSITIVE dev comment with a dated decision', text: '// the current implementation replaced the worker on 2026-08-01', kind: H, now: 1 },
    { name: 'FALSE POSITIVE licence terms', text: 'The latest terms took effect in February 2024', kind: H, now: 1 },
  ];

  for (const c of CASES) {
    it(`ConstructedSentence_${c.name.replace(/[^A-Za-z0-9]+/g, '_')}_FoundTheDecidedNumberOfTimes`, () => {
      if (c.firstVersion !== undefined) {
        expect([...c.text.matchAll(FIRST_VERSION_PATTERN)].length, 'first version').toBe(c.firstVersion);
      }
      expect(claimsIn(prepared(c.text, c.format ?? 'text'), c.kind, ANCHOR).length, 'this guard').toBe(c.now);
    });
  }

  it('GeneratedReport_WhenTheNextPublicationLands_TheFormerNewestBecomesAnOffence', () => {
    const text = 'the latest register (`2026-09-22`) carries 163,342 rows';
    expect(claimsIn(text, 'generated', '2026-09-22')).toEqual([]);
    expect(claimsIn(text, 'generated', '2026-12-15')).toHaveLength(1);
  });

  it('BuildStampedChip_WhenStripped_TakesItsHandWrittenTitleWithIt', () => {
    const chip = '<span class="chip asof" title="the newest publication held is dated 23 June 2026">Record as of 23 June 2026</span>';
    expect(claimsIn(prepared(chip, 'text'), 'hand-written', ANCHOR)).toHaveLength(1);
    expect(claimsIn(prepared(chip, 'html'), 'hand-written', ANCHOR)).toEqual([]);
  });

  it('BuildStampedRegion_WhenStripped_IsNotReadButTheTextAroundItIs', () => {
    const page = 'before, the newest publication (2026-06-23)\n<!-- v1-home-static: at-a-glance -->\n<div>latest snapshot</div><div>2026-06-23</div>\n<!-- /v1-home-static -->\nafter';
    expect(claimsIn(prepared(page, 'html'), 'hand-written', ANCHOR).map((f) => f.claim)).toEqual(['newest publication (2026-06-23']);
  });

  it('BuildStampedRegion_WithNoClosingMarker_IsReadRatherThanSwallowingTheRest', () => {
    const page = '<!-- v1-home-static: at-a-glance -->\n<div>latest snapshot</div><div>2026-06-23</div>';
    expect(claimsIn(prepared(page, 'html'), 'hand-written', ANCHOR)).toHaveLength(1);
  });
});
