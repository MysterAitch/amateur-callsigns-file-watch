// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { resultCell } from './explore.js';

// The Explore console runs arbitrary hand-written SQL, so its result table has
// no fixed shape - but a column literally named "callsign" is common across
// the worked examples (SELECT c.callsign, n.callsign, ...) and, since issue
// #594, links to its canonical per-callsign page rather than rendering as
// inert text - the same inbound-linking convention every other results
// surface (lookup, entry browser, Compare) now follows. Test names follow the
// Subject_Scenario_Outcome convention.

describe('resultCell callsign-column linking (#594)', { tags: ['ui'] }, () => {
  it('ResultCell_WhenColumnIsCallsign_LinksToTheCanonicalPerCallsignPage', () => {
    const cell = resultCell('callsign', 'M7TEE');
    const link = cell.querySelector('a');
    expect(link?.getAttribute('href')).toBe('callsign.html?c=M7TEE');
    expect(link?.textContent).toBe('M7TEE');
  });

  it('ResultCell_WhenColumnNameMerelyContainsCallsign_IsNotTreatedAsTheCallsignColumn', () => {
    // Non-happy path: an arbitrary query can alias or select a differently
    // named column (e.g. home_callsign) that happens to hold a callsign-shaped
    // value - only the EXACT column name "callsign" is special-cased, since a
    // query's other columns can hold anything.
    const cell = resultCell('home_callsign', 'M0ABC');
    expect(cell.querySelector('a')).toBeNull();
    expect(cell.textContent).toBe('M0ABC');
  });

  it('ResultCell_WhenCallsignColumnValueIsNull_FallsBackToTheGenericNullCell', () => {
    // A query can legitimately select a NULL callsign (e.g. a LEFT JOIN miss);
    // it must render the existing "NULL" cell, never a broken link.
    const cell = resultCell('callsign', null);
    expect(cell.querySelector('a')).toBeNull();
    expect(cell.textContent).toBe('NULL');
    expect(cell.className).toBe('muted');
  });

  it('ResultCell_WhenCallsignColumnValueIsEmptyString_FallsBackToTheGenericTextCell', () => {
    // An empty string is a legitimate (if unusual) query result; it must not
    // become a link with no visible/accessible label.
    const cell = resultCell('callsign', '');
    expect(cell.querySelector('a')).toBeNull();
    expect(cell.textContent).toBe('');
  });

  it('ResultCell_WhenColumnIsNotCallsign_RendersTheExistingNullAwareTextCell', () => {
    expect(resultCell('status', 'Allocated').textContent).toBe('Allocated');
    expect(resultCell('record_count', 42).textContent).toBe('42');
    const nullCell = resultCell('status', null);
    expect(nullCell.textContent).toBe('NULL');
    expect(nullCell.className).toBe('muted');
  });
});
