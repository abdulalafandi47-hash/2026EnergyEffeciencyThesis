/**
 * Data types for the calculation engine.
 *
 * Conventions used everywhere in the engine:
 *  - All values are in SI units. Field names end with their unit
 *    (e.g. `thicknessM` = metres, `lambdaWPerMK` = W/(m·K)) so that a
 *    millimetre value can never be passed by accident.
 *  - Layers are listed from the INTERIOR face to the EXTERIOR face.
 *  - Temperatures are air temperatures in °C.
 */

/**
 * How trustworthy a number is. The same labels will be used by the material
 * database (Stage 3) so that illustrative values are never mistaken for
 * verified ones.
 */
export type DataStatus =
  /** Checked against a named primary source (standard, datasheet, paper). */
  | 'verified'
  /** Believed to match a named source, but not yet checked against it. */
  | 'unverified'
  /** Demonstration value only; no claim of real-world accuracy. */
  | 'illustrative'
  /** Entered by the user; the user is responsible for it. */
  | 'user-defined';

/**
 * Direction of heat flow used to choose surface resistances (ISO 6946 style).
 * Not to be confused with `HeatFlowDirection` (inward/outward) below.
 */
export type SurfaceHeatFlowOrientation = 'horizontal' | 'upwards' | 'downwards';

/** Which way heat crosses the wall, relative to the building. */
export type HeatFlowDirection =
  /** Inside → outside (heat LOSS from the building). */
  | 'outward'
  /** Outside → inside (heat GAIN into the building). */
  | 'inward'
  /** No temperature difference, so no steady-state heat flow. */
  | 'none';

/** One homogeneous material layer. */
export interface Layer {
  /** Display name, e.g. "Mineral wool". */
  name: string;
  /** Thickness d in metres (m). Must be > 0. */
  thicknessM: number;
  /** Thermal conductivity λ in W/(m·K). Must be > 0. */
  lambdaWPerMK: number;
  /** Density ρ in kg/m³. Optional; needed only for heat capacity. */
  densityKgPerM3?: number;
  /** Specific heat capacity c_p in J/(kg·K). Optional; needed only for heat capacity. */
  specificHeatJPerKgK?: number;
  /**
   * How far this layer's properties can be trusted (copied from the material
   * database). Optional: if absent, the engine makes no claim either way.
   */
  propertyStatus?: DataStatus;
}

/**
 * Surface (air-film) resistances. They are NEVER defaulted silently: the
 * caller must pass them explicitly, either from a labelled preset
 * (see surfaceResistance.ts) or as custom values.
 */
export interface SurfaceResistances {
  /** R_si, internal surface resistance, m²·K/W. Must be ≥ 0. */
  insideM2KPerW: number;
  /** R_se, external surface resistance, m²·K/W. Must be ≥ 0. */
  outsideM2KPerW: number;
  /** Heat-flow orientation these values were chosen for. */
  heatFlowOrientation: SurfaceHeatFlowOrientation;
  /** Where the values come from, in words (standard, table, assumption). */
  basis: string;
  /** How far the values can be trusted. */
  status: DataStatus;
}

/** Everything the engine needs to analyse one wall. */
export interface WallInput {
  /** Layers from interior face (index 0) to exterior face (last index). */
  layers: Layer[];
  /** Wall width in metres. Must be > 0. */
  widthM: number;
  /** Wall height in metres. Must be > 0. */
  heightM: number;
  surfaceResistances: SurfaceResistances;
  conditions: {
    /** Indoor air temperature, °C. */
    insideTemperatureC: number;
    /** Outdoor air temperature, °C. */
    outsideTemperatureC: number;
    /** Duration for the energy estimate, hours. Must be ≥ 0. */
    durationHours: number;
  };
}

