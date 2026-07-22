/**
 * The DERIVED event-time tier for the v2 claim ledger (issue #725, stage S1).
 *
 * The corpus is bi-temporal: every observation already carries its ASSERTION
 * time (the vintage in its provenance — when the dataset said it), but the
 * record-embedded EVENT times (a created date of 1938, a reservation expiring
 * 1995, a licence version starting 1952) have only ever ridden the raw layer as
 * verbatim cells. This tier promotes them to a queryable axis: per observation,
 * one derived claim per attested date cell, keyed by
 * (rawSubject, event kind [in the predicate], event date [the object]) and
 * wearing its asserting source + vintage via the observation's provenance — the
 * canonical "an event-time claim wearing its assertion-time provenance" shape.
 *
 * Epistemics, binding on every consumer of this tier:
 *
 *  - A claim asserts only that THIS SOURCE, AT THIS VINTAGE, stated this date.
 *    Different vintages legitimately assert different dates for the same
 *    subject; that divergence is S2's detector material, never resolved here.
 *  - Absence of an event claim is NON-OBSERVATION, never "nothing happened":
 *    event-time coverage is only as complete as what sources attested (many
 *    families carry no date columns at all, and sparse columns are sparse).
 *  - The `licence-version-original-start` kind means "the earliest
 *    licence-version start date SURVIVING in this vintage", explicitly NOT
 *    "the true original". Issue #800 (docs/source-register.md, known
 *    data-coherency episodes) establishes forward-only event-time creep by two
 *    mechanisms — rolling version-history retention dropping older rows, and a
 *    reissue replacing a sole row — so the earliest surviving date is not
 *    evidence the earlier ones never existed. Issue #565 additionally attests
 *    (via OARC) that original start dates before 1977 are unreliable.
 *  - Bookkeeping kinds (`record-created`, `record-last-modified`,
 *    `licence-version-last-modified`) are assertions about the EXPORT's
 *    bookkeeping, not necessarily licensing events: Ofcom has mass-updated the
 *    register at several points (the 2016 Jul–Aug migration cluster; the 2024
 *    rolling reprocessing; the 2025-10-11/-30 touch covering a majority of the
 *    register, issue #801), so tens of thousands of identical dates record one
 *    system episode, not tens of thousands of per-record happenings. For
 *    pre-2016 records even `created_date` largely carries the 2016
 *    migration-into-system timestamp, not the record's true origin.
 *
 * No format guessing (the #435 attestation rules apply in full): a binding is
 * only honoured over a column whose authored interpretation attests type
 * 'date' with a stated format, and the cell is parsed STRICTLY under that
 * attested format — a non-empty cell that does not parse is an integrity
 * failure (fail loud), never a silent skip or a best-effort read. The date
 * value is canonical-at-rest: the object is the ISO day (yyyy-mm-dd); a
 * time-of-day component, where the source carries one, stays available
 * verbatim in the raw cell the provenance points back to.
 *
 * The event-KIND vocabulary is authored (a reviewed enumeration below), and an
 * authored word never rides the raw layer (the #813 lesson), so every claim in
 * this tier is DERIVED under the named rule. The rule is a deterministic
 * COMPUTATION over the published cell (a strict parse + re-rendering), so it
 * reads out Computed — unlike the authored-event/role lookups, the VALUE here
 * is transformed from source bytes, not asserted by a registry.
 */

import { parseUkDateTimeDetailed } from '../shared/normalise.ts';
import { provenanceFor } from './provenance.ts';
import { interpretColumns } from './interpretation.ts';
import type { Claim, SourceObservationSet } from './claim-core.ts';

// The predicate prefix for event-time claims. The event KIND rides in the
// predicate (event-date/<kind>), mirroring the @column/<index> convention, so a
// fold can GROUP BY predicate to histogram one kind, and the object stays the
// clean ISO day the axis is queried on. Distinct from the authored-event tier's
// bare 'event' predicate (issue #813 Stage C2), which carries the issuance
// disclosures' covering-letter WORD, not a date.
export const EVENT_DATE_PREDICATE_PREFIX = 'event-date/';

