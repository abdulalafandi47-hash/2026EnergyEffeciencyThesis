// @vitest-environment happy-dom
/**
 * The Materials tab (Stage 8): inspecting and exporting the material database,
 * and defining custom materials through the screen, then using them in a wall,
 * a comparison, a report and a saved wall file.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { layerField, parseDraft } from '../src/editor';
import { BUILT_IN_MATERIALS, exportMaterialsCsv, exportMaterialsJson, NOT_APPROVED_NOTICE } from '../src/materials';
import type { MaterialRecord } from '../src/materials';
import { mountWallEditor } from '../src/ui/app';
import type { WallEditorHandle } from '../src/ui/app';
import type { FileIo } from '../src/ui/io';
import { KEY_TERMS } from '../src/ui/resultsPanel';
import equationsDoc from '../docs/equations-and-assumptions.md?raw';
import { at, expectClose } from './helpers/helpers';
import { FIXED_TIME } from './helpers/report';
import { chooseValue, click, makeFake, setChecked, type } from './helpers/ui';

interface Saved { filename: string; mime: string; text: string }
let root: HTMLElement;
let editor: WallEditorHandle;
let downloads: Saved[];
const io: FileIo = { download: (filename, mime, text) => void downloads.push({ filename, mime, text }), print: () => undefined, now: () => FIXED_TIME };

async function mount(): Promise<void> {
  document.body.innerHTML = '';
  root = document.createElement('div');
  document.body.append(root);
  downloads = [];
  editor = mountWallEditor(root, BUILT_IN_MATERIALS, { viewerFactory: makeFake().factory, io });
  await editor.ready;
}
beforeEach(() => mount());
afterEach(() => editor.destroy());

const q = <T extends HTMLElement>(selector: string): T => root.querySelector(selector) as T;
const role = <T extends HTMLElement>(name: string): T => q<T>(`[data-role="${name}"]`);
const openTab = (): void => click(q('#tab-materials'));
const rows = (): HTMLTableRowElement[] => [...root.querySelectorAll<HTMLTableRowElement>('[data-role="material-table"] tbody tr')];
const fill = (id: string, value: string): void => {
  const control = q<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`#cm-${id}`);
  control.value = value;
  control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
};
const submit = (): void => void q('form.custom-material-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
const message = (id: string): string => q(`#cm-${id}-msg`).textContent ?? '';
const kpiNumber = (key: string): number => Number(q(`[data-kpi="${key}"] .kpi-number`).textContent);

/** Fills the form with a plausible "datasheet" board and submits it. */
function addBoard(name = 'Datasheet board', lambda = '0,031'): MaterialRecord {
  openTab();
  fill('name', name);
  fill('category', 'EPS');
  fill('lambda', lambda);
  fill('density', '30');
  fill('cp', '1400');
  fill('valueType', 'declared');
  fill('note', 'Manufacturer X datasheet, 2024, table 2');
  fill('conditions', 'mean temperature 10 °C, dry');
  submit();
  const added = editor.getCustomMaterials().at(-1);
  if (!added) throw new Error('nothing was added');
  return added;
}

