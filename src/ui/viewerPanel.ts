/**
 * The "3D view" panel: viewer canvas, camera and display controls, a layer
 * legend (also usable without 3D) and a layer inspector.
 *
 * The panel never invents geometry. It is given a validated wall (a WallSpec
 * plus per-layer display info) and draws that. If the editor's current inputs
 * are invalid, it keeps showing the last valid wall and says so.
 */
import { colorForCategory, formatThickness, layoutWall, MAX_THICKNESS_SCALE } from '../geometry';
import type { WallLayout, WallSpec } from '../geometry';
import type { LayerView } from '../editor';
import type { ViewerFactory, ViewPreset, WallViewer } from '../viewer3d';
import { h, show } from './dom';
import type { Child } from './dom';

export interface ValidWall {
  spec: WallSpec;
  views: LayerView[];
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
  let selected: string | null = null;
  let layout: WallLayout | null = null;
  let lastNotice = '';

  // ---- elements ------------------------------------------------------------------------------
  const notice = h('div', { class: 'viewer-notice', role: 'status' });
  const stage = h('div', { class: 'viewer-stage' });
  const legend = h('ol', { class: 'legend', 'aria-label': 'Layers from interior to exterior' });
  const inspector = h('div', { class: 'inspector', 'aria-live': 'polite' });
  const scaleNote = h('p', { class: 'note', 'data-role': 'scale-note' });

  const viewButton = (text: string, label: string, preset: ViewPreset): HTMLButtonElement => {
    const button = h('button', { type: 'button', 'aria-label': label }, text);
    button.addEventListener('click', () => viewer?.setView(preset));
    return button;
  };
  const explodedBox = h('input', { type: 'checkbox', id: 'v-exploded' });
  explodedBox.addEventListener('change', () => {
    exploded = explodedBox.checked;
    options.announce?.(exploded ? 'Exploded view on: layers are pulled apart for visibility.' : 'Exploded view off.');
    redraw();
  });
  const labelsBox = h('input', { type: 'checkbox', id: 'v-labels' });
  labelsBox.checked = true;
  labelsBox.addEventListener('change', () => {
    labelsOn = labelsBox.checked;
    viewer?.setLabelsVisible(labelsOn);
  });
  const scaleSelect = h('select', { id: 'v-scale' });
  for (const s of SCALES.filter((v) => v <= MAX_THICKNESS_SCALE)) {
    const option = h('option', { value: String(s) }, s === 1 ? '1× (true proportions)' : `${s}× (exaggerated)`);
    scaleSelect.append(option);
  }
  scaleSelect.value = String(DEFAULT_THICKNESS_SCALE);
  scaleSelect.addEventListener('change', () => {
    thicknessScale = Number(scaleSelect.value);
    redraw();
  });

  const controls = h(
    'div',
    { class: 'viewer-controls', 'data-role': 'viewer-controls' },
    h(
      'div',
      { class: 'button-row', role: 'group', 'aria-label': 'Camera views' },
      viewButton('3D view', 'Reset to the 3D view', 'iso'),
      viewButton('From interior', 'Look at the interior face', 'interior'),
      viewButton('From exterior', 'Look at the exterior face', 'exterior'),
      viewButton('Section', 'Look at the cut edge, showing the layers side by side', 'section'),
    ),
    h(
      'div',
      { class: 'option-row' },
      h('label', { class: 'check', for: 'v-exploded' }, explodedBox, ' Exploded view'),
      h('label', { class: 'check', for: 'v-labels' }, labelsBox, ' Show labels'),
      h('label', { for: 'v-scale' }, 'Thickness drawing scale: '),
      scaleSelect,
    ),
    h('p', { class: 'hint' }, 'Drag to rotate, scroll or pinch to zoom, right-drag or two fingers to pan. With the 3D view focused: arrow keys rotate, + and − zoom, Home resets. Click a layer to inspect it.'),
  );

  const element = h(
    'section',
    { id: 'viewer', 'aria-labelledby': 'h-viewer' },
    h('h2', { id: 'h-viewer' }, '4. 3D view'),
    h('p', { class: 'note' }, 'Drawn from the validated wall in the editor. Colours identify material categories only; they are not temperatures. This is geometry, not a thermal result.'),
    stage,
    notice, // below the picture, so the picture does not jump when a message appears
    controls,
    scaleNote,
    h('h3', {}, 'Layers'),
    legend,
    inspector,
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

  /** What the viewer was last asked to draw; used to skip redundant redraws. */
  let drawnKey = '';
  const keyOf = (w: ValidWall | null): string => JSON.stringify([w?.spec ?? null, exploded, thicknessScale]);

  function redraw(force = false): void {
    layout = wall ? layoutWall(wall.spec, { exploded, thicknessScale }) : null;
    const key = keyOf(wall);
    // Ask the viewer to draw only if the wall or display options changed (or a new viewer needs the picture).
    if (layout && (force || key !== drawnKey)) {
      viewer?.update(layout);
      drawnKey = viewer ? key : '';
    }
    if (selected && !wall?.spec.layers.some((l) => l.id === selected)) {
      selected = null;
      viewer?.select(null);
      options.onSelectionChange?.(null);
    }
    renderNotice();
    renderLegend();
    renderInspector();
    stage.hidden = state === 'unavailable';
    controls.hidden = state !== 'ready' || !layout;
    scaleNote.textContent = layout
      ? [
          layout.thicknessScale > 1 ? `Layer thickness is drawn ${layout.thicknessScale}× larger for visibility; labels and the list show the true thickness.` : '',
          layout.exploded ? 'The gaps between layers are for visibility only; they are not air gaps.' : '',
        ]
          .filter(Boolean)
          .join(' ')
      : '';
  }

  function renderNotice(): void {
    const lines: string[] = [];
    if (state === 'loading') lines.push('Loading the 3D view…');
    if (state === 'unavailable') lines.push('3D graphics (WebGL) are not available here, so no 3D picture is drawn. The layer list below shows the same wall as text.');
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

  function renderLegend(): void {
    legend.replaceChildren();
    const current = layout;
    if (!current) return;
    current.layers.forEach((box, index) => {
      const button = h(
        'button',
        { type: 'button', class: 'legend-item', 'aria-pressed': String(selected === box.id), 'data-layer-id': box.id },
        h('span', { class: 'swatch', style: `background:${box.color}` }),
        h('span', { class: 'legend-text' }, `${index + 1}. ${box.name} — ${box.thicknessLabel}`),
        index === 0 ? h('span', { class: 'tag tag-interior' }, 'Interior face') : null,
        index === current.layers.length - 1 ? h('span', { class: 'tag tag-exterior' }, 'Exterior face') : null,
      );
      button.addEventListener('click', () => setSelected(selected === box.id ? null : box.id));
      legend.append(h('li', {}, button));
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
      const prop = (label: string, value: number | undefined, unit: string): string => `${label} ${value === undefined ? 'missing' : `${show(value)} ${unit}`}`;
      parts.push(
        h('p', { class: 'inspector-title' }, h('span', { class: 'swatch', style: `background:${colorForCategory(layer.category)}` }), ` Layer ${index + 1}: ${layer.name}`),
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
          h('dt', {}, 'Data status'),
          h('dd', {}, `${STATUS_TEXT[layer.status] ?? layer.status}${m ? `; value type: ${m.valueType}; source type: ${m.sourceType}` : ''}`),
        ),
        h('p', { class: 'note' }, 'Not confirmed as an approved Cypriot design value. See the layer card in the editor for the full source notes.'),
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
