/**
 * The basic steady-state formulas, one small function each.
 *
 * These are plain mathematical functions: numbers in, number out, no hidden
 * state. Each one checks its inputs and throws `EngineInputError` rather than
 * returning NaN. All values are SI (see types.ts).
 */
import { EngineInputError } from './errors';
import { assertNumber } from './validation';
import type { HeatFlowDirection } from './types';

/**
 * Thermal resistance of one homogeneous layer: R = d / λ.
 * @param thicknessM d, layer thickness in m (> 0)
 * @param lambdaWPerMK λ, thermal conductivity in W/(m·K) (> 0)
 * @returns R in m²·K/W
 */
export function layerResistance(thicknessM: number, lambdaWPerMK: number): number {
  assertNumber(thicknessM, 'thicknessM', 'Layer thickness', 'positive');
  assertNumber(lambdaWPerMK, 'lambdaWPerMK', 'Thermal conductivity', 'positive');
  return thicknessM / lambdaWPerMK;
}

/**
 * Total thermal resistance: R_total = R_si + Σ(d_i / λ_i) + R_se.
 * @param layerResistancesM2KPerW the R of each layer (each > 0), at least one
 * @param insideSurfaceM2KPerW R_si (≥ 0)
 * @param outsideSurfaceM2KPerW R_se (≥ 0)
 */
export function totalResistance(
  layerResistancesM2KPerW: readonly number[],
  insideSurfaceM2KPerW: number,
  outsideSurfaceM2KPerW: number,
): number {
  assertNumber(insideSurfaceM2KPerW, 'insideSurfaceM2KPerW', 'Internal surface resistance R_si', 'non-negative');
  assertNumber(outsideSurfaceM2KPerW, 'outsideSurfaceM2KPerW', 'External surface resistance R_se', 'non-negative');
  if (layerResistancesM2KPerW.length === 0) {
    throw new EngineInputError([
      { code: 'no-layers', path: 'layerResistancesM2KPerW', message: 'At least one layer is required.' },
    ]);
  }
  let layersSum = 0;
  layerResistancesM2KPerW.forEach((resistance, index) => {
    assertNumber(resistance, `layerResistancesM2KPerW[${index}]`, 'Layer resistance', 'positive');
    layersSum += resistance;
  });
  return insideSurfaceM2KPerW + layersSum + outsideSurfaceM2KPerW;
}

/**
 * Thermal transmittance: U = 1 / R_total.
 * @param totalResistanceM2KPerW R_total (> 0)
 * @returns U in W/(m²·K)
 */
export function uValueFromResistance(totalResistanceM2KPerW: number): number {
  assertNumber(totalResistanceM2KPerW, 'totalResistanceM2KPerW', 'Total thermal resistance', 'positive');
  return 1 / totalResistanceM2KPerW;
}

/** Wall area A = width × height, in m². */
export function wallArea(widthM: number, heightM: number): number {
  assertNumber(widthM, 'widthM', 'Wall width', 'positive');
  assertNumber(heightM, 'heightM', 'Wall height', 'positive');
  return widthM * heightM;
}

/**
 * Magnitude of the steady-state heat-transfer rate: Q̇ = U · A · |T_inside − T_outside|.
 *
 * This returns the MAGNITUDE only (always ≥ 0). Whether the heat is lost or
 * gained is a separate question answered by `heatFlowDirection`.
 *
 * @returns Q̇ in watts
 */
export function heatTransferRateW(
  uValueWPerM2K: number,
  areaM2: number,
  insideTemperatureC: number,
  outsideTemperatureC: number,
): number {
  assertNumber(uValueWPerM2K, 'uValueWPerM2K', 'U-value', 'positive');
  assertNumber(areaM2, 'areaM2', 'Wall area', 'positive');
  assertNumber(insideTemperatureC, 'insideTemperatureC', 'Inside temperature', 'temperature-c');
  assertNumber(outsideTemperatureC, 'outsideTemperatureC', 'Outside temperature', 'temperature-c');
  return uValueWPerM2K * areaM2 * Math.abs(insideTemperatureC - outsideTemperatureC);
}

/**
 * Direction of heat flow. Heat always flows from the warmer side to the cooler side.
 *  - inside warmer  → 'outward' (heat loss from the building)
 *  - outside warmer → 'inward'  (heat gain into the building)
 *  - equal          → 'none'
 */
export function heatFlowDirection(
  insideTemperatureC: number,
  outsideTemperatureC: number,
): HeatFlowDirection {
  assertNumber(insideTemperatureC, 'insideTemperatureC', 'Inside temperature', 'temperature-c');
  assertNumber(outsideTemperatureC, 'outsideTemperatureC', 'Outside temperature', 'temperature-c');
  if (insideTemperatureC > outsideTemperatureC) return 'outward';
  if (insideTemperatureC < outsideTemperatureC) return 'inward';
  return 'none';
}

/**
 * Energy transferred at a constant rate: E = Q̇ · t / 1000.
 * This is an estimate under constant conditions, NOT an annual energy demand.
 * @param rateW Q̇ in W (≥ 0)
 * @param durationHours t in hours (≥ 0)
 * @returns E in kWh
 */
export function energyKWh(rateW: number, durationHours: number): number {
  assertNumber(rateW, 'rateW', 'Heat-transfer rate', 'non-negative');
  assertNumber(durationHours, 'durationHours', 'Duration', 'non-negative');
  return (rateW * durationHours) / 1000;
}

/**
 * Heat capacity of one layer over a given volume: C = ρ · c_p · V.
 * @param densityKgPerM3 ρ (> 0)
 * @param specificHeatJPerKgK c_p (> 0)
 * @param volumeM3 V (> 0)
 * @returns C in J/K
 */
export function heatCapacity(
  densityKgPerM3: number,
  specificHeatJPerKgK: number,
  volumeM3: number,
): number {
  assertNumber(densityKgPerM3, 'densityKgPerM3', 'Density', 'positive');
  assertNumber(specificHeatJPerKgK, 'specificHeatJPerKgK', 'Specific heat capacity', 'positive');
  assertNumber(volumeM3, 'volumeM3', 'Volume', 'positive');
  return densityKgPerM3 * specificHeatJPerKgK * volumeM3;
}

/**
 * Areal heat capacity of one layer: ρ · c_p · d, per m² of wall area.
 * @returns J/(m²·K)
 */
export function arealHeatCapacity(
  densityKgPerM3: number,
  specificHeatJPerKgK: number,
  thicknessM: number,
): number {
  assertNumber(densityKgPerM3, 'densityKgPerM3', 'Density', 'positive');
  assertNumber(specificHeatJPerKgK, 'specificHeatJPerKgK', 'Specific heat capacity', 'positive');
  assertNumber(thicknessM, 'thicknessM', 'Layer thickness', 'positive');
  return densityKgPerM3 * specificHeatJPerKgK * thicknessM;
}
