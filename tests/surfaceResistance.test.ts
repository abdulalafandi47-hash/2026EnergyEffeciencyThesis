import { describe, expect, it } from 'vitest';
import {
  calculateWall,
  customSurfaceResistances,
  ISO6946_U_VALUE_PRESETS,
  iso6946Preset,
  validateWallInput,
} from '../src/engine';
import { referenceWall } from './helpers/helpers';

describe('surface resistance presets', () => {
  it('differ by heat-flow direction (they are not one universal constant)', () => {
    expect(iso6946Preset('horizontal').insideM2KPerW).toBe(0.13);
    expect(iso6946Preset('upwards').insideM2KPerW).toBe(0.1);
    expect(iso6946Preset('downwards').insideM2KPerW).toBe(0.17);
    for (const orientation of ['horizontal', 'upwards', 'downwards'] as const) {
      expect(iso6946Preset(orientation).outsideM2KPerW).toBe(0.04);
      expect(iso6946Preset(orientation).heatFlowOrientation).toBe(orientation);
    }
  });

  it('are honestly labelled "unverified" until checked against the standard', () => {
    for (const preset of Object.values(ISO6946_U_VALUE_PRESETS)) {
      expect(preset.status).toBe('unverified');
      expect(preset.basis).toContain('ISO 6946');
      expect(preset.basis).toContain('Not yet checked');
    }
  });

  it('are valid inputs for the engine', () => {
    const wall = referenceWall({ surfaceResistances: iso6946Preset('horizontal') });
    expect(validateWallInput(wall)).toEqual([]);
  });

  it('are returned as copies, so editing one cannot corrupt the shared presets', () => {
    const copy = iso6946Preset('horizontal');
    copy.insideM2KPerW = 99;
    expect(iso6946Preset('horizontal').insideM2KPerW).toBe(0.13);
  });
});

describe('custom surface resistances', () => {
  it('are marked user-defined and keep the stated basis', () => {
    const custom = customSurfaceResistances(0.11, 0.05, 'horizontal', 'Measured on site (example)');
    expect(custom).toEqual({
      insideM2KPerW: 0.11,
      outsideM2KPerW: 0.05,
      heatFlowOrientation: 'horizontal',
      basis: 'Measured on site (example)',
      status: 'user-defined',
    });
  });

  it('change the U-value in the expected direction when the film resistance rises', () => {
    const low = calculateWall(referenceWall({ surfaceResistances: customSurfaceResistances(0.1, 0.04, 'horizontal', 'test') }));
    const high = calculateWall(referenceWall({ surfaceResistances: customSurfaceResistances(0.25, 0.04, 'horizontal', 'test') }));
    expect(high.uValueWPerM2K).toBeLessThan(low.uValueWPerM2K);
  });
});

describe('engine warnings about surface resistances', () => {
  it('warns when the preset is unverified, so it is never applied silently', () => {
    const result = calculateWall(referenceWall({ surfaceResistances: iso6946Preset('horizontal') }));
    expect(result.warnings.map((w) => w.code)).toContain('surface-resistance-unverified');
  });

  it('does not warn about user-defined horizontal values', () => {
    const result = calculateWall(referenceWall());
    expect(result.warnings.map((w) => w.code)).not.toContain('surface-resistance-unverified');
    expect(result.warnings.map((w) => w.code)).not.toContain('surface-resistance-orientation');
  });

  it('warns when values chosen for upward/downward flow are used for a vertical wall', () => {
    for (const orientation of ['upwards', 'downwards'] as const) {
      const result = calculateWall(referenceWall({ surfaceResistances: iso6946Preset(orientation) }));
      const warning = result.warnings.find((w) => w.code === 'surface-resistance-orientation');
      expect(warning?.message).toContain(orientation);
    }
  });

  it('still uses the values the caller chose (the warning does not override them)', () => {
    const result = calculateWall(referenceWall({ surfaceResistances: iso6946Preset('upwards') }));
    expect(result.resistance.insideSurfaceM2KPerW).toBe(0.1);
  });

  it('prints the surface-resistance choice in the assumptions list', () => {
    const result = calculateWall(referenceWall({ surfaceResistances: iso6946Preset('horizontal') }));
    const line = result.assumptions.find((a) => a.startsWith('Surface resistances'));
    expect(line).toContain('R_si = 0.13');
    expect(line).toContain('R_se = 0.04');
    expect(line).toContain('horizontal');
    expect(line).toContain('unverified');
  });
});
