/** Public API of the report module (pure: no screen code, no file or network access). */
export { buildReport, DEFAULT_REPORT_TITLE, engineInputJson, fingerprintOf, reportFileBase, wallFileBase } from './buildReport';
export { EQUATIONS, LIMITATIONS, REFERENCES } from './content';
export type { EquationEntry, LinkEntry, ReferenceRegister, StandardEntry } from './content';
export { csvCell, escapeHtml, escapeMarkdown, fnv1a, stableJson } from './format';
export { renderHtml } from './renderHtml';
export type { HtmlOptions } from './renderHtml';
export { renderLayersCsv, renderJson } from './renderData';
export { renderMarkdown } from './renderMarkdown';
export type { Block, ReportInput, ReportModel, ReportSection } from './types';
export { REPORT_SCHEMA, REPORT_SCHEMA_VERSION, SOFTWARE_NAME, SOFTWARE_VERSION } from './version';
