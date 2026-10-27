import { describe, expect, it } from 'vitest';
import { BUILT_IN_MATERIALS, isIsoDate, materialWarnings, validateMaterial } from '../src/materials';
import type { MaterialRecord } from '../src/materials';
import type { ValidationIssue } from '../src/engine';
import { at, wrong } from './helpers/helpers';

const base: MaterialRecord = at(BUILT_IN_MATERIALS, 0);
const paths = (issues: ValidationIssue[]): string[] => issues.map((i) => i.path);

/** A record with every field required for status "verified". Synthetic: used only to test the rules. */
const verifiedRecord = (): MaterialRecord => ({
  ...base,
  status: 'verified',
  source: {
    citation: 'Synthetic test citation (not a real source)',
    location: 'Table X, row Y',
    checkedOn: '2026-01-31',
    checkedBy: 'Test Person',
  },
  conditions: 'Dry, 10 °C mean temperature (synthetic test)',
});

describe('validateMaterial: properties', () => {
  it('accepts a valid record', () => {
    expect(validateMaterial(base)).toEqual([]);
  });

  it.each([[0], [-0.5], [NaN], [Infinity], [wrong('0.5')], [wrong(undefined)], [wrong(null)]])('rejects conductivity %s', (value) => {
    expect(paths(validateMaterial({ ...base, lambdaWPerMK: value }))).toEqual(['lambdaWPerMK']);
  });

  it('allows density and specific heat to be absent', () => {
    const { densityKgPerM3: _d, specificHeatJPerKgK: _c, ...rest } = base;
    expect(validateMaterial(rest)).toEqual([]);
  });

  it.each([[0], [-1], [NaN]])('rejects a present but invalid density or specific heat: %s', (value) => {
    expect(paths(validateMaterial({ ...base, densityKgPerM3: value }))).toEqual(['densityKgPerM3']);
    expect(paths(validateMaterial({ ...base, specificHeatJPerKgK: value }))).toEqual(['specificHeatJPerKgK']);
  });

  it.each([null, undefined, 5, 'x', []])('rejects a non-object record: %s', (value) => {
    expect(validateMaterial(value).map((i) => i.code)).toEqual(['invalid-structure']);
  });
});

describe('validateMaterial: identity and units', () => {
  it.each(['', 'Has Caps', 'has space', '-lead', 'trail-', 'double--hyphen', 'under_score'])('rejects id "%s"', (id) => {
    expect(paths(validateMaterial({ ...base, id }))).toEqual(['id']);
  });

  it('requires a name and a known category', () => {
    expect(paths(validateMaterial({ ...base, name: '  ' }))).toEqual(['name']);
    expect(paths(validateMaterial({ ...base, category: wrong('Wood') }))).toEqual(['category']);
  });

  it('only accepts SI units, spelled exactly', () => {
    expect(paths(validateMaterial({ ...base, units: undefined }))).toEqual(['units']);
    expect(paths(validateMaterial({ ...base, units: { ...base.units, conductivity: wrong('BTU·in/(h·ft²·°F)') } }))).toEqual(['units']);
    expect(paths(validateMaterial({ ...base, units: { ...base.units, specificHeat: wrong('kJ/(kg·K)') } }))).toEqual(['units']);
  });
});

describe('validateMaterial: additional properties', () => {
  it('accepts well-formed extras', () => {
    const extra = [{ name: 'Water vapour resistance factor', value: 60, unit: '-' }];
    expect(validateMaterial({ ...base, additionalProperties: extra })).toEqual([]);
  });
  it('rejects malformed extras', () => {
    expect(paths(validateMaterial({ ...base, additionalProperties: wrong('x') }))).toEqual(['additionalProperties']);
    expect(paths(validateMaterial({ ...base, additionalProperties: [wrong(3)] }))).toEqual(['additionalProperties[0]']);
    expect(
      paths(validateMaterial({ ...base, additionalProperties: [{ name: '', value: -1, unit: ' ' }] })),
    ).toEqual(['additionalProperties[0].name', 'additionalProperties[0].unit', 'additionalProperties[0].value']);
  });
});

