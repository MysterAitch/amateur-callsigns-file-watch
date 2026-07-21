// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { todayMonthDay, humanMonthDay, enhanceOnThisDay } from './on-this-day.js';

// The on-this-day progressive enhancement (issue #726): a signpost to the
// viewer's own calendar day, added ON TOP of the complete static page — and
// the availability-trap wording when the day carries nothing. Test names
// follow Subject_Scenario_Outcome.

function pageWith(dayAnchorHtml: string): Document {
  document.body.innerHTML = `
    <main>
      <div data-page="on-this-day">
        <div id="today-slot"></div>
        ${dayAnchorHtml}
      </div>
    </main>`;
  return document;
}

describe('on-this-day enhancement', { tags: ['ui'] }, () => {
  it('TodayMonthDay_KnownDate_FormatsAsZeroPaddedMonthDay', () => {
    expect(todayMonthDay(new Date(2026, 0, 5))).toBe('01-05');
    expect(todayMonthDay(new Date(2026, 11, 25))).toBe('12-25');
    expect(humanMonthDay('01-05')).toBe('5 January');
  });

  it('Enhancement_TodayHasEntries_AddsAJumpCalloutAndMarksTheDay', () => {
    const doc = pageWith('<h3 id="d-10-10">10 October</h3><ul class="otd-day"><li>a</li><li>b</li></ul>');
    const result = enhanceOnThisDay(doc, new Date(2026, 9, 10));
    expect(result).toEqual({ monthDay: '10-10', found: true, entries: 2 });
    const callout = doc.querySelector('#today-slot .callout');
    expect(callout?.textContent).toMatch(/Today is 10 October/);
    expect(callout?.querySelector('a')?.getAttribute('href')).toBe('#d-10-10');
    expect(callout?.textContent).toMatch(/2 entries on this day/);
    expect(doc.getElementById('d-10-10')?.classList.contains('otd-today')).toBe(true);
  });

  it('Enhancement_TodayHasNoEntries_StatesNonObservationNeverNothingHappened', () => {
    const doc = pageWith('<h3 id="d-10-10">10 October</h3><ul class="otd-day"><li>a</li></ul>');
    const result = enhanceOnThisDay(doc, new Date(2026, 3, 1));
    expect(result).toEqual({ monthDay: '04-01', found: false, entries: 0 });
    const callout = doc.querySelector('#today-slot .callout');
    expect(callout?.textContent).toMatch(/places no first-of-series event on this day/);
    expect(callout?.textContent).toMatch(/non-observation/);
  });

  it('Enhancement_OnAnUnrelatedPage_DoesNothing', () => {
    document.body.innerHTML = '<main><div data-page="other"></div></main>';
    expect(enhanceOnThisDay(document, new Date(2026, 0, 1))).toBeNull();
  });
});
