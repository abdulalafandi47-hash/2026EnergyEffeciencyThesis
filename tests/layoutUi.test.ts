// @vitest-environment happy-dom
/**
 * Layout controls: folding sidebar sections, the camera View menu, and the
 * results-panel resize handle (its sizes are checked in a real browser in
 * validation/browser-building.cjs; here the behaviour and the keyboard).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mountShell } from '../src/ui/shell';
import type { ShellHandle } from '../src/ui/shell';
import { memoryStore } from '../src/ui/storage';
import type { HouseViewer, HouseViewerFactory, HouseViewPreset } from '../src/viewer3d';
import { click, makeFake } from './helpers/ui';

let root: HTMLElement;
let shell: ShellHandle | null = null;
const views: HouseViewPreset[] = [];
const houseFactory: HouseViewerFactory = async () => {
  const v: HouseViewer = { update: () => undefined, select: () => undefined, setColours: () => undefined, setView: (p) => void views.push(p), setGridVisible: () => undefined, setAxesVisible: () => undefined, setNavigationMode: () => undefined, zoom: () => undefined, destroy: () => undefined };
  return v;
};
const wallFake = makeFake();

async function mount(store = memoryStore()): Promise<ShellHandle> {
  shell?.destroy();
  document.body.innerHTML = '';
  root = document.createElement('div');
  document.body.append(root);
  views.length = 0;
  shell = mountShell(root, { viewerFactory: wallFake.factory, houseViewerFactory: houseFactory, store, showWelcome: false, confirm: () => true });
  await shell.wall.ready;
  shell.setMode('building');
  await shell.building()?.ready;
  return shell;
}
afterEach(() => {
  shell?.destroy();
  shell = null;
});
const q = <T extends Element = HTMLElement>(sel: string): T => root.querySelector(sel) as T;
const B = '[data-workspace="building"] ';
const key = (el: Element, k: string): void => void el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));

describe('collapsible sidebar sections', () => {
  it('every section of both sidebars folds and unfolds from its heading', async () => {
    await mount();
    const toggles = [...root.querySelectorAll<HTMLButtonElement>('.sidebar section > h2 > .section-toggle')];
    expect(toggles.length).toBe(3 + 5); // wall: dimensions, layers, boundary; building: five sections
    for (const t of toggles) {
      const body = document.getElementById(t.getAttribute('aria-controls') as string) as HTMLElement;
      expect(t.getAttribute('aria-expanded')).toBe('true');
      click(t);
      expect(t.getAttribute('aria-expanded')).toBe('false');
      expect(body.hidden).toBe(true);
      click(t);
      expect(body.hidden).toBe(false);
    }
  });

  it('a folded editor opens when a component is selected or a checklist item is clicked', async () => {
    const s = await mount();
    s.building()?.loadExample();
    const editorToggle = q(`${B}#b-h-editor .section-toggle`);
    click(editorToggle);
    expect(editorToggle.getAttribute('aria-expanded')).toBe('false');
    s.building()?.select('c1');
    expect(editorToggle.getAttribute('aria-expanded')).toBe('true');
    click(editorToggle);
    click(q(`${B}.b-todo-item[data-component="c8"]`));
    expect(editorToggle.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement?.id).toBe('b-u-value');
  });

  it('folded sections keep their inputs: values typed before folding are still there', async () => {
    const s = await mount();
    const toggle = q(`${B}#b-h-geometry .section-toggle`);
    click(toggle);
    click(toggle);
    expect((document.getElementById('b-g-length') as HTMLInputElement).value).toBe(String(s.building()?.getProject().geometry.lengthM));
  });
});

describe('the camera View menu', () => {
  it('opens, chooses a view, shows its name and closes', async () => {
    await mount();
    const button = q(`${B}[data-role="view-menu-button"]`);
    const list = document.getElementById(button.getAttribute('aria-controls') as string) as HTMLElement;
    expect(list.hidden).toBe(true);
    click(button);
    expect(list.hidden).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    click(list.querySelector('[aria-label="North elevation"]'));
    expect(views.at(-1)).toBe('north');
    expect(list.hidden).toBe(true);
    expect(button.textContent).toBe('View: North ▾');
    // The same view can be chosen again (re-applies it after orbiting).
    click(button);
    click(list.querySelector('[aria-label="North elevation"]'));
    expect(views.slice(-2)).toEqual(['north', 'north']);
  });

  it('keyboard: arrows move between views, Escape closes and returns focus', async () => {
    await mount();
    const button = q(`${B}[data-role="view-menu-button"]`);
    click(button);
    const items = [...(document.getElementById(button.getAttribute('aria-controls') as string) as HTMLElement).querySelectorAll('button')];
    expect(document.activeElement).toBe(items[0]);
    key(items[0] as HTMLElement, 'ArrowDown');
    expect(document.activeElement).toBe(items[1]);
    key(items[1] as HTMLElement, 'ArrowUp');
    key(items[0] as HTMLElement, 'ArrowUp');
    expect(document.activeElement).toBe(items.at(-1));
    key(items.at(-1) as HTMLElement, 'Escape');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(button);
  });

  it('the wall viewer has the same menu with its five views', async () => {
    await mount();
    const items = [...root.querySelectorAll('[data-workspace="wall"] .view-menu-item')].map((b) => b.getAttribute('aria-label'));
    expect(items).toEqual(['Show the oblique 3D view', 'Look at the interior face', 'Look at the exterior face', 'Look at the cut edge, showing the layers side by side', 'Plan view from above']);
  });
});

describe('results panel resize handle', () => {
  it('is a labelled, focusable separator; arrow keys change the height, Home restores the default; the height is remembered', async () => {
    const store = memoryStore();
    await mount(store);
    const handle = q(`${B}#b-results > [data-role="results-resizer"]`);
    expect(handle.getAttribute('role')).toBe('separator');
    expect(handle.getAttribute('tabindex')).toBe('0');
    expect(handle.getAttribute('aria-valuenow')).not.toBeNull();
    const panel = q(`${B}#b-results`);
    key(handle, 'ArrowUp');
    expect(panel.style.getPropertyValue('--results-user-h')).toMatch(/^\d+px$/);
    expect(store.getItem('building-thermal-simulator.results-height.building')).toMatch(/^\d+$/);
    key(handle, 'Home');
    expect(panel.style.getPropertyValue('--results-user-h')).toBe('');
    expect(store.getItem('building-thermal-simulator.results-height.building')).toBe('');
  });
});
