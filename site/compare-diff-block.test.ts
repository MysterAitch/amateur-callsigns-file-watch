// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { diffBlock } from './compare.js';

// The set-difference/change sample tables on the Compare page (issue #199)
// render a status column for the same reason the entry browser's raw preview
// does: it is a per-row-repeated value, not a bounded breakdown, so the shared
// status field wrapper (#553/#625) is adopted with 'plain' glossary linking -
// consistent styling and humanised blanks, but never a link on every sample
// row. Test names follow the Subject_Scenario_Outcome convention.

describe('compare diffBlock field wrapper adoption (#625)', { tags: ['ui'] }, () => {
  it('DiffBlock_StatusColumn_RendersTheSharedStatFieldUnlinked', () => {
    const details = diffBlock('appeared', [{ callsign: 'M7TEE', cleaned: 'M7TEE', status: 'Allocated' }], ['callsign', 'cleaned', 'status']);
    const statCell = details.querySelector('td .stat');
    expect(statCell?.textContent).toBe('Allocated');
    expect(statCell?.querySelector('a')).toBeNull();
  });

  it('DiffBlock_StatusBeforeAndAfterColumns_BothRenderTheSharedStatField', () => {
    const details = diffBlock('status changed', [{ callsign: 'M7TEE', cleaned: 'M7TEE', status_before: 'Reserved', status_after: 'Allocated' }],
      ['callsign', 'cleaned', 'status_before', 'status_after']);
    const statCells = [...details.querySelectorAll('td .stat')];
    expect(statCells.map(c => c.textContent)).toEqual(['Reserved', 'Allocated']);
  });

  it('DiffBlock_BlankStatus_HumanisesRatherThanRenderingAnEmptyCell', () => {
    const details = diffBlock('appeared', [{ callsign: 'M7TEE', cleaned: 'M7TEE', status: '' }], ['callsign', 'cleaned', 'status']);
    expect(details.querySelector('td .stat-blank')?.textContent).toBe('(blank)');
  });

  it('DiffBlock_StatusValueThatIsNotAString_FallsBackToTheGenericNullAwareCell', () => {
    // A defensive branch: a diff row's status column is always a string in
    // practice, but a NULL from the database is `null`, not `''` - it must
    // stay the existing NULL rendering, not be mistaken for an asserted blank.
    const details = diffBlock('appeared', [{ callsign: 'M7TEE', cleaned: 'M7TEE', status: null }], ['callsign', 'cleaned', 'status']);
    expect(details.querySelector('td .stat')).toBeNull();
    const cells = [...details.querySelectorAll('tbody td')];
    expect(cells.at(-1)?.textContent).toBe('NULL');
  });

  it('DiffBlock_NonStatusColumn_IsUnaffectedByTheFieldWrapperAdoption', () => {
    const details = diffBlock('appeared', [{ callsign: 'M7TEE', cleaned: 'M7TEE' }], ['callsign', 'cleaned']);
    expect(details.querySelector('.stat')).toBeNull();
  });
});

describe('compare diffBlock inbound callsign links (#594)', { tags: ['ui'] }, () => {
  it('DiffBlock_CleanedColumn_LinksToTheCanonicalPerCallsignPage', () => {
    // The cleaned column IS the register's own callsign (the artefact-stripped
    // join key), so it now links to its canonical per-callsign page.
    const details = diffBlock('appeared', [{ callsign: 'M7TEE', cleaned: 'M7TEE', status: 'Allocated' }], ['callsign', 'cleaned', 'status']);
    const cleanedLink = details.querySelector('td a.callsign-pill');
    expect(cleanedLink?.getAttribute('href')).toBe('callsign.html?c=M7TEE');
    expect(cleanedLink?.textContent).toBe('M7TEE');
  });

  it('DiffBlock_RawCallsignColumn_RemainsANonLinkChip', () => {
    // The raw as-published callsign column stays a non-link chip: it is data
    // to inspect, never a navigation target, so #594's new inbound linking on
    // the cleaned column must not touch it.
    const details = diffBlock('appeared', [{ callsign: 'M7TEE ', cleaned: 'M7TEE', status: 'Allocated' }], ['callsign', 'cleaned', 'status']);
    const cells = [...details.querySelectorAll('tbody td')];
    const rawCell = cells[0];
    expect(rawCell.querySelector('a')).toBeNull();
    expect(rawCell.querySelector('code')).not.toBeNull();
  });

  it('DiffBlock_CleanedValueThatIsNotAString_FallsBackToTheGenericCodeCell', () => {
    // Defensive branch: a diff row's cleaned column is always a string in
    // practice, but a NULL from the database is `null`, not `''` - it must
    // stay the existing plain code cell rather than being coerced into a
    // broken link.
    const details = diffBlock('appeared', [{ callsign: 'M7TEE', cleaned: null, status: 'Allocated' }], ['callsign', 'cleaned', 'status']);
    expect(details.querySelector('td a.callsign-pill')).toBeNull();
    expect(details.querySelectorAll('tbody td code')[1]?.textContent).toBe('');
  });
});
