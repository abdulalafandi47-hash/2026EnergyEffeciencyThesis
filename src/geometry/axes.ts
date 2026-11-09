/**
 * The coordinate axes drawn in the 3D view (a display aid, not a result).
 *
 * They show the drawing's own coordinate system (see layout.ts):
 *   x  through the wall thickness, from the interior face towards the exterior
 *   y  up (wall height)
 *   z  along the wall (wall width)
 * The triad sits at the bottom corner of the interior face nearest the default
 * camera, so it is visible without covering the wall. Lengths along x are in
 * drawing units: when the thickness is drawn enlarged, x distances in the
 * picture are enlarged too (the status bar says so).
 */
import type { WallLayout } from './layout';

export interface AxisSpec {
  id: 'x' | 'y' | 'z';
  /** Unit direction of the positive axis. */
  direction: readonly [number, number, number];
  /** Line colour, CSS hex (the usual CAD convention: x red, y green, z blue). */
  color: string;
  /** Short text shown at the tip. */
  label: string;
  /** Plain-language meaning, for the legend and screen readers. */
  meaning: string;
}

export interface AxesSpec {
  /** Where the three axes start, metres (drawing coordinates). */
  origin: readonly [number, number, number];
  /** Length of each axis, metres (drawing coordinates). */
  lengthM: number;
  axes: readonly AxisSpec[];
}

export const AXES: readonly AxisSpec[] = [
  { id: 'x', direction: [1, 0, 0], color: '#e5534b', label: 'x', meaning: 'through the wall, interior → exterior' },
  { id: 'y', direction: [0, 1, 0], color: '#57ab5a', label: 'y', meaning: 'up (height)' },
  { id: 'z', direction: [0, 0, 1], color: '#539bf5', label: 'z', meaning: 'along the wall (width)' },
];

/** The axes for a wall: at the interior bottom corner, each a quarter of the wall's smaller side long. */
export function axesSpec(layout: WallLayout): AxesSpec {
  return {
    origin: [layout.interiorFaceX, -layout.heightM / 2, layout.widthM / 2],
    lengthM: 0.25 * Math.min(layout.widthM, layout.heightM),
    axes: AXES,
  };
}

/** One-line legend, e.g. "Axes: x through the wall, interior → exterior · y up (height) · z along the wall (width)". */
export function describeAxes(): string {
  return `Axes: ${AXES.map((a) => `${a.label} ${a.meaning}`).join(' · ')}`;
}
