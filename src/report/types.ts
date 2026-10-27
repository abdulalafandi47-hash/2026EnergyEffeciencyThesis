/**
 * The report is built in two steps:
 *   1. `buildReport` turns the numbers the program has already calculated into a
 *      plain, format-neutral document (sections made of blocks);
 *   2. a renderer writes that document as HTML, Markdown, JSON or CSV.
 * No number is calculated in this module: every value is read from the
 * calculation engine's result (via the analysis module) and only formatted.
 */
import type { Analysis, Comparison } from '../analysis';
import type { LayerView, WallDraft } from '../editor';
import type { WallInput } from '../engine';

export type Block =
  | { kind: 'paragraph'; text: string; emphasis?: 'warning' | 'note' }
  | { kind: 'subheading'; text: string }
  | { kind: 'list'; items: string[] }
  /** `numeric` lists the column indexes that hold numbers (right-aligned). */
  | { kind: 'table'; caption: string; columns: string[]; rows: string[][]; numeric?: number[] }
  | { kind: 'code'; text: string }
  | { kind: 'figure'; id: 'temperature-profile'; caption: string };

export interface ReportSection {
  /** Letters, digits and hyphens only (used as an HTML anchor). */
  id: string;
  heading: string;
  blocks: Block[];
}

export interface ReportModel {
  schema: string;
  schemaVersion: number;
  title: string;
  /** ISO 8601 time the report was made. */
  generatedAt: string;
  software: { name: string; version: string };
  /** Short checksum of the engine input (identifies identical inputs; not a security feature). */
  fingerprint: string;
  /** Notes typed by the report's author (plain text, may be empty). */
  notes: string;
  /** Statements that must stay visible at the top of the report. */
  banners: string[];
  sections: ReportSection[];
}

/** Everything a report is made from. All of it already exists on screen. */
export interface ReportInput {
  title: string;
  notes: string;
  /** Injected so that reports are reproducible in tests. */
  generatedAt: Date;
  draft: WallDraft;
  wall: WallInput;
  views: LayerView[];
  analysis: Analysis;
  /** Comparisons to include (may be empty). */
  comparisons: Comparison[];
  /** Plausibility warnings from the editor (not errors). */
  editorWarnings?: string[];
}
