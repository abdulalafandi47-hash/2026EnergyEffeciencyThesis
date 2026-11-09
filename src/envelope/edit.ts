/**
 * Creating and editing building projects. Every function returns a NEW project
 * (the old one is never changed), so the screen can redraw, compare or undo safely.
 */
import type { MaterialRecord } from '../materials';
import { openingsOf, sideLength } from './geometry';
import type { BuildingProject, Component, ComponentType, Construction, ExteriorWall, Opening, Side } from './types';
import { COMPONENT_TYPE_LABEL, isOpening } from './types';

export const SIDES: readonly Side[] = ['north', 'east', 'south', 'west'];
const SIDE_NAME: Record<Side, string> = { north: 'North', east: 'East', south: 'South', west: 'West' };

/** A project with nothing in it: the user builds the envelope from scratch. */
export function createBlankProject(): BuildingProject {
  return {
    name: 'New building',
    isExample: false,
    geometry: { lengthM: 10, depthM: 8, heightM: 3 },
    conditions: { insideC: 26, outsideC: 35, durationH: 1, label: 'User-defined condition' },
    components: [],
    nextId: 1,
  };
}

const newId = (p: BuildingProject): [string, BuildingProject] => [`c${p.nextId}`, { ...p, nextId: p.nextId + 1 }];
const copyConstruction = (c: Construction): Construction => ({ layers: c.layers.map((l) => ({ ...l })) });
const deepCopy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export const freeSides = (p: BuildingProject): Side[] => SIDES.filter((s) => !p.components.some((c) => c.type === 'exterior-wall' && c.side === s));
export const hasType = (p: BuildingProject, type: ComponentType): boolean => p.components.some((c) => c.type === type);

/** Can a component of this type be added now? Returns the reason if not. */
export function canAdd(p: BuildingProject, type: ComponentType): { ok: boolean; reason?: string } {
  if (type === 'exterior-wall' && freeSides(p).length === 0) return { ok: false, reason: 'Every side already has an exterior wall (one wall per side in this model).' };
  if ((type === 'roof' || type === 'floor') && hasType(p, type)) return { ok: false, reason: `This model has one ${type} over the whole footprint, and it already exists.` };
  if ((type === 'window' || type === 'glazed-door' || type === 'door') && !hasType(p, 'exterior-wall')) return { ok: false, reason: 'Add an exterior wall first: windows and doors sit in exterior walls.' };
  return { ok: true };
}

/**
 * Adds a component with no thermal data yet (no layers, no U-value): the user enters it.
 * Openings start with a size that the user is expected to change, centred in the chosen wall.
 */
export function addComponent(p: BuildingProject, type: ComponentType, options: { side?: Side; hostId?: string } = {}): { project: BuildingProject; id: string } {
  const check = canAdd(p, type);
  if (!check.ok) throw new Error(check.reason);
  const [id, next] = newId(p);
  const empty: Construction = { layers: [] };
  let component: Component;
  switch (type) {
    case 'exterior-wall': {
      const side = options.side && freeSides(p).includes(options.side) ? options.side : (freeSides(p)[0] as Side);
      component = { id, type, name: `${SIDE_NAME[side]} wall`, visible: true, side, exposure: { kind: 'outside' }, construction: empty };
      break;
    }
    case 'partition':
      component = { id, type, name: `Partition ${next.nextId - 1}`, visible: true, positionM: p.geometry.lengthM / 2, exposure: { kind: 'conditioned' }, construction: empty };
      break;
    case 'roof':
      component = { id, type, name: 'Roof', visible: true, form: 'flat', exposure: { kind: 'outside' }, construction: empty };
      break;
    case 'floor':
      component = { id, type, name: 'Floor', visible: true, exposure: { kind: 'ground' }, construction: empty };
      break;
    default: {
      const host = (p.components.find((c) => c.id === options.hostId && c.type === 'exterior-wall') ?? p.components.find((c) => c.type === 'exterior-wall')) as ExteriorWall;
      const length = sideLength(p, host.side);
      const isDoor = type !== 'window';
      const widthM = Math.min(isDoor ? 0.9 : 1.2, length);
      const heightM = Math.min(isDoor ? 2.1 : 1.2, p.geometry.heightM);
      const offsetM = Math.max(0, (length - widthM) / 2);
      const name = `${COMPONENT_TYPE_LABEL[type]} ${next.nextId - 1}`;
      component = type === 'door'
        ? { id, type, name, visible: true, hostId: host.id, offsetM, widthM, heightM, spec: { kind: 'u-value', uValue: null } }
        : { id, type, name, visible: true, hostId: host.id, offsetM, sillM: type === 'window' ? Math.min(0.9, Math.max(0, p.geometry.heightM - heightM)) : 0, widthM, heightM, uValue: null, gValue: null, shadingFactor: null };
    }
  }
  return { project: { ...next, isExample: false, components: [...p.components, component] }, id };
}

/** Components that are deleted together with this one (the openings of a wall). */
export function dependentsOf(p: BuildingProject, id: string): Opening[] {
  const c = p.components.find((x) => x.id === id);
  return c?.type === 'exterior-wall' ? openingsOf(p, id) : [];
}

/** Deletes a component and the openings it holds. Unknown ids leave the project unchanged. */
export function deleteComponent(p: BuildingProject, id: string): BuildingProject {
  if (!p.components.some((c) => c.id === id)) return p;
  const gone = new Set([id, ...dependentsOf(p, id).map((o) => o.id)]);
  return { ...p, isExample: false, components: p.components.filter((c) => !gone.has(c.id)) };
}

/**
 * Copies a component. A copied wall goes on a free side (refused if none); a copied opening
 * is placed next to the original if it fits, otherwise at the same place (the overlap is then reported).
 */
