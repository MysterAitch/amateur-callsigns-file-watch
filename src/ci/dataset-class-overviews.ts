/**
 * Per-dataset-TYPE overview content (issue #470): the authored prose that turns
 * each dataset-class page from a bare definition-plus-listing into a proper
 * "dataset overview" — what this kind of data IS, the shape of a row, its
 * provenance and quirks, and how it relates to the other types.
 *
 * Decision (issue #470): the per-class pages under datasets/classes/ are already
 * the per-type home (one page per FOI_DATASET_CLASSES key, listing every entry
 * that carries it). Rather than a second, duplicate page family for the same
 * axis, this module supplies the overview content those existing pages render —
 * "promote and refine the per-dataset docs into a proper per-type overview",
 * exactly as the issue floats.
 *
 * The one-line DEFINITION of each class stays in FOI_DATASET_CLASSES
 * (src/shared/foi-archive.ts) — the single source of truth the FOI validator
 * enforces and docs/foi-schemas.md renders. This module only adds the longer
 * explanatory prose; a completeness test pins one overview to every vocabulary
 * class so a new class cannot ship without one.
 *
 * Prose is authored as plain text (escaped at render); domain jargon is linked
 * to the glossary through the declared `glossary` anchors, and sibling types
 * through `relatedTypes`, so terms stay one click from their definition without
 * embedding markup in the copy.
 */

import { FOI_DATASET_CLASSES } from '../shared/foi-archive.ts';
import type { GlossaryAnchor } from './render/glossary.ts';

// A sibling dataset type this one is easily confused with, or naturally paired
// with, and a one-line note on how the two relate.
export interface RelatedType {
  cls: string;
  relation: string;
}

// The authored overview for one dataset type. `shape` and `provenanceAndQuirks`
// are plain-text paragraphs; `relatedTypes` and `glossary` drive the cross-links.
export interface DatasetClassOverview {
  // What a single row/record represents — the shape, in plain English.
  shape: string;
  // Where entries of this type come from, and the caveats a reader should know
  // before trusting them.
  provenanceAndQuirks: string;
  // Sibling types worth reading alongside this one.
  relatedTypes: RelatedType[];
  // Glossary terms worth surfacing for this type (each resolves to a definition
  // in site/glossary.html).
  glossary: GlossaryAnchor[];
}

