// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { FIELD, layerField } from '../src/editor';
import { BUILT_IN_MATERIALS, createCustomMaterial, mergeMaterials } from '../src/materials';
import { mountWallEditor } from '../src/ui/app';
import type { WallEditorHandle } from '../src/ui/app';

let root: HTMLElement;
let editor: WallEditorHandle;

const domId = (field: string): string => `f-${field.replace(/[^a-zA-Z0-9]+/g, '-')}`;
const el = <T extends HTMLElement>(field: string): T => {
  const found = document.getElementById(domId(field));
  if (!found) throw new Error(`No element for field ${field}`);
  return found as T;
};
const message = (field: string): string => document.getElementById(`msg-${domId(field)}`)?.textContent ?? '';

function type(field: string, text: string): void {
  const input = el<HTMLInputElement>(field);
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
function choose(field: string, value: string): void {
  const select = el<HTMLSelectElement>(field);
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}
function chooseElement(select: HTMLSelectElement, value: string): void {
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}
const unitSelectOf = (field: string): HTMLSelectElement => el(field).parentElement?.querySelector('select.unit') as HTMLSelectElement;
const buttonByLabel = (label: string): HTMLButtonElement => {
  const found = [...root.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === label || b.textContent === label);
  if (!found) throw new Error(`No button "${label}"`);
  return found;
};
const click = (b: HTMLElement): void => void b.dispatchEvent(new Event('click', { bubbles: true }));
const summaryText = (): string => document.getElementById('summary')?.textContent ?? '';
const layerItems = (): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('li.layer')];
const tableMaterials = (): string[] =>
  [...root.querySelectorAll('#summary tbody tr')].map((row) => row.children[1]?.textContent ?? '');
const engineJson = (): { layers: Array<{ thicknessM: number; name: string }>; widthM: number; heightM: number } =>
  JSON.parse(root.querySelector('#summary pre')?.textContent ?? 'null');

function mount(materials = BUILT_IN_MATERIALS): void {
  document.body.innerHTML = '';
  root = document.createElement('div');
  document.body.append(root);
  editor = mountWallEditor(root, materials);
}

beforeEach(() => mount());

describe('first screen', () => {
  it('shows the data policy: values are illustrative, not approved Cypriot design values, no compliance claim', () => {
    const policy = root.querySelector('.policy')?.textContent ?? '';
    expect(policy).toContain('illustrative demonstration number');
    expect(policy).toContain('None has been confirmed as an approved Cypriot design value');
    expect(policy).toContain('nothing shown here demonstrates compliance with any standard or regulation');
    expect(policy).toContain('Measured, declared and design thermal values are different');
  });

  it('shows the starter wall with the interior and exterior sides identified', () => {
    expect(layerItems()).toHaveLength(4);
    expect(root.querySelector('.face-interior')?.textContent).toContain('INTERIOR FACE');
    expect(root.querySelector('.face-exterior')?.textContent).toContain('EXTERIOR FACE');
    // interior banner comes before the list, exterior after it
    const order = [...root.querySelectorAll('.face-interior, ol.layers, .face-exterior')].map((n) => n.className);
    expect(order).toEqual(['face face-interior', 'layers', 'face face-exterior']);
    expect(layerItems()[0]?.textContent).toContain('Interior face');
    expect(layerItems()[3]?.textContent).toContain('Exterior face');
    expect(layerItems()[1]?.textContent).not.toContain('Interior face');
  });

  it('is valid and passes SI values to the engine input', () => {
    expect(summaryText()).toContain('Valid configuration');
    const json = engineJson();
    expect(json.layers.map((l) => l.thicknessM)).toEqual([0.015, 0.2, 0.08, 0.02]);
    expect(json.widthM).toBe(3);
    expect(json.heightM).toBe(2.5);
    expect(editor.getResult().ok).toBe(true);
  });

  it('shows each layer\'s material, thickness in metres and available properties with their status', () => {
    const eps = layerItems()[2]?.textContent ?? '';
    expect(eps).toContain('Expanded polystyrene (EPS) slab (demonstration)');
    expect(eps).toContain('= 0.08 m');
    expect(eps).toContain('λ 0.035 W/(m·K)');
    expect(eps).toContain('ρ 25 kg/m³');
    expect(eps).toContain('c_p 1450 J/(kg·K)');
    expect(eps).toContain('Illustrative');
    expect(eps).toContain('Value type: unspecified');
    expect(eps).toContain('This application has not confirmed this value as an approved Cypriot design value.');
  });

  it('separates the property labels with spaces, so they can wrap on narrow screens and are read separately', () => {
    const props = layerItems()[2]?.querySelector('.props p')?.textContent ?? '';
    expect(props).toContain('λ 0.035 W/(m·K) ρ 25 kg/m³ c_p 1450 J/(kg·K) Illustrative');
  });

  it('warns in the summary that the data is not verified', () => {
    expect(summaryText()).toContain('Unverified material data');
    expect(summaryText()).toContain('Do not treat any result as an approved Cypriot design value');
  });

  it('shows the area', () => {
    expect(root.querySelector('[data-role="area"]')?.textContent).toContain('7.5 m²');
  });

  it('lists the surface-resistance preset as an explicit, unverified choice', () => {
    expect(summaryText()).toContain('R_si 0.13, R_se 0.04');
    expect(summaryText()).toContain('unverified');
    expect(root.querySelector<HTMLSelectElement>('#f-surface-mode')?.selectedOptions[0]?.textContent).toContain('UNVERIFIED');
  });
});

