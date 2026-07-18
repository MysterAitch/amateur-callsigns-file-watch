/**
 * Per-source field-role resolution for the value catalogue's `status` and raw
 * `product / licence_class` folds (issues #444 / #707).
 *
 * The raw claim ledger keys every attribute claim by the publisher's OWN column
 * header (raw-emit.ts), which varies by vintage, and carries no queryable
 * canonical-role marker. So a fold that must reconstruct a per-callsign FIELD
 * distribution — every status/product value across the corpus, blanks included —
 * needs to know, per source, WHICH raw column carried the field and WHICH sources
 * carry the field at all. This module resolves those source sets the SAME way the
 * emit path does — from each collector's authored converter binding (the
 * `categoryColumn` precedent, licence-category-emit.ts) — rather than inventing a
 * parallel mapping, and WITHOUT re-parsing a single data row: it reads only the
 * archive/entry metadata and the authored conversion column specs.
 *
 * The four sets it produces mirror how the legacy value-catalogue tally scoped
 * the two fields (value-catalogue.ts), so the fold reproduces the committed
 * figures rather than a differently-scoped near-miss:
 *
 *  - `statusSources` / `productSources` — the CALL-SIGN register lane that bears
 *    the field: every open-data publication (whose normalised projection always
 *    carries a status and a product column, so the legacy tally always bumped
 *    both) plus every callsign-subject FOI source whose authored conversion
 *    OUTPUTS a `status` / `licence_class` column (the exact condition under which
 *    the legacy tally's buildFoiObservations sees the column present). Attested
 *    values fold from these sources' raw claims; the `(blank)` bucket is their
 *    `@listed` anchors minus the observations that carry a value.
 *
 *  - `availablePoolSources` / `forbiddenSources` — the FOI available-pool and
 *    forbidden-list families. The ledger models availability / forbiddenness as
 *    FAMILY MEMBERSHIP, not a register status (see available-pool.ts /
 *    forbidden-list.ts), so the `status` fold PROJECTS an `Available` /
 *    `Forbidden` bucket from their `@listed` membership and the renderer labels
 *    those buckets as membership-derived projections, never as attested
 *    statuses (#707's determination). The typed available-pool exports DO carry
 *    a verbatim sheet-level `Status` column in their lossless emit (issue #813
 *    Stage A) — it is the export's own framing of the whole sheet, which is
 *    exactly why these sources stay OUT of `statusSources`: scoping them out
 *    keeps that sheet framing from masquerading as a per-callsign register
 *    status. They are likewise deliberately ABSENT from `productSources`: a
 *    pool-slot's licence class is a class Ofcom attached to an availability
 *    list, not a licensed register product — the same faithfulness the
 *    licence-category fold already applies (value-catalogue-fold.ts).
 *
 * The resolver's source strings are the ledger's own logical sourceFile keys
 * (`opendata/<key>/<file>`, `foi/<entry>/<file>`); a data-validity test pins that
 * they partition the ledger's callsign / pool-slot / suffix sources exactly, so a
 * drift between this metadata walk and the emit path fails loud rather than
 * silently mis-scoping a fold.
 */

import * as fs from 'fs';
import * as path from 'path';
import { type ArchiveMeta } from '../shared/utils.ts';
import { DIRS } from '../shared/constants.ts';
import { OFCOM_AMATEUR_SOURCE_KEY } from '../sources/ofcom-amateur/constants.ts';
import { listArchiveKeys, parseSourceFileName } from '../shared/archive.ts';
import { defaultFoiDir } from '../shared/foi-archive.ts';
import { FOI_ENTRY_CONVERSIONS, type FoiSourceConversion } from '../shared/foi-normalise.ts';
import { qualifyingRegisterEntries, registerSourcesFor } from '../v2/collectors/foi-register.ts';
import { attributeAddendumEntries } from '../v2/collectors/attribute-addendum.ts';
import { issuanceEventsEntries, issuanceEventsSourcesFor } from '../v2/collectors/issuance-events.ts';
import { availablePoolEntries } from '../v2/collectors/available-pool.ts';
import { forbiddenListEntries, forbiddenSourcesFor } from '../v2/collectors/forbidden-list.ts';
import { parseJsonObject } from '../shared/json-shape.ts';

// The canonical normalised-output names whose presence in a source's authored
// conversion means that source carries the field (and so the legacy tally's
// per-callsign union saw the column present). Reading the OUTPUT, not the raw
// source header, is what lets a source with a synthesised-or-blank column (a
// conversion that maps the output with no raw source, e.g. the allocated/reserved
// lists that carry a blank product column) still count as field-bearing.
const STATUS_OUTPUT = 'status';
const LICENCE_CLASS_OUTPUT = 'licence_class';

