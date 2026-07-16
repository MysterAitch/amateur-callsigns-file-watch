#!/usr/bin/env node

/**
 * Renders the About page's provenance/licensing acknowledgement (issue #560)
 * directly from the publisher register, and injects it into the deployed
 * about.html at build time — the same placeholder-replacement convention as
 * build-home-aggregates.ts/build-nav.ts, so the statement can never drift out
 * of step with reference-data/publishers.json: every name and licence basis
 * shown here is read from the register, not hand-copied into the page.
 *
 * The repository's own code and original documentation are MIT-licensed (see
 * LICENSE); the data this site publishes is reproduced from its publishers
 * under their own terms (see archive/LICENSE.md). This acknowledgement is the
 * public-facing summary of that split: one line per publisher, linking through
 * to its own page for the full statement and verification citations. The
 * `self` entry (this mirror) is excluded — it is not a third party being
 * acknowledged, and the surrounding hand-authored copy already states the
 * project's own MIT licence.
 *
 * Usage: node src/ci/build-about-acknowledgement.ts <path-to-about.html>
 */

import * as fs from 'fs';
import { readPublisherRegister, type PublisherEntry } from '../shared/publishers.ts';
import { escapeHtml } from './site-render.ts';
import { publisherHref, LICENCE_BASIS_LABELS } from './build-publisher-pages.ts';

// about.html sits at the site root; publisher pages are one level down.
const ABOUT_PAGE_DEPTH = 0;

function humaniseToken(token: string): string {
  return token.replace(/-/g, ' ');
}

function basisLabelFor(entry: PublisherEntry): string {
  return LICENCE_BASIS_LABELS[entry.licenceBasis] ?? humaniseToken(entry.licenceBasis);
}

// One acknowledgement line per non-self publisher, name-linked to its own
// page, with its default licence basis in plain English. An `unverified`
// basis is stated honestly (LICENCE_BASIS_LABELS already renders it as "not
// established (unverified)") rather than guessed.
function acknowledgementRow(entry: PublisherEntry): string {
  const href = publisherHref(entry.id, ABOUT_PAGE_DEPTH);
  return `<li><a href="${href}">${escapeHtml(entry.name)}</a> — ${escapeHtml(basisLabelFor(entry))}</li>`;
}

// The full acknowledgement block: a list of every register entry other than
// `self`, in register order. Exported so a test can check its content without
// touching the filesystem.
export function renderAcknowledgementHtml(register = readPublisherRegister()): string {
  const rows = register.publishers
    .filter(entry => entry.id !== 'self')
    .map(acknowledgementRow)
    .join('');
  return `<ul class="ack-list">${rows}</ul>`;
}

const PLACEHOLDER = '<div id="publisher-acknowledgement">generated at deploy time — build the site to populate</div>';

// Injects the rendered acknowledgement into the deployed about.html. Fails
// loudly if the placeholder has drifted - a silent miss would publish the
// placeholder text instead of the acknowledgement, misleadingly.
export function injectAboutAcknowledgement(aboutPath: string): void {
  const html = fs.readFileSync(aboutPath, 'utf8');
  if (!html.includes(PLACEHOLDER)) {
    throw new Error(`placeholder not found in ${aboutPath}: ${PLACEHOLDER}`);
  }
  const replacement = `<div id="publisher-acknowledgement" data-prerendered>${renderAcknowledgementHtml()}</div>`;
  fs.writeFileSync(aboutPath, html.replace(PLACEHOLDER, replacement));
}

function main(): void {
  const [aboutPath] = process.argv.slice(2).filter(a => a.trim().length > 0);
  if (!aboutPath) {
    console.error('usage: node src/ci/build-about-acknowledgement.ts <path-to-about.html>');
    process.exitCode = 1;
    return;
  }
  injectAboutAcknowledgement(aboutPath);
  console.log(`publisher acknowledgement pre-rendered into ${aboutPath}`);
}

if (import.meta.main) {
  main();
}
