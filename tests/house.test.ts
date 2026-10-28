/**
 * 3D geometry of the parametric house (pure arithmetic): wall pieces around openings,
 * the side conventions, corners, hidden components.
 */
import { describe, expect, it } from 'vitest';
import { houseAxesSpec, layoutHouse, NOMINAL_THICKNESS_M, wallFrame, wallPieces } from '../src/geometry';
import type { HouseBox, HouseSpec } from '../src/geometry';
import { expectClose } from './helpers/helpers';

const area = (p: { u0: number; u1: number; v0: number; v1: number }): number => (p.u1 - p.u0) * (p.v1 - p.v0);
const size = (b: HouseBox, k: 0 | 1 | 2): number => b.max[k] - b.min[k];

function spec(overrides: Partial<HouseSpec> = {}): HouseSpec {
  return {
    lengthM: 10, depthM: 8, heightM: 3,
    walls: [
      { id: 'n', side: 'north', thicknessM: 0.3, visible: true },
      { id: 'e', side: 'east', thicknessM: 0.3, visible: true },
      { id: 's', side: 'south', thicknessM: 0.3, visible: true },
      { id: 'w', side: 'west', thicknessM: 0.3, visible: true },
    ],
    openings: [],
    roof: { id: 'r', thicknessM: 0.25, visible: true },
    floor: { id: 'f', thicknessM: 0.15, visible: true },
    partitions: [],
    ...overrides,
  };
}

describe('wallPieces: rectangles that fill a wall around its openings', () => {
  it('a wall without openings is one piece', () => {
    expect(wallPieces(0, 10, 3, [])).toEqual([{ u0: 0, u1: 10, v0: 0, v1: 3 }]);
  });

  it('pieces cover exactly the wall area minus the openings, and never touch an opening', () => {
    let seed = 99;
    const random = (): number => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
    for (let n = 0; n < 200; n++) {
      // Up to three non-overlapping openings in separate thirds of the wall.
      const holes = [0, 1, 2].filter(() => random() < 0.7).map((k) => {
        const u0 = k * 3.3 + 0.1 + random() * 1;
        const v0 = random() * 1.5;
        return { u0, u1: u0 + 0.3 + random() * 1.8, v0, v1: v0 + 0.3 + random() * 1.2 }; // inside the 3 m height, no overlap between thirds
      });
      const pieces = wallPieces(0, 10, 3, holes);
      expectClose(pieces.reduce((s, p) => s + area(p), 0), 30 - holes.reduce((s, h) => s + area(h), 0), 1e-9);
      for (const p of pieces) for (const h of holes) {
        const overlap = Math.max(0, Math.min(p.u1, h.u1) - Math.max(p.u0, h.u0)) * Math.max(0, Math.min(p.v1, h.v1) - Math.max(p.v0, h.v0));
        expect(overlap).toBeLessThan(1e-12);
      }
    }
  });

  it('a door from the floor leaves pieces left, right and above it', () => {
    const pieces = wallPieces(0, 10, 3, [{ u0: 4, u1: 5, v0: 0, v1: 2.1 }]);
    expectClose(pieces.reduce((s, p) => s + area(p), 0), 30 - 2.1, 1e-12);
    expect(pieces.some((p) => p.v0 === 2.1 && p.u0 === 0 && p.u1 === 10)).toBe(true);
  });
});

describe('side conventions: positions are measured from the left end as seen from outside', () => {
  it('south from the west end, north from the east end, east from the south end, west from the north end', () => {
    expect(wallFrame('south', 10, 8)).toMatchObject({ origin: [-5, 0, 4], along: [1, 0, 0], inward: [0, 0, -1], length: 10 });
    expect(wallFrame('north', 10, 8)).toMatchObject({ origin: [5, 0, -4], along: [-1, 0, 0], inward: [0, 0, 1], length: 10 });
    expect(wallFrame('east', 10, 8)).toMatchObject({ origin: [5, 0, 4], along: [0, 0, -1], inward: [-1, 0, 0], length: 8 });
    expect(wallFrame('west', 10, 8)).toMatchObject({ origin: [-5, 0, -4], along: [0, 0, 1], inward: [1, 0, 0], length: 8 });
  });

  it('a window 1 m from the left end lands where expected on each side', () => {
    const cases = [
      ['n', 'x', 5 - 1 - 1.5, 5 - 1],
      ['s', 'x', -5 + 1, -5 + 1 + 1.5],
      ['e', 'z', 4 - 1 - 1.5, 4 - 1],
      ['w', 'z', -4 + 1, -4 + 1 + 1.5],
    ] as const;
    for (const [host, axis, lo, hi] of cases) {
      const layout = layoutHouse(spec({ openings: [{ id: 'o', hostId: host, kind: 'window', offsetM: 1, sillM: 1, widthM: 1.5, heightM: 1.2, visible: true }] }));
      const pane = layout.boxes.find((b) => b.id === 'o') as HouseBox;
      const k = axis === 'x' ? 0 : 2;
      expectClose(pane.min[k], lo, 1e-12);
      expectClose(pane.max[k], hi, 1e-12);
      expectClose(pane.min[1], 1, 1e-12);
      expectClose(pane.max[1], 2.2, 1e-12);
    }
  });
});