export function duplicateComponent(p: BuildingProject, id: string): { project: BuildingProject; id: string } {
  const original = p.components.find((c) => c.id === id);
  if (!original) throw new Error('Unknown component.');
  if (original.type === 'roof' || original.type === 'floor') throw new Error(`This model has one ${original.type} over the whole footprint; it cannot be duplicated.`);
  const [newIdValue, next] = newId(p);
  const copy = deepCopy(original);
  copy.id = newIdValue;
  copy.name = `${original.name} (copy)`;
  if (copy.type === 'exterior-wall') {
    const side = freeSides(p)[0];
    if (!side) throw new Error('Every side already has an exterior wall; there is no free side for a copy.');
    copy.side = side;
    copy.name = `${SIDE_NAME[side]} wall`;
    copy.construction = copyConstruction(copy.construction);
  }
  if (isOpening(copy)) {
    const host = p.components.find((c) => c.id === copy.hostId);
    if (host?.type === 'exterior-wall' && copy.offsetM + 2 * copy.widthM + 0.3 <= sideLength(p, host.side)) copy.offsetM = Number((copy.offsetM + copy.widthM + 0.3).toFixed(6));
  }
  return { project: { ...next, isExample: false, components: [...p.components, copy] }, id: newIdValue };
}

/** Replaces one component (same id) with an edited version. */
export function updateComponent(p: BuildingProject, updated: Component): BuildingProject {
  if (!p.components.some((c) => c.id === updated.id)) return p;
  return { ...p, isExample: false, components: p.components.map((c) => (c.id === updated.id ? updated : c)) };
}

/** Shows or hides a component in the 3D view. Its data and results are not affected. */
export function setVisible(p: BuildingProject, id: string, visible: boolean): BuildingProject {
  return { ...p, components: p.components.map((c) => (c.id === id ? { ...c, visible } : c)) };
}

// ---- the example house ----------------------------------------------------------------------

export const EXAMPLE_NOTE =
  'Example house: an ILLUSTRATIVE, simplified single-storey house for trying the tool. Its dimensions, layers and conditions were chosen for demonstration; ' +
  'it is not a real or verified building, its material values are the illustrative built-in ones, and the windows and doors have NO U-values until you enter documented ones.';

/**
 * A simple single-storey house (10 m × 8 m × 2.8 m) with four walls, a flat roof, a ground floor,
 * one partition, windows, a glazed door and an opaque door. Uses the built-in (illustrative)
 * materials when they exist; a missing material is left unchosen.
 */
export function createExampleHouse(materials: readonly MaterialRecord[]): BuildingProject {
  const has = (id: string): string | null => (materials.some((m) => m.id === id) ? id : null);
  const layers = (spec: Array<[string, number]>): Construction => ({ layers: spec.map(([id, mm]) => ({ materialId: has(id), thicknessM: mm / 1000 })) });
  const wall = (id: string, side: Side): ExteriorWall => ({
    id, type: 'exterior-wall', name: `${SIDE_NAME[side]} wall`, visible: true, side, exposure: { kind: 'outside' },
    construction: layers([['gypsum-plaster', 15], ['clay-brick-solid', 200], ['eps-slab', 50], ['cement-plaster', 20]]),
  });
  const window = (id: string, name: string, hostId: string, offsetM: number, widthM: number, heightM: number, sillM: number, type: 'window' | 'glazed-door' = 'window'): Component => ({
    id, type, name, visible: true, hostId, offsetM, sillM, widthM, heightM, uValue: null, gValue: null, shadingFactor: null,
  });
  const components: Component[] = [
    wall('c1', 'north'),
    wall('c2', 'east'),
    wall('c3', 'south'),
    wall('c4', 'west'),
    { id: 'c5', type: 'roof', name: 'Flat roof', visible: true, form: 'flat', exposure: { kind: 'outside' }, construction: layers([['gypsum-plaster', 15], ['concrete-normal-weight', 200], ['xps-board', 50], ['cement-plaster', 20]]) },
    { id: 'c6', type: 'floor', name: 'Ground floor slab', visible: true, exposure: { kind: 'ground' }, construction: layers([['concrete-normal-weight', 150]]) },
    { id: 'c7', type: 'partition', name: 'Partition (living | bedrooms)', visible: true, positionM: 5, exposure: { kind: 'conditioned' }, construction: layers([['gypsum-plaster', 15], ['clay-brick-solid', 100], ['gypsum-plaster', 15]]) },
    window('c8', 'South window 1', 'c3', 1, 1.5, 1.2, 0.9),
    window('c9', 'South glazed door', 'c3', 4.1, 1.8, 2.2, 0, 'glazed-door'),
    window('c10', 'South window 2', 'c3', 7.5, 1.5, 1.2, 0.9),
    window('c11', 'North window', 'c1', 6, 1, 1, 1.2),
    window('c12', 'East window', 'c2', 3.4, 1.2, 1.2, 0.9),
    window('c13', 'West window', 'c4', 3.4, 1.2, 1.2, 0.9),
    { id: 'c14', type: 'door', name: 'Entrance door', visible: true, hostId: 'c1', offsetM: 2, widthM: 0.9, heightM: 2.1, spec: { kind: 'u-value', uValue: null } },
  ];
  return {
    name: 'Example house (illustrative)',
    isExample: true,
    geometry: { lengthM: 10, depthM: 8, heightM: 2.8 },
    conditions: { insideC: 26, outsideC: 35, durationH: 1, label: 'Illustrative hot-afternoon condition (not a Cyprus design value)' },
    components,
    nextId: 15,
  };
}
