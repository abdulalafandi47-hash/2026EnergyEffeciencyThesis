/** Builds a complete report input the same way the screen does: draft → wall → views → analysis. */
import { analyzeWall, sweepLayerThickness } from '../../src/analysis';
import type { Comparison } from '../../src/analysis';
import { buildWall, createInitialDraft, describeLayers } from '../../src/editor';
import type { WallDraft } from '../../src/editor';
import { BUILT_IN_MATERIALS } from '../../src/materials';
import type { MaterialRecord } from '../../src/materials';
import type { ReportInput } from '../../src/report';

export const FIXED_TIME = new Date('2026-10-27T12:30:45.000Z');

export function makeReportInput(
  options: { materials?: readonly MaterialRecord[]; draft?: WallDraft; withComparison?: boolean; title?: string; notes?: string } = {},
): ReportInput {
  const materials = options.materials ?? BUILT_IN_MATERIALS;
  const draft = options.draft ?? createInitialDraft(materials);
  const built = buildWall(draft, materials);
  if (!built.ok || !built.wall) throw new Error(`test draft is invalid: ${built.errors.map((e) => e.message).join('; ')}`);
  const outcome = analyzeWall(built.wall);
  if (!outcome.ok) throw new Error(outcome.message);
  const comparisons: Comparison[] = options.withComparison ? [sweepLayerThickness(built.wall, 2, [0.04, 0.08, 0.12])] : [];
  return {
    title: options.title ?? '',
    notes: options.notes ?? '',
    generatedAt: FIXED_TIME,
    draft,
    wall: built.wall,
    views: describeLayers(draft, materials),
    analysis: outcome.analysis,
    comparisons,
    editorWarnings: built.warnings.map((w) => w.message),
  };
}

/** Built-in materials with some hostile text in the fields a report prints. */
export const HOSTILE_NAME = '<script>alert(1)</script> "EPS" | & `tick` *star*';
export function hostileMaterials(): MaterialRecord[] {
  return BUILT_IN_MATERIALS.map((m) =>
    m.id === 'eps-slab'
      ? {
          ...m,
          name: HOSTILE_NAME,
          conditions: '[link](javascript:alert(1)) <img src=x onerror=alert(2)>',
          source: { ...m.source, citation: '=cmd|\' /C calc\'!A0 <b>bold</b>\nsecond line' },
        }
      : m,
  );
}