describe('validateMaterial: status and source (protects against over-claiming)', () => {
  it('accepts a fully documented verified record', () => {
    expect(validateMaterial(verifiedRecord())).toEqual([]);
  });

  it.each([
    ['source.location', (r: MaterialRecord) => ({ ...r, source: { ...r.source, location: undefined } })],
    ['source.checkedOn', (r: MaterialRecord) => ({ ...r, source: { ...r.source, checkedOn: undefined } })],
    ['source.checkedBy', (r: MaterialRecord) => ({ ...r, source: { ...r.source, checkedBy: '  ' } })],
    ['conditions', (r: MaterialRecord) => ({ ...r, conditions: undefined })],
  ])('"verified" without %s is rejected', (path, mutate) => {
    expect(paths(validateMaterial(mutate(verifiedRecord())))).toEqual([path]);
  });

  it('the same missing details are fine for an illustrative record', () => {
    expect(validateMaterial({ ...base, conditions: undefined })).toEqual([]);
  });

  it('an illustrative record must not carry a URL', () => {
    expect(paths(validateMaterial({ ...base, source: { ...base.source, url: 'https://example.org' } }))).toEqual(['source.url']);
  });

  it('a verified record may carry a URL, but it must look like one', () => {
    const ok = verifiedRecord();
    expect(validateMaterial({ ...ok, source: { ...ok.source, url: 'https://example.org/table' } })).toEqual([]);
    expect(paths(validateMaterial({ ...ok, source: { ...ok.source, url: 'example.org' } }))).toEqual(['source.url']);
  });

  it('rejects an unknown status and a missing source or citation', () => {
    expect(paths(validateMaterial({ ...base, status: wrong('certified') }))).toEqual(['status']);
    expect(paths(validateMaterial({ ...base, source: undefined }))).toEqual(['source']);
    expect(paths(validateMaterial({ ...base, source: { citation: ' ' } }))).toEqual(['source.citation']);
  });

  it('requires at least one non-empty limitation', () => {
    expect(paths(validateMaterial({ ...base, assumptionsAndLimitations: [] }))).toEqual(['assumptionsAndLimitations']);
    expect(paths(validateMaterial({ ...base, assumptionsAndLimitations: [' '] }))).toEqual(['assumptionsAndLimitations']);
    expect(paths(validateMaterial({ ...base, assumptionsAndLimitations: undefined }))).toEqual(['assumptionsAndLimitations']);
  });
});

describe('isIsoDate', () => {
  it.each(['2026-01-31', '2024-02-29', '1999-12-31'])('accepts %s', (d) => expect(isIsoDate(d)).toBe(true));
  it.each(['2026-02-30', '2025-02-29', '2026-13-01', '2026-1-1', '31/01/2026', '', 20260131, null])('rejects %s', (d) =>
    expect(isIsoDate(d)).toBe(false),
  );
});

describe('materialWarnings (sanity checks for valid-but-suspicious numbers)', () => {
  it('stays quiet for ordinary values', () => {
    expect(materialWarnings({ lambdaWPerMK: 0.04, densityKgPerM3: 30, specificHeatJPerKgK: 1450 })).toEqual([]);
    expect(materialWarnings({ lambdaWPerMK: 1.7 })).toEqual([]);
  });
  it('flags a conductivity typed in the wrong unit or with a slipped decimal', () => {
    expect(materialWarnings({ lambdaWPerMK: 40 })).toHaveLength(1);
    expect(materialWarnings({ lambdaWPerMK: 0.0004 })).toHaveLength(1);
  });
  it('flags specific heat given in kJ/(kg·K) instead of J/(kg·K)', () => {
    expect(materialWarnings({ lambdaWPerMK: 0.04, specificHeatJPerKgK: 1.45 })[0]).toContain('kJ/(kg·K)');
  });
  it('flags implausible density', () => {
    expect(materialWarnings({ lambdaWPerMK: 0.04, densityKgPerM3: 0.03 })).toHaveLength(1);
    expect(materialWarnings({ lambdaWPerMK: 0.04, densityKgPerM3: 90000 })).toHaveLength(1);
  });
});