// The named rule for the derived event-time claims: a deterministic computation
// (strict parse under the attested format, re-rendered as the ISO day), so it
// reads out Computed — deliberately NOT in LOOKUP_RULES.
export const EVENT_DATE_RULE = 'event-date-extraction';

// The authored event-kind vocabulary (issue #725 S1) — a small, documented,
// reviewed enumeration. Each kind names WHAT KIND OF DATED ASSERTION the source
// makes, chosen to stay honest about what the column states rather than to bake
// in an interpretation a later stage would have to un-learn:
//
//  - 'record-created': the register record's stated creation date. CAVEAT: for
//    records predating the Jul–Aug 2016 system migration this is very likely
//    the migration-into-system timestamp, not the record's true origin (the
//    2016 cluster covers up to 99% of created dates in some vintages).
//  - 'record-last-modified': the register record's stated last-modified date —
//    an assertion about the export's bookkeeping (issue #801: mass-update
//    episodes cluster a majority of these onto single days), and an eroding
//    fingerprint (a later touch overwrites the earlier date).
//  - 'licence-version-last-modified': the licence VERSION's stated
//    last-modified date (the open-data 2026 union pair) — same bookkeeping
//    caveats as record-last-modified, including the #801 episode itself.
//  - 'licence-version-original-start': the earliest licence-version start date
//    SURVIVING in this vintage (issue #800 — never "the true original"), with
//    the #565 pre-1977 unreliability caveat.
//  - 'licence-issued': the licence's stated issue date (the 2019
//    register-and-forbidden disclosures' 'Licence Issued Dat' column).
//  - 'licence-cancelled': the licence's stated cancellation date (the 2020
//    reserved-callsigns disclosure; historic values back to the 1930s).
//  - 'reserved-until': the stated END of a reservation window. Deliberately
//    GENERIC: the permanent-SES finding (issue #725) shows one column carrying
//    three meanings by cohort — a PLANNED close on Reserved rows, a
//    RETROSPECTIVE termination record on Available rows, and an undecidable
//    anomaly — so the cohort reading must be derived from (date vs vintage) ×
//    status, which is S2/S3 work. This kind asserts only what the cell states:
//    the reservation window's stated end date.
//
// LICENCE-scoped kinds (issue #725 S2): some disclosures' date columns are
// attributes of the LICENCE object, not the register record — a per-licence
// sheet whose rows duplicate callsigns (one row per licence), or
// 'Licence '-prefixed Salesforce fields blank across the unlicensed pool.
// Those are DIFFERENT facts from the record-scoped kinds above (a licence is
// created when granted/reissued; a register record's created stamp largely
// carries the 2016 migration), so they carry their own kinds — bound via the
// per-column eventKind override on the conversion specs — and the
// cross-vintage detector structurally cannot compare them against
// record-scoped dates:
//
//  - 'licence-created': the LICENCE record's stated creation date (the
//    Salesforce Licence object's stamp) — not the register record's origin.
//  - 'licence-last-modified': the LICENCE record's stated last-modified date —
//    licence-object bookkeeping, blank where no licence exists (the
//    reserved/available pool), with the same mass-update caveats as the other
//    bookkeeping kinds.
//  - 'licence-original-start': the CURRENT licence's stated original start
//    date. Related to, but not the same fact as,
//    'licence-version-original-start' (the earliest VERSION row surviving in a
//    vintage): a licence-scoped export carries one value per licence with no
//    version history at all. The #565 pre-1977 unreliability caveat applies to
//    this field family too. An authored equivalence bridge across the scopes
//    is deliberately NOT baked here.
export const EVENT_DATE_KINDS: readonly string[] = [
  'record-created',
  'record-last-modified',
  'licence-version-last-modified',
  'licence-version-original-start',
  'licence-issued',
  'licence-cancelled',
  'reserved-until',
  'licence-created',
  'licence-last-modified',
  'licence-original-start',
];

