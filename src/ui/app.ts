/**
 * The wall editor screen.
 *
 * This file only DISPLAYS a draft and forwards user actions to the editor
 * functions in `src/editor/`. It contains no engineering rules and no
 * calculations: validation, unit conversion and layer logic all live in the
 * editor module, which asks the calculation engine what is valid.
 *
 * How updates work (so typing never loses the cursor):
 *  - typing in a text box updates the draft and refreshes messages/summary only;
 *  - structural changes (add/remove/move layer, choose material, change unit)
 *    rebuild the affected part of the page, then restore keyboard focus.
 */
import {
  addLayer,
  buildWall,
  createInitialDraft,
  describeLayers,
  errorFor,
  FIELD,
  layerField,
  moveLayer,
  removeLayer,
  setDimensionUnit,
  setDuration,
  setHeight,
  setInsideTemperature,
  setLayerMaterial,
  setLayerThickness,
  setLayerThicknessUnit,
  setOutsideTemperature,
  setSurfaceInside,
  setSurfaceMode,
  setSurfaceOutside,
  setTemperatureUnit,
  setWidth,
  summarizeDataStatus,
  warningFor,
} from '../editor';
import type { BuildResult, LayerView, LengthUnit, SurfaceMode, TemperatureUnit, WallDraft } from '../editor';
import { colorForCategory } from '../geometry';
import { BUILT_IN_MATERIALS, MATERIAL_CATEGORIES, searchMaterials } from '../materials';
import type { MaterialRecord } from '../materials';
import type { ViewerFactory } from '../viewer3d';
import { h, show } from './dom';
import type { Child } from './dom';
import { createViewerPanel } from './viewerPanel';
import type { ViewerPanel } from './viewerPanel';
import { wallSpecFromViews } from './wallSpec';

export interface WallEditorOptions {
  /**
   * Creates the 3D viewer. Passed in (instead of imported here) so the 3D
   * library is only loaded in the browser, and so tests can use a fake viewer.
   * Without it the editor works in text-only mode.
   */
  viewerFactory?: ViewerFactory;
}

export interface WallEditorHandle {
  /** The current draft (for tests and later stages). */
  getDraft(): WallDraft;
  /** The current result of validating the draft. */
  getResult(): BuildResult;
  /** The 3D panel (layout, selection). */
  viewer: ViewerPanel;
  /** Resolves once the 3D viewer has been created or found unavailable. */
  ready: Promise<void>;
  /** Releases the 3D viewer. */
  destroy(): void;
}

const DATA_POLICY =
  'Data policy: every value in the built-in material database is an illustrative demonstration number. ' +
  'None has been confirmed as an approved Cypriot design value, and nothing shown here demonstrates compliance with any standard or regulation. ' +
  'Measured, declared and design thermal values are different things, and this application does not convert values between conditions.';

const LENGTH_UNITS: LengthUnit[] = ['mm', 'cm', 'm'];
const TEMPERATURE_UNITS: Array<[TemperatureUnit, string]> = [
  ['C', '°C'],
  ['K', 'K'],
  ['F', '°F'],
];

const STATUS_TEXT: Record<string, string> = {
  verified: 'Verified',
  unverified: 'Unverified',
  illustrative: 'Illustrative',
  'user-defined': 'User-defined',
};

const fieldDomId = (field: string): string => `f-${field.replace(/[^a-zA-Z0-9]+/g, '-')}`;

