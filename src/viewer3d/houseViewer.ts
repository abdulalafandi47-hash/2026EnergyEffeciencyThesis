/**
 * The interactive 3D view of the house: renderer, camera, orbit/pan/zoom,
 * standard architectural views, click-to-select, ground grid, axes and compass
 * labels. The boxes come from houseScene.ts, driven only by a HouseLayout.
 * Rendering is on demand (a frame is drawn only when something changes).
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { houseAxesSpec } from '../geometry';
import type { HouseLayout } from '../geometry';
import { createHouseScene, disposeHouseScene, pickHouse, setHouseColours, setHouseSelection, syncHouseScene } from './houseScene';
import { buildAxes, buildGround, disposeAxes } from './sceneBuilder';
import type { NavigationMode } from './types';

export type HouseViewPreset = 'iso-se' | 'iso-sw' | 'iso-ne' | 'iso-nw' | 'top' | 'north' | 'east' | 'south' | 'west';

export interface HouseViewerHandlers {
  /** A click on a component (its id), or on empty space (null). */
  onSelect?: (componentId: string | null) => void;
}

export interface HouseViewer {
  update(layout: HouseLayout): void;
  select(componentId: string | null): void;
  /** Colour per component (e.g. by heat flux), or null for the element-type colours. */
  setColours(colours: Record<string, string> | null): void;
  setView(preset: HouseViewPreset): void;
  setGridVisible(visible: boolean): void;
  setAxesVisible(visible: boolean): void;
  setNavigationMode(mode: NavigationMode): void;
  zoom(factor: number): void;
  destroy(): void;
}

export type HouseViewerFactory = (container: HTMLElement, handlers: HouseViewerHandlers) => Promise<HouseViewer | null>;

const FOV_DEGREES = 40;
/** Direction from the house centre to the camera (x east, y up, z south). */
const VIEWS: Record<HouseViewPreset, [number, number, number]> = {
  'iso-se': [1, 0.75, 1],
  'iso-sw': [-1, 0.75, 1],
  'iso-ne': [1, 0.75, -1],
  'iso-nw': [-1, 0.75, -1],
  top: [0, 1, 0.0175], // 1° off vertical so "up" stays defined; north is at the top of the picture
  north: [0, 0.12, -1],
  east: [1, 0.12, 0],
  south: [0, 0.12, 1],
  west: [-1, 0.12, 0],
};

