// @ts-check
// v1 ANATOMY PAGE BOOTSTRAP (issue #931): the page's body is hand-authored and
// fully readable with JavaScript off — the header, nav and footer read as
// served, the labelled diagram carries its own key table, and every coined term
// is a plain link to its glossary anchor. This script is progressive
// enhancement only: it re-mounts the shared chrome from the copy registry so the
// header, breadcrumb and footer stay in step with the rest of the v1 shell, and
// upgrades each inline term link into a click-toggled glossary popover using the
// SAME machinery (inlineTerm / wireTermPopovers) the dial and the other v1
// surfaces use — so the answer opens inline without leaving the prose, while the
// no-JS link out to the glossary still works.

import { renderSiteBar, renderBreadcrumb, renderFooter, mountInto } from './shell.js';
import { V1_COPY } from './copy.js';
import { inlineTerm, wireTermPopovers } from './glossary.js';

/** @typedef {keyof typeof V1_COPY.glossary} GlossaryKey */

// The glossary keys an inline term link may reference — the registry's own keys,
// so a page term can never point at a definition that does not exist.
const TERM_KEYS = new Set(Object.keys(V1_COPY.glossary));

/**
 * Upgrade every inline term link (`<a class="term-link" data-term="…">`) under
 * `root` into an inline glossary popover keyed to the same registry entry, using
 * the anchor's own text as the visible label so plurals and mid-sentence casing
 * are preserved. A link whose data-term is NOT a glossary key is left exactly as
 * authored — a plain, working link to its anchor — rather than replaced by an
 * empty popover, so a mistyped term fails visibly at author time, never silently
 * at runtime.
 * @param {ParentNode} root
 */
export function enhanceTermLinks(root) {
  for (const node of [...root.querySelectorAll('a.term-link[data-term]')]) {
    const key = node.getAttribute('data-term');
    if (key === null || !TERM_KEYS.has(key)) continue;
    const label = node.textContent ?? undefined;
    node.replaceWith(inlineTerm(/** @type {GlossaryKey} */ (key), label));
  }
}

/**
 * Make each table box a keyboard stop only while it actually scrolls. At phone
 * width some tables are wider than their panel and their box scrolls, which a
 * keyboard user can only do from a focused box; at other widths the same box
 * fits, and a tab stop there would do nothing. A scrolling box becomes a region
 * named by its own caption (aria-labelledby, so the caption is not read twice);
 * a box that fits loses all three attributes. Call again when the width
 * changes.
 * @param {ParentNode} root
 */
export function markScrollingTables(root) {
  let n = 0;
  for (const box of root.querySelectorAll('main .overflow')) {
    if (!(box instanceof HTMLElement)) continue;
    n += 1;
    const caption = box.querySelector('caption');
    if (box.scrollWidth > box.clientWidth + 1) {
      box.setAttribute('tabindex', '0');
      box.setAttribute('role', 'region');
      if (caption !== null) {
        if (caption.id === '') caption.id = `table-caption-${n}`;
        box.setAttribute('aria-labelledby', caption.id);
      }
    } else {
      box.removeAttribute('tabindex');
      box.removeAttribute('role');
      box.removeAttribute('aria-labelledby');
    }
  }
}

if (typeof document !== 'undefined' && document.querySelector('main[data-page="anatomy"]') !== null) {
  mountInto('sitebar', renderSiteBar('anatomy'));
  mountInto('breadcrumb', renderBreadcrumb([
    { label: V1_COPY.journeys.home, href: 'index.html' },
    { label: V1_COPY.journeys.anatomy },
  ]));
  mountInto('sitefooter', renderFooter());
  enhanceTermLinks(document);
  wireTermPopovers(document);
  markScrollingTables(document);
  window.addEventListener('resize', () => { markScrollingTables(document); });
}
