/**
 * Main entry point of the engine: takes a wall definition and returns every
 * result the interface and the report need. It only combines the small,
 * separately tested functions from formulas.ts and temperatureProfile.ts.
 *
 * No user-interface or 3D code is used here, so results are reproducible and
 * can be tested on their own.
 */
import { EngineInputError } from './errors';
import {
  arealHeatCapacity,
  energyKWh,
  heatCapacity,
  heatFlowDirection,
  heatTransferRateW,
  layerResistance,
  totalResistance,
  uValueFromResistance,
  wallArea,
} from './formulas';
import { calculateTemperatureProfile } from './temperatureProfile';
import { validateWallInput } from './validateWallInput';
import type {
  CalculationWarning,
  HeatCapacityResult,
  Layer,
  LayerHeatCapacity,
  ResistanceItem,
  WallCalculationResult,
  WallInput,
} from './types';

export const ENERGY_ESTIMATE_NOTE =
  'Energy under constant boundary conditions for the stated duration. ' +
  'This is not an annual energy-demand prediction: real conditions change with weather, ' +
  'solar gains, ventilation, occupancy and the thermal mass of the whole building.';

/**
 * Heat capacity C = Σ ρ·c_p·V. If any layer lacks density or specific heat the
 * result is explicitly "unavailable"; missing values are never guessed or
 * treated as zero.
 */
function computeHeatCapacity(layers: readonly Layer[], areaM2: number): HeatCapacityResult {
  const perLayer: LayerHeatCapacity[] = [];
  const missingFor: string[] = [];
  let arealJPerM2K = 0;
  let totalJPerK = 0;

  for (const layer of layers) {
    const { densityKgPerM3, specificHeatJPerKgK } = layer;
    if (densityKgPerM3 == null || specificHeatJPerKgK == null) {
      missingFor.push(layer.name);
      continue;
    }
    const areal = arealHeatCapacity(densityKgPerM3, specificHeatJPerKgK, layer.thicknessM);
    const total = heatCapacity(densityKgPerM3, specificHeatJPerKgK, areaM2 * layer.thicknessM);
    perLayer.push({ name: layer.name, arealJPerM2K: areal, totalJPerK: total });
    arealJPerM2K += areal;
    totalJPerK += total;
  }

  if (missingFor.length > 0) {
    return { available: false, missingFor };
  }
  return { available: true, perLayer, arealJPerM2K, totalJPerK };
}

/**
 * Calculates thermal resistance, U-value, heat transfer, energy, heat capacity
 * and the temperature profile for a multilayer wall.
 *
 * @throws EngineInputError if the input is invalid (all problems are listed in `issues`).
 */
