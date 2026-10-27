/**
 * Physical relationships that must hold for ANY correct steady-state wall
 * calculation. These do not depend on specific reference numbers; they check
 * that the engine behaves the way physics says it should.
 */
import { describe, expect, it } from 'vitest';
import { calculateWall, customSurfaceResistances } from '../src/engine';
import type { Layer, WallInput } from '../src/engine';
import {
  celsiusToTemperature,
  energyToJoules,
  lengthToMetres,
  powerToWatts,
  temperatureToCelsius,
  wattsToPower,
} from '../src/units';
import { at, expectClose, INSULATION, MASONRY, PLASTER, referenceWall, RENDER, wallWithInsulation } from './helpers/helpers';

describe('more insulation → lower U-value (all else equal)', () => {
  const thicknessesMm = [20, 40, 60, 80, 100, 120, 160, 200];
  const results = thicknessesMm.map((mm) => calculateWall(wallWithInsulation(lengthToMetres(mm, 'mm'))));

  it('U strictly decreases as insulation thickness increases', () => {
    for (let i = 1; i < results.length; i++) {
      expect(at(results, i).uValueWPerM2K).toBeLessThan(at(results, i - 1).uValueWPerM2K);
    }
  });

  it('total resistance strictly increases', () => {
    for (let i = 1; i < results.length; i++) {
      expect(at(results, i).resistance.totalM2KPerW).toBeGreaterThan(at(results, i - 1).resistance.totalM2KPerW);
    }
  });

  it('heat loss strictly decreases', () => {
    for (let i = 1; i < results.length; i++) {
      expect(at(results, i).heatTransfer.magnitudeW).toBeLessThan(at(results, i - 1).heatTransfer.magnitudeW);
    }
  });

  it('the classic 40 / 80 / 120 mm comparison has diminishing returns', () => {
    const u = [40, 80, 120].map((mm) => calculateWall(wallWithInsulation(mm / 1000)).uValueWPerM2K);
    const firstGain = at(u, 0) - at(u, 1);
    const secondGain = at(u, 1) - at(u, 2);
    expect(firstGain).toBeGreaterThan(0);
    expect(secondGain).toBeGreaterThan(0);
    expect(secondGain).toBeLessThan(firstGain); // each extra 40 mm helps less than the previous
  });
});

describe('higher thermal conductivity → more heat transfer (all else equal)', () => {
  it('raising λ of the insulation increases U and Q', () => {
    const lambdas = [0.03, 0.035, 0.04, 0.05, 0.1];
    const results = lambdas.map((l) => calculateWall(wallWithInsulation(0.08, l)));
    for (let i = 1; i < results.length; i++) {
      expect(at(results, i).uValueWPerM2K).toBeGreaterThan(at(results, i - 1).uValueWPerM2K);
      expect(at(results, i).heatTransfer.magnitudeW).toBeGreaterThan(at(results, i - 1).heatTransfer.magnitudeW);
    }
  });

  it.each([0, 1, 2, 3])('raising λ of layer %i increases Q', (index) => {
    const base = referenceWall();
    const raised = referenceWall();
    const original = at(raised.layers, index);
    raised.layers[index] = { ...original, lambdaWPerMK: original.lambdaWPerMK * 1.5 };
    expect(calculateWall(raised).heatTransfer.magnitudeW).toBeGreaterThan(calculateWall(base).heatTransfer.magnitudeW);
  });
});

