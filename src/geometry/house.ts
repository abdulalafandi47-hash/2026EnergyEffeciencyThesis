/**
 * 3D geometry of the parametric house: plain arithmetic (no 3D library, no DOM).
 *
 * Coordinates (metres): x east, y up, z SOUTH (so north is −z). The footprint is
 * centred on the origin and the floor surface is at y = 0. The outer faces of
 * the walls lie on the footprint's edges (external dimensions); walls are drawn
 * inwards with their construction thickness. North and south walls run the full
 * length; east and west walls fit between them.
 *
 * Openings are real holes: a wall with openings is drawn as rectangular pieces
 * around them, and each opening is a thin pane in its hole.
 *
 * An opening's position is measured along its wall from the wall's LEFT end as
 * seen from OUTSIDE, and its sill from the floor.
 */
import type { AxesSpec, AxisSpec } from './axes';

export type HouseSide = 'north' | 'east' | 'south' | 'west';
export type HouseKind = 'exterior-wall' | 'partition' | 'roof' | 'floor' | 'window' | 'glazed-door' | 'door';

/** Thickness used to DRAW an element whose construction thickness is not known yet (stated on screen). */
export const NOMINAL_THICKNESS_M = 0.2;

export interface HouseSpec {
  lengthM: number;
  depthM: number;
  heightM: number;
  walls: Array<{ id: string; side: HouseSide; thicknessM: number | null; visible: boolean }>;
  openings: Array<{ id: string; hostId: string; kind: 'window' | 'glazed-door' | 'door'; offsetM: number; sillM: number; widthM: number; heightM: number; visible: boolean }>;
  roof: { id: string; thicknessM: number | null; visible: boolean } | null;
  floor: { id: string; thicknessM: number | null; visible: boolean } | null;
  partitions: Array<{ id: string; positionM: number; thicknessM: number | null; visible: boolean }>;
}

export interface HouseBox {
  /** Unique id of this box (a wall can have several pieces). */
  id: string;
  /** The building component it belongs to. */
  componentId: string;
  kind: HouseKind;
  min: [number, number, number];
  max: [number, number, number];
}

export interface HouseLayout {
  boxes: HouseBox[];
  lengthM: number;
  depthM: number;
  heightM: number;
  /** Ids of drawn components whose thickness is not known and is drawn with NOMINAL_THICKNESS_M. */
  nominalThickness: string[];
  /** Point the camera looks at. */
  center: [number, number, number];
  /** Radius of a sphere around `center` containing everything drawn. */
  boundingRadius: number;
  /** y of the lowest drawn point (for the ground grid). */
  groundY: number;
}

export const HOUSE_COLORS: Record<HouseKind, string> = {
  'exterior-wall': '#b9b2a6',
  partition: '#d8cdb8',
  roof: '#8f8a83',
  floor: '#6f6a64',
  window: '#7fb7e6',
  'glazed-door': '#7fb7e6',
  door: '#8a5a3c',
};

const PANE_M = { window: 0.04, 'glazed-door': 0.04, door: 0.06 } as const;

interface Frame {
  /** World point of u = 0 on the outer face at floor level. */
  origin: [number, number, number];
  /** Unit vector along the wall (u). */
  along: [number, number, number];
  /** Unit vector pointing INTO the house (depth). */
  inward: [number, number, number];
  length: number;
}

/** The wall frame of a side: u runs from the left end as seen from outside. */
export function wallFrame(side: HouseSide, lengthM: number, depthM: number): Frame {
  const L = lengthM / 2;
  const D = depthM / 2;
  switch (side) {
    case 'south':
      return { origin: [-L, 0, D], along: [1, 0, 0], inward: [0, 0, -1], length: lengthM };
    case 'north':
      return { origin: [L, 0, -D], along: [-1, 0, 0], inward: [0, 0, 1], length: lengthM };
    case 'east':
      return { origin: [L, 0, D], along: [0, 0, -1], inward: [-1, 0, 0], length: depthM };
    case 'west':
      return { origin: [-L, 0, -D], along: [0, 0, 1], inward: [1, 0, 0], length: depthM };
  }
}

/** World box of a rectangle (u0..u1 along, v0..v1 up, d0..d1 inwards from the outer face) of a wall frame. */
function frameBox(f: Frame, u0: number, u1: number, v0: number, v1: number, d0: number, d1: number): { min: [number, number, number]; max: [number, number, number] } {
  const corners: Array<[number, number, number]> = [];
  for (const u of [u0, u1]) for (const d of [d0, d1]) for (const v of [v0, v1]) {
    corners.push([f.origin[0] + f.along[0] * u + f.inward[0] * d, f.origin[1] + v, f.origin[2] + f.along[2] * u + f.inward[2] * d]);
  }
  const min = [0, 1, 2].map((k) => Math.min(...corners.map((c) => c[k] as number))) as [number, number, number];
  const max = [0, 1, 2].map((k) => Math.max(...corners.map((c) => c[k] as number))) as [number, number, number];
  return { min, max };
}

/**
 * Splits the wall rectangle [uMin, uMax] × [0, height] into rectangles that avoid the openings.
 * Cells of the grid formed by all opening edges are kept when their centre is not inside an opening,
 * then merged along each row.
 */
