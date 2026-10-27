/**
 * Surface (air-film) resistances R_si and R_se.
 *
 * Why this file exists: R_si and R_se are not universal constants. They depend
 * on the direction of heat flow (and, for R_se, on wind) and on the purpose of
 * the assessment. For example, checks for surface condensation or mould use
 * different internal values than a U-value calculation. So the engine never
 * applies a default on its own: whoever builds a `WallInput` must choose a
 * preset below, or enter custom values, and that choice is printed in the
 * results as an assumption.
 *
 * STATUS OF THE PRESETS: the numbers below are the commonly quoted ISO 6946
 * values for U-value calculations. They agree across several secondary sources
 * (see docs/sources.md) but have NOT yet been checked against the text of the
 * standard itself, so they are labelled 'unverified'. Once you have checked
 * ISO 6946:2017 (Table 7), change the status to 'verified' and record the
 * table/clause in `basis`.
 */
import type { SurfaceHeatFlowOrientation, SurfaceResistances } from './types';

const PRESET_BASIS =
  'Commonly quoted ISO 6946 values for U-value calculation (standard conditions). ' +
  'Not yet checked against the standard text; see docs/sources.md.';

/** Presets keyed by the direction of heat flow. Use for U-value calculations only. */
export const ISO6946_U_VALUE_PRESETS: Readonly<
  Record<SurfaceHeatFlowOrientation, SurfaceResistances>
> = {
  /** Vertical walls: heat flows horizontally (within ±30° of horizontal). */
  horizontal: {
    insideM2KPerW: 0.13,
    outsideM2KPerW: 0.04,
    heatFlowOrientation: 'horizontal',
    basis: PRESET_BASIS,
    status: 'unverified',
  },
  /** Roofs/ceilings with heat flowing upwards. Not used for walls in this version. */
  upwards: {
    insideM2KPerW: 0.1,
    outsideM2KPerW: 0.04,
    heatFlowOrientation: 'upwards',
    basis: PRESET_BASIS,
    status: 'unverified',
  },
  /** Floors with heat flowing downwards. Not used for walls in this version. */
  downwards: {
    insideM2KPerW: 0.17,
    outsideM2KPerW: 0.04,
    heatFlowOrientation: 'downwards',
    basis: PRESET_BASIS,
    status: 'unverified',
  },
};

/** Returns the preset for the given heat-flow orientation. */
export function iso6946Preset(orientation: SurfaceHeatFlowOrientation): SurfaceResistances {
  return { ...ISO6946_U_VALUE_PRESETS[orientation] };
}

/**
 * Builds user-entered surface resistances. The values are checked later by
 * `validateWallInput`, so impossible numbers are reported rather than ignored.
 */
export function customSurfaceResistances(
  insideM2KPerW: number,
  outsideM2KPerW: number,
  heatFlowOrientation: SurfaceHeatFlowOrientation,
  basis: string,
): SurfaceResistances {
  return { insideM2KPerW, outsideM2KPerW, heatFlowOrientation, basis, status: 'user-defined' };
}
