import { numberIssue } from './validation';
import type { ValidationIssue } from './types';

const ORIENTATIONS: readonly unknown[] = ['horizontal', 'upwards', 'downwards'];
const STATUSES: readonly unknown[] = ['verified', 'unverified', 'illustrative', 'user-defined'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBlank(value: unknown): boolean {
  return typeof value !== 'string' || value.trim() === '';
}

/**
 * Checks a whole wall definition and returns EVERY problem found (an empty
 * list means the input is valid). The input type is `unknown` because data
 * coming from forms or files may not match the TypeScript types.
 *
 * Rules:
 *  - thickness, conductivity, width, height must be finite and > 0;
 *  - density and specific heat are optional, but if given they must be > 0
 *    (a missing value is allowed and means "heat capacity unavailable";
 *     an invalid value is an error);
 *  - surface resistances must be given explicitly and be ≥ 0;
 *  - temperatures must be finite and not below absolute zero;
 *  - duration must be ≥ 0.
 */
export function validateWallInput(input: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (issue: ValidationIssue | null): void => {
    if (issue) issues.push(issue);
  };

  if (!isRecord(input)) {
    return [{ code: 'invalid-structure', path: '', message: 'Wall input must be an object.' }];
  }

  add(numberIssue(input.widthM, 'widthM', 'Wall width (m)', 'positive'));
  add(numberIssue(input.heightM, 'heightM', 'Wall height (m)', 'positive'));

  // --- layers -------------------------------------------------------------
  const layers = input.layers;
  if (!Array.isArray(layers) || layers.length === 0) {
    issues.push({ code: 'no-layers', path: 'layers', message: 'A wall needs at least one layer.' });
  } else {
    layers.forEach((layer: unknown, index: number) => {
      const path = `layers[${index}]`;
      if (!isRecord(layer)) {
        issues.push({ code: 'invalid-structure', path, message: `Layer ${index + 1} must be an object.` });
        return;
      }
      const label = `Layer ${index + 1}${isBlank(layer.name) ? '' : ` (${String(layer.name)})`}`;
      if (isBlank(layer.name)) {
        issues.push({ code: 'missing-value', path: `${path}.name`, message: `${label} needs a name.` });
      }
      add(numberIssue(layer.thicknessM, `${path}.thicknessM`, `${label} thickness (m)`, 'positive'));
      add(
        numberIssue(layer.lambdaWPerMK, `${path}.lambdaWPerMK`, `${label} thermal conductivity (W/(m·K))`, 'positive'),
      );
      // Optional properties: absent is fine, present-but-invalid is an error.
      if (layer.densityKgPerM3 !== undefined && layer.densityKgPerM3 !== null) {
        add(numberIssue(layer.densityKgPerM3, `${path}.densityKgPerM3`, `${label} density (kg/m³)`, 'positive'));
      }
      if (layer.specificHeatJPerKgK !== undefined && layer.specificHeatJPerKgK !== null) {
        add(
          numberIssue(
            layer.specificHeatJPerKgK,
            `${path}.specificHeatJPerKgK`,
            `${label} specific heat capacity (J/(kg·K))`,
            'positive',
          ),
        );
      }
    });
  }

  // --- surface resistances (must be chosen explicitly, never defaulted) ----
  const surface = input.surfaceResistances;
  if (!isRecord(surface)) {
    issues.push({
      code: 'missing-value',
      path: 'surfaceResistances',
      message:
        'Surface resistances must be chosen explicitly: use a preset such as iso6946Preset("horizontal") or enter custom values.',
    });
  } else {
    add(numberIssue(surface.insideM2KPerW, 'surfaceResistances.insideM2KPerW', 'Internal surface resistance R_si (m²·K/W)', 'non-negative'));
    add(numberIssue(surface.outsideM2KPerW, 'surfaceResistances.outsideM2KPerW', 'External surface resistance R_se (m²·K/W)', 'non-negative'));
    if (!ORIENTATIONS.includes(surface.heatFlowOrientation)) {
      issues.push({
        code: 'invalid-option',
        path: 'surfaceResistances.heatFlowOrientation',
        message: 'Heat-flow orientation must be "horizontal", "upwards" or "downwards".',
      });
    }
    if (!STATUSES.includes(surface.status)) {
      issues.push({
        code: 'invalid-option',
        path: 'surfaceResistances.status',
        message: 'Status must be "verified", "unverified", "illustrative" or "user-defined".',
      });
    }
    if (isBlank(surface.basis)) {
      issues.push({
        code: 'missing-value',
        path: 'surfaceResistances.basis',
        message: 'State the basis of the surface resistances (standard and table, or your own assumption).',
      });
    }
  }

  // --- boundary conditions -------------------------------------------------
  const conditions = input.conditions;
  if (!isRecord(conditions)) {
    issues.push({ code: 'missing-value', path: 'conditions', message: 'Boundary conditions are required.' });
  } else {
    add(numberIssue(conditions.insideTemperatureC, 'conditions.insideTemperatureC', 'Inside temperature (°C)', 'temperature-c'));
    add(numberIssue(conditions.outsideTemperatureC, 'conditions.outsideTemperatureC', 'Outside temperature (°C)', 'temperature-c'));
    add(numberIssue(conditions.durationHours, 'conditions.durationHours', 'Duration (hours)', 'non-negative'));
  }

  return issues;
}
