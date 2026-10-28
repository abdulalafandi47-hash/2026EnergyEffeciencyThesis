/**
 * The MATERIALS tab: inspect every material record, export the database, and
 * define custom materials.
 *
 * Custom materials are the way to use real data (for example a manufacturer's
 * declared value) instead of the illustrative built-in numbers. They are always
 * labelled "user-defined": this program does not check them. The records are
 * made and validated by the materials module (`createCustomMaterial`); this file
 * only collects the typed text and shows the result.
 */
import { parseNumberInput } from '../editor';
import {
  DATABASE_DISCLAIMER,
  exportMaterialsCsv,
  exportMaterialsJson,
  MATERIAL_CATEGORIES,
  MAX_NAME_CHARS,
  MAX_NOTE_CHARS,
  NOT_APPROVED_NOTICE,
  searchMaterials,
  THERMAL_VALUE_TYPES,
} from '../materials';
import type { CustomMaterialInput, CustomMaterialOutcome, MaterialCategory, MaterialRecord, ThermalValueType } from '../materials';
import { fileTimestamp } from '../report';
import { h, show, tableRegion } from './dom';
import type { FileIo } from './io';

export type AddCustomOutcome = CustomMaterialOutcome;

export interface MaterialsPanelOptions {
  /** Built-in and custom materials, in that order. */
  getMaterials(): readonly MaterialRecord[];
  addCustom(input: CustomMaterialInput): AddCustomOutcome;
  /** Removes a custom material; refuses (with a reason) while a layer uses it. */
  removeCustom(id: string): { ok: boolean; message: string };
  /** 1-based positions of the layers that use a material in the current wall. */
  usedBy(id: string): number[];
  io: FileIo;
  announce(text: string): void;
}

export interface MaterialsPanel {
  element: HTMLElement;
  /** Refreshes the table and counts. The form keeps what has been typed. */
  render(): void;
  /** Puts the keyboard focus on the first field of the custom-material form. */
  focusForm(): void;
}

const STATUS_TEXT: Record<string, string> = { verified: 'Verified', unverified: 'Unverified', illustrative: 'Illustrative', 'user-defined': 'User-defined' };

const VALUE_TYPE_TEXT: Record<ThermalValueType, string> = {
  unspecified: 'Not stated',
  measured: 'Measured (a test result on a specimen)',
  declared: 'Declared (manufacturer value under its reference conditions)',
  design: 'Design (stated by its source for design calculations)',
};

/** Which form field each engine/material issue path belongs to. */
const FIELD_OF_PATH: Record<string, string> = {
  name: 'name',
  lambdaWPerMK: 'lambda',
  densityKgPerM3: 'density',
  specificHeatJPerKgK: 'cp',
  sourceNote: 'note',
  conditions: 'conditions',
};

const FIELD_ORDER = ['name', 'category', 'lambda', 'valueType', 'density', 'cp', 'note', 'conditions'];

