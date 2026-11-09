// @vitest-environment happy-dom
/**
 * Guidance on screen: the first-visit welcome, the "?" explanations, and the
 * missing-data checklist that takes the user to the field to fill in.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { iso6946Preset } from '../src/engine';
import { GLOSSARY } from '../src/ui/glossary';
import { mountShell } from '../src/ui/shell';
import type { ShellHandle } from '../src/ui/shell';
import { memoryStore, STORAGE_KEYS } from '../src/ui/storage';
import type { KeyValueStore } from '../src/ui/storage';
import { chooseValue, click } from './helpers/ui';

let root: HTMLElement;
let shell: ShellHandle | null = null;
let confirms: string[] = [];

function mount(store: KeyValueStore = memoryStore()): ShellHandle {
  shell?.destroy();
  document.body.innerHTML = '';
  root = document.createElement('div');
  document.body.append(root);
  confirms = [];
  shell = mountShell(root, { confirm: (m) => (confirms.push(m), true), store });
  return shell;
}
afterEach(() => {
  shell?.destroy();
  shell = null;
});
const q = <T extends Element = HTMLElement>(sel: string): T => root.querySelector(sel) as T;
const welcome = (): HTMLElement => q('[data-role="welcome"]');
const B = '[data-workspace="building"] ';

describe('first-visit welcome', () => {
  it('opens on the first visit only; choosing the example opens it in the building workspace', () => {
    const store = memoryStore();
    const s = mount(store);
    expect(welcome().hidden).toBe(false);
    expect(welcome().querySelector('[role="dialog"]')?.getAttribute('aria-modal')).toBe('true');
    click(q('[data-role="welcome-example"]'));
    expect(welcome().hidden).toBe(true);
    expect(s.getMode()).toBe('building');
    expect(s.building()?.getProject().components).toHaveLength(14);
    expect(store.getItem(STORAGE_KEYS.welcomeSeen)).toBe('1');
    const again = mount(store);
    expect(welcome().hidden).toBe(true);
    expect(again.getMode()).toBe('wall');
  });

  it('blank project and single wall choices; Escape closes; Help reopens', () => {
    const s = mount();
    click(q('[data-role="welcome-blank"]'));
    expect(s.getMode()).toBe('building');
    expect(s.building()?.getProject().components).toHaveLength(0);
    click(q(`${B}[data-role="open-welcome"]`));
    expect(welcome().hidden).toBe(false);
    click(q('[data-role="welcome-wall"]'));
    expect(s.getMode()).toBe('wall');
    s.openWelcome();
    welcome().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(welcome().hidden).toBe(true);
  });

  it('the limitations can be read in the dialog', () => {
    mount();
    const toggle = q('[data-role="welcome-limits-toggle"]');
    expect(q('#welcome-limits').hidden).toBe(true);
    click(toggle);
    expect(q('#welcome-limits').hidden).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(q('#welcome-limits').textContent).toMatch(/Steady state only/);
    expect(q('#welcome-limits').textContent).toMatch(/not approved Cypriot design values/);
  });

  it('loading the example from the welcome asks before replacing unsaved work', () => {
    const s = mount();
    click(q('[data-role="welcome-blank"]'));
    click(q(`${B}[data-role="b-add"]`)); // unsaved work
    s.openWelcome();
    click(q('[data-role="welcome-example"]'));
    expect(confirms.at(-1)).toMatch(/replaces the current project/);
  });
});

describe('"?" explanations', () => {
  it('each term opens its explanation; a second click or Escape closes it', () => {
    const s = mount();
    s.openWelcome();
    click(q('[data-role="welcome-close"]'));
    const tip = q<HTMLButtonElement>('[data-workspace="wall"] [data-kpi="u-value"] .help-tip');
    click(tip);
    const pop = document.querySelector('[data-role="help-pop"]') as HTMLElement;
    expect(pop.hidden).toBe(false);
    expect(pop.textContent).toContain(GLOSSARY['u-value'].title);
    expect(tip.getAttribute('aria-expanded')).toBe('true');
    click(tip);
    expect(pop.hidden).toBe(true);
    click(tip);
    tip.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(pop.hidden).toBe(true);
    expect(document.activeElement).toBe(tip);
  });

  it('U, R, heat flow and heat flux in the wall results; U, R_si/R_se and Q̇ in the building', () => {
    const s = mount();
    const wallTerms = [...root.querySelectorAll<HTMLElement>('[data-workspace="wall"] .kpi .help-tip')].map((b) => b.dataset.term);
    expect(wallTerms).toEqual(['u-value', 'r-value', 'heat-flow', 'heat-flux']);
    s.setMode('building');
    s.building()?.loadExample();
    const buildingTerms = new Set([...root.querySelectorAll<HTMLElement>(`${B}.help-tip`)].map((b) => b.dataset.term));
    for (const t of ['u-value', 'r-si', 'heat-flow']) expect(buildingTerms.has(t)).toBe(true);
    s.building()?.select('c1');
    const factTerms = [...root.querySelectorAll<HTMLElement>(`${B}[data-role="b-facts"] .help-tip`)].map((b) => b.dataset.term);
    expect(factTerms).toEqual(['u-value', 'r-value', 'heat-flow']);
  });

  it('the explanations quote the same surface-resistance presets as the engine', () => {
    const [h, up, down] = [iso6946Preset('horizontal'), iso6946Preset('upwards'), iso6946Preset('downwards')];
    expect(GLOSSARY['r-si'].text).toContain(`${h.insideM2KPerW.toFixed(2)} (horizontal), ${up.insideM2KPerW.toFixed(2)} (upwards), ${down.insideM2KPerW.toFixed(2)} (downwards)`);
    expect(GLOSSARY['r-se'].text).toContain(`preset ${h.outsideM2KPerW.toFixed(2)}`);
    for (const entry of Object.values(GLOSSARY)) expect(entry.text).not.toMatch(/\bcompl(ies|iant)\b/i);
  });
});

describe('missing-data checklist', () => {
  const todoNames = (): string[] => [...root.querySelectorAll(`${B}[data-role="b-todo-list"] strong`)].map((n) => n.textContent ?? '');

  it('the example house lists the windows and doors without U-values; a click puts the cursor in the U-value field', () => {
    const s = mount();
    s.setMode('building');
    s.building()?.loadExample();
    expect(todoNames()).toEqual(['South window 1', 'South glazed door', 'South window 2', 'North window', 'East window', 'West window', 'Entrance door']);
    expect(q(`${B}[data-role="b-todo"]`).textContent).toMatch(/Cannot be calculated in this stage: Ground floor slab/);
    click(q(`${B}.b-todo-item[data-component="c8"]`));
    expect(s.building()?.getSelected()).toBe('c8');
    expect(document.activeElement?.id).toBe('b-u-value');
  });

  it('the g-value and shading boxes say they are optional (only U is required)', () => {
    const s = mount();
    s.setMode('building');
    s.building()?.loadExample();
    s.building()?.select('c8');
    const notes = [...root.querySelectorAll(`${B}.doc-field .note`)].map((n) => n.textContent ?? '');
    expect(notes[0]).toMatch(/missing data until you enter/);
    expect(notes[1]).toMatch(/Optional/);
    expect(notes[2]).toMatch(/Optional/);
  });

  it('entering the value and its source removes the item', () => {
    const s = mount();
    s.setMode('building');
    s.building()?.loadExample();
    click(q(`${B}.b-todo-item[data-component="c11"]`));
    const typeIn = (id: string, text: string): void => {
      const box = document.getElementById(id) as HTMLInputElement;
      box.value = text;
      box.dispatchEvent(new Event('input', { bubbles: true }));
    };
    typeIn('b-u-value', '1.4');
    expect(todoNames()).toContain('North window'); // no source yet
    typeIn('b-u-source', 'Datasheet (test)');
    expect(todoNames()).not.toContain('North window');
  });

  it('an empty wall goes to "Add layer"; an unknown space temperature goes to that field', () => {
    const s = mount();
    s.setMode('building');
    s.building()?.newBlank();
    click(q(`${B}[data-role="b-add"]`)); // a wall with no layers
    const wallId = s.building()?.getSelected() as string;
    s.building()?.select(null);
    click(q(`${B}.b-todo-item[data-component="${wallId}"]`));
    expect((document.activeElement as HTMLElement).dataset.focusId).toBe('layer-add');
    chooseValue(document.getElementById('b-exposure') as HTMLSelectElement, 'unconditioned');
    s.building()?.select(null);
    click(q(`${B}.b-todo-item[data-component="${wallId}"]`));
    expect(document.activeElement?.id).toBe('b-exposure-t');
  });

  it('the Not included tab takes you to the same field', () => {
    const s = mount();
    s.setMode('building');
    s.building()?.loadExample();
    click(q(`${B}#btab-not-included`));
    click(q(`${B}[data-role="not-included"] button[data-component="c14"]`));
    expect(s.building()?.getSelected()).toBe('c14');
    expect(document.activeElement?.id).toBe('b-u-value');
  });
});
