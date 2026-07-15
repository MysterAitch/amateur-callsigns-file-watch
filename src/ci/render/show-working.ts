/**
 * The "show the working" surface affordance (issue #433, ADR 0017 phase P4).
 *
 * The explain engine (src/v2/explain.ts) reconstructs, on read, the EVIDENCE
 * behind any derived claim: the input raw claim(s), the reference-table rows, the
 * one sibling observation, an ordered transformation trace, and the reproduced
 * result. This module RENDERS that Working as an accessible, JavaScript-free
 * disclosure, and — the payoff of the #431 provenance foundation — turns every
 * evidence position into a clickable GitHub permalink back to the exact source
 * byte it rests on (permalinkForProvenance / sourcePermalink, source-link.ts).
 *
 * Nothing here enters the ledger. The Working is reconstructed on read and the
 * permalinks are composed on read from stored primitives (the observation's
 * viewAnchor + the introducing-commit SHA), so this surface adds no claims and no
 * bytes: the #404 no-inflation trace and the JSONL/N-Quads serialisations are
 * untouched. It only READS the ledger to resolve where each input lives.
 *
 * Accessibility + progressive enhancement (the site's standing conventions):
 *  - the disclosure is a native <details>/<summary>, so it opens with keyboard or
 *    pointer and needs no script;
 *  - every source link is the shared external-link affordance (the ↗ marker is
 *    decorative, with a visually-hidden "opens in a new tab" for assistive tech);
 *  - the rule is named in plain English, not just by its machine token;
 *  - a position we do NOT hold is reported as an honest absence — a plain-text
 *    "no source line recorded", never a fabricated link (the honesty rule).
 */

import { escapeHtml, externalLink } from './html.ts';
import { SOURCE_REPO_URL, SOURCE_PERMALINK_RULE } from '../../v2/source-link.ts';
import {
  permalinkForProvenance,
  LISTED_PREDICATE,
  type Claim,
} from '../../v2/claim.ts';
import type { Working, WorkingInput } from '../../v2/explain.ts';

// Where one input's evidence lives, resolved for display: a permalink back to the
// exact source position (absent when the origin has no line-viewable anchor), and
// a plain-English account of the locus. `href` is deliberately optional — an
// observation with no recorded position is given NO link rather than a guessed
// one (the honesty rule, mirroring permalinkForProvenance).
export interface EvidenceLink {
  href?: string;
  where: string;
}

// The @listed anchor of an observation carries its source position once for all
// the observation's claims (a CSV row is one physical line, so every cell of the
// row shares it). So a raw-claim or sibling-observation origin resolves its
// permalink through the observation's anchor, not the attribute claim itself.
function anchorFor(sourceFile: string, ordinal: number, ledger: readonly Claim[]): Claim | undefined {
  return ledger.find(c =>
    c.layer === 'raw'
    && c.predicate === LISTED_PREDICATE
    && c.provenance.sourceFile === sourceFile
    && c.provenance.ordinal === ordinal);
}

// The evidence link for an observation, resolved through its anchor: the
// permalink to the exact source line (composed on read from the anchor's
// viewAnchor + the commit SHA) and a plain-English locus. A legacy observation
// with no recorded position is given NO link and an honest "no source line
// recorded" note rather than a fabricated one.
function observationLink(sourceFile: string, ordinal: number, ledger: readonly Claim[], commitSha: string): EvidenceLink {
  const anchor = anchorFor(sourceFile, ordinal, ledger);
  const view = anchor?.provenance.viewAnchor;
  if (anchor === undefined || view === undefined) {
    return { where: `row ${ordinal + 1} of ${sourceFile} (no source line recorded)` };
  }
  return { href: permalinkForProvenance(anchor.provenance, commitSha), where: `line ${view.line} of ${view.repoPath}` };
}