describe('typing updates the wall immediately and shows clear errors', () => {
  it('a negative thickness is rejected with a message, aria-invalid and a summary entry', () => {
    type(layerField('layer-3', 'thickness'), '-80');
    expect(message(layerField('layer-3', 'thickness'))).toBe('Error: The thickness of layer 3 must be greater than zero.');
    expect(el(layerField('layer-3', 'thickness')).getAttribute('aria-invalid')).toBe('true');
    expect(summaryText()).toContain('1 problem to fix');
    expect(summaryText()).toContain('The thickness of layer 3 must be greater than zero.');
    expect(editor.getResult().wall).toBeNull();
    expect(root.querySelector('#summary pre')).toBeNull(); // no engine input is shown for an invalid wall
  });

  it('correcting the value clears the error and updates the wall at once', () => {
    type(layerField('layer-3', 'thickness'), '-80');
    type(layerField('layer-3', 'thickness'), '120');
    expect(message(layerField('layer-3', 'thickness'))).toBe('');
    expect(el(layerField('layer-3', 'thickness')).getAttribute('aria-invalid')).toBe('false');
    expect(summaryText()).toContain('Valid configuration');
    expect(engineJson().layers[2]?.thicknessM).toBe(0.12);
  });

  it('the thickness in metres is shown next to what was typed', () => {
    type(layerField('layer-2', 'thickness'), '250');
    expect(layerItems()[1]?.querySelector('[data-role="thickness-m"]')?.textContent).toBe('= 0.25 m');
    type(layerField('layer-2', 'thickness'), 'abc');
    expect(layerItems()[1]?.querySelector('[data-role="thickness-m"]')?.textContent).toBe('= — m');
  });

  it.each([
    [FIELD.width, '0', 'The wall width must be greater than zero.'],
    [FIELD.width, '', 'Enter the wall width.'],
    [FIELD.height, '-2', 'The wall height must be greater than zero.'],
    [FIELD.height, '2m', 'The wall height must be a number such as 2.5 (digits with a decimal point or comma; no units or letters).'],
    [FIELD.insideTemperature, '-300', 'The inside temperature cannot be below absolute zero (−273.15 °C = 0 K = −459.67 °F).'],
    [FIELD.duration, '-1', 'The duration cannot be negative.'],
  ])('%s = %j → %s', (field, text, expected) => {
    type(field, text);
    expect(message(field)).toBe(`Error: ${expected}`);
    expect(el(field).getAttribute('aria-invalid')).toBe('true');
  });

  it('accepts a comma as the decimal separator', () => {
    type(FIELD.width, '3,6');
    expect(message(FIELD.width)).toBe('');
    expect(engineJson().widthM).toBe(3.6);
  });

  it('shows a warning, not an error, for a suspicious but possible value', () => {
    type(layerField('layer-3', 'thickness'), '0.08'); // 0.08 mm
    expect(message(layerField('layer-3', 'thickness'))).toContain('Warning:');
    expect(message(layerField('layer-3', 'thickness'))).toContain('thinner than 1 mm');
    expect(editor.getResult().ok).toBe(true);
  });

  it('typing does not rebuild the input, so the cursor and focus are kept', () => {
    const input = el<HTMLInputElement>(layerField('layer-1', 'thickness'));
    input.focus();
    type(layerField('layer-1', 'thickness'), '16');
    expect(el(layerField('layer-1', 'thickness'))).toBe(input);
    expect(document.activeElement).toBe(input);
  });
});