describe('inspecting the material database', () => {
  it('lists every record with its values, status, source, conditions and limitations, under the disclaimer', () => {
    openTab();
    expect(rows()).toHaveLength(BUILT_IN_MATERIALS.length);
    expect(q('.materials-panel .callout').textContent).toContain('NOT a certified source of design values');
    expect(role('material-counts').textContent).toBe('9 records: 0 verified, 0 unverified, 9 illustrative, 0 user-defined (custom).');
    for (const m of BUILT_IN_MATERIALS) {
      const row = q(`tr[data-material="${m.id}"]`);
      expect(row.textContent).toContain(m.name);
      expect(row.textContent).toContain(m.source.citation);
      for (const limitation of m.assumptionsAndLimitations) expect(row.textContent).toContain(limitation);
      expect(row.textContent).toContain(NOT_APPROVED_NOTICE);
      expect(row.querySelector('.badge')?.textContent).toBe('Illustrative');
      expect(row.querySelector('[data-role="remove-custom-material"]')).toBeNull(); // built-in records cannot be removed
    }
  });

  it('shows which layers of the current wall use each material, and follows edits', () => {
    openTab();
    expect(q('tr[data-material="gypsum-plaster"]').lastElementChild?.previousElementSibling?.textContent).toBe('layer 1');
    expect(q('tr[data-material="xps-board"]').lastElementChild?.previousElementSibling?.textContent).toBe('—');
    chooseValue(q(`#f-layer-layer-3-material`), 'xps-board');
    expect(q('tr[data-material="xps-board"]').lastElementChild?.previousElementSibling?.textContent).toBe('layer 3');
  });

  it('can be searched and filtered by data status', () => {
    openTab();
    const search = q<HTMLInputElement>('#db-filter');
    search.value = 'wool';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    expect(rows().map((r) => r.dataset.material)).toEqual(['mineral-wool-slab']);
    search.value = '';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    chooseValue(q('#db-status'), 'verified');
    expect(rows()).toHaveLength(0);
    expect(q('[data-role="material-table-host"]').textContent).toContain('No material matches the filter.');
    chooseValue(q('#db-status'), 'illustrative');
    expect(rows()).toHaveLength(9);
  });

  it('exports the whole database, custom materials included, as JSON and CSV', () => {
    addBoard();
    click(role('export-materials-json'));
    click(role('export-materials-csv'));
    const [json, csv] = downloads;
    expect(json?.filename).toBe('materials-20261027-123045.json');
    expect(json?.mime).toBe('application/json');
    const all = [...BUILT_IN_MATERIALS, ...editor.getCustomMaterials()];
    expect(json?.text).toBe(exportMaterialsJson(all));
    expect(JSON.parse(json?.text ?? '{}').count).toBe(10);
    expect(csv?.filename).toBe('materials-20261027-123045.csv');
    expect(csv?.text).toBe(exportMaterialsCsv(all));
    expect(role('material-table-message').textContent).toContain('10 records');
  });
});

