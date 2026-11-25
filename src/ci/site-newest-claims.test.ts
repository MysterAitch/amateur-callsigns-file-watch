import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { assertNonEmpty } from '../testing/non-vacuity.ts';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// A sentence that calls a hand-written date "the newest" (or "latest",
// "current", "newer") becomes false the day the next publication lands, and
// nothing prompts anyone to change it. After the 22 September 2026
// publication, pages, generator prose, a committed report and the hypothesis
// register went on treating 23 June 2026 as current. The first version of this
// guard read only site/*.html and site/v1/*.html for "newest"/"latest", and
// every one of those later instances slipped past it: one was in a .js file,
// one said "current", one said "newer", one was a generator's string literal,
// and one was a dataset pinned inside an example SQL query.
//
// What it cannot see: a sentence that names a vintage as if it were the whole
// set without any currency word ("the 2026-06-23 vintage asserts ..."), or a
// hand-written count of snapshots ("the nine open-data snapshots"). Those are
// fixed by deriving the prose or dating it; no wording pattern finds them.

// --- What a claim looks like -------------------------------------------------

const MONTH = '(?:January|February|March|April|May|June|July|August|September|October|November|December)';
const DATE = `(?:\\b\\d{1,2} ${MONTH} \\d{4}\\b|\\b\\d{4}-\\d{2}-\\d{2}\\b|\\b${MONTH} \\d{4}\\b)`;

// A currency word - also as the head of an identifier such as latestDateIso -
// then a date in a form the site, the reports or the docs use, within the same
// sentence and markup run.
const CURRENCY_WITH_A_DATE = new RegExp(`\\b(?:newest|latest|current|most recent|newer)\\w*\\b[^.<]{0,80}?${DATE}`, 'gi');

// A publication pinned by date inside a query. Such a query is about that one
// publication; where it is meant to be about whichever is newest it must say
// so in SQL rather than by date.
const PINNED_DATASET = /\bdataset\s*=\s*'\d{4}-\d{2}-\d{2}'/g;

// The narrower pattern this guard started with, kept so the constructed cases
// below show which shapes it let through.
const FIRST_VERSION_PATTERN = /\b(?:newest|latest)\b[^.<]{0,80}?(?:\b\d{1,2} (?:January|February|March|April|May|June|July|August|September|October|November|December) \d{4}\b|\b\d{4}-\d{2}-\d{2}\b)/gi;

// --- Where claims are looked for ----------------------------------------------

// Hand-written text may not pair a currency word with a date at all: whatever
// date it names, the next publication makes it wrong. Generated text writes
// the date in from the data, so there a claim must name the newest date the
// reports name (newestNamedInReports) - a generated sentence that names an
// older one is prose the generator hard-codes, the same fault one step removed.
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

// docs/narratives/ is not yet covered.
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
    name: 'committed reports',
    kind: 'generated',
    files: () => filesUnder('reports', (file) => file.endsWith('.md')),
  },
];

// --- Claims that are allowed, each with its reason ----------------------------

// Keyed by file and by the start of the claim, never by file alone: a whole
// file exempted would let its next stale sentence through unseen.
interface Allowed {
  file: string;
  claimStartsWith: string;
  reason: string;
}

const ALLOWED: Allowed[] = [
  {
    file: path.join('site', 'v1', 'index.html'),
    claimStartsWith: 'Most recent held as of',
    reason: 'the home page no-script baseline in committed source, which the home-baseline work on #1091 owns; revisit this exception whenever that work changes how the baseline is written',
  },
  {
    file: path.join('site', 'v1', 'index.html'),
    claimStartsWith: 'newest publication held (',
    reason: 'the home page no-script baseline, as above (#1091)',
  },
  {
    file: path.join('site', 'v1', 'home-sections.js'),
    claimStartsWith: "latestDateIso: '",
    reason: 'the home page figures used when the holdings manifest cannot be fetched; deriving them is tracked on #1091',
  },
  {
    file: path.join('site', 'v1', 'home-sections.js'),
    claimStartsWith: "latestMonthLabel: '",
    reason: 'the same fallback figures, as above (#1091)',
  },
  {
    file: path.join('site', 'callsign-structure.html'),
    claimStartsWith: 'current cycle of grants',
    reason: 'a statement about Ofcom grant validity, not about which publication is newest',
  },
  {
    file: path.join('site', 'v1', 'anatomy.html'),
    claimStartsWith: 'current cycle of grants',
    reason: 'a statement about Ofcom grant validity, not about which publication is newest',
  },
  {
    file: path.join('site', 'explore.html'),
    claimStartsWith: 'current register that were absent from the August 2019',
    reason: 'the date names the FOI snapshot the current register is compared against; the query selects the newest publication itself',
  },
  {
    file: path.join('site', 'explore.js'),
    claimStartsWith: "dataset = '",
    reason: 'the example is titled as one publication, not the newest, so pinning a date is what it says',
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

// --- The scan ---------------------------------------------------------------

interface Claim {
  file: string;
  claim: string;
}

function normaliseSpace(text: string): string {
  return text.replace(/\s+/g, ' ');
}

// The "Record as of" chip is rewritten by the build on every page that has
// one, so its date is not hand-maintained. A regular expression rather than a
// parse: this runs over committed source only, the chip's markup is fixed by
// the chip builder, and nothing here is rewritten or published.
function withoutBuildStampedChip(text: string): string {
  return text.replace(/<span class="chip asof"(?:"[^"]*"|[^">])*>.*?<\/span>/g, '');
}

