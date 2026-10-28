import { formatThickness } from './format';
import type { WallLayout } from './layout';

const metres = (value: number): string => `${Number(value.toFixed(3))} m`;

/**
 * A sentence-level text alternative for the 3D picture, for screen readers and
 * as the canvas label. Lists the layers in order with their TRUE thicknesses.
 */
export function describeLayout(layout: WallLayout): string {
  const layers = layout.layers.map((l, i) => `${i + 1}. ${l.name}, ${formatThickness(l.thicknessM)}`).join('; ');
  const view = [layout.exploded ? 'exploded view' : 'assembled view', layout.thicknessScale > 1 ? `thickness exaggerated ${layout.thicknessScale} times for visibility` : 'true proportions']
    .join(', ');
  return (
    `3D model of a wall ${metres(layout.widthM)} wide and ${metres(layout.heightM)} high, total thickness ${formatThickness(layout.totalThicknessM)}, ` +
    `${layout.layers.length} layer${layout.layers.length === 1 ? '' : 's'} from the interior face to the exterior face: ${layers}. ` +
    `Showing ${view}. Colours identify material categories, not temperatures.`
  );
}
