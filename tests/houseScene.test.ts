/** The house scene with real Three.js objects (no WebGL needed). */
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { fluxColor, HOUSE_COLORS, layoutHouse, NOT_CALCULATED_COLOR } from '../src/geometry';
import type { HouseSpec } from '../src/geometry';
import { createHouseScene, disposeHouseScene, HOUSE_SELECTED_EDGE_COLOR, pickHouse, setHouseColours, setHouseSelection, syncHouseScene } from '../src/viewer3d/houseScene';
import type { HouseMeshData } from '../src/viewer3d/houseScene';
import { expectClose } from './helpers/helpers';

const spec: HouseSpec = {
  lengthM: 10, depthM: 8, heightM: 3,
  walls: [{ id: 's', side: 'south', thicknessM: 0.3, visible: true }, { id: 'n', side: 'north', thicknessM: 0.3, visible: true }],
  openings: [{ id: 'win', hostId: 's', kind: 'window', offsetM: 4, sillM: 1, widthM: 2, heightM: 1, visible: true }],
  roof: { id: 'r', thicknessM: 0.2, visible: true },
  floor: null,
  partitions: [],
};
const dataOf = (m: THREE.Mesh) => m.userData as HouseMeshData;

describe('house scene', () => {
  it('one mesh per layout box, sized and placed exactly', () => {
    const layout = layoutHouse(spec);
    const scene = createHouseScene();
    syncHouseScene(scene, layout);
    expect(scene.meshes.size).toBe(layout.boxes.length);
    for (const box of layout.boxes) {
      const mesh = scene.meshes.get(box.id) as THREE.Mesh;
      expectClose(mesh.scale.x, box.max[0] - box.min[0], 1e-12);
      expectClose(mesh.position.y, (box.min[1] + box.max[1]) / 2, 1e-12);
      expect(dataOf(mesh).componentId).toBe(box.componentId);
    }
    disposeHouseScene(scene);
  });

  it('glazing is transparent; walls are opaque and use the element colours', () => {
    const scene = createHouseScene();
    syncHouseScene(scene, layoutHouse(spec));
    const glass = scene.meshes.get('win') as THREE.Mesh;
    expect(dataOf(glass).material.transparent).toBe(true);
    expect(dataOf(glass).material.opacity).toBeLessThan(1);
    const wallPiece = [...scene.meshes.values()].find((m) => dataOf(m).componentId === 's') as THREE.Mesh;
    expect(dataOf(wallPiece).material.transparent).toBe(false);
    expect(`#${dataOf(wallPiece).material.color.getHexString()}`).toBe(HOUSE_COLORS['exterior-wall']);
  });

  it('selecting a wall highlights ALL its pieces (around the window), and nothing else', () => {
    const scene = createHouseScene();
    syncHouseScene(scene, layoutHouse(spec));
    setHouseSelection(scene, 's');
    const pieces = [...scene.meshes.values()].filter((m) => dataOf(m).componentId === 's');
    expect(pieces.length).toBeGreaterThan(1);
    for (const m of scene.meshes.values()) {
      const selected = dataOf(m).componentId === 's';
      expect((dataOf(m).edges.material as THREE.LineBasicMaterial).color.getHex() === HOUSE_SELECTED_EDGE_COLOR).toBe(selected);
      expect(dataOf(m).material.emissive.getHex() !== 0).toBe(selected);
    }
    // The selection survives a rebuild (e.g. after an edit).
    syncHouseScene(scene, layoutHouse({ ...spec, heightM: 3.2 }));
    expect([...scene.meshes.values()].filter((m) => dataOf(m).componentId === 's').every((m) => dataOf(m).material.emissive.getHex() !== 0)).toBe(true);
  });

  it('colour overrides (heat-flux view) apply per component and can be removed', () => {
    const scene = createHouseScene();
    syncHouseScene(scene, layoutHouse(spec));
    setHouseColours(scene, { s: fluxColor(1), r: NOT_CALCULATED_COLOR });
    const colourOf = (id: string): string => `#${dataOf([...scene.meshes.values()].find((m) => dataOf(m).componentId === id) as THREE.Mesh).material.color.getHexString()}`;
    expect(colourOf('s')).toBe(fluxColor(1));
    expect(colourOf('r')).toBe(NOT_CALCULATED_COLOR);
    expect(colourOf('n')).toBe(HOUSE_COLORS['exterior-wall']); // not in the map: type colour
    setHouseColours(scene, null);
    expect(colourOf('s')).toBe(HOUSE_COLORS['exterior-wall']);
  });

  it('a ray from the south hits the window where it is, and the wall beside it', () => {
    const scene = createHouseScene();
    syncHouseScene(scene, layoutHouse(spec));
    scene.group.updateMatrixWorld(true);
    const ray = (x: number, y: number): string | null => pickHouse(scene, new THREE.Raycaster(new THREE.Vector3(x, y, 20), new THREE.Vector3(0, 0, -1)));
    expect(ray(0, 1.5)).toBe('win'); // window spans x −1…1, y 1…2 on the south wall
    expect(ray(3, 1.5)).toBe('s');
    expect(ray(30, 1.5)).toBeNull();
  });

  it('heat-flux colour scale: low dark blue, high yellow, NaN in the middle', () => {
    expect(fluxColor(0)).toBe('#31688e');
    expect(fluxColor(1)).toBe('#fde725');
    expect(fluxColor(Number.NaN)).toBe(fluxColor(0.5));
    expect(fluxColor(5)).toBe(fluxColor(1));
  });
});