export function calculateWall(input: WallInput): WallCalculationResult {
  const issues = validateWallInput(input);
  if (issues.length > 0) {
    throw new EngineInputError(issues);
  }

  const { layers, widthM, heightM, surfaceResistances, conditions } = input;
  const rsi = surfaceResistances.insideM2KPerW;
  const rse = surfaceResistances.outsideM2KPerW;
  const { insideTemperatureC, outsideTemperatureC, durationHours } = conditions;

  // --- geometry --------------------------------------------------------------
  const areaM2 = wallArea(widthM, heightM);
  const totalThicknessM = layers.reduce((sum, layer) => sum + layer.thicknessM, 0);

  // --- thermal resistance and U-value ----------------------------------------
  const layerResistances = layers.map((layer) => layerResistance(layer.thicknessM, layer.lambdaWPerMK));
  const layersM2KPerW = layerResistances.reduce((sum, r) => sum + r, 0);
  const rTotal = totalResistance(layerResistances, rsi, rse);
  const uValue = uValueFromResistance(rTotal);

  const layerResults = layers.map((layer, index) => {
    const resistanceM2KPerW = layerResistances[index] ?? 0;
    return {
      name: layer.name,
      thicknessM: layer.thicknessM,
      lambdaWPerMK: layer.lambdaWPerMK,
      resistanceM2KPerW,
      fractionOfTotal: resistanceM2KPerW / rTotal,
    };
  });

  const resistanceBreakdown: ResistanceItem[] = [
    { kind: 'inside-surface', name: 'Inside surface film (R_si)', resistanceM2KPerW: rsi, fractionOfTotal: rsi / rTotal },
    ...layerResults.map(
      (layer): ResistanceItem => ({
        kind: 'layer',
        name: layer.name,
        resistanceM2KPerW: layer.resistanceM2KPerW,
        fractionOfTotal: layer.fractionOfTotal,
      }),
    ),
    { kind: 'outside-surface', name: 'Outside surface film (R_se)', resistanceM2KPerW: rse, fractionOfTotal: rse / rTotal },
  ];

  // --- heat transfer and energy ----------------------------------------------
  const magnitudeW = heatTransferRateW(uValue, areaM2, insideTemperatureC, outsideTemperatureC);
  const direction = heatFlowDirection(insideTemperatureC, outsideTemperatureC);
  const magnitudeKWh = energyKWh(magnitudeW, durationHours);

  // --- heat capacity ----------------------------------------------------------
  const heatCapacityResult = computeHeatCapacity(layers, areaM2);

  // --- temperature profile ----------------------------------------------------
  const temperatureProfile = calculateTemperatureProfile(
    layers.map((layer, index) => ({
      name: layer.name,
      thicknessM: layer.thicknessM,
      resistanceM2KPerW: layerResistances[index] ?? 0,
    })),
    rsi,
    rse,
    insideTemperatureC,
    outsideTemperatureC,
  );

  // --- warnings and assumptions -----------------------------------------------
  const warnings: CalculationWarning[] = [];
  if (surfaceResistances.status === 'unverified' || surfaceResistances.status === 'illustrative') {
    warnings.push({
      code: 'surface-resistance-unverified',
      message: `Surface resistances are marked "${surfaceResistances.status}": they have not been checked against a primary source.`,
    });
  }
  if (surfaceResistances.heatFlowOrientation !== 'horizontal') {
    warnings.push({
      code: 'surface-resistance-orientation',
      message:
        `This model treats the element as a vertical wall (horizontal heat flow), but the surface resistances ` +
        `were chosen for "${surfaceResistances.heatFlowOrientation}" heat flow. Check that this is intended.`,
    });
  }
  if (direction === 'none') {
    warnings.push({
      code: 'no-temperature-difference',
      message: 'Inside and outside temperatures are equal, so the steady-state heat flow is zero.',
    });
  }
  if (!heatCapacityResult.available) {
    warnings.push({
      code: 'heat-capacity-unavailable',
      message: `Heat capacity not calculated: density and/or specific heat missing for ${heatCapacityResult.missingFor.join(', ')}.`,
    });
  }

  const assumptions: string[] = [
    'Steady-state, one-dimensional heat flow through the wall with constant inside and outside air temperatures.',
    'Every layer is thermally homogeneous. No thermal bridges (studs, ties, mortar joints, fasteners), air cavities, windows or doors are modelled; the full width × height is treated as one uniform wall.',
    `Surface resistances: R_si = ${rsi} m²·K/W, R_se = ${rse} m²·K/W for "${surfaceResistances.heatFlowOrientation}" heat flow. Basis: ${surfaceResistances.basis} Status: ${surfaceResistances.status}.`,
    'Layer properties (λ, ρ, c_p) are used exactly as entered; no correction for temperature, moisture content or ageing is applied.',
    'Solar radiation, air leakage and ventilation are not modelled.',
    'Heat capacity is the simple sum Σ ρ·c_p·V of all layers. It indicates how much heat the wall can store per kelvin; it does not by itself describe how the wall responds to changing temperatures.',
    'Energy = power × duration under constant conditions; it is not an annual energy demand.',
  ];

  return {
    geometry: { widthM, heightM, areaM2, totalThicknessM },
    layers: layerResults,
    resistanceBreakdown,
    resistance: {
      insideSurfaceM2KPerW: rsi,
      layersM2KPerW,
      outsideSurfaceM2KPerW: rse,
      totalM2KPerW: rTotal,
    },
    uValueWPerM2K: uValue,
    heatTransfer: {
      temperatureDifferenceK: insideTemperatureC - outsideTemperatureC,
      magnitudeW,
      fluxMagnitudeWPerM2: magnitudeW / areaM2,
      direction,
    },
    energy: { durationHours, magnitudeKWh, direction, note: ENERGY_ESTIMATE_NOTE },
    heatCapacity: heatCapacityResult,
    temperatureProfile,
    assumptions,
    warnings,
  };
}