// Resolve a single input's origin into its display evidence link. `ledger` is the
// SAME-source claims already in hand for the render; `commitSha` is the pinned
// introducing commit the permalinks anchor at.
export function evidenceLinkFor(
  origin: WorkingInput['origin'],
  ledger: readonly Claim[],
  commitSha: string,
): EvidenceLink {
  switch (origin.kind) {
    case 'raw-claim':
      return observationLink(origin.sourceFile, origin.ordinal, ledger, commitSha);
    case 'sibling-observation':
      return observationLink(origin.sourceFile, origin.ordinal, ledger, commitSha);
    case 'reference-row': {
      // A reference table is a small versioned file in the repo; the link points
      // at the file at the pinned commit. We attest the row's KEY, not a physical
      // line (the reference row's line is not captured), so the locus names the
      // key honestly rather than a line we do not hold.
      const href = `${SOURCE_REPO_URL}/blob/${commitSha}/reference-data/${origin.file}`;
      return { href, where: `the row keyed “${origin.key}” in reference-data/${origin.file}` };
    }
  }
}

// Humanise a blank input value so an empty source cell reads as an explicit
// "(blank)" rather than vanishing (the humanise-blanks convention).
function displayValue(value: string): string {
  return value.trim() === '' ? '(blank)' : value;
}

function renderInput(input: WorkingInput, link: EvidenceLink): string {
  const role = escapeHtml(input.role);
  const value = `<code>${escapeHtml(displayValue(input.value))}</code>`;
  const locus = link.href !== undefined
    ? externalLink(link.href, link.where)
    : `<span class="working-locus-absent">${escapeHtml(link.where)}</span>`;
  return `<li><span class="working-role">${role}</span>: ${value} `
    + `<span class="working-from">from ${locus}</span></li>`;
}

function renderStep(step: Working['steps'][number]): string {
  const detail = escapeHtml(step.detail);
  // A step optionally carries the value before (`from`) and after (`to`) it. Show
  // whichever it holds as a compact "x → y" (or a bare "x"/"→ y") transform note.
  const parts: string[] = [];
  if (step.from !== undefined) parts.push(`<code>${escapeHtml(displayValue(step.from))}</code>`);
  if (step.to !== undefined) parts.push(`<code>${escapeHtml(displayValue(step.to))}</code>`);
  if (parts.length === 0) return `<li>${detail}</li>`;
  const transform = step.from !== undefined && step.to !== undefined ? parts.join(' → ') : (step.to !== undefined ? `→ ${parts[0]}` : parts[0]);
  return `<li>${detail} <span class="working-transform">(${transform})</span></li>`;
}

// Render the full "show the working" disclosure for one derived claim. Emits a
// single-line, JavaScript-free HTML string: a <details> whose <summary> opens the
// evidence — the named rule (in plain English), the inputs each linked to their
// source position, the ordered transformation trace, and the reproduced result.
// `ledger` supplies the same-source claims used to resolve each input's permalink;
// `commitSha` is the pinned introducing commit the links anchor at.
export function renderWorking(working: Working, ledger: readonly Claim[], commitSha: string): string {
  const claimLabel = `${escapeHtml(working.claim.predicate)} = ${escapeHtml(displayValue(working.claim.object))}`;

  const inputs = working.inputs
    .map(input => renderInput(input, evidenceLinkFor(input.origin, ledger, commitSha)))
    .join('');
  const steps = working.steps.map(renderStep).join('');

  const rule = working.rule === ''
    ? ''
    : `<p class="working-rule">Rule: <code>${escapeHtml(working.rule)}</code> — `
      + `${escapeHtml(working.ruleGloss)} `
      + `<span class="working-confidence">(confidence: ${escapeHtml(working.confidence)})</span></p>`;

  const body = `<div class="working-body">`
    + rule
    + `<h4 class="working-heading">Inputs (the evidence)</h4>`
    + `<ul class="working-inputs">${inputs}</ul>`
    + `<h4 class="working-heading">Working</h4>`
    + `<ol class="working-steps">${steps}</ol>`
    + `<p class="working-result">Reproduces: <code>${escapeHtml(displayValue(working.result))}</code></p>`
    + `<p class="working-note">Each source link is computed from the observation's recorded position `
    + `(rule: <code>${escapeHtml(SOURCE_PERMALINK_RULE)}</code>), so the working can be re-verified against the exact source byte.</p>`
    + `</div>`;

  return `<details class="show-working">`
    + `<summary>Show the working<span class="visually-hidden"> for the ${claimLabel} claim</span></summary>`
    + body
    + `</details>`;
}
