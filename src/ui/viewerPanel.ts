/**
 * The 3D VIEWPORT: toolbar ribbon, the 3D picture, overlays (layer list and
 * inspector, colour bar, messages) and a status bar with units.
 *
 * The panel never invents geometry or temperatures. It is given a validated
 * wall and, if the calculation succeeded, the engine's temperatures for it,
 * and it draws those. If the editor's current inputs are invalid, it keeps
 * showing the last valid wall and says so.
 */
import { colorForCategory, formatThickness, gridSpec, layoutWall, MAX_THICKNESS_SCALE, temperatureFraction, thermalCss, thermalGradientCss } from '../geometry';
import type { ThermalOverlay, WallLayout, WallSpec } from '../geometry';
import type { LayerView } from '../editor';
import type { NavigationMode, ViewerFactory, ViewPreset, WallViewer } from '../viewer3d';
import { h, show } from './dom';
import type { Child } from './dom';

export interface ValidWall {
  spec: WallSpec;
  views: LayerView[];
  /** Calculated temperatures for this wall, or null if the calculation did not succeed. */
  thermal: ThermalOverlay | null;
  /** Short statement about the data behind the temperatures (e.g. "uses illustrative material data"). */
  thermalNote: string;
}

export interface ViewerPanelOptions {
  /** Creates the 3D viewer. Without one, the panel works in text-only mode. */
  viewerFactory?: ViewerFactory;
  /** Called after the selected layer changes (from any source). */
  onSelectionChange?: (layerId: string | null) => void;
  /** Spoken/announced status messages for screen readers. */
  announce?: (text: string) => void;
}

export interface ViewerPanel {
  element: HTMLElement;
  /**
   * Gives the panel the latest VALID wall. Pass null while the editor's inputs are invalid: the panel then keeps
   * showing the last valid wall and tells the user so. `editorHasErrors` drives that message.
   */
  setWall(wall: ValidWall | null, editorHasErrors: boolean): void;
  select(layerId: string | null): void;
  getSelected(): string | null;
  hasLayer(layerId: string): boolean;
  getLayout(): WallLayout | null;
  /** Resolves when the viewer has been created (or found unavailable). */
  ready: Promise<void>;
  destroy(): void;
}

const SCALES = [1, 2, 5, 10] as const;
/** Real layers are very thin next to the wall's width and height, so the 3D view starts with the thickness drawn 5× larger. This is always stated on screen. */
const DEFAULT_THICKNESS_SCALE = 5;
const STATUS_TEXT: Record<string, string> = { verified: 'Verified', unverified: 'Unverified', illustrative: 'Illustrative', 'user-defined': 'User-defined' };

