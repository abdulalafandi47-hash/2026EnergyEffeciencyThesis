import type { ValidationIssue } from './types';

/**
 * Thrown when the engine is given input it cannot calculate with
 * (zero/negative thickness, missing conductivity, NaN, …).
 *
 * The engine never "fixes" bad input or returns NaN: a wrong number that
 * looks plausible is worse than a clear error. The user interface catches
 * this error and shows `issues` next to the offending fields.
 */
export class EngineInputError extends Error {
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    super(issues.map((issue) => `${issue.path || '(input)'}: ${issue.message}`).join('; '));
    this.name = 'EngineInputError';
    this.issues = issues;
  }
}
