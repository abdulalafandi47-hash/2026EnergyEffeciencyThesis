/** Public API of the calculation engine. Other modules import from here only. */
export { calculateWall, ENERGY_ESTIMATE_NOTE } from './calculateWall';
export { EngineInputError } from './errors';
export {
  arealHeatCapacity,
  energyKWh,
  heatCapacity,
  heatFlowDirection,
  heatTransferRateW,
  layerResistance,
  totalResistance,
  uValueFromResistance,
  wallArea,
} from './formulas';
export {
  customSurfaceResistances,
  ISO6946_U_VALUE_PRESETS,
  iso6946Preset,
} from './surfaceResistance';
export { calculateTemperatureProfile } from './temperatureProfile';
export type { ProfileLayer } from './temperatureProfile';
export { validateWallInput } from './validateWallInput';
export { ABSOLUTE_ZERO_C, DATA_STATUSES, isBlank, isRecord, numberIssue } from './validation';
export type { NumberRule } from './validation';
export type * from './types';
