/**
 * The page shells and their chrome: the navigation strip and breadcrumb, the
 * shared design-token stylesheets, the footer/deploy provenance, the a11y
 * skip-link/<main> scaffolding, and the two page shells (htmlPage, entryPage)
 * plus the small notice strip. These are reused across the dataset, series,
 * reports and forbidden-suffix sections so every generated page reads as one
 * product; the section-specific logic lives in each section's own module.
 *
 * No behaviour of its own - the shells are the same ones the dataset-pages
 * build has always emitted, so the generated HTML is byte-for-byte unchanged.
 */

import * as fs from 'fs';
import * as path from 'path';
import { escapeHtml, externalLink, REPO_URL } from './html.ts';
import { humanDate } from './format.ts';

// This module lives one level below src/ci; the repo root is three parents up.
const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

// The shared design tokens (colour palette, light + dark) live once in
// site/tokens.css. The hand-authored pages @import it; the generated pages
// inline it here, read at build time, so the whole site derives its
// ink/paper/accent/line/muted colours from a single source. No bundler is
// involved - the file is read as plain text (ADR 0002/0003).
const SHARED_TOKENS_CSS = fs.readFileSync(path.join(REPO_ROOT, 'site', 'tokens.css'), 'utf8').trim();

// The shared affordance styling (issue #310), included on every generated
// page's stylesheet: the visually-hidden utility that carries text
// alternatives (e.g. the external-link "(opens in a new tab)") off-screen but
// available to assistive tech, and the small trailing ↗ external-link marker.
const SHARED_AFFORDANCE_CSS = [
  '.visually-hidden{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}',
  '.ext-marker{font-size:.85em;line-height:1;text-decoration:none}',
].join('');

// The shared database-loading alert (issue #499), inlined so the generated
// entry pages - which run the eager coordinated browser (entry-browser.js) but
// do NOT link site/style.css - surface a slow-load failure with the same
// assertive styling the hand-authored query pages carry. Mirrors the .db-alert
// block in site/style.css. The --warn tint the alert draws on is defined
// alongside the entry palette below (a fallback where ledger.css, which maps
// --warn to its signal colour under .ledger, has not loaded); the --waiting-*
// status tokens arrive with the shared palette (SHARED_TOKENS_CSS/tokens.css).
// The eager browser has no trigger button, so the button[data-state] rules are
// omitted - only the alert styling is needed here.
const SHARED_DB_ALERT_CSS = [
  '.db-alert{margin:.6rem 0 0;padding:.55rem .75rem;border-radius:6px;font-size:.9rem;background:color-mix(in srgb,var(--warn) 12%,var(--paper));border:1px solid color-mix(in srgb,var(--warn) 40%,var(--paper));color:var(--warn)}',
  '.db-alert[data-severity="integrity"]{border-width:2px;font-weight:600}',
  '.db-alert[hidden]{display:none}',
].join('');

// The callsign family styling: the shared field wrapper's stable class
// (issue #553 - a callsign never wraps mid-value, and its odd-character
// `.marker` highlights draw the --marker signal colour) and the pill chip
// (issue #310: small monospace, subtly tinted and bordered). Layered onto
// every stylesheet that renders callsigns as content - the entry-page shell
// (ENTRY_STYLE) and the plainer page shell (PAGE_STYLE, e.g. series pages) -
// each of which supplies --slot/--marker alongside the shared --line/--accent;
// focus-visible gives keyboard users a clear ring.
//
// The callsign-PART wrappers (issue #644 - a prefix series, a forbidden
// suffix) share this same `.cs` base class, so a part reads with the
// identical visual identity as the whole callsign it is a fragment of; the
// `.cs-pfx`/`.cs-sfx` modifiers only need to add the monospace font-family a
// plain `<span>`/link does not inherit the way `<code>` does by default.
const CALLSIGN_CSS = [
  '.cs{white-space:nowrap}',
  '.marker{color:var(--marker)}',
  '.cs-pfx,.cs-sfx{font-family:ui-monospace,monospace}',
  '.callsign-pill{display:inline-block;font-family:ui-monospace,monospace;font-size:.86rem;line-height:1.4;padding:.02rem .35rem;border:1px solid var(--line);border-radius:6px;background:var(--slot);color:var(--accent);text-decoration:none;white-space:nowrap}',
  '.callsign-pill:hover{border-color:var(--accent)}',
  '.callsign-pill:focus-visible{outline:2px solid var(--accent);outline-offset:1px}',
].join('');