export function wallPieces(uMin: number, uMax: number, height: number, holes: Array<{ u0: number; u1: number; v0: number; v1: number }>): Array<{ u0: number; u1: number; v0: number; v1: number }> {
  const clip = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
  const us = [...new Set([uMin, uMax, ...holes.flatMap((h) => [clip(h.u0, uMin, uMax), clip(h.u1, uMin, uMax)])])].sort((a, b) => a - b);
  const vs = [...new Set([0, height, ...holes.flatMap((h) => [clip(h.v0, 0, height), clip(h.v1, 0, height)])])].sort((a, b) => a - b);
  const pieces: Array<{ u0: number; u1: number; v0: number; v1: number }> = [];
  for (let j = 0; j + 1 < vs.length; j++) {
    const v0 = vs[j] as number;
    const v1 = vs[j + 1] as number;
    if (v1 - v0 <= 1e-9) continue;
    let current: { u0: number; u1: number; v0: number; v1: number } | null = null;
    for (let i = 0; i + 1 < us.length; i++) {
      const u0 = us[i] as number;
      const u1 = us[i + 1] as number;
      if (u1 - u0 <= 1e-9) continue;
      const cu = (u0 + u1) / 2;
      const cv = (v0 + v1) / 2;
      const inHole = holes.some((h) => cu > h.u0 && cu < h.u1 && cv > h.v0 && cv < h.v1);
      if (inHole) {
        if (current) pieces.push(current);
        current = null;
      } else if (current && Math.abs(current.u1 - u0) < 1e-9) {
        current.u1 = u1;
      } else {
        if (current) pieces.push(current);
        current = { u0, u1, v0, v1 };
      }
    }
    if (current) pieces.push(current);
  }
  return pieces;
}

export function layoutHouse(spec: HouseSpec): HouseLayout {
  const { lengthM: Lx, depthM: Dz, heightM: H } = spec;
  const nominal = new Set<string>();
  const drawnT = (t: number | null): number => (t !== null && t > 0 ? t : NOMINAL_THICKNESS_M);
  /** Thickness of a component being DRAWN (recorded if it is only nominal). */
  const thick = (id: string, t: number | null): number => {
    if (!(t !== null && t > 0)) nominal.add(id);
    return drawnT(t);
  };
  const wallBySide = new Map(spec.walls.map((w) => [w.side, w]));
  /** Thickness of the wall on a side, for fitting the other walls and partitions against it (0 if there is none). */
  const tOf = (side: HouseSide): number => {
    const w = wallBySide.get(side);
    return w ? drawnT(w.thicknessM) : 0;
  };
  const boxes: HouseBox[] = [];

  for (const w of spec.walls) {
    if (!w.visible) continue;
    const f = wallFrame(w.side, Lx, Dz);
    const t = thick(w.id, w.thicknessM);
    // East and west walls fit between the north and south walls.
    const [uMin, uMax] = w.side === 'east' ? [tOf('south'), f.length - tOf('north')] : w.side === 'west' ? [tOf('north'), f.length - tOf('south')] : [0, f.length];
    const openings = spec.openings.filter((o) => o.hostId === w.id);
    const holes = openings.map((o) => ({ u0: o.offsetM, u1: o.offsetM + o.widthM, v0: o.sillM, v1: o.sillM + o.heightM }));
    wallPieces(uMin, uMax, H, holes).forEach((p, i) => boxes.push({ id: `${w.id}#${i}`, componentId: w.id, kind: 'exterior-wall', ...frameBox(f, p.u0, p.u1, p.v0, p.v1, 0, t) }));
    for (const o of openings) {
      if (!o.visible) continue;
      const pane = PANE_M[o.kind];
      boxes.push({ id: o.id, componentId: o.id, kind: o.kind, ...frameBox(f, o.offsetM, o.offsetM + o.widthM, o.sillM, o.sillM + o.heightM, t / 2 - pane / 2, t / 2 + pane / 2) });
    }
  }
  const roofT = spec.roof ? thick(spec.roof.id, spec.roof.thicknessM) : 0;
  if (spec.roof?.visible) boxes.push({ id: spec.roof.id, componentId: spec.roof.id, kind: 'roof', min: [-Lx / 2, H, -Dz / 2], max: [Lx / 2, H + roofT, Dz / 2] });
  const floorT = spec.floor ? thick(spec.floor.id, spec.floor.thicknessM) : 0;
  if (spec.floor?.visible) boxes.push({ id: spec.floor.id, componentId: spec.floor.id, kind: 'floor', min: [-Lx / 2, -floorT, -Dz / 2], max: [Lx / 2, 0, Dz / 2] });
  for (const p of spec.partitions) {
    if (!p.visible) continue;
    const t = thick(p.id, p.thicknessM);
    const x = -Lx / 2 + p.positionM;
    boxes.push({ id: p.id, componentId: p.id, kind: 'partition', min: [x - t / 2, 0, -Dz / 2 + tOf('north')], max: [x + t / 2, H, Dz / 2 - tOf('south')] });
  }
  const top = H + roofT;
  const bottom = -floorT;
  return {
    boxes,
    lengthM: Lx,
    depthM: Dz,
    heightM: H,
    nominalThickness: [...nominal],
    center: [0, (top + bottom) / 2, 0],
    boundingRadius: Math.hypot(Lx / 2, (top - bottom) / 2, Dz / 2),
    groundY: bottom,
  };
}

export const HOUSE_AXES: readonly AxisSpec[] = [
  { id: 'x', direction: [1, 0, 0], color: '#e5534b', label: 'x', meaning: 'east' },
  { id: 'y', direction: [0, 1, 0], color: '#57ab5a', label: 'y', meaning: 'up' },
  { id: 'z', direction: [0, 0, 1], color: '#539bf5', label: 'z', meaning: 'south' },
];

/** Axes at the south-west corner of the footprint, at floor level. */
export function houseAxesSpec(layout: HouseLayout): AxesSpec {
  return { origin: [-layout.lengthM / 2, 0, layout.depthM / 2], lengthM: 0.15 * Math.min(layout.lengthM, layout.depthM), axes: HOUSE_AXES };
}
