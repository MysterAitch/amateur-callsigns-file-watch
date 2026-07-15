// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { dateTime, dateTimeDisplay, relativeDateTime, DATE_TIME_CLASS, DEFAULT_DATE_TIME_PRECISION } from './datetime.js';

// The browser-side date/time wrapper (issues #553, #551) mirrors the server-side
// dateTime so a timestamp reads the same on the hand-authored surfaces as on the
// generated pages: one stable class, the exact value always in the title. These
// tests pin the rendered markup and the show-less-lose-nothing guarantee. Test
// names follow the Subject_Scenario_Outcome convention.

// The element factory the front-ends hold (app.js / entry-browser.js), mirrored
// so the wrapper is exercised exactly as it is in the browser.
function el(tag: string, attrs: Record<string, string> = {}, children: Node[] = []): HTMLElement {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  for (const child of children) node.append(child);
  return node;
}

describe('browser dateTime wrapper', { tags: ['ui'] }, () => {
  it('DateTime_WhenPrecisionOmitted_FollowsTheYearMonthDefault', () => {
    expect(DEFAULT_DATE_TIME_PRECISION).toBe('year-month');
    const span = dateTime(el, '2016-09-20');
    expect(span.tagName).toBe('SPAN');
    expect(span.className).toBe(DATE_TIME_CLASS);
    expect(span.textContent).toBe('September 2016');
    expect(span.getAttribute('title')).toBe('2016-09-20');
  });

  it('DateTime_WhateverPrecisionIsShown_TitleCarriesTheExactValue', () => {
    // The transparency rule: the coarsened cell still exposes the exact value.
    const span = dateTime(el, '2016-09-20T14:30:00Z', { precision: 'year-month' });
    expect(span.textContent).toBe('September 2016');
    expect(span.getAttribute('title')).toBe('2016-09-20T14:30:00Z');
  });

  it('DateTime_WhenExactLabelGiven_TitleIsTheLabelledExactValue', () => {
    const span = dateTime(el, '2016-09-20', { precision: 'year-month', exactLabel: 'Exact reported date' });
    expect(span.getAttribute('title')).toBe('Exact reported date: 2016-09-20');
    expect(span.textContent).toBe('September 2016');
  });

  it('DateTime_WhenExtraClassGiven_AppendsAfterTheStableClass', () => {
    const span = dateTime(el, '2016-09', { extraClass: 'vpill' });
    expect(span.className).toBe(`${DATE_TIME_CLASS} vpill`);
  });

  it('DateTime_WhenHumanisedRelativeWithReference_ShowsThePhraseButKeepsTheExactValueInTitle', () => {
    const span = dateTime(el, '2016-09-20', { humanise: 'relative', now: '2017-02-20' });
    expect(span.textContent).toBe('5 months ago');
    expect(span.getAttribute('title')).toBe('2016-09-20');
  });

  it('DateTime_WhenValueIsNotAnIsoDate_ShowsItVerbatimAsItsOwnExactValue', () => {
    const span = dateTime(el, 'various 2016-2019');
    expect(span.textContent).toBe('various 2016-2019');
    expect(span.getAttribute('title')).toBe('various 2016-2019');
  });
});

describe('browser dateTime drift-guard (#553)', { tags: ['ui'] }, () => {
  it('DateTime_WhenPrecisionPinnedExplicitly_RendersThatPrecisionIndependentlyOfTheDefault', () => {
    // Pinning full-date insulates the usage from a future move of the default.
    expect(dateTimeDisplay('2016-09-20', { precision: 'full-date' })).toBe('20 September 2016');
    expect(dateTimeDisplay('2016-09-20', { precision: 'year-month' })).toBe('September 2016');
  });
});

describe('browser dateTimeDisplay', { tags: ['ui'] }, () => {
  it('DateTimeDisplay_WhenRequestedPrecisionExceedsWhatIsKnown_ClampsRatherThanFabricating', () => {
    expect(dateTimeDisplay('2016-09', { precision: 'full-date' })).toBe('September 2016');
    expect(dateTimeDisplay('2016-09-20', { precision: 'date-time' })).toBe('20 September 2016');
  });

  it('DateTimeDisplay_DateTimePrecision_ShowsTheTimeInUtc', () => {
    expect(dateTimeDisplay('2016-09-20T14:30:00Z', { precision: 'date-time' })).toBe('20 September 2016 14:30 UTC');
  });
});

describe('browser relativeDateTime', { tags: ['ui'] }, () => {
  it('RelativeDateTime_AcrossUnits_ChoosesTheLargestFittingUnitAndPluralises', () => {
    expect(relativeDateTime('2020-01-01', '2020-01-01')).toBe('just now');
    expect(relativeDateTime('2020-01-01', '2020-01-06')).toBe('5 days ago');
    expect(relativeDateTime('2020-01-01', '2020-04-01')).toBe('3 months ago');
    expect(relativeDateTime('2018-01-01', '2020-01-01')).toBe('2 years ago');
  });

  it('RelativeDateTime_WhenValueIsInTheFuture_UsesFromNowDirection', () => {
    expect(relativeDateTime('2020-06-01', '2020-01-01')).toBe('5 months from now');
  });

  it('RelativeDateTime_WhenEitherSideIsNotADate_ReturnsNull', () => {
    expect(relativeDateTime('not a date', '2020-01-01')).toBeNull();
    expect(relativeDateTime('2020-01-01', 'not a date')).toBeNull();
  });
});
