/**
 * Runs the (unchanged) calculation engine on a validated wall and returns what
 * the screen needs. This module is the ONLY bridge between the user interface
 * and the engine's calculations, so the UI never contains physics.
 *
 * Everything returned is a steady-state result under constant conditions. It is
 * not a dynamic or whole-building simulation, and it is only as reliable as the
 * material data behind it (see `result.warnings`).
 */
import { calculateWall, EngineInputError } from '../engine';
import type { HeatFlowDirection, WallCalculationResult, WallInput } from '../engine';

export interface LayerTemperatures {
  /** Temperature at the interior-side face of the layer, °C. */
  startC: number;
  /** Temperature at the exterior-side face of the layer, °C. */
  endC: number;
  /** Temperature drop across the layer (start − end), K. Negative when heat flows inward. */
  dropK: number;
}

export interface Analysis {
  /** The raw engine result (every number comes from here). */
  result: WallCalculationResult;
  /** Per layer, interior → exterior, taken from the engine's temperature profile. */
  layerTemperatures: LayerTemperatures[];
  /** Range of temperatures present in the wall, for colour scales. */
  temperatureRangeC: { minC: number; maxC: number };
  /** True if any layer relies on illustrative or unverified data. */
  usesUnverifiedData: boolean;
}

export type AnalysisOutcome = { ok: true; analysis: Analysis } | { ok: false; message: string };

export function analyzeWall(wall: WallInput): AnalysisOutcome {
  let result: WallCalculationResult;
  try {
    result = calculateWall(wall);
  } catch (error) {
    if (error instanceof EngineInputError) return { ok: false, message: error.message };
    throw error;
  }

  // Profile points: [inside air, inside surface, interface…, outside surface, outside air].
  // Layer i spans point (1 + i) → point (2 + i).
  const profile = result.temperatureProfile;
  const layerTemperatures: LayerTemperatures[] = result.layers.map((_, i) => {
    const start = profile[1 + i]?.temperatureC ?? Number.NaN;
    const end = profile[2 + i]?.temperatureC ?? Number.NaN;
    return { startC: start, endC: end, dropK: start - end };
  });
  const temperatures = profile.map((p) => p.temperatureC);
  return {
    ok: true,
    analysis: {
      result,
      layerTemperatures,
      temperatureRangeC: { minC: Math.min(...temperatures), maxC: Math.max(...temperatures) },
      usesUnverifiedData: wall.layers.some((l) => l.propertyStatus === 'illustrative' || l.propertyStatus === 'unverified'),
    },
  };
}

/** Plain-language description of a heat-flow direction. */
export function describeDirection(direction: HeatFlowDirection): string {
  switch (direction) {
    case 'outward':
      return 'Outward: inside → outside (heat loss from the building)';
    case 'inward':
      return 'Inward: outside → inside (heat gain into the building)';
    default:
      return 'None: no temperature difference, so no steady-state heat flow';
  }
}

export interface ProfileChartData {
  /** Positions are metres from the interior face of the wall. */
  points: Array<{ kind: string; label: string; xM: number; temperatureC: number }>;
  /** One band per layer, for shading the chart. */
  bands: Array<{ name: string; x0M: number; x1M: number }>;
  totalThicknessM: number;
}

/** The temperature profile reshaped for a chart: points plus layer bands. */
export function profileForChart(analysis: Analysis): ProfileChartData {
  const { result } = analysis;
  let cursor = 0;
  const bands = result.layers.map((layer) => {
    const band = { name: layer.name, x0M: cursor, x1M: cursor + layer.thicknessM };
    cursor += layer.thicknessM;
    return band;
  });
  return {
    points: result.temperatureProfile.map((p) => ({ kind: p.kind, label: p.label, xM: p.positionM, temperatureC: p.temperatureC })),
    bands,
    totalThicknessM: result.geometry.totalThicknessM,
  };
}
