/** Public API of the wall geometry module (pure arithmetic, no 3D library, no DOM). */
export { CATEGORY_COLORS, colorForCategory, FALLBACK_COLOR } from './colors';
export { describeLayout } from './describe';
export { formatThickness } from './format';
export { spreadLabels } from './labels';
export type { LabelAnchor, PlacedLabel } from './labels';
export { explodedGap, GeometryError, layoutWall, MAX_THICKNESS_SCALE } from './layout';
export type { LayerBox, LayerSpec, LayoutOptions, WallLayout, WallSpec } from './layout';