const KIND_SET: ReadonlySet<string> = new Set(EVENT_DATE_KINDS);

// The authored classification of each date-bearing column, keyed by the
// converter binding's CANONICAL OUTPUT name (the FOI FoiColumnSpec.output / the
// open-data raw->canonical mapping) — the one authored vocabulary both lanes
// already share, so the raw headers' per-vintage spelling ('LastModifiedDate',
// 'Call Sign MMSI: Last Modified Date', 'Licence LastModifiedDate') never
// needs re-authoring here. A `null` entry is a DOCUMENTED EXCLUSION, not an
// omission:
//
//  - 'event_date' (the issuance-events families' reissue/reciprocal/transfer
//    date) is excluded from S1: those rows ARE events, already carrying the
//    authored-event word tier (issue #813 Stage C2), and promoting their dates
//    belongs with that word (the kind should bind to the disclosure's authored
//    vocabulary, not to a column-generic name) — a follow-on stage, not baked
//    here. Structurally those families attest no column interpretations yet,
//    so no binding could be honoured there anyway.
//
// eventKindForDateOutput THROWS on an output name absent from this map, so a
// newly-authored date column cannot silently emit nothing — classifying it
// here (or excluding it with a reason) becomes part of adding the column.
const EVENT_KIND_BY_DATE_OUTPUT: ReadonlyMap<string, string | null> = new Map([
  ['created_date', 'record-created'],
  ['last_modified_date', 'record-last-modified'],
  ['licence_version_last_modified_date', 'licence-version-last-modified'],
  ['original_start_date', 'licence-version-original-start'],
  ['licence_version_original_start_date', 'licence-version-original-start'],
  ['licence_issued_date', 'licence-issued'],
  ['licence_cancel_date', 'licence-cancelled'],
  ['reserved_to_date', 'reserved-until'],
  ['event_date', null],
]);

// The event kind for a canonical date-column output name: an authored kind, or
// null for a documented exclusion. Fail loud on an unclassified output — the
// drift guard that makes this registry total over the date columns the
// converter bindings author.
export function eventKindForDateOutput(output: string): string | null {
  if (!EVENT_KIND_BY_DATE_OUTPUT.has(output)) {
    throw new Error(`eventKindForDateOutput: date column output "${output}" has no authored event-kind classification - add it to EVENT_KIND_BY_DATE_OUTPUT (or exclude it there with a documented reason)`);
  }
  return EVENT_KIND_BY_DATE_OUTPUT.get(output) ?? null;
}

// The event kind for one FOI conversion date column: the column's authored
// per-source eventKind override where the spec carries one (validated against
// the kind vocabulary — an unknown override name fails loud rather than
// minting an unreviewed kind), else the output-name default. The single
// resolution both the FOI collector's bindings and the explain arm's
// kind->header map read, so they can never disagree about which kind a
// column feeds.
export function eventKindForFoiDateColumn(column: { readonly output: string; readonly eventKind?: string }): string | null {
  if (column.eventKind !== undefined) {
    if (!KIND_SET.has(column.eventKind)) {
      throw new Error(`eventKindForFoiDateColumn: column output "${column.output}" declares eventKind "${column.eventKind}", which is not an authored event kind - add it to EVENT_DATE_KINDS (a reviewed vocabulary change) before binding to it`);
    }
    return column.eventKind;
  }
  return eventKindForDateOutput(column.output);
}

export function eventDatePredicate(kind: string): string {
  return `${EVENT_DATE_PREDICATE_PREFIX}${kind}`;
}

// The event kind an event-date/<kind> predicate encodes, or undefined when the
// predicate is not an event-date predicate or names a kind outside the authored
// vocabulary — a stray predicate is never mistaken for an event claim
// (mirroring columnIndexOf's strictness).
export function eventKindOf(predicate: string): string | undefined {
  if (!predicate.startsWith(EVENT_DATE_PREDICATE_PREFIX)) return undefined;
  const kind = predicate.slice(EVENT_DATE_PREDICATE_PREFIX.length);
  return KIND_SET.has(kind) ? kind : undefined;
}

