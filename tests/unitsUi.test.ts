// @vitest-environment happy-dom
/**
 * Units: the building workspace shows and reads temperatures and layer
 * thicknesses in the chosen units while the model stays in °C and metres; the
 * choice is shared with the single-wall calculator in both directions.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mountBuildingWorkspace } from '../src/ui/buildingWorkspace';
import type { BuildingWorkspaceHandle } from '../src/ui/buildingWorkspace';
import { mountShell } from '../src/ui/shell';
import type { ShellHandle } from '../src/ui/shell';
import { memoryStore } from '../src/ui/storage';
import { expectClose } from './helpers/helpers';
import { chooseValue, click } from './helpers/ui';

let root: HTMLElement;
let ws: BuildingWorkspaceHandle | null = null;
let shell: ShellHandle | null = null;
function freshRoot(): void {
  document.body.innerHTML = '';
  root = document.createElement('div');
  document.body.append(root);
}
afterEach(() => {
  ws?.destroy();
  shell?.destroy();
  ws = null;
  shell = null;
});
const input = (id: string): HTMLInputElement => document.getElementById(id) as HTMLInputElement;
const typeIn = (id: string, text: string): void => {
  const box = input(id);
  box.value = text;
  box.dispatchEvent(new Event('input', { bubbles: true }));
};
const choose = (id: string, value: string): void => chooseValue(document.getElementById(id) as HTMLSelectElement, value);

describe('units in the building workspace', () => {
  function mountWs(): BuildingWorkspaceHandle {
    freshRoot();
    ws = mountBuildingWorkspace(root, { store: memoryStore(), confirm: () => true });
    click(root.querySelector('[data-role="b-example"]'));
    return ws;
  }

  it('°F: fields show converted values, typed values are stored in °C, results follow', () => {
    const w = mountWs();
    const before = w.getProject();
    choose('b-unit-temperature', 'F');
    expect(w.getProject()).toBe(before); // switching units changes nothing in the model
    expect(input('b-c-inside').value).toBe('78.8'); // 26 °C
    expect(document.querySelector('label[for="b-c-inside"]')?.textContent).toBe('Inside air (°F)');
    typeIn('b-c-inside', '80');
    expectClose(w.getProject().conditions.insideC, (80 - 32) / 1.8, 1e-12);
    expect(root.querySelector('[data-role="b-headline"]')?.textContent).toMatch(/inside 80 °F, outside 95 °F/);
    const header = [...root.querySelectorAll('[data-role="envelope-table"] th')].map((t) => t.textContent ?? '');
    expect(header).toContain('ΔT (°F)');
    const southDt = root.querySelector('[data-role="envelope-table"] tr[data-component="c3"] td:nth-child(6)')?.textContent;
    expectClose(Number(southDt), ((80 - 32) / 1.8 - 35) * 1.8, 1e-3); // ΔT in °F = 1.8 × ΔT in K (shown to 4 digits)
  });

  it('K: absolute zero is checked in kelvin', () => {
    const w = mountWs();
    choose('b-unit-temperature', 'K');
    expect(input('b-c-outside').value).toBe('308.15');
    typeIn('b-c-outside', '-1');
    expect(input('b-c-outside').getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById('b-c-outside-msg')?.textContent).toMatch(/absolute zero \(0 K\)/);
    expect(w.getProject().conditions.outsideC).toBe(35);
  });

  it('cm: layer thicknesses are shown and read in centimetres; the layer table follows', () => {
    const w = mountWs();
    w.select('c1');
    choose('b-unit-thickness', 'cm');
    expect(input('b-layer-0-t').value).toBe('1.5'); // 15 mm
    expect(document.querySelector('label[for="b-layer-0-t"]')?.textContent).toMatch(/\(cm\)$/);
    typeIn('b-layer-0-t', '2');
    const wall = w.getProject().components.find((c) => c.id === 'c1');
    expect(wall && 'construction' in wall ? wall.construction.layers[0]?.thicknessM : null).toBeCloseTo(0.02, 12);
    expect([...root.querySelectorAll('[data-role="b-layer-table"] th')].map((t) => t.textContent)).toContain('d (cm)');
  });
});

describe('one unit choice for both workspaces', () => {
  it('a change in either workspace applies to the other, and is remembered', async () => {
    const store = memoryStore();
    freshRoot();
    shell = mountShell(root, { store, showWelcome: false, confirm: () => true });
    shell.setMode('building');
    const b = shell.building() as BuildingWorkspaceHandle;
    // Building → wall: thickness in cm converts every wall layer (the wall itself stays the same).
    const before = shell.wall.getDraft().layers.map((l) => [l.thicknessText, l.thicknessUnit]);
    choose('b-unit-thickness', 'cm');
    const after = shell.wall.getDraft().layers;
    expect(after.every((l) => l.thicknessUnit === 'cm')).toBe(true);
    after.forEach((l, i) => expectClose(Number(l.thicknessText) * 10, Number(before[i]?.[0]), 1e-9));
    // Wall → building: the wall's temperature unit select.
    const wallUnit = root.querySelector('[data-workspace="wall"] select[aria-label="Temperature unit"]') as HTMLSelectElement;
    chooseValue(wallUnit, 'K');
    expect(b.getUnits()).toEqual({ temperature: 'K', thickness: 'cm' });
    expect(input('b-c-inside').value).toBe('299.15');
    // Remembered for the next visit.
    shell.destroy();
    freshRoot();
    shell = mountShell(root, { store, showWelcome: false, confirm: () => true });
    expect(shell.wall.getDraft().temperatureUnit).toBe('K');
    shell.setMode('building');
    expect(shell.building()?.getUnits()).toEqual({ temperature: 'K', thickness: 'cm' });
  });
});
