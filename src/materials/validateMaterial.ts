import { numberIssue } from '../engine';
import type { ValidationIssue } from '../engine';
import { MATERIAL_CATEGORIES, SI_MATERIAL_UNITS, SOURCE_TYPES, THERMAL_VALUE_TYPES } from './types';
import type { MaterialRecord } from './types';

const STATUSES: readonly unknown[] = ['verified', 'unverified', 'illustrative', 'user-defined'];
const CATEGORIES: readonly unknown[] = MATERIAL_CATEGORIES;
const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBlank(value: unknown): boolean {
  return typeof value !== 'string' || value.trim() === '';
}

/** True for a real calendar date written YYYY-MM-DD. */
export function isIsoDate(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Checks one material record and returns every problem found (empty = valid).
 *
 * Property rules: λ must be finite and > 0. Density and specific heat may be
 * absent (heat capacity is then unavailable) but, if present, must be > 0.
 *
 * Honesty rules (these protect the thesis from over-claiming):
 *  - `verified` needs a complete source trail: citation, location inside the
 *    source, the date it was checked, who checked it, and the conditions the
 *    values apply to.
 *  - `illustrative` records must not carry a URL, because a link would make an
 *    unsourced number look sourced.
 *  - every record needs a citation text and at least one stated limitation.
 */
export function validateMaterial(record: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!isRecord(record)) {
    return [{ code: 'invalid-structure', path: '', message: 'A material record must be an object.' }];
  }
  const add = (issue: ValidationIssue | null): void => {
    if (issue) issues.push(issue);
  };
  const problem = (code: ValidationIssue['code'], path: string, message: string): void => {
    issues.push({ code, path, message });
  };

  if (typeof record.id !== 'string' || !ID_PATTERN.test(record.id)) {
    problem('invalid-format', 'id', 'Material id must be lowercase letters/digits separated by single hyphens (e.g. "mineral-wool-slab").');
  }
  if (isBlank(record.name)) problem('missing-value', 'name', 'Material name is required.');
  if (!CATEGORIES.includes(record.category)) {
    problem('invalid-option', 'category', `Category must be one of: ${MATERIAL_CATEGORIES.join(', ')}.`);
  }

  add(numberIssue(record.lambdaWPerMK, 'lambdaWPerMK', 'Thermal conductivity (W/(m·K))', 'positive'));
  if (record.densityKgPerM3 !== undefined && record.densityKgPerM3 !== null) {
    add(numberIssue(record.densityKgPerM3, 'densityKgPerM3', 'Density (kg/m³)', 'positive'));
  }
  if (record.specificHeatJPerKgK !== undefined && record.specificHeatJPerKgK !== null) {
    add(numberIssue(record.specificHeatJPerKgK, 'specificHeatJPerKgK', 'Specific heat capacity (J/(kg·K))', 'positive'));
  }

  // Units: only SI, spelled exactly as in SI_MATERIAL_UNITS.
  const units = record.units;
  if (!isRecord(units)) {
    problem('missing-value', 'units', 'Units are required (use SI_MATERIAL_UNITS).');
  } else if (
    units.conductivity !== SI_MATERIAL_UNITS.conductivity ||
    units.density !== SI_MATERIAL_UNITS.density ||
    units.specificHeat !== SI_MATERIAL_UNITS.specificHeat
  ) {
    problem(
      'invalid-option',
      'units',
      `Units must be ${SI_MATERIAL_UNITS.conductivity}, ${SI_MATERIAL_UNITS.density}, ${SI_MATERIAL_UNITS.specificHeat}. Convert other units before storing.`,
    );
  }

  // Additional properties.
  if (record.additionalProperties !== undefined) {
    if (!Array.isArray(record.additionalProperties)) {
      problem('invalid-structure', 'additionalProperties', 'Additional properties must be a list.');
    } else {
      record.additionalProperties.forEach((item: unknown, index: number) => {
        const path = `additionalProperties[${index}]`;
        if (!isRecord(item)) {
          problem('invalid-structure', path, 'Each additional property must be an object.');
          return;
        }
        if (isBlank(item.name)) problem('missing-value', `${path}.name`, 'Property name is required.');
        if (isBlank(item.unit)) problem('missing-value', `${path}.unit`, 'Property unit is required.');
        add(numberIssue(item.value, `${path}.value`, 'Property value', 'non-negative'));
      });
    }
  }

  // Status and source.
  const status = record.status;
  if (!STATUSES.includes(status)) {
    problem('invalid-option', 'status', 'Status must be "verified", "unverified", "illustrative" or "user-defined".');
  }
  if (!(THERMAL_VALUE_TYPES as readonly unknown[]).includes(record.valueType)) {
    problem('invalid-option', 'valueType', `Value type must be one of: ${THERMAL_VALUE_TYPES.join(', ')}.`);
  }
  const source = record.source;
  if (!isRecord(source)) {
    problem('missing-value', 'source', 'A source is required (for unsourced values, say so in the citation).');
  } else {
    if (!(SOURCE_TYPES as readonly unknown[]).includes(source.type)) {
      problem('invalid-option', 'source.type', `Source type must be one of: ${SOURCE_TYPES.join(', ')}.`);
    }
    if (status === 'illustrative' && (source.type !== 'none' || record.valueType !== 'unspecified')) {
      problem(
        'invalid-option',
        'status',
        'An illustrative value has no source and no stated value type: use source.type "none" and valueType "unspecified".',
      );
    }
    if (status === 'verified') {
      if (source.type === 'none' || source.type === 'user-note') {
        problem('invalid-option', 'source.type', 'A verified value needs a real source type (standard, regulation, datasheet, research or reference table).');
      }
      if (record.valueType === 'unspecified') {
        problem('invalid-option', 'valueType', 'A verified value must say whether it is a measured, declared or design value.');
      }
    }
    if (isBlank(source.citation)) {
      problem('missing-value', 'source.citation', 'Citation text is required. For unsourced values state clearly that there is no source.');
    }
    if (source.url !== undefined && (typeof source.url !== 'string' || !/^https?:\/\/\S+$/.test(source.url))) {
      problem('invalid-format', 'source.url', 'URL must start with http:// or https://.');
    }
    if (source.checkedOn !== undefined && !isIsoDate(source.checkedOn)) {
      problem('invalid-format', 'source.checkedOn', 'checkedOn must be a real date written YYYY-MM-DD.');
    }
    if (status === 'illustrative' && source.url !== undefined) {
      problem('invalid-option', 'source.url', 'An illustrative value has no source, so it must not carry a URL.');
    }
    if (status === 'verified') {
      if (isBlank(source.location)) {
        problem('missing-value', 'source.location', 'A verified value must say where in the source it was found (table/clause/page).');
      }
      if (!isIsoDate(source.checkedOn)) {
        problem('missing-value', 'source.checkedOn', 'A verified value needs the date (YYYY-MM-DD) it was checked against the source.');
      }
      if (isBlank(source.checkedBy)) {
        problem('missing-value', 'source.checkedBy', 'A verified value needs the name of the person who checked it.');
      }
      if (isBlank(record.conditions)) {
        problem('missing-value', 'conditions', 'A verified value must state the conditions it applies to (moisture, temperature, product …).');
      }
    }
  }

  const notes = record.assumptionsAndLimitations;
  if (!Array.isArray(notes) || notes.length === 0 || notes.some((n: unknown) => isBlank(n))) {
    problem('missing-value', 'assumptionsAndLimitations', 'List at least one assumption or limitation (all entries must be non-empty text).');
  }

  return issues;
}

