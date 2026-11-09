/**
 * Turns the building model into the plain description the 3D view draws, and
 * the heat-flux colours. Display mapping only: no engineering here.
 */
import { fluxColor, NOT_CALCULATED_COLOR } from '../geometry';
import type { HouseSpec } from '../geometry';
import { checkModel, isOpening, sillOf } from '../envelope';
import type { BuildingProject, Construction, EnvelopeResult } from '../envelope';

/** Total thickness of a construction, or null if any layer has no thickness yet. */
export function constructionThickness(c: Construction): number | null {
  if (c.layers.length === 0 || c.layers.some((l) => l.thicknessM === null)) return null;
  return c.layers.reduce((sum, l) => sum + (l.thicknessM as number), 0);
}

/**
 * The 3D description of a project. Openings with geometry problems (outside their wall,
 * overlapping) are not drawn, so the picture never shows an impossible building.
 */
export function houseSpecFromProject(p: BuildingProject): HouseSpec | null {
  const g = p.geometry;
  if (!(g.lengthM > 0 && g.depthM > 0 && g.heightM > 0)) return null;
  const bad = new Set(checkModel(p).map((i) => i.componentId));
  const spec: HouseSpec = { lengthM: g.lengthM, depthM: g.depthM, heightM: g.heightM, walls: [], openings: [], roof: null, floor: null, partitions: [] };
  for (const c of p.components) {
    if (c.type === 'exterior-wall' && !bad.has(c.id)) spec.walls.push({ id: c.id, side: c.side, thicknessM: constructionThickness(c.construction), visible: c.visible });
    else if (c.type === 'roof' && !spec.roof) spec.roof = { id: c.id, thicknessM: constructionThickness(c.construction), visible: c.visible };
    else if (c.type === 'floor' && !spec.floor) spec.floor = { id: c.id, thicknessM: constructionThickness(c.construction), visible: c.visible };
    else if (c.type === 'partition' && !bad.has(c.id)) spec.partitions.push({ id: c.id, positionM: c.positionM, thicknessM: constructionThickness(c.construction), visible: c.visible });
    else if (isOpening(c) && !bad.has(c.id)) spec.openings.push({ id: c.id, hostId: c.hostId, kind: c.type, offsetM: c.offsetM, sillM: sillOf(c), widthM: c.widthM, heightM: c.heightM, visible: c.visible });
  }
  return spec;
}

export interface FluxView {
  colours: Record<string, string>;
  /** Range of |q| = |Q̇| / A over the calculated components, W/m²; null if none was calculated. */
  range: { min: number; max: number } | null;
}

/** Colours by heat-flux magnitude |q| = |Q̇|/A of each calculated component; grey for the others. */
export function fluxView(result: EnvelopeResult): FluxView {
  const fluxes = result.components
    .filter((r) => r.status === 'calculated' && r.heatFlowW !== null && r.dimensions.netAreaM2 > 0)
    .map((r) => ({ id: r.componentId, q: Math.abs(r.heatFlowW as number) / r.dimensions.netAreaM2 }));
  const colours: Record<string, string> = {};
  for (const r of result.components) colours[r.componentId] = NOT_CALCULATED_COLOR;
  if (fluxes.length === 0) return { colours, range: null };
  // The scale starts at zero, so small differences between elements look small (a min–max
  // stretch would show a 5 % difference as the full colour range).
  const max = Math.max(...fluxes.map((f) => f.q));
  for (const f of fluxes) colours[f.id] = fluxColor(max > 0 ? f.q / max : 0);
  return { colours, range: { min: 0, max } };
}
