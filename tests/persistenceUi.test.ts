// @vitest-environment happy-dom
/**
 * Keeping work: building project files (download / open), the library of projects
 * saved in this browser, and the last wall and building restored on the next visit.
 * Browser storage is replaced by an in-memory store; storage that is missing or
 * full must never break the program.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createExampleHouse, parseProject, serializeProject } from '../src/envelope';
import type { BuildingProject } from '../src/envelope';
import { FIELD } from '../src/editor';
import { BUILT_IN_MATERIALS } from '../src/materials';
import { mountBuildingWorkspace } from '../src/ui/buildingWorkspace';
import type { BuildingWorkspaceHandle } from '../src/ui/buildingWorkspace';
import type { FileIo } from '../src/ui/io';
import { mountShell } from '../src/ui/shell';
import type { ShellHandle } from '../src/ui/shell';
import { memoryStore, ProjectLibrary, STORAGE_KEYS } from '../src/ui/storage';
import type { KeyValueStore } from '../src/ui/storage';
import { click, type } from './helpers/ui';

let root: HTMLElement;
let ws: BuildingWorkspaceHandle | null = null;
let shell: ShellHandle | null = null;
let confirms: string[] = [];
let answer = true;
const downloads: Array<{ name: string; text: string }> = [];
let clock = new Date('2026-11-09T10:00:00Z');
const io: FileIo = { download: (name, _mime, text) => void downloads.push({ name, text }), print: () => undefined, now: () => clock };

function freshRoot(): void {
  document.body.innerHTML = '';
  root = document.createElement('div');
  document.body.append(root);
  confirms = [];
  answer = true;
  downloads.length = 0;
}
function mountWs(store: KeyValueStore | null): BuildingWorkspaceHandle {
  freshRoot();
  ws = mountBuildingWorkspace(root, { confirm: (m) => (confirms.push(m), answer), store, io });
  return ws;
}
afterEach(() => {
  ws?.destroy();
  shell?.destroy();
  ws = null;
  shell = null;
});

const role = <T extends Element = HTMLElement>(r: string): T => root.querySelector(`[data-role="${r}"]`) as T;
const typeIn = (focusId: string, text: string): void => {
  const box = document.getElementById(`b-${focusId}`) as HTMLInputElement;
  box.value = text;
  box.dispatchEvent(new Event('input', { bubbles: true }));
};
const libraryNames = (): string[] => [...root.querySelectorAll('[data-role="b-library"] .b-library-name')].map((n) => n.firstChild?.textContent ?? '');

describe('project library in this browser', () => {
  it('Save keeps the project; changes show as unsaved; Save again updates the same entry', () => {
    const store = memoryStore();
    const w = mountWs(store);
    click(role('b-example'));
    typeIn('project-name', 'House A');
    expect(role('b-save-status').textContent).toMatch(/Not saved in this browser yet/);
    click(role('b-save'));
    expect(libraryNames()).toEqual(['House A']);
    expect(role('b-save-status').textContent).toMatch(/Last saved in this browser/);
    expect(role('b-save-status').textContent).not.toMatch(/Unsaved/);
    typeIn('g-length', '12');
    expect(role('b-save-status').textContent).toMatch(/Unsaved changes/);
    click(role('b-save'));
    expect(libraryNames()).toEqual(['House A']);
    expect(w.library.list()).toHaveLength(1);
    // What is stored reopens as the same project.
    const stored = parseProject(w.library.load(w.library.list()[0]!.id) as string, BUILT_IN_MATERIALS);
    expect(stored.ok && stored.project).toEqual(w.getProject());
  });

  it('several independent projects; opening one asks before replacing unsaved work', () => {
    const w = mountWs(memoryStore());
    click(role('b-example'));
    typeIn('project-name', 'House A');
    click(role('b-save'));
    clock = new Date(clock.getTime() + 60_000);
    click(role('b-new'));
    expect(confirms).toHaveLength(0); // A was saved: nothing to lose
    typeIn('project-name', 'House B');
    click(role('b-add'));
    click(role('b-save'));
    expect(libraryNames().sort()).toEqual(['House A', 'House B']);
    typeIn('g-depth', '9'); // unsaved change in B
    const rowA = [...root.querySelectorAll<HTMLElement>('.b-library-row')].find((r) => r.textContent?.includes('House A')) as HTMLElement;
    answer = false;
    click(rowA.querySelector('button'));
    expect(confirms.at(-1)).toMatch(/unsaved changes/);
    expect(w.getProject().name).toBe('House B'); // kept
    answer = true;
    click(rowA.querySelector('button'));
    expect(w.getProject().name).toBe('House A');
    expect(w.getProject().components).toHaveLength(14);
  });

  it('Save as copy makes a second entry; Delete asks and removes only that entry', () => {
    const w = mountWs(memoryStore());
    click(role('b-example'));
    click(role('b-save'));
    click(role('b-save-copy'));
    expect(w.library.list()).toHaveLength(2);
    answer = false;
    click(root.querySelector('.b-library-row .danger'));
    expect(confirms.at(-1)).toMatch(/cannot be undone/);
    expect(w.library.list()).toHaveLength(2);
    answer = true;
    click(root.querySelector('.b-library-row .danger'));
    expect(w.library.list()).toHaveLength(1);
  });
});

describe('project files', () => {
  it('Download gives a file that opens as the same project', () => {
    const w = mountWs(memoryStore());
    click(role('b-example'));
    typeIn('project-name', 'Thesis house 1');
    click(role('b-download'));
    expect(downloads.at(-1)?.name).toBe('thesis-house-1.building.json');
    const before = w.getProject();
    click(role('b-new'));
    const out = w.openProjectText(downloads.at(-1)?.text as string, 'thesis-house-1.building.json');
    expect(out.ok).toBe(true);
    expect(w.getProject()).toEqual(before);
    expect(role('b-save-status').textContent).toMatch(/Opened from thesis-house-1/);
  });

  it('a damaged file is refused in plain words and the current project stays', () => {
    const w = mountWs(memoryStore());
    click(role('b-example'));
    const before = w.getProject();
    const out = w.openProjectText('{"schema":"building-thermal-simulator.building","schemaVersion":1,"project":{}}', 'bad.json');
    expect(out.ok).toBe(false);
    expect(role('b-file-message').textContent).toMatch(/Could not open bad.json.*not changed/);
    expect(w.getProject()).toBe(before);
  });
});

describe('the last work is restored on the next visit', () => {
  it('the building comes back after a reload; a damaged stored copy is ignored', () => {
    const store = memoryStore();
    const w = mountWs(store);
    click(role('b-example'));
    typeIn('g-height', '3.1');
    const before = w.getProject();
    w.destroy();
    const again = mountWs(store);
    expect(again.getProject()).toEqual(before);
    expect(role('b-file-message').textContent).toMatch(/Restored/);
    again.destroy();
    store.setItem(STORAGE_KEYS.lastBuilding, '{"broken":');
    const third = mountWs(store);
    expect(third.getProject().components).toHaveLength(0); // blank, no crash
  });

  it('the wall comes back too, and custom materials from an opened project reach the wall calculator', async () => {
    const store = memoryStore();
    freshRoot();
    shell = mountShell(root, { confirm: () => true, store });
    type(FIELD.width, '4.2');
    shell.destroy();
    freshRoot();
    shell = mountShell(root, { confirm: () => true, store });
    expect(shell.wall.getDraft().widthText).toBe('4.2');

    // A project file carrying a custom material.
    const added = shell.wall.addCustomMaterial({ name: 'Datasheet block (test)', lambdaWPerMK: 0.2, densityKgPerM3: 900, specificHeatJPerKgK: 1000, sourceNote: 'Datasheet (test)', valueType: 'declared' });
    if (!added.ok) throw new Error('custom material');
    const p: BuildingProject = createExampleHouse(BUILT_IN_MATERIALS);
    const wall = p.components[0];
    if (!wall || !('construction' in wall)) throw new Error('wall');
    wall.construction.layers.push({ materialId: added.material.id, thicknessM: 0.1 });
    const text = serializeProject(p, [...BUILT_IN_MATERIALS, added.material]);
    shell.destroy();
    freshRoot();
    shell = mountShell(root, { confirm: () => true, store: memoryStore() }); // a different browser: no customs
    expect(shell.wall.getCustomMaterials()).toHaveLength(0);
    shell.setMode('building');
    const out = shell.building()?.openProjectText(text, 'shared.building.json');
    expect(out?.ok).toBe(true);
    expect(shell.wall.getCustomMaterials().map((m) => m.name)).toEqual(['Datasheet block (test)']);
    expect(shell.building()?.getResult().components.find((r) => r.componentId === wall.id)?.status).toBe('calculated');
  });
});

describe('storage that is missing or full', () => {
  it('no storage: the program works, Save explains, Download still works', () => {
    const w = mountWs(null);
    click(role('b-example'));
    expect(role('b-save-status').textContent).toMatch(/not available/);
    expect(w.saveToLibrary()).toBe(false);
    expect(role('b-file-message').textContent).toMatch(/Download project file/);
    click(role('b-download'));
    expect(downloads).toHaveLength(1);
  });

  it('a store that throws (full or blocked) is handled without errors', () => {
    const throwing: KeyValueStore = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('QuotaExceededError'); }, removeItem: () => { throw new Error('blocked'); } };
    const w = mountWs(throwing);
    click(role('b-example'));
    expect(w.saveToLibrary()).toBe(false);
    expect(role('b-file-message').textContent).toMatch(/refused/);
    expect(w.getProject().components).toHaveLength(14);
  });

  it('a damaged library index reads as empty', () => {
    const store = memoryStore({ [STORAGE_KEYS.libraryIndex]: '{"not":"a list"}' });
    expect(new ProjectLibrary(store).list()).toEqual([]);
    store.setItem(STORAGE_KEYS.libraryIndex, JSON.stringify([{ id: 'p1', name: 'ok', savedAt: '2026-01-01T00:00:00Z' }, { id: 5 }, null]));
    expect(new ProjectLibrary(store).list().map((e) => e.id)).toEqual(['p1']);
  });
});