// The register-status and licence-class/category field wrappers (issue #553):
// each carries its own stable class so a status/licence value never wraps
// mid-token; the blank forms (stat-blank/lic-blank) are plain <em> and need no
// styling of their own, matching the callsign wrapper's cs-blank precedent.
const STATUS_LICENCE_CSS = [
  '.stat{white-space:nowrap}',
  '.lic{white-space:nowrap}',
].join('');

// The minimal per-page stylesheet. It opens with the shared palette
// (SHARED_TOKENS_CSS) so adjacent pages read as one product, then layers a
// page-only --code tint and the bottom-ruled tables on top. The full entry
// layout (ENTRY_STYLE) layers on the same shared palette; a single shared
// stylesheet across every page is a later refactor.
const PAGE_STYLE = [
  '<style>',
  SHARED_TOKENS_CSS,
  // --slot (the pill's tint) is defined here as well as on the entry shell so
  // the shared callsign pill renders identically on the plainer page shell.
  ':root{--code:#f4f4f4;--slot:#faf9f6;--marker:#b23}@media(prefers-color-scheme:dark){:root{--code:#222;--slot:#141414;--marker:#e58}}',
  'body{font-family:system-ui,sans-serif;max-width:60rem;margin:2rem auto;padding:0 1rem;line-height:1.5;color:var(--ink);background:var(--paper)}',
  'a{color:var(--accent)}',
  'table{border-collapse:collapse;width:100%;margin:.75rem 0}td,th{border-bottom:1px solid var(--line);padding:.3rem .6rem;text-align:left;vertical-align:top}th{font-weight:600}',
  'code{background:var(--code);padding:0 .2rem}h1,h2{line-height:1.2}',
  'nav{color:var(--muted)}nav a{color:var(--accent);display:inline-block;padding:.3rem .15rem}',
  '.skip{position:absolute;left:-999px;top:0;z-index:10;padding:.5rem .8rem;background:Canvas;color:CanvasText;border:1px solid GrayText}.skip:focus{left:0}',
  '.breadcrumb{font-size:.9rem;color:var(--muted);margin:.6rem 0 .2rem}.breadcrumb a{color:var(--accent)}',
  // Matches ENTRY_STYLE's footer rule so the provenance line reads the same
  // whichever shell a generated page uses (#650).
  'footer{color:var(--muted);font-size:.83rem;margin-top:.6rem;line-height:1.6}footer a{color:var(--accent)}',
  SHARED_AFFORDANCE_CSS,
  CALLSIGN_CSS,
  STATUS_LICENCE_CSS,
  '</style>',
].join('');

// Short commit identifier for footers; 'dev' outside the deploy workflow.
const BUILD_SHA = (process.env.GITHUB_SHA ?? 'dev').slice(0, 9);
// Deploy provenance (set by the Pages workflow): the commit's own time, the
// build time, and a link to the exact GitHub Actions run that produced this
// deploy - so a reader can trace a page back to its origin. All optional so
// local/dev builds degrade gracefully.
const BUILD_COMMIT_TIME = process.env.BUILD_COMMIT_TIME ?? '';
const BUILD_TIME = process.env.BUILD_TIME ?? '';
const RUN_ID = process.env.GITHUB_RUN_ID ?? '';
const RUN_NUMBER = process.env.GITHUB_RUN_NUMBER ?? '';
const SERVER_URL = process.env.GITHUB_SERVER_URL ?? 'https://github.com';
const REPO_SLUG = process.env.GITHUB_REPOSITORY ?? '';

// An ISO timestamp as "9 July 2026 14:32 UTC" (empty in -> empty out).
function formatTimestamp(iso: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  return m === null ? '' : `${humanDate(m[1])} ${m[2]} UTC`;
}

// The deploy-provenance clause for the footer: commit time + a link to the
// Actions run that built this page, degrading to just the commit when the
// workflow env vars are absent.
function deployProvenance(): string {
  const commit = `commit <code>${escapeHtml(BUILD_SHA)}</code>${BUILD_COMMIT_TIME !== '' ? ` (committed ${escapeHtml(formatTimestamp(BUILD_COMMIT_TIME))})` : ''}`;
  let via = '';
  if (RUN_ID !== '' && REPO_SLUG !== '') {
    const runLabel = RUN_NUMBER !== '' ? `run #${escapeHtml(RUN_NUMBER)}` : 'the build run';
    const runLink = externalLink(`${SERVER_URL}/${REPO_SLUG}/actions/runs/${encodeURIComponent(RUN_ID)}`, runLabel, { escapeText: false });
    via = ` via ${runLink}${BUILD_TIME !== '' ? ` (${escapeHtml(formatTimestamp(BUILD_TIME))})` : ''}`;
  } else if (BUILD_TIME !== '') {
    via = ` on ${escapeHtml(formatTimestamp(BUILD_TIME))}`;
  }
  return `Regenerated from ${commit}${via}.`;
}