/**
 * Sanity warnings for numbers that are valid but suspicious, which catches
 * typing slips such as 40 instead of 0.04. The bounds are rough plausibility
 * limits for common building materials, not scientific claims.
 */
export function materialWarnings(record: Pick<MaterialRecord, 'lambdaWPerMK' | 'densityKgPerM3' | 'specificHeatJPerKgK'>): string[] {
  const warnings: string[] = [];
  if (record.lambdaWPerMK < 0.01 || record.lambdaWPerMK > 5) {
    warnings.push(`Conductivity ${record.lambdaWPerMK} W/(m·K) is outside 0.01–5, the usual range for building materials. Check the value and its unit.`);
  }
  if (record.densityKgPerM3 !== undefined && (record.densityKgPerM3 < 5 || record.densityKgPerM3 > 8000)) {
    warnings.push(`Density ${record.densityKgPerM3} kg/m³ is outside 5–8000. Check the value and its unit.`);
  }
  if (record.specificHeatJPerKgK !== undefined && (record.specificHeatJPerKgK < 300 || record.specificHeatJPerKgK > 5000)) {
    warnings.push(`Specific heat ${record.specificHeatJPerKgK} J/(kg·K) is outside 300–5000. Check the value and its unit (not kJ/(kg·K)).`);
  }
  return warnings;
}