describe('layoutHouse', () => {
  it('outer wall faces lie on the footprint; east and west walls fit between north and south', () => {
    const layout = layoutHouse(spec());
    const of = (id: string): HouseBox[] => layout.boxes.filter((b) => b.componentId === id);
    const [south] = of('s');
    const [east] = of('e');
    expect(south?.max[2]).toBe(4);
    expectClose(south?.min[2] ?? NaN, 3.7, 1e-12);
    expect(south?.min[0]).toBe(-5);
    expect(south?.max[0]).toBe(5);
    expect(east?.max[0]).toBe(5);
    expectClose(east?.min[2] ?? NaN, -3.7, 1e-12);
    expectClose(east?.max[2] ?? NaN, 3.7, 1e-12);
  });

  it('the drawn wall volume equals its pieces: opening holes are really missing', () => {
    const openings = [{ id: 'o', hostId: 's', kind: 'window' as const, offsetM: 2, sillM: 1, widthM: 2, heightM: 1, visible: true }];
    const layout = layoutHouse(spec({ openings }));
    const volume = layout.boxes.filter((b) => b.componentId === 's').reduce((s, b) => s + size(b, 0) * size(b, 1) * size(b, 2), 0);
    expectClose(volume, (30 - 2) * 0.3, 1e-9);
    const pane = layout.boxes.find((b) => b.id === 'o') as HouseBox;
    expect(pane.min[2]).toBeGreaterThan(3.7); // the pane sits inside the wall's depth
    expect(pane.max[2]).toBeLessThan(4);
  });

  it('roof on top, floor below y = 0, partition at its position from the west face', () => {
    const layout = layoutHouse(spec({ partitions: [{ id: 'p', positionM: 4, thicknessM: 0.1, visible: true }] }));
    const box = (id: string) => layout.boxes.find((b) => b.componentId === id) as HouseBox;
    expect(box('r').min[1]).toBe(3);
    expectClose(box('r').max[1], 3.25, 1e-12);
    expectClose(box('f').min[1], -0.15, 1e-12);
    expect(box('f').max[1]).toBe(0);
    expectClose((box('p').min[0] + box('p').max[0]) / 2, -1, 1e-12);
    expectClose(layout.groundY, -0.15, 1e-12);
  });

  it('hidden components are not drawn (and openings of a hidden wall neither); the layout says which thicknesses are nominal', () => {
    const layout = layoutHouse(spec({
      walls: [{ id: 's', side: 'south', thicknessM: null, visible: false }, { id: 'n', side: 'north', thicknessM: 0.3, visible: true }],
      openings: [{ id: 'o', hostId: 's', kind: 'window', offsetM: 1, sillM: 1, widthM: 1, heightM: 1, visible: true }],
      roof: { id: 'r', thicknessM: null, visible: true },
      floor: null,
    }));
    expect(layout.boxes.some((b) => b.componentId === 's' || b.id === 'o')).toBe(false);
    expect(layout.nominalThickness).toEqual(['r']); // the hidden wall is not drawn, so it is not listed
    const roof = layout.boxes.find((b) => b.componentId === 'r') as HouseBox;
    expectClose(size(roof, 1), NOMINAL_THICKNESS_M, 1e-12);
  });

  it('every box has positive size and finite coordinates; the bounding sphere contains every corner', () => {
    const layout = layoutHouse(spec({
      openings: [
        { id: 'a', hostId: 'n', kind: 'door', offsetM: 2, sillM: 0, widthM: 0.9, heightM: 2.1, visible: true },
        { id: 'b', hostId: 'e', kind: 'glazed-door', offsetM: 3, sillM: 0, widthM: 1.8, heightM: 2.2, visible: true },
      ],
      partitions: [{ id: 'p', positionM: 5, thicknessM: 0.13, visible: true }],
    }));
    for (const b of layout.boxes) {
      for (const k of [0, 1, 2] as const) expect(size(b, k)).toBeGreaterThan(0);
      for (const x of [...b.min, ...b.max, layout.boundingRadius]) expect(Number.isFinite(x)).toBe(true);
      for (const corner of [[b.min[0], b.min[1], b.min[2]], [b.max[0], b.max[1], b.max[2]]]) {
        expect(Math.hypot(...corner.map((c, k) => c - (layout.center[k] as number)))).toBeLessThanOrEqual(layout.boundingRadius + 1e-9);
      }
    }
  });

  it('axes start at the south-west floor corner: x east, y up, z south', () => {
    const a = houseAxesSpec(layoutHouse(spec()));
    expect(a.origin).toEqual([-5, 0, 4]);
    expect(a.axes.map((x) => `${x.label} ${x.meaning}`)).toEqual(['x east', 'y up', 'z south']);
  });
});