// The rest of the sentence a claim starts, so a generated list such as
// "(2025-09-11, ..., 2026-09-22; ...)" is read whole.
function sentenceFrom(text: string, start: number): string {
  const end = text.slice(start).search(/[.<]|\n\s*\n/);
  return end === -1 ? text.slice(start) : text.slice(start, start + end);
}

function longFormDate(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  const name = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][month - 1];
  return `${day} ${name} ${year}`;
}

function claimsIn(text: string, kind: EstateKind, newestHeld: string): string[] {
  const offending: string[] = [];
  for (const m of text.matchAll(CURRENCY_WITH_A_DATE)) {
    if (kind === 'generated') {
      const sentence = sentenceFrom(text, m.index);
      if (sentence.includes(newestHeld) || sentence.includes(longFormDate(newestHeld))) continue;
    }
    offending.push(normaliseSpace(m[0]));
  }
  if (kind === 'hand-written') {
    for (const m of text.matchAll(PINNED_DATASET)) offending.push(normaliseSpace(m[0]));
  }
  return offending;
}

// The newest date any committed report names in a currency claim. Reports are
// anchored to each other rather than to the archive: a publication lands in
// archive/ before the scheduled report sweep regenerates reports/, so an
// archive anchor would fail every landing pull request on a question the
// golden-master drift job already owns. What this guard asks is narrower -
// whether one report's currency sentence names an older date than another's,
// which is the sign of prose the generator hard-codes.
function newestNamedInReports(): string {
  const reports = assertNonEmpty(ESTATES.filter((e) => e.kind === 'generated').flatMap((e) => e.files()), 'committed reports');
  let newest = '';
  for (const file of reports) {
    const text = fs.readFileSync(file, 'utf8');
    for (const m of text.matchAll(CURRENCY_WITH_A_DATE)) {
      if (isAllowed({ file, claim: normaliseSpace(m[0]) })) continue;
      for (const iso of sentenceFrom(text, m.index).match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? []) {
        if (iso > newest) newest = iso;
      }
    }
  }
  expect(newest, 'no report names a newest publication, so the generated-report rule has nothing to compare against').not.toBe('');
  return newest;
}

function claimsInEstate(estate: Estate, newestHeld: string): Claim[] {
  return assertNonEmpty(estate.files(), `files in ${estate.name}`)
    .flatMap((file) => claimsIn(withoutBuildStampedChip(fs.readFileSync(file, 'utf8')), estate.kind, newestHeld).map((claim) => ({ file, claim })));
}

function isAllowed(found: Claim): boolean {
  return ALLOWED.some((a) => a.file === found.file && found.claim.startsWith(a.claimStartsWith));
}

// --- The guard ----------------------------------------------------------------

