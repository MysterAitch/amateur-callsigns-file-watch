import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Durable accessibility guards for the ledger visual language and the
// interactive tool pages (issues #407 / #397). The contrast checks parse the
// SHIPPED ledger.css palette tokens and recompute the WCAG contrast ratio for
// the pairs the #397 audit found failing, so a future palette edit that
// reintroduces a low-contrast pair fails CI rather than shipping silently.

const SITE_DIR = 'site';
const CSS = fs.readFileSync(path.join(SITE_DIR, 'ledger.css'), 'utf8');
const siteFile = (name: string): string => fs.readFileSync(path.join(SITE_DIR, name), 'utf8');

// --- WCAG 2.x relative luminance and contrast ratio (sRGB) -------------------
function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

// --- Extract the per-theme palette blocks from the shipped stylesheet --------
// The base `.ledger { … }` block (the only one carrying --bg) is the OS-default
// light theme; the @media (prefers-color-scheme: dark) block is the OS-default
// dark theme. These are what actually render for a visitor with no in-page
// theme override, so they are what the guard measures.
function blockBody(css: string, re: RegExp): string {
  const m = re.exec(css);
  if (m === null) throw new Error(`palette block not found for ${re}`);
  return m[1];
}
const LIGHT = blockBody(CSS, /\.ledger\s*\{([^}]*--bg:[^}]*)\}/);
const DARK = blockBody(CSS, /prefers-color-scheme:\s*dark[^{]*\{\s*\.ledger\s*\{([^}]*)\}/);
const LIGHT_THEMED = blockBody(CSS, /data-theme="light"\]\s*\.ledger\s*\{([^}]*)\}/);
const DARK_THEMED = blockBody(CSS, /data-theme="dark"\]\s*\.ledger\s*\{([^}]*)\}/);

function token(body: string, name: string): string {
  const m = new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{3,8})`).exec(body);
  if (m === null) throw new Error(`token --${name} not found`);
  return m[1];
}

const AA_NORMAL = 4.5; // normal-size text / small UI labels

// The pairs the #397 audit measured as failing AA, expressed as
// (foreground token, background token). Each is small text, so the bar is 4.5.
const PAIRS: [name: string, fg: string, bg: string][] = [
  ['submit/pressed-chip label on the amber fill', 'on-signal', 'signal'],
  ['flag pill: signal text on signal-soft', 'signal', 'signal-soft'],
  ['eyebrow: signal text on the inset surface-2', 'signal', 'surface-2'],
  ['faint small headers on the surface', 'faint', 'surface'],
];

// The sibling status pills - raw (birth/observed), change (moved/churn) and
// steady (flat/done) - each render their coloured label on the matching *-soft
// fill. The #397 audit's flagged set (above) did not include these, but the
// #411 follow-up measured all three below AA in the light theme. Guarding them
// as (label token, soft-fill token) pairs stops a palette edit dropping them
// back under 4.5 unnoticed. Each is small monospace text, so the bar is 4.5.
const PILL_PAIRS: [name: string, fg: string, bg: string][] = [
  ['raw pill: raw text on raw-soft', 'raw', 'raw-soft'],
  ['change pill: change text on change-soft', 'change', 'change-soft'],
  ['steady pill: steady text on steady-soft', 'steady', 'steady-soft'],
];

describe('ledger.css contrast guard (issues #407 / #411)', () => {
  for (const [theme, body] of [['light', LIGHT], ['dark', DARK]] as const) {
    for (const [label, fg, bg] of [...PAIRS, ...PILL_PAIRS]) {
      it(`Contrast_${theme}Theme_${fg}On${bg}_MeetsAA`, () => {
        const ratio = contrast(token(body, fg), token(body, bg));
        expect(ratio, `${label} (${theme}): ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_NORMAL);
      });
    }
  }

  // The OS-default blocks and their explicit data-theme twins must agree, or a
  // partial palette edit could pass the guard yet ship a low-contrast theme to
  // visitors who use the site-wide theme toggle.
  const GUARDED = ['signal', 'signal-soft', 'surface', 'surface-2', 'faint', 'on-signal',
    'raw', 'raw-soft', 'change', 'change-soft', 'steady', 'steady-soft'];
  it('Palette_OsDefaultAndDataThemeBlocks_CarryIdenticalGuardedTokens', () => {
    for (const name of GUARDED) {
      expect(token(LIGHT, name), `light --${name}`).toBe(token(LIGHT_THEMED, name));
      expect(token(DARK, name), `dark --${name}`).toBe(token(DARK_THEMED, name));
    }
  });

  it('SubmitButton_UsesThemedOnSignalTokenNotHardcodedWhite', () => {
    // The regression that failed AA was a hard-coded white label on the amber
    // fill; the fill/label must be driven by the palette tokens so both themes
    // stay covered by the contrast guard above.
    expect(CSS).toMatch(/button\[type="submit"\][^}]*color:\s*var\(--on-signal\)/);
    expect(CSS).toMatch(/aria-pressed="true"\][^}]*color:\s*var\(--on-signal\)/);
  });
});

describe('interactive-page accessibility fallbacks (issues #407 / #397)', () => {
  it('LedgerPage_BeingJsDriven_CarriesANoscriptFallback', () => {
    const html = siteFile('ledger.html');
    expect(html).toContain('<noscript>');
    // The fallback must point at the crawlable data, mirroring the other pages.
    const noscript = /<noscript>([\s\S]*?)<\/noscript>/.exec(html);
    expect(noscript?.[1]).toContain('datasets/index.html');
  });

  for (const page of ['explore.html', 'compare.html']) {
    it(`${page.replace('.html', '')}Page_CarriesAProvenanceFooter`, () => {
      const html = siteFile(page);
      expect(html).toContain('<footer>');
      expect(html).toContain('</footer>');
      const footer = /<footer>([\s\S]*?)<\/footer>/.exec(html);
      expect(footer?.[1]).toContain('datasets/index.html');
    });
  }
});
