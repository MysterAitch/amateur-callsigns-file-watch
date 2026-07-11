import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Deploy-integrity guard for the claim-ledger preview (issue #361). The page is
// a first-class site page: its markup, its externalised script and its bespoke
// stylesheet must all reach the deploy and the offline shell. A future change
// that drops any of them would leave the page blank or unstyled offline - the
// same failure class that took the live lookup down when a shipped page
// imported a module the deploy never copied. These assertions run against the
// real committed files, so that regression cannot land silently.

const SITE_DIR = 'site';
const PAGES_WORKFLOW = path.join('.github', 'workflows', 'pages.yml');

function siteFile(name: string): string {
  return fs.readFileSync(path.join(SITE_DIR, name), 'utf8');
}

// The quoted entries of the service worker's SHELL_ASSETS precache array.
function shellAssets(): string[] {
  const src = siteFile('sw.js');
  const block = src.match(/const SHELL_ASSETS = \[([\s\S]*?)\];/);
  if (block === null) throw new Error('SHELL_ASSETS array not found in sw.js');
  return [...block[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
}

describe('claim-ledger preview page', () => {
  it('LedgerPage_Assets_AllExistInSite', () => {
    const present = new Set(fs.readdirSync(SITE_DIR));
    for (const asset of ['ledger.html', 'ledger.js', 'ledger.css']) {
      expect(present.has(asset), `${asset} is missing from site/`).toBe(true);
    }
  });

  it('LedgerPage_LinksItsExternalisedScriptAndBespokeStylesheet', () => {
    const html = siteFile('ledger.html');
    // The demo's script and bespoke styles are externalised (the site keeps its
    // page code in site/*.js and its CSS in stylesheets); confirm the page wires
    // both, plus the shared stylesheet that backs the nav.
    expect(html).toContain('href="style.css"');
    expect(html).toContain('href="ledger.css"');
    expect(html).toMatch(/<script[^>]*\bsrc="ledger\.js"/);
    // No inline model logic left behind that a strict policy could block: the
    // only inline scripts are the shared service-worker registration snippet.
    const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    for (const body of inlineScripts) {
      expect(body).toContain('serviceWorker');
    }
  });

  it('LedgerPage_IsPrecachedForTheOfflineShell', () => {
    const listed = new Set(shellAssets());
    for (const asset of ['ledger.html', 'ledger.js', 'ledger.css']) {
      expect(listed.has(asset), `sw.js SHELL_ASSETS omits ${asset} (offline shell incomplete)`).toBe(true);
    }
  });

  it('LedgerPage_ShipsToTheDeployAndGetsTheCanonicalNav', () => {
    const wf = fs.readFileSync(PAGES_WORKFLOW, 'utf8');
    // What actually guarantees the page's assets deploy is the glob copy of
    // EACH asset kind: the HTML page, the externalised script AND the bespoke
    // stylesheet (plus the shared webmanifest). Asserting all of them means a
    // future workflow edit that dropped, say, the *.css glob would fail here
    // rather than silently shipping ledger.html with no styling. Guarding the
    // globs (not the filenames) keeps the contract: any later site/*.js or
    // site/*.css is carried automatically.
    expect(wf).toMatch(/cp\b[^\n]*\bsite\/\*\.html\b/);
    expect(wf).toMatch(/cp\b[^\n]*\bsite\/\*\.js\b/);
    expect(wf).toMatch(/cp\b[^\n]*\bsite\/\*\.css\b/);
    expect(wf).toMatch(/cp\b[^\n]*\bsite\/\*\.webmanifest\b/);
    // The nav injector must also be handed the new page, or the deployed copy
    // would carry a stale hand-written nav.
    expect(wf).toMatch(/build-nav\.ts[^\n]*\b_site\/ledger\.html\b/);
  });

  it('LedgerPage_CarriesTheNavMarkersAndIsWayfindableAsAPreview', () => {
    const html = siteFile('ledger.html');
    // The nav-injection markers must be present so the deploy can stamp the
    // canonical strip; the committed copy names the page as the active item.
    expect(html).toContain('<!-- nav:end -->');
    expect(html).toContain('<strong>Ledger (preview)</strong>');
    // Honest framing: tied to issue #361 and clearly a static illustrative
    // snapshot rather than the live pipeline.
    expect(html).toContain('issues/361');
    expect(html).toContain('illustrative static snapshot');
  });
});
