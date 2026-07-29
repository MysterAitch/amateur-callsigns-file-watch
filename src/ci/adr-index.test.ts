import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { JSDOM } from 'jsdom';

// Decision-index contract.
//
// docs/adr/README.md is the entry point for "what has this project decided and
// why". Its value depends entirely on being COMPLETE: an index missing a row is
// worse than no index, because it is read as exhaustive and quietly is not.
//
// Nothing enforced that until #1029. ADR 0024's row was added by hand, and an
// omission would have been invisible — the failure mode is silent by
// construction, since the reader cannot miss what the index does not mention.
// That is the shape of defect this repo guards at design time rather than
// discovering later.
//
// Header format is now NORMALISED and enforced. The set previously carried three
// shapes (bullet `- Status:` versus bare `Status:`, `Relates:` versus `Related:`,
// and three title styles); #1029 converged them on the majority form. Only the
// PRESENTATION changed — every status, date and related-list value was carried
// across verbatim, so the append-only-history principle above is intact.
//
// Cross-reference integrity is asserted too. Records are only as discoverable as
// their links, and a renamed file breaks them silently: nothing about a dead
// `](0013-….md)` looks wrong until someone follows it.

const ADR_DIR = path.join('docs', 'adr');
const INDEX = path.join(ADR_DIR, 'README.md');

interface IndexRow { id: string; href: string; decision: string; reverses: string; status: string; date: string }

function adrFiles(): string[] {
  return fs.readdirSync(ADR_DIR).filter(f => /^\d{4}-.+\.md$/.test(f)).sort();
}

// The index is an HTML table, one cell per line, rendered by GitHub inside the
// Markdown page. Markdown was outgrown rather than disliked: a five-column pipe
// table put every row on one ~330-character line (max 436), so editing any single
// cell marked the whole row changed in a diff — the row-level-versus-claim-grain
// problem ADR 0024 sets out, reproduced in this project's own documentation. It
// also cannot hold a list inside a cell, which reversal conditions will want.
//
// Note markdown is NOT processed inside a raw HTML block, so cells carry real
// tags (`<strong>`, `<code>`, `<a>`) rather than markdown that would render
// literally.
//
// Parsed with jsdom — already a dependency for the render codebase (ADR 0022) —
// rather than by regular expression. A regex over HTML is right until the markup
// gains an attribute, a nested tag or a line break in a place it did not expect,
// at which point it fails by silently matching less rather than by erroring, and
// this file's whole purpose is to make silent under-coverage impossible.
function parsedIndex(): Document {
  return new JSDOM(fs.readFileSync(INDEX, 'utf8')).window.document;
}

function indexRows(): IndexRow[] {
  const table = parsedIndex().querySelector('table');
  if (table === null) throw new Error(`no <table> found in ${INDEX}`);
  return [...table.querySelectorAll('tbody tr')].map(tr => {
    const cells = [...tr.querySelectorAll('td')];
    if (cells.length !== 5) throw new Error(`index row has ${cells.length} cells, expected 5`);
    const anchor = cells[0].querySelector('a');
    if (anchor === null) throw new Error(`index row's first cell has no link: ${cells[0].textContent ?? ''}`);
    const id = (anchor.textContent ?? '').replace(/^ADR\s+/, '').trim();
    return {
      id,
      href: anchor.getAttribute('href') ?? '',
      decision: (cells[1].textContent ?? '').trim(),
      reverses: (cells[2].textContent ?? '').trim(),
      status: (cells[3].textContent ?? '').trim(),
      date: (cells[4].textContent ?? '').trim(),
    };
  });
}

function adrText(file: string): string {
  return fs.readFileSync(path.join(ADR_DIR, file), 'utf8').replace(/\r\n/g, '\n');
}

function headerField(file: string, field: 'Status' | 'Date' | 'Related'): string | null {
  const m = adrText(file).match(new RegExp(`^- ${field}:\\s*(.+)$`, 'm'));
  return m === null ? null : m[1].trim();
}

