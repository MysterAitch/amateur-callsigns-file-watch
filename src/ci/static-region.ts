/**
 * The two halves every build-time no-script stamp shares (ADR 0022): writing a
 * render into a page's comment-marked region, and proving the markup a reader
 * receives parses back to the tree the render built. Used by the history
 * journeys' stamp and the home page's stamp.
 */

import { JSDOM } from 'jsdom';

/**
 * Replace every region delimited by `start` and `end` with `rendered`, reporting
 * how many were rewritten so the caller can fail loud on a page that lost its
 * markers or carries one twice.
 *
 * The delimiters are literal comments this repository authors, so they are
 * located by plain substring search, with no pattern over the page's markup
 * (issue #993's third case). Each opening marker pairs with the first closing
 * marker after it, so a page carrying two regions never swallows what lies
 * between them; an opening marker with no closing marker is not counted.
 *
 * A render that itself contains the closing marker would end its region early
 * on the next stamp and orphan the rest. The serialiser escapes `<` in text but
 * not inside an attribute value, so data carried in an attribute could spell it;
 * that is refused here rather than left to corrupt the following deploy.
 */
export function stampMarkedRegion(html: string, start: string, end: string, rendered: string): { html: string; replaced: number } {
  if (rendered.includes(end)) {
    throw new Error(`stampMarkedRegion: the render contains the region's closing marker ${JSON.stringify(end)}, so stamping it would corrupt the page on the next build`);
  }
  let replaced = 0;
  let out = '';
  let from = 0;
  for (;;) {
    const open = html.indexOf(start, from);
    if (open === -1) break;
    const close = html.indexOf(end, open + start.length);
    if (close === -1) break;
    out += `${html.slice(from, open)}${start}\n${rendered}\n${end}`;
    from = close + end.length;
    replaced += 1;
  }
  return { html: out + html.slice(from), replaced };
}

// The tree's shape in document order, as `depth:tag` steps. Compared either
// side of a serialise-and-reparse so a divergence names where it happened.
function treeShape(root: Element): string[] {
  const shape: string[] = [];
  const walk = (node: Element, depth: number): void => {
    shape.push(`${depth}:${node.nodeName.toLowerCase()}`);
    for (const child of node.children) walk(child, depth + 1);
  };
  walk(root, 0);
  return shape;
}

/**
 * Assert the serialised markup PARSES BACK to the tree that was rendered.
 *
 * A build-time render carries a hazard a browser-only render never meets: the
 * DOM it builds is not what the reader receives - the reader receives the
 * SERIALISED form, re-parsed. HTML's implied-end-tag rules can quietly restructure
 * that (a `<details>` ends an open `<p>`, so its following siblings escape the
 * paragraph). The render looks right in every jsdom unit test that never round-
 * trips, and wrong on the page.
 *
 * el()'s own guards refuse the nestings known to do this; this is the backstop
 * that would catch a rule nobody thought of, checked on the real output of every
 * build rather than on a fixture.
 */
export function assertReparsesIdentically(rendered: Element, html: string, where: string): void {
  const reparsed = new JSDOM(`<!DOCTYPE html><body>${html}</body>`).window.document.body.firstElementChild;
  if (reparsed === null) {
    throw new Error(`${where} serialised to markup that parses back to nothing`);
  }
  const before = treeShape(rendered);
  const after = treeShape(reparsed);
  const at = before.findIndex((step, i) => step !== after[i]);
  if (at !== -1 || before.length !== after.length) {
    const step = at === -1 ? before.length : at;
    throw new Error(`${where} does not survive serialisation - the markup a reader receives parses back to a DIFFERENT tree (${before.length} elements rendered, ${after.length} after reparse; first divergence at step ${step}: rendered "${before[step] ?? '(end)'}" vs reparsed "${after[step] ?? '(end)'}")`);
  }
}
