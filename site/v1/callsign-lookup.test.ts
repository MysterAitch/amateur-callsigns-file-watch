// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  buildCallsignModel,
  renderCallsignSections,
  currentStateNode,
  dialGeometry,
  describeLookupInput,
  lookupShape,
  operatingSuffixOf,
  boundedQuery,
  callsignPageTitle,
  QUERY_DISPLAY_MAX,
} from './callsign-sections.js';
// The real shared functions the deployed page loads at runtime, so the
// known-answer tables below exercise the cleaning rule actually used.
import { cleanCallsign } from '../ledger-query.js';
import { lookupBreadcrumb } from './callsign-page.js';
import { latestSummary, seenSummary, anatomyFigureParts, twinConflict } from '../callsign.js';
import { stripModel } from '../callsign-events.js';

type CallsignRecord = import('../callsign.js').CallsignRecord;
type ShardManifest = import('../callsign.js').ShardManifest;
type ShardDataset = import('../callsign.js').ShardDataset;

// What a visitor types into the lookup, and what the callsign page then says
// about it and about the record it finds. Every expected value in the tables
// below was decided before the code that produces it was written, so a fault
// shows as a disagreement rather than as something to judge.

beforeEach(() => {
  document.body.innerHTML = '';
  document.title = '';
});

function dataset(i: number, vintage: string | null, classes: string[], title = `publication ${i}`): ShardDataset {
  return { key: `k${i}`, lane: 'open-data', entry: `e${i}`, file: null, vintage, title, classes, href: '#', rows: 1, unkeyable: 0, intendedComplete: null, scopeNotes: '', coverageNote: '' };
}

function manifestOf(datasets: ShardDataset[]): ShardManifest {
  return {
    schemaVersion: 1,
    counts: { datasets: datasets.length, callsigns: 1, shards: 1, unkeyableRows: 0 },
    legend: { statuses: { O: 'Allocated', R: 'Reserved', A: 'Available' }, markers: {} },
    vocab: { product: [], type: [], impliedClass: [] },
    shards: ['G3U'],
    datasets,
  };
}

// The live archive's shape at the time of writing, reduced: an old register
// snapshot, then a newest publication split across two files of one date.
const ARCHIVE = manifestOf([
  dataset(0, '2016-09-20', ['register-snapshot'], 'Amateur callsign database, 20 September 2016'),
  dataset(1, '2026-09-22', ['register-snapshot'], 'Ofcom open data, 2026-09-22'),
  dataset(2, '2026-09-22', ['register-snapshot'], 'Ofcom open data, 2026-09-22'),
]);

function modelFor(record: CallsignRecord | null, manifest: ShardManifest, typed: string) {
  const cleaned = cleanCallsign(typed.trim());
  return buildCallsignModel({
    res: { key: record === null ? null : cleaned, record, cleaned, typed, input: describeLookupInput(typed, cleanCallsign) },
    manifest, eventRecord: null, eventMeta: null,
    latestSummary, seenSummary, anatomyFigureParts, twinConflict, stripModel,
  });
}

function render(record: CallsignRecord | null, manifest: ShardManifest, typed: string): HTMLElement {
  const root = document.createElement('div');
  renderCallsignSections(root, modelFor(record, manifest, typed));
  return root;
}

