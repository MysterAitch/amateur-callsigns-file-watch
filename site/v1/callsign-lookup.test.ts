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
  lookupLabel,
  operatingSuffixOf,
  boundedQuery,
  callsignPageTitle,
  syncScrollerFocus,
  openAtState,
  holdStateInView,
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
type NewestRegister = { vintage: string, records: number };

// What a visitor types into the lookup, and what the callsign page then says
// about it and about the record it finds. Every expected value in the tables
// below was decided before the code that produces it was written, so a fault
// shows as a disagreement rather than as something to judge. Characters that are
// hard to see or to type are written as escapes.

beforeEach(() => {
  document.body.innerHTML = '';
  document.title = '';
});

function dataset(i: number, vintage: string | null, classes: string[], title = `publication ${i}`, rows = 1, unkeyable = 0): ShardDataset {
  return { key: `k${i}`, lane: 'open-data', entry: `e${i}`, file: null, vintage, title, classes, href: '#', rows, unkeyable, intendedComplete: null, scopeNotes: '', coverageNote: '' };
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
// snapshot, the newest whole register (163,341 keyed rows plus one unkeyable),
// and a 1,074-row partial file of the same date that is not the newest register.
const ARCHIVE = manifestOf([
  dataset(0, '2016-09-20', ['register-snapshot'], 'Amateur callsign database, 20 September 2016', 139758),
  dataset(1, '2026-09-22', ['register-snapshot'], 'Ofcom open data, 2026-09-22', 163341, 1),
  dataset(2, '2026-09-22', ['register-snapshot'], 'Ofcom open data, 2026-09-22', 1074),
]);
// holdings.json's latestRegister for ARCHIVE, as the build would write it.
const NEWEST: NewestRegister = { vintage: '2026-09-22', records: 163342 };

function modelFor(record: CallsignRecord | null, manifest: ShardManifest, typed: string, newestRegister: NewestRegister | null = NEWEST) {
  const cleaned = cleanCallsign(typed.trim());
  return buildCallsignModel({
    res: { key: record === null ? null : cleaned, record, cleaned, typed, input: describeLookupInput(typed, cleanCallsign) },
    manifest, eventRecord: null, eventMeta: null,
    latestSummary, seenSummary, anatomyFigureParts, twinConflict, stripModel,
    newestRegister,
  });
}

function render(record: CallsignRecord | null, manifest: ShardManifest, typed: string, newestRegister: NewestRegister | null = NEWEST): HTMLElement {
  const root = document.createElement('div');
  renderCallsignSections(root, modelFor(record, manifest, typed, newestRegister));
  return root;
}

const fastAnswer = (root: HTMLElement) => root.querySelector('section[data-section="fast-answer"]')?.textContent ?? '';

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
    ['/', '/', [], false, 'empty'],
    ['АБВ', '', ['А', 'Б', 'В'], false, 'empty'],
    ['١٢', '', ['١', '٢'], false, 'empty'],
    ['​', '', ['U+200B'], false, 'empty'],
    ['', '', [], false, 'empty'],
    ['   ', '', [], false, 'empty'],
  ];

  for (const [typed, lookedUp, removed, spaces, shape] of KNOWN) {
    it(`LookupInput_Typed${JSON.stringify(typed)}_LooksUp${JSON.stringify(lookedUp)}AndSaysWhatWasLeftOut`, () => {
      const input = describeLookupInput(typed, cleanCallsign);
      expect(input.entered).toBe(typed.trim());
      expect(input.lookedUp).toBe(lookedUp);
      expect(input.removed).toEqual(removed);
      expect(input.changed).toEqual([]);
      expect(input.spacesRemoved).toBe(spaces);
      expect(lookupShape(input.lookedUp)).toBe(shape);
    });
  }

  // Letters whose upper-case form lands in A-Z, so the old "cleans to its own
  // upper case" test let them through unannounced.
  const CHANGED: [string, string, { from: string, to: string }[]][] = [
    ['M7TıE', 'M7TIE', [{ from: 'ı', to: 'I' }]],
    ['M7TEß', 'M7TESS', [{ from: 'ß', to: 'SS' }]],
    ['M7TEEſ', 'M7TEES', [{ from: 'ſ', to: 'S' }]],
    ['M7TEﬁ', 'M7TEFI', [{ from: 'ﬁ', to: 'FI' }]],
  ];
  for (const [typed, lookedUp, changed] of CHANGED) {
    it(`LookupInput_Typed${JSON.stringify(typed)}_NamesTheLetterTheCleaningChanged`, () => {
      const input = describeLookupInput(typed, cleanCallsign);
      expect(input.lookedUp).toBe(lookedUp);
      expect(input.changed).toEqual(changed);
      expect(input.removed).toEqual([]);
    });
  }

  it('LookupInput_DecomposedAccent_NamesTheCombiningMarkByCodePoint', () => {
    const input = describeLookupInput('M7TÉE', cleanCallsign);
    expect(input.lookedUp).toBe('M7TEE');
    expect(input.removed).toEqual(['U+0301']);
  });

  it('LookupInput_RightToLeftOverride_IsNamedAndNeverShownRaw', () => {
    const input = describeLookupInput('M7TEE‮', cleanCallsign);
    expect(input.removed).toEqual(['U+202E']);
    expect(input.shown).toBe('M7TEE[U+202E]');
  });

  // Inputs with nothing to look up are labelled in fixed words, never by echoing
  // the input: a variation selector or a Hangul filler is invisible however it is
  // escaped, and would leave the heading, breadcrumb, and title blank.
  for (const typed of ['​', '️', 'ㅤ', '!?!', '/']) {
    it(`LookupLabel_NothingToLookUpIn${JSON.stringify(typed)}_IsFixedWordsNeverBlank`, () => {
      expect(lookupLabel(describeLookupInput(typed, cleanCallsign))).toBe('Nothing to look up');
    });
  }

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
    expect(q.text).toBe(`${'A'.repeat(QUERY_DISPLAY_MAX)}...`);
  });

  it('BoundedQuery_ACallsign_IsShownWhole', () => {
    expect(boundedQuery('GB200ADA')).toEqual({ text: 'GB200ADA', truncated: false, length: 8 });
  });

  it('Breadcrumb_BeforeAnyLookup_EndsAtLookUpWithoutRepeatingIt', () => {
    expect(lookupBreadcrumb(null).map((c) => c.label)).toEqual(['Home', 'Look up']);
    expect(lookupBreadcrumb('').map((c) => c.label)).toEqual(['Home', 'Look up']);
  });

  it('Breadcrumb_AfterAnOverlongLookup_EndsWithTheBoundedForm', () => {
    expect(lookupBreadcrumb('A'.repeat(300)).at(-1)?.label).toBe(`${'A'.repeat(QUERY_DISPLAY_MAX)}...`);
  });

  it('PageTitle_ForALookup_NamesTheCallsignBeforeThePageName', () => {
    expect(callsignPageTitle('M7TEE', 'Look up a callsign · callsign-record')).toBe('M7TEE · Look up a callsign · callsign-record');
  });

  it('PageTitle_ForAnOverlongQuery_CarriesOnlyTheBoundedForm', () => {
    const title = callsignPageTitle('A'.repeat(3000), 'Look up a callsign · callsign-record');
    expect(title.length).toBeLessThan(80);
    expect(title).toContain('...');
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
      expect(text).toContain('No record for');
      expect(text).toContain('Absence here is never evidence about the register');
    });
  }

  for (const [typed, quoted] of [['!?!', '!?!'], ['/', '/'], ['АБВ', 'АБВ'], ['١٢', '١٢']]) {
    it(`FastAnswer_${JSON.stringify(typed)}WithNoLetterAToZOrDigit_SaysThereIsNothingToLookUp`, () => {
      const root = render(null, ARCHIVE, typed);
      const text = root.textContent ?? '';
      expect(text).toContain(`"${quoted}" has no letters A to Z or digits 0 to 9 in it, so there is nothing to look up`);
      expect(text).not.toContain('No record for');
      expect(text).not.toContain('This page looked up');
      expect(root.querySelectorAll('h1').length).toBe(1);
      expect(root.querySelector('h1')?.textContent).toBe('Nothing to look up');
    });
  }

  it('FastAnswer_OnlyAZeroWidthSpace_QuotesItByCodePointUnderAFixedHeading', () => {
    const root = render(null, ARCHIVE, '​');
    expect(root.querySelector('h1')?.textContent).toBe('Nothing to look up');
    expect(root.querySelector('.callout bdi')?.textContent).toBe('[U+200B]');
    expect(root.textContent ?? '').not.toContain('​');
  });

  it('FastAnswer_AccentedLetterLeftOut_ShowsWhatWasEnteredWhatWasLookedUpAndWhatWasLeftOut', () => {
    const root = render(null, ARCHIVE, 'M7TÉE');
    const text = root.textContent ?? '';
    expect(root.querySelector('h1')?.textContent).toBe('M7TE');
    expect(text).toContain('You entered "M7TÉE". This page looked up M7TE.');
    expect(text).toContain('Left out: É');
  });

  it('FastAnswer_DotlessIInAHeldCallsign_SaysTheLetterWasReadAsI', () => {
    const record: CallsignRecord = { h: '.O.', l: { d: 1, s: ['O'] } };
    const root = render(record, ARCHIVE, 'G3UıO');
    expect(fastAnswer(root)).toContain('You entered "G3UıO". This page looked up G3UIO. Read as plain capitals: ı as I.');
  });

  it('FastAnswer_RightToLeftOverrideInTheInput_QuotesItIsolatedAndNamedNeverRaw', () => {
    const root = render(null, ARCHIVE, 'M7TEE‮');
    const note = root.querySelector('.lookup-input');
    expect(note?.querySelector('bdi')?.textContent).toBe('M7TEE[U+202E]');
    expect(root.textContent ?? '').not.toContain('‮');
  });

  it('FastAnswer_InnerSpaceInAFoundCallsign_SaysSpacesWereIgnored', () => {
    const record: CallsignRecord = { h: '.O.', l: { d: 1, s: ['O'] } };
    const root = render(record, ARCHIVE, 'g3 uo');
    expect(root.querySelector('h1')?.textContent).toBe('G3UO');
    expect(root.textContent ?? '').toContain('You entered "g3 uo". This page looked up G3UO. Spaces are ignored.');
  });

  it('FastAnswer_CaseOnlyDifference_AddsNoNote', () => {
    const record: CallsignRecord = { h: '.O.', l: { d: 1, s: ['O'] } };
    const root = render(record, ARCHIVE, 'g3uo');
    expect(root.textContent ?? '').not.toContain('You entered');
  });

  it('FastAnswer_PortableSuffixMiss_OffersTheCallsignWithoutTheSuffixAsALink', () => {
    const root = render(null, ARCHIVE, 'M7TEE/P');
    expect(root.querySelector('a[href="callsign.html?c=M7TEE"]')).not.toBeNull();
    expect(root.textContent ?? '').toContain('M7TEE/P ends in what looks like an operating suffix (/P)');
  });

  it('FastAnswer_VisitorFormMiss_OffersNoSuffixLink', () => {
    const root = render(null, ARCHIVE, 'M/ZZ9Z');
    expect(root.textContent ?? '').not.toContain('operating suffix');
    expect(root.querySelector('a[href^="callsign.html?c="]')).toBeNull();
  });

  it('FastAnswer_OverlongKeyWithALetterLeftOut_EndsTheLookedUpSentenceWithOneEllipsisNotFourDots', () => {
    const text = render(null, ARCHIVE, `${'A'.repeat(300)}É`).querySelector('.lookup-input')?.textContent ?? '';
    expect(text).toContain(`This page looked up ${'A'.repeat(QUERY_DISPLAY_MAX)}... Left out:`);
    expect(text).not.toContain('....');
  });

  it('FastAnswer_OverlongQuery_HeadingShowsABoundedFormAndSaysHowLongTheInputWas', () => {
    const root = render(null, ARCHIVE, 'A'.repeat(300));
    expect(root.querySelector('h1')?.textContent).toBe(`${'A'.repeat(QUERY_DISPLAY_MAX)}...`);
    expect(root.textContent ?? '').toContain(`300 characters; the first ${QUERY_DISPLAY_MAX} are shown`);
  });

  // The cases where the quoted input itself used to run unbounded: a long input
  // with something the cleaning left out, and one made of many distinct symbols.
  for (const [name, typed] of [
    ['ThreeHundredLettersAndAnAccent', `${'A'.repeat(300)}É`],
    ['LongCallsignShapedKeyEndingInSlashP', `A1${'A'.repeat(300)}/P`],
    ['ThreeHundredDistinctSymbols', Array.from({ length: 300 }, (_, i) => String.fromCodePoint(0x2190 + i)).join('')],
  ]) {
    it(`FastAnswer_${name}_QuotesAndListsOnlyABoundedPart`, () => {
      const root = render(null, ARCHIVE, typed);
      // Every text node in the answer, link text included: no unbroken run longer
      // than a bounded query (its "..." included) once the surrounding quotes and
      // punctuation are set aside.
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      const words: string[] = [];
      for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) words.push(...(n.textContent ?? '').split(/\s+/));
      expect(words.length).toBeGreaterThan(0);
      for (const word of words) expect(word.replace(/^["(]+|[".,):]+$/g, '').length, word).toBeLessThanOrEqual(QUERY_DISPLAY_MAX + 3);
    });
  }

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
      expect(root.textContent ?? '').toContain(`You entered "${boundedQuery(typed).text}"`);
    });
  }
});