describe('adding, removing and reordering layers', () => {
  it('adds an incomplete layer at the exterior end and asks for the missing material and thickness', () => {
    click(buttonByLabel('Add layer (exterior end)'));
    expect(layerItems()).toHaveLength(5);
    expect(message(layerField('layer-5', 'material'))).toBe('Error: Select a material for layer 5.');
    expect(message(layerField('layer-5', 'thickness'))).toBe('Error: Enter the thickness of layer 5.');
    expect(layerItems()[4]?.textContent).toContain('Exterior face');
    expect(layerItems()[3]?.textContent).not.toContain('Exterior face');
    expect(document.activeElement).toBe(el(layerField('layer-5', 'material')));
    expect(summaryText()).toContain('2 problems to fix');
  });

  it('the new layer becomes part of the wall once material and thickness are given', () => {
    click(buttonByLabel('Add layer (exterior end)'));
    chooseElement(el<HTMLSelectElement>(layerField('layer-5', 'material')), 'xps-board');
    chooseElement(unitSelectOf(layerField('layer-5', 'thickness')), 'cm');
    type(layerField('layer-5', 'thickness'), '3'); // 3 cm
    expect(summaryText()).toContain('Valid configuration');
    expect(engineJson().layers).toHaveLength(5);
    expect(engineJson().layers[4]).toMatchObject({ name: 'Extruded polystyrene (XPS) board (demonstration)', thicknessM: 0.03 });
  });

  it('removes a layer and renumbers the rest', () => {
    click(buttonByLabel('Remove layer 2'));
    expect(layerItems()).toHaveLength(3);
    expect(layerItems().map((l) => l.querySelector('.pos')?.textContent)).toEqual(['Layer 1', 'Layer 2', 'Layer 3']);
    expect(tableMaterials()[1]).toContain('Expanded polystyrene');
    expect(summaryText()).toContain('Valid configuration');
  });

  it('removing every layer says a wall needs at least one layer', () => {
    for (let i = 0; i < 4; i++) click(buttonByLabel('Remove layer 1'));
    expect(layerItems()).toHaveLength(0);
    expect(message(FIELD.layers)).toBe('Error: Add at least one layer.');
    expect(root.textContent).toContain('No layers yet');
    expect(document.activeElement).toBe(buttonByLabel('Add layer (exterior end)'));
  });

  it('moves layers with the arrow buttons; the summary follows the new order', () => {
    click(buttonByLabel('Move layer 3 toward the interior'));
    expect(tableMaterials().map((t) => t.split(' (')[0])).toEqual(['Gypsum plaster', 'Expanded polystyrene', 'Clay brick, solid', 'Cement plaster / render']);
    expect(engineJson().layers.map((l) => l.thicknessM)).toEqual([0.015, 0.08, 0.2, 0.02]);
    expect(root.querySelector('[role="status"]')?.textContent).toBe('Layer moved to position 2 of 4.');
  });

  it('keeps keyboard focus on the moved layer\'s button', () => {
    click(buttonByLabel('Move layer 2 toward the exterior')); // layer 2 → position 3 (not the end)
    const active = document.activeElement as HTMLElement | null;
    expect(active?.dataset.focusId).toBe('layer-2:down');
    expect(layerItems()[2]?.contains(active)).toBe(true);
  });

  it('when a layer reaches the exterior end, focus falls back to its "toward interior" button (a disabled button cannot hold focus)', () => {
    click(buttonByLabel('Move layer 3 toward the exterior')); // layer-3 is now last; its ↓ is disabled
    expect((document.activeElement as HTMLElement | null)?.dataset.focusId).toBe('layer-3:up');
  });

  it('when a layer reaches the interior end, focus falls back to its "toward exterior" button', () => {
    click(buttonByLabel('Move layer 2 toward the interior')); // layer-2 is now first; its ↑ is disabled
    expect((document.activeElement as HTMLElement | null)?.dataset.focusId).toBe('layer-2:down');
  });

  it('the first layer cannot move toward the interior and the last cannot move toward the exterior', () => {
    expect(buttonByLabel('Move layer 1 toward the interior').disabled).toBe(true);
    expect(buttonByLabel('Move layer 4 toward the exterior').disabled).toBe(true);
    expect(buttonByLabel('Move layer 2 toward the interior').disabled).toBe(false);
  });

  it('after moving a layer to the exterior end, it becomes the exterior-face layer', () => {
    click(buttonByLabel('Move layer 3 toward the exterior'));
    expect(layerItems()[3]?.textContent).toContain('Exterior face');
    expect(layerItems()[3]?.textContent).toContain('Expanded polystyrene');
  });

  it('Reset restores the example wall', () => {
    click(buttonByLabel('Remove layer 1'));
    type(FIELD.width, '9');
    click(buttonByLabel('Reset to example wall'));
    expect(layerItems()).toHaveLength(4);
    expect(el<HTMLInputElement>(FIELD.width).value).toBe('3');
    expect(summaryText()).toContain('Valid configuration');
  });
});

