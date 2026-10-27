/**
 * Small shared helpers for the tests.
 *
 * IMPORTANT: every material number in this file is a SYNTHETIC test value chosen
 * to give clean arithmetic. None of them is real material data.
 */
import { expect } from 'vitest';
import { customSurfaceResistances, EngineInputError, iso6946Preset } from '../../src/engine';
import type { Layer, ValidationIssue, WallInput } from '../../src/engine';

/** Asserts a ≈ b to a relative tolerance (absolute for numbers smaller than 1). */
export function expectClose(actual: number, expected: number, relTol = 1e-12): void {
  const tolerance = relTol * Math.max(1, Math.abs(expected));
  expect(Math.abs(actual - expected), `expected ${actual} ≈ ${expected}`).toBeLessThanOrEqual(tolerance);
}

/** Runs `fn`, expects it to throw EngineInputError, and returns the issues. */
export function issuesOf(fn: () => unknown): ValidationIssue[] {
  try {
    fn();
  } catch (error) {
    if (error instanceof EngineInputError) return error.issues;
    throw error;
  }
  throw new Error('Expected EngineInputError to be thrown, but the call returned normally.');
}

/** Array element access that fails loudly instead of returning undefined. */
export function at<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`No element at index ${index} (length ${items.length}).`);
  }
  return item;
}

/** Lets a test pass deliberately wrong data (wrong type, missing field) to the engine. */
export const wrong = (value: unknown): never => value as never;

// ---- synthetic layers (case A of validation/reference_cases.py) ------------
export const PLASTER: Layer = {
  name: 'Plaster (test)',
  thicknessM: 0.015,
  lambdaWPerMK: 0.5,
  densityKgPerM3: 1200,
  specificHeatJPerKgK: 1000,
};
export const MASONRY: Layer = {
  name: 'Masonry (test)',
  thicknessM: 0.2,
  lambdaWPerMK: 1.0,
  densityKgPerM3: 2000,
  specificHeatJPerKgK: 1000,
};
export const INSULATION: Layer = {
  name: 'Insulation (test)',
  thicknessM: 0.08,
  lambdaWPerMK: 0.04,
  densityKgPerM3: 30,
  specificHeatJPerKgK: 1500,
};
export const RENDER: Layer = {
  name: 'Render (test)',
  thicknessM: 0.02,
  lambdaWPerMK: 0.8,
  densityKgPerM3: 1800,
  specificHeatJPerKgK: 1000,
};

/** Surface resistances 0.13 / 0.04 entered as the user's own values (no warnings). */
export const USER_SURFACES = customSurfaceResistances(0.13, 0.04, 'horizontal', 'test fixture');

/**
 * The four-layer reference wall (case A): 3.0 m × 2.5 m, 20 °C inside,
 * 5 °C outside, 24 h. Pass overrides to change one thing at a time.
 */
export function referenceWall(overrides: Partial<WallInput> = {}): WallInput {
  return {
    layers: [PLASTER, MASONRY, INSULATION, RENDER].map((layer) => ({ ...layer })),
    widthM: 3.0,
    heightM: 2.5,
    surfaceResistances: USER_SURFACES,
    conditions: { insideTemperatureC: 20, outsideTemperatureC: 5, durationHours: 24 },
    ...overrides,
  };
}

/** The reference wall with the insulation thickness replaced. */
export function wallWithInsulation(thicknessM: number, lambdaWPerMK = INSULATION.lambdaWPerMK): WallInput {
  return referenceWall({
    layers: [PLASTER, MASONRY, { ...INSULATION, thicknessM, lambdaWPerMK }, RENDER].map((layer) => ({ ...layer })),
  });
}

export { iso6946Preset };
