/**
 * Material database types.
 *
 * The database is DATA, kept in `data/builtInMaterials.json`, separate from the
 * calculation code. The engine never imports from this folder; this folder
 * only converts a material plus a thickness into an engine `Layer`.
 *
 * THE DATABASE IS NOT A CERTIFIED SOURCE OF DESIGN VALUES. Each record says how
 * far its numbers can be trusted through `status` (see DataStatus in the
 * engine) and where they come from through `source`.
 */
import type { DataStatus } from '../engine';

export const MATERIAL_CATEGORIES = [
  'Concrete',
  'Cement plaster',
  'Gypsum plaster',
  'Clay brick',
  'Concrete block',
  'EPS',
  'XPS',
  'Mineral wool',
  'Polyurethane',
  'Other',
] as const;

export type MaterialCategory = (typeof MATERIAL_CATEGORIES)[number];

/** The only units a record may use. Stored on every record so exports are self-describing. */
export interface MaterialUnits {
  conductivity: 'W/(m·K)';
  density: 'kg/m³';
  specificHeat: 'J/(kg·K)';
}

export const SI_MATERIAL_UNITS: MaterialUnits = {
  conductivity: 'W/(m·K)',
  density: 'kg/m³',
  specificHeat: 'J/(kg·K)',
};

/**
 * What kind of thermal value a record holds. These are different things and
 * must not be mixed up:
 *  - measured:    result of a measurement on a specific specimen under stated
 *                 conditions (e.g. a heat-flow-meter test).
 *  - declared:    value declared by a manufacturer for a product under the
 *                 reference conditions of its declaration.
 *  - design:      value stated by its source for use in design calculations
 *                 (EN ISO 10456 describes procedures for declared and design
 *                 values; a regulation or table may also tabulate them).
 *  - unspecified: the record does not say (always the case for illustrative data).
 */
export const THERMAL_VALUE_TYPES = ['measured', 'declared', 'design', 'unspecified'] as const;
export type ThermalValueType = (typeof THERMAL_VALUE_TYPES)[number];

/**
 * The kind of source behind a record, following the project's reference
 * hierarchy: standards first, then regulation/guidance, then manufacturer
 * datasheets and published research, then supplementary reference tables.
 */
export const SOURCE_TYPES = [
  'standard',
  'regulation-or-guidance',
  'manufacturer-datasheet',
  'published-research',
  'reference-table',
  'user-note',
  'none',
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

/** Where a record's numbers come from. */
export interface MaterialSource {
  /** What kind of source this is. `none` means there is no source. */
  type: SourceType;
  /**
   * Human-readable reference. For `illustrative` and `user-defined` records it
   * must say plainly that there is no source.
   */
  citation: string;
  /** Link, if the source is online. Not allowed on illustrative records. */
  url?: string;
  /** Table, clause or page inside the source, e.g. "Table 3, row 'Gypsum plaster'". */
  location?: string;
  /** Date (YYYY-MM-DD) someone compared the numbers with the source. */
  checkedOn?: string;
  /** Who made that comparison. */
  checkedBy?: string;
}

/** Any extra property not covered by the main fields, e.g. a vapour resistance factor. */
export interface AdditionalProperty {
  name: string;
  value: number;
  unit: string;
}

export interface MaterialRecord {
  /** Unique, lowercase, hyphen-separated, e.g. "mineral-wool-slab". */
  id: string;
  name: string;
  category: MaterialCategory;
  /** λ, thermal conductivity. */
  lambdaWPerMK: number;
  /** ρ. Optional: without it (or c_p) heat capacity cannot be calculated. */
  densityKgPerM3?: number;
  /** c_p. Optional, see above. */
  specificHeatJPerKgK?: number;
  additionalProperties?: AdditionalProperty[];
  units: MaterialUnits;
  status: DataStatus;
  /** Measured, declared or design value (see ThermalValueType). */
  valueType: ThermalValueType;
  source: MaterialSource;
  /** Conditions the values apply to (moisture, temperature, product grade …), if known. */
  conditions?: string;
  /** Assumptions and limitations a user must know about. */
  assumptionsAndLimitations: string[];
}

/** What a user types in to define their own material. */
export interface CustomMaterialInput {
  name: string;
  category?: MaterialCategory;
  lambdaWPerMK: number;
  densityKgPerM3?: number;
  specificHeatJPerKgK?: number;
  /** Where the user got the numbers (datasheet, measurement …). Free text. */
  sourceNote?: string;
  /** What kind of value this is. Defaults to "unspecified". */
  valueType?: ThermalValueType;
  /** Conditions the values apply to (moisture, mean temperature, product grade …). Free text. */
  conditions?: string;
}

export interface MaterialFilter {
  /** Words that must all appear in the name, id or category (case-insensitive). */
  text?: string;
  category?: MaterialCategory;
  status?: DataStatus;
}
