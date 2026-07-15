import { describe, it, expect } from 'vitest';
import { dateTime, dateTimeDisplay, relativeDateTime, DATE_TIME_CLASS, DEFAULT_DATE_TIME_PRECISION } from './format.ts';

// The shared date/time wrapper (issues #553, #551). Every displayed timestamp
// routes through `dateTime`, which shows the precision a surface asks for while
// always carrying the exact value in the title - "show less, lose nothing".
// Test names follow the Subject_Scenario_Outcome convention.

describe('dateTime wrapper', { tags: ['unit'] }, () => {
  it('DateTime_WhenPrecisionOmitted_FollowsTheYearMonthDefault', () => {
    // A usage happy to track the convention passes nothing and gets the
    // movable default precision (#551), currently year-month.
    expect(DEFAULT_DATE_TIME_PRECISION).toBe('year-month');
    const html = dateTime('2016-09-20');
    expect(html).toBe(`<span class="${DATE_TIME_CLASS}" title="2016-09-20">September 2016</span>`);
  });

  it('DateTime_WhateverPrecisionIsShown_TitleCarriesTheExactValue', () => {
    // The transparency rule: the exact value is recoverable from the title even
    // when the visible label is coarsened to a month.
    expect(dateTime('2016-09-20', { precision: 'year-month' })).toContain('title="2016-09-20"');
    expect(dateTime('2016-09-20T14:30:00Z', { precision: 'full-date' })).toContain('title="2016-09-20T14:30:00Z"');
    expect(dateTime('2016-09-20T14:30:00Z', { precision: 'year-month' })).toContain('title="2016-09-20T14:30:00Z"');
  });

  it('DateTime_WhenExactLabelGiven_TitleIsTheLabelledExactValue', () => {
    const html = dateTime('2016-09-20', { precision: 'year-month', exactLabel: 'Exact reported date' });
    expect(html).toContain('title="Exact reported date: 2016-09-20"');
    // The label is supplementary; the visible text stays the month.
    expect(html).toContain('>September 2016</span>');
  });

  it('DateTime_WhenExtraClassGiven_AppendsAfterTheStableClass', () => {
    const html = dateTime('2016-09', { extraClass: 'vpill' });
    expect(html).toContain(`class="${DATE_TIME_CLASS} vpill"`);
  });

  it('DateTime_WhenValueIsNotAnIsoDate_ReturnsItVerbatimAsItsOwnExactValue', () => {
    // A prose range or blank cell is never coerced into a fake date; the exact
    // text is both the display and the title.
    const html = dateTime('various 2016-2019');
    expect(html).toBe(`<span class="${DATE_TIME_CLASS}" title="various 2016-2019">various 2016-2019</span>`);
  });

  it('DateTime_WhenValueContainsMarkupCharacters_EscapesThemInBothDisplayAndTitle', () => {
    const html = dateTime('<b>&"', { exactLabel: 'When' });
    expect(html).toContain('title="When: &lt;b&gt;&amp;&quot;"');
    expect(html).toContain('>&lt;b&gt;&amp;&quot;</span>');
  });
});

describe('dateTime drift-guard (#553)', { tags: ['unit'] }, () => {
  it('DateTime_WhenPrecisionPinnedExplicitly_RendersThatPrecisionIndependentlyOfTheDefault', () => {
    // A usage that pins full-date states it in the options, so a future move of
    // the default (year-month) cannot silently coarsen it. Pinning to the
    // current default is likewise insulated from a later change.
    expect(dateTimeDisplay('2016-09-20', { precision: 'full-date' })).toBe('20 September 2016');
    expect(dateTimeDisplay('2016-09-20', { precision: 'year-month' })).toBe('September 2016');
  });
});

describe('dateTimeDisplay precision', { tags: ['unit'] }, () => {
  it('DateTimeDisplay_YearMonthPrecision_ShowsMonthAndYear', () => {
    expect(dateTimeDisplay('2016-09-20', { precision: 'year-month' })).toBe('September 2016');
    expect(dateTimeDisplay('2016-09', { precision: 'year-month' })).toBe('September 2016');
  });

  it('DateTimeDisplay_FullDatePrecision_ShowsTheDay', () => {
    expect(dateTimeDisplay('2016-09-20', { precision: 'full-date' })).toBe('20 September 2016');
  });

  it('DateTimeDisplay_DateTimePrecision_ShowsTheTimeInUtc', () => {
    expect(dateTimeDisplay('2016-09-20T14:30:00Z', { precision: 'date-time' })).toBe('20 September 2016 14:30 UTC');
  });

  it('DateTimeDisplay_WhenRequestedPrecisionExceedsWhatIsKnown_ClampsRatherThanFabricating', () => {
    // A month-only value asked to show a full date or a time cannot invent a
    // day or an hour, so it renders at the finest precision it actually holds.
    expect(dateTimeDisplay('2016-09', { precision: 'full-date' })).toBe('September 2016');
    expect(dateTimeDisplay('2016-09-20', { precision: 'date-time' })).toBe('20 September 2016');
  });
});

describe('dateTime humanisation', { tags: ['unit'] }, () => {
  it('DateTime_WhenHumanisedRelativeWithReference_ShowsThePhraseButKeepsTheExactValueInTitle', () => {
    const html = dateTime('2016-09-20', { humanise: 'relative', now: '2017-02-20' });
    expect(html).toContain('>5 months ago</span>');
    expect(html).toContain('title="2016-09-20"');
  });

  it('DateTime_WhenHumanisedRelativeWithoutReference_FallsBackToTheFormattedDate', () => {
    // Without a reference instant a generated page must not bake in a build
    // clock, so it degrades to the formatted display.
    const html = dateTime('2016-09-20', { humanise: 'relative' });
    expect(html).toContain('>September 2016</span>');
  });

  it('RelativeDateTime_AcrossUnits_ChoosesTheLargestFittingUnitAndPluralises', () => {
    expect(relativeDateTime('2020-01-01', '2020-01-01')).toBe('just now');
    expect(relativeDateTime('2020-01-01T00:00:00Z', '2020-01-01T00:01:00Z')).toBe('1 minute ago');
    expect(relativeDateTime('2020-01-01T00:00:00Z', '2020-01-01T05:00:00Z')).toBe('5 hours ago');
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
