/**
 * Header-variant detection from an archive entry's own parse source (issue
 * #629 phase 3): read the entry's header row - the first physical line of the
 * declared extract when one exists, else raw.csv - and detect the authored
 * variant via the same registry the converter lane detects with.
 *
 * This is what lets a freshly fetched publication (raw + meta only, no
 * curated declarations) resolve its authored raw->canonical binding: the
 * header row is a hash-pinned committed INPUT (the verbatim publication),
 * never a derivative, so reading it keeps the ledger fold independent of the
 * committed derived files while never re-guessing what a column means - the
 * registry match is exact and order-sensitive, and an unknown shape stays
 * honestly undetected.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'csv-parse/sync';
import { parseSourceFileName } from '../../shared/archive.ts';
import type { ArchiveMeta } from '../../shared/utils.ts';
import { detectHeaderVariant } from './normalise.ts';

export interface ObservedHeader {
  // The parse source's header row, cell by cell - undefined when the parse
  // source is absent or its first line does not parse as a CSV row.
  headers: string[] | undefined;
  // The authored variant those headers detect to - undefined when headers are
  // unreadable or match no authored shape (never a guess).
  variant: string | undefined;
}

// Read one entry's header row and detect its variant. Absence and
// unparseability both return { undefined, undefined }: the CALLER decides
// whether that is a legitimate state (a status grid reporting "not yet
// mapped") or a loud failure (a projection with nothing else to bind by).
export function observeEntryHeader(entryDir: string, meta: { files?: ArchiveMeta['files'] }): ObservedHeader {
  try {
    const parseSource = path.join(entryDir, parseSourceFileName({ files: meta.files ?? {} }));
    if (!fs.existsSync(parseSource)) return { headers: undefined, variant: undefined };
    const firstLine = fs.readFileSync(parseSource, 'utf8').split(/\r?\n/, 1)[0] ?? '';
    const rows = parse(firstLine, { bom: true }) as string[][];
    const headers = rows[0];
    if (headers === undefined) return { headers: undefined, variant: undefined };
    return { headers, variant: detectHeaderVariant(headers) };
  } catch {
    // An unreadable or unparseable header row is honestly "nothing observed" -
    // the same state as a missing parse source.
    return { headers: undefined, variant: undefined };
  }
}
