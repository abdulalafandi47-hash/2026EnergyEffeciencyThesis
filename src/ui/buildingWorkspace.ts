/**
 * The BUILDING ENVELOPE workspace: compact sidebar (project, house geometry,
 * condition, component list and component editor), a dominant 3D view of the
 * house, and a compact results panel.
 *
 * This file only displays the model and forwards edits to the envelope module,
 * which validates and calculates. Typed numbers are checked here first: an
 * invalid entry shows a message and is NOT written into the model, so the model
 * and the results always describe valid input.
 */
import {
  addComponent,
  calculateEnvelope,
  canAdd,
  COMPONENT_TYPE_LABEL,
  createBlankProject,
  createExampleHouse,
  deleteComponent,
  dependentsOf,
  dimensionsOf,
  duplicateComponent,
  EXAMPLE_NOTE,
  freeSides,
  isGlazing,
  isOpening,
  parseProject,
  serializeProject,
  setVisible,
  sideLength,
  updateComponent,
} from '../envelope';
import type { BuildingProject, Component, ComponentResult, ComponentType, Construction, DocumentedValue, EnvelopeResult, Exposure, Side } from '../envelope';
import { parseNumberInput } from '../editor';
import { BUILT_IN_MATERIALS, MATERIAL_CATEGORIES, THERMAL_VALUE_TYPES } from '../materials';
import type { MaterialRecord, ThermalValueType } from '../materials';
import type { HouseViewerFactory } from '../viewer3d';
import { buildBuildingReport, buildingReportFileBase, renderBuildingJson, renderElementsCsv, renderHtml, renderMarkdown } from '../report';
import { createBuildingResultsPanel, flowWords, STATUS_LABEL } from './buildingResults';
import type { BuildingReportFormat } from './buildingResults';
import { h, show, tableRegion } from './dom';
import type { Child } from './dom';
import { helpTip } from './glossary';
import type { GlossaryTerm } from './glossary';
import { houseSpecFromProject, fluxView } from './houseSpec';
import { History, isTextEntry, undoShortcut } from './history';
import { DEFAULT_UNITS, DIFFERENCE_SYMBOL, readTemperature, readThickness, showDifference, showTemperature, showThickness, TEMPERATURE_SYMBOL } from './units';
import type { LengthUnit, TemperatureUnit, UnitChoice } from './units';
import { addResultsResizer, makeCollapsible } from './layoutControls';
import type { Collapsible } from './layoutControls';
import { createHouseViewerPanel } from './houseViewerPanel';
import type { HouseViewerPanel } from './houseViewerPanel';
import { browserIo } from './io';
import type { FileIo } from './io';
import { browserStore, ProjectLibrary, readKey, removeKey, STORAGE_KEYS, writeKey } from './storage';
import type { KeyValueStore, LibraryEntry } from './storage';

export interface BuildingWorkspaceOptions {
  houseViewerFactory?: HouseViewerFactory;
  /** The current material list (built-in and the custom materials made in single-wall mode). */
  getMaterials?: () => readonly MaterialRecord[];
  /** Asks before replacing or deleting; the browser's confirm dialog by default (tests pass their own). */
  confirm?: (message: string) => boolean;
  /** Extra control for the top bar (the mode switch). */
  topbarExtra?: HTMLElement;
  /** Downloads and the clock; the browser version by default (tests pass their own). */
  io?: FileIo;
  /** Browser storage for the project library and the last project; the browser's by default, null for none. */
  store?: KeyValueStore | null;
  /** Receives custom materials that arrive with an opened or restored project (they join the session's materials). */
  onImportMaterials?: (records: readonly MaterialRecord[]) => void;
  /** Units to show and type in (shared with the wall calculator); °C and mm by default. */
  initialUnits?: UnitChoice;
  /** Called when the user chooses other units here. */
  onUnitsChange?: (units: UnitChoice) => void;
}

/** Result of opening a project file. */
export type OpenProjectOutcome = { ok: true; warnings: string[] } | { ok: false; error: string };

export interface BuildingWorkspaceHandle {
  getProject(): BuildingProject;
  setProject(project: BuildingProject): void;
  getResult(): EnvelopeResult;
  getSelected(): string | null;
  select(id: string | null): void;
  /** Shows and reads values in these units (the model stays in °C and metres). */
  setUnits(units: UnitChoice): void;
  getUnits(): UnitChoice;
  /** Takes back / repeats the last change of the project (false when there is nothing to undo or redo). */
  undo(): boolean;
  redo(): boolean;
  /** Replaces the project with the text of a project file (asks first if there are unsaved changes). */
  openProjectText(text: string, filename?: string): OpenProjectOutcome;
  /** Saves the project in this browser's project library; false if the browser refused. */
  saveToLibrary(asCopy?: boolean): boolean;
  /** Loads the example house / starts a blank project (asks first if unsaved work would be lost). */
  loadExample(): void;
  newBlank(): void;
  library: ProjectLibrary;
  viewer: HouseViewerPanel;
  ready: Promise<void>;
  destroy(): void;
}

const ADDABLE: ComponentType[] = ['exterior-wall', 'window', 'glazed-door', 'door', 'roof', 'floor', 'partition'];
const SIDE_LABEL: Record<Side, string> = { north: 'North', east: 'East', south: 'South', west: 'West' };
const EXPOSURE_LABEL: Record<Exposure['kind'], string> = {
  outside: 'Outdoor air',
  unconditioned: 'Unconditioned space (enter its temperature)',
  ground: 'Ground (not supported in this stage)',
  conditioned: 'Conditioned space at the same temperature (not counted)',
};
const EXPOSURES: Record<string, Array<Exposure['kind']>> = {
  'exterior-wall': ['outside', 'unconditioned'],
  partition: ['conditioned', 'unconditioned'],
  roof: ['outside', 'unconditioned'],
  floor: ['ground', 'outside', 'unconditioned'],
};
const STATUS_TEXT: Record<string, string> = { verified: 'verified', unverified: 'unverified', illustrative: 'illustrative', 'user-defined': 'user-defined' };

