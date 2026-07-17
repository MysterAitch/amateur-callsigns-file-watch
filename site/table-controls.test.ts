// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  csvField,
  markerCodepointForm,
  cellExportValue,
  tableToCsv,
  enhanceTable,
  initTableControls,
} from './table-controls.js';

// The shared per-table controls (issue #667): download the visible data,
// choose columns, and flip odd-character markers between friendly names and
// raw code points — all ADDED to an already-readable static table, never
// required for it to be read. Test names follow the Subject_Scenario_Outcome
// convention; the pure projection helpers are unit-tested, the DOM assembly in
// jsdom, and the canonical-at-rest export as a data-validity concern.

// Build a detached table from markup, attached to the document body so that
// insertion, querying and the download anchor all behave as they do on a page.
function makeTable(html: string): HTMLTableElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.append(host);
  const table = host.querySelector('table');
  if (table === null) throw new Error('test markup produced no table');
  return table;
}

// A representative static reference table: a row-header first column and two
// data columns, exactly the shape the anatomy and playground pages carry.
const RSL_TABLE = `
  <table data-table-controls>
    <caption>Regional Secondary Locator letters</caption>
    <thead><tr><th scope="col">Nation</th><th scope="col">All licences</th><th scope="col">Club only</th></tr></thead>
    <tbody>
      <tr><th scope="row">England</th><td>E</td><td>X</td></tr>
      <tr><th scope="row">Wales</th><td>W</td><td>C</td></tr>
    </tbody>
  </table>`;

// A table carrying an odd-character marker in a cell, the shape the callsign
// surfaces render when a published value hides an invisible character.
const MARKER_TABLE = `
  <table data-table-controls>
    <caption>Damaged callsigns</caption>
    <thead><tr><th scope="col">Raw</th><th scope="col">Note</th></tr></thead>
    <tbody>
      <tr><td>G0ABC<span class="marker">{NBSP}</span></td><td>trailing space</td></tr>
    </tbody>
  </table>`;

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('csvField', { tags: ['unit'] }, () => {
  it('CsvField_WhenValueHasNoSpecialCharacters_EmitsItBare', () => {
    expect(csvField('England')).toBe('England');
  });

  it('CsvField_WhenValueContainsCommaQuoteOrNewline_QuotesItAndDoublesInnerQuotes', () => {
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('line1\nline2')).toBe('"line1\nline2"');
  });
});

describe('markerCodepointForm', { tags: ['unit'] }, () => {
  it('MarkerCodepointForm_WhenFriendlyToken_RestatesItAsItsRawCodePoint', () => {
    expect(markerCodepointForm('{NBSP}')).toBe('{U+00A0}');
    expect(markerCodepointForm('{ZWSP}')).toBe('{U+200B}');
    expect(markerCodepointForm('{SP}')).toBe('{U+0020}');
  });

  it('MarkerCodepointForm_WhenAlreadyACodePointToken_ReturnsItUnchanged', () => {
    expect(markerCodepointForm('{U+00A0}')).toBe('{U+00A0}');
  });

  it('MarkerCodepointForm_WhenNotAMarkerToken_ReturnsItUnchanged', () => {
    expect(markerCodepointForm('England')).toBe('England');
    expect(markerCodepointForm('{U+FFFD}')).toBe('{U+FFFD}');
  });
});

describe('cellExportValue', { tags: ['unit', 'data-validity'] }, () => {
  it('CellExportValue_WhenPlainCell_CollapsesLayoutWhitespaceAndTrims', () => {
    const cell = makeTable('<table><tbody><tr><td>  England\n  </td></tr></tbody></table>').tBodies[0].rows[0].cells[0];
    expect(cellExportValue(cell)).toBe('England');
  });

  it('CellExportValue_WhenDataExportGiven_UsesTheExplicitCanonicalValue', () => {
    const cell = makeTable('<table><tbody><tr><td data-export="G0ABC ">shown</td></tr></tbody></table>').tBodies[0].rows[0].cells[0];
    expect(cellExportValue(cell)).toBe('G0ABC ');
  });

  it('CellExportValue_WhenCellHasAFriendlyMarker_ExportsItsRawCodePointNotTheFriendlyName', () => {
    const cell = makeTable('<table><tbody><tr><td>G0ABC<span class="marker">{NBSP}</span></td></tr></tbody></table>').tBodies[0].rows[0].cells[0];
    expect(cellExportValue(cell)).toBe('G0ABC{U+00A0}');
  });

  it('CellExportValue_WhenCellContainsAVisibleUnicodeGlyph_PreservesItVerbatim', () => {
    const cell = makeTable('<table><tbody><tr><td>café — €</td></tr></tbody></table>').tBodies[0].rows[0].cells[0];
    expect(cellExportValue(cell)).toBe('café — €');
  });
});

