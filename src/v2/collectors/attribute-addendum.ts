/**
 * The attribute-addendum family: FOI entries whose datasetClasses carry
 * 'attribute-addendum' (archive/foi/**), the per-callsign attribute rows
 * (licence-issued / original-start dates, reservation expiries) that the
 * register family deliberately excludes at the entry level. Its
 * callsign-row-per-line CSV sources ride the SAME register machinery
 * (registerSourcesFor + loadRegisterSource), keyed off the authored converter
 * binding.
 */

import { listFoiEntryKeys, readFoiEntryMeta, defaultFoiDir } from '../../shared/foi-archive.ts';
import type { LedgerCollector, ResolvedLedgerSource } from './types.ts';
import { jsonlStem } from './util.ts';
import {
  ATTRIBUTE_ADDENDUM_CLASS,
  registerSourcesFor,
  loadRegisterSource,
  type RegisterEntry,
} from './foi-register.ts';

// The attribute-addendum entries: 'attribute-addendum' present in
// datasetClasses. These are exactly the FOI entries the register family
// excludes (EXCLUDED_CLASSES), picked up here by their own collector - so the
// two selections are disjoint by construction and no source is emitted twice.
// Sorted for a stable, reproducible corpus order (listFoiEntryKeys is sorted).
export function attributeAddendumEntries(foiDir: string = defaultFoiDir()): RegisterEntry[] {
  const entries: RegisterEntry[] = [];
  for (const entry of listFoiEntryKeys(foiDir)) {
    const meta = readFoiEntryMeta(foiDir, entry);
    if (!meta.datasetClasses.includes(ATTRIBUTE_ADDENDUM_CLASS)) continue;
    entries.push({ entry, meta });
  }
  return entries;
}

// The attribute-addendum family: every attribute-addendum FOI entry's
// callsign-bearing verbatim CSV sources, each resolved to a loader over the
// entry's RAW bytes. The conversion-shape filter is the register family's own
// (registerSourcesFor): a raw header mapped verbatim to the callsign column and
// parsed as CSV. Two addendum shapes ride a raw encoding this CSV loader does
// not parse and so drop out of registerSourcesFor - a preamble-bearing workbook
// annex (the pre-war-callsigns sheet, whose title rows precede the header) and a
// markdown-table PDF transcription (the heritage-transfer re-issue table). Both
// await a raw parser lifted from the FOI converter, exactly as the PDF-only
// sources do; until then they are among the remaining families, not this one.
export function collectAttributeAddendumSources(foiDir: string = defaultFoiDir()): ResolvedLedgerSource[] {
  const resolved: ResolvedLedgerSource[] = [];
  for (const { entry, meta } of attributeAddendumEntries(foiDir)) {
    for (const source of registerSourcesFor(meta)) {
      resolved.push({
        family: 'attribute-addendum',
        subjectKind: 'callsign',
        entry,
        sourceFile: `foi/${entry}/${source.conversion.sourceFile}`,
        jsonlStem: jsonlStem('addendum', entry, source.conversion.sourceFile),
        load: () => loadRegisterSource(foiDir, entry, meta, source),
      });
    }
  }
  return resolved;
}

export const attributeAddendumCollector: LedgerCollector = {
  family: 'attribute-addendum',
  subjectKind: 'callsign',
  collect: roots => collectAttributeAddendumSources(roots.foiDir),
};
