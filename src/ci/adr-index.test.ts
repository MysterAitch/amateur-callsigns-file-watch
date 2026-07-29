import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

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

interface IndexRow { id: string; href: string; decision: string; status: string; date: string }

function adrFiles(): string[] {
  return fs.readdirSync(ADR_DIR).filter(f => /^\d{4}-.+\.md$/.test(f)).sort();
}

// `| [0024](0024-….md) | decision text | accepted | 2026-07-29 |`
function indexRows(): IndexRow[] {
  const text = fs.readFileSync(INDEX, 'utf8').replace(/\r\n/g, '\n');
  const rows: IndexRow[] = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\|\s*\[(\d{4})\]\(([^)]+)\)\s*\|(.+?)\|(.+?)\|(.+?)\|\s*$/);
    if (m === null) continue;
    rows.push({ id: m[1], href: m[2], decision: m[3].trim(), status: m[4].trim(), date: m[5].trim() });
  }
  return rows;
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
    const broken: string[] = [];
    for (const file of adrFiles().concat('README.md')) {
      for (const link of adrText(file).matchAll(/\]\(([^)]+)\)/g)) {
        const href = link[1].split('#')[0].trim();
        if (href === '' || /^(https?:|mailto:)/.test(href)) continue;
        if (!fs.existsSync(path.resolve(ADR_DIR, href))) broken.push(`${file} -> ${href}`);
      }
    }
    expect(broken).toEqual([]);
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