describe('tableToCsv', { tags: ['data-validity'] }, () => {
  it('TableToCsv_WhenAllColumnsVisible_EmitsAHeaderRowThenOneRowPerBodyRow', () => {
    const csv = tableToCsv(makeTable(RSL_TABLE));
    expect(csv).toBe('Nation,All licences,Club only\nEngland,E,X\nWales,W,C');
  });

  it('TableToCsv_WhenAColumnIsHidden_OmitsItFromEveryRow', () => {
    const table = makeTable(RSL_TABLE);
    for (const row of table.rows) row.cells[2].hidden = true; // hide "Club only"
    expect(tableToCsv(table)).toBe('Nation,All licences\nEngland,E\nWales,W');
  });

  it('TableToCsv_WhenEveryColumnIsHidden_ReturnsTheEmptyString', () => {
    const table = makeTable(RSL_TABLE);
    for (const row of table.rows) for (const cell of row.cells) cell.hidden = true;
    expect(tableToCsv(table)).toBe('');
  });

  it('TableToCsv_WhenBodyIsEmpty_EmitsTheHeaderRowAlone', () => {
    const table = makeTable('<table><thead><tr><th>A</th><th>B</th></tr></thead><tbody></tbody></table>');
    expect(tableToCsv(table)).toBe('A,B');
  });

  it('TableToCsv_WhenACellCarriesAMarker_ExportsTheCodePointForm', () => {
    const csv = tableToCsv(makeTable(MARKER_TABLE));
    expect(csv).toBe('Raw,Note\nG0ABC{U+00A0},trailing space');
  });
});

describe('enhanceTable', { tags: ['ui'] }, () => {
  it('EnhanceTable_WhenApplied_InsertsAKeyboardReachableControlsGroupBeforeTheTable', () => {
    const table = makeTable(RSL_TABLE);
    const controller = enhanceTable(table);
    expect(controller).not.toBeNull();
    const controls = table.previousElementSibling;
    expect(controls?.classList.contains('table-controls')).toBe(true);
    expect(controls?.getAttribute('role')).toBe('group');
    expect(controls?.getAttribute('aria-label')).toContain('Regional Secondary Locator');
    // The download control is a real button, reachable and labelled.
    const button = controls?.querySelector('button.tc-download');
    expect(button?.tagName).toBe('BUTTON');
    expect(button?.textContent).toBe('Download CSV');
  });

  it('EnhanceTable_WhenTableIsInsideAnOverflowWrapper_InsertsTheControlsAboveTheWrapper', () => {
    const table = makeTable(`<div class="overflow">${RSL_TABLE}</div>`);
    enhanceTable(table);
    const wrapper = table.parentElement;
    expect(wrapper?.classList.contains('overflow')).toBe(true);
    expect(wrapper?.previousElementSibling?.classList.contains('table-controls')).toBe(true);
  });

  it('EnhanceTable_WhenMoreThanOneColumn_OffersColumnSelectionAsCheckboxes', () => {
    const table = makeTable(RSL_TABLE);
    enhanceTable(table);
    const boxes = table.previousElementSibling?.querySelectorAll('.tc-colmenu input[type="checkbox"]');
    expect(boxes?.length).toBe(3);
    expect(Array.from(boxes ?? []).every(b => (b as HTMLInputElement).checked)).toBe(true);
  });

  it('EnhanceTable_WhenSingleColumn_OmitsColumnSelection', () => {
    const table = makeTable('<table><caption>One</caption><thead><tr><th>Only</th></tr></thead><tbody><tr><td>x</td></tr></tbody></table>');
    enhanceTable(table);
    expect(table.previousElementSibling?.querySelector('.tc-cols')).toBeNull();
  });

  it('EnhanceTable_WhenTableRendersNoMarkers_OmitsTheCodePointsToggle', () => {
    const table = makeTable(RSL_TABLE);
    enhanceTable(table);
    expect(table.previousElementSibling?.querySelector('.tc-codepoints')).toBeNull();
  });

  it('EnhanceTable_WhenTableRendersMarkers_OffersTheCodePointsToggle', () => {
    const table = makeTable(MARKER_TABLE);
    enhanceTable(table);
    expect(table.previousElementSibling?.querySelector('.tc-codepoints')).not.toBeNull();
  });

  it('EnhanceTable_WhenTableHasNoHeaderRow_DeclinesAndLeavesTheTableUntouched', () => {
    const table = makeTable('<table><tbody><tr><td>x</td></tr></tbody></table>');
    expect(enhanceTable(table)).toBeNull();
    expect(table.previousElementSibling).toBeNull();
  });

  it('EnhanceTable_WhenCalledTwice_DoesNotDoubleDecorate', () => {
    const table = makeTable(RSL_TABLE);
    enhanceTable(table);
    expect(enhanceTable(table)).toBeNull();
    expect(document.querySelectorAll('.table-controls').length).toBe(1);
  });
});

