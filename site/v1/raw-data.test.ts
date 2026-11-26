// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// The "Get the raw data" page: what it offers on arrival must match what is
// actually here. Every download row either links to something that exists or
// says, in words, that this site has no link for it yet; and the claims it
// makes about the repository must be true of the repository. Test names follow
// Subject_Scenario_Outcome.

const PAGE = 'site/v1/how-to-get-the-raw-data.html';
const REPO = 'https://github.com/MysterAitch/amateur-callsigns-file-watch';
const html = fs.readFileSync(PAGE, 'utf8');
const norm = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

function servedDocument(): Document {
  return new DOMParser().parseFromString(html, 'text/html');
}

describe('raw-data page - what it offers is what is here', { tags: ['ui'] }, () => {
  it('RawDataPage_EveryDownloadRow_EitherLinksOrSaysItIsPublishedButNotLinkedHere', () => {
    // The built files ARE published with each build of the site; the honest
    // gap is that these pages do not link them. "No download link on this
    // site" read as "not published", which is untrue.
    const rows = [...servedDocument().querySelectorAll('.dl .row')];
    expect(rows.length).toBeGreaterThan(0);
    const unaccounted = rows.filter((row) => {
      const linked = row.querySelector('h3 a[href]') !== null;
      const absence = norm(row.querySelector('.absent')?.textContent);
      const statesAbsence = /published with each build of this site/i.test(absence) && /not linked from these pages yet/i.test(absence);
      return linked === statesAbsence;
    });
    expect(unaccounted.map((r) => norm(r.querySelector('h3')?.textContent))).toEqual([]);
    expect(norm(servedDocument().querySelector('main')?.textContent)).not.toMatch(/no download link on this site|linked from this site yet/i);
  });

  it('RawDataPage_WhatTheWayInPromises_EachHasItsOwnRow', () => {
    // The home and callsign pages send readers here for the databases, the
    // per-entry zips, the SQLite tiers and the claim ledger. Each must have a
    // row of its own, found by its heading: matching the page text alone let
    // "gzipped" stand in for a missing zips row.
    const headings = [...servedDocument().querySelectorAll('.dl .row h3')].map((h) => norm(h.textContent).toLowerCase());
    for (const promised of [['combined sqlite'], ['per-publication sqlite', 'zips'], ['claim ledger']]) {
      expect(headings.some((h) => promised.every((p) => h.includes(p))), promised.join(' + ')).toBe(true);
    }
  });

  it('RawDataPage_NewTabStatement_ClaimsItOnlyForRepositoryLinks', () => {
    // Nav and breadcrumb links open in the same tab, so a sentence about
    // "every link on this page" would be false.
    const text = norm(servedDocument().querySelector('main')?.textContent);
    expect(text).not.toMatch(/every link on this page opens in a new tab/i);
    const repositoryLinks = [...servedDocument().querySelectorAll('main .dl a[href^="https://github.com/"], main .surface a[href^="https://github.com/"]')];
    expect(repositoryLinks.length).toBeGreaterThan(0);
    expect(repositoryLinks.filter((a) => a.getAttribute('target') !== '_blank')).toEqual([]);
  });

  it('RawDataPage_RepositoryLinks_EachNameAPathTheRepositoryHolds', () => {
    // A link into the repository that names a path the repository does not
    // hold is a dead end dressed as a download.
    const links = [...servedDocument().querySelectorAll('a[href]')]
      .map((a) => a.getAttribute('href') ?? '')
      .filter((href) => href.startsWith(`${REPO}/tree/main/`) || href.startsWith(`${REPO}/blob/main/`));
    expect(links.length).toBeGreaterThan(0);
    const missing = links.filter((href) => !fs.existsSync(href.replace(/^.*?\/(?:tree|blob)\/main\//, '')));
    expect(missing).toEqual([]);
  });

  it('RawDataPage_ClaimsAboutTheRepository_AreTrueOfTheRepository', () => {
    const text = norm(servedDocument().querySelector('main')?.textContent);
    // Frictionless descriptors are generated at deploy time, not committed
    // beside the raw bytes.
    const committedDescriptors = fs.readdirSync('archive', { recursive: true })
      .filter((f) => path.basename(String(f)) === 'datapackage.json');
    if (committedDescriptors.length === 0) expect(text).not.toMatch(/datapackage\.json beside the raw bytes/);
    // Derived files are not committed for every entry (a newer publication
    // carries its raw file alone; an FOI entry may hold correspondence only),
    // so the page must not promise extract and normalised files for every one.
    const entries = fs.readdirSync('archive', { recursive: true })
      .map(String)
      .filter((f) => path.basename(f) === 'meta.json')
      .map((f) => path.dirname(path.join('archive', f)));
    expect(entries.length).toBeGreaterThan(0);
    const withoutNormalised = entries.filter((dir) => !fs.readdirSync(dir).some((f) => f.startsWith('normalised')));
    if (withoutNormalised.length > 0) expect(text).not.toMatch(/with the raw, extract and normalised files/);
    // The ledger is built at deploy time and never committed; only its builder is.
    expect(text).not.toMatch(/ledger data and its builder are open in the repository/);
    // The repository is itself off this site.
    expect(text).not.toMatch(/rather than anywhere off this site/);
  });

  it('RawDataPage_Outline_DoesNotSkipALevelBelowThePageTitle', () => {
    const levels = [...servedDocument().querySelectorAll('main h1, main h2, main h3, main h4')].map((h) => Number(h.tagName[1]));
    expect(levels[0]).toBe(1);
    const skips = levels.filter((level, i) => i > 0 && level > levels[i - 1] + 1);
    expect(skips).toEqual([]);
  });
});

describe('raw-data page - the shared chrome after the script runs', { tags: ['ui'] }, () => {
  beforeAll(async () => {
    const served = servedDocument();
    document.documentElement.replaceChildren(...[...served.documentElement.childNodes].map((n) => document.importNode(n, true)));
    await import('./raw-data.js');
  });

  it('RawDataPage_AfterTheScriptRemountsTheNav_MarksGetTheRawDataAsTheCurrentPage', () => {
    const current = [...document.querySelectorAll('nav.journeys a[aria-current="page"]')].map((a) => a.textContent);
    expect(current).toEqual(['Get the raw data']);
  });
});