export function mountWallEditor(
  root: HTMLElement,
  materials: readonly MaterialRecord[] = BUILT_IN_MATERIALS,
  options: WallEditorOptions = {},
): WallEditorHandle {
  let draft: WallDraft = createInitialDraft(materials);
  let materialFilter = '';
  let result: BuildResult = buildWall(draft, materials);

  /** Inputs and their message areas, by field id, for refreshing validation text. */
  const inputs = new Map<string, HTMLInputElement | HTMLSelectElement>();
  const messages = new Map<string, HTMLElement>();

  // ---- building blocks ----------------------------------------------------------

  /** Label + input + message area, registered under `field`. */
  function fieldRow(
    field: string,
    labelText: string,
    control: HTMLInputElement | HTMLSelectElement,
    extra: Child[] = [],
  ): HTMLElement {
    const id = fieldDomId(field);
    const msgId = `msg-${id}`;
    control.id = id;
    control.setAttribute('aria-describedby', msgId);
    control.setAttribute('aria-invalid', 'false');
    const message = h('div', { id: msgId, class: 'msg' });
    inputs.set(field, control);
    messages.set(field, message);
    return h('div', { class: 'field' }, h('label', { for: id }, labelText), h('div', { class: 'control' }, control, ...extra), message);
  }

  function textInput(value: string, onInput: (text: string) => void): HTMLInputElement {
    const input = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', spellcheck: 'false' });
    input.value = value;
    input.addEventListener('input', () => {
      onInput(input.value);
      refresh();
    });
    return input;
  }

  function unitSelect<T extends string>(options: Array<[T, string]>, current: T, label: string, onChange: (unit: T) => void): HTMLSelectElement {
    const select = h('select', { 'aria-label': label, class: 'unit' });
    for (const [value, text] of options) {
      const option = h('option', { value }, text);
      option.selected = value === current;
      select.append(option);
    }
    select.addEventListener('change', () => {
      onChange(select.value as T);
      syncStaticInputs();
      renderLayers();
      refresh();
    });
    return select;
  }

  const lengthOptions = (): Array<[LengthUnit, string]> => LENGTH_UNITS.map((u) => [u, u]);

  // ---- static sections ---------------------------------------------------------------

  const widthInput = textInput(draft.widthText, (t) => (draft = setWidth(draft, t)));
  const heightInput = textInput(draft.heightText, (t) => (draft = setHeight(draft, t)));
  const dimensionUnit = unitSelect(lengthOptions(), draft.dimensionUnit, 'Unit of width and height', (u) => (draft = setDimensionUnit(draft, u)));
  const areaReadout = h('p', { class: 'readout', 'data-role': 'area' });

  const dimensionsSection = h(
    'section',
    { 'aria-labelledby': 'h-dimensions' },
    h('h2', { id: 'h-dimensions' }, '1. Wall dimensions'),
    h('div', { class: 'grid' }, fieldRow(FIELD.width, 'Width', widthInput), fieldRow(FIELD.height, 'Height', heightInput)),
    h('div', { class: 'field inline' }, h('span', { class: 'label-text' }, 'Unit of width and height'), dimensionUnit),
    areaReadout,
  );

  const insideInput = textInput(draft.insideTemperatureText, (t) => (draft = setInsideTemperature(draft, t)));
  const outsideInput = textInput(draft.outsideTemperatureText, (t) => (draft = setOutsideTemperature(draft, t)));
  const durationInput = textInput(draft.durationText, (t) => (draft = setDuration(draft, t)));
  const temperatureUnit = unitSelect(TEMPERATURE_UNITS, draft.temperatureUnit, 'Temperature unit', (u) => (draft = setTemperatureUnit(draft, u)));

  const surfaceModeSelect = h('select', { id: 'f-surface-mode' });
  for (const [value, text] of [
    ['preset-horizontal', 'Preset for horizontal heat flow: R_si 0.13, R_se 0.04 m²·K/W (UNVERIFIED: not yet checked against ISO 6946)'],
    ['custom', 'Custom values (entered below)'],
  ] as Array<[SurfaceMode, string]>) {
    const option = h('option', { value }, text);
    option.selected = value === draft.surfaceMode;
    surfaceModeSelect.append(option);
  }
  surfaceModeSelect.addEventListener('change', () => {
    draft = setSurfaceMode(draft, surfaceModeSelect.value as SurfaceMode);
    syncStaticInputs();
    refresh();
  });
  const surfaceInsideInput = textInput(draft.surfaceInsideText, (t) => (draft = setSurfaceInside(draft, t)));
  const surfaceOutsideInput = textInput(draft.surfaceOutsideText, (t) => (draft = setSurfaceOutside(draft, t)));
  const customSurfaceBox = h(
    'div',
    { class: 'grid', 'data-role': 'custom-surface' },
    fieldRow(FIELD.surfaceInside, 'Internal surface resistance R_si (m²·K/W)', surfaceInsideInput),
    fieldRow(FIELD.surfaceOutside, 'External surface resistance R_se (m²·K/W)', surfaceOutsideInput),
  );

  const boundarySection = h(
    'section',
    { 'aria-labelledby': 'h-boundary' },
    h('h2', { id: 'h-boundary' }, '3. Boundary conditions'),
    h(
      'div',
      { class: 'grid' },
      fieldRow(FIELD.insideTemperature, 'Inside air temperature', insideInput),
      fieldRow(FIELD.outsideTemperature, 'Outside air temperature', outsideInput),
    ),
    h('div', { class: 'field inline' }, h('span', { class: 'label-text' }, 'Temperature unit'), temperatureUnit),
    h('div', { class: 'grid' }, fieldRow(FIELD.duration, 'Duration of the energy estimate (hours)', durationInput)),
    h('div', { class: 'field' }, h('label', { for: 'f-surface-mode' }, 'Surface (air-film) resistances'), surfaceModeSelect),
    customSurfaceBox,
    h(
      'p',
      { class: 'note' },
      'Surface resistances depend on the direction of heat flow and the purpose of the assessment, so they are never applied silently. ' +
        'The preset is shown here as an explicit, unverified choice; confirm the values against the applicable standard before relying on them.',
    ),
  );

  // ---- layers section --------------------------------------------------------------------

  const layersList = h('ol', { class: 'layers', 'aria-label': 'Wall layers from interior to exterior' });
  const layersMessage = h('div', { id: `msg-${fieldDomId(FIELD.layers)}`, class: 'msg', role: 'alert' });
  messages.set(FIELD.layers, layersMessage);
  const filterInput = h('input', { type: 'search', id: 'f-material-filter', placeholder: 'e.g. wool, plaster, XPS', autocomplete: 'off' });
  filterInput.addEventListener('input', () => {
    materialFilter = filterInput.value;
    renderLayers();
  });
  const addButton = h('button', { type: 'button', class: 'primary', 'data-focus-id': 'add-layer' }, 'Add layer (exterior end)');
  addButton.addEventListener('click', () => {
    draft = addLayer(draft);
    announce(`Layer ${draft.layers.length} added at the exterior end. Choose a material and enter a thickness.`);
    renderLayers();
    refresh();
    focusById(`${draft.layers.at(-1)?.key}:material`);
  });
  const resetButton = h('button', { type: 'button', 'data-focus-id': 'reset' }, 'Reset to example wall');
  resetButton.addEventListener('click', () => {
    draft = createInitialDraft(materials);
    syncStaticInputs();
    renderLayers();
    refresh();
    announce('Wall reset to the example configuration.');
  });
  const status = h('div', { id: 'announcer', class: 'visually-hidden', role: 'status', 'aria-live': 'polite' });

  const layersSection = h(
    'section',
    { 'aria-labelledby': 'h-layers' },
    h('h2', { id: 'h-layers' }, '2. Layers (interior → exterior)'),
    h(
      'div',
      { class: 'field' },
      h('label', { for: 'f-material-filter' }, 'Filter the material lists'),
      filterInput,
    ),
    h('div', { class: 'face face-interior' }, h('strong', {}, 'INTERIOR FACE'), ' — inside of the building (heated side)'),
    layersList,
    h('div', { class: 'face face-exterior' }, h('strong', {}, 'EXTERIOR FACE'), ' — outside of the building (weather side)'),
    layersMessage,
    h('div', { class: 'actions' }, addButton, resetButton),
  );

  // ---- summary --------------------------------------------------------------------------------

  const summary = h('section', { id: 'summary', 'aria-labelledby': 'h-summary', 'aria-live': 'polite' });

  // ---- 3D panel ------------------------------------------------------------------------------------------
  const viewerPanel = createViewerPanel({
    ...(options.viewerFactory ? { viewerFactory: options.viewerFactory } : {}),
    onSelectionChange: () => refreshSelectionUi(),
    announce: (text) => announce(text),
  });

  // ---- page skeleton -----------------------------------------------------------------------------

  root.replaceChildren(
    h(
      'header',
      { class: 'page-header' },
      h('h1', {}, 'Wall Thermal Simulator'),
      h('p', { class: 'subtitle' }, 'Multilayer wall editor with a 3D view — Stage 5. Calculation results, temperature profiles and reports come in later stages.'),
      h('p', { class: 'policy', role: 'note' }, DATA_POLICY),
    ),
    h(
      'main',
      { class: 'layout' },
      h('div', { class: 'editor' }, dimensionsSection, layersSection, boundarySection, summary),
      h('aside', { class: 'viewer-column', 'aria-label': '3D view' }, viewerPanel.element),
    ),
    status,
  );

  // ---- rendering ------------------------------------------------------------------------------------

  function announce(text: string): void {
    status.textContent = text;
  }

  /**
   * Moves keyboard focus to the element tagged `data-focus-id=id`. A disabled
   * button cannot hold focus (e.g. "move toward exterior" once a layer has
   * reached the exterior end), so `fallbackId` is tried instead.
   */
  function focusById(id: string, fallbackId?: string): void {
    const candidates = [id, fallbackId].filter((value): value is string => value !== undefined);
    for (const wanted of candidates) {
      for (const element of root.querySelectorAll<HTMLElement>('[data-focus-id]')) {
        if (element.dataset.focusId === wanted && !(element instanceof HTMLButtonElement && element.disabled)) {
          element.focus();
          return;
        }
      }
    }
  }

  /** Copies the draft's text into the static inputs (after a unit change or reset). */
  function syncStaticInputs(): void {
    widthInput.value = draft.widthText;
    heightInput.value = draft.heightText;
    dimensionUnit.value = draft.dimensionUnit;
    insideInput.value = draft.insideTemperatureText;
    outsideInput.value = draft.outsideTemperatureText;
    temperatureUnit.value = draft.temperatureUnit;
    durationInput.value = draft.durationText;
    surfaceModeSelect.value = draft.surfaceMode;
    surfaceInsideInput.value = draft.surfaceInsideText;
    surfaceOutsideInput.value = draft.surfaceOutsideText;
  }

  function materialOptions(selectedId: string | null): HTMLElement[] {
    let list = searchMaterials(materials, { text: materialFilter });
    const selected = selectedId === null ? undefined : materials.find((m) => m.id === selectedId);
    if (selected && !list.includes(selected)) list = [selected, ...list]; // never hide the current choice
    const groups: HTMLElement[] = [];
    for (const category of MATERIAL_CATEGORIES) {
      const inGroup = list.filter((m) => m.category === category);
      if (inGroup.length === 0) continue;
      groups.push(
        h(
          'optgroup',
          { label: category },
          ...inGroup.map((m) => {
            const option = h('option', { value: m.id }, `${m.name} — ${(STATUS_TEXT[m.status] ?? m.status).toLowerCase()}`);
            option.selected = m.id === selectedId;
            return option;
          }),
        ),
      );
    }
    return groups;
  }

  function renderLayers(): void {
    const active = document.activeElement;
    const focusId = active instanceof HTMLElement && root.contains(active) ? (active.dataset.focusId ?? null) : null;

    for (const field of [...inputs.keys()]) {
      if (field.startsWith('layer:')) {
        inputs.delete(field);
        messages.delete(field);
      }
    }
    const views = describeLayers(draft, materials);
    layersList.replaceChildren(...views.map((view) => renderLayer(view, views.length)));
    if (views.length === 0) {
      layersList.append(h('li', { class: 'empty' }, 'No layers yet. Use "Add layer" to start building the wall.'));
    }
    if (focusId) focusById(focusId);
    refreshSelectionUi();
  }

  function renderLayer(view: LayerView, count: number): HTMLElement {
    const { key, position } = view;
    const materialSelect = h('select', { 'data-focus-id': `${key}:material` });
    materialSelect.append(h('option', { value: '' }, '— select a material —'), ...materialOptions(draft.layers[position - 1]?.materialId ?? null));
    materialSelect.value = draft.layers[position - 1]?.materialId ?? '';
    materialSelect.addEventListener('change', () => {
      draft = setLayerMaterial(draft, key, materialSelect.value);
      renderLayers();
      refresh();
    });

    const thicknessInput = textInput(draft.layers[position - 1]?.thicknessText ?? '', (t) => (draft = setLayerThickness(draft, key, t)));
    thicknessInput.setAttribute('data-focus-id', `${key}:thickness`);
    const unit = unitSelect(lengthOptions(), draft.layers[position - 1]?.thicknessUnit ?? 'mm', `Thickness unit of layer ${position}`, (u) => (draft = setLayerThicknessUnit(draft, key, u)));
    unit.setAttribute('data-focus-id', `${key}:unit`);
    const metres = h('span', { class: 'metres', 'data-role': 'thickness-m', 'data-key': key });

    const button = (text: string, label: string, focusId: string, disabled: boolean, onClick: () => void): HTMLButtonElement => {
      const b = h('button', { type: 'button', 'aria-label': label, 'data-focus-id': focusId, disabled }, text);
      b.addEventListener('click', onClick);
      return b;
    };
    const move = (direction: 'toward-interior' | 'toward-exterior', focusId: string, fallbackId: string): void => {
      draft = moveLayer(draft, key, direction);
      const newPosition = draft.layers.findIndex((l) => l.key === key) + 1;
      announce(`Layer moved to position ${newPosition} of ${draft.layers.length}${newPosition === 1 ? ' (interior face)' : newPosition === draft.layers.length ? ' (exterior face)' : ''}.`);
      renderLayers();
      refresh();
      focusById(focusId, fallbackId);
    };

    const inspect = h('button', { type: 'button', 'aria-label': `Inspect layer ${position} in the 3D view`, 'aria-pressed': 'false', 'data-focus-id': `${key}:inspect`, 'data-role': 'inspect' }, 'Inspect');
    inspect.addEventListener('click', () => {
      if (!viewerPanel.hasLayer(key)) {
        announce(`Layer ${position} is not drawn yet. Choose a material and enter a valid thickness first.`);
        return;
      }
      viewerPanel.select(viewerPanel.getSelected() === key ? null : key);
    });
    const faceTags = view.faces.map((f) => h('span', { class: `tag tag-${f}` }, f === 'interior' ? 'Interior face' : 'Exterior face'));
    const name = view.material?.name ?? 'No material selected';

    const item = h(
      'li',
      { class: 'layer', 'data-key': key },
      h(
        'div',
        { class: 'layer-head' },
        view.material ? h('span', { class: 'swatch', style: `background:${colorForCategory(view.material.category)}`, 'aria-hidden': 'true' }) : null,
        h('span', { class: 'pos' }, `Layer ${position}`),
        ...faceTags,
        h('span', { class: 'layer-name' }, name),
        h(
          'span',
          { class: 'layer-buttons' },
          inspect,
          button('↑', `Move layer ${position} toward the interior`, `${key}:up`, position === 1, () => move('toward-interior', `${key}:up`, `${key}:down`)),
          button('↓', `Move layer ${position} toward the exterior`, `${key}:down`, position === count, () => move('toward-exterior', `${key}:down`, `${key}:up`)),
          button('Remove', `Remove layer ${position}`, `${key}:remove`, false, () => {
            draft = removeLayer(draft, key);
            announce(`Layer ${position} removed.`);
            renderLayers();
            refresh();
            focusById('add-layer');
          }),
        ),
      ),
      h('div', { class: 'grid' }, fieldRow(layerField(key, 'material'), `Material (layer ${position})`, materialSelect), fieldRow(layerField(key, 'thickness'), `Thickness (layer ${position})`, thicknessInput, [unit, metres])),
      renderProperties(view),
    );
    return item;
  }

  function renderProperties(view: LayerView): HTMLElement {
    const m = view.material;
    if (!m) return h('p', { class: 'props missing' }, 'Thermal properties: not available until a material is selected.');
    const prop = (label: string, value: number | undefined, unit: string): HTMLElement =>
      value === undefined
        ? h('span', { class: 'prop missing' }, h('span', { class: 'k' }, label), ' ', h('span', { class: 'badge badge-missing' }, 'missing'))
        : h('span', { class: 'prop' }, h('span', { class: 'k' }, label), ' ', `${show(value)} ${unit}`);
    return h(
      'div',
      { class: 'props' },
      h(
        'p',
        {},
        prop('λ', m.lambdaWPerMK, 'W/(m·K)'),
        ' ',
        prop('ρ', m.densityKgPerM3, 'kg/m³'),
        ' ',
        prop('c_p', m.specificHeatJPerKgK, 'J/(kg·K)'),
        ' ',
        h('span', { class: `badge badge-${m.status}` }, STATUS_TEXT[m.status] ?? m.status),
        ' ',
        h('span', { class: 'badge badge-type' }, `Value type: ${m.valueType}`),
      ),
      m.missingProperties.length > 0
        ? h('p', { class: 'msg warning' }, `Warning: ${m.missingProperties.join(' and ')} not available, so heat capacity cannot be calculated for this layer.`)
        : null,
      h(
        'details',
        {},
        h('summary', {}, 'Data status and source notes'),
        h('ul', {}, ...m.notices.map((n) => h('li', {}, n))),
        h('p', {}, h('strong', {}, 'Source type: '), m.sourceType, '. ', h('strong', {}, 'Citation: '), m.sourceCitation),
        m.conditions ? h('p', {}, h('strong', {}, 'Conditions: '), m.conditions) : null,
      ),
    );
  }

  /** Marks the selected layer's card and Inspect button (selection lives in the 3D panel). */
  function refreshSelectionUi(): void {
    const selected = viewerPanel.getSelected();
    for (const card of layersList.querySelectorAll<HTMLElement>('li.layer')) {
      const isSelected = card.dataset.key === selected;
      card.classList.toggle('selected', isSelected);
      card.querySelector('[data-role="inspect"]')?.setAttribute('aria-pressed', String(isSelected));
    }
  }

  /** Re-validates the draft and updates every message, readout and the summary. */
  function refresh(): void {
    result = buildWall(draft, materials);

    for (const [field, input] of inputs) {
      const error = errorFor(result, field);
      const warning = warningFor(result, field);
      input.setAttribute('aria-invalid', error ? 'true' : 'false');
      const message = messages.get(field);
      if (message) {
        message.textContent = error ? `Error: ${error}` : warning ? `Warning: ${warning}` : '';
        message.className = `msg ${error ? 'error' : warning ? 'warning' : ''}`;
      }
    }
    const layersError = errorFor(result, FIELD.layers);
    const layersWarning = warningFor(result, FIELD.layers);
    layersMessage.textContent = layersError ? `Error: ${layersError}` : layersWarning ? `Warning: ${layersWarning}` : '';
    layersMessage.className = `msg ${layersError ? 'error' : layersWarning ? 'warning' : ''}`;

    customSurfaceBox.hidden = draft.surfaceMode !== 'custom';

    const views = describeLayers(draft, materials);
    for (const view of views) {
      for (const element of layersList.querySelectorAll<HTMLElement>('[data-role="thickness-m"]')) {
        if (element.dataset.key === view.key) {
          element.textContent = view.thicknessM === null ? '= — m' : `= ${show(view.thicknessM, 6)} m`;
        }
      }
    }

    areaReadout.textContent = result.wall
      ? `Wall area: ${show(result.wall.widthM * result.wall.heightM, 6)} m²  (${show(result.wall.widthM, 6)} m × ${show(result.wall.heightM, 6)} m)`
      : 'Wall area: — (enter valid width and height)';

    renderSummary(views);

    // The 3D view is drawn only from a VALID wall; with errors it keeps the last valid one.
    viewerPanel.setWall(result.wall ? { spec: wallSpecFromViews(result.wall, views), views } : null, !result.ok);
    refreshSelectionUi();
  }

  function renderSummary(views: LayerView[]): void {
    const wall = result.wall;
    const dataStatus = summarizeDataStatus(views);
    const parts: Child[] = [h('h2', { id: 'h-summary' }, 'Wall configuration')];

    if (result.ok && wall) {
      parts.push(h('p', { class: 'status ok' }, '✔ Valid configuration: ready to be passed to the calculation engine.'));
    } else {
      parts.push(
        h('p', { class: 'status bad' }, `✖ ${result.errors.length} problem${result.errors.length === 1 ? '' : 's'} to fix before this wall can be calculated:`),
        h('ul', { class: 'problems' }, ...result.errors.map((e) => h('li', {}, e.message))),
      );
    }
    if (result.warnings.length > 0) {
      parts.push(h('p', {}, h('strong', {}, 'Warnings:')), h('ul', { class: 'warnings' }, ...result.warnings.map((w) => h('li', {}, w.message))));
    }
    if (dataStatus.anyNotVerified) {
      parts.push(
        h(
          'div',
          { class: 'callout', role: 'note' },
          h('strong', {}, 'Unverified material data. '),
          `These layers use values that are not verified reference data: ${dataStatus.notVerified.join('; ')}. ` +
            'Do not treat any result as an approved Cypriot design value.',
        ),
      );
    }

    // Layer table: what the engine will receive, in SI units.
    const rows = views.map((view) =>
      h(
        'tr',
        {},
        h('td', {}, String(view.position)),
        h('td', {}, view.material?.name ?? '— none —', ...view.faces.map((f) => h('span', { class: `tag tag-${f}` }, f === 'interior' ? 'interior face' : 'exterior face'))),
        h('td', { class: 'num' }, view.thicknessM === null ? '—' : show(view.thicknessM, 6)),
        h('td', { class: 'num' }, view.material ? show(view.material.lambdaWPerMK) : '—'),
        h('td', {}, view.material ? h('span', { class: `badge badge-${view.material.status}` }, STATUS_TEXT[view.material.status] ?? view.material.status) : h('span', { class: 'badge badge-missing' }, 'missing')),
      ),
    );
    parts.push(
      h(
        'div',
        { class: 'table-wrap' },
        h(
        'table',
        {},
        h('caption', {}, 'Layers, interior to exterior (thickness in metres)'),
        h('thead', {}, h('tr', {}, ...['#', 'Material', 'Thickness (m)', 'λ (W/(m·K))', 'Data status'].map((t) => h('th', { scope: 'col' }, t)))),
        h('tbody', {}, ...rows),
        ),
      ),
    );

    if (wall) {
      const total = wall.layers.reduce((sum, l) => sum + l.thicknessM, 0);
      const sr = wall.surfaceResistances;
      parts.push(
        h(
          'dl',
          { class: 'facts' },
          ...fact('Size', `${show(wall.widthM, 6)} m × ${show(wall.heightM, 6)} m = ${show(wall.widthM * wall.heightM, 6)} m²`),
          ...fact('Total thickness', `${show(total, 6)} m`),
          ...fact('Air temperatures', `inside ${show(wall.conditions.insideTemperatureC, 6)} °C, outside ${show(wall.conditions.outsideTemperatureC, 6)} °C`),
          ...fact('Duration', `${show(wall.conditions.durationHours, 6)} h`),
          ...fact('Surface resistances', `R_si ${show(sr.insideM2KPerW)}, R_se ${show(sr.outsideM2KPerW)} m²·K/W (${sr.status}, ${sr.heatFlowOrientation} heat flow)`),
        ),
        h('details', {}, h('summary', {}, 'Engine input (SI units, JSON)'), h('pre', {}, JSON.stringify(wall, null, 2))),
      );
    }
    summary.replaceChildren(...(parts.filter(Boolean) as Node[]));
  }

  function fact(term: string, value: string): HTMLElement[] {
    return [h('dt', {}, term), h('dd', {}, value)];
  }

  renderLayers();
  refresh();

  return {
    getDraft: () => draft,
    getResult: () => result,
    viewer: viewerPanel,
    ready: viewerPanel.ready,
    destroy: () => viewerPanel.destroy(),
  };
}