// The two register-lane source sets a field folds over, plus the two family
// membership sets the `status` fold projects its Available / Forbidden buckets
// from. Every string is a ledger logical sourceFile key.
export interface FieldSources {
  statusSources: string[];
  productSources: string[];
  availablePoolSources: string[];
  forbiddenSources: string[];
}

export interface FieldSourceRoots {
  archiveDir: string;
  foiDir: string;
}

function defaultRoots(): FieldSourceRoots {
  return { archiveDir: DIRS.archive, foiDir: defaultFoiDir() };
}

// The open-data source key — the one converter registered for the open-data lane
// (matching the open-data-register collector). An entry declaring another source
// belongs to a different family and is skipped.
const OPEN_DATA_SOURCE_KEY = OFCOM_AMATEUR_SOURCE_KEY;

// Whether an authored conversion outputs the given canonical column, i.e. its
// normalised projection carries that field.
function conversionOutputs(conversion: FoiSourceConversion, output: string): boolean {
  return conversion.columns.some(column => column.output === output);
}

// The ledger sourceFile key for an FOI conversion — the same corpus-unique,
// self-locating key every FOI collector stamps (foi/<entry>/<file>).
function foiSourceFile(entry: string, conversion: FoiSourceConversion): string {
  return `foi/${entry}/${conversion.sourceFile}`;
}

// Resolve the four field-source sets from the archive/entry metadata and the
// authored conversion column specs alone — no data row is parsed. Every register
// (open-data + FOI register + attribute-addendum + issuance-events) callsign
// source is classified as status-bearing / product-bearing by whether its
// conversion outputs the column; open-data is always both. The available-pool and
// forbidden-list families are collected whole as the membership projection sets.
export function resolveFieldSources(roots: FieldSourceRoots = defaultRoots()): FieldSources {
  const statusSources: string[] = [];
  const productSources: string[] = [];

  // Open-data register: the normalised projection always carries a status and a
  // product column, so every open-data publication bears both fields.
  for (const key of listArchiveKeys()) {
    const metaPath = path.join(roots.archiveDir, key, 'meta.json');
    if (!fs.existsSync(metaPath)) continue;
    const meta = parseJsonObject(fs.readFileSync(metaPath, 'utf8'), metaPath) as ArchiveMeta;
    if (meta.sourceKey !== OPEN_DATA_SOURCE_KEY) continue;
    const sourceFile = `opendata/${key}/${parseSourceFileName(meta)}`;
    statusSources.push(sourceFile);
    productSources.push(sourceFile);
  }

  // FOI callsign-subject register lane: foi-register + attribute-addendum ride the
  // register machinery (registerSourcesFor); issuance-events its own selector.
  const registerConversions: { entry: string; conversion: FoiSourceConversion }[] = [];
  for (const { entry, meta } of qualifyingRegisterEntries(roots.foiDir)) {
    for (const source of registerSourcesFor(meta)) registerConversions.push({ entry, conversion: source.conversion });
  }
  for (const { entry, meta } of attributeAddendumEntries(roots.foiDir)) {
    for (const source of registerSourcesFor(meta)) registerConversions.push({ entry, conversion: source.conversion });
  }
  for (const { entry, meta } of issuanceEventsEntries(roots.foiDir)) {
    for (const conversion of issuanceEventsSourcesFor(meta)) registerConversions.push({ entry, conversion });
  }
  for (const { entry, conversion } of registerConversions) {
    const sourceFile = foiSourceFile(entry, conversion);
    if (conversionOutputs(conversion, STATUS_OUTPUT)) statusSources.push(sourceFile);
    if (conversionOutputs(conversion, LICENCE_CLASS_OUTPUT)) productSources.push(sourceFile);
  }

  // Membership families: collected whole (every conversion's source), regardless
  // of which columns they output — the projection counts their @listed anchors.
  const availablePoolSources: string[] = [];
  for (const { entry, meta } of availablePoolEntries(roots.foiDir)) {
    const variant = meta.converter?.variant;
    if (variant === undefined || variant === null) continue;
    for (const conversion of (FOI_ENTRY_CONVERSIONS[variant] ?? [])) availablePoolSources.push(foiSourceFile(entry, conversion));
  }
  const forbiddenSources: string[] = [];
  for (const { entry, meta } of forbiddenListEntries(roots.foiDir)) {
    for (const source of forbiddenSourcesFor(meta)) forbiddenSources.push(foiSourceFile(entry, source.conversion));
  }

  const sortUnique = (values: string[]): string[] => [...new Set(values)].sort();
  return {
    statusSources: sortUnique(statusSources),
    productSources: sortUnique(productSources),
    availablePoolSources: sortUnique(availablePoolSources),
    forbiddenSources: sortUnique(forbiddenSources),
  };
}
