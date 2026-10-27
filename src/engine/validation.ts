import { EngineInputError } from './errors';
import type { ValidationIssue } from './types';

/** Lowest physically possible temperature, °C. */
export const ABSOLUTE_ZERO_C = -273.15;

export type NumberRule =
  /** Finite number strictly greater than zero. */
  | 'positive'
  /** Finite number greater than or equal to zero. */
  | 'non-negative'
  /** Finite number not below absolute zero (an air temperature in °C). */
  | 'temperature-c';

/**
 * Checks one number and returns a description of the problem, or null if it
 * is acceptable. Works on `unknown` on purpose: data from forms or JSON files
 * is not guaranteed to match the TypeScript types at run time.
 */
export function numberIssue(
  value: unknown,
  path: string,
  label: string,
  rule: NumberRule,
): ValidationIssue | null {
  if (value === undefined || value === null) {
    return { code: 'missing-value', path, message: `${label} is required.` };
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return {
      code: 'not-a-finite-number',
      path,
      message: `${label} must be a finite number (got ${String(value)}).`,
    };
  }
  if (rule === 'positive' && value <= 0) {
    return {
      code: 'must-be-positive',
      path,
      message: `${label} must be greater than 0 (got ${value}).`,
    };
  }
  if (rule === 'non-negative' && value < 0) {
    return {
      code: 'must-be-non-negative',
      path,
      message: `${label} must not be negative (got ${value}).`,
    };
  }
  if (rule === 'temperature-c' && value < ABSOLUTE_ZERO_C) {
    return {
      code: 'below-absolute-zero',
      path,
      message: `${label} cannot be below absolute zero (${ABSOLUTE_ZERO_C} °C); got ${value}.`,
    };
  }
  return null;
}

/** Throws `EngineInputError` if the number is unacceptable; used by the low-level formulas. */
export function assertNumber(value: unknown, path: string, label: string, rule: NumberRule): void {
  const issue = numberIssue(value, path, label, rule);
  if (issue) {
    throw new EngineInputError([issue]);
  }
}
