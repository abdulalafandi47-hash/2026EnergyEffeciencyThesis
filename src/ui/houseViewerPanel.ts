/**
 * The 3D VIEWPORT of the building workspace: toolbar, the house picture,
 * heat-flux colour legend, notices and status bar. It draws the model it is
 * given; it does not calculate anything.
 */
import { fluxGradientCss, layoutHouse } from '../geometry';
import type { HouseLayout, HouseSpec } from '../geometry';
import type { HouseViewer, HouseViewerFactory, HouseViewPreset, NavigationMode } from '../viewer3d';
import { h, show } from './dom';
import type { FluxView } from './houseSpec';

export type ColourMode = 'type' | 'flux';

export interface HouseViewerPanel {
  element: HTMLElement;
  /** Draws a model (null: nothing valid to draw). */
  setModel(spec: HouseSpec | null, flux: FluxView, componentCount: number): void;
  select(componentId: string | null): void;
  getLayout(): HouseLayout | null;
  getColourMode(): ColourMode;
  ready: Promise<void>;
  destroy(): void;
}

export function createHouseViewerPanel(options: { viewerFactory?: HouseViewerFactory; onSelect?: (id: string | null) => void; announce?: (text: string) => void }): HouseViewerPanel {
  let viewer: HouseViewer | null = null;
  let state: 'loading' | 'ready' | 'unavailable' = options.viewerFactory ? 'loading' : 'unavailable';
  let destroyed = false;
  let layout: HouseLayout | null = null;
  let spec: HouseSpec | null = null;
  let flux: FluxView = { colours: {}, range: null };
  let count = 0;
  let selected: string | null = null;
  let colourMode: ColourMode = 'type';
  let gridOn = true;
  let axesOn = true;
  let drawnKey = '';

  const stage = h('div', { class: 'viewer-stage' });
  const notice = h('div', { class: 'viewer-notice', role: 'status' });
  const legend = h('div', { class: 'colorbar', 'data-role': 'flux-legend', hidden: true });
  const statusBar = h('div', { class: 'statusbar', 'data-role': 'house-statusbar' });

  const tool = (text: string, label: string, onClick: () => void, extra: Record<string, string> = {}): HTMLButtonElement => {
    const b = h('button', { type: 'button', class: 'tool', 'aria-label': label, ...extra }, text);
    b.addEventListener('click', onClick);
    return b;
  };
  const orbit = tool('Orbit', 'Orbit mode: dragging rotates the model', () => setMode('orbit'), { 'aria-pressed': 'true' });
  const pan = tool('Pan', 'Pan mode: dragging moves the view', () => setMode('pan'), { 'aria-pressed': 'false' });
  let mode: NavigationMode = 'orbit';
  function setMode(next: NavigationMode): void {
    mode = next;
    orbit.setAttribute('aria-pressed', String(next === 'orbit'));
    pan.setAttribute('aria-pressed', String(next === 'pan'));
    viewer?.setNavigationMode(next);
    renderStatus();
  }
  const view = (text: string, label: string, preset: HouseViewPreset): HTMLButtonElement => tool(text, label, () => viewer?.setView(preset));
  const chip = (id: string, text: string, on: boolean, change: (on: boolean) => void): HTMLLabelElement => {
    const box = h('input', { type: 'checkbox', id });
    box.checked = on;
    box.addEventListener('change', () => change(box.checked));
    return h('label', { class: 'chip', for: id }, box, ` ${text}`);
  };
  const colourSelect = h('select', { id: 'h-colour', class: 'tool-select', 'aria-label': 'Colour the building by' }, h('option', { value: 'type' }, 'Colour: element type'), h('option', { value: 'flux' }, 'Colour: heat flux |q| (W/m²)'));
  colourSelect.addEventListener('change', () => {
    colourMode = colourSelect.value as ColourMode;
    options.announce?.(colourMode === 'flux' ? 'Colours now show the calculated steady-state heat flux of each element; elements without a result are grey.' : 'Colours now show the element type.');
    applyColours();
    renderLegend();
  });

  const toolbar = h(
    'div',
    { class: 'toolbar', role: 'toolbar', 'aria-label': '3D view controls' },
    h('div', { class: 'tool-group', role: 'group', 'aria-label': 'Navigation' }, orbit, pan, tool('−', 'Zoom out', () => viewer?.zoom(1 / 0.8)), tool('+', 'Zoom in', () => viewer?.zoom(0.8)), tool('Reset', 'Reset to the 3D view from the south-east', () => viewer?.setView('iso-se'))),
    h(
      'div',
      { class: 'tool-group', role: 'group', 'aria-label': 'Camera views' },
      view('3D SE', '3D view from the south-east', 'iso-se'),
      view('3D SW', '3D view from the south-west', 'iso-sw'),
      view('3D NE', '3D view from the north-east', 'iso-ne'),
      view('3D NW', '3D view from the north-west', 'iso-nw'),
      view('Plan', 'Plan view from above (north at the top)', 'top'),
      view('N', 'North elevation', 'north'),
      view('E', 'East elevation', 'east'),
      view('S', 'South elevation', 'south'),
      view('W', 'West elevation', 'west'),
    ),
    h('div', { class: 'tool-group', role: 'group', 'aria-label': 'Display' }, colourSelect, chip('h-grid', 'Grid', true, (on) => { gridOn = on; viewer?.setGridVisible(on); renderStatus(); }), chip('h-axes', 'Axes', true, (on) => { axesOn = on; viewer?.setAxesVisible(on); renderStatus(); })),
  );

  const element = h(
    'section',
    { id: 'house-viewer', class: 'viewport', 'aria-label': '3D view of the building' },
    h('h2', { class: 'visually-hidden' }, '3D view of the building'),
    toolbar,
    h('div', { class: 'stage-wrap' }, stage, notice, legend),
    statusBar,
    h('p', { class: 'visually-hidden' }, 'Click an element to select it. Colours show the element type, or, if chosen, the calculated steady-state heat flux of each element. Drag to rotate, scroll to zoom. With the view focused: arrow keys rotate, plus and minus zoom, Home resets.'),
  );

  function applyColours(): void {
    viewer?.setColours(colourMode === 'flux' ? flux.colours : null);
  }

  function renderLegend(): void {
    const on = colourMode === 'flux';
    legend.hidden = !on;
    if (!on) return;
    legend.replaceChildren(
      h('div', { class: 'colorbar-title' }, 'Heat flux |q| = |Q̇| / A (W/m²): calculated, steady state'),
      flux.range
        ? h('div', {}, h('div', { class: 'colorbar-gradient', style: `background:${fluxGradientCss()}`, role: 'img', 'aria-label': `Colour scale from ${show(flux.range.min, 3)} to ${show(flux.range.max, 3)} W/m²` }), h('div', { class: 'colorbar-scale' }, h('span', {}, show(flux.range.min, 3)), h('span', {}, show(flux.range.max, 3))))
        : h('p', { class: 'note' }, 'No element has a calculated heat flow yet.'),
      h('div', { class: 'colorbar-note' }, 'Grey: no calculated result (missing data, unsupported such as ground floors, excluded or invalid). For the stated condition only; not a dynamic or annual result.'),
    );
  }

  function renderStatus(): void {
    const parts = ['Units: m · m² · °C · W · W/(m²·K)'];
    if (layout) {
      parts.push(`House ${show(layout.lengthM, 4)} × ${show(layout.depthM, 4)} m, storey ${show(layout.heightM, 4)} m`);
      parts.push(`${count} component${count === 1 ? '' : 's'}`);
      if (layout.nominalThickness.length > 0) parts.push(`${layout.nominalThickness.length} element${layout.nominalThickness.length === 1 ? '' : 's'} without layer thickness drawn 0.2 m thick`);
      if (gridOn) parts.push('Grid: 1 m');
      if (axesOn) parts.push('Axes x: east · y: up · z: south');
    }
    parts.push(`Mode: ${mode}`);
    parts.push('Steady state');
    statusBar.replaceChildren(...parts.map((p) => h('span', {}, p)));
  }

  function renderNotice(): void {
    const lines: string[] = [];
    if (state === 'loading') lines.push('Loading the 3D view…');
    if (state === 'unavailable') lines.push('3D graphics (WebGL) are not available here. The component list in the sidebar describes the same building.');
    if (!spec) lines.push('The house dimensions are not valid, so nothing can be drawn.');
    else if (count === 0) lines.push('Blank project: add components in the sidebar (or load the example house).');
    notice.replaceChildren(...lines.map((l) => h('p', {}, l)));
    notice.classList.toggle('visible', lines.length > 0);
  }

  function redraw(force = false): void {
    layout = spec ? layoutHouse(spec) : null;
    const key = JSON.stringify(spec);
    if (viewer && layout && (force || key !== drawnKey)) {
      viewer.update(layout);
      viewer.select(selected);
      drawnKey = key;
    }
    applyColours();
    renderNotice();
    renderLegend();
    renderStatus();
    stage.hidden = state === 'unavailable';
    toolbar.hidden = state !== 'ready';
  }

  const ready = (async (): Promise<void> => {
    if (!options.viewerFactory) return;
    try {
      viewer = await options.viewerFactory(stage, { onSelect: (id) => options.onSelect?.(id) });
    } catch {
      viewer = null;
    }
    if (destroyed) {
      viewer?.destroy();
      viewer = null;
      return;
    }
    state = viewer ? 'ready' : 'unavailable';
    viewer?.setGridVisible(gridOn);
    viewer?.setAxesVisible(axesOn);
    viewer?.setNavigationMode(mode);
    redraw(true);
  })();

  redraw();

  return {
    element,
    setModel(nextSpec, nextFlux, componentCount): void {
      spec = nextSpec;
      flux = nextFlux;
      count = componentCount;
      redraw();
    },
    select(id): void {
      selected = id;
      viewer?.select(id);
    },
    getLayout: () => layout,
    getColourMode: () => colourMode,
    ready,
    destroy(): void {
      destroyed = true;
      viewer?.destroy();
      viewer = null;
    },
  };
}
