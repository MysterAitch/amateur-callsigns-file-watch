// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { classifyDelta, describeChange, changeIndicatorSpec, changeIndicator, CHANGE_THRESHOLDS } from './compare.js';

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

// The change-magnitude indicator's semantic severity colours (issue #409),
// separate from the ledger accent. The mild tier is a coloured value sitting on
// the table cell's surface; the substantial tier is a filled badge, its label
// on the strong fill. Both are small text, so the bar is 4.5 - guarded here so
// a palette edit that drops either under AA (in either theme) fails CI.
const DEV_PAIRS: [name: string, fg: string, bg: string][] = [
  ['mild-deviation value on the surface', 'dev-mild', 'surface'],
  ['substantial-deviation badge label on the strong fill', 'on-dev-strong', 'dev-strong'],
];

describe('ledger.css contrast guard (issues #407 / #411)', { tags: ['ui'] }, () => {
  for (const [theme, body] of [['light', LIGHT], ['dark', DARK]] as const) {
    for (const [label, fg, bg] of [...PAIRS, ...PILL_PAIRS, ...DEV_PAIRS]) {
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
    'raw', 'raw-soft', 'change', 'change-soft', 'steady', 'steady-soft',
    'dev-mild', 'dev-strong', 'on-dev-strong'];
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

// --- Publisher holdings-map letter cells (issue #687) -----------------------
// The fix lives in the composite's own module (src/ci/build-publisher-pages.ts),
// not in this file's ledger.css: every map cell is an <a> (it links to its
// row), and ledger.css's page-wide `.ledger a{color:var(--raw)}` otherwise
// beats `.hold-cell`'s own `color:var(--ink)` on specificity, dimming every
// kind letter to the link colour instead of the intended ink. Two things are
// guarded, mirroring the token-and-arithmetic pattern above: the override
// rule out-specifies `.ledger a` (so it wins on the cascade, not a fragile
// load-order tie), and the ink-on-tint contrast it restores clears AA for
// every dataset kind, in both themes.
const BUILD_PUBLISHER_PAGES_TS = fs.readFileSync(path.join('src', 'ci', 'build-publisher-pages.ts'), 'utf8');
const TOKENS_CSS = fs.readFileSync(path.join(SITE_DIR, 'tokens.css'), 'utf8');

// A minimal selector-specificity count (ids, classes/attrs/pseudo-classes,
// element types) - enough for the plain compound selectors compared here,
// not a general CSS parser.
function specificity(selector: string): [ids: number, classesEtc: number, types: number] {
  let s = selector;
  const ids = (s.match(/#[\w-]+/g) ?? []).length;
  s = s.replace(/#[\w-]+/g, ' ');
  const classPattern = /\.[\w-]+|\[[^\]]*\]|:(?!:)[\w-]+(?:\([^)]*\))?/g;
  const classesEtc = (s.match(classPattern) ?? []).length;
  s = s.replace(classPattern, ' ');
  const types = (s.match(/(?:^|[\s>+~])([a-zA-Z][\w-]*)/g) ?? []).length;
  return [ids, classesEtc, types];
}
function outSpecifies(a: readonly [number, number, number], b: readonly [number, number, number]): boolean {
  if (a[0] !== b[0]) return a[0] > b[0];
  if (a[1] !== b[1]) return a[1] > b[1];
  return a[2] > b[2];
}

const LEDGER_A_SELECTOR = '.ledger a';
const LEDGER_A_SPECIFICITY = specificity(LEDGER_A_SELECTOR);

// The dedicated override rule: a quoted JS string literal (the build script
// emits its stylesheet as an array of CSS-rule strings) whose ENTIRE
// declaration is `color:var(--ink)` and whose selector mentions `hold-cell` -
// i.e. not the base `.hold-cell{…}` rule (which also carries the layout and
// background declarations), but the higher-specificity rule added to win the
// cascade against `.ledger a`. Bounded by the surrounding quotes so the match
// cannot bleed across separate string-literal array entries.
const HOLD_CELL_INK_OVERRIDE = /'([^']*hold-cell[^']*)\{color:var\(--ink\)\}'/.exec(BUILD_PUBLISHER_PAGES_TS);

const TOKENS_LIGHT = blockBody(TOKENS_CSS, /:root\s*\{([^}]*--paper[^}]*)\}/);
const TOKENS_DARK = blockBody(TOKENS_CSS, /prefers-color-scheme:\s*dark[^{]*\{\s*:root\s*\{([^}]*)\}/);

// Every dataset-kind tint - (kind, `--kh` hex) pairs, read from the source so
// a future kind addition or removal is picked up automatically.
const KIND_TINTS = [...BUILD_PUBLISHER_PAGES_TS.matchAll(/\.hold-cell\[data-kind="([a-z0-9-]+)"\]\{--kh:(#[0-9A-Fa-f]{3,8})\}/g)]
  .map((m): [kind: string, hex: string] => [m[1], m[2]]);

// The map-cell background: `color-mix(in srgb, var(--kh) P%, var(--paper))`,
// its percentage read from the base rule so the guard tracks the shipped mix.
const MIX_PERCENT = Number(/\.hold-cell\{[^}]*background:color-mix\(in srgb,var\(--kh\) (\d+)%,var\(--paper\)\)/.exec(BUILD_PUBLISHER_PAGES_TS)?.[1]);

// `color-mix(in srgb, …)` interpolates the gamma-encoded sRGB channels
// directly (not linear-light), so a plain per-channel weighted average of the
// 8-bit values matches what the browser renders.
function mix(hexA: string, hexB: string, percentA: number): string {
  const a = hexA.replace('#', '');
  const b = hexB.replace('#', '');
  const channelOf = (h: string, i: number): number => parseInt(h.slice(i, i + 2), 16);
  const mixed = (i: number): number => Math.round((channelOf(a, i) * percentA + channelOf(b, i) * (100 - percentA)) / 100);
  return `#${[0, 2, 4].map(i => mixed(i).toString(16).padStart(2, '0')).join('')}`;
}

const REQUIRED_KINDS = [
  'register-snapshot', 'available-pool', 'issuance-events', 'forbidden-list',
  'statistics-aggregate', 'attribute-addendum', 'reference-context',
];

describe('publisher holdings-map letter cells keep the ledger ink colour (issue #687)', { tags: ['ui'] }, () => {
  it('KindTintsAndMixPercent_ParsedFromSource_CoverEveryDocumentedKind', () => {
    // A parsing regression (a rewritten stylesheet the regexes above no longer
    // match) must fail loudly here rather than silently skipping every
    // contrast assertion below.
    expect(KIND_TINTS.map(([kind]) => kind)).toEqual(expect.arrayContaining(REQUIRED_KINDS));
    expect(Number.isInteger(MIX_PERCENT) && MIX_PERCENT > 0, `parsed mix percentage: ${MIX_PERCENT}`).toBe(true);
  });

  it('HoldCellInkOverride_AgainstLedgerLinkColour_WinsOnSpecificityNotLoadOrder', () => {
    expect(HOLD_CELL_INK_OVERRIDE, 'no dedicated .hold-cell ink-colour override found in build-publisher-pages.ts').not.toBeNull();
    const selector = HOLD_CELL_INK_OVERRIDE?.[1].trim() ?? '';
    const overrideSpecificity = specificity(selector);
    expect(outSpecifies(overrideSpecificity, LEDGER_A_SPECIFICITY),
      `"${selector}" (${overrideSpecificity.join(',')}) must out-specify "${LEDGER_A_SELECTOR}" (${LEDGER_A_SPECIFICITY.join(',')}) so the map cells' ink colour wins regardless of stylesheet order`)
      .toBe(true);
  });

  for (const theme of ['light', 'dark'] as const) {
    const ink = token(theme === 'light' ? LIGHT : DARK, 'ink');
    const paper = token(theme === 'light' ? TOKENS_LIGHT : TOKENS_DARK, 'paper');
    for (const [kind, kh] of KIND_TINTS) {
      it(`HoldCell_${theme}Theme_${kind}LetterOnItsTintedBackground_MeetsAA`, () => {
        const background = mix(kh, paper, MIX_PERCENT);
        const ratio = contrast(ink, background);
        expect(ratio, `${kind} (${theme}): ink ${ink} on ${background} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_NORMAL);
      });
    }
  }
});

describe('interactive-page accessibility fallbacks (issues #407 / #397)', { tags: ['ui'] }, () => {
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

// The change-magnitude indicator (issue #409): the classifier must sort
// representative deltas into the right tier and direction against the stated
// thresholds (in-range < 2% ≤ mild < 10% ≤ substantial), and the rendered
// readout must state severity AND direction in TEXT (the accessible label),
// not colour alone. Test names follow Subject_Scenario_Outcome.
describe('change-magnitude classifier and label (issue #409)', { tags: ['ui'] }, () => {
  it('ClassifyDelta_WhenWithinTwoPercent_IsInRange', () => {
    expect(classifyDelta(1015, 1000).severity).toBe('in-range'); // +1.5%
    expect(classifyDelta(1000, 1000)).toMatchObject({ severity: 'in-range', direction: 'none' });
  });
  it('ClassifyDelta_WhenBetweenTwoAndTenPercent_IsMild', () => {
    expect(classifyDelta(1050, 1000)).toMatchObject({ severity: 'mild', direction: 'up' }); // +5%
    expect(classifyDelta(940, 1000)).toMatchObject({ severity: 'mild', direction: 'down' }); // −6%
  });
  it('ClassifyDelta_WhenTenPercentOrMore_IsSubstantial', () => {
    expect(classifyDelta(1200, 1000)).toMatchObject({ severity: 'substantial', direction: 'up' }); // +20%
    expect(classifyDelta(56000, 100000)).toMatchObject({ severity: 'substantial', direction: 'down' }); // −44%, the #330 swing
  });
  it('ClassifyDelta_WhenBaselineIsZeroAndValueAppears_IsSubstantialUp', () => {
    expect(classifyDelta(1234, 0)).toMatchObject({ severity: 'substantial', direction: 'up' });
    expect(classifyDelta(0, 0)).toMatchObject({ severity: 'in-range', direction: 'none' });
  });
  it('ClassifyDelta_AtEachThresholdBoundary_TakesTheHigherTier', () => {
    expect(classifyDelta(1020, 1000).severity).toBe('mild');        // exactly +2%
    expect(classifyDelta(1100, 1000).severity).toBe('substantial'); // exactly +10%
  });

  it('DescribeChange_ForEachTierAndDirection_StatesSeverityAndDirectionInText', () => {
    // The accessible name carries the meaning without colour or the caret glyph.
    expect(describeChange(classifyDelta(1200, 1000))).toBe('up 20.0%, substantial deviation');
    expect(describeChange(classifyDelta(940, 1000))).toBe('down 6.0%, mild deviation');
    expect(describeChange(classifyDelta(1015, 1000))).toBe('up 1.5%, within the expected range');
    expect(describeChange(classifyDelta(1000, 1000))).toBe('no change');
    expect(describeChange(classifyDelta(1234, 0))).toBe('up 1,234 from none, substantial deviation');
  });

  it('ChangeIndicatorSpec_ForMildAndSubstantial_ShowsACaretNotColourAlone', () => {
    const mild = changeIndicatorSpec(1050, 1000);
    expect(mild.visible).toContain('↑');
    expect(mild.label).toBe('up 5.0%, mild deviation');
    const down = changeIndicatorSpec(800, 1000);
    expect(down.visible).toContain('↓');
    expect(down.severity).toBe('substantial');
  });
  it('ChangeIndicatorSpec_WhenInRange_ShowsPlainSignedTextWithNoCaret', () => {
    const spec = changeIndicatorSpec(1015, 1000);
    expect(spec.severity).toBe('in-range');
    expect(spec.visible).toBe('+1.5%');
    expect(spec.visible).not.toContain('↑');
  });

  it('ChangeIndicator_ForASubstantialDeviation_HidesTheGlyphAndCarriesTheLabelForAssistiveTech', () => {
    // The rendered node must announce "up …, substantial deviation" through a
    // visually-hidden span while the visible caret+magnitude is aria-hidden, so
    // the meaning never rides on colour or the glyph alone.
    const node = changeIndicator(1200, 1000);
    expect(node.className).toBe('chg chg-substantial');
    const hidden = node.querySelector('.visually-hidden');
    expect(hidden?.textContent).toBe('up 20.0%, substantial deviation');
    const glyph = node.querySelector('[aria-hidden="true"]');
    expect(glyph?.textContent).toContain('↑');
  });
  it('ChangeIndicator_WhenInRange_RendersPlainTextWithNoHiddenBadge', () => {
    const node = changeIndicator(1015, 1000);
    expect(node.className).toBe('chg chg-inrange');
    expect(node.querySelector('.visually-hidden')).toBeNull();
    expect(node.textContent).toBe('+1.5%');
  });

  it('ChangeThresholds_AreTheStatedFirstDraftBoundaries', () => {
    // Pin the documented Phase-1 heuristic so a change to it is a deliberate edit.
    expect(CHANGE_THRESHOLDS).toEqual({ mild: 0.02, substantial: 0.10 });
  });
});
