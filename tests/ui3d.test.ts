// @vitest-environment happy-dom
/**
 * The 3D panel and its connection to the editor, tested with a FAKE viewer
 * that records what it is asked to draw. (The real WebGL viewer is checked in a
 * real browser; here we check that the page asks for the right things.)
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { layerField } from '../src/editor';
import type { WallLayout } from '../src/geometry';
import { BUILT_IN_MATERIALS } from '../src/materials';
import type { ViewerFactory, ViewerHandlers, ViewPreset, WallViewer } from '../src/viewer3d';
import { mountWallEditor } from '../src/ui/app';
import type { WallEditorHandle } from '../src/ui/app';
import { createViewerPanel } from '../src/ui/viewerPanel';
import { wallSpecFromViews } from '../src/ui/wallSpec';
import { describeLayers } from '../src/editor';
import { createInitialDraft, buildWall } from '../src/editor';
import { at, expectClose } from './helpers/helpers';

interface FakeViewer extends WallViewer {
  layouts: WallLayout[];
  selections: Array<string | null>;
  labels: boolean[];
  views: ViewPreset[];
  destroyed: number;
  handlers: ViewerHandlers;
}

function makeFake(): { factory: ViewerFactory; viewer: () => FakeViewer; containers: HTMLElement[] } {
  let created: FakeViewer | null = null;
  const containers: HTMLElement[] = [];
  const factory: ViewerFactory = async (container, handlers) => {
    containers.push(container);
    const fake: FakeViewer = {
      layouts: [],
      selections: [],
      labels: [],
      views: [],
      destroyed: 0,
      handlers,
      update: (layout) => void fake.layouts.push(layout),
      select: (id) => void fake.selections.push(id),
      setLabelsVisible: (v) => void fake.labels.push(v),
      setView: (p) => void fake.views.push(p),
      destroy: () => void fake.destroyed++,
    };
    created = fake;
    return fake;
  };
  return { factory, viewer: () => created as FakeViewer, containers };
}

let root: HTMLElement;
let editor: WallEditorHandle;
const domId = (field: string): string => `f-${field.replace(/[^a-zA-Z0-9]+/g, '-')}`;
const el = <T extends HTMLElement>(field: string): T => document.getElementById(domId(field)) as T;
const type = (field: string, text: string): void => {
  const input = el<HTMLInputElement>(field);
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};
const chooseValue = (select: HTMLSelectElement, value: string): void => {
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
};
const click = (node: Element | null | undefined): void => void node?.dispatchEvent(new Event('click', { bubbles: true }));
const byLabel = (label: string): HTMLButtonElement => [...root.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === label || b.textContent === label) as HTMLButtonElement;
const legend = (): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('.legend-item')];
const pressed = (): string[] => legend().filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.layerId ?? '');
const notice = (): string => root.querySelector('.viewer-notice')?.textContent ?? '';
const checkbox = (id: string): HTMLInputElement => document.getElementById(id) as HTMLInputElement;

let fake: ReturnType<typeof makeFake>;
async function mount(materials = BUILT_IN_MATERIALS, factory?: ViewerFactory): Promise<void> {
  document.body.innerHTML = '';
  root = document.createElement('div');
  document.body.append(root);
  editor = mountWallEditor(root, materials, { viewerFactory: factory ?? fake.factory });
  await editor.ready;
}
beforeEach(async () => {
  fake = makeFake();
  await mount();
});
afterEach(() => editor.destroy());

describe('the 3D view is drawn from the validated wall', () => {
  it('the viewer gets a layout whose true thicknesses are exactly the SI values given to the engine', () => {
    const layout = at(fake.viewer().layouts, fake.viewer().layouts.length - 1);
    const wall = editor.getResult().wall;
    expect(layout.layers.map((l) => l.thicknessM)).toEqual(wall?.layers.map((l) => l.thicknessM));
    expect(layout.layers.map((l) => l.thicknessM)).toEqual([0.015, 0.2, 0.08, 0.02]);
    expect([layout.widthM, layout.heightM]).toEqual([wall?.widthM, wall?.heightM]);
    expect(layout.layers.map((l) => l.id)).toEqual(['layer-1', 'layer-2', 'layer-3', 'layer-4']);
    expect(layout.layers.map((l) => l.name)).toEqual(wall?.layers.map((l) => l.name));
  });

  it('starts with the thickness drawn 5× larger and says so; labels stay true', () => {
    const layout = fake.viewer().layouts.at(-1) as WallLayout;
    expect(layout.thicknessScale).toBe(5);
    expect(layout.layers.map((l) => l.sizeX)).toEqual([0.075, 1, 0.4, 0.1]);
    expect(layout.layers.map((l) => l.thicknessLabel)).toEqual(['15 mm', '200 mm', '80 mm', '20 mm']);
    expect(root.querySelector('[data-role="scale-note"]')?.textContent).toContain('5× larger for visibility');
  });

  it('typing a thickness redraws with the new size, converted from the unit shown', () => {
    type(layerField('layer-3', 'thickness'), '12'); // 12 mm
    expectClose((fake.viewer().layouts.at(-1) as WallLayout).layers[2]?.thicknessM ?? NaN, 0.012, 1e-12);
    chooseValue(root.querySelector(`#${domId(layerField('layer-3', 'thickness'))}`)?.parentElement?.querySelector('select.unit') as HTMLSelectElement, 'cm');
    type(layerField('layer-3', 'thickness'), '3'); // now 3 cm
    expectClose((fake.viewer().layouts.at(-1) as WallLayout).layers[2]?.thicknessM ?? NaN, 0.03, 1e-12);
  });

  it('changing width or height redraws with the new box sizes', () => {
    type('width', '6');
    expect((fake.viewer().layouts.at(-1) as WallLayout).layers.every((l) => l.sizeZ === 6)).toBe(true);
    type('height', '4,2');
    expect((fake.viewer().layouts.at(-1) as WallLayout).layers.every((l) => l.sizeY === 4.2)).toBe(true);
  });

  it('reordering layers redraws in the new order', () => {
    click(byLabel('Move layer 3 toward the interior'));
    expect((fake.viewer().layouts.at(-1) as WallLayout).layers.map((l) => l.id)).toEqual(['layer-1', 'layer-3', 'layer-2', 'layer-4']);
  });

  it('choosing another material changes the layer\'s name and colour category', () => {
    chooseValue(el<HTMLSelectElement>(layerField('layer-3', 'material')), 'mineral-wool-slab');
    const box = (fake.viewer().layouts.at(-1) as WallLayout).layers[2];
    expect(box?.name).toBe('Mineral wool slab (demonstration)');
    expect(box?.category).toBe('Mineral wool');
  });

  it('removing and adding layers redraws', () => {
    click(byLabel('Remove layer 4'));
    expect((fake.viewer().layouts.at(-1) as WallLayout).layers).toHaveLength(3);
    click(byLabel('Add layer (exterior end)'));
    expect((fake.viewer().layouts.at(-1) as WallLayout).layers).toHaveLength(3); // incomplete layer is NOT drawn
    chooseValue(el<HTMLSelectElement>(layerField('layer-5', 'material')), 'xps-board');
    type(layerField('layer-5', 'thickness'), '30');
    const layout = fake.viewer().layouts.at(-1) as WallLayout;
    expect(layout.layers).toHaveLength(4);
    expect(at(layout.layers, 3)).toMatchObject({ id: 'layer-5', thicknessM: 0.03, category: 'XPS' });
  });
});

describe('invalid input never reaches the 3D view', () => {
  it('keeps the last valid wall, keeps the list, and says so', () => {
    const drawn = fake.viewer().layouts.length;
    type(layerField('layer-1', 'thickness'), '-5');
    expect(fake.viewer().layouts).toHaveLength(drawn); // nothing new was drawn
    expect(notice()).toContain('Showing the last valid wall');
    expect(legend()).toHaveLength(4); // regression: the list must not vanish
    expect(root.querySelector('.inspector')).not.toBeNull();
    expect(root.querySelector('[data-role="viewer-controls"]')?.hasAttribute('hidden')).toBe(false);
  });

  it('every kind of invalid input is held back, and drawing resumes when it is fixed', () => {
    for (const [field, bad, good] of [
      ['width', '0', '3.5'],
      ['height', 'abc', '2.6'],
      [layerField('layer-2', 'thickness'), '', '210'],
      ['insideTemperature', '-400', '20'], // fixed to the SAME value: the wall is unchanged, so no redraw
    ] as const) {
      const before = fake.viewer().layouts.length;
      type(field, bad);
      expect(fake.viewer().layouts, `${field} invalid`).toHaveLength(before);
      expect(notice(), `${field} invalid`).toContain('last valid wall');
      type(field, good);
      expect(notice(), `${field} fixed`).toBe('');
      const redrawn = fake.viewer().layouts.length - before;
      expect(redrawn, `${field} fixed`).toBe(field === 'insideTemperature' ? 0 : 1);
    }
  });

  it('a layer without a material or thickness is not drawn', () => {
    const drawn = fake.viewer().layouts.length;
    click(byLabel('Add layer (exterior end)'));
    expect(fake.viewer().layouts).toHaveLength(drawn);
    expect(legend()).toHaveLength(4);
  });

  it('typing that does not change the wall (e.g. 15 → 15.0) does not redraw it', () => {
    const drawn = fake.viewer().layouts.length;
    type(layerField('layer-1', 'thickness'), '15.0');
    type(layerField('layer-1', 'thickness'), '015');
    expect(fake.viewer().layouts).toHaveLength(drawn);
    type(layerField('layer-1', 'thickness'), '16');
    expect(fake.viewer().layouts).toHaveLength(drawn + 1);
  });

  it('the notice does not change on every keystroke while the input stays invalid', () => {
    type('width', '-');
    const first = root.querySelector('.viewer-notice p');
    type('width', '-1');
    type('width', '-12');
    expect(root.querySelector('.viewer-notice p')).toBe(first); // same element: not re-announced
  });
});

describe('display controls', () => {
  it('Exploded view asks for an exploded layout with gaps, and turning it off restores the assembled one', () => {
    checkbox('v-exploded').checked = true;
    checkbox('v-exploded').dispatchEvent(new Event('change', { bubbles: true }));
    let layout = fake.viewer().layouts.at(-1) as WallLayout;
    expect(layout.exploded).toBe(true);
    expect(layout.gapM).toBeGreaterThan(0);
    expect(root.querySelector('[data-role="scale-note"]')?.textContent).toContain('not air gaps');
    checkbox('v-exploded').checked = false;
    checkbox('v-exploded').dispatchEvent(new Event('change', { bubbles: true }));
    layout = fake.viewer().layouts.at(-1) as WallLayout;
    expect([layout.exploded, layout.gapM]).toEqual([false, 0]);
  });

  it('the thickness scale select changes box thickness but never the true thickness', () => {
    const select = document.getElementById('v-scale') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(['1', '2', '5', '10']);
    expect(select.value).toBe('5');
    chooseValue(select, '1');
    let layout = fake.viewer().layouts.at(-1) as WallLayout;
    expect(layout.layers.map((l) => l.sizeX)).toEqual([0.015, 0.2, 0.08, 0.02]);
    expect(root.querySelector('[data-role="scale-note"]')?.textContent).toBe('');
    chooseValue(select, '10');
    layout = fake.viewer().layouts.at(-1) as WallLayout;
    expect(layout.layers.map((l) => l.thicknessM)).toEqual([0.015, 0.2, 0.08, 0.02]);
    expect(layout.layers.map((l) => l.thicknessLabel)).toEqual(['15 mm', '200 mm', '80 mm', '20 mm']);
  });

  it('labels checkbox is forwarded to the viewer', () => {
    checkbox('v-labels').checked = false;
    checkbox('v-labels').dispatchEvent(new Event('change', { bubbles: true }));
    expect(fake.viewer().labels.at(-1)).toBe(false);
  });

  it('the four camera buttons ask for the four views', () => {
    for (const label of ['Reset to the 3D view', 'Look at the interior face', 'Look at the exterior face', 'Look at the cut edge, showing the layers side by side']) click(byLabel(label));
    expect(fake.viewer().views).toEqual(['iso', 'interior', 'exterior', 'section']);
  });

  it('the legend lists true thicknesses and marks the interior and exterior layers', () => {
    expect(legend().map((b) => b.querySelector('.legend-text')?.textContent)).toEqual([
      '1. Gypsum plaster (demonstration) — 15 mm',
      '2. Clay brick, solid (demonstration) — 200 mm',
      '3. Expanded polystyrene (EPS) slab (demonstration) — 80 mm',
      '4. Cement plaster / render (demonstration) — 20 mm',
    ]);
    expect(legend()[0]?.textContent).toContain('Interior face');
    expect(legend()[3]?.textContent).toContain('Exterior face');
    expect(legend()[1]?.textContent).not.toContain('face');
  });

  it('the panel says colours are categories, not temperatures, and that this is not a thermal result', () => {
    expect(root.querySelector('#viewer')?.textContent).toContain('Colours identify material categories only; they are not temperatures');
    expect(root.querySelector('#viewer')?.textContent).toContain('geometry, not a thermal result');
  });
});

describe('selecting and inspecting layers', () => {
  it('clicking a legend item selects the layer everywhere: viewer, list, card and inspector', () => {
    click(legend()[2]);
    expect(pressed()).toEqual(['layer-3']);
    expect(fake.viewer().selections.at(-1)).toBe('layer-3');
    expect(root.querySelector('li.layer.selected')?.getAttribute('data-key')).toBe('layer-3');
    expect(root.querySelector('[data-role="inspect"][aria-pressed="true"]')?.getAttribute('aria-label')).toBe('Inspect layer 3 in the 3D view');
    const inspector = root.querySelector('.inspector')?.textContent ?? '';
    expect(inspector).toContain('Layer 3: Expanded polystyrene (EPS) slab (demonstration)');
    expect(inspector).toContain('80 mm');
    expect(inspector).toContain('15 mm + 200 mm'.length ? '215 mm to 295 mm from the interior face' : '');
    expect(inspector).toContain('λ 0.035 W/(m·K) · ρ 25 kg/m³ · c_p 1450 J/(kg·K)');
    expect(inspector).toContain('Illustrative; value type: unspecified; source type: none');
    expect(inspector).toContain('Not confirmed as an approved Cypriot design value');
  });

  it('the first and last layers say they touch the interior and exterior faces', () => {
    click(legend()[0]);
    expect(root.querySelector('.inspector')?.textContent).toContain('0 mm to 15 mm from the interior face (touches the interior face)');
    click(legend()[3]);
    expect(root.querySelector('.inspector')?.textContent).toContain('(touches the exterior face)');
  });

  it('a click in the 3D view (reported by the viewer) selects, and the same layer again deselects', () => {
    fake.viewer().handlers.onSelect?.('layer-2');
    expect(pressed()).toEqual(['layer-2']);
    expect(fake.viewer().selections.at(-1)).toBe('layer-2');
    fake.viewer().handlers.onSelect?.('layer-2');
    expect(pressed()).toEqual([]);
    expect(fake.viewer().selections.at(-1)).toBeNull();
    fake.viewer().handlers.onSelect?.('layer-4');
    fake.viewer().handlers.onSelect?.(null); // click on empty space
    expect(pressed()).toEqual([]);
  });

  it('the Inspect button in a layer card toggles the selection', () => {
    click(root.querySelector('[aria-label="Inspect layer 2 in the 3D view"]'));
    expect(pressed()).toEqual(['layer-2']);
    click(root.querySelector('[aria-label="Inspect layer 2 in the 3D view"]'));
    expect(pressed()).toEqual([]);
  });

  it('only one layer is selected at a time', () => {
    click(legend()[0]);
    click(legend()[1]);
    expect(pressed()).toEqual(['layer-2']);
    expect(root.querySelectorAll('li.layer.selected')).toHaveLength(1);
  });

  it('the selection follows the layer when layers are reordered', () => {
    click(legend()[2]);
    click(byLabel('Move layer 3 toward the interior'));
    expect(pressed()).toEqual(['layer-3']);
    expect(root.querySelector('.inspector')?.textContent).toContain('Layer 2: Expanded polystyrene');
    expect(root.querySelector('li.layer.selected')?.getAttribute('data-key')).toBe('layer-3');
  });

  it('the selection survives edits, and is cleared when its layer is removed', () => {
    click(legend()[1]);
    type('width', '5');
    expect(pressed()).toEqual(['layer-2']);
    click(byLabel('Remove layer 2'));
    expect(pressed()).toEqual([]);
    expect(root.querySelectorAll('li.layer.selected')).toHaveLength(0);
    expect(fake.viewer().selections.at(-1)).toBeNull();
    expect(root.querySelector('.inspector')?.textContent).toContain('Select a layer');
  });

  it('the Inspect button on a layer that is not drawn yet explains why instead of selecting', () => {
    click(byLabel('Add layer (exterior end)'));
    click(root.querySelector('[aria-label="Inspect layer 5 in the 3D view"]'));
    expect(pressed()).toEqual([]);
    expect(document.getElementById('announcer')?.textContent).toContain('Layer 5 is not drawn yet');
  });

  it('the inspector shows missing properties instead of hiding them', async () => {
    const { createCustomMaterial, mergeMaterials } = await import('../src/materials');
    const { material } = createCustomMaterial({ name: 'Only lambda', lambdaWPerMK: 0.3 });
    fake = makeFake();
    await mount(mergeMaterials(BUILT_IN_MATERIALS, [material]));
    chooseValue(el<HTMLSelectElement>(layerField('layer-1', 'material')), material.id);
    click(legend()[0]);
    expect(root.querySelector('.inspector')?.textContent).toContain('ρ missing');
    expect(root.querySelector('.inspector')?.textContent).toContain('c_p missing');
    expect(root.querySelector('.inspector')?.textContent).toContain('User-defined');
  });
});

describe('when 3D is not available', () => {
  it('a factory that returns null (no WebGL) leaves a clear message and a working text list', async () => {
    await mount(BUILT_IN_MATERIALS, async () => null);
    expect(notice()).toContain('3D graphics (WebGL) are not available here');
    expect((root.querySelector('.viewer-stage') as HTMLElement).hidden).toBe(true);
    expect((root.querySelector('[data-role="viewer-controls"]') as HTMLElement).hidden).toBe(true);
    expect(legend()).toHaveLength(4);
    click(legend()[1]);
    expect(pressed()).toEqual(['layer-2']); // selection and inspector work without 3D
    expect(root.querySelector('.inspector')?.textContent).toContain('Layer 2');
  });

  it('a factory that throws is treated the same way', async () => {
    await mount(BUILT_IN_MATERIALS, async () => {
      throw new Error('boom');
    });
    expect(notice()).toContain('not available');
    expect(editor.getResult().ok).toBe(true); // the editor itself is unaffected
  });

  it('with no factory at all the editor works in text-only mode', async () => {
    document.body.innerHTML = '';
    root = document.createElement('div');
    document.body.append(root);
    editor = mountWallEditor(root);
    await editor.ready;
    expect(notice()).toContain('not available');
    expect(legend()).toHaveLength(4);
    type('width', '4');
    expect(editor.viewer.getLayout()?.layers[0]?.sizeZ).toBe(4);
  });

  it('while the viewer is loading, the page says so and is already usable', async () => {
    let release: (v: WallViewer | null) => void = () => {};
    document.body.innerHTML = '';
    root = document.createElement('div');
    document.body.append(root);
    editor = mountWallEditor(root, BUILT_IN_MATERIALS, { viewerFactory: () => new Promise((resolve) => (release = resolve)) });
    expect(notice()).toContain('Loading the 3D view');
    type('width', '4'); // editing works while loading
    expect(editor.getResult().ok).toBe(true);
    release(null);
    await editor.ready;
    expect(notice()).not.toContain('Loading');
  });

  it('the viewer receives the current layout and selection as soon as it finishes loading', async () => {
    let release: (v: WallViewer | null) => void = () => {};
    document.body.innerHTML = '';
    root = document.createElement('div');
    document.body.append(root);
    editor = mountWallEditor(root, BUILT_IN_MATERIALS, { viewerFactory: () => new Promise((resolve) => (release = resolve)) });
    type('width', '4');
    click(legend()[1]);
    const late = makeFake();
    const viewer = await late.factory(document.createElement('div'), {});
    release(viewer);
    await editor.ready;
    const fakeViewer = late.viewer();
    expect((fakeViewer.layouts.at(-1) as WallLayout).layers[0]?.sizeZ).toBe(4);
    expect(fakeViewer.selections.at(-1)).toBe('layer-2');
  });
});

describe('cleanup', () => {
  it('destroy() releases the viewer exactly once', () => {
    editor.destroy();
    editor.destroy(); // a second call must not reach the viewer again
    expect(fake.viewer().destroyed).toBe(1);
  });

  it('destroying before the viewer has loaded releases it as soon as it arrives', async () => {
    let release: (v: WallViewer | null) => void = () => {};
    document.body.innerHTML = '';
    root = document.createElement('div');
    document.body.append(root);
    editor = mountWallEditor(root, BUILT_IN_MATERIALS, { viewerFactory: () => new Promise((resolve) => (release = resolve)) });
    editor.destroy();
    const late = makeFake();
    release(await late.factory(document.createElement('div'), {}));
    await editor.ready;
    expect(late.viewer().destroyed).toBe(1);
    expect(late.viewer().layouts).toHaveLength(0); // and nothing was drawn into it
  });
});

describe('wallSpecFromViews (editor → 3D)', () => {
  const draft = createInitialDraft(BUILT_IN_MATERIALS);
  const wall = buildWall(draft, BUILT_IN_MATERIALS).wall;
  const views = describeLayers(draft, BUILT_IN_MATERIALS);

  it('takes sizes only from the validated SI wall and identity from the layer views', () => {
    if (!wall) throw new Error('wall expected');
    const spec = wallSpecFromViews(wall, views);
    expect(spec.widthM).toBe(3);
    expect(spec.heightM).toBe(2.5);
    expect(spec.layers.map((l) => [l.id, l.thicknessM, l.category, l.status])).toEqual([
      ['layer-1', 0.015, 'Gypsum plaster', 'illustrative'],
      ['layer-2', 0.2, 'Clay brick', 'illustrative'],
      ['layer-3', 0.08, 'EPS', 'illustrative'],
      ['layer-4', 0.02, 'Cement plaster', 'illustrative'],
    ]);
  });

  it('refuses mismatched or incomplete input instead of drawing something wrong', () => {
    if (!wall) throw new Error('wall expected');
    expect(() => wallSpecFromViews(wall, views.slice(1))).toThrow('4 layers but 3 layer views');
    const noMaterial = views.map((v, i) => (i === 1 ? { ...v, material: null } : v));
    expect(() => wallSpecFromViews(wall, noMaterial)).toThrow('Layer 2 has no material');
  });
});

describe('the panel on its own', () => {
  it('with no wall yet it asks for a valid wall and shows no legend', () => {
    const panel = createViewerPanel();
    document.body.append(panel.element);
    expect(panel.element.querySelector('.viewer-notice')?.textContent).toContain('Enter a valid wall in the editor');
    expect(panel.element.querySelectorAll('.legend-item')).toHaveLength(0);
    expect(panel.getLayout()).toBeNull();
    panel.element.remove();
  });

  it('select() ignores layers that do not exist', () => {
    const panel = createViewerPanel();
    panel.select('ghost');
    expect(panel.getSelected()).toBeNull();
    expect(panel.hasLayer('ghost')).toBe(false);
  });
});
