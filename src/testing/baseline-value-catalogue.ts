/**
 * The value-catalogue report rendered over the frozen baseline, for the
 * ledger-versus-legacy equivalence oracles.
 *
 * Those oracles compare the claim-ledger fold with a legacy tally read from
 * the committed derived files. The legacy side can only ever see the baseline
 * entries, so the fold side has to be the baseline too: comparing it with the
 * committed report, which covers every publication held, measures the size of
 * the newest publication rather than whether the two paths agree.
 */

import { renderValueCatalogueFromLedger } from '../ci/value-catalogue.ts';
import { withFrozenBaselineArchive } from './frozen-baseline-archive.ts';

let cached: string | undefined;

// Folds once per test file (vitest isolates files, so the cache is per file).
// Needs DuckDB, like every other ledger fold.
export function baselineValueCatalogueMarkdown(): string {
  cached ??= withFrozenBaselineArchive(() => renderValueCatalogueFromLedger());
  return cached;
}
