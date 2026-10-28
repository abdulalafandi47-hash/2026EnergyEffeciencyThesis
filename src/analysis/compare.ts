/**
 * Comparison and sensitivity analysis.
 *
 * Each comparison starts from the CURRENT wall (the baseline) and changes ONE
 * thing at a time. Everything else (area, air temperatures, duration, surface
 * resistances, the other layers) is held identical, so differences in the
 * results are caused only by the stated change.
 */
import type { HeatFlowDirection, Layer, WallInput } from '../engine';
import { materialToLayer } from '../materials';
import type { MaterialRecord } from '../materials';
import { analyzeWall } from './analyze';

export interface VariantResult {
  /** Short name shown in tables and charts, e.g. "120 mm". */
  label: string;
  /** What differs from the current wall. Empty for the baseline. */
  changed: string;
  ok: boolean;
  /** Why this variant could not be calculated. */
  error?: string;
  uValueWPerM2K: number;
  totalResistanceM2KPerW: number;
  heatTransferW: number;
  direction: HeatFlowDirection;
  energyKWh: number;
  /** null when a layer lacks density or specific heat. */
  arealHeatCapacityJPerM2K: number | null;
  totalHeatCapacityJPerK: number | null;
  /** True if any layer uses illustrative or unverified data. */
  usesUnverifiedData: boolean;
  /** Change relative to the current wall, percent; null for the baseline or when not defined. */
  deltaUPercent: number | null;
  deltaHeatTransferPercent: number | null;
}

export interface Comparison {
  title: string;
  /** The single parameter that varies. */
  parameter: string;
  /** First entry is the current wall. */
  variants: VariantResult[];
  /** What is held constant. */
  heldConstant: string[];
}

const NAN = Number.NaN;

function summarize(label: string, changed: string, wall: WallInput): VariantResult {
  const outcome = analyzeWall(wall);
  if (!outcome.ok) {
    return {
      label, changed, ok: false, error: outcome.message,
      uValueWPerM2K: NAN, totalResistanceM2KPerW: NAN, heatTransferW: NAN, direction: 'none', energyKWh: NAN,
      arealHeatCapacityJPerM2K: null, totalHeatCapacityJPerK: null, usesUnverifiedData: false,
      deltaUPercent: null, deltaHeatTransferPercent: null,
    };
  }
  const { result, usesUnverifiedData } = outcome.analysis;
  const hc = result.heatCapacity;
  return {
    label, changed, ok: true,
    uValueWPerM2K: result.uValueWPerM2K,
    totalResistanceM2KPerW: result.resistance.totalM2KPerW,
    heatTransferW: result.heatTransfer.magnitudeW,
    direction: result.heatTransfer.direction,
    energyKWh: result.energy.magnitudeKWh,
    arealHeatCapacityJPerM2K: hc.available ? hc.arealJPerM2K : null,
    totalHeatCapacityJPerK: hc.available ? hc.totalJPerK : null,
    usesUnverifiedData,
    deltaUPercent: null,
    deltaHeatTransferPercent: null,
  };
}

const percentChange = (value: number, base: number): number | null =>
  Number.isFinite(value) && Number.isFinite(base) && base !== 0 ? ((value - base) / base) * 100 : null;

function withDeltas(baseline: VariantResult, variants: VariantResult[]): VariantResult[] {
  return [baseline, ...variants.map((v) => (v.ok && baseline.ok
    ? { ...v, deltaUPercent: percentChange(v.uValueWPerM2K, baseline.uValueWPerM2K), deltaHeatTransferPercent: percentChange(v.heatTransferW, baseline.heatTransferW) }
    : v))];
}

const copyWall = (wall: WallInput): WallInput => ({ ...wall, layers: wall.layers.map((l) => ({ ...l })) });

function layerAt(wall: WallInput, index: number): Layer {
  const layer = wall.layers[index];
  if (!layer) throw new RangeError(`Layer index ${index} is outside this wall (${wall.layers.length} layers).`);
  return layer;
}

const HELD = (what: string): string[] => [
  'Wall width, height and area',
  'Inside and outside air temperatures and the duration',
  'Surface resistances R_si and R_se',
  `All other layers (only ${what} changes)`,
];

/** Sweeps the thickness of ONE layer over the given values (metres), e.g. insulation 40, 80, 120 mm. */
export function sweepLayerThickness(wall: WallInput, layerIndex: number, thicknessesM: readonly number[]): Comparison {
  const layer = layerAt(wall, layerIndex);
  const baseline = summarize('Current', '', wall);
  const variants = thicknessesM.map((thicknessM) => {
    const variant = copyWall(wall);
    variant.layers[layerIndex] = { ...layer, thicknessM };
    const mm = Number((thicknessM * 1000).toFixed(3));
    return summarize(`${mm} mm`, `${layer.name}: thickness ${mm} mm (instead of ${Number((layer.thicknessM * 1000).toFixed(3))} mm)`, variant);
  });
  return {
    title: `Thickness of "${layer.name}"`,
    parameter: `thickness of layer ${layerIndex + 1} (${layer.name})`,
    variants: withDeltas(baseline, variants),
    heldConstant: HELD(`the thickness of layer ${layerIndex + 1}`),
  };
}

/** Replaces the material of ONE layer by each given material, keeping that layer's thickness. */
export function swapLayerMaterial(wall: WallInput, layerIndex: number, materials: readonly MaterialRecord[]): Comparison {
  const layer = layerAt(wall, layerIndex);
  const baseline = summarize('Current', '', wall);
  const variants = materials.map((material) => {
    const variant = copyWall(wall);
    variant.layers[layerIndex] = materialToLayer(material, layer.thicknessM);
    return summarize(material.name, `Layer ${layerIndex + 1}: ${material.name} instead of ${layer.name} (same thickness, ${Number((layer.thicknessM * 1000).toFixed(3))} mm)`, variant);
  });
  return {
    title: `Material of layer ${layerIndex + 1}`,
    parameter: `material of layer ${layerIndex + 1} (currently ${layer.name})`,
    variants: withDeltas(baseline, variants),
    heldConstant: HELD(`the material of layer ${layerIndex + 1}`),
  };
}

/** Sweeps the OUTSIDE air temperature (°C), keeping the inside temperature fixed. */
export function sweepOutsideTemperature(wall: WallInput, temperaturesC: readonly number[]): Comparison {
  const baseline = summarize('Current', '', wall);
  const variants = temperaturesC.map((t) => {
    const variant = copyWall(wall);
    variant.conditions = { ...wall.conditions, outsideTemperatureC: t };
    return summarize(`${t} °C`, `Outside air ${t} °C (instead of ${wall.conditions.outsideTemperatureC} °C), inside ${wall.conditions.insideTemperatureC} °C`, variant);
  });
  return {
    title: 'Outside air temperature',
    parameter: 'outside air temperature',
    variants: withDeltas(baseline, variants),
    heldConstant: ['Wall layers, thicknesses and materials', 'Wall area', 'Inside air temperature and the duration', 'Surface resistances R_si and R_se'],
  };
}
