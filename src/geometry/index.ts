/** Public API of the wall geometry module (pure arithmetic, no 3D library, no DOM). */
export { AXES, axesSpec, describeAxes } from './axes';
export type { AxesSpec, AxisSpec } from './axes';
export { CATEGORY_COLORS, colorForCategory, FALLBACK_COLOR } from './colors';
export { temperatureFraction, THERMAL_STOPS, thermalCss, thermalGradientCss, thermalRgb } from './colormap';
export type { Rgb } from './colormap';
export { describeLayout } from './describe';
export { FLUX_STOPS, fluxColor, fluxGradientCss, NOT_CALCULATED_COLOR } from './fluxColor';
export { HOUSE_AXES, HOUSE_COLORS, houseAxesSpec, layoutHouse, NOMINAL_THICKNESS_M, wallFrame, wallPieces } from './house';
export type { HouseBox, HouseKind, HouseLayout, HouseSide, HouseSpec } from './house';
export { gridSpec } from './grid';
export type { GridSpec } from './grid';
export { formatThickness } from './format';
export { spreadLabels } from './labels';
export type { LabelAnchor, PlacedLabel } from './labels';
export { explodedGap, GeometryError, layoutWall, MAX_THICKNESS_SCALE } from './layout';
export type { LayerBox, LayerSpec, LayoutOptions, WallLayout, WallSpec } from './layout';
export type { FlowDirection, ThermalOverlay } from './overlay';