/** A problem found in the input. */
export interface ValidationIssue {
  code:
    | 'invalid-structure'
    | 'missing-value'
    | 'not-a-finite-number'
    | 'must-be-positive'
    | 'must-be-non-negative'
    | 'below-absolute-zero'
    | 'no-layers'
    | 'invalid-option'
    | 'invalid-format'
    | 'duplicate-id';
  /** Where the problem is, e.g. `layers[2].lambdaWPerMK`. */
  path: string;
  /** Human-readable explanation. */
  message: string;
}

/** A non-fatal remark attached to a result. */
export interface CalculationWarning {
  code:
    | 'surface-resistance-unverified'
    | 'surface-resistance-orientation'
    | 'layer-properties-not-verified'
    | 'no-temperature-difference'
    | 'heat-capacity-unavailable';
  message: string;
}

/** One entry in the resistance breakdown (a layer or a surface film). */
export interface ResistanceItem {
  kind: 'inside-surface' | 'layer' | 'outside-surface';
  name: string;
  /** Thermal resistance, m²·K/W. */
  resistanceM2KPerW: number;
  /** This item's share of R_total, between 0 and 1. */
  fractionOfTotal: number;
}

export interface LayerResult {
  name: string;
  thicknessM: number;
  lambdaWPerMK: number;
  /** R = d / λ, m²·K/W. */
  resistanceM2KPerW: number;
  fractionOfTotal: number;
  /** Carried over from the input layer, for reports. */
  propertyStatus?: DataStatus;
}

/** A point on the steady-state temperature profile. */
export interface TemperaturePoint {
  kind: 'inside-air' | 'inside-surface' | 'interface' | 'outside-surface' | 'outside-air';
  label: string;
  /** Distance from the interior face of the wall, metres (0 … total thickness). */
  positionM: number;
  temperatureC: number;
}

export interface LayerHeatCapacity {
  name: string;
  /** ρ·c_p·d, J/(m²·K) of wall area. */
  arealJPerM2K: number;
  /** ρ·c_p·V for this layer over the whole wall, J/K. */
  totalJPerK: number;
}

export type HeatCapacityResult =
  | {
      available: true;
      perLayer: LayerHeatCapacity[];
      /** Σ ρ·c_p·d, J/(m²·K). */
      arealJPerM2K: number;
      /** Σ ρ·c_p·V, J/K. */
      totalJPerK: number;
    }
  | {
      available: false;
      /** Layers lacking density and/or specific heat, so nothing is guessed. */
      missingFor: string[];
    };

export interface WallCalculationResult {
  geometry: {
    widthM: number;
    heightM: number;
    areaM2: number;
    totalThicknessM: number;
  };
  layers: LayerResult[];
  /** Surface films and layers in interior → exterior order. */
  resistanceBreakdown: ResistanceItem[];
  resistance: {
    insideSurfaceM2KPerW: number;
    /** Σ d/λ over the layers only. */
    layersM2KPerW: number;
    outsideSurfaceM2KPerW: number;
    /** R_total = R_si + Σ(d/λ) + R_se. */
    totalM2KPerW: number;
  };
  /** U = 1 / R_total, W/(m²·K). */
  uValueWPerM2K: number;
  heatTransfer: {
    /** T_inside − T_outside (signed), K. */
    temperatureDifferenceK: number;
    /** Q̇ = U·A·|ΔT|, W. Always ≥ 0: this is the MAGNITUDE only. */
    magnitudeW: number;
    /** Heat flux magnitude Q̇ / A, W/m². */
    fluxMagnitudeWPerM2: number;
    /** The DIRECTION of heat flow, reported separately from the magnitude. */
    direction: HeatFlowDirection;
  };
  energy: {
    durationHours: number;
    /** E = Q̇·t/1000, kWh (magnitude; see `direction`). */
    magnitudeKWh: number;
    direction: HeatFlowDirection;
    /** Reminder that this is not an annual energy-demand prediction. */
    note: string;
  };
  heatCapacity: HeatCapacityResult;
  /** Interior → exterior. */
  temperatureProfile: TemperaturePoint[];
  /** Plain-language list of the assumptions behind these numbers. */
  assumptions: string[];
  warnings: CalculationWarning[];
}
