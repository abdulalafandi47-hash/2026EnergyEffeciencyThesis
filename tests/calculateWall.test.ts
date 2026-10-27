import { describe, expect, it } from 'vitest';
import { calculateWall, customSurfaceResistances, ENERGY_ESTIMATE_NOTE, EngineInputError } from '../src/engine';
import type { WallInput } from '../src/engine';
import referenceData from './fixtures/reference-cases.json';
import { at, expectClose, INSULATION, issuesOf, MASONRY, PLASTER, referenceWall, RENDER, wallWithInsulation } from './helpers/helpers';

type ReferenceCase = (typeof referenceData.cases)[number];

function wallFromReferenceCase(c: ReferenceCase): WallInput {
  return {
    layers: c.input.layers.map((layer) => ({ ...layer })),
    widthM: c.input.widthM,
    heightM: c.input.heightM,
    surfaceResistances: customSurfaceResistances(
      c.input.surfaceResistances.insideM2KPerW,
      c.input.surfaceResistances.outsideM2KPerW,
      'horizontal',
      `reference case ${c.id}`,
    ),
    conditions: { ...c.input.conditions },
  };
}

// ---------------------------------------------------------------------------
// 1. Independent reference cases: expected values come from
//    validation/reference_cases.py (exact rational arithmetic, Python).
// ---------------------------------------------------------------------------
describe('engine vs independent reference cases (validation/reference_cases.py)', () => {
  it('the fixture file contains the cases we expect', () => {
    expect(referenceData.cases.map((c) => c.id)).toEqual([
      'A-four-layer-wall-heat-loss',
      'B-single-layer-pure-conduction',
      'C-four-layer-wall-heat-gain',
      'D-three-layer-wall-sub-zero-outside',
    ]);
  });

  describe.each(referenceData.cases)('$id', (c) => {
    const result = calculateWall(wallFromReferenceCase(c));
    const e = c.expected;

    it('geometry', () => {
      expectClose(result.geometry.areaM2, e.areaM2);
      expectClose(result.geometry.totalThicknessM, e.totalThicknessM);
    });

    it('layer resistances R = d/λ and their shares of the total', () => {
      expect(result.layers).toHaveLength(e.layerResistancesM2KPerW.length);
      result.layers.forEach((layer, i) => {
        expectClose(layer.resistanceM2KPerW, at(e.layerResistancesM2KPerW, i));
        expectClose(layer.fractionOfTotal, at(e.layerResistanceFractions, i));
      });
    });

    it('total resistance and U-value', () => {
      expectClose(result.resistance.totalM2KPerW, e.totalResistanceM2KPerW);
      expectClose(result.uValueWPerM2K, e.uValueWPerM2K);
    });

    it('heat-transfer magnitude and direction are reported separately', () => {
      expectClose(result.heatTransfer.temperatureDifferenceK, e.temperatureDifferenceK);
      expectClose(result.heatTransfer.magnitudeW, e.heatTransferMagnitudeW);
      expectClose(result.heatTransfer.fluxMagnitudeWPerM2, e.heatFluxMagnitudeWPerM2);
      expect(result.heatTransfer.direction).toBe(e.direction);
    });

    it('energy over time', () => {
      expectClose(result.energy.magnitudeKWh, e.energyMagnitudeKWh);
      expect(result.energy.direction).toBe(e.direction);
    });

    it('heat capacity (per layer, areal and total)', () => {
      const hc = result.heatCapacity;
      if (!hc.available) throw new Error('heat capacity should be available');
      hc.perLayer.forEach((layer, i) => {
        expectClose(layer.arealJPerM2K, at(e.arealHeatCapacityPerLayerJPerM2K, i));
      });
      expectClose(hc.arealJPerM2K, e.arealHeatCapacityJPerM2K);
      expectClose(hc.totalJPerK, e.totalHeatCapacityJPerK);
    });

    it('temperature profile', () => {
      expect(result.temperatureProfile).toHaveLength(e.temperatureProfile.length);
      result.temperatureProfile.forEach((point, i) => {
        const expected = at(e.temperatureProfile, i);
        expect(point.kind).toBe(expected.kind);
        expectClose(point.positionM, expected.positionM);
        expectClose(point.temperatureC, expected.temperatureC);
      });
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Readable hand-derived checks (the derivation is in validation/REFERENCE_CASES.md)
// ---------------------------------------------------------------------------
describe('hand-derived case A: plaster / masonry / insulation / render', () => {
  const result = calculateWall(referenceWall());

  it('layer resistances', () => {
    expectClose(at(result.layers, 0).resistanceM2KPerW, 0.03); // 0.015 / 0.50
    expectClose(at(result.layers, 1).resistanceM2KPerW, 0.2); // 0.200 / 1.00
    expectClose(at(result.layers, 2).resistanceM2KPerW, 2.0); // 0.080 / 0.040
    expectClose(at(result.layers, 3).resistanceM2KPerW, 0.025); // 0.020 / 0.80
  });

  it('R_total = 0.13 + 0.03 + 0.2 + 2.0 + 0.025 + 0.04 = 2.425 m²K/W and U = 40/97', () => {
    expectClose(result.resistance.layersM2KPerW, 2.255);
    expectClose(result.resistance.totalM2KPerW, 2.425);
    expectClose(result.uValueWPerM2K, 40 / 97); // ≈ 0.41237 W/(m²K)
  });

  it('Q = U·A·ΔT = (40/97) × 7.5 × 15 = 4500/97 ≈ 46.39 W, outward', () => {
    expectClose(result.heatTransfer.magnitudeW, 4500 / 97);
    expect(result.heatTransfer.direction).toBe('outward');
  });

  it('E = Q × 24 h / 1000 = 108/97 ≈ 1.1134 kWh', () => {
    expectClose(result.energy.magnitudeKWh, 108 / 97);
  });

  it('areal heat capacity 18 000 + 400 000 + 3 600 + 36 000 = 457 600 J/(m²K); total 3 432 000 J/K', () => {
    const hc = result.heatCapacity;
    if (!hc.available) throw new Error('heat capacity should be available');
    expectClose(hc.arealJPerM2K, 457_600);
    expectClose(hc.totalJPerK, 3_432_000);
  });
});

describe('hand-derived case B: one layer, no surface films', () => {
  const wall: WallInput = {
    layers: [{ name: 'Slab (test)', thicknessM: 0.3, lambdaWPerMK: 0.6 }],
    widthM: 5,
    heightM: 2,
    surfaceResistances: customSurfaceResistances(0, 0, 'horizontal', 'pure conduction check'),
    conditions: { insideTemperatureC: 21, outsideTemperatureC: 1, durationHours: 10 },
  };
  const result = calculateWall(wall);

  it('U = λ/d = 0.6 / 0.3 = 2 W/(m²K)', () => {
    expectClose(result.resistance.totalM2KPerW, 0.5);
    expectClose(result.uValueWPerM2K, 2);
  });
  it('Q = 2 × 10 m² × 20 K = 400 W and E = 400 W × 10 h = 4 kWh', () => {
    expectClose(result.heatTransfer.magnitudeW, 400);
    expectClose(result.energy.magnitudeKWh, 4);
  });
});

// ---------------------------------------------------------------------------
// 3. Structure and consistency of the result
// ---------------------------------------------------------------------------
describe('resistance breakdown', () => {
  const result = calculateWall(referenceWall());

  it('lists inside film, every layer in order, then outside film', () => {
    expect(result.resistanceBreakdown.map((item) => item.kind)).toEqual([
      'inside-surface',
      'layer',
      'layer',
      'layer',
      'layer',
      'outside-surface',
    ]);
    expect(result.resistanceBreakdown.slice(1, 5).map((item) => item.name)).toEqual([
      PLASTER.name,
      MASONRY.name,
      INSULATION.name,
      RENDER.name,
    ]);
  });

  it('the items sum to R_total and their shares sum to 1', () => {
    const sum = result.resistanceBreakdown.reduce((total, item) => total + item.resistanceM2KPerW, 0);
    const shares = result.resistanceBreakdown.reduce((total, item) => total + item.fractionOfTotal, 0);
    expectClose(sum, result.resistance.totalM2KPerW);
    expectClose(shares, 1);
  });

  it('the insulation dominates the resistance in this example', () => {
    const insulation = result.layers.find((layer) => layer.name === INSULATION.name);
    expect(insulation?.fractionOfTotal).toBeGreaterThan(0.8);
  });

  it('layer thicknesses add up to the total wall thickness', () => {
    expectClose(result.geometry.totalThicknessM, 0.315);
  });

  it('the temperature profile starts at the inside air and ends at the outside air', () => {
    expect(at(result.temperatureProfile, 0).temperatureC).toBe(20);
    expect(result.temperatureProfile.at(-1)?.temperatureC).toBe(5);
  });

  it('heat flux × area = heat-transfer rate', () => {
    expectClose(result.heatTransfer.fluxMagnitudeWPerM2 * result.geometry.areaM2, result.heatTransfer.magnitudeW);
  });
});

// ---------------------------------------------------------------------------
// 4. Walls with different numbers of layers
// ---------------------------------------------------------------------------
describe('walls with different numbers of layers', () => {
  /** Independent expectation: 1 / (R_si + Σ d/λ + R_se), written as a plain loop. */
  function expectedU(wall: WallInput): number {
    let r = wall.surfaceResistances.insideM2KPerW + wall.surfaceResistances.outsideM2KPerW;
    for (const layer of wall.layers) r += layer.thicknessM / layer.lambdaWPerMK;
    return 1 / r;
  }

  const makeLayers = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      name: `Layer ${i + 1}`,
      thicknessM: 0.01 * (i + 1),
      lambdaWPerMK: 0.1 + 0.05 * i,
      densityKgPerM3: 500 + 100 * i,
      specificHeatJPerKgK: 900,
    }));

  it.each([1, 2, 3, 4, 7, 20])('%i layer(s)', (count) => {
    const wall = referenceWall({ layers: makeLayers(count) });
    const result = calculateWall(wall);
    expect(result.layers).toHaveLength(count);
    expect(result.resistanceBreakdown).toHaveLength(count + 2);
    expect(result.temperatureProfile).toHaveLength(count + 3);
    expectClose(result.uValueWPerM2K, expectedU(wall));
    const hc = result.heatCapacity;
    expect(hc.available && hc.perLayer.length).toBe(count);
  });

  it('rejects a wall with no layers', () => {
    expect(issuesOf(() => calculateWall(referenceWall({ layers: [] })))[0]?.code).toBe('no-layers');
  });
});

// ---------------------------------------------------------------------------
// 5. Boundary-condition changes
// ---------------------------------------------------------------------------
describe('boundary conditions', () => {
  const withTemps = (inside: number, outside: number, hours = 24) =>
    calculateWall(
      referenceWall({ conditions: { insideTemperatureC: inside, outsideTemperatureC: outside, durationHours: hours } }),
    );

  it('swapping inside and outside keeps the magnitude and flips the direction', () => {
    const loss = withTemps(20, 5);
    const gain = withTemps(5, 20);
    expect(gain.heatTransfer.magnitudeW).toBe(loss.heatTransfer.magnitudeW);
    expect(loss.heatTransfer.direction).toBe('outward');
    expect(gain.heatTransfer.direction).toBe('inward');
  });

  it('U-value does not depend on the temperatures', () => {
    expect(withTemps(20, 5).uValueWPerM2K).toBe(withTemps(26, -4).uValueWPerM2K);
  });

  it('only the difference matters, not the absolute level', () => {
    expectClose(withTemps(25, 10).heatTransfer.magnitudeW, withTemps(10, -5).heatTransfer.magnitudeW);
  });

  it('equal temperatures give zero heat flow, direction "none" and a warning', () => {
    const result = withTemps(18, 18);
    expect(result.heatTransfer.magnitudeW).toBe(0);
    expect(result.energy.magnitudeKWh).toBe(0);
    expect(result.heatTransfer.direction).toBe('none');
    expect(result.warnings.map((w) => w.code)).toContain('no-temperature-difference');
  });

  it('zero duration gives zero energy; energy scales linearly with duration', () => {
    expect(withTemps(20, 5, 0).energy.magnitudeKWh).toBe(0);
    expectClose(withTemps(20, 5, 48).energy.magnitudeKWh, 2 * withTemps(20, 5, 24).energy.magnitudeKWh);
  });

  it('negative duration is rejected', () => {
    expect(() => withTemps(20, 5, -1)).toThrow(EngineInputError);
  });
});

// ---------------------------------------------------------------------------
// 6. Heat capacity availability (missing data is never guessed)
// ---------------------------------------------------------------------------
describe('heat capacity with missing material data', () => {
  const noCapacityLayer = { name: 'Mystery board', thicknessM: 0.01, lambdaWPerMK: 0.2 };

  it('is reported as unavailable, naming the layers, while all thermal results still work', () => {
    const wall = referenceWall();
    wall.layers.push(noCapacityLayer);
    const result = calculateWall(wall);
    expect(result.heatCapacity).toEqual({ available: false, missingFor: ['Mystery board'] });
    expect(result.warnings.map((w) => w.code)).toContain('heat-capacity-unavailable');
    expect(result.uValueWPerM2K).toBeGreaterThan(0);
  });

  it('is unavailable if only density is missing, or only specific heat is missing', () => {
    const noDensity = referenceWall();
    noDensity.layers[0] = { name: 'A', thicknessM: 0.1, lambdaWPerMK: 0.5, specificHeatJPerKgK: 1000 };
    const noCp = referenceWall();
    noCp.layers[0] = { name: 'B', thicknessM: 0.1, lambdaWPerMK: 0.5, densityKgPerM3: 1000 };
    expect(calculateWall(noDensity).heatCapacity).toEqual({ available: false, missingFor: ['A'] });
    expect(calculateWall(noCp).heatCapacity).toEqual({ available: false, missingFor: ['B'] });
  });

  it('an unavailable heat capacity does not alter the U-value or Q', () => {
    const complete = calculateWall(referenceWall());
    const wall = referenceWall();
    wall.layers[0] = { name: PLASTER.name, thicknessM: PLASTER.thicknessM, lambdaWPerMK: PLASTER.lambdaWPerMK };
    const partial = calculateWall(wall);
    expect(partial.uValueWPerM2K).toBe(complete.uValueWPerM2K);
    expect(partial.heatTransfer.magnitudeW).toBe(complete.heatTransfer.magnitudeW);
  });

  it('an INVALID density is an error, not "unavailable"', () => {
    const wall = referenceWall();
    wall.layers[0] = { ...PLASTER, densityKgPerM3: -5 };
    expect(() => calculateWall(wall)).toThrow(EngineInputError);
  });
});

// ---------------------------------------------------------------------------
// 7. Error handling
// ---------------------------------------------------------------------------
describe('invalid input', () => {
  it('throws EngineInputError that lists every problem at once', () => {
    const wall = referenceWall({ widthM: -1 });
    wall.layers[1] = { ...MASONRY, thicknessM: 0 };
    wall.layers[2] = { ...INSULATION, lambdaWPerMK: NaN };
    const issues = issuesOf(() => calculateWall(wall));
    expect(issues.map((i) => i.path)).toEqual(['widthM', 'layers[1].thicknessM', 'layers[2].lambdaWPerMK']);
  });

  it('never returns NaN or Infinity for valid but extreme input', () => {
    const wall = referenceWall({
      layers: [
        { name: 'Very thin', thicknessM: 1e-9, lambdaWPerMK: 400 },
        { name: 'Very good insulator', thicknessM: 5, lambdaWPerMK: 0.001 },
      ],
      widthM: 1e4,
      heightM: 1e3,
    });
    const result = calculateWall(wall);
    const numbers = [
      result.uValueWPerM2K,
      result.heatTransfer.magnitudeW,
      result.energy.magnitudeKWh,
      ...result.temperatureProfile.map((p) => p.temperatureC),
    ];
    numbers.forEach((n) => expect(Number.isFinite(n)).toBe(true));
  });

  it('the thrown message names the offending field', () => {
    const wall = referenceWall();
    wall.layers[0] = { ...PLASTER, thicknessM: -0.015 };
    expect(() => calculateWall(wall)).toThrow(/layers\[0\]\.thicknessM/);
  });
});

// ---------------------------------------------------------------------------
// 8. Explanatory text attached to results
// ---------------------------------------------------------------------------
describe('assumptions and notes', () => {
  const result = calculateWall(referenceWall());

  it('lists the key modelling assumptions', () => {
    const text = result.assumptions.join('\n');
    expect(text).toContain('Steady-state');
    expect(text).toContain('thermal bridges');
    expect(text).toContain('not an annual energy demand');
    expect(text).toContain('does not by itself describe how the wall responds');
  });

  it('states clearly that the energy figure is not an annual demand', () => {
    expect(result.energy.note).toBe(ENERGY_ESTIMATE_NOTE);
    expect(result.energy.note).toContain('not an annual energy-demand prediction');
  });
});

// ---------------------------------------------------------------------------
// 9. Purity: no hidden state, no mutation
// ---------------------------------------------------------------------------
describe('purity', () => {
  it('does not modify its input', () => {
    const wall = referenceWall();
    const snapshot = JSON.parse(JSON.stringify(wall)) as WallInput; // plain data, so a JSON copy is exact
    calculateWall(wall);
    expect(wall).toEqual(snapshot);
  });

  it('gives identical results for identical input', () => {
    expect(calculateWall(referenceWall())).toEqual(calculateWall(referenceWall()));
  });

  it('is unaffected by earlier calls', () => {
    const before = calculateWall(wallWithInsulation(0.12));
    calculateWall(wallWithInsulation(0.04));
    expect(calculateWall(wallWithInsulation(0.12))).toEqual(before);
  });
});