describe('doubling the wall area doubles the heat-transfer rate', () => {
  const base = calculateWall(referenceWall());

  it('doubling the width', () => {
    const doubled = calculateWall(referenceWall({ widthM: 6.0 }));
    expectClose(doubled.geometry.areaM2, 2 * base.geometry.areaM2);
    expectClose(doubled.heatTransfer.magnitudeW, 2 * base.heatTransfer.magnitudeW);
    expectClose(doubled.energy.magnitudeKWh, 2 * base.energy.magnitudeKWh);
  });

  it('doubling the height', () => {
    const doubled = calculateWall(referenceWall({ heightM: 5.0 }));
    expectClose(doubled.heatTransfer.magnitudeW, 2 * base.heatTransfer.magnitudeW);
  });

  it('while U-value, flux and areal heat capacity stay the same and total heat capacity doubles', () => {
    const doubled = calculateWall(referenceWall({ widthM: 6.0 }));
    expect(doubled.uValueWPerM2K).toBe(base.uValueWPerM2K);
    expectClose(doubled.heatTransfer.fluxMagnitudeWPerM2, base.heatTransfer.fluxMagnitudeWPerM2);
    const a = doubled.heatCapacity;
    const b = base.heatCapacity;
    if (!a.available || !b.available) throw new Error('heat capacity should be available');
    expectClose(a.arealJPerM2K, b.arealJPerM2K);
    expectClose(a.totalJPerK, 2 * b.totalJPerK);
  });

  it('the temperature profile does not depend on the wall area', () => {
    const doubled = calculateWall(referenceWall({ widthM: 6.0 }));
    expect(doubled.temperatureProfile).toEqual(base.temperatureProfile);
  });
});

describe('doubling the temperature difference doubles the heat-transfer rate', () => {
  const withTemps = (inside: number, outside: number) =>
    calculateWall(
      referenceWall({ conditions: { insideTemperatureC: inside, outsideTemperatureC: outside, durationHours: 24 } }),
    );
  const base = withTemps(20, 10); // ΔT = 10 K

  it('by raising the indoor temperature', () => {
    expectClose(withTemps(30, 10).heatTransfer.magnitudeW, 2 * base.heatTransfer.magnitudeW);
  });
  it('by lowering the outdoor temperature (including below zero)', () => {
    expectClose(withTemps(20, 0).heatTransfer.magnitudeW, 2 * base.heatTransfer.magnitudeW);
    expectClose(withTemps(20, -10).heatTransfer.magnitudeW, 3 * base.heatTransfer.magnitudeW);
  });
  it('and every temperature drop inside the wall doubles with it', () => {
    const double = withTemps(30, 10);
    const drop = (r: ReturnType<typeof calculateWall>) =>
      at(r.temperatureProfile, 0).temperatureC - at(r.temperatureProfile, 1).temperatureC;
    expectClose(drop(double), 2 * drop(base));
  });
});

describe('layer resistances sum correctly', () => {
  it('R_total = R_si + Σ(d/λ) + R_se, and the breakdown agrees', () => {
    const wall = referenceWall();
    const result = calculateWall(wall);
    let expected = wall.surfaceResistances.insideM2KPerW + wall.surfaceResistances.outsideM2KPerW;
    for (const layer of wall.layers) expected += layer.thicknessM / layer.lambdaWPerMK;
    expectClose(result.resistance.totalM2KPerW, expected);

    const layerSum = result.layers.reduce((sum, layer) => sum + layer.resistanceM2KPerW, 0);
    expectClose(layerSum, result.resistance.layersM2KPerW);
    expectClose(
      result.resistance.insideSurfaceM2KPerW + layerSum + result.resistance.outsideSurfaceM2KPerW,
      result.resistance.totalM2KPerW,
    );
  });

  it('splitting one layer into two identical halves does not change the result', () => {
    const whole = calculateWall(wallWithInsulation(0.08));
    const split = calculateWall(
      referenceWall({
        layers: [
          PLASTER,
          MASONRY,
          { ...INSULATION, name: 'Insulation A', thicknessM: 0.04 },
          { ...INSULATION, name: 'Insulation B', thicknessM: 0.04 },
          RENDER,
        ],
      }),
    );
    expectClose(split.resistance.totalM2KPerW, whole.resistance.totalM2KPerW);
    expectClose(split.uValueWPerM2K, whole.uValueWPerM2K);
  });
});