// The two attested date grammars this corpus carries (the #435 interpretation
// vocabulary): the UK day-first CSV rendering and the workbook extracts' ISO
// rendering. Their shapes are syntactically disjoint (slashes vs hyphens), a
// property isoDayFromCellUnderAnyAttestedFormat's dispatch relies on.
export const DAY_FIRST_FORMAT = 'DD/MM/YYYY';
export const ISO_FORMAT = 'YYYY-MM-DD';

// The strict ISO-extract grammar, mirroring the open-data converter's workbook
// branch (normalise.ts): yyyy-mm-dd with an optional hh:mm:ss time, month and
// day range-checked. Kept strict so a value in the WRONG format for its
// attestation fails loudly instead of being quietly read under another grammar.
const ISO_EXTRACT_RE = /^(\d{4})-(\d{2})-(\d{2})( \d{2}:\d{2}:\d{2})?$/;

// Parse one attested date cell STRICTLY under its attested format and return
// the canonical ISO day (yyyy-mm-dd), or null for an empty cell (absence of
// evidence — no claim, mirroring the raw layer's sparsity). A non-empty cell
// that does not parse under its attested format THROWS: every source this tier
// covers already passed the strict converter with the same grammar, so a
// failure here is an integrity break, never routine data. Leading/trailing
// whitespace is tolerated exactly as the converter tolerates it (the verbatim
// cell, whitespace included, stays in the raw layer). A time-of-day component
// is truncated to the day — the event axis is day-precision; the raw cell
// keeps the full rendering.
export function isoDayFromAttested(value: string, format: string): string | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (format === DAY_FIRST_FORMAT) {
    // LIFTED day-first parser (shared/normalise.ts) — the same strict
    // dd/mm/yyyy[ hh:mm[:ss]] grammar the converters validated these cells
    // under. Throws on anything else.
    return parseUkDateTimeDetailed(trimmed).iso.slice(0, 10);
  }
  if (format === ISO_FORMAT) {
    const match = ISO_EXTRACT_RE.exec(trimmed);
    if (match === null) {
      throw new Error(`isoDayFromAttested: "${trimmed}" is not a well-formed ${ISO_FORMAT} extract date`);
    }
    const month = Number(match[2]);
    const day = Number(match[3]);
    // Full calendar validation, symmetric with the day-first parser
    // (shared/normalise.ts): the day must fall within the month's real length
    // (leap years included), not merely be <= 31. So an impossible ISO cell
    // like 2020-02-30 fails loud here exactly as its day-first sibling
    // 30/02/2020 does, rather than emitting the bad day verbatim. `new
    // Date(year, month, 0)` yields the last day of that 1-based month.
    const daysInMonth = month >= 1 && month <= 12 ? new Date(Number(match[1]), month, 0).getDate() : 0;
    if (day < 1 || day > daysInMonth) {
      throw new Error(`isoDayFromAttested: "${trimmed}" is not a well-formed ${ISO_FORMAT} extract date`);
    }
    return `${match[1]}-${match[2]}-${match[3]}`;
  }
  throw new Error(`isoDayFromAttested: unknown attested date format "${format}" - the event-time tier parses only the attested grammars (${DAY_FIRST_FORMAT}, ${ISO_FORMAT})`);
}