// The bespoke "ledger" visual language (site/ledger.css, scoped under
// `.ledger`) is the shared look the hand-authored pages already carry. The
// generated pages adopt it too (issue #394): they keep their own inline layout
// (PAGE_STYLE / ENTRY_STYLE) but link this one stylesheet - copied to the
// artefact root by the deploy alongside the hand-authored pages that link the
// same file (cicd.yaml) - so the ledger palette, header/panel chrome and
// census tables apply once the content is wrapped in `.ledger`. The href is
// resolved to the site root from the page's own depth, matching every other
// depth-relative link the shells emit. In the test/dev build the stylesheet is
// not copied into the scratch output, but nothing depends on it being fetched
// there; the link is inert and the markup assertions are unaffected.
function ledgerStylesheetLink(depthToRoot: number): string {
  return `<link rel="stylesheet" href="${'../'.repeat(depthToRoot)}ledger.css">`;
}

export interface PageOptions {
  metaJsonHref?: string;
  currentNav?: string;
  // Repo-relative path (forward slashes) of what this page presents: a
  // directory for entry pages, a file for rendered documents. Rendered as
  // a footer link to the exact GitHub location - both the way to browse
  // the raw data and the "edit this page" path (GitHub's own edit button
  // takes over from the blob view).
  sourcePath?: string;
}

// One consistent navigation strip on every generated page (no arrow - the
// old "← callsign lookup" wrongly implied where the visitor came from); the
// current page is named but not self-linked. Exported so the deploy-time nav
// injector (build-nav.ts) can stamp this same single-source strip into the
// hand-authored site/*.html pages - the nav list lives here and nowhere else.
export function navHtml(depthToRoot: number, currentNav?: string): string {
  const rootPath = '../'.repeat(depthToRoot);
  const navItems: [string, string][] = [
    ['Lookup', `${rootPath}index.html`],
    ['Statistics', `${rootPath}statistics.html`],
    ['Inter-dataset', `${rootPath}statistics/inter-dataset.html`],
    ['Explore', `${rootPath}explore.html`],
    ['Compare', `${rootPath}compare.html`],
    ['Dataset index', `${rootPath}datasets/index.html`],
    ['Publishers', `${rootPath}publishers/index.html`],
    ['Series', `${rootPath}series/index.html`],
    ['Forbidden suffixes', `${rootPath}forbidden/index.html`],
    ['Reports', `${rootPath}reports/index.html`],
    ['Data status', `${rootPath}data-status.html`],
    ['Ledger', `${rootPath}ledger.html`],
    ['Playground', `${rootPath}playground.html`],
    ['Anatomy', `${rootPath}callsign-structure.html`],
    ['Glossary', `${rootPath}glossary.html`],
    ['About', `${rootPath}about.html`],
    ['Repository', REPO_URL],
  ];
  return navItems
    .map(([label, href]) => {
      if (label === currentNav) return `<strong>${label}</strong>`;
      // The one external nav item (Repository → GitHub) carries the shared
      // leave-the-site affordance; internal navigation stays a plain link.
      return /^https?:/.test(href) ? externalLink(href, label) : `<a href="${href}">${label}</a>`;
    })
    .join(' · ');
}

// A breadcrumb trail above the H1 on deep pages (e.g. entry pages), telling
// the visitor where they are within the site's hierarchy. Ancestors link;
// the final crumb (the current page) is plain, marked aria-current.
export function breadcrumbHtml(crumbs: [label: string, href: string | undefined][]): string {
  const parts = crumbs.map(([label, href]) =>
    href === undefined ? `<span aria-current="page">${escapeHtml(label)}</span>` : `<a href="${href}">${escapeHtml(label)}</a>`);
  return `<nav class="breadcrumb" aria-label="Breadcrumb">${parts.join(' › ')}</nav>`;
}