describe('layer order', () => {
  const forward = calculateWall(referenceWall());
  const reversedWall = referenceWall();
  reversedWall.layers.reverse();
  const reversed = calculateWall(reversedWall);

  it('does not change R_total, U-value, Q or heat capacity (resistances in series simply add)', () => {
    expectClose(reversed.resistance.totalM2KPerW, forward.resistance.totalM2KPerW);
    expectClose(reversed.uValueWPerM2K, forward.uValueWPerM2K);
    expectClose(reversed.heatTransfer.magnitudeW, forward.heatTransfer.magnitudeW);
    const a = reversed.heatCapacity;
    const b = forward.heatCapacity;
    if (!a.available || !b.available) throw new Error('heat capacity should be available');
    expectClose(a.arealJPerM2K, b.arealJPerM2K);
  });

  it('DOES change the temperatures at the interfaces inside the wall', () => {
    const interfaceTemps = (r: typeof forward) =>
      r.temperatureProfile.filter((p) => p.kind === 'interface').map((p) => p.temperatureC);
    expect(interfaceTemps(reversed)).not.toEqual(interfaceTemps(forward));
  });

  it('does NOT change the surface temperatures: T_si = T_inside − q·R_si and q is unchanged', () => {
    const surfaceTemps = (r: typeof forward) =>
      r.temperatureProfile.filter((p) => p.kind.endsWith('surface')).map((p) => p.temperatureC);
    surfaceTemps(forward).forEach((t, i) => expectClose(t, at(surfaceTemps(reversed), i)));
  });
});

describe('changing DISPLAY units does not change the physical result', () => {
  const buildWall = (thicknessesM: number[], tInsideC: number, tOutsideC: number): WallInput => ({
    layers: [PLASTER, MASONRY, INSULATION, RENDER].map((layer, i): Layer => ({ ...layer, thicknessM: at(thicknessesM, i) })),
    widthM: 3,
    heightM: 2.5,
    surfaceResistances: customSurfaceResistances(0.13, 0.04, 'horizontal', 'test'),
    conditions: { insideTemperatureC: tInsideC, outsideTemperatureC: tOutsideC, durationHours: 24 },
  });

  it('entering thicknesses in mm, cm or m gives identical results', () => {
    const mm = [15, 200, 80, 20].map((v) => lengthToMetres(v, 'mm'));
    const cm = [1.5, 20, 8, 2].map((v) => lengthToMetres(v, 'cm'));
    const m = [0.015, 0.2, 0.08, 0.02].map((v) => lengthToMetres(v, 'm'));
    const fromMm = calculateWall(buildWall(mm, 20, 5));
    expect(calculateWall(buildWall(cm, 20, 5))).toEqual(fromMm);
    expect(calculateWall(buildWall(m, 20, 5))).toEqual(fromMm);
  });

  it('entering temperatures in °C, K or °F gives the same result', () => {
    const t = [0.015, 0.2, 0.08, 0.02];
    const inC = calculateWall(buildWall(t, 20, 5));
    const inK = calculateWall(
      buildWall(t, temperatureToCelsius(celsiusToTemperature(20, 'K'), 'K'), temperatureToCelsius(celsiusToTemperature(5, 'K'), 'K')),
    );
    const inF = calculateWall(buildWall(t, temperatureToCelsius(68, 'F'), temperatureToCelsius(41, 'F')));
    for (const other of [inK, inF]) {
      expectClose(other.heatTransfer.magnitudeW, inC.heatTransfer.magnitudeW, 1e-10);
      expectClose(other.energy.magnitudeKWh, inC.energy.magnitudeKWh, 1e-10);
      expect(other.heatTransfer.direction).toBe(inC.heatTransfer.direction);
    }
  });

  it('reading the results in W/kW or kWh/J/Wh describes the same physical quantity', () => {
    const result = calculateWall(referenceWall());
    const watts = result.heatTransfer.magnitudeW;
    expectClose(powerToWatts(wattsToPower(watts, 'kW'), 'kW'), watts);
    // E[J] = Q[W] × t[s]; the engine's kWh figure must describe the same energy.
    const joulesFromPower = watts * result.energy.durationHours * 3600;
    expectClose(energyToJoules(result.energy.magnitudeKWh, 'kWh'), joulesFromPower, 1e-12);
    expectClose(energyToJoules(result.energy.magnitudeKWh * 1000, 'Wh'), joulesFromPower, 1e-12);
  });
});

