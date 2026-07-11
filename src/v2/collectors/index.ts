/**
 * The collector registry: the ONE list every source family joins, in a stable
 * declaration order that fixes the corpus order (and therefore the byte output).
 * Adding a family is adding its module above plus one line here.
 */

import type { LedgerCollector, LedgerRoots, ResolvedLedgerSource } from './types.ts';
import { foiRegisterCollector } from './foi-register.ts';
import { openDataRegisterCollector } from './open-data-register.ts';
import { attributeAddendumCollector } from './attribute-addendum.ts';
import { statisticsCollector } from './statistics.ts';

// Stable order (declaration order): FOI register first, then open-data
// register, then the attribute addenda, then the statistics aggregates - the
// order buildLedger folds and emits in, so the corpus order and the JSONL
// bytes are preserved.
export const COLLECTORS: readonly LedgerCollector[] = [
  foiRegisterCollector,
  openDataRegisterCollector,
  attributeAddendumCollector,
  statisticsCollector,
];

// Every source across all covered families, in the registry's stable order,
// ready for the one emit path.
export function collectLedgerSources(roots: LedgerRoots): ResolvedLedgerSource[] {
  return COLLECTORS.flatMap(collector => collector.collect(roots));
}
