import { describe, expect, it } from 'vitest';
import { BUILT_IN_MATERIALS, materialNotices, NOT_APPROVED_NOTICE } from '../src/materials';
import type { MaterialRecord } from '../src/materials';
import { at } from './helpers/helpers';

const base: MaterialRecord = at(BUILT_IN_MATERIALS, 0);
const text = (m: MaterialRecord) => materialNotices(m).join('\n');

describe('materialNotices', () => {
  it('every built-in material says it is illustrative and not an approved Cypriot design value', () => {
    for (const m of BUILT_IN_MATERIALS) {
      expect(text(m), m.id).toContain('Illustrative');
      expect(text(m), m.id).toContain('not stated whether this is a measured, declared or design value');
      expect(materialNotices(m).at(-1), m.id).toBe(NOT_APPROVED_NOTICE);
    }
  });

  it('even a verified value is not presented as an approved Cypriot design value', () => {
    const verified: MaterialRecord = { ...base, status: 'verified', valueType: 'design', source: { ...base.source, type: 'standard' } };
    expect(text(verified)).toContain('Verified');
    expect(materialNotices(verified)).toContain(NOT_APPROVED_NOTICE);
  });

  it('keeps measured, declared and design values distinct', () => {
    const notice = (valueType: MaterialRecord['valueType']) => text({ ...base, valueType });
    expect(notice('measured')).toContain('Measured value');
    expect(notice('declared')).toContain('Declared (manufacturer) value');
    expect(notice('design')).toContain('Design value as stated by its source');
    expect(notice('measured')).toContain('not automatically a design value');
    expect(notice('declared')).toContain('not automatically a design value');
  });

  it('flags supplementary reference tables as non-governing', () => {
    const table: MaterialRecord = { ...base, status: 'unverified', source: { ...base.source, type: 'reference-table' } };
    expect(text(table)).toContain('supplementary reference table');
    expect(text(table)).toContain('not automatically the governing source for Cypriot design values');
    expect(text(base)).not.toContain('supplementary reference table');
  });

  it('describes unverified and user-defined status', () => {
    expect(text({ ...base, status: 'unverified' })).toContain('Unverified');
    expect(text({ ...base, status: 'user-defined' })).toContain('User-defined');
  });
});
