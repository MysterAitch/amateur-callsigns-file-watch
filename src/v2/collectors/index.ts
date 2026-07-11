/**
 * The collector registry: the ONE list every source family joins, in a stable
 * declaration order that fixes the corpus order (and therefore the byte output).
 * Adding a family is adding its module above plus one line here.
 */

import type { LedgerCollector, LedgerRoots, ResolvedLedgerSource } from './types.ts';
import { foiRegisterCollector } from './foi-register.ts';
import { openDataRegisterCollector } from './open-data-register.ts';
import { attributeAddendumCollector } from './attribute-addendum.ts';
import { forbiddenListCollector } from './forbidden-list.ts';
import { statisticsCollector } from './statistics.ts';
import { availablePoolCollector } from './available-pool.ts';
import { issuanceEventsCollector } from './issuance-events.ts';

// Stable order (declaration order): FOI register first, then open-data
// register, then the attribute addenda, then the bespoke non-callsign families
// (forbidden-suffix lists, statistics aggregates, then available-pool
// disclosures), then the issuance-events family (callsign-subject dated
// licensing events) - the order buildLedger folds and emits in, so the corpus
// order and the JSONL bytes are preserved.
export const COLLECTORS: readonly LedgerCollector[] = [
  foiRegisterCollector,
  openDataRegisterCollector,
  attributeAddendumCollector,
  forbiddenListCollector,
  statisticsCollector,
  availablePoolCollector,
  issuanceEventsCollector,
];

// Every source across all covered families, in the registry's stable order,
// ready for the one emit path.
export function collectLedgerSources(roots: LedgerRoots): ResolvedLedgerSource[] {
  return COLLECTORS.flatMap(collector => collector.collect(roots));
}