describe('Callsign page: a status against the newest register snapshot held', { tags: ['ui'] }, () => {
  // G3UO in the live archive: seen only in 2016, absent from the newest register.
  const STALE: CallsignRecord = { h: 'O..', l: { d: 0, s: ['O'] } };
  const CURRENT: CallsignRecord = { h: '.O.', l: { d: 1, s: ['O'] } };

  it('CallsignModel_StatusOnlyFromAnOldRegister_IsNotFromTheNewestAndNotInIt', () => {
    expect(modelFor(STALE, ARCHIVE, 'G3UO').currency).toEqual({ known: true, asOf: '2016-09-20', newest: '2026-09-22', inNewest: false, statusFromNewest: false });
  });

  it('CallsignModel_StatusFromTheNewestRegister_IsFromTheNewestAndInIt', () => {
    expect(modelFor(CURRENT, ARCHIVE, 'G3UO').currency).toEqual({ known: true, asOf: '2026-09-22', newest: '2026-09-22', inNewest: true, statusFromNewest: true });
  });

  it('CallsignModel_ListedOnlyInAPartialFileOfTheSameDate_IsNotInTheNewestRegister', () => {
    // The newest register is the one file holdings.json names, not every file of its date.
    const m = modelFor({ h: '..O', l: { d: 2, s: ['O'] } }, ARCHIVE, 'G3UO');
    expect(m.currency.inNewest).toBe(false);
    expect(m.currency.statusFromNewest).toBe(false);
  });

  it('CallsignModel_NewestPublicationIsATinyPartialRegisterFile_TheWholeRegisterBeforeItKeepsItsDot', () => {
    // The live archive at 2025-06-08: a 1,074-row truncated file four days after a
    // whole register. The build names the whole one; the callsign keeps its dot.
    const archive = manifestOf([dataset(0, '2025-06-04', ['register-snapshot'], 'whole', 157427), dataset(1, '2025-06-08', ['register-snapshot'], 'truncated', 1074)]);
    const root = render({ h: 'O.', l: { d: 0, s: ['O'] } }, archive, 'M7TEE', { vintage: '2025-06-04', records: 157427 });
    expect(root.querySelector('.status-row .led')).not.toBeNull();
    expect(fastAnswer(root)).toContain('the newest register snapshot held');
  });

  it('CallsignModel_NewerAvailabilityListDoesNotListIt_TheRegisterStatusStaysCurrent', () => {
    // A newer publication of another kind never displaces the newest register.
    const archive = manifestOf([dataset(0, '2026-06-23', ['register-snapshot'], 'r', 158318), dataset(1, '2026-09-22', ['available-pool'], 'p', 77)]);
    const m = modelFor({ h: 'O.', l: { d: 0, s: ['O'] } }, archive, 'G3UO', { vintage: '2026-06-23', records: 158318 });
    expect(m.currency).toEqual({ known: true, asOf: '2026-06-23', newest: '2026-06-23', inNewest: true, statusFromNewest: true });
  });

  it('CallsignModel_HoldingsCouldNotBeRead_CurrencyIsUnknownNotCurrent', () => {
    expect(modelFor(CURRENT, ARCHIVE, 'G3UO', null).currency).toEqual({ known: false, asOf: '2026-09-22', newest: null, inNewest: false, statusFromNewest: false });
  });

  it('FastAnswer_HoldingsCouldNotBeRead_SaysTheCurrencyWasNotCheckedAndDrawsNoDot', () => {
    const root = render(CURRENT, ARCHIVE, 'G3UO', null);
    expect(fastAnswer(root)).toContain('Whether that is the newest register snapshot held could not be checked.');
    expect(root.querySelector('.status-row .led')).toBeNull();
    expect(root.querySelector('.dial-legend')?.textContent ?? '').toContain('not checked against the newest register snapshot held');
  });

  it('FastAnswer_StatusOnlyFromAnOldRegister_NamesThatRegisterAndSaysItIsNotInTheNewest', () => {
    const root = render(STALE, ARCHIVE, 'G3UO');
    const head = fastAnswer(root);
    expect(head).toContain('Allocated');
    expect(head).toContain('Status as recorded in Amateur callsign database, 20 September 2016 (2016-09-20).');
    expect(head).toContain('Not in the newest register snapshot held, dated 2026-09-22.');
    expect(head).toContain('This is the last status recorded for it in a register snapshot held, not a reading of the register today.');
    expect(head).toContain('Absence from one publication is never evidence about the register.');
    for (const word of ['lapsed', 'no longer', 'expired', 'cancelled', 'revoked', 'this mirror holds']) expect(head.toLowerCase()).not.toContain(word);
    expect(root.querySelector('.status-row .led')).toBeNull();
  });

  it('FastAnswer_LaterAvailabilityListCarriesItsOwnLetter_CallsTheStatusTheLastOneInARegisterSnapshot', () => {
    // Register 2016 says Allocated; a 2020 availability list marks it A; the newest
    // register does not list it. The availability letter is not a register status.
    const archive = manifestOf([
      dataset(0, '2016-09-20', ['register-snapshot'], 'Amateur callsign database, 20 September 2016', 139758),
      dataset(1, '2020-01-01', ['available-pool'], 'pool', 9000),
      dataset(2, '2026-09-22', ['register-snapshot'], 'Ofcom open data, 2026-09-22', 163342),
    ]);
    const head = fastAnswer(render({ h: 'OA.', l: { d: 0, s: ['O'] } }, archive, 'G3UO'));
    expect(head).toContain('This is the last status recorded for it in a register snapshot held');
    expect(head).not.toContain('this mirror holds');
  });

  it('FastAnswer_StatusFromTheNewestRegister_KeepsTheDotAndSaysItIsTheNewest', () => {
    const root = render(CURRENT, ARCHIVE, 'G3UO');
    expect(root.querySelector('.status-row .led')).not.toBeNull();
    expect(fastAnswer(root)).toContain('Status as recorded in Ofcom open data, 2026-09-22, the newest register snapshot held.');
    expect(fastAnswer(root)).not.toContain('Not in the newest');
  });

  it('FastAnswer_LatestRegisterRowHasABlankStatus_SaysListedWithNoStatusAndNothingAboutAStatus', () => {
    // G1BWQ's live shape: listed in 2016 with a blank status, absent since.
    const root = render({ h: '-..', l: { d: 0 } }, ARCHIVE, 'G1BWQ');
    const head = fastAnswer(root);
    expect(head).toContain('(no status recorded)');
    expect(head).toContain('Amateur callsign database, 20 September 2016 (2016-09-20) lists it with no status recorded.');
    expect(head).toContain('Not in the newest register snapshot held, dated 2026-09-22.');
    expect(head).not.toContain('Status as recorded in');
    expect(head).not.toContain('last status');
    expect(root.querySelector('.status-row .led')).toBeNull();
  });

  it('FastAnswer_NewestRegisterListsItWithABlankStatus_SaysSoAndDrawsNoDot', () => {
    // G1RRV's live shape: in the September 2026 register with a blank status.
    const root = render({ h: '.-.', l: { d: 1 } }, ARCHIVE, 'G1RRV');
    const head = fastAnswer(root);
    expect(head).toContain('The newest register snapshot held, Ofcom open data, 2026-09-22, lists it with no status recorded.');
    expect(head).not.toContain('Status as recorded in');
    expect(root.querySelector('.status-row .led')).toBeNull();
  });

  it('RecordFidelity_TwoRawRowsCleaningToOneKey_ShowsBothRowsVerbatim', () => {
    // 20MVL in the September 2026 register: "20MVL" Reserved, and "2#0MVL" with a
    // blank status, which cleans to the same key - one record, two raw rows.
    const record: CallsignRecord = { h: '.!.', l: { d: 1, s: ['R'] }, tw: [{ r: '2#0MVL' }, { r: '20MVL', s: 'R' }] };
    const fidelity = render(record, ARCHIVE, '20MVL').querySelector('section[data-section="record-fidelity"]')?.textContent ?? '';
    expect(fidelity).toContain('2#0MVL (no status recorded); 20MVL (Reserved)');
  });

  it('FastAnswer_NoStatusRecordedAnywhere_DrawsNoDot', () => {
    const archive = manifestOf([dataset(0, '2015-04-16', ['available-pool'], 'pool', 9000), dataset(1, '2026-09-22', ['register-snapshot'], 'r', 163342)]);
    const root = render({ h: 'A.' }, archive, 'C');
    expect(root.querySelector('.status-row .led')).toBeNull();
    expect(root.textContent ?? '').toContain('Not in the newest register snapshot held, dated 2026-09-22.');
  });

  it('EvidenceDialAndRail_StatusOnlyFromAnOldRegister_CallItTheLastRecordedStateNotTheCurrentOne', () => {
    const root = render(STALE, ARCHIVE, 'G3UO');
    const dialCap = root.querySelector('.scale .ev.state .cap')?.textContent ?? '';
    expect(dialCap).toContain('Allocated');
    expect(dialCap).toContain('last recorded');
    expect(dialCap).not.toContain('current state');
    expect(root.querySelector('section[data-section="event-timeline"]')?.textContent ?? '').not.toContain('current state');
    const legend = root.querySelector('.dial-legend')?.textContent ?? '';
    expect(legend).not.toContain('current state');
    expect(legend).not.toContain('this mirror holds');
    expect(root.querySelector('.scale')?.getAttribute('aria-label') ?? '').not.toContain('current state');
  });

  it('EvidenceDial_StatusFromTheNewestRegister_StillCallsItTheCurrentState', () => {
    expect(render(CURRENT, ARCHIVE, 'G3UO').querySelector('.scale .ev.state .cap')?.textContent ?? '').toContain('current state');
  });

  // The terminus, its rail entry and its legend sample are marked together, so
  // the stylesheet can draw all three apart from a current state.
  for (const [name, record, newest, marked] of [
    ['StatusOnlyFromAnOldRegister', STALE, NEWEST, true],
    ['HoldingsCouldNotBeRead', CURRENT, null, true],
    ['StatusFromTheNewestRegister', CURRENT, NEWEST, false],
  ] as const) {
    it(`StateMarks_${name}_${marked ? 'AreAllMarkedLastRecorded' : 'AreNoneMarkedLastRecorded'}`, () => {
      const root = render(record, ARCHIVE, 'G3UO', newest);
      const marks = ['.scale .ev.state', '.tl.state', '.dial-legend .dl-mk.state'].map((sel) => root.querySelector(sel));
      expect(marks.every((m) => m !== null)).toBe(true);
      expect(marks.map((m) => m?.getAttribute('data-currency') ?? null)).toEqual(marks.map(() => (marked ? 'last-recorded' : null)));
    });
  }

  it('StateTerminus_NewerPoolSightingThanTheStatusRegister_IsDatedByTheRegisterThatGaveTheStatus', () => {
    const archive = manifestOf([dataset(0, '2016-09-20', ['register-snapshot'], 'a', 139758), dataset(1, '2020-01-01', ['available-pool'], 'p', 9000), dataset(2, '2026-09-22', ['register-snapshot'], 'b', 163342)]);
    expect(currentStateNode(modelFor({ h: 'OA.', l: { d: 0, s: ['O'] } }, archive, 'G3UO'))?.day).toBe('2016-09-20');
  });
});