describe('column selection', { tags: ['ui'] }, () => {
  it('ColumnSelection_WhenAColumnIsUnchecked_HidesThatColumnAcrossHeadAndBody', () => {
    const table = makeTable(RSL_TABLE);
    enhanceTable(table);
    const clubBox = table.previousElementSibling?.querySelectorAll('.tc-colmenu input')[2] as HTMLInputElement;
    clubBox.checked = false;
    clubBox.dispatchEvent(new Event('change'));
    expect(table.tHead?.rows[0].cells[2].hidden).toBe(true);
    for (const row of table.tBodies[0].rows) expect(row.cells[2].hidden).toBe(true);
    // The other columns are untouched.
    expect(table.tHead?.rows[0].cells[0].hidden).toBe(false);
  });

  it('ColumnSelection_WhenEveryColumnIsUnchecked_ReportsAllColumnsHidden', () => {
    const table = makeTable(RSL_TABLE);
    enhanceTable(table);
    const boxes = table.previousElementSibling?.querySelectorAll('.tc-colmenu input') ?? [];
    for (const box of boxes) {
      (box as HTMLInputElement).checked = false;
      box.dispatchEvent(new Event('change'));
    }
    expect(table.previousElementSibling?.querySelector('.tc-status')?.textContent).toBe('All columns hidden.');
  });
});

describe('code-points display toggle', { tags: ['ui'] }, () => {
  it('CodePointsToggle_WhenSwitchedOn_FlipsFriendlyMarkersToRawCodePoints', () => {
    const table = makeTable(MARKER_TABLE);
    enhanceTable(table);
    const toggle = table.previousElementSibling?.querySelector('.tc-codepoints') as HTMLInputElement;
    const marker = table.querySelector('.marker');
    expect(marker?.textContent).toBe('{NBSP}');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    expect(marker?.textContent).toBe('{U+00A0}');
  });

  it('CodePointsToggle_WhenSwitchedBackOff_RestoresTheFriendlyNames', () => {
    const table = makeTable(MARKER_TABLE);
    enhanceTable(table);
    const toggle = table.previousElementSibling?.querySelector('.tc-codepoints') as HTMLInputElement;
    const marker = table.querySelector('.marker');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));
    expect(marker?.textContent).toBe('{NBSP}');
  });

  it('CodePointsToggle_WhenExportingWhileShowingCodePoints_KeepsTheExportCanonical', () => {
    const table = makeTable(MARKER_TABLE);
    enhanceTable(table);
    const toggle = table.previousElementSibling?.querySelector('.tc-codepoints') as HTMLInputElement;
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    // On screen or not, the export is the same canonical code-point form.
    expect(tableToCsv(table)).toBe('Raw,Note\nG0ABC{U+00A0},trailing space');
  });
});

describe('download', { tags: ['ui'] }, () => {
  let createObjectURL: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // jsdom implements neither of these; the download path needs both. Captured
    // into a local so the assertions never reference the method unbound.
    createObjectURL = vi.fn(() => 'blob:mock');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
  });

  it('Download_WhenClickedWithVisibleColumns_TriggersACsvDownloadAndReportsTheRowCount', () => {
    const table = makeTable(RSL_TABLE);
    enhanceTable(table);
    const clicked: string[] = [];
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this.getAttribute('download') ?? '');
    });
    const button = table.previousElementSibling?.querySelector('button.tc-download') as HTMLButtonElement;
    button.click();
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(clicked).toEqual(['regional-secondary-locator-letters.csv']);
    expect(table.previousElementSibling?.querySelector('.tc-status')?.textContent).toBe('Downloaded 2 rows.');
    clickSpy.mockRestore();
  });

  it('Download_WhenEveryColumnIsHidden_RefusesAndAsksForAColumn', () => {
    const table = makeTable(RSL_TABLE);
    enhanceTable(table);
    for (const row of table.rows) for (const cell of row.cells) cell.hidden = true;
    const button = table.previousElementSibling?.querySelector('button.tc-download') as HTMLButtonElement;
    button.click();
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(table.previousElementSibling?.querySelector('.tc-status')?.textContent).toBe('Select at least one column to download.');
  });
});

describe('initTableControls', { tags: ['ui'] }, () => {
  it('InitTableControls_WhenTablesOptIn_EnhancesOnlyTheOptedInOnes', () => {
    makeTable(RSL_TABLE);
    makeTable('<table><caption>Not opted in</caption><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>');
    const controllers = initTableControls();
    expect(controllers.length).toBe(1);
    expect(document.querySelectorAll('.table-controls').length).toBe(1);
  });

  it('InitTableControls_WhenTableRequestsCodepointsExplicitly_OffersTheToggleEvenWithNoMarkersYet', () => {
    makeTable('<table data-table-controls="codepoints"><caption>C</caption><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>');
    initTableControls();
    expect(document.querySelector('.tc-codepoints')).not.toBeNull();
  });
});