// Authored overview per dataset-class key. Keyed by the same vocabulary keys as
// FOI_DATASET_CLASSES; a completeness test asserts the two key sets match.
export const DATASET_CLASS_OVERVIEWS: Readonly<Record<string, DatasetClassOverview>> = {
  'register-snapshot': {
    shape: 'One row per callsign, carrying its register status (Allocated, Reserved, Available, …) and, where the source disclosed them, the licence class, product and key dates. A snapshot is the whole register frozen at one vintage: read a row as “this is what the register said about this callsign on that date”.',
    provenanceAndQuirks: 'The Ofcom open-data publications are, by construction, register snapshots — each is classified as one from the lane’s shape, not from a per-publication assertion — and FOI disclosures of the full register are snapshots too. Coverage is the publisher’s declared intent, not a verified guarantee: a declared-partial export is flagged, and the absence of a callsign from a partial snapshot is not evidence of anything.',
    relatedTypes: [
      { cls: 'available-pool', relation: 'the complementary half of the namespace — what was free to issue rather than what was held — at the same vintage' },
      { cls: 'issuance-events', relation: 'the dated transitions that move the register from one snapshot to the next' },
      { cls: 'attribute-addendum', relation: 'extra per-callsign columns that join back onto a snapshot’s rows' },
    ],
    glossary: ['register-snapshot', 'status-values', 'vintage', 'declared-complete'],
  },
  'available-pool': {
    shape: 'Rows of callsigns — or, for some vintages, three-letter suffixes — that were free to issue at a vintage. It is a positive list of what could be taken up; it asserts nothing about the callsigns that were already allocated.',
    provenanceAndQuirks: 'The “Available” status is a well-known trap: a callsign being absent from an available pool does not mean it is held, and its presence is a point-in-time fact that a later issue can quietly overturn. An available pool is best read against the register snapshot of the same vintage — together the two decompose the namespace into held versus free.',
    relatedTypes: [
      { cls: 'register-snapshot', relation: 'the held side of the same namespace at the same vintage' },
      { cls: 'forbidden-list', relation: 'suffixes withheld from issue never enter the pool — a standing constraint on it' },
      { cls: 'issuance-events', relation: 'an issue event is a callsign leaving the available pool' },
    ],
    glossary: ['available', 'allocated', 'vintage', 'forbidden-suffix'],
  },
  'issuance-events': {
    shape: 'Dated, per-callsign events rather than a state: an issue, a re-issue, a reallocation, or a reciprocal-licence issue, each with the date it happened. One callsign can appear in several rows across its history.',
    provenanceAndQuirks: 'Events are the motion between snapshots — they explain how the register changed, where a snapshot only shows where it ended up. Disclosures vary in which event kinds they cover and how far back they reach, so an event dataset is a window on a period, not a complete life-history of every callsign.',
    relatedTypes: [
      { cls: 'register-snapshot', relation: 'the state these events move between' },
      { cls: 'available-pool', relation: 'an issue event is a callsign leaving the available pool' },
      { cls: 'statistics-aggregate', relation: 'counts of issuances over a period aggregate what these datasets record row by row' },
    ],
    glossary: ['observation', 'vintage', 'allocated'],
  },
  'forbidden-list': {
    shape: 'A deliberately different row shape: three-letter suffixes — not callsigns — that Ofcom withholds from issue. A row is a suffix, so this type keys on the suffix and joins to callsigns only through their last three letters.',
    provenanceAndQuirks: 'The withheld set evolves over time — suffixes have been both added and removed across disclosures — so a forbidden-list is tied to its vintage. A callsign carrying a forbidden suffix is usually an innocent legacy holder issued before the suffix was withheld; the interesting cohort is the few issued after a suffix was first known to be withheld.',
    relatedTypes: [
      { cls: 'register-snapshot', relation: 'callsigns in a snapshot are checked against the withheld suffixes to surface the forbidden-suffix cohort' },
      { cls: 'available-pool', relation: 'withheld suffixes are the standing constraint on what can ever become available' },
    ],
    glossary: ['forbidden-suffix', 'suffix', 'vintage'],
  },
  'statistics-aggregate': {
    shape: 'Counts and aggregates — totals by licence class, by year, by region, and so on — not per-callsign rows. A row is a summary figure, so the underlying callsigns cannot be recovered from it.',
    provenanceAndQuirks: 'Aggregates answer “how many” without disclosing “which”, so they often survive disclosure where a full list would not. They cannot be joined to the register at callsign level; treat an aggregate as an independent cross-check on the per-callsign datasets rather than a source to merge with them.',
    relatedTypes: [
      { cls: 'register-snapshot', relation: 'aggregates describe the same population a snapshot lists individually' },
      { cls: 'issuance-events', relation: 'counts of issuances over a period aggregate what the event datasets record row by row' },
    ],
    glossary: ['observation', 'licence-class', 'vintage'],
  },
  'attribute-addendum': {
    shape: 'Per-callsign or per-licence attribute columns — identifiers, dates, licence classes — intended to be joined onto another dataset rather than read alone. A row is a key plus the extra fields disclosed for it.',
    provenanceAndQuirks: 'An addendum is a sidecar: it fills in columns a register snapshot lacked, keyed so it can be joined back on. Its value is realised in the join, so it is only as trustworthy as the key it shares; mismatched, ambiguous or stale keys are the main hazard.',
    relatedTypes: [
      { cls: 'register-snapshot', relation: 'the dataset an addendum’s extra columns join onto' },
      { cls: 'issuance-events', relation: 'the date attributes disclosed here often underpin the events derived from them' },
    ],
    glossary: ['observation', 'licence-class'],
  },
  'reference-context': {
    shape: 'Not a dataset of callsigns at all: correspondence and context — “information not held” responses, referrals to other bodies, policy signposts, and statements about how Ofcom’s systems work. A record here is an exchange, not a callsign fact.',
    provenanceAndQuirks: 'These entries are kept because the context matters — a “not held” answer is itself evidence about what Ofcom does and does not retain — but they carry no per-callsign data to browse. They explain and bound the other types rather than adding rows to them.',
    relatedTypes: [
      { cls: 'register-snapshot', relation: 'context that explains the retention and shape behind the callsign datasets' },
    ],
    glossary: ['dataset-class'],
  },
};

// The authored overview for a class, or undefined for a class with none. A
// class in the vocabulary should always have one (the completeness test
// enforces it); undefined lets the renderer degrade gracefully rather than
// throw mid-build for a class added ahead of its prose.
export function datasetClassOverview(cls: string): DatasetClassOverview | undefined {
  return Object.prototype.hasOwnProperty.call(DATASET_CLASS_OVERVIEWS, cls)
    ? DATASET_CLASS_OVERVIEWS[cls]
    : undefined;
}

// A dataset-class key rendered as a human-readable type name: the kebab-case
// vocabulary key ('register-snapshot') as sentence case ('Register snapshot'),
// so headings and links read as prose while the code key stays available
// alongside for the exact vocabulary term.
export function humaniseClassKey(cls: string): string {
  const words = cls.split('-').filter(w => w.length > 0);
  if (words.length === 0) return cls;
  return words
    .map((word, i) => (i === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(' ');
}

// Every vocabulary class, so callers can iterate the type set from one place.
export function datasetClassKeys(): string[] {
  return Object.keys(FOI_DATASET_CLASSES);
}