describe('hand-written "newest" claims across the site, generators, reports and hypothesis register', { tags: ['unit'] }, () => {
  it('EveryCoveredEstate_OutsideTheAllowedClaims_NeverPairsACurrencyWordWithAStaleDate', () => {
    const newestHeld = newestNamedInReports();
    const offenders = ESTATES
      .flatMap((estate) => claimsInEstate(estate, newestHeld))
      .filter((found) => !isAllowed(found))
      .map((found) => `${found.file}: ${found.claim}`);

    expect(offenders).toEqual([]);
  });

  it('AllowedClaims_StillPresent_SoAnExceptionIsNotLeftBehindOnceFixed', () => {
    const newestHeld = newestNamedInReports();
    const found = ESTATES.flatMap((estate) => claimsInEstate(estate, newestHeld));
    for (const allowed of ALLOWED) {
      const stillThere = found.some((f) => f.file === allowed.file && f.claim.startsWith(allowed.claimStartsWith));
      expect(stillThere, `${allowed.file}: "${allowed.claimStartsWith}" no longer needs its exception - remove it from ALLOWED`).toBe(true);
    }
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
  const NEWEST = '2026-09-22';

  // Each case: the text, the estate kind it is read as, how many claims the
  // first version of the guard found in it, and how many this one must find.
  const CASES: { name: string; text: string; kind: EstateKind; firstVersion: number; now: number }[] = [
    {
      name: 'an example query labelled "current register" with its dataset pinned by date',
      text: "forbidden-suffix callsigns in the current register that were absent\n<pre><code>SELECT rh.callsign FROM register_history rh\nWHERE rh.dataset = '2026-06-23'</code></pre>",
      kind: 'hand-written',
      firstVersion: 0,
      now: 1,
    },
    {
      name: 'a generator string literal saying "newer" before a list of dates',
      text: "'The ceiling is NOT the newest snapshot held. Four newer full exports',\n    '(2025-09-11, 2025-11-11, 2026-01-14, 2026-06-23; 146k–160k subjects each)',",
      kind: 'hand-written',
      firstVersion: 0,
      now: 1,
    },
    {
      name: 'a markdown sentence calling a dated publication "current"',
      text: 'sources, including 100 rows of the current `2026-06-23` publication, whereas',
      kind: 'hand-written',
      firstVersion: 0,
      now: 1,
    },
    {
      name: 'a script constant whose identifier starts with "latest"',
      text: "  latestDateIso: '2026-06-23',\n  latestMonthLabel: 'June 2026',",
      kind: 'hand-written',
      firstVersion: 0,
      now: 2,
    },
    {
      name: 'a hand-written page naming the newest date in a sentence',
      text: 'The newest publication held (2026-06-23) records 158,318 callsigns',
      kind: 'hand-written',
      firstVersion: 1,
      now: 1,
    },
    {
      name: 'a hand-written page naming a dated snapshot without calling it newest',
      text: 'derived from the held register snapshot dated 23 June 2026 with this site',
      kind: 'hand-written',
      firstVersion: 0,
      now: 0,
    },
    {
      name: 'a generated report listing newer exports that stops short of the newest',
      text: 'Four newer full exports\n(2025-09-11, 2025-11-11, 2026-01-14, 2026-06-23; 146k–160k subjects each)\nare absent because',
      kind: 'generated',
      firstVersion: 0,
      now: 1,
    },
    {
      name: 'a generated report listing newer exports that reaches the newest',
      text: 'Five newer full exports\n(2025-09-11, 2025-11-11, 2026-01-14, 2026-06-23, 2026-09-22; 146,000–163,000 subjects each)\nare absent because',
      kind: 'generated',
      firstVersion: 0,
      now: 0,
    },
    {
      name: 'a generated report naming the newest publication by its long-form date',
      text: 'the latest register, 22 September 2026, carries',
      kind: 'generated',
      firstVersion: 1,
      now: 0,
    },
  ];

  for (const c of CASES) {
    it(`ConstructedSentence_${c.name.replace(/[^A-Za-z0-9]+/g, '_')}_FoundTheDecidedNumberOfTimes`, () => {
      expect([...c.text.matchAll(FIRST_VERSION_PATTERN)].length, 'first version').toBe(c.firstVersion);
      expect(claimsIn(c.text, c.kind, NEWEST).length, 'this guard').toBe(c.now);
    });
  }

  it('GeneratedReport_WhenTheNextPublicationLands_TheFormerNewestBecomesAnOffence', () => {
    const text = 'the latest register (`2026-09-22`) carries 163,342 rows';
    expect(claimsIn(text, 'generated', '2026-09-22')).toEqual([]);
    expect(claimsIn(text, 'generated', '2026-12-15')).toHaveLength(1);
  });

  it('BuildStampedChip_WhenStripped_TakesItsHandWrittenTitleWithIt', () => {
    const chip = '<span class="chip asof" title="the newest publication held is dated 23 June 2026">Record as of 23 June 2026</span>';
    expect(claimsIn(chip, 'hand-written', NEWEST)).toHaveLength(1);
    expect(claimsIn(withoutBuildStampedChip(chip), 'hand-written', NEWEST)).toEqual([]);
  });
});