function el(tag: 'div', className: string, text: string): HTMLDivElement {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

export function createHouseViewer(container: HTMLElement, handlers: HouseViewerHandlers = {}): HouseViewer | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    return null;
  }
  const canvas = renderer.domElement;
  canvas.className = 'viewer-canvas';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', '3D model of the building envelope (not drawn yet)');
  const overlay = el('div', 'viewer-overlay', '');
  overlay.setAttribute('aria-hidden', 'true');
  container.append(canvas, overlay);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(4, 8, 6);
  const fill = new THREE.DirectionalLight(0xffffff, 0.9);
  fill.position.set(-5, 3, -4);
  scene.add(sun, fill);
  const house = createHouseScene();
  scene.add(house.group);

  const camera = new THREE.PerspectiveCamera(FOV_DEGREES, 1, 0.05, 500);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false;
  controls.screenSpacePanning = true;

  let layout: HouseLayout | null = null;
  let grid: THREE.GridHelper | null = null;
  let axes: THREE.Group | null = null;
  let gridVisible = true;
  let axesVisible = true;
  let frame = 0;
  let destroyed = false;
  let navigationMode: NavigationMode = 'orbit';

  const compass = (['N', 'E', 'S', 'W'] as const).map((letter) => {
    const label = el('div', `viewer-compass viewer-compass-${letter}`, letter);
    overlay.append(label);
    return label;
  });
  const axisLabels = ['x', 'y', 'z'].map((letter) => {
    const label = el('div', `viewer-axis viewer-axis-${letter}`, letter);
    overlay.append(label);
    return label;
  });

  function requestRender(): void {
    if (!frame && !destroyed) frame = requestAnimationFrame(() => {
      frame = 0;
      if (destroyed) return;
      renderer.render(scene, camera);
      placeLabels();
    });
  }

  const projected = new THREE.Vector3();
  function toScreen(x: number, y: number, z: number): { x: number; y: number } | null {
    projected.set(x, y, z).project(camera);
    if (projected.z > 1) return null;
    return { x: ((projected.x + 1) / 2) * canvas.clientWidth, y: ((1 - projected.y) / 2) * canvas.clientHeight };
  }
  const place = (label: HTMLElement, point: { x: number; y: number } | null): void => {
    label.hidden = point === null;
    if (point) label.style.transform = `translate(${Math.round(point.x)}px, ${Math.round(point.y)}px) translate(-50%, -50%)`;
  };

  function placeLabels(): void {
    if (!layout) return;
    const L = layout.lengthM / 2 + 0.12 * Math.max(layout.lengthM, layout.depthM);
    const D = layout.depthM / 2 + 0.12 * Math.max(layout.lengthM, layout.depthM);
    const y = layout.groundY;
    const points: Array<[number, number, number]> = [[0, y, -D], [L, y, 0], [0, y, D], [-L, y, 0]];
    // A label straight behind the house (seen in an elevation) would be drawn on top of it: hide it.
    const view = camera.position.clone().sub(controls.target);
    const across = Math.hypot(view.x, view.z);
    compass.forEach((label, i) => {
      const p = points[i] as [number, number, number];
      const behind = across > 0.5 * view.length() && (p[0] * view.x + p[2] * view.z) / (Math.hypot(p[0], p[2]) * across) < -0.9;
      place(label, behind ? null : toScreen(p[0], p[1], p[2]));
    });
    const spec = houseAxesSpec(layout);
    spec.axes.forEach((axis, i) => {
      const reach = spec.lengthM * 1.2;
      place(axisLabels[i] as HTMLElement, axesVisible ? toScreen(spec.origin[0] + axis.direction[0] * reach, spec.origin[1] + axis.direction[1] * reach, spec.origin[2] + axis.direction[2] * reach) : null);
    });
  }

  function resize(): void {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width === 0 || height === 0) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    requestRender();
  }

  function fitDistance(): number {
    const radius = layout?.boundingRadius ?? 5;
    const verticalHalf = THREE.MathUtils.degToRad(FOV_DEGREES) / 2;
    const horizontalHalf = Math.atan(Math.tan(verticalHalf) * camera.aspect);
    return (radius / Math.sin(Math.min(verticalHalf, horizontalHalf))) * 1.02;
  }

  function setView(preset: HouseViewPreset): void {
    const center = new THREE.Vector3(...(layout?.center ?? [0, 0, 0]));
    const direction = new THREE.Vector3(...VIEWS[preset]).normalize();
    controls.target.copy(center);
    camera.position.copy(center).add(direction.multiplyScalar(fitDistance()));
    camera.up.set(0, 1, 0);
    camera.lookAt(center);
    const radius = layout?.boundingRadius ?? 5;
    controls.minDistance = radius * 0.2;
    controls.maxDistance = radius * 12;
    camera.near = Math.max(0.01, radius / 300);
    camera.far = radius * 60;
    camera.updateProjectionMatrix();
    controls.update();
    requestRender();
  }

  function orbit(deltaAzimuth: number, deltaPolar: number, zoom = 1): void {
    const offset = camera.position.clone().sub(controls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    spherical.theta += deltaAzimuth;
    spherical.phi = THREE.MathUtils.clamp(spherical.phi + deltaPolar, 0.05, Math.PI - 0.05);
    spherical.radius = THREE.MathUtils.clamp(spherical.radius * zoom, controls.minDistance, controls.maxDistance);
    offset.setFromSpherical(spherical);
    camera.position.copy(controls.target).add(offset);
    camera.lookAt(controls.target);
    controls.update();
    requestRender();
  }
  const STEP = THREE.MathUtils.degToRad(6);
  const keys: Record<string, () => void> = {
    ArrowLeft: () => orbit(-STEP, 0),
    ArrowRight: () => orbit(STEP, 0),
    ArrowUp: () => orbit(0, -STEP),
    ArrowDown: () => orbit(0, STEP),
    '+': () => orbit(0, 0, 0.88),
    '=': () => orbit(0, 0, 0.88),
    '-': () => orbit(0, 0, 1 / 0.88),
    Home: () => setView('iso-se'),
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    const action = keys[event.key];
    if (action && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      action();
    }
  };
  canvas.addEventListener('keydown', onKeyDown);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let downAt: { x: number; y: number } | null = null;
  const componentAt = (clientX: number, clientY: number): string | null => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -(((clientY - rect.top) / rect.height) * 2 - 1));
    raycaster.setFromCamera(pointer, camera);
    return pickHouse(house, raycaster);
  };
  const onPointerDown = (e: PointerEvent): void => void (downAt = { x: e.clientX, y: e.clientY });
  const onPointerUp = (e: PointerEvent): void => {
    const start = downAt;
    downAt = null;
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 5) handlers.onSelect?.(componentAt(e.clientX, e.clientY));
  };
  const onPointerMove = (e: PointerEvent): void => {
    if (e.buttons === 0) canvas.style.cursor = componentAt(e.clientX, e.clientY) ? 'pointer' : navigationMode === 'pan' ? 'move' : 'grab';
  };
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointermove', onPointerMove);
  controls.addEventListener('change', requestRender);
  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
  observer?.observe(container);
  resize();

  function rebuildHelpers(next: HouseLayout): void {
    if (grid) {
      scene.remove(grid);
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
    }
    const half = Math.ceil(Math.max(next.lengthM, next.depthM) * 0.9);
    grid = buildGround({ stepM: 1, halfExtentM: half, groundY: next.groundY, label: 'Grid: 1 m' });
    grid.visible = gridVisible;
    scene.add(grid);
    if (axes) {
      scene.remove(axes);
      disposeAxes(axes);
    }
    axes = buildAxes(houseAxesSpec(next));
    axes.visible = axesVisible;
    scene.add(axes);
  }

  return {
    update(next: HouseLayout): void {
      const first = layout === null;
      layout = next;
      syncHouseScene(house, next);
      rebuildHelpers(next);
      canvas.setAttribute('aria-label', `3D model of the building envelope: ${next.lengthM} m east–west by ${next.depthM} m north–south, storey height ${next.heightM} m, ${new Set(next.boxes.map((b) => b.componentId)).size} components shown.`);
      if (first) {
        resize();
        setView('iso-se');
      }
      requestRender();
    },
    select(componentId: string | null): void {
      setHouseSelection(house, componentId);
      requestRender();
    },
    setColours(colours: Record<string, string> | null): void {
      setHouseColours(house, colours);
      requestRender();
    },
    setView,
    setGridVisible(visible: boolean): void {
      gridVisible = visible;
      if (grid) grid.visible = visible;
      requestRender();
    },
    setAxesVisible(visible: boolean): void {
      axesVisible = visible;
      if (axes) axes.visible = visible;
      requestRender();
    },
    setNavigationMode(mode: NavigationMode): void {
      navigationMode = mode;
      controls.mouseButtons = { LEFT: mode === 'pan' ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: mode === 'pan' ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN };
      controls.touches = { ONE: mode === 'pan' ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
      canvas.style.cursor = mode === 'pan' ? 'move' : 'grab';
    },
    zoom(factor: number): void {
      orbit(0, 0, factor);
    },
    destroy(): void {
      destroyed = true;
      if (frame) cancelAnimationFrame(frame);
      observer?.disconnect();
      canvas.removeEventListener('keydown', onKeyDown);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointermove', onPointerMove);
      controls.dispose();
      if (grid) {
        grid.geometry.dispose();
        (grid.material as THREE.Material).dispose();
      }
      if (axes) disposeAxes(axes);
      disposeHouseScene(house);
      renderer.dispose();
      canvas.remove();
      overlay.remove();
    },
  };
}
