// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  csvField,
  markerCodepointForm,
  cellExportValue,
  tableToCsv,
  enhanceTable,
  initTableControls,
  isBlankSortValue,
  inferSortType,
  compareSortValues,
  sortedRowOrder,
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

// --- column sorting (issue #761): a reader can sort a data table by any column,
// as a pure enhancement over the already-rendered rows. The pure order/type
// logic is unit-tested; the injected trigger, its link-safety and its keyboard
// state are exercised in jsdom. ---

// The last header row's cell for a column — where the sort trigger is injected.
function headerCell(table: HTMLTableElement, col: number): HTMLTableCellElement {
  const head = table.tHead;
  if (head === null) throw new Error('table has no header');
  return head.rows[head.rows.length - 1].cells[col];
}

// The sort trigger injected into a column's header.
function sortButton(table: HTMLTableElement, col: number): HTMLButtonElement {
  const button = headerCell(table, col).querySelector('button.th-sort');
  if (button === null) throw new Error(`no sort trigger for column ${col}`);
  return button as HTMLButtonElement;
}

// The visible text of one body column, top to bottom — the reader's-eye order.
function bodyColumn(table: HTMLTableElement, col: number): string[] {
  return Array.from(table.tBodies[0].rows).map(row => row.cells[col].textContent?.trim() ?? '');
}

// A two-column table whose second column is numbers deliberately out of order,
// so a lexical sort (10, 100, 22, 9) is visibly wrong against a numeric one.
const NUMERIC_TABLE = `
  <table data-table-controls>
    <caption>Suffix counts</caption>
    <thead><tr><th scope="col">Suffix</th><th scope="col">Count</th></tr></thead>
    <tbody>
      <tr><th scope="row">ABC</th><td>9</td></tr>
      <tr><th scope="row">ABD</th><td>10</td></tr>
      <tr><th scope="row">ABE</th><td>100</td></tr>
      <tr><th scope="row">ABF</th><td>22</td></tr>
    </tbody>
  </table>`;

describe('sort — blank awareness', { tags: ['unit'] }, () => {
  it('IsBlankSortValue_WhenValueIsAnEmptyOrHumanisedBlank_ReportsItAsBlank', () => {
    for (const blank of ['', '   ', '(blank)', '(none)', 'N/A', '—', '–']) {
      expect(isBlankSortValue(blank)).toBe(true);
    }
  });

  it('IsBlankSortValue_WhenValueCarriesData_ReportsItAsNotBlank', () => {
    for (const value of ['0', 'England', '2016-01-01', '-3']) {
      expect(isBlankSortValue(value)).toBe(false);
    }
  });
});

describe('sort — type inference', { tags: ['unit'] }, () => {
  it('InferSortType_WhenEveryValueIsANumber_ReportsNumeric', () => {
    expect(inferSortType(['9', '10', '100', '22'])).toBe('numeric');
  });

  it('InferSortType_WhenNumbersArePunctuatedByBlanks_StillReportsNumeric', () => {
    expect(inferSortType(['9', '(blank)', '22', '—'])).toBe('numeric');
  });

  it('InferSortType_WhenEveryValueIsAnIsoDate_ReportsDate', () => {
    expect(inferSortType(['2016-01-01', '2020-12-31', '2019-06-30'])).toBe('date');
  });

  it('InferSortType_WhenValuesAreMixedText_ReportsText', () => {
    expect(inferSortType(['M3, M6, M7', 'G2', '9'])).toBe('text');
  });
});

describe('sort — comparator', { tags: ['unit'] }, () => {
  it('CompareSortValues_WhenNumeric_OrdersByMagnitudeNotLexically', () => {
    expect(compareSortValues('9', '100', 'numeric')).toBeLessThan(0);
    expect(compareSortValues('22', '9', 'numeric')).toBeGreaterThan(0);
  });

  it('CompareSortValues_WhenDate_OrdersChronologically', () => {
    expect(compareSortValues('2016-01-01', '2020-12-31', 'date')).toBeLessThan(0);
  });

  it('CompareSortValues_WhenText_OrdersByLocale', () => {
    expect(compareSortValues('England', 'Wales', 'text')).toBeLessThan(0);
  });
});