describe('Callsign page: structure and wording', { tags: ['ui'] }, () => {
  const html = fs.readFileSync(path.join('site', 'v1', 'callsign.html'), 'utf8');

  it('CallsignPage_EmptyStateWithNoScript_HasExactlyOneLevelOneHeading', () => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    expect(doc.querySelectorAll('h1').length).toBe(1);
  });

  it('CallsignSections_SectionTitles_AreExposedAsLevelTwoHeadingsNamedByTheirTitleAlone', () => {
    const root = render(CURRENT_RECORD(), ARCHIVE, 'G3UO');
    const names = [...root.querySelectorAll('[role="heading"][aria-level="2"]')].map((h) => h.getAttribute('aria-label') ?? (h.textContent ?? '').trim());
    expect(names).toEqual(['the evidence', 'what happened', 'anatomy', 'record fidelity']);
  });

  it('EvidenceDial_WhenMounted_ItsScaleScrollerIsNamedButNotATabStopUntilItIsKnownToScroll', () => {
    const scroller = render(CURRENT_RECORD(), ARCHIVE, 'G3UO').querySelector('.dial-scroll');
    expect(scroller?.getAttribute('aria-label') ?? '').not.toBe('');
    expect(scroller?.hasAttribute('tabindex')).toBe(false);
  });

  it('EvidenceDial_OnANarrowScreen_ScrollsOnlyItsScaleSoTheLabelsButtonsAndLegendStayInView', () => {
    // When the whole instrument scrolled, opening it at its newest end pushed the
    // track labels, the clock buttons and the legend off to the left.
    const dial = render(CURRENT_RECORD(), ARCHIVE, 'G3UO').querySelector('.dial');
    const scroller = dial?.querySelector('.dial-scroll');
    expect(scroller).not.toBeNull();
    expect([...(scroller?.children ?? [])].map((c) => c.className)).toEqual(['scale']);
    for (const sel of ['.tracklab', '.dial-ctl', '.dial-legend', '.dial-note']) {
      expect(dial?.querySelector(sel), sel).not.toBeNull();
      expect(scroller?.querySelector(sel), sel).toBeNull();
    }
    expect(dial?.hasAttribute('tabindex')).toBe(false);
  });

  // [state terminus x within the scale, or null for none, scale width, box width, opens at]
  for (const [stateX, scrollWidth, clientWidth, opensAt] of [
    [620, 638, 291, 347],   // terminus at the right-hand end (M7TEE at 375 wide): the far end
    [40, 638, 291, 0],      // terminus at the left, with a future-dated event far to its right (GB2RS)
    [320, 638, 291, 174.5], // terminus in the middle: centred in the box
    [null, 638, 291, 347],  // no terminus drawn: the newest end
    [620, 940, 940, 0],     // nothing scrolls
  ] as const) {
    it(`DialScroller_StateAt${stateX ?? 'None'}InA${scrollWidth}ScaleIn${clientWidth}Box_OpensScrolledTo${opensAt}`, () => {
      // The page is about the status, so a scrolling scale opens with the state
      // terminus in view, not at the earliest year.
      const scroller = render(CURRENT_RECORD(), ARCHIVE, 'G3UO').querySelector('.dial-scroll');
      if (scroller === null) throw new Error('no dial scroller');
      const state = scroller.querySelector('.ev.state');
      if (stateX === null) state?.remove();
      else if (state === null) throw new Error('no state terminus');
      // jsdom does no layout: the box sits at x=10 on the page, unscrolled.
      Object.defineProperty(scroller, 'scrollWidth', { value: scrollWidth });
      Object.defineProperty(scroller, 'clientWidth', { value: clientWidth });
      Object.defineProperty(scroller, 'scrollLeft', { value: 0, writable: true });
      scroller.getBoundingClientRect = () => DOMRect.fromRect({ x: 10, y: 0, width: clientWidth, height: 200 });
      if (stateX !== null && state !== null) state.getBoundingClientRect = () => DOMRect.fromRect({ x: 10 + stateX, y: 0, width: 0, height: 0 });
      openAtState(scroller);
      expect(scroller.scrollLeft).toBe(opensAt);
    });
  }

  // A scale whose layout can be changed mid-test, as a window narrowing does:
  // the terminus sits at x within a 638 px scale, in a box `width` wide.
  function narrowableScroller(stateX: number): { scroller: Element, setWidth: (w: number) => void } {
    const scroller = render(CURRENT_RECORD(), ARCHIVE, 'G3UO').querySelector('.dial-scroll');
    const state = scroller?.querySelector('.ev.state');
    if (scroller === null || scroller === undefined || state === null || state === undefined) throw new Error('no dial scroller or terminus');
    let width = 940;
    Object.defineProperty(scroller, 'scrollWidth', { get: () => Math.max(638, width) });
    Object.defineProperty(scroller, 'clientWidth', { get: () => width });
    Object.defineProperty(scroller, 'scrollLeft', { value: 0, writable: true });
    scroller.getBoundingClientRect = () => DOMRect.fromRect({ x: 10, y: 0, width, height: 200 });
    state.getBoundingClientRect = () => DOMRect.fromRect({ x: 10 + stateX - (scroller as HTMLElement).scrollLeft, y: 0, width: 0, height: 0 });
    return { scroller, setWidth: (w) => { width = w; } };
  }

  it('DialScroller_WindowNarrowedAfterOpening_ReCentresTheStatus', () => {
    // A phone turned from landscape to portrait: opened where nothing scrolls,
    // then narrowed to 291 px, the status at 620 must come into view.
    const { scroller, setWidth } = narrowableScroller(620);
    const reopen = holdStateInView(scroller);
    expect(scroller.scrollLeft).toBe(0);
    setWidth(291);
    reopen();
    expect(scroller.scrollLeft).toBe(347);
  });

  const gestures: [string, () => Event][] = [
    ['Wheel', () => new Event('wheel', { bubbles: true })],
    ['Pointer', () => new Event('pointerdown', { bubbles: true })],
    ['Touch', () => new Event('touchstart', { bubbles: true })],
    ['ArrowKey', () => new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })],
  ];
  for (const [name, gesture] of gestures) {
    it(`DialScroller_AfterTheReaderScrollsItBy${name}_IsNotMovedAgainOnResize`, () => {
      const { scroller, setWidth } = narrowableScroller(620);
      setWidth(291);
      const reopen = holdStateInView(scroller);
      expect(scroller.scrollLeft).toBe(347);
      scroller.dispatchEvent(gesture());
      (scroller as HTMLElement).scrollLeft = 100;
      setWidth(320);
      reopen();
      expect(scroller.scrollLeft).toBe(100);
    });
  }

  it('DialScroller_TabPassingThroughTheFocusedBox_DoesNotCountAsTheReaderScrolling', () => {
    const { scroller, setWidth } = narrowableScroller(620);
    const reopen = holdStateInView(scroller);
    scroller.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    setWidth(291);
    reopen();
    expect(scroller.scrollLeft).toBe(347);
  });

  for (const [scrollWidth, clientWidth, focusable] of [[638, 291, true], [940, 940, false], [600, 940, false]] as const) {
    it(`ScrollerFocus_ContentWidth${scrollWidth}InABox${clientWidth}Wide_${focusable ? 'TakesKeyboardFocus' : 'IsNoTabStop'}`, () => {
      const dial = render(CURRENT_RECORD(), ARCHIVE, 'G3UO').querySelector('.dial-scroll');
      if (dial === null) throw new Error('no dial');
      dial.setAttribute('tabindex', '0');
      Object.defineProperty(dial, 'scrollWidth', { value: scrollWidth });
      Object.defineProperty(dial, 'clientWidth', { value: clientWidth });
      syncScrollerFocus(dial);
      expect(dial.getAttribute('tabindex')).toBe(focusable ? '0' : null);
    });
  }

  it('EvidenceDial_SpanOfSeventySixYears_DrawsNoMoreThanTwelveYearLabels', () => {
    const geo = dialGeometry([{ day: '2099-12-31', label: 'reserved until', state: false, assertedBy: [] }], [{ vintage: '2024-09' }]);
    expect(geo.years.length).toBeGreaterThan(1);
    expect(geo.years.length).toBeLessThanOrEqual(12);
  });

  it('EvidenceDial_SpanOfNineYears_KeepsLabellingEverySecondYear', () => {
    const geo = dialGeometry([{ day: '2018-10-18', label: 'licence issued', state: false, assertedBy: [] }], [{ vintage: '2026-06-23' }]);
    expect(geo.years.map((y) => y.year)).toEqual([2018, 2020, 2022, 2024, 2026]);
  });

  it('EvidenceDial_SpanOfFiveYears_LabelsEveryYear', () => {
    const geo = dialGeometry([{ day: '2021-04-16', label: 'licence issued', state: false, assertedBy: [] }], [{ vintage: '2025-06-23' }]);
    expect(geo.years.map((y) => y.year)).toEqual([2021, 2022, 2023, 2024, 2025, 2026]);
  });

  it('RelatedViews_RawDataLink_PromisesOnlyTheArchiveAndHowTheDatabasesAreBuilt', () => {
    const extras = render(CURRENT_RECORD(), ARCHIVE, 'G3UO').querySelector('section[data-section="extras"]')?.textContent ?? '';
    expect(extras).toContain('Get the raw data');
    for (const promise of ['zip', 'SQLite', 'ledger', 'download the']) expect(extras).not.toContain(promise);
  });
});

function CURRENT_RECORD(): CallsignRecord {
  return { h: '.O.', l: { d: 1, s: ['O'] } };
}
