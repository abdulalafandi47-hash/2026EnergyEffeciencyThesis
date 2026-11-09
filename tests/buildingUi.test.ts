// @vitest-environment happy-dom
/**
 * The building-envelope workspace in a simulated browser with a FAKE 3D viewer:
 * blank and example projects, adding / duplicating / deleting components, the
 * editor, validation, selection between list, 3D and results, and the switch
 * between the single-wall calculator and the building workspace.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { HouseLayout } from '../src/geometry';
import { fluxColor, NOT_CALCULATED_COLOR } from '../src/geometry';
import { BUILT_IN_MATERIALS } from '../src/materials';
import { mountBuildingWorkspace } from '../src/ui/buildingWorkspace';
import type { BuildingWorkspaceHandle } from '../src/ui/buildingWorkspace';
import { fluxView } from '../src/ui/houseSpec';
import { mountShell } from '../src/ui/shell';
import type { ShellHandle } from '../src/ui/shell';
import type { HouseViewer, HouseViewerFactory, HouseViewerHandlers, HouseViewPreset } from '../src/viewer3d';
import { expectClose } from './helpers/helpers';
import { chooseValue, click, makeFake, setChecked } from './helpers/ui';

interface FakeHouseViewer extends HouseViewer {
  layouts: HouseLayout[];
  selections: Array<string | null>;
  colours: Array<Record<string, string> | null>;
  views: HouseViewPreset[];
  handlers: HouseViewerHandlers;
  destroyed: number;
}

function makeFakeHouse(): { factory: HouseViewerFactory; viewer: () => FakeHouseViewer } {
  let created: FakeHouseViewer | null = null;
  const factory: HouseViewerFactory = async (_container, handlers) => {
    const fake: FakeHouseViewer = {
      layouts: [], selections: [], colours: [], views: [], handlers, destroyed: 0,
      update: (l) => void fake.layouts.push(l),
      select: (id) => void fake.selections.push(id),
      setColours: (c) => void fake.colours.push(c),
      setView: (v) => void fake.views.push(v),
      setGridVisible: () => undefined,
      setAxesVisible: () => undefined,
      setNavigationMode: () => undefined,
      zoom: () => undefined,
      destroy: () => void fake.destroyed++,
    };
    created = fake;
    return fake;
  };
  return { factory, viewer: () => created as FakeHouseViewer };
}

let root: HTMLElement;
let ws: BuildingWorkspaceHandle;
let fake: ReturnType<typeof makeFakeHouse>;
let confirms: string[];
let answer: boolean;

async function mount(): Promise<void> {
  document.body.innerHTML = '';
  root = document.createElement('div');
  document.body.append(root);
  fake = makeFakeHouse();
  confirms = [];
  answer = true;
  ws = mountBuildingWorkspace(root, { houseViewerFactory: fake.factory, confirm: (m) => (confirms.push(m), answer) });
  await ws.ready;
}
afterEach(() => ws?.destroy());

const q = <T extends Element = HTMLElement>(selector: string): T => root.querySelector(selector) as T;
const role = <T extends Element = HTMLElement>(r: string): T => q<T>(`[data-role="${r}"]`);
const input = (focusId: string): HTMLInputElement => document.getElementById(`b-${focusId}`) as HTMLInputElement;
function typeIn(focusId: string, text: string): void {
  const box = input(focusId);
  box.value = text;
  box.dispatchEvent(new Event('input', { bubbles: true }));
}
const listRows = (): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('[data-role="b-list"] li.b-row')];
const resultOf = (id: string) => ws.getResult().components.find((r) => r.componentId === id);
function addComponent(type: string): string {
  chooseValue(q<HTMLSelectElement>('#b-add-type'), type);
  click(role('b-add'));
  return ws.getSelected() as string;
}
const loadExample = (): void => click(role('b-example'));

describe('building workspace: start options', () => {
  it('starts blank: no components, nothing calculated, a hint instead of a house', async () => {
    await mount();
    expect(ws.getProject().components).toHaveLength(0);
    expect(listRows()).toHaveLength(0);
    expect(role('b-list').textContent).toContain('No components yet');
    expect(role('b-example-note').hidden).toBe(true);
    expect(q('.viewer-notice').textContent).toContain('Blank project');
    expect(q('[data-bkpi="net"] .kpi-number').textContent).toBe('—');
  });

  it('the example house is clearly labelled illustrative and draws every element', async () => {
    await mount();
    loadExample();
    const p = ws.getProject();
    expect(p.isExample).toBe(true);
    expect(p.components).toHaveLength(14);
    expect(role('b-example-note').hidden).toBe(false);
    expect(role('b-example-note').textContent?.toLowerCase()).toContain('illustrative');
    expect(listRows()).toHaveLength(14);
    const layout = fake.viewer().layouts.at(-1) as HouseLayout;
    const drawn = new Set(layout.boxes.map((b) => b.componentId));
    for (const c of p.components) expect(drawn.has(c.id)).toBe(true);
    // No invented window/door values: they are reported as missing data, not calculated.
    expect(resultOf('c8')?.status).toBe('missing-data');
    expect(resultOf('c14')?.status).toBe('missing-data');
    expect(resultOf('c6')?.status).toBe('unsupported');
    expect(resultOf('c7')?.status).toBe('excluded');
    expect(resultOf('c1')?.status).toBe('calculated');
    expect(role('not-included').textContent).toContain('Ground floor slab');
  });

  it('replacing a non-empty project asks first; "no" keeps it', async () => {
    await mount();
    loadExample();
    answer = false;
    click(role('b-new'));
    expect(confirms.at(-1)).toContain('replaces the current project (14 components)');
    expect(ws.getProject().components).toHaveLength(14);
    answer = true;
    click(role('b-new'));
    expect(ws.getProject().components).toHaveLength(0);
  });

  it('editing the example removes its "example" status but keeps the illustrative note', async () => {
    await mount();
    loadExample();
    typeIn('g-length', '12');
    expect(ws.getProject().isExample).toBe(false);
    expect(role('b-example-note').hidden).toBe(false);
  });
});

describe('building workspace: components', () => {
  it('adds a wall without inventing data: missing data until layers are entered', async () => {
    await mount();
    const id = addComponent('exterior-wall');
    expect(ws.getProject().components).toHaveLength(1);
    expect(resultOf(id)?.status).toBe('missing-data');
    expect(q('[data-role="b-list"] li.b-row .status').textContent).toBe('Missing data');
    // Add a layer: material + thickness.
    click(role('b-layer-add'));
    chooseValue(input('layer-0-mat') as unknown as HTMLSelectElement, 'clay-brick-solid');
    typeIn('layer-0-t', '200');
    const r = resultOf(id);
    expect(r?.status).toBe('calculated');
    const brick = BUILT_IN_MATERIALS.find((m) => m.id === 'clay-brick-solid');
    const lambda = brick?.lambdaWPerMK as number;
    expectClose(r?.uValueWPerM2K as number, 1 / (0.13 + 0.2 / lambda + 0.04), 1e-9);
    // Q = U·A·ΔT, blank project: north wall 10 m × 3 m, 26 → 35 °C (a gain).
    expectClose(r?.heatFlowW as number, (r?.uValueWPerM2K as number) * 30 * (26 - 35), 1e-9);
    expect(role('b-selected-results').textContent).toContain('U-value');
  });

  it('invalid input shows a message and is not committed', async () => {
    await mount();
    typeIn('g-length', 'abc');
    expect(input('g-length').getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById('b-g-length-msg')?.textContent).toContain('must be a number');
    expect(ws.getProject().geometry.lengthM).toBe(10);
    typeIn('g-length', '-3');
    expect(ws.getProject().geometry.lengthM).toBe(10);
    typeIn('g-length', '11.5');
    expect(input('g-length').getAttribute('aria-invalid')).toBe('false');
    expect(ws.getProject().geometry.lengthM).toBe(11.5);
  });

  it('changing the house dimensions updates areas, results and the 3D geometry', async () => {
    await mount();
    loadExample();
    const before = resultOf('c3')?.dimensions.netAreaM2 as number;
    const drawn = fake.viewer().layouts.length;
    typeIn('g-length', '12');
    const after = resultOf('c3')?.dimensions.netAreaM2 as number;
    expectClose(after - before, 2 * 2.8, 1e-9); // south wall 2 m longer
    expect(fake.viewer().layouts.length).toBe(drawn + 1);
    expectClose((fake.viewer().layouts.at(-1) as HouseLayout).lengthM, 12, 1e-12);
  });

  it('a documented window U-value (with a source) makes the window calculated', async () => {
    await mount();
    loadExample();
    ws.select('c8');
    typeIn('u-value', '1.8');
    expect(resultOf('c8')?.status).toBe('invalid'); // a value without a source is not used
    expect(resultOf('c8')?.reasons.join(' ')).toContain('source of the value is missing');
    typeIn('u-source', 'Manufacturer datasheet XYZ (test)');
    const r = resultOf('c8');
    expect(r?.status).toBe('calculated');
    expectClose(r?.heatFlowW as number, 1.8 * 1.5 * 1.2 * (26 - 35), 1e-9);
    expect(role('b-documented').textContent).toContain('Manufacturer datasheet XYZ');
    // Typing continues in the same box (the editor is not re-drawn under the cursor).
    expect(document.activeElement === input('u-source') || document.activeElement === document.body).toBe(true);
  });

  it('duplicating an opening places a copy beside it; a roof cannot be duplicated', async () => {
    await mount();
    loadExample();
    ws.select('c11');
    click(role('b-duplicate'));
    const copy = ws.getProject().components.find((c) => c.id === ws.getSelected());
    expect(copy?.id).not.toBe('c11');
    expect(copy && 'offsetM' in copy ? copy.offsetM : null).toBeCloseTo(6 + 1 + 0.3, 9);
    ws.select('c5');
    const count = ws.getProject().components.length;
    click(role('b-duplicate'));
    expect(ws.getProject().components.length).toBe(count);
  });

  it('deleting a wall asks, names its openings, and removes them too', async () => {
    await mount();
    loadExample();
    ws.select('c3');
    answer = false;
    click(role('b-delete'));
    expect(confirms.at(-1)).toContain('South window 1');
    expect(ws.getProject().components.some((c) => c.id === 'c3')).toBe(true);
    answer = true;
    click(role('b-delete'));
    const ids = ws.getProject().components.map((c) => c.id);
    for (const gone of ['c3', 'c8', 'c9', 'c10']) expect(ids).not.toContain(gone);
    expect(ws.getSelected()).toBeNull();
  });

  it('only one roof can be added; the add list says why', async () => {
    await mount();
    addComponent('roof');
    chooseValue(q<HTMLSelectElement>('#b-add-type'), 'roof');
    click(role('b-add'));
    expect(ws.getProject().components.filter((c) => c.type === 'roof')).toHaveLength(1);
    expect(role('b-add-msg').textContent).not.toBe('');
  });

  it('hiding keeps the data and the result; it only leaves the 3D view', async () => {
    await mount();
    loadExample();
    const q1 = resultOf('c1')?.heatFlowW;
    const box = q<HTMLInputElement>('[data-component="c1"] input[type="checkbox"]');
    setChecked(box, false);
    expect(ws.getProject().components.find((c) => c.id === 'c1')?.visible).toBe(false);
    expect(resultOf('c1')?.heatFlowW).toBe(q1);
    const drawn = (fake.viewer().layouts.at(-1) as HouseLayout).boxes.map((b) => b.componentId);
    expect(drawn).not.toContain('c1');
    setChecked(q<HTMLInputElement>('[data-component="c1"] input[type="checkbox"]'), true);
    expect((fake.viewer().layouts.at(-1) as HouseLayout).boxes.some((b) => b.componentId === 'c1')).toBe(true);
  });
});

describe('building workspace: editor details', () => {
  const select = (focusId: string): HTMLSelectElement => document.getElementById(`b-${focusId}`) as HTMLSelectElement;
  const layerIds = (id: string): Array<string | null> => {
    const c = ws.getProject().components.find((x) => x.id === id);
    return c && 'construction' in c ? c.construction.layers.map((l) => l.materialId) : [];
  };

  it('layers can be moved and removed; the U-value follows', async () => {
    await mount();
    loadExample();
    ws.select('c1');
    expect(layerIds('c1')).toEqual(['gypsum-plaster', 'clay-brick-solid', 'eps-slab', 'cement-plaster']);
    click(q('[data-focus-id="layer-0-down"]'));
    expect(layerIds('c1')).toEqual(['clay-brick-solid', 'gypsum-plaster', 'eps-slab', 'cement-plaster']);
    click(q('[data-focus-id="layer-1-up"]'));
    expect(layerIds('c1')[0]).toBe('gypsum-plaster');
    const before = resultOf('c1')?.uValueWPerM2K as number;
    click(q('[data-focus-id="layer-2-remove"]')); // the EPS insulation
    expect(layerIds('c1')).toEqual(['gypsum-plaster', 'clay-brick-solid', 'cement-plaster']);
    expect(resultOf('c1')?.uValueWPerM2K as number).toBeGreaterThan(before);
  });

  it('an unconditioned space needs its temperature; nothing is assumed', async () => {
    await mount();
    loadExample();
    ws.select('c2');
    typeIn('name', 'East wall to garage');
    chooseValue(select('exposure'), 'unconditioned');
    const wall = ws.getProject().components.find((c) => c.id === 'c2');
    expect(wall?.name).toBe('East wall to garage'); // the typed name survives the exposure change
    expect(resultOf('c2')?.status).toBe('missing-data');
    expect(resultOf('c2')?.reasons.join(' ')).toContain('temperature of the unconditioned space');
    expect(resultOf('c12')?.status).toBe('missing-data'); // its window too
    typeIn('exposure-t', '30');
    const r = resultOf('c2');
    expect(r?.status).toBe('calculated');
    expect(r?.otherSideC).toBe(30);
    expect(r?.surface?.outsideM2KPerW).toBe(r?.surface?.insideM2KPerW); // R_si on both sides
  });

  it('a door can switch from a documented U-value to layers', async () => {
    await mount();
    loadExample();
    ws.select('c14');
    chooseValue(select('door-kind'), 'layers');
    const door = ws.getProject().components.find((c) => c.id === 'c14');
    expect(door?.type === 'door' && door.spec.kind).toBe('layers');
    click(role('b-layer-add'));
    chooseValue(select('layer-0-mat'), 'clay-brick-solid'); // any material, only to exercise the path
    typeIn('layer-0-t', '50');
    expect(resultOf('c14')?.status).toBe('calculated');
    expect(resultOf('c14')?.surface?.insideM2KPerW).toBe(0.13);
  });

  it('a partition can be moved and made to face an unconditioned room', async () => {
    await mount();
    loadExample();
    ws.select('c7');
    typeIn('position', '3');
    const p = ws.getProject().components.find((c) => c.id === 'c7');
    expect(p?.type === 'partition' && p.positionM).toBe(3);
    typeIn('position', '0');
    expect(document.getElementById('b-position-msg')?.textContent).toContain('greater than zero');
    chooseValue(select('exposure'), 'unconditioned');
    typeIn('exposure-t', '30');
    expect(resultOf('c7')?.status).toBe('calculated');
  });

  it('the editor Hide button agrees with the list checkbox', async () => {
    await mount();
    loadExample();
    ws.select('c1');
    setChecked(q<HTMLInputElement>('[data-component="c1"] input[type="checkbox"]'), false);
    expect(role('b-visibility').textContent).toBe('Show in 3D');
    click(role('b-visibility'));
    expect(ws.getProject().components.find((c) => c.id === 'c1')?.visible).toBe(true);
  });

  it('a window can move to another wall; one that does not fit is reported', async () => {
    await mount();
    loadExample();
    ws.select('c11');
    chooseValue(select('host'), 'c2');
    const w = ws.getProject().components.find((c) => c.id === 'c11');
    expect(w && 'hostId' in w ? w.hostId : null).toBe('c2');
    typeIn('width', '20');
    expect(resultOf('c11')?.status).toBe('invalid');
    expect(role('model-issues').textContent).toContain('North window');
  });
});

describe('building workspace: panels', () => {
  it('results tabs work with the arrow keys; collapse and enlarge', async () => {
    await mount();
    q('#btab-envelope').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(q('#btab-not-included').getAttribute('aria-selected')).toBe('true');
    q('#btab-not-included').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(q('#btab-envelope').getAttribute('aria-selected')).toBe('true');
    const [enlarge, collapse] = [...q('#b-results .results-actions').querySelectorAll('button')];
    click(collapse);
    expect(q('#b-results-body').hidden).toBe(true);
    click(q('#btab-assumptions')); // choosing a tab opens the panel again
    expect(q('#b-results-body').hidden).toBe(false);
    click(enlarge);
    expect(q('#b-results').classList.contains('enlarged')).toBe(true);
  });

  it('toolbar buttons reach the 3D viewer', async () => {
    await mount();
    loadExample();
    for (const label of ['Plan view from above (north at the top)', 'North elevation', '3D view from the north-west']) click(q(`button[aria-label="${label}"]`));
    expect(fake.viewer().views).toEqual(['top', 'north', 'iso-nw']);
    click(q('button[aria-label="Reset to the 3D view from the south-east"]'));
    expect(fake.viewer().views.at(-1)).toBe('iso-se');
    expect(q('[data-role="house-statusbar"]').textContent).toContain('House 10 × 8 m');
  });

  it('the sidebar can be hidden', async () => {
    await mount();
    click(role('b-sidebar-toggle'));
    expect(q('.building-workspace').classList.contains('sidebar-collapsed')).toBe(true);
    expect(role('b-sidebar-toggle').getAttribute('aria-expanded')).toBe('false');
  });
});

describe('building workspace: selection and results', () => {
  it('a click in 3D selects in the list, the editor and the results table', async () => {
    await mount();
    loadExample();
    fake.viewer().handlers.onSelect?.('c2');
    expect(ws.getSelected()).toBe('c2');
    expect(fake.viewer().selections.at(-1)).toBe('c2');
    expect(q('[data-component="c2"].b-row').classList.contains('selected')).toBe(true);
    expect(q<HTMLInputElement>('#b-name').value).toBe('East wall');
    expect(q('[data-role="envelope-table"] tr[data-component="c2"]').className).toContain('variant-current');
    // …and a click on empty space clears it.
    fake.viewer().handlers.onSelect?.(null);
    expect(ws.getSelected()).toBeNull();
  });

  it('a click on a results-table row selects that element', async () => {
    await mount();
    loadExample();
    click(q('[data-role="envelope-table"] tr[data-component="c5"] button'));
    expect(ws.getSelected()).toBe('c5');
  });

  it('the net heat flow tile equals the sum of the calculated elements only', async () => {
    await mount();
    loadExample();
    const r = ws.getResult();
    const sum = r.components.filter((c) => c.status === 'calculated').reduce((s, c) => s + (c.heatFlowW as number), 0);
    expectClose(r.netHeatFlowW, sum, 1e-9);
    expect(r.components.find((c) => c.componentId === 'c7')?.heatFlowW ?? null).toBeNull(); // partition not counted
    expect(q('[data-bkpi="net"] .kpi-number').textContent).toContain('in (gain)');
  });

  it('the heat-flux colour mode greys elements without a result', async () => {
    await mount();
    loadExample();
    chooseValue(q<HTMLSelectElement>('#h-colour'), 'flux');
    const colours = fake.viewer().colours.at(-1) as Record<string, string>;
    expect(colours.c6).toBe(NOT_CALCULATED_COLOR); // ground floor: unsupported
    expect(colours.c8).toBe(NOT_CALCULATED_COLOR); // window: missing data
    expect(colours.c1).not.toBe(NOT_CALCULATED_COLOR);
    expect(role('flux-legend').hidden).toBe(false);
  });

  it('the heat-flux scale starts at zero, so similar elements get similar colours', async () => {
    await mount();
    loadExample();
    const view = fluxView(ws.getResult());
    expect(view.range?.min).toBe(0);
    const q = (id: string): number => { const r = resultOf(id); return Math.abs(r?.heatFlowW as number) / (r?.dimensions.netAreaM2 as number); };
    expectClose(view.range?.max as number, Math.max(q('c1'), q('c2'), q('c3'), q('c4'), q('c5')), 1e-12);
    expect(view.colours.c5).toBe(fluxColor(1));
    expect(view.colours.c1).toBe(fluxColor(q('c1') / (view.range?.max as number)));
  });

  it('assumptions and the not-included list are shown in their tabs', async () => {
    await mount();
    loadExample();
    click(q('#btab-assumptions'));
    expect(role('envelope-assumptions').querySelectorAll('li').length).toBeGreaterThan(5);
    click(q('#btab-not-included'));
    expect(q('#bpanel-not-included').hidden).toBe(false);
    expect(role('not-included').textContent).toContain('Entrance door');
  });
});

describe('workspace switch', () => {
  let shell: ShellHandle;
  afterEach(() => shell?.destroy());

  async function mountShellWith(): Promise<ReturnType<typeof makeFakeHouse>> {
    document.body.innerHTML = '';
    root = document.createElement('div');
    document.body.append(root);
    const house = makeFakeHouse();
    shell = mountShell(root, { viewerFactory: makeFake().factory, houseViewerFactory: house.factory, confirm: () => true });
    await shell.wall.ready;
    return house;
  }

  it('starts on the single wall; the building workspace is created on first use and both keep their state', async () => {
    await mountShellWith();
    expect(shell.getMode()).toBe('wall');
    expect(shell.building()).toBeNull();
    expect(q('[data-workspace="building"]').hidden).toBe(true);
    click(q('[data-workspace="wall"] [data-mode="building"]'));
    expect(shell.getMode()).toBe('building');
    expect(q('[data-workspace="wall"]').hidden).toBe(true);
    expect(q('[data-workspace="building"]').hidden).toBe(false);
    const building = shell.building() as BuildingWorkspaceHandle;
    await building.ready;
    click(q('[data-workspace="building"] [data-role="b-example"]'));
    click(q('[data-workspace="building"] [data-mode="wall"]'));
    click(q('[data-workspace="wall"] [data-mode="building"]'));
    expect(shell.building()).toBe(building);
    expect(building.getProject().components).toHaveLength(14);
    for (const b of root.querySelectorAll('[data-mode="building"]')) expect(b.getAttribute('aria-pressed')).toBe('true');
  });

  it('custom materials from the wall calculator are offered in the building editor', async () => {
    await mountShellWith();
    const added = shell.wall.addCustomMaterial({ name: 'Test datasheet block', lambdaWPerMK: 0.25, densityKgPerM3: 1000, specificHeatJPerKgK: 1000, sourceNote: 'Datasheet (test)', valueType: 'declared' });
    expect(added.ok).toBe(true);
    shell.setMode('building');
    const building = shell.building() as BuildingWorkspaceHandle;
    await building.ready;
    click(q('[data-workspace="building"] [data-role="b-add"]'));
    click(q('[data-workspace="building"] [data-role="b-layer-add"]'));
    const options = [...(document.getElementById('b-layer-0-mat') as HTMLSelectElement).options].map((o) => o.textContent ?? '');
    expect(options.some((t) => t.includes('Test datasheet block'))).toBe(true);
  });
});