describe('Callsign lookup input: what was typed against what was looked up', { tags: ['unit'] }, () => {
  // typed → [looked up, characters left out, inner spaces removed, shape]
  const KNOWN: [string, string, string[], boolean, 'callsign' | 'unrecognised' | 'empty'][] = [
    ['M7TEE', 'M7TEE', [], false, 'callsign'],
    ['m7tee', 'M7TEE', [], false, 'callsign'],
    ['  M7TEE ', 'M7TEE', [], false, 'callsign'],
    ['M7 TEE', 'M7TEE', [], true, 'callsign'],
    ['hello world', 'HELLOWORLD', [], true, 'unrecognised'],
    ['12345', '12345', [], false, 'unrecognised'],
    ['!?!', '', ['!', '?'], false, 'empty'],
    ['M7TÉE', 'M7TE', ['É'], false, 'callsign'],
    ['M7TEE/P', 'M7TEE/P', [], false, 'callsign'],
    ['M/KQ4U', 'M/KQ4U', [], false, 'callsign'],
    ['GB200ADA', 'GB200ADA', [], false, 'callsign'],
    ['C', 'C', [], false, 'unrecognised'],
    ['', '', [], false, 'empty'],
    ['   ', '', [], false, 'empty'],
  ];

  for (const [typed, lookedUp, removed, spaces, shape] of KNOWN) {
    it(`LookupInput_Typed${JSON.stringify(typed)}_LooksUp${JSON.stringify(lookedUp)}AndSaysWhatWasLeftOut`, () => {
      const input = describeLookupInput(typed, cleanCallsign);
      expect(input.entered).toBe(typed.trim());
      expect(input.lookedUp).toBe(lookedUp);
      expect(input.removed).toEqual(removed);
      expect(input.spacesRemoved).toBe(spaces);
      expect(lookupShape(input.lookedUp)).toBe(shape);
    });
  }

  it('LookupInput_DecomposedAccent_NamesTheCombiningMarkByCodePoint', () => {
    // E followed by a combining acute: the mark is invisible on its own, so it is
    // named by code point rather than printed bare.
    const input = describeLookupInput('M7TÉE', cleanCallsign);
    expect(input.lookedUp).toBe('M7TEE');
    expect(input.removed).toEqual(['U+0301']);
  });

  const SUFFIXES: [string, { base: string, suffix: string } | null][] = [
    ['M7TEE/P', { base: 'M7TEE', suffix: 'P' }],
    ['MW0ABC/P', { base: 'MW0ABC', suffix: 'P' }],
    ['G4ABC/MM', { base: 'G4ABC', suffix: 'MM' }],
    ['M/KQ4U/P', { base: 'M/KQ4U', suffix: 'P' }],
    ['M/KQ4U', null],
    ['/P', null],
    ['HELLO/P', null],
    ['M7TEE', null],
  ];
  for (const [lookedUp, expected] of SUFFIXES) {
    it(`OperatingSuffix_LookedUp${JSON.stringify(lookedUp)}_${expected === null ? 'IsNotRead' : `SplitsOffSlash${expected.suffix}`}`, () => {
      expect(operatingSuffixOf(lookedUp)).toEqual(expected);
    });
  }

  it('BoundedQuery_ThreeHundredLetters_ShowsTheFirstFewAndCountsTheRest', () => {
    const q = boundedQuery('A'.repeat(300));
    expect(q.truncated).toBe(true);
    expect(q.length).toBe(300);
    expect(q.text).toBe(`${'A'.repeat(QUERY_DISPLAY_MAX)}…`);
  });

  it('BoundedQuery_ACallsign_IsShownWhole', () => {
    expect(boundedQuery('GB200ADA')).toEqual({ text: 'GB200ADA', truncated: false, length: 8 });
  });

  it('Breadcrumb_BeforeAnyLookup_EndsAtLookUpWithoutRepeatingIt', () => {
    expect(lookupBreadcrumb(null).map((c) => c.label)).toEqual(['Home', 'Look up']);
    expect(lookupBreadcrumb('').map((c) => c.label)).toEqual(['Home', 'Look up']);
  });

  it('Breadcrumb_AfterALookup_EndsWithTheLookedUpKeyNotTheRawInput', () => {
    const input = describeLookupInput(' m7 tée ', cleanCallsign);
    expect(lookupBreadcrumb(input.lookedUp).map((c) => c.label)).toEqual(['Home', 'Look up', 'M7TE']);
  });

  it('Breadcrumb_AfterAnOverlongLookup_EndsWithTheBoundedForm', () => {
    expect(lookupBreadcrumb('A'.repeat(300)).at(-1)?.label).toBe(`${'A'.repeat(QUERY_DISPLAY_MAX)}…`);
  });

  it('PageTitle_ForALookup_NamesTheCallsignBeforeThePageName', () => {
    expect(callsignPageTitle('M7TEE', 'Look up a callsign · callsign-record')).toBe('M7TEE · Look up a callsign · callsign-record');
  });

  it('PageTitle_ForAnOverlongQuery_CarriesOnlyTheBoundedForm', () => {
    const title = callsignPageTitle('A'.repeat(3000), 'Look up a callsign · callsign-record');
    expect(title.length).toBeLessThan(80);
    expect(title).toContain('…');
  });
});