describe('sort — row order', { tags: ['unit'] }, () => {
  it('SortedRowOrder_WhenNumericAscending_ReturnsIndicesInMagnitudeOrder', () => {
    // keys 9,10,100,22 → ascending magnitude 9,10,22,100 → indices 0,1,3,2.
    expect(sortedRowOrder(['9', '10', '100', '22'], 'numeric', 'ascending')).toEqual([0, 1, 3, 2]);
  });

  it('SortedRowOrder_WhenDescending_ReversesTheMeaningfulValuesButKeepsBlanksLast', () => {
    // keys 5,(blank),2,— → descending 5,2 then blanks in authored order → 0,2,1,3.
    expect(sortedRowOrder(['5', '(blank)', '2', '—'], 'numeric', 'descending')).toEqual([0, 2, 1, 3]);
  });

  it('SortedRowOrder_WhenValuesAreEqual_KeepsTheirAuthoredOrder', () => {
    // A stable sort: the two "b"s and two "a"s keep their authored sequence.
    expect(sortedRowOrder(['b', 'a', 'b', 'a'], 'text', 'ascending')).toEqual([1, 3, 0, 2]);
  });
});

describe('column sorting', { tags: ['ui'] }, () => {
  it('NumericColumn_WhenSortedAscending_OrdersByMagnitudeNotLexically', () => {
    const table = makeTable(NUMERIC_TABLE);
    enhanceTable(table);
    sortButton(table, 1).click();
    expect(bodyColumn(table, 1)).toEqual(['9', '10', '22', '100']);
  });

  it('SortTrigger_WhenClickedRepeatedly_CyclesAscendingThenDescendingThenBackToAuthoredOrder', () => {
    const table = makeTable(NUMERIC_TABLE);
    enhanceTable(table);
    const th = headerCell(table, 1);
    const button = sortButton(table, 1);
    const authored = bodyColumn(table, 1);

    button.click();
    expect(bodyColumn(table, 1)).toEqual(['9', '10', '22', '100']);
    expect(th.getAttribute('aria-sort')).toBe('ascending');
    expect(button.getAttribute('aria-label')).toContain('currently sorted ascending');

    button.click();
    expect(bodyColumn(table, 1)).toEqual(['100', '22', '10', '9']);
    expect(th.getAttribute('aria-sort')).toBe('descending');

    button.click();
    expect(bodyColumn(table, 1)).toEqual(authored);
    expect(th.getAttribute('aria-sort')).toBe('none');
    expect(button.getAttribute('aria-label')).toContain('currently unsorted');
  });

  it('ColumnSorting_WhenAColumnMixesNumbersAndBlanks_SortsNumericallyWithBlanksLast', () => {
    const table = makeTable(`
      <table data-table-controls>
        <caption>Sparse counts</caption>
        <thead><tr><th scope="col">Row</th><th scope="col">Count</th></tr></thead>
        <tbody>
          <tr><th scope="row">A</th><td>5</td></tr>
          <tr><th scope="row">B</th><td>(blank)</td></tr>
          <tr><th scope="row">C</th><td>2</td></tr>
          <tr><th scope="row">D</th><td>—</td></tr>
        </tbody>
      </table>`);
    enhanceTable(table);
    sortButton(table, 1).click();
    // Numbers ascend, then the two blanks fall to the end in their authored order.
    expect(bodyColumn(table, 0)).toEqual(['C', 'A', 'B', 'D']);
  });

  it('SortTrigger_WhenSwitchingToAnotherColumn_UnsortsTheFirstColumn', () => {
    const table = makeTable(NUMERIC_TABLE);
    enhanceTable(table);
    sortButton(table, 1).click();
    sortButton(table, 0).click();
    expect(headerCell(table, 1).getAttribute('aria-sort')).toBe('none');
    expect(headerCell(table, 0).getAttribute('aria-sort')).toBe('ascending');
  });

  it('SortTrigger_WhenColumnHasFewerThanTwoBodyRows_IsNotInjected', () => {
    const table = makeTable('<table data-table-controls><caption>One row</caption><thead><tr><th>A</th><th>B</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table>');
    enhanceTable(table);
    expect(table.querySelector('button.th-sort')).toBeNull();
  });
});