describe('selecting materials', () => {
  it('offers every database material grouped by category, each with its status in the label', () => {
    const select = el<HTMLSelectElement>(layerField('layer-1', 'material'));
    const options = [...select.querySelectorAll('option')].filter((o) => o.value !== '');
    expect(options).toHaveLength(BUILT_IN_MATERIALS.length);
    expect(options.every((o) => o.textContent?.endsWith('— illustrative'))).toBe(true);
    expect([...select.querySelectorAll('optgroup')].map((g) => g.label)).toContain('Mineral wool');
  });

  it('changing the material updates the layer, its properties and the wall', () => {
    chooseElement(el<HTMLSelectElement>(layerField('layer-3', 'material')), 'polyurethane-board');
    expect(layerItems()[2]?.textContent).toContain('λ 0.025 W/(m·K)');
    expect(engineJson().layers[2]?.name).toBe('Polyurethane (PUR/PIR) board (demonstration)');
    expect(el<HTMLSelectElement>(layerField('layer-3', 'material')).value).toBe('polyurethane-board');
  });

  it('choosing "— select a material —" reports the missing material', () => {
    chooseElement(el<HTMLSelectElement>(layerField('layer-2', 'material')), '');
    expect(message(layerField('layer-2', 'material'))).toBe('Error: Select a material for layer 2.');
    expect(layerItems()[1]?.textContent).toContain('Thermal properties: not available until a material is selected');
    expect(summaryText()).toContain('— none —');
  });

  it('the filter narrows the lists but never hides a layer\'s current material', () => {
    const filter = document.getElementById('f-material-filter') as HTMLInputElement;
    filter.value = 'wool';
    filter.dispatchEvent(new Event('input', { bubbles: true }));
    const options = [...el<HTMLSelectElement>(layerField('layer-1', 'material')).querySelectorAll('option')].map((o) => o.value);
    expect(options).toContain('mineral-wool-slab');
    expect(options).toContain('gypsum-plaster'); // layer 1's current choice stays
    expect(options).not.toContain('xps-board');
    expect(el<HTMLSelectElement>(layerField('layer-1', 'material')).value).toBe('gypsum-plaster');
  });

  it('flags missing properties instead of hiding them', () => {
    const { material } = createCustomMaterial({ name: 'Only lambda', lambdaWPerMK: 0.3 });
    mount(mergeMaterials(BUILT_IN_MATERIALS, [material]));
    chooseElement(el<HTMLSelectElement>(layerField('layer-1', 'material')), material.id);
    const layer = layerItems()[0]?.textContent ?? '';
    expect(layer).toContain('missing');
    expect(layer).toContain('density and specific heat capacity not available');
    expect(layer).toContain('User-defined');
    expect(message(FIELD.layers)).toContain('Warning: Heat capacity cannot be calculated');
  });

  it('shows the data-status notes, source type and citation for the material', () => {
    const notes = layerItems()[0]?.querySelector('details')?.textContent ?? '';
    expect(notes).toContain('Illustrative: a demonstration value with no source');
    expect(notes).toContain('Source type: none');
    expect(notes).toContain('Citation: None.');
  });

  it('shows material names as text only: markup in a name cannot inject elements', () => {
    const { material } = createCustomMaterial({ name: '<img src=x onerror=alert(1)>', lambdaWPerMK: 0.3 });
    mount(mergeMaterials(BUILT_IN_MATERIALS, [material]));
    chooseElement(el<HTMLSelectElement>(layerField('layer-1', 'material')), material.id);
    expect(root.querySelector('img')).toBeNull();
    expect(layerItems()[0]?.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(summaryText()).toContain('<img src=x onerror=alert(1)>');
  });
});

describe('units are preserved when they change', () => {
  it('changing a layer\'s unit converts the number: 80 mm → 8 cm, still 0.08 m', () => {
    chooseElement(unitSelectOf(layerField('layer-3', 'thickness')), 'cm');
    expect(el<HTMLInputElement>(layerField('layer-3', 'thickness')).value).toBe('8');
    expect(layerItems()[2]?.querySelector('[data-role="thickness-m"]')?.textContent).toBe('= 0.08 m');
    expect(engineJson().layers[2]?.thicknessM).toBe(0.08);
  });

  it('keeps keyboard focus on the unit dropdown after changing it', () => {
    const select = unitSelectOf(layerField('layer-3', 'thickness'));
    select.focus();
    chooseElement(select, 'm');
    expect((document.activeElement as HTMLElement | null)?.dataset.focusId).toBe('layer-3:unit');
  });

  it('changing the dimension unit converts width and height: 3 m × 2.5 m → 300 cm × 250 cm', () => {
    chooseElement(document.querySelector('#h-dimensions')?.parentElement?.querySelector('select.unit') as HTMLSelectElement, 'cm');
    expect(el<HTMLInputElement>(FIELD.width).value).toBe('300');
    expect(el<HTMLInputElement>(FIELD.height).value).toBe('250');
    expect(engineJson().widthM).toBe(3);
    expect(engineJson().heightM).toBe(2.5);
  });

  it('changing the temperature unit converts both temperatures: 20 °C → 293.15 K, same wall', () => {
    const select = document.querySelector('#h-boundary')?.parentElement?.querySelectorAll('select.unit')[0] as HTMLSelectElement;
    chooseElement(select, 'K');
    expect(el<HTMLInputElement>(FIELD.insideTemperature).value).toBe('293.15');
    expect(el<HTMLInputElement>(FIELD.outsideTemperature).value).toBe('278.15');
    expect(summaryText()).toContain('inside 20 °C, outside 5 °C');
  });

  it('typing a temperature below absolute zero in kelvin is rejected', () => {
    const select = document.querySelector('#h-boundary')?.parentElement?.querySelectorAll('select.unit')[0] as HTMLSelectElement;
    chooseElement(select, 'K');
    type(FIELD.outsideTemperature, '-5');
    expect(message(FIELD.outsideTemperature)).toContain('cannot be below absolute zero');
  });
});

describe('surface resistances', () => {
  const mode = (): HTMLSelectElement => document.getElementById('f-surface-mode') as HTMLSelectElement;

  it('custom fields are hidden while the preset is selected and shown for custom values', () => {
    const box = root.querySelector<HTMLElement>('[data-role="custom-surface"]');
    expect(box?.hidden).toBe(true);
    chooseElement(mode(), 'custom');
    expect(box?.hidden).toBe(false);
  });

  it('custom values are validated and used', () => {
    chooseElement(mode(), 'custom');
    type(FIELD.surfaceInside, '-0.1');
    expect(message(FIELD.surfaceInside)).toBe('Error: The internal surface resistance R_si cannot be negative.');
    type(FIELD.surfaceInside, '0,11');
    expect(summaryText()).toContain('R_si 0.11, R_se 0.04 m²·K/W (user-defined');
  });
});

describe('accessibility basics', () => {
  it('every input and select has an accessible name', () => {
    for (const control of root.querySelectorAll<HTMLElement>('input, select')) {
      const hasLabel = control.id && root.querySelector(`label[for="${control.id}"]`);
      expect(hasLabel || control.getAttribute('aria-label'), `unnamed control ${control.outerHTML.slice(0, 80)}`).toBeTruthy();
    }
  });

  it('every field\'s message area is linked with aria-describedby', () => {
    for (const control of root.querySelectorAll<HTMLElement>('input[type="text"], select[id^="f-layer"]')) {
      const describedBy = control.getAttribute('aria-describedby');
      expect(describedBy && document.getElementById(describedBy), control.id).toBeTruthy();
    }
  });

  it('buttons have text or an aria-label, and ids are unique', () => {
    for (const b of root.querySelectorAll('button')) expect((b.textContent ?? '').trim() || b.getAttribute('aria-label')).toBeTruthy();
    const ids = [...root.querySelectorAll('[id]')].map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('errors are announced as text, not colour alone, and the summary is a live region', () => {
    type(FIELD.width, '0');
    expect(message(FIELD.width).startsWith('Error:')).toBe(true);
    expect(document.getElementById('summary')?.getAttribute('aria-live')).toBe('polite');
  });
});