// A status may carry a qualifier — `accepted; implementation in progress` or
// `accepted (open-data lane complete; FOI lane on #455)`. Only the leading STATE
// must agree: qualifiers narrate progress and are expected to diverge in wording
// between a one-line index cell and the record itself. Splitting on the first
// `;` or `(` handles both shapes, including a `;` nested inside parentheses.
function statusHead(status: string): string {
  return status.split(/[;(]/)[0].trim().toLowerCase();
}

describe('ADR decision index', { tags: ['unit'] }, () => {
  it('EveryIndexRow_WhenParsed_CarriesAtLeastOneResolvableLink', () => {
    // A PER-ROW precondition, deliberately stronger than the aggregate checks.
    //
    // The aggregate link check can pass for the wrong reason: if the parser stops
    // seeing links — a markup change, a selector that no longer matches — it
    // reports zero broken links out of zero examined and goes green. That already
    // happened once here, when the table converted from markdown to HTML and the
    // markdown-only matcher quietly stopped covering 24 links.
    //
    // Anchoring the assertion to each ROW makes that failure impossible: a row
    // that yields no link fails on its own account, whatever the totals say.
    //
    // ONE link, not two. The first cell's ADR link is mandatory; the reversal cell
    // carries one only when it signposts to a longer discussion, so demanding two
    // would fail precisely on the rows that succeeded in compressing an answer.
    // Walks the DOM directly rather than going through `indexRows`, which throws
    // on a row it cannot parse. A throw is a fine failure mode but a poor
    // DIAGNOSTIC: it names the parser's disappointment, not the offending row.
    // This check exists to say which row is wrong and how.
    const table = parsedIndex().querySelector('table');
    if (table === null) throw new Error(`no <table> found in ${INDEX}`);
    const bodyRows = [...table.querySelectorAll('tbody tr')];
    expect(bodyRows.length, 'rows parsed from the index table').toBeGreaterThan(0);

    const faults: string[] = [];
    bodyRows.forEach((tr, i) => {
      const label = `row ${i + 1}`;
      const anchor = tr.querySelector('a[href]');
      if (anchor === null) { faults.push(`${label}: no link at all`); return; }
      const href = anchor.getAttribute('href') ?? '';
      const id = (anchor.textContent ?? '').replace(/^ADR\s+/, '').trim();
      if (href === '') faults.push(`${label}: link has no href`);
      else if (!fs.existsSync(path.resolve(ADR_DIR, href))) faults.push(`${label}: ${href} does not exist`);
      if (!/^\d{4}$/.test(id)) faults.push(`${label}: link text is not an ADR number ('${id}')`);
      else if (href !== '' && !href.startsWith(id)) faults.push(`${label}: labelled ADR ${id} but links to ${href}`);
    });
    expect(faults).toEqual([]);
  });

  it('EveryAdrFile_WhenTheIndexIsRead_HasExactlyOneRow', () => {
    const rows = indexRows();
    const indexed = rows.map(r => r.href).sort();
    expect(indexed).toEqual(adrFiles());
  });

  it('EveryIndexRow_WhenItsLinkIsFollowed_ResolvesToAFileThatExists', () => {
    for (const row of indexRows()) {
      expect(fs.existsSync(path.join(ADR_DIR, row.href)), `row ${row.id} -> ${row.href}`).toBe(true);
    }
  });

  it('EveryAdrFile_WhenParsed_DeclaresBothAStatusAndADate', () => {
    const missing = adrFiles().filter(f => headerField(f, 'Status') === null || headerField(f, 'Date') === null);
    expect(missing, 'ADRs missing a `- Status:` or `- Date:` header line').toEqual([]);
  });

  it('EveryAdrFile_WhenTitled_FollowsTheHouseFormatAndMatchesItsFilename', () => {
    // `# ADR NNNN — Title`. The number must match the filename, so a copied
    // template cannot leave a record announcing itself as a different decision.
    const wrong: string[] = [];
    for (const file of adrFiles()) {
      const first = adrText(file).split('\n')[0];
      const m = first.match(/^# ADR (\d{4}) — .+$/);
      if (m === null) wrong.push(`${file}: title is not '# ADR NNNN — Title' (${first})`);
      else if (m[1] !== file.slice(0, 4)) wrong.push(`${file}: title says ADR ${m[1]}`);
    }
    expect(wrong).toEqual([]);
  });

  it('EveryAdrCrossReference_WhenItNamesAnotherAdrByNumber_ResolvesToARecordThatExists', () => {
    // Dense cross-linking is only an asset while the links are real. A reference
    // to a record that does not exist is usually a typo in the number, which is
    // invisible on the page and misdirects the reader to nothing.
    const known = new Set(adrFiles().map(f => f.slice(0, 4)));
    const dangling: string[] = [];
    for (const file of adrFiles()) {
      for (const ref of adrText(file).matchAll(/\bADR (\d{4})\b/g)) {
        if (!known.has(ref[1])) dangling.push(`${file} references ADR ${ref[1]}, which does not exist`);
      }
    }
    expect([...new Set(dangling)]).toEqual([]);
  });

  it('EveryRelativeLinkInAnAdr_WhenFollowed_ResolvesToAFileOnDisk', () => {
    // The failure this catches is a RENAME elsewhere in the repo: nothing about a
    // dead link looks wrong until someone clicks it, so the rot is silent and the
    // index's discoverability claim quietly stops being true.
    // BOTH link forms. The index table is HTML (see `indexRows`), so a checker
    // that only understood markdown `](…)` would silently stop covering its 24
    // links the moment the table converted — passing not because the links are
    // sound but because it had stopped looking. The count assertion below exists
    // to make that failure mode impossible to reach quietly.
    const broken: string[] = [];
    let checked = 0;
    for (const file of adrFiles().concat('README.md')) {
      const text = adrText(file);
      // Markdown links by pattern (they are not HTML and jsdom cannot see them);
      // embedded HTML links through the parser, for the reason given above.
      const htmlHrefs = [...new JSDOM(text).window.document.querySelectorAll('a[href]')]
        .map(a => a.getAttribute('href') ?? '');
      const hrefs = [...[...text.matchAll(/\]\(([^)]+)\)/g)].map(m => m[1]), ...htmlHrefs];
      for (const raw of hrefs) {
        const href = raw.split('#')[0].trim();
        if (href === '' || /^(https?:|mailto:)/.test(href)) continue;
        checked++;
        if (!fs.existsSync(path.resolve(ADR_DIR, href))) broken.push(`${file} -> ${href}`);
      }
    }
    expect(broken).toEqual([]);
    expect(checked, 'links actually resolved — a green run over zero links proves nothing').toBeGreaterThan(50);
  });

  it('EveryIndexRow_WhenComparedToItsAdr_AgreesOnStatusAndDate', () => {
    const disagreements: string[] = [];
    for (const row of indexRows()) {
      const fileStatus = headerField(row.href, 'Status');
      const fileDate = headerField(row.href, 'Date');
      if (fileStatus !== null && statusHead(fileStatus) !== statusHead(row.status)) {
        disagreements.push(`${row.href}: index says '${row.status}', file says '${fileStatus}'`);
      }
      if (fileDate !== null && fileDate !== row.date) {
        disagreements.push(`${row.href}: index date '${row.date}', file date '${fileDate}'`);
      }
    }
    expect(disagreements).toEqual([]);
  });

  it('EveryIndexRow_WhenRead_StatesTheDecisionRatherThanRepeatingTheTitle', () => {
    // The index earns its keep by letting a reader judge relevance WITHOUT opening
    // the record, which a bare title cannot do. A length floor is a crude proxy,
    // but it catches the actual regression: a new row pasted in as a short title.
    const thin = indexRows().filter(r => r.decision.length < 40).map(r => `${r.id}: ${r.decision}`);
    expect(thin, 'index rows that state too little to judge relevance from').toEqual([]);
  });

  it('EveryIndexRow_WhenAskedWhatWouldReverseTheDecision_AnswersOrSaysItCannotBeCompressed', () => {
    // The column that keeps the index honest about the PRESENT rather than only
    // recording the past. A blank cell is the failure: it reads as "nothing would
    // reverse this", which is a far stronger claim than anyone meant to make.
    //
    // An explicit escape hatch is legitimate and expected — some conditions are
    // genuinely too situational to compress, and a forced one-liner would
    // overstate. What that costs is a SIGNPOST: say it does not compress, and
    // point at the record. Silence is not an option; vagueness must be declared.
    //
    // "Effectively nothing" and "not reversible as such" are NOT evasions — they
    // are complete answers, and requiring them to signpost elsewhere would be
    // asking for a pointer to a discussion that does not exist. Only a genuine
    // decline-to-compress owes the reader a destination.
    const bad: string[] = [];
    for (const row of indexRows()) {
      if (row.reverses === '' || row.reverses === '—') { bad.push(`${row.id}: empty`); continue; }
      const signposts = /see (the record|\[)|section\]|\.md\)/i.test(row.reverses);
      const declinesToCompress = /too situational|too many for one line/i.test(row.reverses);
      if (declinesToCompress && !signposts) bad.push(`${row.id}: declines to summarise without signposting where the answer is`);
      if (row.reverses.length < 25) bad.push(`${row.id}: too thin to be a condition ('${row.reverses}')`);
    }
    expect(bad).toEqual([]);
  });

  it('DecisionsRecordedOutsideTheAdrSet_WhenTheIndexIsRead_AreSignpostedWithTheirEnforcement', () => {
    // Durable decisions also live in issues, prose docs and code headers. Today
    // finding them meant grepping the repo; this section is the map. Each entry
    // must name WHERE the decision lives, so a pointer cannot degrade to a topic.
    const text = fs.readFileSync(INDEX, 'utf8');
    expect(text).toContain('Decisions recorded outside the ADR set');
    const section = text.slice(text.indexOf('Decisions recorded outside the ADR set'));
    const entries = section.split('\n').filter(l => /^\|\s*\*\*/.test(l));
    expect(entries.length, 'non-ADR decision homes listed').toBeGreaterThanOrEqual(6);
  });
});