export function mountBuildingWorkspace(root: HTMLElement, options: BuildingWorkspaceOptions = {}): BuildingWorkspaceHandle {
  const materials = (): readonly MaterialRecord[] => options.getMaterials?.() ?? BUILT_IN_MATERIALS;
  const confirmAction = options.confirm ?? ((message: string) => window.confirm(message));
  const io = options.io ?? browserIo;
  const store = options.store === undefined ? browserStore() : options.store;
  const library = new ProjectLibrary(store);
  let project: BuildingProject = createBlankProject();
  let units: UnitChoice = options.initialUnits ?? DEFAULT_UNITS;
  const tUnit = (): string => TEMPERATURE_SYMBOL[units.temperature];
  /** The library entry this project was last saved to or opened from (null: not in the library). */
  let libraryId: string | null = null;
  /** The project's file text when it was last saved, opened or loaded; null for a project never saved. */
  let savedText: string | null = null;
  /** Where the current project came from, for the status line. */
  let origin = '';
  // ---- undo / redo ----
  const history = new History<BuildingProject>();
  /** The project as last drawn; a different one in refresh() means a change to record. */
  let lastSeen: BuildingProject | null = null;
  let applyingHistory = false;
  /** Time of the last typed character (an 'input' event), to merge typing into one undo step. */
  let lastTypedAt = Number.NEGATIVE_INFINITY;
  let result: EnvelopeResult = calculateEnvelope(project, materials());
  let selected: string | null = null;
  let editorKey = '';

  const announcer = h('div', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite' });
  const announce = (text: string): void => void (announcer.textContent = text);

  // ---- helpers ------------------------------------------------------------------------------------
  /** Re-renders a part of the page and puts the keyboard focus back where it was (by data-focus-id). */
  function keepingFocus(render: () => void): void {
    const active = document.activeElement;
    const id = active instanceof HTMLElement ? active.dataset.focusId : undefined;
    render();
    if (id) root.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(id)}"]`)?.focus();
  }

  /**
   * A text box for a number. Valid input is passed to `onValid`; anything else shows a message and
   * changes nothing. `check` adds rules such as "greater than zero".
   */
  function numberField(focusId: string, label: string, unit: string, value: number | null, onValid: (n: number | null) => void, check: (n: number) => string | null = () => null, allowEmpty = false): HTMLElement {
    const id = `b-${focusId}`;
    const input = h('input', { type: 'text', inputmode: 'decimal', autocomplete: 'off', id, 'data-focus-id': focusId, 'aria-describedby': `${id}-msg` });
    input.value = value === null ? '' : String(Number(value.toPrecision(12)));
    const msg = h('div', { class: 'msg', id: `${id}-msg` });
    input.addEventListener('input', () => {
      const parsed = parseNumberInput(input.value);
      let error: string | null = null;
      if (!parsed.ok) error = parsed.reason === 'empty' ? (allowEmpty ? null : `Enter ${label.toLowerCase()}.`) : `${label} must be a number (no units or letters).`;
      else error = check(parsed.value);
      msg.textContent = error ? `Error: ${error}` : '';
      msg.className = `msg ${error ? 'error' : ''}`;
      input.setAttribute('aria-invalid', String(Boolean(error)));
      if (!error) onValid(parsed.ok ? parsed.value : null);
    });
    return h('div', { class: 'field' }, h('label', { for: id }, `${label}${unit ? ` (${unit})` : ''}`), input, msg);
  }
  const positive = (n: number): string | null => (n > 0 ? null : 'It must be greater than zero.');
  const nonNegative = (n: number): string | null => (n >= 0 ? null : 'It cannot be negative.');
  /** Rule for a temperature typed in the current unit. */
  const temperature = (n: number): string | null => (readTemperature(n, units.temperature) >= -273.15 ? null : `It cannot be below absolute zero (${show(showTemperature(-273.15, units.temperature), 5)} ${tUnit()}).`);
  /** A temperature field in the chosen unit; the model receives °C. */
  const temperatureField = (focusId: string, label: string, celsius: number | null, onValid: (c: number | null) => void, allowEmpty = false): HTMLElement =>
    numberField(focusId, label, tUnit(), celsius === null ? null : showTemperature(celsius, units.temperature), (n) => onValid(n === null ? null : readTemperature(n, units.temperature)), temperature, allowEmpty);
  const unitSelect = <T extends string>(focusId: string, label: string, choices: Array<[T, string]>, value: T, onChange: (v: T) => void): HTMLElement => selectField(focusId, label, choices, value, onChange);
  function setUnits(next: UnitChoice, tell = true): void {
    if (next.temperature === units.temperature && next.thickness === units.thickness) return;
    units = next;
    renderProjectInputs();
    keepingFocus(renderEditor);
    refresh();
    if (tell) options.onUnitsChange?.(units);
  }

  function textField(focusId: string, label: string, value: string, onInput: (text: string) => void, max = 200): HTMLElement {
    const id = `b-${focusId}`;
    const input = h('input', { type: 'text', autocomplete: 'off', id, 'data-focus-id': focusId, maxlength: String(max) });
    input.value = value;
    input.addEventListener('input', () => onInput(input.value));
    return h('div', { class: 'field' }, h('label', { for: id }, label), input);
  }

  function selectField<T extends string>(focusId: string, label: string, choices: Array<[T, string]>, value: T, onChange: (v: T) => void): HTMLElement {
    const id = `b-${focusId}`;
    const select = h('select', { id, 'data-focus-id': focusId });
    for (const [v, text] of choices) select.append(h('option', { value: v }, text));
    select.value = value;
    select.addEventListener('change', () => onChange(select.value as T));
    return h('div', { class: 'field' }, h('label', { for: id }, label), select);
  }

  // ---- model changes ------------------------------------------------------------------------------
  /** Writes an edit into the model and refreshes everything except the editor's inputs. */
  function commit(next: BuildingProject, structural = false): void {
    project = next;
    if (selected && !project.components.some((c) => c.id === selected)) selected = null;
    refresh();
    if (structural) keepingFocus(renderEditor);
  }
  const commitComponent = (c: Component, structural = false): void => commit(updateComponent(project, c), structural);
  const current = (): Component | undefined => project.components.find((c) => c.id === selected);

  function select(id: string | null): void {
    selected = id !== null && project.components.some((c) => c.id === id) ? id : null;
    if (selected) folds.editor.setOpen(true);
    viewerPanel.select(selected);
    renderEditor();
    refresh();
    const c = current();
    announce(c ? `${c.name} selected (${COMPONENT_TYPE_LABEL[c.type]}).` : 'No component selected.');
  }

  // ---- static sections ----------------------------------------------------------------------------
  const projectNameHost = h('div', { class: 'b-project-name' });
  const exampleNote = h('p', { class: 'callout', role: 'note', 'data-role': 'b-example-note', hidden: true }, EXAMPLE_NOTE);
  const saveStatus = h('p', { class: 'note', 'data-role': 'b-save-status', role: 'status' });
  const fileMsg = h('p', { class: 'file-message', 'data-role': 'b-file-message', role: 'status' });
  const libraryList = h('ul', { class: 'b-library', 'data-role': 'b-library', 'aria-label': 'Projects saved in this browser' });
  const btn = (text: string, role: string, onClick: () => void, cls = ''): HTMLButtonElement => {
    const b = h('button', { type: 'button', 'data-role': role, 'data-focus-id': role, class: cls }, text);
    b.addEventListener('click', onClick);
    return b;
  };
  const textOf = (p: BuildingProject): string => serializeProject(p, materials());
  /** Changes since the last save or open (a blank, never-saved project has nothing to lose). */
  const isDirty = (): boolean => (savedText === null ? project.components.length > 0 : textOf(project) !== savedText);
  /** Asks before throwing away unsaved work; true = go ahead. */
  const okToReplace = (what: string): boolean =>
    !isDirty() || confirmAction(`${what} replaces the current project (${project.components.length} components)${savedText === null ? ', which is not saved' : ' and its unsaved changes'}. Save it or download it first if you want to keep it. Continue?`);
  const showFileMessage = (text: string, kind: 'ok' | 'warn' | 'bad'): void => {
    fileMsg.textContent = text;
    fileMsg.className = `file-message ${kind}`;
  };
  const replaceProject = (next: BuildingProject, what: string): void => {
    if (!okToReplace(what)) return;
    libraryId = null;
    savedText = null;
    origin = '';
    setProject(next);
    showFileMessage('', 'ok');
    announce(`${what}: done.`);
  };

  function saveToLibrary(asCopy = false): boolean {
    if (!library.available) {
      showFileMessage('This browser does not allow saving here (private window or blocked site data). Use "Download project file" to keep the project.', 'bad');
      return false;
    }
    const text = textOf(project);
    const entry = library.save(asCopy ? null : libraryId, project.name, text, io.now());
    if (!entry) {
      showFileMessage('The browser refused to save (its storage may be full). Download the project file to keep it.', 'bad');
      return false;
    }
    libraryId = entry.id;
    savedText = text;
    origin = '';
    writeKey(store, STORAGE_KEYS.lastBuildingLibraryId, entry.id);
    showFileMessage(`Saved "${entry.name}" in this browser${asCopy ? ' as a new copy' : ''}.`, 'ok');
    announce(`Project saved in this browser.`);
    renderProjectStatus();
    return true;
  }

  function openProjectText(text: string, filename = 'the file', fromLibrary: LibraryEntry | null = null): OpenProjectOutcome {
    const parsed = parseProject(text, BUILT_IN_MATERIALS);
    if (!parsed.ok) {
      showFileMessage(`Could not open ${filename}: ${parsed.error} The current project was not changed.`, 'bad');
      announce(`Could not open ${filename}. The current project was not changed.`);
      return parsed;
    }
    if (!okToReplace(`Opening ${filename}`)) return { ok: false, error: 'Cancelled: the current project was kept.' };
    options.onImportMaterials?.(parsed.customMaterials);
    libraryId = fromLibrary?.id ?? null;
    if (libraryId) writeKey(store, STORAGE_KEYS.lastBuildingLibraryId, libraryId);
    setProject(parsed.project);
    savedText = textOf(project);
    origin = fromLibrary ? '' : `Opened from ${filename}; not saved in this browser yet.`;
    renderProjectStatus();
    const extra = parsed.customMaterials.length > 0 ? ` (with ${parsed.customMaterials.length} custom material${parsed.customMaterials.length === 1 ? '' : 's'})` : '';
    showFileMessage(`Opened ${filename}${extra}${parsed.warnings.length > 0 ? ` with ${parsed.warnings.length} warning${parsed.warnings.length === 1 ? '' : 's'}: ${parsed.warnings.join(' ')}` : '.'}`, parsed.warnings.length > 0 ? 'warn' : 'ok');
    announce(`Opened ${filename}.`);
    return { ok: true, warnings: parsed.warnings };
  }

  const fileInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true, 'data-role': 'b-open-input', 'aria-label': 'Building project file to open' });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    void file.text().then((text) => openProjectText(text, file.name), () => showFileMessage(`Could not read ${file.name}.`, 'bad'));
  });
  const fileName = (): string => `${(project.name.trim() || 'building').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'building'}.building.json`;

  function renderProjectStatus(): void {
    const entry = libraryId ? library.list().find((e) => e.id === libraryId) : undefined;
    const when = (iso: string): string => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    saveStatus.textContent = !library.available
      ? 'Saving in this browser is not available here; download the project file to keep it.'
      : entry
        ? `${isDirty() ? 'Unsaved changes. ' : ''}Last saved in this browser ${when(entry.savedAt)}.`
        : origin || (project.components.length === 0 ? 'Not saved yet.' : 'Not saved in this browser yet.');
    const entries = library.list();
    libraryList.replaceChildren(
      ...(entries.length === 0
        ? [h('li', { class: 'empty' }, library.available ? 'No saved projects yet. "Save" keeps the current one here.' : 'Not available in this browser.')]
        : entries.map((e) => {
            const open = h('button', { type: 'button', class: 'tool', 'aria-label': `Open saved project ${e.name}`, 'data-focus-id': `lib-open-${e.id}` }, 'Open');
            open.addEventListener('click', () => {
              const text = library.load(e.id);
              if (text === null) return showFileMessage(`The saved project "${e.name}" could not be read from this browser.`, 'bad');
              openProjectText(text, `"${e.name}"`, e);
            });
            const del = h('button', { type: 'button', class: 'tool danger', 'aria-label': `Delete saved project ${e.name}`, 'data-focus-id': `lib-del-${e.id}` }, 'Delete…');
            del.addEventListener('click', () => {
              if (!confirmAction(`Delete the saved project "${e.name}" from this browser? This cannot be undone (a downloaded file is not affected).`)) return;
              library.remove(e.id);
              if (libraryId === e.id) libraryId = null;
              announce(`Saved project ${e.name} deleted.`);
              renderProjectStatus();
            });
            return h('li', { class: `b-library-row${e.id === libraryId ? ' current' : ''}`, 'data-library-id': e.id }, h('span', { class: 'b-library-name' }, e.name, h('span', { class: 'b-type' }, when(e.savedAt))), h('span', { class: 'layer-buttons' }, open, del));
          })),
    );
  }

  const projectSection = h(
    'section',
    { 'aria-labelledby': 'b-h-project' },
    h('h2', { id: 'b-h-project' }, '1. Project'),
    projectNameHost,
    exampleNote,
    saveStatus,
    h('div', { class: 'actions' },
      btn('Save', 'b-save', () => void saveToLibrary(false), 'primary'),
      btn('Save as copy', 'b-save-copy', () => void saveToLibrary(true)),
      btn('Download project file', 'b-download', () => {
        io.download(fileName(), 'application/json', textOf(project) + '\n');
        announce('Project file downloaded.');
      }),
      btn('Open project file…', 'b-open', () => fileInput.click()),
      fileInput,
    ),
    fileMsg,
    h('details', { class: 'b-library-box', 'data-role': 'b-library-box' }, h('summary', {}, 'Projects saved in this browser'), libraryList, h('p', { class: 'note' }, 'Kept in this browser on this computer only. Download a project file to keep it safely or share it.')),
    h('div', { class: 'actions' },
      btn('New blank project', 'b-new', () => replaceProject(createBlankProject(), 'A new blank project')),
      btn('Load example house', 'b-example', () => replaceProject(createExampleHouse(materials()), 'Loading the example house')),
    ),
  );

  const geometryHost = h('div', {});
  const conditionsHost = h('div', {});
  const geometrySection = h('section', { 'aria-labelledby': 'b-h-geometry' }, h('h2', { id: 'b-h-geometry' }, '2. House (simplified box)'), geometryHost);
  const conditionsSection = h('section', { 'aria-labelledby': 'b-h-conditions' }, h('h2', { id: 'b-h-conditions' }, '3. Condition (steady state)'), conditionsHost);

  function renderProjectInputs(): void {
    const g = project.geometry;
    const setG = (patch: Partial<BuildingProject['geometry']>): void => commit({ ...project, isExample: false, geometry: { ...project.geometry, ...patch } });
    geometryHost.replaceChildren(
      h('div', { class: 'grid' },
        numberField('g-length', 'Length east–west', 'm', g.lengthM, (n) => setG({ lengthM: n as number }), positive),
        numberField('g-depth', 'Depth north–south', 'm', g.depthM, (n) => setG({ depthM: n as number }), positive),
        numberField('g-height', 'Storey height', 'm', g.heightM, (n) => setG({ heightM: n as number }), positive),
      ),
      h('p', { class: 'note' }, 'External dimensions. One conditioned zone, flat roof, one storey. Walls span whole sides (corners counted in both walls).'),
    );
    const c = project.conditions;
    const setC = (patch: Partial<BuildingProject['conditions']>): void => commit({ ...project, conditions: { ...project.conditions, ...patch } });
    conditionsHost.replaceChildren(
      textField('c-label', 'Name of this condition', c.label, (t) => setC({ label: t })),
      h('div', { class: 'grid' },
        temperatureField('c-inside', 'Inside air', c.insideC, (n) => setC({ insideC: n as number })),
        temperatureField('c-outside', 'Outdoor air', c.outsideC, (n) => setC({ outsideC: n as number })),
        numberField('c-duration', 'Duration', 'h', c.durationH, (n) => setC({ durationH: n as number }), nonNegative),
      ),
      h('p', { class: 'note' }, 'One constant condition for every element (steady state). These are values you choose, not Cyprus design data; no hourly weather is used in this stage.'),
      h('div', { class: 'grid b-units' },
        unitSelect<TemperatureUnit>('unit-temperature', 'Temperature unit', [['C', '°C'], ['K', 'K'], ['F', '°F']], units.temperature, (t) => setUnits({ ...units, temperature: t })),
        unitSelect<LengthUnit>('unit-thickness', 'Layer thickness unit', [['mm', 'mm'], ['cm', 'cm'], ['m', 'm']], units.thickness, (t) => setUnits({ ...units, thickness: t })),
      ),
      h('p', { class: 'note' }, 'Shared with the single-wall calculator. Calculations always use SI units (°C, m); only what you see and type changes. Reports use SI units.'),
    );
  }

  // ---- component list ------------------------------------------------------------------------------
  const list = h('ul', { class: 'b-list', 'aria-label': 'Building components', 'data-role': 'b-list' });
  const addType = h('select', { id: 'b-add-type', 'data-focus-id': 'b-add-type', 'aria-label': 'Type of component to add' });
  for (const type of ADDABLE) addType.append(h('option', { value: type }, COMPONENT_TYPE_LABEL[type]));
  const addMsg = h('p', { class: 'msg', 'data-role': 'b-add-msg', role: 'status' });
  const addButton = btn('Add', 'b-add', () => {
    const type = addType.value as ComponentType;
    const check = canAdd(project, type);
    if (!check.ok) {
      addMsg.textContent = check.reason ?? '';
      addMsg.className = 'msg error';
      return;
    }
    const host = current();
    const { project: next, id } = addComponent(project, type, isOpening({ type } as Component) && host?.type === 'exterior-wall' ? { hostId: host.id } : {});
    addMsg.textContent = '';
    addMsg.className = 'msg';
    commit(next);
    select(id);
    announce(`${COMPONENT_TYPE_LABEL[type]} added. Enter its properties in the editor.`);
  }, 'primary');
  const todo = h('div', { class: 'b-todo', 'data-role': 'b-todo' });
  const componentsSection = h(
    'section',
    { 'aria-labelledby': 'b-h-components' },
    h('h2', { id: 'b-h-components' }, '4. Components'),
    todo,
    list,
    h('div', { class: 'b-add-row' }, addType, addButton),
    addMsg,
    h('p', { class: 'note' }, 'Untick to hide an element in the 3D view; it is still calculated. Windows and doors are added to the selected wall (or the first wall).'),
  );

  /**
   * Where to type to fix a component that is not calculated: the data-focus-id of the field, or null
   * when nothing can be entered (unsupported or deliberately not counted).
   */
  function fixTarget(c: Component, r: ComponentResult): { componentId: string; focusId: string } | null {
    if (r.status !== 'missing-data' && r.status !== 'invalid') return null;
    const here = (focusId: string): { componentId: string; focusId: string } => ({ componentId: c.id, focusId });
    const layers = (construction: Construction): { componentId: string; focusId: string } => {
      if (construction.layers.length === 0) return here('layer-add');
      const i = construction.layers.findIndex((l) => l.materialId === null || !materials().some((m) => m.id === l.materialId));
      if (i >= 0) return here(`layer-${i}-mat`);
      const t = construction.layers.findIndex((l) => l.thicknessM === null || !(l.thicknessM > 0));
      return here(t >= 0 ? `layer-${t}-t` : 'layer-add');
    };
    if ('exposure' in c && c.exposure.kind === 'unconditioned' && c.exposure.temperatureC === null) return here('exposure-t');
    if (isGlazing(c) || (c.type === 'door' && c.spec.kind === 'u-value')) {
      const u = isGlazing(c) ? c.uValue : c.type === 'door' && c.spec.kind === 'u-value' ? c.spec.uValue : null;
      if (u === null) return here('u-value');
      if (u.source.trim() === '') return here('u-source');
      // With a valid U-value, a missing temperature of the host wall's space is fixed on the host wall.
      const host = project.components.find((w) => w.id === c.hostId);
      if (r.status === 'missing-data' && host && 'exposure' in host && host.exposure.kind === 'unconditioned' && host.exposure.temperatureC === null) return { componentId: host.id, focusId: 'exposure-t' };
      if (r.status === 'invalid' && r.reasons.some((x) => /U-value/.test(x))) return here('u-value');
      if (r.status === 'invalid' && r.reasons.some((x) => /g-value/.test(x))) return here('g-value');
      if (r.status === 'invalid' && r.reasons.some((x) => /Shading/.test(x))) return here('fc-value');
      return here('width');
    }
    if ('construction' in c) return layers(c.construction);
    if (c.type === 'door' && c.spec.kind === 'layers') return layers(c.spec.construction);
    return here('name');
  }

  /** Selects the component and puts the cursor in the field that needs data. */
  function goFix(target: { componentId: string; focusId: string }): void {
    folds.editor.setOpen(true);
    select(target.componentId);
    const field = root.querySelector<HTMLElement>(`[data-focus-id="${CSS.escape(target.focusId)}"]`);
    field?.scrollIntoView({ block: 'center' });
    field?.focus();
  }

  function renderTodo(): void {
    const items = result.components.flatMap((r) => {
      const c = project.components.find((x) => x.id === r.componentId);
      const target = c ? fixTarget(c, r) : null;
      return c && target ? [{ c, r, target }] : [];
    });
    const cannot = result.components.filter((r) => r.status === 'unsupported');
    todo.hidden = project.components.length === 0;
    keepingFocus(() => todo.replaceChildren(...([
      items.length === 0
        ? h('p', { class: 'b-todo-done' }, '✓ No data missing.')
        : h('details', { class: 'b-todo-box', open: true },
            h('summary', {}, `Missing data: ${items.length} element${items.length === 1 ? '' : 's'} not calculated`),
            h('ul', { 'data-role': 'b-todo-list' }, ...items.map(({ c, r, target }) => {
              const b = h('button', { type: 'button', class: 'b-todo-item', 'data-focus-id': `todo-${c.id}`, 'data-component': c.id }, h('strong', {}, c.name), h('span', {}, r.reasons[0] ?? 'Enter the missing data.'));
              b.addEventListener('click', () => goFix(target));
              return h('li', {}, b);
            })),
          ),
      cannot.length > 0 ? h('p', { class: 'note' }, `Cannot be calculated in this stage: ${cannot.map((r) => r.name).join(', ')} (see Not included).`) : null,
    ].filter(Boolean) as Node[])));
  }

  function renderList(): void {
    keepingFocus(() => {
      list.replaceChildren(
        ...project.components.map((c) => {
          const r = result.components.find((x) => x.componentId === c.id);
          const box = h('input', { type: 'checkbox', 'aria-label': `Show ${c.name} in the 3D view`, 'data-focus-id': `vis-${c.id}` });
          box.checked = c.visible;
          box.addEventListener('change', () => {
            commit(setVisible(project, c.id, box.checked), true);
            announce(`${c.name} ${box.checked ? 'shown' : 'hidden'} in the 3D view (its data and results are kept).`);
          });
          const pick = h('button', { type: 'button', class: 'b-pick', 'aria-pressed': String(c.id === selected), 'data-focus-id': `pick-${c.id}` }, h('span', { class: 'b-name' }, c.name), h('span', { class: 'b-type' }, COMPONENT_TYPE_LABEL[c.type]));
          pick.addEventListener('click', () => select(c.id === selected ? null : c.id));
          return h('li', { class: `b-row${c.id === selected ? ' selected' : ''}`, 'data-component': c.id }, box, pick, r ? h('span', { class: `status status-${r.status}`, title: r.reasons.join(' ') }, STATUS_LABEL[r.status]) : null);
        }),
      );
      if (project.components.length === 0) list.append(h('li', { class: 'empty' }, 'No components yet. Add walls, a roof, a floor, windows and doors below, or load the example house.'));
      for (const option of addType.options) {
        const check = canAdd(project, option.value as ComponentType);
        option.disabled = !check.ok;
        option.title = check.reason ?? '';
      }
    });
  }

  // ---- component editor ------------------------------------------------------------------------------
  const editorHost = h('div', { 'data-role': 'b-editor' });
  const selectedResults = h('div', { class: 'b-results', 'data-role': 'b-selected-results', 'aria-live': 'polite' });
  const dimsReadout = h('p', { class: 'readout', 'data-role': 'b-dims' });
  const editorSection = h('section', { 'aria-labelledby': 'b-h-editor' }, h('h2', { id: 'b-h-editor' }, '5. Selected component'), editorHost);

  function exposureEditor(c: Component & { exposure: Exposure }): Child[] {
    const kinds = EXPOSURES[c.type] ?? [];
    return [
      selectField('exposure', 'Other side', kinds.map((k) => [k, EXPOSURE_LABEL[k]] as [Exposure['kind'], string]), c.exposure.kind, (kind) => {
        const exposure: Exposure = kind === 'unconditioned' ? { kind, temperatureC: null } : { kind } as Exposure;
        const latest = current();
        if (latest && 'exposure' in latest) commitComponent({ ...latest, exposure } as Component, true);
      }),
      c.exposure.kind === 'unconditioned'
        ? temperatureField('exposure-t', 'Temperature of that space', c.exposure.temperatureC, (n) => {
            const latest = current();
            if (latest && 'exposure' in latest) commitComponent({ ...latest, exposure: { kind: 'unconditioned', temperatureC: n } } as Component);
          }, true)
        : null,
    ];
  }

  function constructionEditor(get: () => Construction | null, set: (c: Construction, structural: boolean) => void): HTMLElement {
    const construction = get() ?? { layers: [] };
    const mats = materials();
    const rows = construction.layers.map((layer, i) => {
      const sel = h('select', { id: `b-layer-${i}-mat`, 'data-focus-id': `layer-${i}-mat`, 'aria-label': `Material of layer ${i + 1}` }, h('option', { value: '' }, '— choose a material —'));
      for (const category of MATERIAL_CATEGORIES) {
        const of = mats.filter((m) => m.category === category);
        if (of.length > 0) sel.append(h('optgroup', { label: category }, ...of.map((m) => h('option', { value: m.id }, `${m.name} — ${STATUS_TEXT[m.status] ?? m.status}`))));
      }
      sel.value = layer.materialId ?? '';
      if (layer.materialId && !mats.some((m) => m.id === layer.materialId)) sel.append(h('option', { value: layer.materialId }, `${layer.materialId} (not in the database)`)), (sel.value = layer.materialId);
      const update = (patch: Partial<Construction['layers'][number]>, structural = false): void => {
        const latest = get() ?? { layers: [] };
        set({ layers: latest.layers.map((l, k) => (k === i ? { ...l, ...patch } : l)) }, structural);
      };
      // Structural: the layer's name line above the list shows the chosen material.
      sel.addEventListener('change', () => update({ materialId: sel.value === '' ? null : sel.value }, true));
      const material = layer.materialId ? mats.find((m) => m.id === layer.materialId) : undefined;
      const move = (to: number): void => {
        const latest = get() ?? { layers: [] };
        const layers = [...latest.layers];
        const [moved] = layers.splice(i, 1);
        if (!moved) return;
        layers.splice(to, 0, moved);
        set({ layers }, true);
        root.querySelector<HTMLElement>(`[data-focus-id="layer-${to}-${to < i ? 'up' : 'down'}"]`)?.focus();
      };
      const small = (text: string, label: string, focusId: string, disabled: boolean, onClick: () => void): HTMLButtonElement => {
        const b = h('button', { type: 'button', class: 'tool', 'aria-label': label, 'data-focus-id': focusId, disabled }, text);
        b.addEventListener('click', onClick);
        return b;
      };
      // Two lines that fit the narrow sidebar: the full material name (wrapping) with its data status,
      // then the controls. A long name never pushes the thickness field or buttons out of view.
      return h(
        'li',
        { class: 'b-layer' },
        h('div', { class: 'b-layer-head' },
          h('span', { class: 'pos' }, `${i + 1}`),
          h('span', { class: 'b-layer-name' }, material ? material.name : layer.materialId ? `${layer.materialId} (not in the database)` : 'No material chosen'),
          material ? h('span', { class: `badge badge-${material.status}` }, STATUS_TEXT[material.status] ?? material.status) : null,
        ),
        sel,
        h('div', { class: 'b-layer-row' },
          numberField(`layer-${i}-t`, `Thickness of layer ${i + 1}`, units.thickness, layer.thicknessM === null ? null : showThickness(layer.thicknessM, units.thickness), (n) => update({ thicknessM: n === null ? null : readThickness(n, units.thickness) }), positive, true),
          h('span', { class: 'layer-buttons' },
          small('↑', `Move layer ${i + 1} towards the inside`, `layer-${i}-up`, i === 0, () => move(i - 1)),
          small('↓', `Move layer ${i + 1} towards the outside`, `layer-${i}-down`, i === construction.layers.length - 1, () => move(i + 1)),
          small('✕', `Remove layer ${i + 1}`, `layer-${i}-remove`, false, () => {
            const latest = get() ?? { layers: [] };
            set({ layers: latest.layers.filter((_, k) => k !== i) }, true);
            root.querySelector<HTMLElement>('[data-focus-id="layer-add"]')?.focus();
          }),
          ),
        ),
      );
    });
    const add = h('button', { type: 'button', 'data-focus-id': 'layer-add', 'data-role': 'b-layer-add' }, 'Add layer (outside end)');
    add.addEventListener('click', () => {
      const latest = get() ?? { layers: [] };
      set({ layers: [...latest.layers, { materialId: null, thicknessM: null }] }, true);
      root.querySelector<HTMLElement>(`[data-focus-id="layer-${latest.layers.length}-mat"]`)?.focus();
    });
    return h('div', { class: 'b-construction' },
      h('h3', {}, 'Construction layers (inside → outside)'),
      h('ol', { class: 'b-layers' }, ...rows),
      construction.layers.length === 0 ? h('p', { class: 'note' }, 'No layers yet: add layers from the conditioned (inside) face outwards.') : null,
      add,
      h('p', { class: 'note' }, 'Materials come from the material database (built-in values are illustrative). To use datasheet values, add a custom material in Single wall → Materials; it appears here.'),
    );
  }

  /** Editor for a traceable value: number, source, value type, conditions. */
  function documentedEditor(prefix: string, label: string, unit: string, get: () => DocumentedValue | null, set: (v: DocumentedValue | null) => void, check: (n: number) => string | null, required = true): HTMLElement {
    const v = get();
    const blank = (value: number): DocumentedValue => ({ value, unit, source: '', valueType: 'unspecified', status: 'user-defined' });
    return h('fieldset', { class: 'doc-field' },
      h('legend', {}, label),
      numberField(`${prefix}-value`, label, unit, v ? v.value : null, (n) => {
        const latest = get();
        set(n === null ? null : { ...(latest ?? blank(n)), value: n });
        // Re-draw only when the source/type fields appear or disappear, so typing is not interrupted.
        if ((latest === null) !== (n === null)) keepingFocus(renderEditor);
      }, check, true),
      v ? textField(`${prefix}-source`, 'Source (datasheet, test report, standard table …) — required', v.source, (t) => { const latest = get(); if (latest) set({ ...latest, source: t }); }, 300) : null,
      v ? selectField(`${prefix}-type`, 'Value type', THERMAL_VALUE_TYPES.map((t) => [t, t] as [ThermalValueType, string]), v.valueType, (t) => { const latest = get(); if (latest) set({ ...latest, valueType: t }); }) : null,
      v ? textField(`${prefix}-conditions`, 'Test or reference conditions (optional)', v.conditions ?? '', (t) => { const latest = get(); if (latest) set({ ...latest, conditions: t }); }, 300) : null,
      h('p', { class: 'note' }, v
        ? 'Typed values are recorded as user-defined; this program does not check them.'
        : required
          ? 'Not entered. Nothing is assumed: the element is reported as missing data until you enter a documented value.'
          : 'Optional. Recorded with its source for the next stage; not used in this stage\'s calculation.'),
    );
  }

  function renderEditor(): void {
    const c = current();
    editorKey = c ? c.id : '';
    if (!c) {
      editorHost.replaceChildren(h('p', { class: 'note' }, 'Select a component in the list or click it in the 3D view to see and edit it here.'));
      return;
    }
    const parts: Child[] = [
      h('p', { class: 'b-editor-type' }, COMPONENT_TYPE_LABEL[c.type]),
      textField('name', 'Name', c.name, (t) => { const latest = current(); if (latest) commitComponent({ ...latest, name: t }); }, 80),
      dimsReadout,
    ];
    const latest = <T extends Component>(): T => current() as T;
    if (c.type === 'exterior-wall') {
      const sides: Array<[Side, string]> = (['north', 'east', 'south', 'west'] as Side[]).filter((s) => s === c.side || freeSides(project).includes(s)).map((s) => [s, `${SIDE_LABEL[s]} side`]);
      parts.push(selectField('side', 'Side (orientation)', sides, c.side, (side) => commitComponent({ ...latest<typeof c>(), side }, true)), ...exposureEditor(c));
      parts.push(constructionEditor(() => latest<typeof c>()?.construction ?? null, (construction, structural) => commitComponent({ ...latest<typeof c>(), construction }, structural)));
    } else if (c.type === 'partition') {
      parts.push(numberField('position', 'Distance from the west face', 'm', c.positionM, (n) => commitComponent({ ...latest<typeof c>(), positionM: n as number }), positive), ...exposureEditor(c));
      parts.push(constructionEditor(() => latest<typeof c>()?.construction ?? null, (construction, structural) => commitComponent({ ...latest<typeof c>(), construction }, structural)));
    } else if (c.type === 'roof' || c.type === 'floor') {
      parts.push(...exposureEditor(c));
      parts.push(constructionEditor(() => (latest<typeof c>() as { construction: Construction } | undefined)?.construction ?? null, (construction, structural) => commitComponent({ ...latest<typeof c>(), construction } as Component, structural)));
    } else {
      const walls = project.components.filter((w) => w.type === 'exterior-wall');
      parts.push(
        selectField('host', 'In wall', walls.map((w) => [w.id, w.name] as [string, string]), c.hostId, (hostId) => commitComponent({ ...latest<typeof c>(), hostId }, true)),
        h('div', { class: 'grid' },
          numberField('offset', 'Offset from the left end (seen from outside)', 'm', c.offsetM, (n) => commitComponent({ ...latest<typeof c>(), offsetM: n as number }), nonNegative),
          c.type !== 'door' ? numberField('sill', 'Sill above the floor', 'm', c.sillM, (n) => commitComponent({ ...latest<typeof c>(), sillM: n as number } as Component), nonNegative) : null,
          numberField('width', 'Width', 'm', c.widthM, (n) => commitComponent({ ...latest<typeof c>(), widthM: n as number }), positive),
          numberField('height', 'Height', 'm', c.heightM, (n) => commitComponent({ ...latest<typeof c>(), heightM: n as number }), positive),
        ),
      );
      if (isGlazing(c)) {
        const g = (): typeof c => latest<typeof c>();
        parts.push(
          documentedEditor('u', 'Overall U-value U_w', 'W/(m²·K)', () => g()?.uValue ?? null, (v) => commitComponent({ ...g(), uValue: v }), positive),
          documentedEditor('g', 'Solar energy transmittance g (stored only)', '–', () => g()?.gValue ?? null, (v) => commitComponent({ ...g(), gValue: v }), (n) => (n >= 0 && n <= 1 ? null : 'It must be between 0 and 1.'), false),
          documentedEditor('fc', 'Shading reduction factor (stored only)', '–', () => g()?.shadingFactor ?? null, (v) => commitComponent({ ...g(), shadingFactor: v }), (n) => (n >= 0 && n <= 1 ? null : 'It must be between 0 and 1.'), false),
          h('p', { class: 'note' }, 'Solar gains are NOT calculated in this stage (they need solar irradiance per orientation, from weather data). Only conduction U·A·ΔT is calculated.'),
        );
      } else if (c.type === 'door') {
        const d = (): typeof c => latest<typeof c>();
        parts.push(selectField('door-kind', 'Door properties', [['u-value', 'Documented overall U-value'], ['layers', 'Layers (calculated like a wall)']] as Array<['u-value' | 'layers', string]>, c.spec.kind, (kind) => commitComponent({ ...d(), spec: kind === 'u-value' ? { kind, uValue: null } : { kind, construction: { layers: [] } } }, true)));
        if (c.spec.kind === 'u-value') parts.push(documentedEditor('u', 'Overall U-value U_D', 'W/(m²·K)', () => { const s = d()?.spec; return s?.kind === 'u-value' ? s.uValue : null; }, (v) => commitComponent({ ...d(), spec: { kind: 'u-value', uValue: v } }), positive));
        else parts.push(constructionEditor(() => { const s = d()?.spec; return s?.kind === 'layers' ? s.construction : null; }, (construction, structural) => commitComponent({ ...d(), spec: { kind: 'layers', construction } }, structural)));
      }
    }
    const dup = h('button', { type: 'button', 'data-role': 'b-duplicate', 'data-focus-id': 'b-duplicate' }, 'Duplicate');
    dup.addEventListener('click', () => {
      try {
        const name = current()?.name ?? c.name;
        const { project: next, id } = duplicateComponent(project, c.id);
        commit(next);
        select(id);
        announce(`${name} duplicated.`);
      } catch (error) {
        announce((error as Error).message);
        actionMsg.textContent = (error as Error).message;
      }
    });
    const vis = h('button', { type: 'button', 'data-role': 'b-visibility', 'data-focus-id': 'b-visibility' }, c.visible ? 'Hide in 3D' : 'Show in 3D');
    vis.addEventListener('click', () => {
      const latest = current();
      if (latest) commit(setVisible(project, latest.id, !latest.visible), true);
    });
    const del = h('button', { type: 'button', class: 'danger', 'data-role': 'b-delete', 'data-focus-id': 'b-delete' }, 'Delete…');
    del.addEventListener('click', () => {
      const name = current()?.name ?? c.name;
      const dependents = dependentsOf(project, c.id);
      const message = dependents.length > 0
        ? `Delete "${name}" and the ${dependents.length} opening${dependents.length === 1 ? '' : 's'} in it (${dependents.map((o) => o.name).join(', ')})? Its data and results are removed.`
        : `Delete "${name}"? Its data and results are removed.`;
      if (!confirmAction(message)) return;
      commit(deleteComponent(project, c.id));
      select(null);
      announce(`${name} deleted${dependents.length > 0 ? ` with ${dependents.length} opening(s)` : ''}.`);
    });
    const actionMsg = h('p', { class: 'msg', role: 'status' });
    parts.push(h('div', { class: 'actions' }, dup, vis, del), actionMsg, selectedResults);
    editorHost.replaceChildren(...(parts.filter(Boolean) as Node[]));
  }

  /** The selected element's calculated results (re-drawn after every change, without touching the inputs). */
  function renderSelectedResults(): void {
    const c = current();
    const r = c ? result.components.find((x) => x.componentId === c.id) : undefined;
    if (!c || !r) {
      selectedResults.replaceChildren();
      dimsReadout.textContent = '';
      return;
    }
    const d = dimensionsOf(project, c);
    dimsReadout.textContent = c.type === 'exterior-wall'
      ? `${show(d.widthM, 4)} m × ${show(d.heightM, 4)} m = ${show(d.grossAreaM2, 4)} m² gross; openings ${show(d.openingsAreaM2, 4)} m²; net ${show(d.netAreaM2, 4)} m²`
      : `${show(d.widthM, 4)} m × ${show(d.heightM, 4)} m = ${show(d.netAreaM2, 4)} m²${isOpening(c) && project.components.find((w) => w.id === c.hostId)?.type === 'exterior-wall' ? ` (wall length ${show(sideLength(project, (project.components.find((w) => w.id === c.hostId) as { side: Side }).side), 4)} m)` : ''}`;
    selectedResults.replaceChildren(...resultBlock(r));
  }

  function resultBlock(r: ComponentResult): Node[] {
    const fact = (k: string, v: string, term?: GlossaryTerm): Node[] => [h('dt', {}, k, term ? helpTip(term) : null), h('dd', {}, v)];
    const facts: Node[] = [];
    if (r.uValueWPerM2K !== null) facts.push(...fact('U-value', `${show(r.uValueWPerM2K, 4)} W/(m²·K)`, 'u-value'));
    if (r.totalResistanceM2KPerW !== null) facts.push(...fact('R_total', `${show(r.totalResistanceM2KPerW, 4)} m²·K/W`, 'r-value'));
    if (r.layersResistanceM2KPerW !== null) facts.push(...fact('Σ d/λ (layers only)', `${show(r.layersResistanceM2KPerW, 4)} m²·K/W`));
    if (r.surface) facts.push(...fact('Surface resistances R_si / R_se', `R_si ${show(r.surface.insideM2KPerW, 3)}, R_se ${show(r.surface.outsideM2KPerW, 3)} m²·K/W for ${r.surface.heatFlow} heat flow (${r.surface.status})`));
    if (r.otherSideC !== null) facts.push(...fact('Other side', `${show(showTemperature(r.otherSideC, units.temperature), 4)} ${tUnit()}; ΔT = ${show(showDifference(r.deltaTK ?? Number.NaN, units.temperature), 4)} ${DIFFERENCE_SYMBOL[units.temperature]}`));
    if (r.heatFlowW !== null) facts.push(...fact('Heat flow Q̇', flowWords(r.heatFlowW), 'heat-flow'));
    if (r.heatCapacity) facts.push(...fact('Heat capacity', `${show(r.heatCapacity.arealJPerM2K / 1000, 4)} kJ/(m²·K); ${show(r.heatCapacity.totalJPerK / 1e6, 4)} MJ/K (simple sum)`));
    const nodes: Node[] = [
      h('h3', {}, 'Result (steady state)'),
      h('p', {}, h('span', { class: `status status-${r.status}`, 'data-role': 'b-status' }, STATUS_LABEL[r.status])),
    ];
    if (r.reasons.length > 0) nodes.push(h('ul', { class: 'warnings' }, ...r.reasons.map((x) => h('li', {}, x))));
    if (facts.length > 0) nodes.push(h('dl', { class: 'facts', 'data-role': 'b-facts' }, ...facts));
    if (r.engine) {
      const t = r.engine.temperatureProfile;
      nodes.push(tableRegion('Layers of the selected element', h('table', { class: 'data-table compact', 'data-role': 'b-layer-table' },
        h('caption', {}, 'Layers, inside → outside'),
        h('thead', {}, h('tr', {}, ...['Layer', `d (${units.thickness})`, 'λ', 'R (m²·K/W)', `T in-side (${tUnit()})`, `T out-side (${tUnit()})`, 'Data'].map((x) => h('th', { scope: 'col' }, x)))),
        h('tbody', {}, ...r.engine.layers.map((l, i) => h('tr', {}, h('td', {}, l.name), h('td', { class: 'num' }, show(showThickness(l.thicknessM, units.thickness), 4)), h('td', { class: 'num' }, show(l.lambdaWPerMK, 3)), h('td', { class: 'num' }, show(l.resistanceM2KPerW, 4)), h('td', { class: 'num' }, show(showTemperature(t[1 + i]?.temperatureC ?? Number.NaN, units.temperature), 4)), h('td', { class: 'num' }, show(showTemperature(t[2 + i]?.temperatureC ?? Number.NaN, units.temperature), 4)), h('td', {}, l.propertyStatus ?? '—')))),
      )));
    }
    if (r.documented.length > 0) {
      nodes.push(tableRegion('Documented values', h('table', { class: 'data-table compact', 'data-role': 'b-documented' },
        h('caption', {}, 'Documented values used'),
        h('thead', {}, h('tr', {}, ...['Property', 'Value', 'Source', 'Type', 'Status'].map((x) => h('th', { scope: 'col' }, x)))),
        h('tbody', {}, ...r.documented.map((d) => h('tr', {}, h('td', {}, d.label), h('td', { class: 'num' }, `${show(d.value.value, 4)} ${d.value.unit}`), h('td', {}, d.value.source || '— (missing)'), h('td', {}, d.value.valueType), h('td', {}, d.value.status)))),
      )));
    }
    return nodes;
  }

  // ---- workspace shell ---------------------------------------------------------------------------------
  const viewerPanel = createHouseViewerPanel({ ...(options.houseViewerFactory ? { viewerFactory: options.houseViewerFactory } : {}), onSelect: (id) => select(id), announce });
  /** Builds the building report from the CURRENT project and its result (nothing is recalculated for it). */
  function makeReport(format: BuildingReportFormat, title: string, notes: string): void {
    const input = { title, notes, generatedAt: io.now(), project, result, typeLabels: COMPONENT_TYPE_LABEL };
    const model = buildBuildingReport(input);
    const base = buildingReportFileBase(model);
    if (format === 'html') io.download(`${base}.html`, 'text/html', renderHtml(model));
    else if (format === 'markdown') io.download(`${base}.md`, 'text/markdown', renderMarkdown(model));
    else if (format === 'json') io.download(`${base}.json`, 'application/json', renderBuildingJson(model, input));
    else if (format === 'csv') io.download(`${base}-elements.csv`, 'text/csv', renderElementsCsv(input));
    else io.print(renderHtml(model));
    announce(format === 'print' ? 'The print dialog shows the building report; choose "Save as PDF" to keep it as a file.' : 'Building report downloaded.');
  }
  const resultsPanel = createBuildingResultsPanel({
    onSelect: (id) => select(id),
    onFix: (id) => {
      const c = project.components.find((x) => x.id === id);
      const r = result.components.find((x) => x.componentId === id);
      const target = c && r ? fixTarget(c, r) : null;
      if (target) goFix(target);
      else select(id);
    },
    onReport: makeReport,
  });
  const sidebarToggle = h('button', { type: 'button', class: 'tool', 'aria-expanded': 'true', 'aria-controls': 'b-sidebar', 'data-role': 'b-sidebar-toggle' }, '☰ Inputs');
  const undoButton = h('button', { type: 'button', class: 'tool', 'data-role': 'b-undo', 'aria-label': 'Undo the last change (Ctrl+Z)', title: 'Undo (Ctrl+Z)', disabled: true }, '↶ Undo');
  const redoButton = h('button', { type: 'button', class: 'tool', 'data-role': 'b-redo', 'aria-label': 'Redo (Ctrl+Shift+Z)', title: 'Redo (Ctrl+Shift+Z)', disabled: true }, '↷ Redo');
  undoButton.addEventListener('click', () => void undo());
  redoButton.addEventListener('click', () => void redo());
  const workspace = h(
    'div',
    { class: 'workspace building-workspace' },
    h('header', { class: 'topbar' },
      sidebarToggle,
      h('h1', {}, 'Building Thermal Simulator'),
      options.topbarExtra ?? null,
      h('span', { class: 'history-tools' }, undoButton, redoButton),
      h('span', { class: 'mode-chip' }, 'Steady-state element calculations'),
      h('details', { class: 'policy' }, h('summary', {}, 'Scope: steady state, not an energy simulation'), h('p', {}, 'Each element is calculated on its own for one constant condition (Q̇ = U·A·ΔT). This is not an hourly, annual or cooling-demand simulation and not a compliance check. Built-in material values are illustrative; window and door values must come from documented sources.')),
    ),
    h('div', { class: 'workspace-body' },
      h('aside', { id: 'b-sidebar', class: 'sidebar', 'aria-label': 'Building inputs' }, projectSection, geometrySection, conditionsSection, componentsSection, editorSection),
      h('main', { class: 'stage-column' }, viewerPanel.element, resultsPanel.element),
    ),
    announcer,
  );
  sidebarToggle.addEventListener('click', () => {
    // On a phone the inputs sit below the 3D view and the results: the button takes you there instead.
    if (typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 960px)').matches) {
      workspace.querySelector('#b-sidebar')?.scrollIntoView({ block: 'start' });
      return;
    }
    const collapsed = workspace.classList.toggle('sidebar-collapsed');
    sidebarToggle.setAttribute('aria-expanded', String(!collapsed));
  });
  root.replaceChildren(workspace);
  workspace.addEventListener('input', () => void (lastTypedAt = Date.now()), true);
  workspace.addEventListener('keydown', (e) => {
    const action = undoShortcut(e);
    if (!action || isTextEntry(e.target)) return;
    e.preventDefault();
    if (action === 'undo') undo();
    else redo();
  });
  // Each sidebar section folds; selecting a component opens the sections that show it.
  const folds: Record<'project' | 'geometry' | 'conditions' | 'components' | 'editor', Collapsible> = {
    project: makeCollapsible(projectSection),
    geometry: makeCollapsible(geometrySection),
    conditions: makeCollapsible(conditionsSection),
    components: makeCollapsible(componentsSection),
    editor: makeCollapsible(editorSection),
  };
  addResultsResizer(resultsPanel.element, workspace.querySelector('.stage-column') as HTMLElement, 'building-thermal-simulator.results-height.building', store);

  /** Shows `next` (from the history) everywhere, keeping the selection if the component still exists. */
  function showFromHistory(next: BuildingProject, what: 'Undone' | 'Redone'): void {
    applyingHistory = true;
    project = next;
    if (selected && !project.components.some((c) => c.id === selected)) selected = null;
    renderProjectInputs();
    keepingFocus(renderEditor);
    refresh();
    applyingHistory = false;
    announce(`${what}.`);
  }
  function undo(): boolean {
    const previous = history.undo(project);
    if (!previous) return false;
    showFromHistory(previous, 'Undone');
    return true;
  }
  function redo(): boolean {
    const next = history.redo(project);
    if (!next) return false;
    showFromHistory(next, 'Redone');
    return true;
  }

  function refresh(): void {
    if (lastSeen && project !== lastSeen && !applyingHistory) history.record(lastSeen, Date.now() - lastTypedAt < 50);
    lastSeen = project;
    undoButton.disabled = !history.canUndo;
    redoButton.disabled = !history.canRedo;
    result = calculateEnvelope(project, materials());
    if (!projectNameHost.contains(document.activeElement)) {
      projectNameHost.replaceChildren(textField('project-name', 'Project name', project.name, (t) => commit({ ...project, name: t }), 120));
    }
    exampleNote.hidden = !(project.isExample || project.name.startsWith('Example house'));
    renderList();
    viewerPanel.setModel(houseSpecFromProject(project), fluxView(result), project.components.length);
    viewerPanel.select(selected);
    resultsPanel.setResult(project, result, selected, units);
    if (editorKey !== (selected ?? '')) renderEditor();
    renderSelectedResults();
    renderTodo();
    // Keep the last project in this browser, so a reload or the next visit continues where you left off.
    writeKey(store, STORAGE_KEYS.lastBuilding, textOf(project));
    if (libraryId) writeKey(store, STORAGE_KEYS.lastBuildingLibraryId, libraryId);
    else removeKey(store, STORAGE_KEYS.lastBuildingLibraryId);
    renderProjectStatus();
  }

  function setProject(next: BuildingProject): void {
    project = next;
    selected = null;
    renderProjectInputs();
    renderEditor();
    refresh();
  }

  /** The last project kept in this browser, if any; damaged or foreign data is ignored, never fatal. */
  function restoreLast(): boolean {
    const text = readKey(store, STORAGE_KEYS.lastBuilding);
    if (!text) return false;
    const parsed = parseProject(text, BUILT_IN_MATERIALS);
    if (!parsed.ok) return false;
    options.onImportMaterials?.(parsed.customMaterials);
    const id = readKey(store, STORAGE_KEYS.lastBuildingLibraryId);
    const entryText = id ? library.load(id) : null;
    libraryId = entryText !== null ? id : null;
    setProject(parsed.project);
    // Dirty relative to the saved copy in the library, if there is one.
    savedText = entryText !== null ? (() => { const e = parseProject(entryText, BUILT_IN_MATERIALS); return e.ok ? textOf(e.project) : null; })() : null;
    origin = libraryId ? '' : 'Restored from your last visit; not saved in this browser yet.';
    renderProjectStatus();
    if (parsed.project.components.length > 0) showFileMessage(`Restored "${parsed.project.name}" from your last visit.`, 'ok');
    return true;
  }

  if (!restoreLast()) setProject(project);

  return {
    getProject: () => project,
    setProject,
    getResult: () => result,
    getSelected: () => selected,
    select,
    setUnits: (u) => setUnits(u, false),
    getUnits: () => units,
    undo,
    redo,
    openProjectText: (text, filename) => openProjectText(text, filename),
    saveToLibrary,
    loadExample: () => replaceProject(createExampleHouse(materials()), 'Loading the example house'),
    newBlank: () => replaceProject(createBlankProject(), 'A new blank project'),
    library,
    viewer: viewerPanel,
    ready: viewerPanel.ready,
    destroy: () => viewerPanel.destroy(),
  };
}