function footerHtml(metaJsonHref?: string, sourcePath?: string): string {
  // Entry pages (those with a meta.json) carry per-entry provenance wording
  // linking THAT entry's meta and its archive directory. Aggregate pages
  // (indexes, rendered docs) are not archive entries, so the "this entry's
  // meta.json" boilerplate would be wrong there - they get a plain
  // provenance line pointing at the generating source instead.
  const isEntry = metaJsonHref !== undefined;
  const isFile = sourcePath !== undefined && /\.[a-z]+$/i.test(sourcePath);
  let sourceLink = '';
  if (sourcePath !== undefined) {
    const href = `${REPO_URL}/${isFile ? 'blob' : 'tree'}/main/${sourcePath}`;
    const text = isFile
      ? 'View or edit this page’s source on GitHub'
      : isEntry ? 'Browse this entry’s directory on GitHub' : 'Browse the source on GitHub';
    sourceLink = ` ${externalLink(href, text)}.`;
  }
  const lead = isEntry
    ? `Derived from the committed archive; provenance and integrity hashes live in this entry's <a href="${metaJsonHref}"><code>meta.json</code></a>.`
    : 'Generated from the committed archive.';
  // A <footer> landmark, not a bare <p><small>, so every generated page - entry
  // or otherwise - exposes the same single contentinfo region (#650).
  return `<footer>${lead}${sourceLink} ${deployProvenance()} Maintained by Roger Howell (M7TEE).</footer>`;
}

