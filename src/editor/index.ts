/** Public API of the wall editor logic (no user-interface code). */
export { buildWall, errorFor, warningFor } from './buildWall';
export type { BuildResult } from './buildWall';
export { describeLayers, summarizeDataStatus } from './describeLayers';
export type { DataStatusSummary, LayerView } from './describeLayers';
export {
  addLayer,
  createEmptyDraft,
  createInitialDraft,
  moveLayer,
  moveLayerTo,
  removeLayer,
  setDimensionUnit,
  setDuration,
  setHeight,
  setInsideTemperature,
  setLayerMaterial,
  setLayerThickness,
  setLayerThicknessUnit,
  setOutsideTemperature,
  setSurfaceInside,
  setSurfaceMode,
  setSurfaceOutside,
  setTemperatureUnit,
  setWidth,
} from './draft';
export { FIELD, layerField } from './fields';
export type { LayerFieldName } from './fields';
export { formatNumber, parseNumberInput } from './parseNumber';
export type { ParsedNumber } from './parseNumber';
export type { DraftProblem, LayerDraft, LengthUnit, SurfaceMode, TemperatureUnit, WallDraft } from './types';