describe('Callsign page: input that is not a held callsign', { tags: ['ui'] }, () => {
  it('FastAnswer_WellFormedButAbsentCallsign_KeepsTheRegisterSafeNoRecordWording', () => {
    const root = render(null, ARCHIVE, 'ZZ9ZZZ');
    const text = root.textContent ?? '';
    expect(root.querySelector('h1')?.textContent).toBe('ZZ9ZZZ');
    expect(text).toContain('No record for ZZ9ZZZ');
    expect(text).toContain('Absence here is never evidence about the register');
    expect(text).not.toContain('not shaped like a callsign');
  });

  for (const typed of ['hello world', '12345']) {
    it(`FastAnswer_${JSON.stringify(typed)}NotShapedLikeACallsign_SaysSoRatherThanOnlyNoRecord`, () => {
      const root = render(null, ARCHIVE, typed);
      const text = root.textContent ?? '';
      expect(text).toContain('is not shaped like a callsign this page recognises');
      // Still says nothing about the register, and still says it is not held.
      expect(text).toContain('No record for');
      expect(text).toContain('Absence here is never evidence about the register');
    });
  }

  it('FastAnswer_PunctuationOnly_SaysThereIsNothingToLookUp', () => {
    const root = render(null, ARCHIVE, '!?!');
    const text = root.textContent ?? '';
    expect(text).toContain('“!?!” has no letters or digits in it, so there is nothing to look up');
    expect(text).not.toContain('No record for');
    expect(text).not.toContain('This page looked up');
    expect(root.querySelectorAll('h1').length).toBe(1);
    expect(root.querySelector('h1')?.textContent).toBe('!?!');
  });

  it('FastAnswer_AccentedLetterLeftOut_ShowsWhatWasEnteredWhatWasLookedUpAndWhatWasLeftOut', () => {
    const root = render(null, ARCHIVE, 'M7TÉE');
    const text = root.textContent ?? '';
    expect(root.querySelector('h1')?.textContent).toBe('M7TE');
    expect(text).toContain('You entered “M7TÉE”. This page looked up M7TE.');
    expect(text).toContain('Left out: É');
  });

  it('FastAnswer_InnerSpaceInAFoundCallsign_SaysSpacesWereIgnored', () => {
    const record: CallsignRecord = { h: '.O.', l: { d: 1, s: ['O'] } };
    const root = render(record, ARCHIVE, 'g3 uo');
    expect(root.querySelector('h1')?.textContent).toBe('G3UO');
    expect(root.textContent ?? '').toContain('You entered “g3 uo”. This page looked up G3UO. Spaces are ignored.');
  });

  it('FastAnswer_CaseOnlyDifference_AddsNoNote', () => {
    const record: CallsignRecord = { h: '.O.', l: { d: 1, s: ['O'] } };
    const root = render(record, ARCHIVE, 'g3uo');
    expect(root.textContent ?? '').not.toContain('You entered');
  });

  it('FastAnswer_PortableSuffixMiss_OffersTheCallsignWithoutTheSuffixAsALink', () => {
    const root = render(null, ARCHIVE, 'M7TEE/P');
    const a = root.querySelector('a[href="callsign.html?c=M7TEE"]');
    expect(a).not.toBeNull();
    expect(root.textContent ?? '').toContain('M7TEE/P ends in what looks like an operating suffix (/P)');
  });

  it('FastAnswer_VisitorFormMiss_OffersNoSuffixLink', () => {
    const root = render(null, ARCHIVE, 'M/ZZ9Z');
    expect(root.textContent ?? '').not.toContain('operating suffix');
    expect(root.querySelector('a[href^="callsign.html?c="]')).toBeNull();
  });

  it('FastAnswer_OverlongQuery_HeadingShowsABoundedFormAndSaysHowLongTheInputWas', () => {
    const root = render(null, ARCHIVE, 'A'.repeat(300));
    expect(root.querySelector('h1')?.textContent).toBe(`${'A'.repeat(QUERY_DISPLAY_MAX)}…`);
    expect(root.textContent ?? '').toContain(`300 characters; the first ${QUERY_DISPLAY_MAX} are shown`);
  });

  // Markup-shaped strings, kept here as fixtures: each must come back as text.
  const MARKUP_SHAPED = [
    '<script>alert(1)</script>',
    '<img src=x onerror=alert(1)>',
    '"><b id="injected">x</b>',
    '</title><svg/onload=alert(1)>',
  ];
  for (const typed of MARKUP_SHAPED) {
    it(`FastAnswer_MarkupShapedInput${JSON.stringify(typed)}_RendersAsTextWithNoElementBorn`, () => {
      const root = render(null, ARCHIVE, typed);
      expect(root.querySelectorAll('script, img, svg, b#injected').length).toBe(0);
      for (const node of root.querySelectorAll('*')) {
        for (const attr of [...node.attributes]) expect(attr.name.startsWith('on')).toBe(false);
      }
      expect(root.textContent ?? '').toContain(`You entered “${typed}”`);
    });
  }
});