export function htmlPage(title: string, depthToRoot: number, body: string[], options: PageOptions = {}): string {
  const { metaJsonHref, currentNav, sourcePath } = options;
  return [
    '<!DOCTYPE html>',
    '<html lang="en-GB">',
    `<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>${PAGE_STYLE}${ledgerStylesheetLink(depthToRoot)}</head>`,
    '<body>',
    '<a class="skip" href="#main">Skip to content</a>',
    `<nav><p>${navHtml(depthToRoot, currentNav)}</p></nav>`,
    // Content adopts the ledger visual language; the nav and skip link stay
    // outside `.ledger`, styled by the shell's own tokens, exactly as on the
    // hand-authored pages.
    '<main id="main" class="ledger">',
    ...body,
    '</main>',
    footerHtml(metaJsonHref, sourcePath),
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

// Richer, card-based styling for the redesigned entry pages (the static
// half of "variant Q"): theme-aware via prefers-color-scheme, a hero
// column beside an At-a-glance sidebar, deep-linkable :target inspect tabs,
// the fixed-slot download grid, and the Notable coda. Entry pages only;
// the other generated pages keep PAGE_STYLE until the site-wide style pass.
const ENTRY_STYLE = [
  '<style>',
  // The shared palette (SHARED_TOKENS_CSS: --ink/--paper/--accent/--line/
  // --muted, light + dark) comes first so entry pages match the rest of the
  // site; the entry-only tokens below (cards, slots, warnings) layer on top.
  SHARED_TOKENS_CSS,
  // --warn (the alert tint) mirrors site/style.css so the shared db-alert reads
  // the same here; ledger.css remaps it under .ledger, this is the fallback.
  ':root{--card:#fff;--slot:#faf9f6;--good:#3f7d55;--warn:#8a3c00;--warnbg:#fbeee2;--warnline:#c98a3f;--warnink:#7a3d00;--note:#eef3f4;--bar:#c9d7dc;--marker:#b23}',
  '@media(prefers-color-scheme:dark){:root{--card:#191919;--slot:#141414;--good:#7fbf97;--warn:#e8a35c;--warnbg:#2a2016;--warnline:#8a5a1f;--warnink:#e8b877;--note:#15211f;--bar:#2c4048;--marker:#e58}}',
  '*{box-sizing:border-box}body{font-family:system-ui,sans-serif;margin:0;color:var(--ink);background:var(--paper);line-height:1.55}',
  '.wrap{max-width:76rem;margin:0 auto;padding:1.4rem 1.2rem 3rem}',
  'nav{font-size:.92rem;color:var(--muted)}nav a{color:var(--accent);text-decoration:none;display:inline-block;padding:.3rem .15rem}a{color:var(--accent)}',
  '.skip{position:absolute;left:-999px;top:0;z-index:10;padding:.5rem .8rem;background:var(--paper);color:var(--accent);border:1px solid var(--line)}.skip:focus{left:0}',
  'nav.breadcrumb{margin:.5rem 0 -.2rem}nav.breadcrumb a{text-decoration:none}',
  'h1{font-size:1.8rem;margin:.7rem 0 .1rem;line-height:1.15}.subtitle{color:var(--muted);margin:.1rem 0 1rem;font-size:.94rem}.subtitle code{color:var(--muted)}',
  'section{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:.9rem 1.2rem 1.1rem;margin:0 0 1.05rem}section>h2{font-size:1.02rem;margin:.2rem 0 .7rem}',
  '.notice{display:flex;gap:.5rem;align-items:baseline;font-size:.86rem;color:var(--muted);border:1px solid var(--line);border-left:4px solid var(--good);border-radius:8px;padding:.5rem .8rem;margin:0 0 1.05rem;background:var(--card)}',
  '.notice.warn{border:1px solid var(--warnline);border-left-width:4px;background:var(--warnbg);color:var(--warnink)}.notice b{color:inherit}',
  'details.notice.provenance{display:block}details.notice.provenance summary{cursor:pointer}details.notice.provenance .pdetail{margin-top:.5rem}details.notice.provenance .pdetail p{margin:.35rem 0}',
  '.main-region{display:flex;gap:1.05rem;align-items:flex-start;flex-wrap:wrap}',
  '.col{flex:1 1 26rem;order:1;min-width:0;display:flex;flex-direction:column;gap:1.05rem}.col section{margin:0}.side{flex:0 0 16.5rem;order:2}',
  '.nav-side{flex:0 0 13rem;order:0;font-size:.83rem}',
  '.nav-side h2{font-size:.95rem;margin:.2rem 0 .5rem}',
  '.dlist{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.35rem}.dlist li{margin:0}',
  '.dlist a{display:block;text-decoration:none;color:inherit}',
  '.dlist a>.dpitch,.dlist a>.dcap,.dcur>.dpitch,.dcur>.dcap{padding-inline:.5rem}',
  '.dlist a,.dcur{padding-block:.35rem;border:1px solid var(--line);border-radius:6px;background:var(--slot)}',
  '.dlist a:hover{border-color:var(--accent)}',
  '.dcur{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 10%,transparent)}',
  '.dpitch{display:block}.dpitch .src{color:var(--muted);font-weight:400;font-size:.76rem}.dpitch b{font-variant-numeric:tabular-nums}',
  '.gap{color:var(--muted);font-weight:400}',
  '.dcap{display:block;margin-top:.15rem;color:var(--muted);font-size:.76rem;line-height:1.3}',
  '.nav-side details{margin-top:.45rem}.nav-side summary{cursor:pointer;color:var(--muted);font-size:.78rem;padding:.2rem 0}.nav-side details .dlist{margin-top:.35rem}',
  '@media(max-width:48rem){.col{order:2;flex-basis:100%}.side{order:1;flex-basis:100%}.nav-side{order:3;flex-basis:100%}}',
  '.headline{font-size:1.5rem;font-weight:650;font-variant-numeric:tabular-nums;line-height:1.1}.headline small{font-size:.8rem;font-weight:400;color:var(--muted)}',
  '.bd{margin:.7rem 0 0}.bd h3{font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:.7rem 0 .3rem;font-weight:600}',
  '.brow{display:flex;align-items:baseline;gap:.4rem;font-size:.85rem;padding:.14rem 0;position:relative}.brow .lab{flex:1}.brow .lab a{color:var(--accent)}',
  '.brow .pct{color:var(--muted);font-size:.76rem;min-width:2.4rem;text-align:right}.brow b{font-variant-numeric:tabular-nums;font-weight:600;min-width:4rem;text-align:right}',
  '.brow .barbg{position:absolute;left:0;bottom:0;height:2px;background:var(--bar)}',
  '.lvl{color:var(--muted);font-weight:400;font-size:.85em}.prefixscroll{max-height:13rem;overflow-y:auto;margin-right:-.3rem;padding-right:.3rem}',
  '.seriesnav{color:var(--muted);text-decoration:none;font-size:.85em;display:inline-block;padding:.15rem .35rem}.seriesnav:hover{color:var(--accent)}',
  '.attr{margin-top:.9rem;padding-top:.7rem;border-top:1px solid var(--line);font-size:.82rem;color:var(--muted)}.attr a{color:var(--accent)}.attr div{margin:.15rem 0}.attr b{color:var(--ink)}',
  '.notable{margin-top:.9rem;padding-top:.7rem;border-top:1px solid var(--line)}.notable h3{font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:0 0 .3rem;font-weight:600}',
  '.notable ul{list-style:none;margin:0;padding:0}.notable li{font-size:.85rem;padding-left:1rem;position:relative;margin:.3rem 0}.notable li::before{content:"›";position:absolute;left:0;color:var(--accent)}.notable .rel{color:var(--muted)}.notable b{color:var(--ink)}',
  '.tablist{display:flex;flex-wrap:wrap;gap:.35rem;margin:.1rem 0 .8rem}.tablist a{font-size:.85rem;padding:.32rem .7rem;border:1px solid var(--line);border-radius:999px;color:var(--muted);text-decoration:none}',
  '.panel{display:none;scroll-margin-top:5rem}.panel:target{display:block}.tabs:not(:has(.panel:target)) .panel.first{display:block}',
  '.panel .lead{font-size:.9rem;color:var(--muted);margin:.1rem 0 .6rem}',
  'table{border-collapse:collapse;width:100%;font-size:.9rem}td,th{text-align:left;padding:.28rem .5rem;border-bottom:1px solid var(--line);vertical-align:top}th{font-weight:600}td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}',
  'code{font-size:.92em}',
  // Scoped data browser (progressive enhancement)
  '.chips{display:flex;flex-wrap:wrap;gap:.35rem;margin:.6rem 0 .5rem}',
  '.chip{font-size:.82rem;padding:.25rem .6rem;border:1px solid var(--line);border-radius:6px;color:var(--muted);cursor:pointer;background:var(--slot)}',
  '.chip.active{background:var(--accent);color:#fff;border-color:var(--accent)}.chip .c{opacity:.7;font-size:.76rem;margin-left:.3rem}',
  '.brow[data-filter-col]{cursor:pointer}.brow[data-filter-col]:hover .lab{text-decoration:underline}',
  '.browser-status{font-size:.83rem;color:var(--muted);margin:.4rem 0}.diffnote{color:var(--accent);font-size:.8rem}',
  // Coordinated browser: pills, toolbar, sortable headers, per-column filters
  // The active-facet pills are scoped under .pills so they out-specify the
  // ledger stylesheet's coverage-grid `.pill` (a same-named state glyph); the
  // entry shell loads after ledger.css, so this tie resolves to the pill look.
  '.pills{display:flex;flex-wrap:wrap;gap:.35rem;margin:.4rem 0}.pills .pill{display:inline-flex;align-items:center;gap:.3rem;font-size:.8rem;padding:.15rem .5rem;border:1px solid var(--accent);border-radius:999px;color:var(--accent);background:var(--slot)}',
  '.pills .pill.custom{border-style:dashed}.pills .pill button{border:none;background:none;color:inherit;cursor:pointer;font-size:.85rem;padding:0;line-height:1}',
  '.browser-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem;margin:.5rem 0 .2rem;font-size:.83rem}',
  '.pagesize{width:4.2rem;font:inherit;font-size:.82rem;padding:.15rem .3rem;border:1px solid var(--line);border-radius:5px;background:transparent;color:inherit}',
  'button.pg{font:inherit;font-size:.82rem;padding:.2rem .6rem;border:1px solid var(--line);border-radius:6px;background:var(--slot);color:var(--accent);cursor:pointer}button.pg:disabled{opacity:.4;cursor:default}',
  'th.sortable{cursor:pointer;white-space:nowrap}th.sortable:hover{color:var(--accent)}',
  'tr.colfilters th{padding:.15rem .3rem}tr.colfilters input{width:100%;min-width:5rem;font:inherit;font-size:.8rem;padding:.15rem .3rem;border:1px solid var(--line);border-radius:5px;background:transparent;color:inherit}',
  'rect.barfilter,text.tickfilter,.chart tr.explore{cursor:pointer}rect.barfilter:hover,text.tickfilter:hover{fill:var(--ink)}',
  '.examples{margin-top:.5rem}.examples summary{cursor:pointer;color:var(--accent);font-size:.86rem}.exlist{display:flex;flex-direction:column;gap:.25rem;margin-top:.4rem;align-items:flex-start}',
  'button.exq{font:inherit;font-size:.83rem;padding:.2rem .5rem;border:1px solid var(--line);border-radius:6px;background:var(--slot);color:var(--accent);cursor:pointer;text-align:left}',
  '.sqlbox{margin-top:.6rem}.sqlbox summary{cursor:pointer;color:var(--accent);font-size:.86rem}',
  '.sqlbox textarea{width:100%;font-family:ui-monospace,monospace;font-size:.85rem;padding:.5rem;border:1px solid var(--line);border-radius:6px;background:transparent;color:inherit;margin-top:.4rem}',
  '.sqlbox button.run{font:inherit;font-size:.85rem;padding:.3rem .8rem;margin-top:.4rem;border:1px solid var(--accent);border-radius:6px;background:var(--accent);color:#fff;cursor:pointer}',
  '.tier h3{font-size:.75rem;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:.6rem 0 .45rem;font-weight:600}',
  '.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(11rem,1fr));gap:.5rem}',
  '.slot{border:1px solid var(--line);border-radius:9px;padding:.5rem .65rem;background:var(--slot);min-height:3.6rem}.slot .name{font-weight:650}.slot .meta{color:var(--muted);font-size:.77rem}.slot .desc{color:var(--muted);font-size:.78rem;line-height:1.25;margin-top:.15rem}',
  '.slot.empty{border-style:dashed}.slot.empty .name{color:var(--muted);font-weight:600}.slot.empty .tag{font-size:.74rem;color:var(--muted);font-style:italic}',
  // Distribution charts (accessible static SVG). The axis-tick and bar-value
  // labels are set in SVG user units (font-size="9" against the 600x190
  // viewBox), so letting the SVG shrink below its native size at narrow
  // viewports scales the text down with it into illegibility (#655). A
  // min-width pinned to the viewBox width keeps the chart at native scale at
  // every viewport, falling back to the same horizontal-scroll convention
  // (.overflow, site/ledger.css) used for wide tables elsewhere on the site.
  '.chart{margin:0 0 1.1rem}.chart figcaption{font-weight:600;font-size:.92rem;margin:0 0 .3rem}',
  '.chart svg{width:100%;min-width:600px;height:auto;max-height:190px;display:block}',
  '.chart details{margin-top:.3rem}.chart summary{cursor:pointer;color:var(--accent);font-size:.84rem}',
  '.chart details table{margin-top:.4rem;max-width:22rem}.chart tr.explore{cursor:pointer}.chart tr.explore:hover td:first-child{text-decoration:underline;color:var(--accent)}',
  '.linkout{display:block;margin:.1rem 0 1.05rem;padding:.7rem 1.1rem;border:1px dashed var(--line);border-radius:12px;font-size:.9rem}',
  'footer{color:var(--muted);font-size:.83rem;margin-top:.6rem;line-height:1.6}footer a{color:var(--accent)}',
  SHARED_AFFORDANCE_CSS,
  SHARED_DB_ALERT_CSS,
  CALLSIGN_CSS,
  STATUS_LICENCE_CSS,
  '</style>',
].join('');

// Full HTML for a redesigned entry page. Depth 3 (datasets/{lane}/{key}/) is
// the default; the forbidden-suffix section reuses this shell at depth 2
// (forbidden/{key}/) so it inherits the same card layout, sidebar and a11y
// pattern with correct relative nav links.
export function entryPage(title: string, body: string[], options: PageOptions = {}, depthToRoot = 3): string {
  const { metaJsonHref, currentNav, sourcePath } = options;
  return [
    '<!DOCTYPE html>',
    '<html lang="en-GB">',
    // The ledger stylesheet is linked BEFORE the inline entry styles so that,
    // where a selector ties on specificity (e.g. the scoped browser's filter
    // pills), the entry shell's later inline rule wins and the interactive
    // components keep their bespoke look.
    `<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>${ledgerStylesheetLink(depthToRoot)}${ENTRY_STYLE}</head>`,
    '<body>',
    '<a class="skip" href="#main">Skip to content</a>',
    '<div class="wrap">',
    `<nav>${navHtml(depthToRoot, currentNav)}</nav>`,
    // Content adopts the ledger visual language; the nav and skip link stay
    // outside `.ledger`, as on the hand-authored pages.
    '<main id="main" class="ledger">',
    ...body,
    '</main>',
    footerHtml(metaJsonHref, sourcePath),
    '</div>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

// ---- Redesigned entry-page components (variant Q, static half) ----

export function noticeStrip(warn: boolean, inner: string): string {
  return `<div class="notice${warn ? ' warn' : ''}"><span>${warn ? '⚠' : 'ⓘ'}</span><span>${inner}</span></div>`;
}