describe('sort — header links', { tags: ['ui'] }, () => {
  it('DataHeaderLink_WhenColumnIsMadeSortable_IsNotHijackedAndKeepsItsOwnTabStop', () => {
    const table = makeTable(`
      <table data-table-controls>
        <caption>Linked header</caption>
        <thead><tr><th scope="col">Name</th><th scope="col"><a href="datasets/foo.html">Dataset</a></th></tr></thead>
        <tbody>
          <tr><th scope="row">b</th><td>2</td></tr>
          <tr><th scope="row">a</th><td>1</td></tr>
        </tbody>
      </table>`);
    enhanceTable(table);
    const th = headerCell(table, 1);
    const link = th.querySelector('a');
    const button = sortButton(table, 1);
    // The link is untouched, and the sort button is a separate node beside it.
    expect(link?.getAttribute('href')).toBe('datasets/foo.html');
    expect(link?.contains(button)).toBe(false);
    expect(button.contains(link as Node)).toBe(false);
    // Activating the sort button sorts; it never navigates the link.
    button.click();
    expect(th.getAttribute('aria-sort')).toBe('ascending');
    // The injected glyph never leaks into the CSV projection of the header.
    expect(tableToCsv(table).split('\n')[0]).toBe('Name,Dataset');
  });

  it('GlossaryHeaderLink_WhenColumnIsMadeSortable_BecomesAKeyboardFocusableHelpAffordanceWithARealName', () => {
    const table = makeTable(`
      <table data-table-controls>
        <caption>Glossary header</caption>
        <thead><tr><th scope="col"><a href="glossary.html#rsl">Regional Secondary Locator</a></th><th scope="col">Letter</th></tr></thead>
        <tbody>
          <tr><td>Wales</td><td>W</td></tr>
          <tr><td>England</td><td>E</td></tr>
        </tbody>
      </table>`);
    enhanceTable(table);
    const th = headerCell(table, 0);
    // The glossary link is demoted to a compact [?] help affordance, keeping its
    // destination and gaining a real accessible name — never a bare "?".
    const help = th.querySelector('a.th-help');
    expect(help?.getAttribute('href')).toBe('glossary.html#rsl');
    expect(help?.getAttribute('aria-label')).toBe('what does Regional Secondary Locator mean');
    expect(help?.textContent?.trim()).not.toBe('');
    // The header text itself is the sort trigger: a real, named button.
    const button = sortButton(table, 0);
    expect(button.getAttribute('aria-label')).toContain('sort by Regional Secondary Locator');
    button.click();
    expect(th.getAttribute('aria-sort')).toBe('ascending');
    expect(bodyColumn(table, 0)).toEqual(['England', 'Wales']);
    // The header still exports its clean canonical label, not the glyph or [?].
    expect(tableToCsv(table).split('\n')[0]).toBe('Regional Secondary Locator,Letter');
  });
});

describe('sort — progressive enhancement', { tags: ['ui'] }, () => {
  it('NoJavaScript_WhenTableIsNotEnhanced_HasNoSortTriggerOrSortStateAtAll', () => {
    const table = makeTable(NUMERIC_TABLE);
    // No enhanceTable / initTableControls: this is the JavaScript-off table.
    expect(table.querySelector('button.th-sort')).toBeNull();
    expect(table.querySelector('a.th-help')).toBeNull();
    expect(headerCell(table, 1).getAttribute('aria-sort')).toBeNull();
  });
});