// ---------------------------------------------------------------------------
// Randomised invariants. The generator is seeded, so a failure is reproducible.
// ---------------------------------------------------------------------------
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('invariants on 500 random walls (seed 20260101)', () => {
  const random = mulberry32(20260101);
  const between = (lo: number, hi: number) => lo + (hi - lo) * random();
  const logBetween = (lo: number, hi: number) => Math.exp(between(Math.log(lo), Math.log(hi)));

  const walls: WallInput[] = Array.from({ length: 500 }, () => {
    const layerCount = 1 + Math.floor(random() * 8);
    return {
      layers: Array.from({ length: layerCount }, (_, i) => ({
        name: `L${i}`,
        thicknessM: between(0.002, 0.4),
        lambdaWPerMK: logBetween(0.02, 2.5),
        densityKgPerM3: between(20, 2400),
        specificHeatJPerKgK: between(800, 1700),
      })),
      widthM: between(0.5, 20),
      heightM: between(0.5, 10),
      surfaceResistances: customSurfaceResistances(between(0, 0.3), between(0, 0.1), 'horizontal', 'random test'),
      conditions: { insideTemperatureC: between(-10, 45), outsideTemperatureC: between(-10, 45), durationHours: between(0, 200) },
    };
  });

  it('U × R_total = 1 and Q = U·A·|ΔT|', () => {
    for (const wall of walls) {
      const r = calculateWall(wall);
      expectClose(r.uValueWPerM2K * r.resistance.totalM2KPerW, 1, 1e-12);
      const dT = Math.abs(wall.conditions.insideTemperatureC - wall.conditions.outsideTemperatureC);
      expectClose(r.heatTransfer.magnitudeW, r.uValueWPerM2K * r.geometry.areaM2 * dT, 1e-12);
    }
  });

  it('resistance shares sum to 1', () => {
    for (const wall of walls) {
      const r = calculateWall(wall);
      expectClose(r.resistanceBreakdown.reduce((s, item) => s + item.fractionOfTotal, 0), 1, 1e-12);
    }
  });

  it('temperatures stay between the two air temperatures and change monotonically', () => {
    for (const wall of walls) {
      const { insideTemperatureC: ti, outsideTemperatureC: te } = wall.conditions;
      const temps = calculateWall(wall).temperatureProfile.map((p) => p.temperatureC);
      const lo = Math.min(ti, te) - 1e-9;
      const hi = Math.max(ti, te) + 1e-9;
      temps.forEach((t) => {
        expect(t).toBeGreaterThanOrEqual(lo);
        expect(t).toBeLessThanOrEqual(hi);
      });
      for (let i = 1; i < temps.length; i++) {
        const step = at(temps, i) - at(temps, i - 1);
        if (ti > te) expect(step).toBeLessThanOrEqual(1e-9);
        else if (ti < te) expect(step).toBeGreaterThanOrEqual(-1e-9);
      }
    }
  });

  it("Fourier's law holds in every layer: λ·ΔT_layer/d equals the wall's heat flux", () => {
    for (const wall of walls) {
      if (wall.conditions.insideTemperatureC === wall.conditions.outsideTemperatureC) continue;
      const result = calculateWall(wall);
      const sign = result.heatTransfer.direction === 'outward' ? 1 : -1;
      const fluxSigned = sign * result.heatTransfer.fluxMagnitudeWPerM2;
      wall.layers.forEach((layer, i) => {
        const hotSide = at(result.temperatureProfile, 1 + i).temperatureC;
        const coldSide = at(result.temperatureProfile, 2 + i).temperatureC;
        const layerFlux = (layer.lambdaWPerMK * (hotSide - coldSide)) / layer.thicknessM;
        expectClose(layerFlux, fluxSigned, 1e-8);
      });
    }
  });

  it('the temperature drops add up to the total temperature difference', () => {
    for (const wall of walls) {
      const t = calculateWall(wall).temperatureProfile.map((p) => p.temperatureC);
      expectClose(at(t, 0) - at(t, t.length - 1), wall.conditions.insideTemperatureC - wall.conditions.outsideTemperatureC, 1e-12);
    }
  });

  it('total heat capacity = areal heat capacity × area', () => {
    for (const wall of walls) {
      const r = calculateWall(wall);
      if (!r.heatCapacity.available) throw new Error('heat capacity should be available');
      expectClose(r.heatCapacity.totalJPerK, r.heatCapacity.arealJPerM2K * r.geometry.areaM2, 1e-12);
    }
  });
});