export function createMaterialsPanel(options: MaterialsPanelOptions): MaterialsPanel {
  // ---- custom-material form (built once, so typed text survives redraws) ----------------------------------
  const messages = new Map<string, HTMLElement>();
  const controls = new Map<string, HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>();
  const field = (key: string, label: string, control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, hint?: string): HTMLElement => {
    const id = `cm-${key}`;
    control.id = id;
    control.setAttribute('aria-describedby', `${id}-msg`);
    control.setAttribute('aria-invalid', 'false');
    const message = h('div', { id: `${id}-msg`, class: 'msg' }, hint ?? '');
    messages.set(key, message);
    controls.set(key, control);
    return h('div', { class: 'field' }, h('label', { for: id }, label), control, message);
  };
  const text = (max: number, numeric = false): HTMLInputElement =>
    h('input', { type: 'text', autocomplete: 'off', spellcheck: 'false', maxlength: String(max), ...(numeric ? { inputmode: 'decimal' } : {}) });
  const nameInput = text(MAX_NAME_CHARS);
  const categorySelect = h('select', {});
  for (const category of MATERIAL_CATEGORIES) categorySelect.append(h('option', { value: category }, category));
  categorySelect.value = 'Other';
  const lambdaInput = text(40, true);
  const densityInput = text(40, true);
  const cpInput = text(40, true);
  const valueTypeSelect = h('select', {});
  for (const type of THERMAL_VALUE_TYPES) valueTypeSelect.append(h('option', { value: type }, VALUE_TYPE_TEXT[type]));
  const noteInput = h('textarea', { rows: '2', maxlength: String(MAX_NOTE_CHARS), placeholder: 'e.g. Manufacturer X datasheet "Board 31", 2024, table 2' });
  const conditionsInput = h('textarea', { rows: '2', maxlength: String(MAX_NOTE_CHARS), placeholder: 'e.g. mean temperature 10 °C, dry state, density 30 kg/m³' });
  const formMessage = h('p', { class: 'msg', role: 'status', 'data-role': 'custom-material-message' });
  const addButton = h('button', { type: 'submit', class: 'primary', 'data-role': 'add-custom-material' }, 'Add custom material');

  const form = h(
    'form',
    { class: 'custom-material-form', 'aria-labelledby': 'h-custom-material', novalidate: true },
    h('h3', { id: 'h-custom-material' }, 'Add a custom material'),
    h('p', { class: 'note' }, 'Use this to enter real data, for example a manufacturer\'s declared value. Enter SI units. A custom material is labelled "user-defined" everywhere and is not checked by this program. Record where the numbers come from and the conditions they apply to.'),
    h(
      'div',
      { class: 'grid' },
      field('name', 'Name', nameInput),
      field('category', 'Category', categorySelect),
      field('lambda', 'Thermal conductivity λ (W/(m·K))', lambdaInput),
      field('valueType', 'Value type', valueTypeSelect),
      field('density', 'Density ρ (kg/m³, optional)', densityInput),
      field('cp', 'Specific heat c_p (J/(kg·K), optional)', cpInput),
    ),
    field('note', 'Source of the values', noteInput),
    field('conditions', 'Conditions the values apply to', conditionsInput),
    h('div', { class: 'actions' }, addButton),
    formMessage,
    h('p', { class: 'note' }, 'Without density and specific heat, heat capacity is reported as unavailable. Custom materials last until the page is closed; "Save wall" stores them in the wall file.'),
  );

  const setFieldMessage = (key: string, kind: 'error' | 'warning' | '', textValue: string): void => {
    const message = messages.get(key);
    if (message) {
      message.textContent = textValue;
      message.className = `msg ${kind}`;
    }
    controls.get(key)?.setAttribute('aria-invalid', String(kind === 'error'));
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    for (const key of messages.keys()) setFieldMessage(key, '', '');
    formMessage.textContent = '';
    formMessage.className = 'msg';

    const errors: Array<[string, string]> = [];
    const readNumber = (key: string, input: HTMLInputElement, label: string, required: boolean): number | undefined => {
      const parsed = parseNumberInput(input.value);
      if (parsed.ok) return parsed.value;
      if (parsed.reason === 'empty' && !required) return undefined;
      errors.push([key, parsed.reason === 'empty' ? `Enter ${label}.` : `${label.charAt(0).toUpperCase()}${label.slice(1)} must be a number such as 0.035 (no units or letters).`]);
      return undefined;
    };
    const lambda = readNumber('lambda', lambdaInput, 'the thermal conductivity', true);
    const density = readNumber('density', densityInput, 'the density', false);
    const cp = readNumber('cp', cpInput, 'the specific heat', false);
    if (nameInput.value.trim() === '') errors.push(['name', 'Enter a name.']);

    if (errors.length === 0) {
      const input: CustomMaterialInput = {
        name: nameInput.value,
        category: categorySelect.value as MaterialCategory,
        lambdaWPerMK: lambda as number,
        ...(density !== undefined ? { densityKgPerM3: density } : {}),
        ...(cp !== undefined ? { specificHeatJPerKgK: cp } : {}),
        valueType: valueTypeSelect.value as ThermalValueType,
        sourceNote: noteInput.value,
        conditions: conditionsInput.value,
      };
      const outcome = options.addCustom(input);
      if (outcome.ok) {
        for (const control of [nameInput, lambdaInput, densityInput, cpInput, noteInput, conditionsInput]) control.value = '';
        categorySelect.value = 'Other';
        valueTypeSelect.value = 'unspecified';
        const warnings = outcome.warnings.length > 0 ? ` Check: ${outcome.warnings.join(' ')}` : '';
        formMessage.textContent = `Added "${outcome.material.name}" (user-defined). Choose it in a layer's material list.${warnings}`;
        formMessage.className = `msg ${outcome.warnings.length > 0 ? 'warning' : 'ok'}`;
        options.announce(`Custom material ${outcome.material.name} added.`);
        render();
        return;
      }
      for (const issue of outcome.issues) errors.push([FIELD_OF_PATH[issue.path] ?? 'name', issue.message]);
    }
    // Messages and focus follow the order of the fields on screen.
    errors.sort((a, b) => FIELD_ORDER.indexOf(a[0]) - FIELD_ORDER.indexOf(b[0]));
    for (const [key, message] of errors) setFieldMessage(key, 'error', `Error: ${message}`);
    formMessage.textContent = `Not added: ${errors.length} problem${errors.length === 1 ? '' : 's'} to fix (see the messages).`;
    formMessage.className = 'msg error';
    const first = errors[0];
    if (first) controls.get(first[0])?.focus();
  });

  // ---- database view ---------------------------------------------------------------------------------------
  const counts = h('p', { 'data-role': 'material-counts' });
  const filterInput = h('input', { type: 'search', id: 'db-filter', autocomplete: 'off', placeholder: 'e.g. wool, plaster, custom' });
  const statusSelect = h('select', { id: 'db-status' }, h('option', { value: '' }, 'All'), ...Object.entries(STATUS_TEXT).map(([value, label]) => h('option', { value }, label)));
  filterInput.addEventListener('input', () => render());
  statusSelect.addEventListener('change', () => render());
  const tableHost = tableRegion('Material records (scrolls sideways)');
  tableHost.dataset.role = 'material-table-host';
  const tableMessage = h('p', { class: 'msg', role: 'status', 'data-role': 'material-table-message' });

  const exportButton = (format: 'json' | 'csv'): HTMLButtonElement => {
    const button = h('button', { type: 'button', class: 'tool', 'data-role': `export-materials-${format}` }, `Export database (${format.toUpperCase()})`);
    button.addEventListener('click', () => {
      const all = options.getMaterials();
      const filename = `materials-${fileTimestamp(options.io.now())}.${format}`;
      options.io.download(filename, format === 'json' ? 'application/json' : 'text/csv', format === 'json' ? exportMaterialsJson(all) : exportMaterialsCsv(all));
      tableMessage.textContent = `Saved ${filename} (${all.length} records; see your browser's downloads).`;
      tableMessage.className = 'msg ok';
      options.announce(`Material database saved as ${filename}.`);
    });
    return button;
  };

  function render(): void {
    const all = options.getMaterials();
    const custom = all.filter((m) => m.status === 'user-defined');
    const byStatus = (status: string): number => all.filter((m) => m.status === status).length;
    counts.textContent = `${all.length} records: ${byStatus('verified')} verified, ${byStatus('unverified')} unverified, ${byStatus('illustrative')} illustrative, ${custom.length} user-defined (custom).`;

    const status = statusSelect.value;
    const shown = searchMaterials(all, { text: filterInput.value, ...(status ? { status: status as MaterialRecord['status'] } : {}) });
    const rows = shown.map((m) => {
      const used = options.usedBy(m.id);
      const remove = m.status === 'user-defined' ? h('button', { type: 'button', class: 'tool', 'data-role': 'remove-custom-material', 'data-id': m.id, 'aria-label': `Remove custom material ${m.name}` }, 'Remove') : null;
      remove?.addEventListener('click', () => {
        const outcome = options.removeCustom(m.id);
        tableMessage.textContent = outcome.message;
        tableMessage.className = `msg ${outcome.ok ? 'ok' : 'error'}`;
        options.announce(outcome.message);
        if (outcome.ok) render();
      });
      return h(
        'tr',
        { 'data-material': m.id },
        h('td', {}, h('strong', {}, m.name), h('div', { class: 'note' }, m.id)),
        h('td', {}, m.category),
        h('td', { class: 'num' }, show(m.lambdaWPerMK, 6)),
        h('td', { class: 'num' }, m.densityKgPerM3 === undefined ? '—' : show(m.densityKgPerM3, 6)),
        h('td', { class: 'num' }, m.specificHeatJPerKgK === undefined ? '—' : show(m.specificHeatJPerKgK, 6)),
        h('td', {}, h('span', { class: `badge badge-${m.status}` }, STATUS_TEXT[m.status] ?? m.status)),
        h('td', {}, m.valueType),
        h('td', {}, h('span', { class: 'note' }, `${m.source.type}: `), m.source.citation),
        h('td', {}, m.conditions ?? '—'),
        h('td', {}, h('ul', { class: 'limitations' }, ...[...m.assumptionsAndLimitations, NOT_APPROVED_NOTICE].map((t) => h('li', {}, t)))),
        h('td', {}, used.length === 0 ? '—' : `layer ${used.join(', ')}`),
        h('td', {}, remove),
      );
    });
    tableHost.replaceChildren(
      h(
        'table',
        { class: 'data-table materials-table', 'data-role': 'material-table' },
        h('caption', {}, `Material records (${shown.length} of ${all.length} shown)`),
        h('thead', {}, h('tr', {}, ...['Material', 'Category', 'λ (W/(m·K))', 'ρ (kg/m³)', 'c_p (J/(kg·K))', 'Status', 'Value type', 'Source', 'Conditions', 'Assumptions and limitations', 'Used by'].map((t) => h('th', { scope: 'col' }, t)), h('th', { scope: 'col' }, h('span', { class: 'visually-hidden' }, 'Actions')))),
        h('tbody', {}, ...rows),
      ),
    );
    if (shown.length === 0) tableHost.append(h('p', { class: 'note' }, 'No material matches the filter.'));
  }

  const element = h(
    'div',
    { class: 'materials-panel' },
    h('p', { class: 'callout', role: 'note' }, h('strong', {}, 'Not a certified source. '), DATABASE_DISCLAIMER, ' ', NOT_APPROVED_NOTICE),
    h(
      'div',
      { class: 'materials-layout' },
      form,
      h(
        'div',
        { class: 'materials-db' },
        h('h3', {}, 'Material database'),
        counts,
        h('div', { class: 'cmp-controls' }, h('div', { class: 'field' }, h('label', { for: 'db-filter' }, 'Search'), filterInput), h('div', { class: 'field' }, h('label', { for: 'db-status' }, 'Data status'), statusSelect)),
        h('div', { class: 'report-buttons' }, exportButton('json'), exportButton('csv')),
        tableMessage,
        tableHost,
        h('p', { class: 'caption' }, 'Conductivity depends on density, moisture content, temperature, product and (for some insulations) ageing, so a value only means something together with its conditions. Measured, declared and design values are different; this program does not convert between them.'),
      ),
    ),
  );

  render();
  return { element, render, focusForm: () => nameInput.focus() };
}
