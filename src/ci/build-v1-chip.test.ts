import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  humaniseIsoDate,
  datedFactsFromHoldings,
  chipHtml,
  stampChipHtml,
  stampRecordFacts,
  buildV1Chip,
} from './build-v1-chip.ts';
// The chip's wording source is the site copy registry (site/v1/copy.js): the
// build stamp renders through the SAME component module the browser uses
// (ADR 0022), so the assertion reads the same single source.
import { V1_COPY } from '../../site/v1/copy.js';

// The dated-fact chip build stamp (issues #965, #966): the chip's date + count
// are derived in ONE place (the holdings manifest) and injected into the single
// JS source of truth plus the static no-JS baselines. Test names follow
// Subject_Scenario_Outcome.

// A static chip line in exactly the shape the v1 pages carry.
const SAMPLE_CHIP =
  '<span class="chip asof" title="old title">Record as of 1 January 2000 · <b>1</b> publications held</span>';
const SAMPLE_PAGE = `<!DOCTYPE html><html><body>\n  ${SAMPLE_CHIP}\n  <main>body</main>\n</body></html>`;
const SAMPLE_FACTS_JS = "export const RECORD_FACTS = { date: '1 January 2000', count: 1 };\n";

describe('build-v1-chip — dated-fact derivation', { tags: ['unit'] }, () => {
  it('HumaniseIsoDate_FullDate_RendersDayMonthYear_MonthOnlyReturnsNull', () => {
    expect(humaniseIsoDate('2026-06-23')).toBe('23 June 2026');
    expect(humaniseIsoDate('2026-06')).toBeNull();
  });

  it('DatedFactsFromHoldings_FullNewestDate_HumanisesItWithTheCount', () => {
    expect(datedFactsFromHoldings({ count: 65, latestDateIso: '2026-06-23', latestYear: 2026 }))
      .toEqual({ date: '23 June 2026', count: 65 });
  });

  it('DatedFactsFromHoldings_MonthOnlyNewestVintage_FallsBackToTheYearNeverAFabricatedDay', () => {
    // Unhappy path: the newest vintage is month-only, so latestDateIso is null.
    // The chip shows the year rather than inventing a day.
    expect(datedFactsFromHoldings({ count: 40, latestDateIso: null, latestYear: 2025 }))
      .toEqual({ date: '2025', count: 40 });
  });

  it('DatedFactsFromHoldings_NoDatesAtAll_DegradesToAnHonestBlankNotABareDash', () => {
    expect(datedFactsFromHoldings({ count: 0, latestDateIso: null, latestYear: null }))
      .toEqual({ date: '(date not recorded)', count: 0 });
  });
});

describe('build-v1-chip — static-HTML stamping', { tags: ['unit'] }, () => {
  it('ChipHtml_FromFacts_CarriesTheTemplateTextBoldCountAndHonestTooltip', () => {
    const html = chipHtml({ date: '23 June 2026', count: 65 });
    expect(html).toContain('Record as of 23 June 2026 · <b>65</b> publications held');
    // The tooltip is the honest registry title, with no false "generated" claim.
    const expectedTitle = V1_COPY.chip.title.replaceAll('{date}', '23 June 2026').replaceAll('{count}', '65');
    expect(html).toContain(`title="${expectedTitle}"`);
    expect(html.toLowerCase()).not.toContain('generated from that set');
  });

  it('ChipHtml_TheGeneratedChip_IsMatchedWholeByThePageStampPattern', () => {
    // The stamp finds a chip with a pattern; the chip it generates must be the
    // thing that pattern matches, entire. Pinned because the two are written
    // apart and the platform serialiser leaves '>' raw inside an attribute
    // value, so a title carrying one would be matched only in part.
    const html = chipHtml({ date: '23 June 2026', count: 65 });
    const { html: stamped, replaced } = stampChipHtml(`<p>${html}</p>`, { date: '1 January 2000', count: 1 });
    expect(replaced).toBe(1);
    expect(stamped).toBe(`<p>${chipHtml({ date: '1 January 2000', count: 1 })}</p>`);
  });

  it('ChipHtml_ADatePuttingAnAngleBracketInTheTitle_FailsLoudRatherThanEmittingAnUnstampableChip', () => {
    // Unhappy path for that coupling: the serialiser leaves '<' and '>' raw
    // inside an attribute value, and the date reaches the title. facts.date is
    // constrained upstream so this cannot happen today — the guard exists so it
    // stays impossible rather than becoming a silently corrupt stamp if the
    // constraint ever relaxes.
    for (const date of ['23 June 2026>', '23 June 2026</span><b>x', '<img src=x>']) {
      expect(() => chipHtml({ date, count: 65 }), date).toThrow(/page-stamp pattern|title carries/);
    }
  });

  it('StampChipHtml_APageCarryingTheChip_RewritesItToTheDerivedFactsExactlyOnce', () => {
    const { html, replaced } = stampChipHtml(SAMPLE_PAGE, { date: '23 June 2026', count: 65 });
    expect(replaced).toBe(1);
    expect(html).toContain('Record as of 23 June 2026 · <b>65</b> publications held');
    expect(html).not.toContain('1 January 2000');
  });

  it('StampChipHtml_RunTwice_IsIdempotentAndDeterministic', () => {
    const facts = { date: '23 June 2026', count: 65 };
    const once = stampChipHtml(SAMPLE_PAGE, facts).html;
    const twice = stampChipHtml(once, facts).html;
    expect(twice).toBe(once);
  });

  it('StampChipHtml_APageWithNoChip_ReportsZeroReplacementsSoTheCallerCanFailLoud', () => {
    const { replaced } = stampChipHtml('<html><body>no chip here</body></html>', { date: 'x', count: 1 });
    expect(replaced).toBe(0);
  });

  it('ChipHtml_StampedTitle_ContainsNoAngleBracketThatWouldTruncateThePageStampRegex', () => {
    // The page-stamp regex reads the chip's attributes with [^>]* and the HTML
    // serialiser leaves '>' unescaped in an attribute value, so a '>' in the
    // title would split the stamp. A well-formed date must never produce one.
    const html = chipHtml({ date: '23 June 2026', count: 65 });
    const title = /title="([^"]*)"/.exec(html)?.[1] ?? '';
    expect(title).not.toContain('>');
  });

  it('ChipHtml_DateContainingAnAngleBracket_FailsLoudRatherThanSilentlyTruncatingTheStamp', () => {
    // Unhappy path: were a future date source to emit a '>', the guard fails loud
    // rather than letting the page-stamp regex truncate the chip.
    expect(() => chipHtml({ date: 'a > b', count: 1 })).toThrow(/truncate|'>'/);
  });

  it('ChipHtml_AgainstTheCommittedStaticBaseline_IsByteIdentical', () => {
    // The renderStatic-generated markup (ADR 0022) must reproduce the committed
    // production chip byte for byte, for the facts the committed pages carry —
    // read from record-facts.js (the deploy stamp writes double-quoted values;
    // the committed default is single-quoted, so both are accepted). This pins
    // the DOM-construction render to the exact bytes the hand-baked serialiser
    // used to emit, and can never go stale: both sides restamp on every deploy.
    const factsSrc = fs.readFileSync('site/v1/record-facts.js', 'utf8');
    const m = /export const RECORD_FACTS = \{ date: ['"]([^'"]+)['"], count: (\d+) \};/.exec(factsSrc);
    expect(m, 'record-facts.js carries the single RECORD_FACTS literal').not.toBeNull();
    const facts = { date: (m ?? [])[1] ?? '', count: Number((m ?? [])[2]) };
    const page = fs.readFileSync('site/v1/index.html', 'utf8');
    const committed = /<span class="chip asof"[^>]*>.*?<\/span>/.exec(page)?.[0];
    expect(committed, 'index.html carries a static chip').toBeDefined();
    expect(chipHtml(facts)).toBe(committed);
  });
});

