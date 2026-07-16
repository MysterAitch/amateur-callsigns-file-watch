import { describe, it, expect } from 'vitest';
import { humaniseSize, stampSizes } from './build-db-sizes.ts';

// Deploy-time size stamping (issue #499): the site's database-size labels are
// substituted from the real built files so they never drift as the databases
// grow. These pin the humanisation and the placeholder substitution.

describe('humaniseSize', { tags: ['unit'] }, () => {
  it('DatabaseSize_UnderAGibibyte_ReadsAsWholeMegabytes', () => {
    expect(humaniseSize(28 * 1024 * 1024)).toBe('28 MB');
    expect(humaniseSize(257 * 1024 * 1024)).toBe('257 MB');
  });

  it('DatabaseSize_JustUnderAGibibyte_StillReadsAsMegabytes', () => {
    // The combined database at ~1.06 GB (decimal) is 1011 MiB - under 1 GiB.
    expect(humaniseSize(1_060_401_152)).toBe('1011 MB');
  });

  it('DatabaseSize_AtOrAboveAGibibyte_ReadsAsTwoDecimalGigabytes', () => {
    expect(humaniseSize(1024 * 1024 * 1024)).toBe('1.00 GB');
    expect(humaniseSize(2 * 1024 * 1024 * 1024)).toBe('2.00 GB');
  });
});

describe('stampSizes', { tags: ['unit'] }, () => {
  it('SizeLabel_WithAPlaceholder_IsReplacedByTheHumanisedSize', () => {
    const { html, count } = stampSizes('combined — every publication ([[db-size:history]])', { history: '1.03 GB' });
    expect(html).toBe('combined — every publication (1.03 GB)');
    expect(count).toBe(1);
  });

  it('SizeLabel_WithNoPlaceholder_IsLeftUnchanged', () => {
    const { html, count } = stampSizes('no tokens here', { history: '1.03 GB' });
    expect(html).toBe('no tokens here');
    expect(count).toBe(0);
  });

  it('SizeLabel_WithMultipleDatabases_ReplacesEach', () => {
    const { html, count } = stampSizes('([[db-size:lookup]]) and ([[db-size:history]])', { lookup: '28 MB', history: '1.03 GB' });
    expect(html).toBe('(28 MB) and (1.03 GB)');
    expect(count).toBe(2);
  });
});
