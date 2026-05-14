import { describe, expect, it } from 'vitest';
import { TAB_FIELD_MASKS } from './tabFieldMasks.js';

describe('Google Docs tab field masks', () => {
  it('uses explicit tab properties instead of broad tab expansions', () => {
    for (const mask of Object.values(TAB_FIELD_MASKS)) {
      expect(mask).not.toContain('tabs)');
      expect(mask).not.toContain('tabProperties,');
      expect(mask).not.toContain('childTabs(tabProperties,');
      expect(mask).toContain('tabProperties(tabId');
    }
  });
});
