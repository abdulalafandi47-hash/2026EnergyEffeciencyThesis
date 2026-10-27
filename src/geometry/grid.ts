import type { WallLayout } from './layout';

export interface GridSpec {
  /** Distance between grid lines, metres. */
  stepM: number;
  /** The grid covers ±halfExtentM from the wall's centre in x and z, metres. */
  halfExtentM: number;
  /** y of the ground plane (the bottom of the wall), metres. */
  groundY: number;
  /** Text for the scale legend, e.g. "Grid: 1 m". */
  label: string;
}

const STEPS_M = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 25, 50, 100];

/**
 * A ground grid under the wall, with a round line spacing chosen so that the
 * wall's larger side covers at most 5 grid cells. Lines are metric.
 */
export function gridSpec(layout: WallLayout): GridSpec {
  const longest = Math.max(layout.widthM, layout.heightM);
  const stepM = STEPS_M.find((s) => longest / s <= 5) ?? (STEPS_M[STEPS_M.length - 1] as number);
  const cells = Math.max(6, Math.ceil((longest * 1.5) / stepM)); // grid reaches 50 % beyond the wall each side
  const halfExtentM = cells * stepM;
  const label = stepM < 1 ? `Grid: ${Number((stepM * 1000).toFixed(0))} mm` : `Grid: ${stepM} m`;
  return { stepM, halfExtentM, groundY: -layout.heightM / 2, label };
}
