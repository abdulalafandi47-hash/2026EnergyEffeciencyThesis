import { describe, expect, it } from 'vitest';
import { validateWallInput } from '../src/engine';
import type { ValidationIssue } from '../src/engine';
import { INSULATION, referenceWall, wrong } from './helpers/helpers';

const paths = (issues: ValidationIssue[]): string[] => issues.map((issue) => issue.path);
const codes = (issues: ValidationIssue[]): string[] => issues.map((issue) => issue.code);

describe('validateWallInput', () => {
  it('accepts the reference wall', () => {
    expect(validateWallInput(referenceWall())).toEqual([]);
  });

  it.each([null, undefined, 42, 'wall', [], true])('rejects non-object input: %s', (value) => {
    expect(codes(validateWallInput(value))).toEqual(['invalid-structure']);
  });

  describe('dimensions', () => {
    it.each([0, -1, NaN, Infinity])('rejects width %s', (value) => {
      expect(paths(validateWallInput(referenceWall({ widthM: value })))).toEqual(['widthM']);
    });
    it.each([0, -1, NaN, Infinity])('rejects height %s', (value) => {
      expect(paths(validateWallInput(referenceWall({ heightM: value })))).toEqual(['heightM']);
    });
    it('rejects missing dimensions', () => {
      const wall = { ...referenceWall(), widthM: undefined, heightM: undefined };
      expect(codes(validateWallInput(wall))).toEqual(['missing-value', 'missing-value']);
    });
  });

  describe('layers', () => {
    it('rejects an empty layer list', () => {
      expect(codes(validateWallInput(referenceWall({ layers: [] })))).toEqual(['no-layers']);
    });
    it('rejects a missing or non-array layer list', () => {
      expect(codes(validateWallInput({ ...referenceWall(), layers: undefined }))).toEqual(['no-layers']);
      expect(codes(validateWallInput({ ...referenceWall(), layers: 'plaster' }))).toEqual(['no-layers']);
    });
    it('rejects a layer that is not an object', () => {
      expect(codes(validateWallInput({ ...referenceWall(), layers: [wrong(7)] }))).toEqual(['invalid-structure']);
    });

    it.each([0, -0.05, NaN, Infinity])('rejects thickness %s and names the layer', (value) => {
      const wall = referenceWall();
      wall.layers[2] = { ...INSULATION, thicknessM: value };
      const issues = validateWallInput(wall);
      expect(paths(issues)).toEqual(['layers[2].thicknessM']);
      expect(issues[0]?.message).toContain('Layer 3 (Insulation (test))');
    });

    it.each([0, -0.04, NaN, Infinity])('rejects conductivity %s', (value) => {
      const wall = referenceWall();
      wall.layers[1] = { ...INSULATION, lambdaWPerMK: value };
      expect(paths(validateWallInput(wall))).toEqual(['layers[1].lambdaWPerMK']);
    });

    it('rejects missing thickness and conductivity', () => {
      const wall = referenceWall();
      wall.layers[0] = { name: 'Broken' } as never;
      expect(paths(validateWallInput(wall))).toEqual(['layers[0].thicknessM', 'layers[0].lambdaWPerMK']);
    });

    it('rejects a missing or blank name', () => {
      const wall = referenceWall();
      wall.layers[0] = { ...INSULATION, name: '   ' };
      expect(paths(validateWallInput(wall))).toEqual(['layers[0].name']);
    });

    it('allows density and specific heat to be absent (heat capacity is then unavailable)', () => {
      const wall = referenceWall();
      wall.layers[0] = { name: 'Bare', thicknessM: 0.1, lambdaWPerMK: 0.5 };
      expect(validateWallInput(wall)).toEqual([]);
    });

    it('treats null density as absent', () => {
      const wall = referenceWall();
      wall.layers[0] = { ...INSULATION, densityKgPerM3: wrong(null) };
      expect(validateWallInput(wall)).toEqual([]);
    });

    it.each([0, -10, NaN, Infinity])('rejects a PRESENT but invalid density %s', (value) => {
      const wall = referenceWall();
      wall.layers[0] = { ...INSULATION, densityKgPerM3: value };
      expect(paths(validateWallInput(wall))).toEqual(['layers[0].densityKgPerM3']);
    });

    it.each([0, -10, NaN])('rejects a PRESENT but invalid specific heat %s', (value) => {
      const wall = referenceWall();
      wall.layers[0] = { ...INSULATION, specificHeatJPerKgK: value };
      expect(paths(validateWallInput(wall))).toEqual(['layers[0].specificHeatJPerKgK']);
    });

    it('reports problems in several layers at once', () => {
      const wall = referenceWall();
      wall.layers[0] = { ...INSULATION, thicknessM: 0 };
      wall.layers[3] = { ...INSULATION, lambdaWPerMK: -1 };
      expect(paths(validateWallInput(wall))).toEqual(['layers[0].thicknessM', 'layers[3].lambdaWPerMK']);
    });
  });

  describe('surface resistances (never defaulted silently)', () => {
    it('requires them to be chosen explicitly', () => {
      const issues = validateWallInput({ ...referenceWall(), surfaceResistances: undefined });
      expect(paths(issues)).toEqual(['surfaceResistances']);
      expect(issues[0]?.message).toContain('chosen explicitly');
    });

    it('rejects negative, NaN and missing values; allows zero', () => {
      const base = referenceWall().surfaceResistances;
      expect(paths(validateWallInput(referenceWall({ surfaceResistances: { ...base, insideM2KPerW: -0.1 } })))).toEqual([
        'surfaceResistances.insideM2KPerW',
      ]);
      expect(paths(validateWallInput(referenceWall({ surfaceResistances: { ...base, outsideM2KPerW: NaN } })))).toEqual([
        'surfaceResistances.outsideM2KPerW',
      ]);
      expect(
        paths(validateWallInput(referenceWall({ surfaceResistances: { ...base, insideM2KPerW: wrong(undefined) } }))),
      ).toEqual(['surfaceResistances.insideM2KPerW']);
      expect(
        validateWallInput(referenceWall({ surfaceResistances: { ...base, insideM2KPerW: 0, outsideM2KPerW: 0 } })),
      ).toEqual([]);
    });

    it('rejects an unknown orientation or status and a blank basis', () => {
      const base = referenceWall().surfaceResistances;
      expect(
        paths(validateWallInput(referenceWall({ surfaceResistances: { ...base, heatFlowOrientation: wrong('sideways') } }))),
      ).toEqual(['surfaceResistances.heatFlowOrientation']);
      expect(
        paths(validateWallInput(referenceWall({ surfaceResistances: { ...base, status: wrong('trust-me') } }))),
      ).toEqual(['surfaceResistances.status']);
      expect(paths(validateWallInput(referenceWall({ surfaceResistances: { ...base, basis: '  ' } })))).toEqual([
        'surfaceResistances.basis',
      ]);
    });
  });

  describe('boundary conditions', () => {
    it('requires the conditions object', () => {
      expect(paths(validateWallInput({ ...referenceWall(), conditions: undefined }))).toEqual(['conditions']);
    });

    it('accepts negative and equal temperatures and zero duration', () => {
      expect(
        validateWallInput(
          referenceWall({ conditions: { insideTemperatureC: -5, outsideTemperatureC: -5, durationHours: 0 } }),
        ),
      ).toEqual([]);
    });

    it('rejects NaN, infinite or missing temperatures', () => {
      const conditions = { insideTemperatureC: NaN, outsideTemperatureC: Infinity, durationHours: 1 };
      expect(paths(validateWallInput(referenceWall({ conditions })))).toEqual([
        'conditions.insideTemperatureC',
        'conditions.outsideTemperatureC',
      ]);
      expect(
        paths(validateWallInput(referenceWall({ conditions: { ...referenceWall().conditions, insideTemperatureC: wrong(undefined) } }))),
      ).toEqual(['conditions.insideTemperatureC']);
    });

    it('rejects temperatures below absolute zero', () => {
      const conditions = { insideTemperatureC: -300, outsideTemperatureC: 5, durationHours: 1 };
      expect(codes(validateWallInput(referenceWall({ conditions })))).toEqual(['below-absolute-zero']);
    });

    it('rejects negative duration', () => {
      const conditions = { insideTemperatureC: 20, outsideTemperatureC: 5, durationHours: -1 };
      expect(codes(validateWallInput(referenceWall({ conditions })))).toEqual(['must-be-non-negative']);
    });
  });

  it('collects every problem in one pass', () => {
    const wall = referenceWall({ widthM: 0, heightM: -2 });
    wall.layers[0] = { ...INSULATION, thicknessM: 0, lambdaWPerMK: 0 };
    const issues = validateWallInput({ ...wall, surfaceResistances: undefined, conditions: undefined });
    expect(paths(issues)).toEqual([
      'widthM',
      'heightM',
      'layers[0].thicknessM',
      'layers[0].lambdaWPerMK',
      'surfaceResistances',
      'conditions',
    ]);
  });
});