describe('Callsign page: a status from an older publication', { tags: ['ui'] }, () => {
  // G3UO in the live archive: seen only in 2016, absent from the newest publication.
  const STALE: CallsignRecord = { h: 'O..', l: { d: 0, s: ['O'] } };
  const CURRENT: CallsignRecord = { h: '.O.', l: { d: 1, s: ['O'] } };
  const CURRENT_IN_SIBLING_FILE: CallsignRecord = { h: '..O', l: { d: 2, s: ['O'] } };

  it('CallsignModel_StatusOnlyFromAnOldPublication_IsNotFromTheNewestAndNotInIt', () => {
    const m = modelFor(STALE, ARCHIVE, 'G3UO');
    expect(m.currency).toEqual({ asOf: '2016-09-20', newest: '2026-09-22', inNewest: false, statusFromNewest: false });
  });

  it('CallsignModel_StatusFromTheNewestPublication_IsFromTheNewestAndInIt', () => {
    expect(modelFor(CURRENT, ARCHIVE, 'G3UO').currency).toEqual({ asOf: '2026-09-22', newest: '2026-09-22', inNewest: true, statusFromNewest: true });
  });

  it('CallsignModel_ListedOnlyInTheSecondFileOfTheNewestPublication_StillCountsAsInTheNewest', () => {
    expect(modelFor(CURRENT_IN_SIBLING_FILE, ARCHIVE, 'G3UO').currency.inNewest).toBe(true);
  });

  it('CallsignModel_InTheNewestPoolListButStatusFromAnOlderSnapshot_KeepsTheTwoFactsApart', () => {
    const archive = manifestOf([dataset(0, '2016-09-20', ['register-snapshot']), dataset(1, '2026-09-22', ['available-pool'])]);
    const record: CallsignRecord = { h: 'O?', l: { d: 0, s: ['O'] } };
    expect(modelFor(record, archive, 'G3UO').currency).toEqual({ asOf: '2016-09-20', newest: '2026-09-22', inNewest: true, statusFromNewest: false });
  });

  it('CallsignModel_StatusPublicationUndated_IsNeverTreatedAsTheNewest', () => {
    const archive = manifestOf([dataset(0, null, ['register-snapshot']), dataset(1, '2026-09-22', ['register-snapshot'])]);
    const record: CallsignRecord = { h: 'O.', l: { d: 0, s: ['O'] } };
    expect(modelFor(record, archive, 'G3UO').currency).toEqual({ asOf: null, newest: '2026-09-22', inNewest: false, statusFromNewest: false });
  });

  it('FastAnswer_StatusOnlyFromAnOldPublication_NamesThatPublicationAndSaysItIsNotInTheNewest', () => {
    const root = render(STALE, ARCHIVE, 'G3UO');
    const head = root.querySelector('section[data-section="fast-answer"]')?.textContent ?? '';
    expect(head).toContain('Allocated');
    expect(head).toContain('Status as recorded in Amateur callsign database, 20 September 2016 (2016-09-20).');
    expect(head).toContain('Not in the newest publication held, dated 2026-09-22.');
    expect(head).toContain('This is the last status this mirror holds, not a reading of the register today');
    // No verdict about the register: nothing says the licence ended.
    for (const word of ['lapsed', 'no longer', 'expired', 'cancelled', 'revoked']) expect(head.toLowerCase()).not.toContain(word);
    // The green "live" dot is drawn only for a status the newest publication carries.
    expect(root.querySelector('.status-row .led')).toBeNull();
  });

  it('FastAnswer_StatusFromTheNewestPublication_KeepsTheDotAndSaysItIsTheNewest', () => {
    const root = render(CURRENT, ARCHIVE, 'G3UO');
    const head = root.querySelector('section[data-section="fast-answer"]')?.textContent ?? '';
    expect(root.querySelector('.status-row .led')).not.toBeNull();
    expect(head).toContain('Status as recorded in Ofcom open data, 2026-09-22, the newest publication held.');
    expect(head).not.toContain('Not in the newest publication');
  });

  it('FastAnswer_NoStatusRecordedAnywhere_DrawsNoDot', () => {
    // The one-letter row C in the live archive: listed in availability lists only.
    const archive = manifestOf([dataset(0, '2015-04-16', ['available-pool']), dataset(1, '2026-09-22', ['register-snapshot'])]);
    const root = render({ h: 'A.' }, archive, 'C');
    expect(root.querySelector('.status-row .led')).toBeNull();
    expect(root.textContent ?? '').toContain('Not in the newest publication held, dated 2026-09-22.');
  });

  it('EvidenceDialAndRail_StatusOnlyFromAnOldPublication_CallItTheLastRecordedStateNotTheCurrentOne', () => {
    const root = render(STALE, ARCHIVE, 'G3UO');
    const dialCap = root.querySelector('.scale .ev.state .cap')?.textContent ?? '';
    expect(dialCap).toContain('Allocated');
    expect(dialCap).toContain('last recorded');
    expect(dialCap).not.toContain('current state');
    const rail = root.querySelector('section[data-section="event-timeline"]')?.textContent ?? '';
    expect(rail).not.toContain('current state');
    expect(root.querySelector('.dial-legend')?.textContent ?? '').not.toContain('current state');
    expect(root.querySelector('.scale')?.getAttribute('aria-label') ?? '').not.toContain('current state');
  });

  it('EvidenceDial_StatusFromTheNewestPublication_StillCallsItTheCurrentState', () => {
    const root = render(CURRENT, ARCHIVE, 'G3UO');
    expect(root.querySelector('.scale .ev.state .cap')?.textContent ?? '').toContain('current state');
  });

  it('StateTerminus_NewerPoolSightingThanTheStatusPublication_IsDatedByThePublicationThatGaveTheStatus', () => {
    const archive = manifestOf([dataset(0, '2016-09-20', ['register-snapshot']), dataset(1, '2020-01-01', ['available-pool']), dataset(2, '2026-09-22', ['register-snapshot'])]);
    const model = modelFor({ h: 'OA.', l: { d: 0, s: ['O'] } }, archive, 'G3UO');
    expect(currentStateNode(model)?.day).toBe('2016-09-20');
  });
});

