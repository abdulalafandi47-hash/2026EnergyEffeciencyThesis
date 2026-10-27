/** Public API of the analysis module: the only bridge from the screen to the calculation engine. */
export { analyzeWall, describeDirection, profileForChart } from './analyze';
export type { Analysis, AnalysisOutcome, LayerTemperatures, ProfileChartData } from './analyze';
export { sweepLayerThickness, sweepOutsideTemperature, swapLayerMaterial } from './compare';
export type { Comparison, VariantResult } from './compare';
