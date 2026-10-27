/**
 * The interactive 3D view: renderer, camera, mouse/touch/keyboard controls,
 * click-to-inspect and on-screen labels. The boxes themselves come from
 * sceneBuilder.ts, which in turn is driven only by a WallLayout, so the picture
 * always reflects the validated wall.
 *
 * Rendering is on demand (a frame is drawn only when something changes), so an
 * idle page uses almost no CPU/GPU.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { describeLayout, gridSpec, spreadLabels, temperatureFraction, thermalCss } from '../geometry';
import type { FlowDirection, ThermalOverlay, WallLayout } from '../geometry';
import { applyThermalOverlay, buildGround, createWallScene, disposeWallScene, pickLayer, setSelection, stepWallScene, syncHeatFlow, syncWallScene } from './sceneBuilder';
import type { NavigationMode, ViewerHandlers, ViewPreset, WallViewer } from './types';

const FOV_DEGREES = 40;
/** Direction from the wall centre to the camera for each preset (x: interior → exterior). */
const VIEW_DIRECTIONS: Record<ViewPreset, [number, number, number]> = {
  iso: [-1.0, 0.55, 1.15],
  interior: [-1, 0, 0],
  exterior: [1, 0, 0],
  section: [0, 0, 1],
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

/** Creates the viewer, or returns null if WebGL is not available. */
export function createWallViewer(container: HTMLElement, handlers: ViewerHandlers = {}): WallViewer | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  } catch {
    return null; // no WebGL: the page shows a text fallback
  }

  const reducedMotion = (): boolean => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  // ---- DOM ------------------------------------------------------------------------
  const canvas = renderer.domElement;
  canvas.className = 'viewer-canvas';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', '3D wall model (not drawn yet)');
  const overlay = el('div', 'viewer-overlay');
  overlay.setAttribute('aria-hidden', 'true');
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const leaders = document.createElementNS(SVG_NS, 'svg');
  leaders.setAttribute('class', 'viewer-leaders');
  overlay.append(leaders);
  container.append(canvas, overlay);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  // ---- scene -------------------------------------------------------------------------
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 1.9));
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
  keyLight.position.set(-3, 5, 4);
  const fillLight = new THREE.DirectionalLight(0xffffff, 1.2);
  fillLight.position.set(4, 1, -3);
  scene.add(keyLight, fillLight);
  const wall = createWallScene();
  scene.add(wall.group, wall.flow);

  const camera = new THREE.PerspectiveCamera(FOV_DEGREES, 1, 0.01, 100);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false; // keeps on-demand rendering simple and exact
  controls.screenSpacePanning = true;

  // ---- state ---------------------------------------------------------------------------
  let layout: WallLayout | null = null;
  let selectedId: string | null = null;
  let thermal: ThermalOverlay | null = null;
  let flowDirection: FlowDirection | null = null;
  let gridVisible = true;
  let grid: THREE.GridHelper | null = null;
  let gridKey = '';
  let navigationMode: NavigationMode = 'orbit';
  let labelsVisible = true;
  let destroyed = false;
  let frame = 0;
  const layerLabels = new Map<string, HTMLElement>();
  const interiorLabel = el('div', 'viewer-face viewer-face-interior', 'INTERIOR FACE');
  const exteriorLabel = el('div', 'viewer-face viewer-face-exterior', 'EXTERIOR FACE');
  overlay.append(interiorLabel, exteriorLabel);

  // ---- rendering -------------------------------------------------------------------------
  function requestRender(): void {
    if (!frame && !destroyed) frame = requestAnimationFrame(tick);
  }

  function tick(): void {
    frame = 0;
    if (destroyed) return;
    const moving = stepWallScene(wall, reducedMotion() ? 1 : 0.22);
    draw();
    if (moving) requestRender();
  }

  const projected = new THREE.Vector3();
  /** World point → pixel position inside the canvas, or null if behind the camera. */
  function toScreen(x: number, y: number, z: number): { x: number; y: number } | null {
    projected.set(x, y, z).project(camera);
    if (projected.z > 1) return null;
    return { x: ((projected.x + 1) / 2) * canvas.clientWidth, y: ((1 - projected.y) / 2) * canvas.clientHeight };
  }

  const leaderLines = new Map<string, { line: SVGLineElement; dot: SVGCircleElement }>();
  const swatches = new Map<string, HTMLElement>();

  /** Label swatches show each layer's category colour, or its temperature gradient while the overlay is on. */
  function refreshSwatches(): void {
    if (!layout) return;
    for (const box of layout.layers) {
      const swatch = swatches.get(box.id);
      const entry = thermal?.layers.find((l) => l.id === box.id);
      if (!swatch) continue;
      if (thermal && entry) {
        const a = thermalCss(temperatureFraction(entry.startC, thermal.minC, thermal.maxC));
        const b = thermalCss(temperatureFraction(entry.endC, thermal.minC, thermal.maxC));
        swatch.style.background = `linear-gradient(to right, ${a}, ${b})`;
      } else {
        swatch.style.background = box.color;
      }
    }
  }

  function placeLabels(): void {
    if (!layout) return;
    const anchors = [];
    const points = new Map<string, { x: number; y: number }>();
    for (const box of layout.layers) {
      const label = layerLabels.get(box.id);
      if (!label) continue;
      // Anchor: middle of the layer's top edge.
      const point = labelsVisible ? toScreen(wall.meshes.get(box.id)?.position.x ?? box.centerX, box.sizeY / 2, 0) : null;
      label.hidden = point === null;
      const pair = leaderLines.get(box.id);
      if (pair) pair.line.style.display = pair.dot.style.display = point === null ? 'none' : '';
      if (point) {
        points.set(box.id, point);
        anchors.push({ id: box.id, x: point.x, y: point.y - 36, width: label.offsetWidth || 130, height: label.offsetHeight || 22 });
      }
    }
    // Labels stack upwards (away from the wall); the top limit keeps them inside the picture.
    for (const placed of spreadLabels(anchors, { direction: 'up', minY: 4 })) {
      const label = layerLabels.get(placed.id);
      const point = points.get(placed.id);
      const pair = leaderLines.get(placed.id);
      if (!label || !point) continue;
      // Keep the whole label inside the picture (a label wider than the picture is truncated by CSS).
      const half = Math.min(label.offsetWidth || 130, canvas.clientWidth - 8) / 2;
      const x = Math.max(half + 4, Math.min(canvas.clientWidth - half - 4, placed.x));
      label.style.transform = `translate(${Math.round(x)}px, ${Math.round(placed.y)}px) translate(-50%, 0)`;
      if (pair) {
        pair.line.setAttribute('x1', String(Math.round(point.x)));
        pair.line.setAttribute('y1', String(Math.round(point.y)));
        pair.line.setAttribute('x2', String(Math.round(x)));
        pair.line.setAttribute('y2', String(Math.round(placed.y + label.offsetHeight)));
        pair.dot.setAttribute('cx', String(Math.round(point.x)));
        pair.dot.setAttribute('cy', String(Math.round(point.y)));
      }
    }
    // Face markers sit well outside each face, at mid-height, so they do not sit on the wall itself.
    const reach = 0.3 * Math.max(layout.widthM, layout.heightM);
    for (const [label, x] of [
      [interiorLabel, layout.interiorFaceX - reach],
      [exteriorLabel, layout.exteriorFaceX + reach],
    ] as const) {
      const point = toScreen(x, 0, 0);
      label.hidden = point === null;
      if (point) label.style.transform = `translate(${Math.round(point.x)}px, ${Math.round(point.y)}px) translate(-50%, -50%)`;
    }
  }

  function draw(): void {
    renderer.render(scene, camera);
    placeLabels();
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

  // ---- camera ---------------------------------------------------------------------------------
  function fitDistance(): number {
    const radius = layout?.boundingRadius ?? 1;
    const verticalHalf = THREE.MathUtils.degToRad(FOV_DEGREES) / 2;
    const horizontalHalf = Math.atan(Math.tan(verticalHalf) * camera.aspect);
    return (radius / Math.sin(Math.min(verticalHalf, horizontalHalf))) * 1.05;
  }

  function applyLimits(): void {
    const radius = layout?.boundingRadius ?? 1;
    controls.minDistance = radius * 0.15;
    controls.maxDistance = radius * 12;
    camera.near = Math.max(0.005, radius / 200);
    camera.far = radius * 40;
    camera.updateProjectionMatrix();
  }

  function setView(preset: ViewPreset): void {
    const [dx, dy, dz] = VIEW_DIRECTIONS[preset];
    const direction = new THREE.Vector3(dx, dy, dz).normalize();
    controls.target.set(0, 0, 0);
    camera.position.copy(direction.multiplyScalar(fitDistance()));
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
    applyLimits();
    controls.update();
    requestRender();
  }

  /** Keyboard control: rotate and zoom about the wall without a mouse. */
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
  const keyActions: Record<string, () => void> = {
    ArrowLeft: () => orbit(-STEP, 0),
    ArrowRight: () => orbit(STEP, 0),
    ArrowUp: () => orbit(0, -STEP),
    ArrowDown: () => orbit(0, STEP),
    '+': () => orbit(0, 0, 0.88),
    '=': () => orbit(0, 0, 0.88),
    '-': () => orbit(0, 0, 1 / 0.88),
    Home: () => setView('iso'),
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    const action = keyActions[event.key];
    if (action && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      action();
    }
  };
  canvas.addEventListener('keydown', onKeyDown);

  // ---- picking: a click that is not a drag selects the layer under the pointer ----------------------
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let downAt: { x: number; y: number } | null = null;

  function layerAt(clientX: number, clientY: number): string | null {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -(((clientY - rect.top) / rect.height) * 2 - 1));
    raycaster.setFromCamera(pointer, camera);
    return pickLayer(wall, raycaster);
  }
  const onPointerDown = (e: PointerEvent): void => void (downAt = { x: e.clientX, y: e.clientY });
  const onPointerUp = (e: PointerEvent): void => {
    const start = downAt;
    downAt = null;
    if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 5) handlers.onSelect?.(layerAt(e.clientX, e.clientY));
  };
  const onPointerMove = (e: PointerEvent): void => {
    if (e.buttons === 0) canvas.style.cursor = layerAt(e.clientX, e.clientY) ? 'pointer' : navigationMode === 'pan' ? 'move' : 'grab';
  };
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointermove', onPointerMove);
  controls.addEventListener('change', requestRender);

  const onContextLost = (e: Event): void => e.preventDefault();
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', requestRender);

  const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
  observer?.observe(container);
  resize();

  /** (Re)builds the ground grid for the current wall; skipped when nothing relevant changed. */
  function refreshGrid(next: WallLayout): void {
    const spec = gridSpec(next);
    const key = JSON.stringify(spec);
    if (key === gridKey) return;
    gridKey = key;
    if (grid) {
      scene.remove(grid);
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
    }
    grid = buildGround(spec);
    grid.visible = gridVisible;
    scene.add(grid);
  }

  function setNavigation(mode: NavigationMode): void {
    navigationMode = mode;
    const rotate = THREE.MOUSE.ROTATE;
    const pan = THREE.MOUSE.PAN;
    controls.mouseButtons = { LEFT: mode === 'pan' ? pan : rotate, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: mode === 'pan' ? rotate : pan };
    controls.touches = { ONE: mode === 'pan' ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    canvas.style.cursor = mode === 'pan' ? 'move' : 'grab';
  }

  // ---- public interface --------------------------------------------------------------------------------
  function rebuildLabels(next: WallLayout): void {
    for (const label of layerLabels.values()) label.remove();
    layerLabels.clear();
    swatches.clear();
    leaders.replaceChildren();
    leaderLines.clear();
    for (const box of next.layers) {
      const line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('class', 'viewer-leader');
      line.setAttribute('stroke', box.color);
      const dot = document.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('class', 'viewer-leader-dot');
      dot.setAttribute('r', '3');
      dot.setAttribute('fill', box.color);
      leaders.append(line, dot);
      leaderLines.set(box.id, { line, dot });
      const label = el('div', 'viewer-label');
      label.dataset.layerId = box.id;
      const swatch = el('span', 'viewer-swatch');
      swatch.style.background = box.color;
      swatches.set(box.id, swatch);
      label.append(swatch, el('span', 'viewer-label-text', `${box.name} — ${box.thicknessLabel}`));
      overlay.append(label);
      layerLabels.set(box.id, label);
    }
    refreshLabelStyles();
    refreshSwatches();
  }

  function refreshLabelStyles(): void {
    for (const [id, label] of layerLabels) label.classList.toggle('selected', id === selectedId);
    for (const [id, { line }] of leaderLines) line.classList.toggle('selected', id === selectedId);
  }

  return {
    update(next: WallLayout): void {
      const first = layout === null;
      layout = next;
      syncWallScene(wall, next, first || reducedMotion());
      rebuildLabels(next);
      refreshGrid(next);
      applyThermalOverlay(wall, thermal); // new boxes need the paint too
      syncHeatFlow(wall, next, flowDirection);
      setSelection(wall, selectedId);
      canvas.setAttribute('aria-label', describeLayout(next));
      if (first) {
        resize();
        setView('iso');
      } else {
        applyLimits();
      }
      requestRender();
    },
    select(layerId: string | null): void {
      selectedId = layerId;
      setSelection(wall, layerId);
      refreshLabelStyles();
      requestRender();
    },
    setLabelsVisible(visible: boolean): void {
      labelsVisible = visible;
      requestRender();
    },
    setView,
    setThermalOverlay(overlay: ThermalOverlay | null): void {
      thermal = overlay;
      applyThermalOverlay(wall, overlay);
      refreshSwatches();
      requestRender();
    },
    setHeatFlow(direction: FlowDirection | null): void {
      flowDirection = direction;
      if (layout) syncHeatFlow(wall, layout, direction);
      requestRender();
    },
    setGridVisible(visible: boolean): void {
      gridVisible = visible;
      if (grid) grid.visible = visible;
      requestRender();
    },
    setNavigationMode: setNavigation,
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
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', requestRender);
      controls.dispose();
      if (grid) {
        grid.geometry.dispose();
        (grid.material as THREE.Material).dispose();
      }
      disposeWallScene(wall);
      renderer.dispose();
      canvas.remove();
      overlay.remove();
    },
  };
}
