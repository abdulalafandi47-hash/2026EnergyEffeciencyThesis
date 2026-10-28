/**
 * Three.js objects for the house view, built only from a HouseLayout (so the
 * picture always matches the model). Kept separate from the renderer so it can
 * be tested in Node with real Three.js objects.
 */
import * as THREE from 'three';
import { HOUSE_COLORS } from '../geometry';
import type { HouseKind, HouseLayout } from '../geometry';

export const HOUSE_EDGE_COLOR = 0x2b3138;
export const HOUSE_SELECTED_EDGE_COLOR = 0xff9f0a;
const SELECTED_EMISSIVE = 0x5a3200;

export interface HouseMeshData {
  boxId: string;
  componentId: string;
  kind: HouseKind;
  material: THREE.MeshStandardMaterial;
  edges: THREE.LineSegments;
}

export interface HouseScene {
  group: THREE.Group;
  meshes: Map<string, THREE.Mesh>;
  cube: THREE.BoxGeometry;
  edges: THREE.EdgesGeometry;
  selectedId: string | null;
  /** Colour per component id that replaces the element-type colour (e.g. heat-flux colours); null = type colours. */
  colours: Record<string, string> | null;
}

export function createHouseScene(): HouseScene {
  const cube = new THREE.BoxGeometry(1, 1, 1);
  return { group: new THREE.Group(), meshes: new Map(), cube, edges: new THREE.EdgesGeometry(cube), selectedId: null, colours: null };
}

const dataOf = (mesh: THREE.Mesh): HouseMeshData => mesh.userData as HouseMeshData;
const isGlass = (kind: HouseKind): boolean => kind === 'window' || kind === 'glazed-door';

function clearMeshes(scene: HouseScene): void {
  for (const mesh of scene.meshes.values()) {
    scene.group.remove(mesh);
    const data = dataOf(mesh);
    data.material.dispose();
    (data.edges.material as THREE.Material).dispose();
  }
  scene.meshes.clear();
}

/** Rebuilds every box from the layout (a house has few boxes, so a full rebuild is simple and exact). */
export function syncHouseScene(scene: HouseScene, layout: HouseLayout): void {
  clearMeshes(scene);
  for (const box of layout.boxes) {
    const glass = isGlass(box.kind);
    const material = new THREE.MeshStandardMaterial({ color: HOUSE_COLORS[box.kind], roughness: glass ? 0.15 : 0.85, metalness: 0, transparent: glass, opacity: glass ? 0.55 : 1 });
    const mesh = new THREE.Mesh(scene.cube, material);
    mesh.scale.set(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]);
    mesh.position.set((box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, (box.min[2] + box.max[2]) / 2);
    const edges = new THREE.LineSegments(scene.edges, new THREE.LineBasicMaterial({ color: HOUSE_EDGE_COLOR }));
    mesh.add(edges);
    const data: HouseMeshData = { boxId: box.id, componentId: box.componentId, kind: box.kind, material, edges };
    mesh.userData = data;
    mesh.name = box.id;
    scene.group.add(mesh);
    scene.meshes.set(box.id, mesh);
  }
  applyHouseLook(scene);
}

/** Colours and highlight: the selected component glows and gets orange edges. */
function applyHouseLook(scene: HouseScene): void {
  for (const mesh of scene.meshes.values()) {
    const data = dataOf(mesh);
    const selected = data.componentId === scene.selectedId;
    data.material.color.set(scene.colours?.[data.componentId] ?? HOUSE_COLORS[data.kind]);
    data.material.emissive.setHex(selected ? SELECTED_EMISSIVE : 0x000000);
    (data.edges.material as THREE.LineBasicMaterial).color.setHex(selected ? HOUSE_SELECTED_EDGE_COLOR : HOUSE_EDGE_COLOR);
    mesh.renderOrder = isGlass(data.kind) ? 2 : 0;
  }
}

export function setHouseSelection(scene: HouseScene, componentId: string | null): void {
  scene.selectedId = componentId;
  applyHouseLook(scene);
}

export function setHouseColours(scene: HouseScene, colours: Record<string, string> | null): void {
  scene.colours = colours;
  applyHouseLook(scene);
}

/** Component under a ray (nearest box), or null. */
export function pickHouse(scene: HouseScene, raycaster: THREE.Raycaster): string | null {
  const hit = raycaster.intersectObjects([...scene.meshes.values()], false)[0];
  return hit ? dataOf(hit.object as THREE.Mesh).componentId : null;
}

export function disposeHouseScene(scene: HouseScene): void {
  clearMeshes(scene);
  scene.cube.dispose();
  scene.edges.dispose();
}
