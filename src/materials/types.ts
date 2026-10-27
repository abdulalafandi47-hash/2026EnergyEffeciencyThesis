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

/** Where a record's numbers come from. */
export interface MaterialSource {
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
}

export interface MaterialFilter {
  /** Words that must all appear in the name, id or category (case-insensitive). */
  text?: string;
  category?: MaterialCategory;
  status?: DataStatus;
}
