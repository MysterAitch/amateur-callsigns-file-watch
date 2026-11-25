import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// A page that calls a hand-written date "the newest" becomes false the day the
// next publication lands, and nothing prompts anyone to change it. After the
// 22 September 2026 publication, two pages went on naming 23 June 2026 as the
// newest held. A page may name a dated snapshot ("the snapshot dated ..."), or
// it may say "newest" where the build writes the date in - not both by hand.

const PAGE_DIRS = [path.join('site'), path.join('site', 'v1')];

// "newest" or "latest", then a hand-written date in either form the site
// uses, within the same sentence and markup run.
const NEWEST_WITH_A_DATE = /\b(?:newest|latest)\b[^.<]{0,80}?(?:\b\d{1,2} (?:January|February|March|April|May|June|July|August|September|October|November|December) \d{4}\b|\b\d{4}-\d{2}-\d{2}\b)/gi;

// Pages allowed to carry such a sentence in the committed source, each with
// the reason. The deploy rewrites nothing in these sentences.
const KNOWN: Record<string, string> = {
  // The home page's no-script baseline is hand-written and mirrors the script's
  // defaults; with scripts on it is replaced from the build's holdings
  // manifest. Generating the baseline at build time is tracked on #1091.
  [path.join('site', 'v1', 'index.html')]: 'hand-written no-script baseline (#1091)',
};

function pages(): string[] {
  return PAGE_DIRS.flatMap((dir) => fs.readdirSync(dir).filter((name) => name.endsWith('.html')).map((name) => path.join(dir, name))).sort();
}

// The "Record as of" chip is rewritten by the build on every page that has
// one, so its date is not hand-maintained.
function withoutBuildStampedChip(html: string): string {
  return html.replace(/<span class="chip asof"(?:"[^"]*"|[^">])*>.*?<\/span>/g, '');
}

function claims(file: string): string[] {
  return [...withoutBuildStampedChip(fs.readFileSync(file, 'utf8')).matchAll(NEWEST_WITH_A_DATE)].map((m) => m[0].replace(/\s+/g, ' '));
}

describe('hand-written "newest" claims on site pages', { tags: ['unit'] }, () => {
  it('SitePages_OutsideTheKnownBaseline_NeverCallAHandWrittenDateTheNewest', () => {
    const offenders = pages()
      .filter((file) => KNOWN[file] === undefined)
      .flatMap((file) => claims(file).map((claim) => `${file}: ${claim}`));

    expect(offenders).toEqual([]);
  });

  it('SitePages_AreActuallyScanned_AndThePatternFindsTheSentenceItExistsFor', () => {
    expect(pages().length).toBeGreaterThan(10);
    const stale = 'derived from the newest held register snapshot (23 June 2026) with this site';
    expect([...stale.matchAll(NEWEST_WITH_A_DATE)]).toHaveLength(1);
    const iso = 'The newest publication held (2026-06-23) records';
    expect([...iso.matchAll(NEWEST_WITH_A_DATE)]).toHaveLength(1);
    const dated = 'derived from the held register snapshot dated 23 June 2026 with this site';
    expect([...dated.matchAll(NEWEST_WITH_A_DATE)]).toHaveLength(0);
  });

  it('KnownBaseline_StillCarriesSuchAClaim_SoTheExceptionIsNotLeftBehindOnceFixed', () => {
    for (const file of Object.keys(KNOWN)) {
      expect(claims(file).length, `${file} no longer needs its exception - remove it from KNOWN`).toBeGreaterThan(0);
    }
  });
});
