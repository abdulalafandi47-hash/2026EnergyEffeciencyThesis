/** Public API of the charts module: small dependency-free SVG charts (pure data in, SVG out). */
export { buildBarChart } from './barChart';
export type { BarChartOptions, BarItem } from './barChart';
export { buildProfileChart } from './profileChart';
export type { ProfileChartInput } from './profileChart';
export { formatTick, linearScale, niceTicks } from './scales';
export type { LinearScale } from './scales';