// The ISO day a raw cell yields under WHICHEVER attested grammar its shape
// matches, or null when it matches neither (or is empty). NOT format guessing:
// the two attested grammars are syntactically disjoint (slash-shaped day-first
// vs hyphen-shaped ISO), so at most one can apply to a given cell and the
// dispatch is deterministic. Used by the explain arm, which reconstructs a
// claim's working from the ledger alone (where the per-source format
// attestation is not stored) — for any cell the emit path accepted, this
// reproduces the emit path's exact result.
export function isoDayFromCellUnderAnyAttestedFormat(value: string): string | null {
  for (const format of [DAY_FIRST_FORMAT, ISO_FORMAT]) {
    try {
      const iso = isoDayFromAttested(value, format);
      if (iso !== null) return iso;
    } catch {
      // The cell does not fit this grammar; try the other. A cell fitting
      // neither yields null - the caller decides whether that is a gap.
    }
  }
  return null;
}

// The DERIVED event-time claims for a source: per observation, one claim per
// authored event-date binding whose cell is non-empty, the object being the
// ISO day parsed strictly under the column's ATTESTED format. A source that
// attests no bindings (every family whose loader lifts none — the issuance
// events, forbidden lists, pools, statistics, verbatim sheets) emits nothing.
// An empty cell emits no claim: absence of evidence, never an invented date.
// Preconditions fail loud: a binding over a column absent from the source, or
// over a column whose interpretation does not attest a dated format, is a
// loader defect this tier refuses to paper over.
export function emitEventDateClaims(source: SourceObservationSet): Claim[] {
  const bindings = source.eventDateColumns;
  if (bindings === undefined || bindings.length === 0) return [];
  // Kind-dedup guard (issue #856): a source's date bindings must map to
  // DISTINCT event kinds. The per-row loop below pushes one claim per (row,
  // binding), so two columns sharing a kind would emit duplicate claims of that
  // kind on every row — an inflation the ledger cannot tell apart from two
  // genuine observations. No source binds two columns to one kind today
  // (EVENT_KIND_BY_DATE_OUTPUT maps original_start_date and
  // licence_version_original_start_date to the same kind, but no single source
  // carries both); a future one that did must fail loud, naming the source and
  // the colliding columns, rather than silently double-counting.
  const columnsByKind = new Map<string, string[]>();
  for (const binding of bindings) {
    const columns = columnsByKind.get(binding.kind);
    if (columns === undefined) columnsByKind.set(binding.kind, [binding.source]);
    else columns.push(binding.source);
  }
  for (const [kind, columns] of columnsByKind) {
    if (columns.length > 1) {
      throw new Error(`emitEventDateClaims: ${source.sourceFile} binds event kind "${kind}" to ${columns.length} columns (${columns.join(', ')}) - a source's date bindings must map to distinct event kinds, else each row emits duplicate claims of one kind; give the columns distinct kinds or drop the redundant binding`);
    }
  }
  // interpretColumns fails loud when the source attests no interpretation at
  // all — a binding without an attestation is exactly the guessing this tier
  // forbids.
  const interpretations = interpretColumns(source);
  const formats = bindings.map(binding => {
    const index = source.columns.indexOf(binding.source);
    if (index === -1) {
      throw new Error(`emitEventDateClaims: ${source.sourceFile} binds event kind "${binding.kind}" to column "${binding.source}", which is absent from the source headers`);
    }
    const interpretation = interpretations[index];
    if (interpretation.type !== 'date' || interpretation.format === undefined) {
      throw new Error(`emitEventDateClaims: ${source.sourceFile} column "${binding.source}" is bound to event kind "${binding.kind}" but its attested interpretation is "${interpretation.type}" - only a column attested as a dated format may feed the event axis (no format guessing)`);
    }
    return interpretation.format;
  });
  const claims: Claim[] = [];
  source.rows.forEach((row, ordinal) => {
    const rawSubject = row[source.subjectColumn] ?? '';
    const provenance = provenanceFor(source, ordinal);
    bindings.forEach((binding, bindingIndex) => {
      const iso = isoDayFromAttested(row[binding.source] ?? '', formats[bindingIndex]);
      if (iso === null) return;
      claims.push({ layer: 'derived', rawSubject, predicate: eventDatePredicate(binding.kind), object: iso, provenance, rule: EVENT_DATE_RULE });
    });
  });
  return claims;
}
