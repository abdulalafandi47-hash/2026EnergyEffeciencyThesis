import { describe, expect, it } from 'vitest';
import {
  arealHeatCapacity,
  energyKWh,
  EngineInputError,
  heatCapacity,
  heatFlowDirection,
  heatTransferRateW,
  layerResistance,
  totalResistance,
  uValueFromResistance,
  wallArea,
} from '../src/engine';
import { expectClose, issuesOf, wrong } from './helpers/helpers';

/** Values that are never acceptable where a positive number is required. */
const NOT_POSITIVE: Array<[string, unknown]> = [
  ['zero', 0],
  ['negative', -0.1],
  ['NaN', NaN],
  ['Infinity', Infinity],
  ['-Infinity', -Infinity],
  ['undefined (missing)', undefined],
  ['null (missing)', null],
  ['a numeric string', '0.5'],
];

describe('layerResistance: R = d / λ', () => {
  it('matches hand calculations', () => {
    expectClose(layerResistance(0.2, 1.0), 0.2);
    expectClose(layerResistance(0.08, 0.04), 2.0);
    expectClose(layerResistance(0.015, 0.5), 0.03);
    expectClose(layerResistance(0.3, 0.6), 0.5);
  });

  it('doubles when thickness doubles and halves when conductivity doubles', () => {
    const base = layerResistance(0.1, 0.04);
    expectClose(layerResistance(0.2, 0.04), 2 * base);
    expectClose(layerResistance(0.1, 0.08), base / 2);
  });

  it.each(NOT_POSITIVE)('rejects thickness that is %s', (_label, value) => {
    expect(() => layerResistance(wrong(value), 1)).toThrow(EngineInputError);
  });

  it.each(NOT_POSITIVE)('rejects conductivity that is %s', (_label, value) => {
    expect(() => layerResistance(0.1, wrong(value))).toThrow(EngineInputError);
  });

  it('reports which field is wrong', () => {
    expect(issuesOf(() => layerResistance(-1, 1))[0]?.path).toBe('thicknessM');
    expect(issuesOf(() => layerResistance(1, 0))[0]?.path).toBe('lambdaWPerMK');
  });
});

describe('totalResistance: R_total = R_si + Σ R_i + R_se', () => {
  it('adds surface films and layers', () => {
    expectClose(totalResistance([0.03, 0.2, 2.0, 0.025], 0.13, 0.04), 2.425);
  });

  it('works with a single layer and with zero surface resistances', () => {
    expectClose(totalResistance([0.5], 0, 0), 0.5);
  });

  it('is independent of layer order (resistances in series simply add)', () => {
    expectClose(totalResistance([2.0, 0.03, 0.2], 0.13, 0.04), totalResistance([0.03, 0.2, 2.0], 0.13, 0.04));
  });

  it('rejects an empty layer list', () => {
    expect(issuesOf(() => totalResistance([], 0.13, 0.04))[0]?.code).toBe('no-layers');
  });

  it('rejects negative, NaN or missing surface resistances', () => {
    expect(() => totalResistance([1], -0.13, 0.04)).toThrow(EngineInputError);
    expect(() => totalResistance([1], 0.13, -0.04)).toThrow(EngineInputError);
    expect(() => totalResistance([1], NaN, 0.04)).toThrow(EngineInputError);
    expect(() => totalResistance([1], wrong(undefined), 0.04)).toThrow(EngineInputError);
    expect(() => totalResistance([1], 0.13, wrong(undefined))).toThrow(EngineInputError);
  });

  it('rejects zero, negative or NaN layer resistances', () => {
    expect(() => totalResistance([0.5, 0], 0.13, 0.04)).toThrow(EngineInputError);
    expect(() => totalResistance([0.5, -1], 0.13, 0.04)).toThrow(EngineInputError);
    expect(() => totalResistance([NaN], 0.13, 0.04)).toThrow(EngineInputError);
  });
});

describe('uValueFromResistance: U = 1 / R_total', () => {
  it('matches hand calculations', () => {
    expectClose(uValueFromResistance(2.425), 40 / 97);
    expectClose(uValueFromResistance(0.5), 2);
    expectClose(uValueFromResistance(4), 0.25);
  });

  it('U × R_total = 1', () => {
    for (const r of [0.2, 1, 2.425, 7.3]) {
      expectClose(uValueFromResistance(r) * r, 1);
    }
  });

  it.each(NOT_POSITIVE)('rejects R_total that is %s', (_label, value) => {
    expect(() => uValueFromResistance(wrong(value))).toThrow(EngineInputError);
  });
});

describe('wallArea: A = width × height', () => {
  it('multiplies the dimensions', () => {
    expect(wallArea(3, 2.5)).toBe(7.5);
  });
  it.each(NOT_POSITIVE)('rejects width that is %s', (_label, value) => {
    expect(() => wallArea(wrong(value), 2)).toThrow(EngineInputError);
  });
  it.each(NOT_POSITIVE)('rejects height that is %s', (_label, value) => {
    expect(() => wallArea(2, wrong(value))).toThrow(EngineInputError);
  });
});

