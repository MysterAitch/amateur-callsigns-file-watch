import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  NAV_START,
  NAV_END,
  canonicalNav,
  injectNav,
  injectNavIntoFile,
  ACTIVE_NAV,
} from './build-nav.ts';

// Test names follow Subject_Scenario_Outcome per project convention.
//
// The nav strip's single source is navHtml in site-render.ts. The generated
// pages already build from it; this injector stamps the same strip into the
// hand-authored site/*.html pages at deploy, so the previously hand-maintained
// second copy (which drifted) is removed. These tests run against the real
// committed pages - the same inputs the deploy uses.

// Copies a committed hand-authored page into a scratch dir, keeping its name so
// injectNavIntoFile can resolve the active item, and returns the scratch path.
function scratchPage(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-nav-'));
  const dest = path.join(dir, name);
  fs.copyFileSync(path.join('site', name), dest);
  return dest;
}

describe('Deploy-time nav injection', () => {
  it('InjectNav_HandAuthoredPage_YieldsFullCanonicalNavIncludingNewEntries', () => {
    const page = scratchPage('index.html');
    injectNavIntoFile(page);
    const html = fs.readFileSync(page, 'utf8');
    // The Inter-dataset link and the Forbidden-suffixes section - the entries
    // that the hand-maintained copies were prone to miss - are now present.
    expect(html).toContain('<a href="statistics/inter-dataset.html">Inter-dataset</a>');
    expect(html).toContain('<a href="forbidden/index.html">Forbidden suffixes</a>');
    // The full canonical set, in order, at root depth (no ../ prefix).
    expect(html).toContain('<a href="reports/index.html">Reports</a>');
    expect(html).toContain('<a href="series/index.html">Series</a>');
    expect(html).toContain('<a href="datasets/index.html">Dataset index</a>');
    // The one external nav item carries the leave-the-site affordance (marker +
    // visually-hidden hint), matching the generated pages.
    expect(html).toContain('<span class="ext-marker" aria-hidden="true">↗</span>');
    expect(html).toContain('<span class="visually-hidden"> (opens in a new tab)</span>');
    fs.rmSync(path.dirname(page), { recursive: true, force: true });
  });

  it('InjectNav_EachHandAuthoredPage_MarksItsOwnItemActive', () => {
    for (const [name, active] of Object.entries(ACTIVE_NAV)) {
      const page = scratchPage(name);
      injectNavIntoFile(page);
      const html = fs.readFileSync(page, 'utf8');
      // The current page is named but not self-linked (bold, no anchor).
      expect(html).toContain(`<strong>${active}</strong>`);
      expect(html).not.toContain(`>${active}</a>`);
      fs.rmSync(path.dirname(page), { recursive: true, force: true });
    }
  });

  it('InjectNav_HandAuthoredPage_PreservesSkipLinkAndNavLandmark', () => {
    const page = scratchPage('statistics.html');
    injectNavIntoFile(page);
    const html = fs.readFileSync(page, 'utf8');
    // The skip-link and the <main> target it points at survive the injection.
    expect(html).toContain('<a class="skip" href="#main">Skip to content</a>');
    expect(html).toContain('id="main"');
    // The nav landmark is present exactly once (no duplicated strip).
    expect(html.match(/<nav>/g)?.length).toBe(1);
    fs.rmSync(path.dirname(page), { recursive: true, force: true });
  });

  it('InjectNav_RunTwice_IsIdempotent', () => {
    const source = fs.readFileSync(path.join('site', 'about.html'), 'utf8');
    const once = injectNav(source, 'About');
    const twice = injectNav(once, 'About');
    expect(twice).toBe(once);
    // The markers survive so a later run finds the region again.
    expect(once).toContain(NAV_START);
    expect(once).toContain(NAV_END);
    expect(once).toContain(canonicalNav('About'));
  });

  it('InjectNav_MarkersMissing_FailsLoudly', () => {
    expect(() => injectNav('<html><body>no nav markers here</body></html>', 'Lookup'))
      .toThrow(/nav markers not found/);
  });

  it('InjectNavIntoFile_UnknownPageName_FailsLoudly', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-nav-bad-'));
    const dest = path.join(dir, 'mystery.html');
    fs.writeFileSync(dest, `${NAV_START}<nav></nav>${NAV_END}`);
    expect(() => injectNavIntoFile(dest)).toThrow(/no active nav item mapped/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('CommittedPages_EveryHandAuthoredPage_CarriesTheNavMarkers', () => {
    // The injector targets these markers; a page that lost them would silently
    // ship a stale nav, so guard that every mapped page still carries them.
    for (const name of Object.keys(ACTIVE_NAV)) {
      const html = fs.readFileSync(path.join('site', name), 'utf8');
      expect(html, `${name} is missing the nav start marker`).toContain(NAV_START);
      expect(html, `${name} is missing the nav end marker`).toContain(NAV_END);
    }
  });
});