describe('build-v1-chip — JS source stamping', { tags: ['unit'] }, () => {
  it('StampRecordFacts_RewritesTheSingleLiteral_ToTheDerivedFacts', () => {
    const { js, replaced } = stampRecordFacts(SAMPLE_FACTS_JS, { date: '23 June 2026', count: 65 });
    expect(replaced).toBe(1);
    expect(js).toContain('export const RECORD_FACTS = { date: "23 June 2026", count: 65 };');
    expect(js).not.toContain('1 January 2000');
  });
});

describe('build-v1-chip — deploy integration', { tags: ['unit'] }, () => {
  function scaffold(holdings: object): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v1-chip-'));
    fs.writeFileSync(path.join(dir, 'holdings.json'), JSON.stringify(holdings));
    fs.writeFileSync(path.join(dir, 'record-facts.js'), SAMPLE_FACTS_JS);
    fs.writeFileSync(path.join(dir, 'index.html'), SAMPLE_PAGE);
    fs.writeFileSync(path.join(dir, 'callsign.html'), SAMPLE_PAGE);
    // A non-chip root page must be left untouched.
    fs.writeFileSync(path.join(dir, 'redirect.html'), '<html><body>go</body></html>');
    return dir;
  }

  const HOLDINGS = { count: 65, heldStartYear: 2013, latestYear: 2026, latestDateIso: '2026-06-23', publications: [], milestones: [] };

  it('BuildV1Chip_FromTheManifest_StampsTheJsSourceAndEveryChipPage', () => {
    const dir = scaffold(HOLDINGS);
    const { facts, pagesStamped } = buildV1Chip(dir);
    expect(facts).toEqual({ date: '23 June 2026', count: 65 });
    expect(pagesStamped.sort()).toEqual(['callsign.html', 'index.html']);
    expect(fs.readFileSync(path.join(dir, 'record-facts.js'), 'utf8'))
      .toContain('date: "23 June 2026", count: 65');
    for (const page of ['index.html', 'callsign.html']) {
      expect(fs.readFileSync(path.join(dir, page), 'utf8'))
        .toContain('Record as of 23 June 2026 · <b>65</b> publications held');
    }
    // The non-chip page is left exactly as written.
    expect(fs.readFileSync(path.join(dir, 'redirect.html'), 'utf8')).toBe('<html><body>go</body></html>');
  });

  it('BuildV1Chip_RunTwiceOverTheSameManifest_IsByteIdentical', () => {
    const a = scaffold(HOLDINGS);
    buildV1Chip(a);
    const first = fs.readFileSync(path.join(a, 'index.html'));
    const firstJs = fs.readFileSync(path.join(a, 'record-facts.js'));
    buildV1Chip(a);
    expect(fs.readFileSync(path.join(a, 'index.html')).equals(first)).toBe(true);
    expect(fs.readFileSync(path.join(a, 'record-facts.js')).equals(firstJs)).toBe(true);
  });

  it('BuildV1Chip_MissingRecordFactsSource_FailsLoud', () => {
    const dir = scaffold(HOLDINGS);
    fs.rmSync(path.join(dir, 'record-facts.js'));
    expect(() => buildV1Chip(dir)).toThrow(/record-facts\.js not found/);
  });

  it('BuildV1Chip_ManifestWithNoFiniteCount_FailsLoudRatherThanStampingNaN', () => {
    const dir = scaffold({ ...HOLDINGS, count: 'lots' });
    expect(() => buildV1Chip(dir)).toThrow(/no finite count/);
  });
});