describe('Callsign page: structure and wording', { tags: ['ui'] }, () => {
  const html = fs.readFileSync(path.join('site', 'v1', 'callsign.html'), 'utf8');

  it('CallsignPage_EmptyStateWithNoScript_HasExactlyOneLevelOneHeading', () => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.querySelectorAll('h1').length).toBe(1);
  });

  it('CallsignPage_AfterALookupReplacesTheSections_StillHasExactlyOneLevelOneHeading', () => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    document.body.innerHTML = doc.body.innerHTML;
    const root = document.getElementById('sections');
    if (root === null) throw new Error('callsign.html has no #sections host');
    root.textContent = '';
    renderCallsignSections(root, modelFor({ h: '.O.', l: { d: 1, s: ['O'] } }, ARCHIVE, 'G3UO'));
    expect(document.querySelectorAll('h1').length).toBe(1);
  });

  it('CallsignSections_SectionTitles_AreExposedAsLevelTwoHeadings', () => {
    const root = render({ h: '.O.', l: { d: 1, s: ['O'] } }, ARCHIVE, 'G3UO');
    const headings = [...root.querySelectorAll('[role="heading"][aria-level="2"]')].map((h) => (h.textContent ?? '').trim());
    expect(headings.some((h) => h.startsWith('the evidence'))).toBe(true);
    expect(headings.some((h) => h.startsWith('what happened'))).toBe(true);
    expect(headings.some((h) => h.startsWith('anatomy'))).toBe(true);
    expect(headings.some((h) => h.startsWith('record fidelity'))).toBe(true);
  });

  it('EvidenceDial_WideScaleInANarrowBox_IsReachableByKeyboard', () => {
    const root = render({ h: '.O.', l: { d: 1, s: ['O'] } }, ARCHIVE, 'G3UO');
    const dial = root.querySelector('.dial');
    expect(dial?.getAttribute('tabindex')).toBe('0');
    expect(dial?.getAttribute('aria-label') ?? '').not.toBe('');
  });

  it('EvidenceDial_SpanOfSeventySixYears_DrawsNoMoreThanTwelveYearLabels', () => {
    // GB2RS in the live archive: a 2024 sighting and a reservation stated to end 2099-12-31.
    const geo = dialGeometry([{ day: '2099-12-31', label: 'reserved until', state: false, assertedBy: [] }], [{ vintage: '2024-09' }]);
    expect(geo.years.length).toBeGreaterThan(1);
    expect(geo.years.length).toBeLessThanOrEqual(12);
  });

  it('EvidenceDial_SpanOfNineYears_KeepsLabellingEverySecondYear', () => {
    // M7TEE's span: the spacing a short span already had is left alone.
    const geo = dialGeometry([{ day: '2018-10-18', label: 'licence issued', state: false, assertedBy: [] }], [{ vintage: '2026-06-23' }]);
    expect(geo.years.map((y) => y.year)).toEqual([2018, 2020, 2022, 2024, 2026]);
  });

  it('EvidenceDial_SpanOfFiveYears_LabelsEveryYear', () => {
    const geo = dialGeometry([{ day: '2021-04-16', label: 'licence issued', state: false, assertedBy: [] }], [{ vintage: '2025-06-23' }]);
    expect(geo.years.map((y) => y.year)).toEqual([2021, 2022, 2023, 2024, 2025, 2026]);
  });

  it('RelatedViews_RawDataLink_DescribesOnlyWhatThatPageOffers', () => {
    const root = render({ h: '.O.', l: { d: 1, s: ['O'] } }, ARCHIVE, 'G3UO');
    const extras = root.querySelector('section[data-section="extras"]')?.textContent ?? '';
    expect(extras).toContain('Get the raw data');
    expect(extras).not.toContain('per-entry zips');
  });
});