describe('defining a custom material', () => {
  it('the sidebar shortcut opens the Materials tab with the form focused', () => {
    click(role('open-custom-material'));
    expect(q('#panel-materials').hidden).toBe(false);
    expect(document.activeElement?.id).toBe('cm-name');
  });

  it('adds a validated, user-defined record (comma decimal accepted) and offers it everywhere', () => {
    const board = addBoard();
    expect(board).toMatchObject({ id: 'custom-datasheet-board', status: 'user-defined', valueType: 'declared', category: 'EPS', lambdaWPerMK: 0.031, densityKgPerM3: 30, specificHeatJPerKgK: 1400, conditions: 'mean temperature 10 °C, dry' });
    expect(board.source).toEqual({ type: 'user-note', citation: 'User-entered: Manufacturer X datasheet, 2024, table 2' });
    expect(role('custom-material-message').textContent).toContain('Added "Datasheet board" (user-defined)');
    expect(q<HTMLInputElement>('#cm-name').value).toBe(''); // the form is cleared for the next one
    // in the table
    expect(q('tr[data-material="custom-datasheet-board"] .badge').textContent).toBe('User-defined');
    expect(role('material-counts').textContent).toContain('1 user-defined');
    // in every layer's material list
    const option = q(`#f-layer-layer-3-material option[value="custom-datasheet-board"]`);
    expect(option.textContent).toBe('Datasheet board — user-defined');
    // in the comparison choices
    click(q('#tab-compare'));
    expect(q('#cmp-m-custom-datasheet-board')).not.toBeNull();
  });

  it('a wall using it is calculated with exactly that value (independent hand calculation)', () => {
    addBoard();
    chooseValue(q('#f-layer-layer-3-material'), 'custom-datasheet-board');
    click(q('#tab-results'));
    const lambda = (id: string): number => (BUILT_IN_MATERIALS.find((m) => m.id === id) as MaterialRecord).lambdaWPerMK;
    const rTotal = 0.13 + 0.015 / lambda('gypsum-plaster') + 0.2 / lambda('clay-brick-solid') + 0.08 / 0.031 + 0.02 / lambda('cement-plaster') + 0.04;
    expectClose(kpiNumber('u-value'), 1 / rTotal, 5e-4);
    expectClose(kpiNumber('r-total'), rTotal, 5e-4);
    expect(editor.getResult().wall?.layers[2]).toMatchObject({ lambdaWPerMK: 0.031, propertyStatus: 'user-defined' });
    click(q('#tab-layers'));
    expect(q('[data-role="layer-table"] tbody tr:nth-child(4) .badge').textContent).toBe('User-defined');
  });

  it('the report states the user-defined values, their source and conditions', () => {
    addBoard();
    chooseValue(q('#f-layer-layer-3-material'), 'custom-datasheet-board');
    click(q('#tab-report'));
    click(role('report-download-json'));
    const data = JSON.parse(at(downloads, 0).text);
    expect(data.banners.join(' ')).toMatch(/entered by the user \(user-defined\)/);
    expect(data.banners.join(' ')).toMatch(/illustrative or unverified/); // the other layers are still illustrative
    const sources = data.report.sections.flatMap((s: { blocks: Array<{ kind: string; caption?: string; rows?: string[][] }> }) => s.blocks).find((b: { caption?: string }) => b.caption === 'Where the material values come from');
    const row = sources.rows.find((r: string[]) => r[0] === 'Datasheet board');
    expect(row).toEqual(expect.arrayContaining(['user-defined', 'declared', 'user-note', 'User-entered: Manufacturer X datasheet, 2024, table 2', 'mean temperature 10 °C, dry']));
  });

  it('explains every mistake next to its field, focuses the first one, and adds nothing', () => {
    openTab();
    fill('lambda', 'abc');
    fill('density', '30 kg');
    submit();
    expect(editor.getCustomMaterials()).toEqual([]);
    expect(message('name')).toBe('Error: Enter a name.');
    expect(message('lambda')).toMatch(/must be a number/);
    expect(message('density')).toMatch(/must be a number/);
    expect(q('#cm-lambda').getAttribute('aria-invalid')).toBe('true');
    expect(role('custom-material-message').textContent).toBe('Not added: 3 problems to fix (see the messages).');
    expect(document.activeElement?.id).toBe('cm-name'); // focus goes to the first wrong field on screen

    fill('name', 'Bad');
    fill('lambda', '0');
    fill('density', '');
    submit();
    expect(editor.getCustomMaterials()).toEqual([]);
    expect(message('lambda')).toMatch(/Error: .*greater than (zero|0)/i);
    fill('lambda', '-0,04');
    submit();
    expect(message('lambda')).toMatch(/Error:/);
    fill('lambda', '');
    submit();
    expect(message('lambda')).toBe('Error: Enter the thermal conductivity.');
  });

  it('fixing the mistakes clears the messages', () => {
    openTab();
    submit();
    expect(message('name')).not.toBe('');
    fill('name', 'Fixed');
    fill('lambda', '0.04');
    submit();
    expect(message('name')).toBe('');
    expect(q('#cm-name').getAttribute('aria-invalid')).toBe('false');
    expect(editor.getCustomMaterials()).toHaveLength(1);
  });

  it('accepts an unusual value but warns (e.g. λ typed in mW/(m·K))', () => {
    addBoard('Odd board', '31');
    expect(editor.getCustomMaterials()).toHaveLength(1);
    expect(role('custom-material-message').textContent).toMatch(/Check: Conductivity 31 W\/\(m·K\) is outside 0\.01–5/);
    expect(role('custom-material-message').className).toContain('warning');
  });

  it('text that is too long is refused by the materials module even if typed past the browser limit', () => {
    const outcome = editor.addCustomMaterial({ name: 'x'.repeat(81), lambdaWPerMK: 0.04 });
    expect(outcome.ok).toBe(false);
    expect(editor.getCustomMaterials()).toEqual([]);
  });

  it('the same name twice gets a second, distinct id', () => {
    addBoard('Twin');
    addBoard('Twin');
    expect(editor.getCustomMaterials().map((m) => m.id)).toEqual(['custom-twin', 'custom-twin-2']);
  });

  it('a hostile name is shown as text only', () => {
    addBoard('<img src=x onerror=alert(1)>');
    expect(root.querySelector('img')).toBeNull();
    expect(q('tr[data-material^="custom-img"]').textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('keeps what was typed in the form while the wall is edited', () => {
    openTab();
    fill('name', 'Half typed');
    fill('lambda', '0.03');
    type('width', '4');
    type(layerField('layer-2', 'thickness'), '210');
    expect(q<HTMLInputElement>('#cm-name').value).toBe('Half typed');
    expect(q<HTMLInputElement>('#cm-lambda').value).toBe('0.03');
  });
});

describe('removing a custom material', () => {
  it('is refused while a layer uses it, with the reason, and allowed afterwards', () => {
    const board = addBoard();
    chooseValue(q('#f-layer-layer-3-material'), board.id);
    click(q(`tr[data-material="${board.id}"] [data-role="remove-custom-material"]`));
    expect(editor.getCustomMaterials()).toHaveLength(1);
    expect(role('material-table-message').textContent).toBe('"Datasheet board" is used by layer 3. Choose another material for that layer first.');
    chooseValue(q('#f-layer-layer-3-material'), 'eps-slab');
    click(q(`tr[data-material="${board.id}"] [data-role="remove-custom-material"]`));
    expect(editor.getCustomMaterials()).toEqual([]);
    expect(q(`tr[data-material="${board.id}"]`)).toBeNull();
    expect(q(`#f-layer-layer-3-material option[value="${board.id}"]`)).toBeNull();
  });
});

describe('custom materials in saved walls', () => {
  it('are saved with the wall and restored in a fresh editor with identical results', async () => {
    const board = addBoard();
    chooseValue(q('#f-layer-layer-3-material'), board.id);
    click(role('save-wall'));
    const saved = at(downloads, 0).text;
    const parsed = parseDraft(saved, BUILT_IN_MATERIALS);
    expect(parsed.ok && parsed.customMaterials).toEqual([board]);
    const resultBefore = JSON.stringify(editor.getResult().wall);

    editor.destroy();
    await mount();
    expect(editor.getCustomMaterials()).toEqual([]);
    const outcome = editor.openWallText(saved, 'w.json');
    expect(outcome).toEqual({ ok: true, warnings: [] });
    expect(editor.getCustomMaterials()).toEqual([board]);
    expect(JSON.stringify(editor.getResult().wall)).toBe(resultBefore);
    expect(role('file-message').textContent).toBe('Opened w.json (with 1 custom material).');
  });

  it("opening a file keeps this session's other custom materials; the file's version wins for the same id", () => {
    const other = addBoard('Session only');
    const shared = addBoard('Shared', '0.04');
    click(role('save-wall'));
    const file = JSON.parse(at(downloads, 0).text);
    file.customMaterials = file.customMaterials.filter((m: MaterialRecord) => m.id === shared.id).map((m: MaterialRecord) => ({ ...m, lambdaWPerMK: 0.045 }));
    editor.openWallText(JSON.stringify(file));
    const ids = editor.getCustomMaterials().map((m) => m.id);
    expect(ids).toEqual([other.id, shared.id]);
    expect(editor.getCustomMaterials().find((m) => m.id === shared.id)?.lambdaWPerMK).toBe(0.045);
  });
});

describe('comparisons with a custom material', () => {
  it('a material swap to the custom board matches calculating that wall directly', () => {
    const board = addBoard();
    click(q('#tab-compare'));
    q<HTMLDetailsElement>('details.cmp-section:nth-of-type(2)').open = true;
    for (const id of ['eps-slab', 'xps-board', 'mineral-wool-slab', 'polyurethane-board']) setChecked(q(`#cmp-m-${id}`), false);
    setChecked(q(`#cmp-m-${board.id}`), true);
    const swapRow = q('[data-role="swap-material"] tbody tr:nth-child(2)');
    const swappedU = Number(swapRow.children[2]?.textContent);
    chooseValue(q('#f-layer-layer-3-material'), board.id);
    click(q('#tab-results'));
    expectClose(swappedU, kpiNumber('u-value'), 1e-3);
  });
});

describe('the Assumptions tab explains the four quantities that are easy to confuse', () => {
  it('shows each term, worded as in docs/equations-and-assumptions.md section 6', () => {
    click(q('#tab-assumptions'));
    const items = [...root.querySelectorAll('[data-role="key-terms"] li')].map((li) => li.textContent);
    expect(items).toHaveLength(4);
    const docs = equationsDoc.replace(/\*/g, '');
    for (const [term, meaning] of KEY_TERMS) {
      expect(items).toContain(`${term}: ${meaning}`);
      expect(docs, term).toContain(`${term}: ${meaning}`);
    }
  });
});