export function createViewerPanel(options: ViewerPanelOptions = {}): ViewerPanel {
  let wall: ValidWall | null = null;
  let editorHasErrors = false;
  let state: 'loading' | 'ready' | 'unavailable' = options.viewerFactory ? 'loading' : 'unavailable';
  let viewer: WallViewer | null = null;
  let destroyed = false;
  let exploded = false;
  let thicknessScale = DEFAULT_THICKNESS_SCALE;
  let labelsOn = true;
  let gridOn = true;
  let overlayOn = true;
  let arrowsOn = true;
  let mode: NavigationMode = 'orbit';
  let selected: string | null = null;
  let layout: WallLayout | null = null;
  let lastNotice = '';
  /** What the viewer was last asked to draw; used to skip redundant redraws. */
  let drawnKey = '';
  let thermalKey = '';

  // ---- elements ------------------------------------------------------------------------------
  const notice = h('div', { class: 'viewer-notice', role: 'status' });
  const stage = h('div', { class: 'viewer-stage' });
  const legend = h('ol', { class: 'legend', 'aria-label': 'Layers from interior to exterior' });
  const inspector = h('div', { class: 'inspector', 'aria-live': 'polite' });
  const scaleNote = h('p', { class: 'scale-note', 'data-role': 'scale-note' });
  const statusBar = h('div', { class: 'statusbar', 'data-role': 'statusbar' });
  const colorbar = h('div', { class: 'colorbar', 'data-role': 'colorbar', hidden: true });

  const button = (text: string, label: string, onClick: () => void): HTMLButtonElement => {
    const b = h('button', { type: 'button', class: 'tool', 'aria-label': label }, text);
    b.addEventListener('click', onClick);
    return b;
  };
  const viewButton = (text: string, label: string, preset: ViewPreset): HTMLButtonElement => button(text, label, () => viewer?.setView(preset));

  const orbitButton = h('button', { type: 'button', class: 'tool', 'aria-pressed': 'true', 'aria-label': 'Orbit mode: dragging rotates the model' }, 'Orbit');
  const panButton = h('button', { type: 'button', class: 'tool', 'aria-pressed': 'false', 'aria-label': 'Pan mode: dragging moves the view' }, 'Pan');
  const setMode = (next: NavigationMode): void => {
    mode = next;
    orbitButton.setAttribute('aria-pressed', String(next === 'orbit'));
    panButton.setAttribute('aria-pressed', String(next === 'pan'));
    viewer?.setNavigationMode(next);
    renderStatusBar();
  };
  orbitButton.addEventListener('click', () => setMode('orbit'));
  panButton.addEventListener('click', () => setMode('pan'));

  /** A labelled on/off switch shown as a chip in the toolbar. */
  const toggle = (id: string, text: string, initial: boolean, onChange: (on: boolean) => void): { box: HTMLInputElement; label: HTMLLabelElement } => {
    const box = h('input', { type: 'checkbox', id });
    box.checked = initial;
    box.addEventListener('change', () => onChange(box.checked));
    return { box, label: h('label', { class: 'chip', for: id, title: text }, box, ` ${text}`) };
  };
  const explodedToggle = toggle('v-exploded', 'Exploded', false, (on) => {
    exploded = on;
    options.announce?.(on ? 'Exploded view on: layers are pulled apart for visibility.' : 'Exploded view off.');
    redraw();
  });
  const labelsToggle = toggle('v-labels', 'Labels', true, (on) => {
    labelsOn = on;
    viewer?.setLabelsVisible(on);
  });
  const gridToggle = toggle('v-grid', 'Grid', true, (on) => {
    gridOn = on;
    viewer?.setGridVisible(on);
    renderStatusBar();
  });
  const overlayToggle = toggle('v-thermal', 'Thermal overlay', true, (on) => {
    overlayOn = on;
    options.announce?.(on ? 'Temperature overlay on: colours show calculated temperatures.' : 'Temperature overlay off: colours show material categories.');
    redraw();
  });
  const arrowsToggle = toggle('v-arrows', 'Heat flow', true, (on) => {
    arrowsOn = on;
    redraw();
  });

  const scaleSelect = h('select', { id: 'v-scale', class: 'tool-select', 'aria-label': 'Thickness drawing scale' });
  for (const s of SCALES.filter((v) => v <= MAX_THICKNESS_SCALE)) {
    scaleSelect.append(h('option', { value: String(s) }, s === 1 ? 'Thickness 1× (true)' : `Thickness ${s}×`));
  }
  scaleSelect.value = String(DEFAULT_THICKNESS_SCALE);
  scaleSelect.addEventListener('change', () => {
    thicknessScale = Number(scaleSelect.value);
    redraw();
  });

  const toolbar = h(
    'div',
    { class: 'toolbar', 'data-role': 'viewer-controls', role: 'toolbar', 'aria-label': '3D view controls' },
    h('div', { class: 'tool-group', role: 'group', 'aria-label': 'Navigation' }, orbitButton, panButton, button('−', 'Zoom out', () => viewer?.zoom(1 / 0.8)), button('+', 'Zoom in', () => viewer?.zoom(0.8)), button('Reset', 'Reset to the 3D view', () => viewer?.setView('iso'))),
    h(
      'div',
      { class: 'tool-group', role: 'group', 'aria-label': 'Camera views' },
      viewButton('3D', 'Show the oblique 3D view', 'iso'),
      viewButton('Interior', 'Look at the interior face', 'interior'),
      viewButton('Exterior', 'Look at the exterior face', 'exterior'),
      viewButton('Section', 'Look at the cut edge, showing the layers side by side', 'section'),
    ),
    h('div', { class: 'tool-group', role: 'group', 'aria-label': 'Display' }, overlayToggle.label, arrowsToggle.label, explodedToggle.label, labelsToggle.label, gridToggle.label, scaleSelect),
  );

  // On small screens the layer list would cover most of the picture, so it starts folded there.
  const startOpen = !(typeof window !== 'undefined' && window.matchMedia?.('(max-width: 960px)').matches);
  const layerPanel = h('div', { class: 'layer-panel', 'data-role': 'layer-panel', id: 'layer-panel-body' }, h('h3', {}, 'Layers (interior → exterior)'), legend, inspector);
  layerPanel.hidden = !startOpen;
  const layerPanelToggle = h('button', { type: 'button', class: 'tool layer-panel-toggle', 'aria-expanded': String(startOpen), 'aria-controls': 'layer-panel-body' }, startOpen ? 'Layers ▾' : 'Layers ▸');
  layerPanelToggle.addEventListener('click', () => {
    const open = layerPanelToggle.getAttribute('aria-expanded') !== 'true';
    layerPanelToggle.setAttribute('aria-expanded', String(open));
    layerPanelToggle.textContent = open ? 'Layers ▾' : 'Layers ▸';
    layerPanel.hidden = !open;
  });

  const stageWrap = h('div', { class: 'stage-wrap' }, stage, notice, h('div', { class: 'overlay-right' }, layerPanelToggle, layerPanel), colorbar, scaleNote);

  const element = h(
    'section',
    { id: 'viewer', class: 'viewport', 'aria-label': '3D view of the wall' },
    h('h2', { class: 'visually-hidden', id: 'h-viewer' }, '3D view'),
    toolbar,
    stageWrap,
    statusBar,
    h('p', { class: 'visually-hidden' }, 'Colours identify material categories only; they are not temperatures. This view is geometry, not a thermal result. Drag to rotate, scroll or pinch to zoom. With the 3D view focused: arrow keys rotate, plus and minus zoom, Home resets.'),
  );

  // ---- behaviour -----------------------------------------------------------------------------------
  function setSelected(id: string | null): void {
    const valid = id !== null && wall?.spec.layers.some((l) => l.id === id) ? id : null;
    if (valid === selected) return;
    selected = valid;
    viewer?.select(selected);
    renderLegend();
    renderInspector();
    options.onSelectionChange?.(selected);
    const name = wall?.spec.layers.find((l) => l.id === selected)?.name;
    options.announce?.(selected && name ? `Layer selected: ${name}.` : 'Layer selection cleared.');
  }

  const keyOf = (w: ValidWall | null): string => JSON.stringify([w?.spec ?? null, exploded, thicknessScale]);
  const overlayToDraw = (): ThermalOverlay | null => (overlayOn && state === 'ready' ? (wall?.thermal ?? null) : null);

  function redraw(force = false): void {
    layout = wall ? layoutWall(wall.spec, { exploded, thicknessScale }) : null;
    const key = keyOf(wall);
    // Ask the viewer to draw only if the wall or display options changed (or a new viewer needs the picture).
    if (layout && (force || key !== drawnKey)) {
      viewer?.update(layout);
      drawnKey = viewer ? key : '';
    }
    // Temperatures and arrows: only when they changed.
    const overlay = overlayToDraw();
    const direction = arrowsOn && wall?.thermal ? wall.thermal.direction : null;
    const tKey = JSON.stringify([overlay, direction, drawnKey]);
    if (viewer && (force || tKey !== thermalKey)) {
      viewer.setThermalOverlay(overlay);
      viewer.setHeatFlow(direction);
      thermalKey = tKey;
    }
    if (selected && !wall?.spec.layers.some((l) => l.id === selected)) {
      selected = null;
      viewer?.select(null);
      options.onSelectionChange?.(null);
    }
    renderNotice();
    renderLegend();
    renderInspector();
    renderColorbar();
    renderStatusBar();
    stage.hidden = state === 'unavailable';
    toolbar.hidden = state !== 'ready' || !layout;
    overlayToggle.box.disabled = !wall?.thermal;
    arrowsToggle.box.disabled = !wall?.thermal;
    scaleNote.textContent = layout
      ? [
          layout.thicknessScale > 1 ? `Layer thickness is drawn ${layout.thicknessScale}× larger for visibility; labels and the list show the true thickness.` : '',
          layout.exploded ? 'Gaps between layers are for visibility only; they are not air gaps.' : '',
        ]
          .filter(Boolean)
          .join(' ')
      : '';
    scaleNote.hidden = scaleNote.textContent === '';
  }

  function renderNotice(): void {
    const lines: string[] = [];
    if (state === 'loading') lines.push('Loading the 3D view…');
    if (state === 'unavailable') lines.push('3D graphics (WebGL) are not available here, so no 3D picture is drawn. The layer list shows the same wall as text.');
    if (!wall) lines.push('Enter a valid wall in the editor to see it here.');
    else if (editorHasErrors) lines.push('Showing the last valid wall. Fix the errors in the editor to update this view.');
    // Rewrite only when the text changes, so screen readers are not told the same thing on every keystroke.
    const text = lines.join('\n');
    if (text !== lastNotice) {
      lastNotice = text;
      notice.replaceChildren(...lines.map((line) => h('p', { class: editorHasErrors && wall ? 'stale' : '' }, line)));
    }
    notice.classList.toggle('visible', lines.length > 0);
  }

  /** The colour bar: exactly the scale used to paint the wall. */
  function renderColorbar(): void {
    const t = wall?.thermal;
    const visible = Boolean(overlayToDraw() && t);
    colorbar.hidden = !visible;
    if (!visible || !t) return;
    const mid = (t.minC + t.maxC) / 2;
    const flat = !(t.maxC > t.minC);
    colorbar.replaceChildren(
      h('div', { class: 'colorbar-title' }, 'Temperature (°C): calculated, steady state'),
      h('div', { class: 'colorbar-gradient', style: `background:${thermalGradientCss('to right')}`, role: 'img', 'aria-label': `Colour scale from ${show(t.minC)} °C (blue) to ${show(t.maxC)} °C (red)` }),
      h('div', { class: 'colorbar-scale' }, h('span', {}, `${show(t.minC, 4)}`), h('span', {}, flat ? '' : `${show(mid, 4)}`), h('span', {}, `${show(t.maxC, 4)}`)),
      h('div', { class: 'colorbar-note' }, flat ? 'No temperature difference: one colour.' : 'Linear scale from the coldest to the warmest temperature in the wall.', wall?.thermalNote ? ` ${wall.thermalNote}` : ''),
    );
  }

  function renderStatusBar(): void {
    const parts = ['Units: m · mm · °C · W/(m²·K)'];
    if (layout) {
      parts.push(`Wall ${show(layout.widthM, 4)} × ${show(layout.heightM, 4)} m`);
      parts.push(`thickness ${formatThickness(layout.totalThicknessM)}`);
      parts.push(`${layout.layers.length} layer${layout.layers.length === 1 ? '' : 's'}`);
      if (gridOn) parts.push(gridSpec(layout).label);
      parts.push(`thickness scale ${layout.thicknessScale}×`);
    }
    parts.push(`Mode: ${mode === 'orbit' ? 'orbit' : 'pan'}`);
    parts.push('Steady state');
    statusBar.replaceChildren(...parts.map((p) => h('span', {}, p)));
  }

  /** Swatch for a layer: its category colour, or its temperature gradient while the overlay is on. */
  function swatchStyle(layerId: string, category: string): string {
    const overlay = overlayToDraw();
    const entry = overlay?.layers.find((l) => l.id === layerId);
    if (overlay && entry) {
      const a = thermalCss(temperatureFraction(entry.startC, overlay.minC, overlay.maxC));
      const b = thermalCss(temperatureFraction(entry.endC, overlay.minC, overlay.maxC));
      return `background:linear-gradient(to right, ${a}, ${b})`;
    }
    return `background:${colorForCategory(category)}`;
  }

  function renderLegend(): void {
    legend.replaceChildren();
    const current = layout;
    if (!current) return;
    current.layers.forEach((box, index) => {
      const item = h(
        'button',
        { type: 'button', class: 'legend-item', 'aria-pressed': String(selected === box.id), 'data-layer-id': box.id },
        h('span', { class: 'swatch', style: swatchStyle(box.id, box.category) }),
        h('span', { class: 'legend-text' }, `${index + 1}. ${box.name} — ${box.thicknessLabel}`),
        index === 0 ? h('span', { class: 'tag tag-interior' }, 'Interior face') : null,
        index === current.layers.length - 1 ? h('span', { class: 'tag tag-exterior' }, 'Exterior face') : null,
      );
      item.addEventListener('click', () => setSelected(selected === box.id ? null : box.id));
      legend.append(h('li', {}, item));
    });
  }

  function renderInspector(): void {
    const parts: Child[] = [h('h3', {}, 'Layer inspector')];
    const index = wall ? wall.spec.layers.findIndex((l) => l.id === selected) : -1;
    if (!wall || index < 0) {
      parts.push(h('p', { class: 'note' }, 'Select a layer in the list, in the 3D view, or with an "Inspect" button to see its details here.'));
    } else {
      const layer = wall.spec.layers[index] as WallSpec['layers'][number];
      const view = wall.views[index];
      const start = wall.spec.layers.slice(0, index).reduce((sum, l) => sum + l.thicknessM, 0);
      const m = view?.material;
      const temps = wall.thermal?.layers.find((l) => l.id === layer.id);
      const prop = (label: string, value: number | undefined, unit: string): string => `${label} ${value === undefined ? 'missing' : `${show(value)} ${unit}`}`;
      parts.push(
        h('p', { class: 'inspector-title' }, h('span', { class: 'swatch', style: swatchStyle(layer.id, layer.category) }), ` Layer ${index + 1}: ${layer.name}`),
        h(
          'dl',
          { class: 'facts' },
          h('dt', {}, 'Category'),
          h('dd', {}, layer.category),
          h('dt', {}, 'Thickness'),
          h('dd', {}, formatThickness(layer.thicknessM)),
          h('dt', {}, 'Position'),
          h('dd', {}, `${formatThickness(start)} to ${formatThickness(start + layer.thicknessM)} from the interior face` + (index === 0 ? ' (touches the interior face)' : '') + (index === wall.spec.layers.length - 1 ? ' (touches the exterior face)' : '')),
          m ? h('dt', {}, 'Properties') : null,
          m ? h('dd', {}, [prop('λ', m.lambdaWPerMK, 'W/(m·K)'), prop('ρ', m.densityKgPerM3, 'kg/m³'), prop('c_p', m.specificHeatJPerKgK, 'J/(kg·K)')].join(' · ')) : null,
          temps ? h('dt', {}, 'Temperature') : null,
          temps ? h('dd', {}, `${show(temps.startC, 4)} °C at the interior-side face → ${show(temps.endC, 4)} °C at the exterior-side face (calculated, steady state)`) : null,
          h('dt', {}, 'Data status'),
          h('dd', {}, `${STATUS_TEXT[layer.status] ?? layer.status}${m ? `; value type: ${m.valueType}; source type: ${m.sourceType}` : ''}`),
        ),
        h('p', { class: 'note' }, 'Not confirmed as an approved Cypriot design value. See the layer card in the sidebar for the full source notes.'),
      );
    }
    inspector.replaceChildren(...(parts.filter(Boolean) as Node[]));
  }

  // ---- viewer creation ---------------------------------------------------------------------------------
  const ready = (async (): Promise<void> => {
    if (!options.viewerFactory) return;
    try {
      viewer = await options.viewerFactory(stage, { onSelect: (id) => setSelected(id === null || id === selected ? null : id) });
    } catch {
      viewer = null;
    }
    if (destroyed) {
      viewer?.destroy();
      viewer = null;
      return;
    }
    state = viewer ? 'ready' : 'unavailable';
    viewer?.setLabelsVisible(labelsOn);
    viewer?.setGridVisible(gridOn);
    viewer?.setNavigationMode(mode);
    if (viewer && selected) viewer.select(selected);
    redraw(true);
  })();

  redraw();

  return {
    element,
    setWall(next, hasErrors): void {
      // A null wall means "the editor currently has no valid wall": keep showing the last valid one (and say so).
      if (next) wall = next;
      editorHasErrors = hasErrors;
      redraw();
    },
    select: setSelected,
    getSelected: () => selected,
    hasLayer: (id) => wall?.spec.layers.some((l) => l.id === id) ?? false,
    getLayout: () => layout,
    ready,
    destroy(): void {
      destroyed = true;
      viewer?.destroy();
      viewer = null;
    },
  };
}
