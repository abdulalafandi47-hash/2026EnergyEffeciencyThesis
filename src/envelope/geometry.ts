/**
 * Dimensions, areas and consistency checks of the parametric house.
 *
 * Dimension convention (a simplification, stated in every result):
 *  - lengths are EXTERNAL dimensions of the box; each exterior wall spans its
 *    whole side (so the corners are counted in both walls that meet there);
 *  - a wall's area for heat transfer is its gross area minus the openings in it;
 *  - roof and floor cover the whole footprint (length × depth);
 *  - a partition spans the full depth and storey height.
 * ISO 13789 defines formal dimension conventions; they are not implemented here.
 */
import type { BuildingProject, Component, Exposure, Opening, Side } from './types';
import { isOpening } from './types';

export interface ElementDimensions {
  /** Along the element (wall length, partition depth, roof/floor length), metres. */
  widthM: number;
  /** Up the element (storey height) or across it (roof/floor depth), metres. */
  heightM: number;
  grossAreaM2: number;
  /** Area through which heat is calculated: gross minus openings (walls); gross otherwise. */
  netAreaM2: number;
  /** Total area of the openings it holds (walls only). */
  openingsAreaM2: number;
}

/** Length of a side of the house: north and south walls run east–west. */
export function sideLength(project: BuildingProject, side: Side): number {
  return side === 'north' || side === 'south' ? project.geometry.lengthM : project.geometry.depthM;
}

export function openingsOf(project: BuildingProject, wallId: string): Opening[] {
  return project.components.filter((c): c is Opening => isOpening(c) && c.hostId === wallId);
}

/** Bottom edge of an opening above the floor (doors stand on the floor). */
export const sillOf = (o: Opening): number => (o.type === 'door' ? 0 : o.sillM);

export function dimensionsOf(project: BuildingProject, c: Component): ElementDimensions {
  const g = project.geometry;
  const plain = (widthM: number, heightM: number): ElementDimensions => ({ widthM, heightM, grossAreaM2: widthM * heightM, netAreaM2: widthM * heightM, openingsAreaM2: 0 });
  switch (c.type) {
    case 'exterior-wall': {
      const length = sideLength(project, c.side);
      const openings = openingsOf(project, c.id).reduce((sum, o) => sum + o.widthM * o.heightM, 0);
      const gross = length * g.heightM;
      return { widthM: length, heightM: g.heightM, grossAreaM2: gross, netAreaM2: gross - openings, openingsAreaM2: openings };
    }
    case 'partition':
      return plain(g.depthM, g.heightM);
    case 'roof':
    case 'floor':
      return plain(g.lengthM, g.depthM);
    default:
      return plain(c.widthM, c.heightM);
  }
}

export interface ModelIssue {
  /** The component concerned, or null for the whole project. */
  componentId: string | null;
  message: string;
}

const ALLOWED_EXPOSURE: Record<Component['type'], Array<Exposure['kind']>> = {
  'exterior-wall': ['outside', 'unconditioned'],
  partition: ['conditioned', 'unconditioned'],
  roof: ['outside', 'unconditioned'],
  floor: ['ground', 'outside', 'unconditioned'],
  window: [],
  'glazed-door': [],
  door: [],
};

const positive = (x: number): boolean => Number.isFinite(x) && x > 0;

/**
 * Geometric and structural problems that make a component impossible to place or
 * calculate (missing DATA, such as an unknown U-value, is reported by the calculation instead).
 */
export function checkModel(project: BuildingProject): ModelIssue[] {
  const issues: ModelIssue[] = [];
  const g = project.geometry;
  if (!positive(g.lengthM) || !positive(g.depthM) || !positive(g.heightM)) {
    issues.push({ componentId: null, message: 'The house length, depth and storey height must all be greater than zero.' });
    return issues;
  }
  const seenSides = new Map<Side, string>();
  let roofs = 0;
  let floors = 0;
  for (const c of project.components) {
    const at = (message: string): void => void issues.push({ componentId: c.id, message });
    if (!isOpening(c)) {
      const allowed = ALLOWED_EXPOSURE[c.type];
      if (!allowed.includes(c.exposure.kind)) at(`${c.name}: "${c.exposure.kind}" is not a possible exposure for this element.`);
    }
    if (c.type === 'exterior-wall') {
      const other = seenSides.get(c.side);
      if (other) at(`${c.name}: the ${c.side} side already has an exterior wall. This model has one wall per side.`);
      else seenSides.set(c.side, c.id);
    }
    if (c.type === 'roof' && ++roofs > 1) at(`${c.name}: this model has one roof over the whole footprint.`);
    if (c.type === 'floor' && ++floors > 1) at(`${c.name}: this model has one floor over the whole footprint.`);
    if (c.type === 'partition' && !(c.positionM > 0 && c.positionM < g.lengthM)) {
      at(`${c.name}: the position must lie inside the house (between 0 and ${g.lengthM} m from the west face).`);
    }
    if (isOpening(c)) {
      const host = project.components.find((h) => h.id === c.hostId);
      if (!host || host.type !== 'exterior-wall') {
        at(`${c.name}: it must sit in an exterior wall, and its wall does not exist.`);
        continue;
      }
      if (!positive(c.widthM) || !positive(c.heightM)) {
        at(`${c.name}: width and height must be greater than zero.`);
        continue;
      }
      const length = sideLength(project, host.side);
      const sill = sillOf(c);
      if (c.offsetM < 0 || c.offsetM + c.widthM > length + 1e-9) at(`${c.name}: it does not fit along its wall (offset ${c.offsetM} m + width ${c.widthM} m > wall length ${length} m, or a negative offset).`);
      if (sill < 0 || sill + c.heightM > g.heightM + 1e-9) at(`${c.name}: it does not fit in the storey height (sill ${sill} m + height ${c.heightM} m > ${g.heightM} m, or a negative sill).`);
    }
  }
  // Openings in the same wall must not overlap.
  const openings = project.components.filter(isOpening);
  for (let i = 0; i < openings.length; i++) {
    for (let j = i + 1; j < openings.length; j++) {
      const a = openings[i] as Opening;
      const b = openings[j] as Opening;
      if (a.hostId !== b.hostId) continue;
      const overlapU = Math.min(a.offsetM + a.widthM, b.offsetM + b.widthM) - Math.max(a.offsetM, b.offsetM);
      const overlapV = Math.min(sillOf(a) + a.heightM, sillOf(b) + b.heightM) - Math.max(sillOf(a), sillOf(b));
      if (overlapU > 1e-9 && overlapV > 1e-9) issues.push({ componentId: b.id, message: `${b.name} overlaps ${a.name} in the same wall.` });
    }
  }
  return issues;
}