describe('heatTransferRateW: Q = U · A · |ΔT|', () => {
  it('matches hand calculations', () => {
    expectClose(heatTransferRateW(2, 10, 21, 1), 400);
    expectClose(heatTransferRateW(40 / 97, 7.5, 20, 5), 4500 / 97);
  });

  it('returns the same magnitude whichever side is warmer', () => {
    expect(heatTransferRateW(0.4, 8, 20, 5)).toBe(heatTransferRateW(0.4, 8, 5, 20));
  });

  it('is exactly zero when there is no temperature difference', () => {
    expect(heatTransferRateW(0.4, 8, 15, 15)).toBe(0);
  });

  it('is never negative, including for sub-zero outdoor temperatures', () => {
    expect(heatTransferRateW(0.4, 8, 20, -10)).toBeGreaterThan(0);
    expect(heatTransferRateW(0.4, 8, -10, -20)).toBeGreaterThan(0);
  });

  it('doubles when area doubles and when the temperature difference doubles', () => {
    const base = heatTransferRateW(0.4, 8, 20, 10);
    expectClose(heatTransferRateW(0.4, 16, 20, 10), 2 * base);
    expectClose(heatTransferRateW(0.4, 8, 30, 10), 2 * base);
  });

  it('rejects invalid U-value, area and temperatures', () => {
    expect(() => heatTransferRateW(0, 8, 20, 5)).toThrow(EngineInputError);
    expect(() => heatTransferRateW(-0.4, 8, 20, 5)).toThrow(EngineInputError);
    expect(() => heatTransferRateW(0.4, 0, 20, 5)).toThrow(EngineInputError);
    expect(() => heatTransferRateW(0.4, -8, 20, 5)).toThrow(EngineInputError);
    expect(() => heatTransferRateW(0.4, 8, NaN, 5)).toThrow(EngineInputError);
    expect(() => heatTransferRateW(0.4, 8, 20, Infinity)).toThrow(EngineInputError);
    expect(() => heatTransferRateW(0.4, 8, wrong(undefined), 5)).toThrow(EngineInputError);
  });

  it('rejects temperatures below absolute zero', () => {
    expect(issuesOf(() => heatTransferRateW(0.4, 8, -300, 5))[0]?.code).toBe('below-absolute-zero');
  });
});

describe('heatFlowDirection', () => {
  it('is outward (heat loss) when inside is warmer', () => {
    expect(heatFlowDirection(20, 5)).toBe('outward');
    expect(heatFlowDirection(0, -5)).toBe('outward');
  });
  it('is inward (heat gain) when outside is warmer', () => {
    expect(heatFlowDirection(24, 35)).toBe('inward');
    expect(heatFlowDirection(-2, 3)).toBe('inward');
  });
  it('is none when temperatures are equal', () => {
    expect(heatFlowDirection(18, 18)).toBe('none');
  });
  it('rejects invalid temperatures', () => {
    expect(() => heatFlowDirection(NaN, 5)).toThrow(EngineInputError);
    expect(() => heatFlowDirection(5, wrong(undefined))).toThrow(EngineInputError);
  });
});

describe('energyKWh: E = Q · t / 1000', () => {
  it('matches hand calculations', () => {
    expectClose(energyKWh(1000, 1), 1);
    expectClose(energyKWh(400, 10), 4);
    expectClose(energyKWh(4500 / 97, 24), 108 / 97);
  });
  it('is zero for zero duration or zero rate', () => {
    expect(energyKWh(500, 0)).toBe(0);
    expect(energyKWh(0, 24)).toBe(0);
  });
  it('doubles when duration doubles', () => {
    expectClose(energyKWh(123.4, 48), 2 * energyKWh(123.4, 24));
  });
  it('rejects negative or invalid rate and duration', () => {
    expect(() => energyKWh(-1, 1)).toThrow(EngineInputError);
    expect(() => energyKWh(1, -1)).toThrow(EngineInputError);
    expect(() => energyKWh(NaN, 1)).toThrow(EngineInputError);
    expect(() => energyKWh(1, Infinity)).toThrow(EngineInputError);
    expect(() => energyKWh(1, wrong(undefined))).toThrow(EngineInputError);
  });
});

describe('heat capacity: C = ρ · c_p · V and areal = ρ · c_p · d', () => {
  it('matches hand calculations', () => {
    // 2000 kg/m³ × 1000 J/(kg·K) × 0.2 m = 400 000 J/(m²·K)
    expectClose(arealHeatCapacity(2000, 1000, 0.2), 400_000);
    // The same layer over 7.5 m² has volume 1.5 m³: 2000 × 1000 × 1.5 = 3 000 000 J/K
    expectClose(heatCapacity(2000, 1000, 1.5), 3_000_000);
  });

  it('total = areal × area', () => {
    const areal = arealHeatCapacity(1800, 900, 0.12);
    expectClose(heatCapacity(1800, 900, 0.12 * 7.5), areal * 7.5);
  });

  it.each(NOT_POSITIVE)('rejects density that is %s', (_label, value) => {
    expect(() => heatCapacity(wrong(value), 1000, 1)).toThrow(EngineInputError);
    expect(() => arealHeatCapacity(wrong(value), 1000, 0.1)).toThrow(EngineInputError);
  });

  it.each(NOT_POSITIVE)('rejects specific heat that is %s', (_label, value) => {
    expect(() => heatCapacity(1000, wrong(value), 1)).toThrow(EngineInputError);
    expect(() => arealHeatCapacity(1000, wrong(value), 0.1)).toThrow(EngineInputError);
  });

  it.each(NOT_POSITIVE)('rejects volume/thickness that is %s', (_label, value) => {
    expect(() => heatCapacity(1000, 1000, wrong(value))).toThrow(EngineInputError);
    expect(() => arealHeatCapacity(1000, 1000, wrong(value))).toThrow(EngineInputError);
  });
});
