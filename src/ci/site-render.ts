/**
 * Shared, presentation-neutral render helpers for the generated GitHub Pages
 * site: the page shells (htmlPage, entryPage), the navigation strip and
 * breadcrumb, the shared design-token stylesheets, the footer/deploy
 * provenance, the download-slot grid, the breakdown bars, the a11y
 * skip-link/<main> scaffolding, and the small formatting/humanisation helpers
 * they build on. These are reused across the dataset, series, reports and
 * forbidden-suffix sections so every generated page reads as one product; the
 * section-specific logic lives in each section's own module.
 *
 * This module is a thin BARREL: the helpers now live in per-component modules
 * under ./render/, grouped by family (html, glossary, tables, formatting, page
 * shells, download slots) so a lane editing one family no longer touches the
 * others. Re-exported here so every existing `./site-render.ts` import keeps
 * working unchanged - a pure move, so the generated HTML is byte-for-byte the
 * same as it has always been.
 */

export * from './render/html.ts';
export * from './render/glossary.ts';
export * from './render/tables.ts';
export * from './render/format.ts';
export * from './render/page.ts';
export * from './render/download.ts';
