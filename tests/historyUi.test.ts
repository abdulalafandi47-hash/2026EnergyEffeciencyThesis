// @vitest-environment happy-dom
/**
 * Undo and redo: the history itself (typing merged into one step, a limit) and
 * both workspaces (buttons, keyboard shortcut, what is taken back).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { FIELD } from '../src/editor';
import { mountBuildingWorkspace } from '../src/ui/buildingWorkspace';
import type { BuildingWorkspaceHandle } from '../src/ui/buildingWorkspace';
import { mountWallEditor } from '../src/ui/app';
import type { WallEditorHandle } from '../src/ui/app';
import { History, undoShortcut } from '../src/ui/history';
import { memoryStore } from '../src/ui/storage';
import { BUILT_IN_MATERIALS } from '../src/materials';
import { chooseValue, click, el, type } from './helpers/ui';

describe('History', () => {
  it('undo and redo step back and forth; a new change clears redo', () => {
    const h = new History<number>(100, 1000, () => 0);
    h.record(1, false); // 1 → 2
    h.record(2, false); // 2 → 3
    expect(h.undo(3)).toBe(2);
    expect(h.undo(2)).toBe(1);
    expect(h.undo(1)).toBeNull();
    expect(h.redo(1)).toBe(2);
    h.record(2, false); // 2 → 5: redo is gone
    expect(h.canRedo).toBe(false);
  });

  it('typing within the merge time is one step; a pause or a click starts a new one', () => {
    let t = 0;
    const h = new History<string>(100, 1000, () => t);
    h.record('', true); // '' → '1'
    t = 200;
    h.record('1', true); // '1' → '12' (merged)
    expect(h.undo('12')).toBe('');
    h.record('', true);
    t = 5000;
    h.record('1', true); // after a pause: new step
    expect(h.undo('12')).toBe('1');
    h.record('1', false); // a click after typing is its own step
    expect(h.undo('x')).toBe('1');
  });

  it('keeps at most `limit` steps', () => {
    const h = new History<number>(3, 0, () => 0);
    for (let i = 0; i < 10; i++) h.record(i, false);
    expect([h.undo(10), h.undo(9), h.undo(8), h.undo(7)]).toEqual([9, 8, 7, null]);
  });

  it('recognises the shortcuts', () => {
    const k = (key: string, mods: Partial<KeyboardEventInit> = {}): KeyboardEvent => new KeyboardEvent('keydown', { key, ...mods });
    expect(undoShortcut(k('z', { ctrlKey: true }))).toBe('undo');
    expect(undoShortcut(k('Z', { ctrlKey: true, shiftKey: true }))).toBe('redo');
    expect(undoShortcut(k('z', { metaKey: true }))).toBe('undo');
    expect(undoShortcut(k('y', { ctrlKey: true }))).toBe('redo');
    expect(undoShortcut(k('z'))).toBeNull();
  });
});

let root: HTMLElement;
let ws: BuildingWorkspaceHandle | null = null;
let wall: WallEditorHandle | null = null;
function freshRoot(): void {
  document.body.innerHTML = '';
  root = document.createElement('div');
  document.body.append(root);
}
afterEach(() => {
  ws?.destroy();
  wall?.destroy();
  ws = null;
  wall = null;
});
const role = (r: string): HTMLElement => root.querySelector(`[data-role="${r}"]`) as HTMLElement;
const typeIn = (focusId: string, text: string): void => {
  const box = document.getElementById(`b-${focusId}`) as HTMLInputElement;
  box.value = text;
  box.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('undo in the building workspace', () => {
  function mountWs(): BuildingWorkspaceHandle {
    freshRoot();
    ws = mountBuildingWorkspace(root, { store: memoryStore(), confirm: () => true });
    return ws;
  }

  it('adding, deleting (with its windows) and loading the example can all be undone and redone', () => {
    const w = mountWs();
    expect((role('b-undo') as HTMLButtonElement).disabled).toBe(true);
    click(role('b-example'));
    w.select('c3');
    click(role('b-delete')); // south wall and its 3 openings
    expect(w.getProject().components).toHaveLength(10);
    click(role('b-undo'));
    expect(w.getProject().components).toHaveLength(14);
    expect(w.getProject().components.map((c) => c.id)).toContain('c9');
    click(role('b-redo'));
    expect(w.getProject().components).toHaveLength(10);
    click(role('b-undo'));
    click(role('b-undo')); // before loading the example
    expect(w.getProject().components).toHaveLength(0);
    expect((role('b-undo') as HTMLButtonElement).disabled).toBe(true);
  });

  it('typing a number is one step, and the fields show the restored value', () => {
    const w = mountWs();
    click(role('b-example'));
    typeIn('g-length', '1');
    typeIn('g-length', '12');
    expect(w.getProject().geometry.lengthM).toBe(12);
    w.undo();
    expect(w.getProject().geometry.lengthM).toBe(10);
    expect((document.getElementById('b-g-length') as HTMLInputElement).value).toBe('10');
  });

  it('Ctrl+Z outside a text field undoes; inside a text field it is left to the field', () => {
    const w = mountWs();
    click(role('b-example'));
    chooseValue(document.getElementById('b-add-type') as HTMLSelectElement, 'window');
    click(role('b-add')); // a window, selected
    const count = w.getProject().components.length;
    expect(count).toBe(15);
    const button = role('b-add');
    button.focus();
    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    expect(w.getProject().components.length).toBe(count - 1);
    const field = document.getElementById('b-g-depth') as HTMLInputElement;
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    expect(w.getProject().components.length).toBe(count - 1); // unchanged
  });
});

describe('undo in the wall calculator', () => {
  it('typing, adding and removing layers can be undone', async () => {
    freshRoot();
    wall = mountWallEditor(root, BUILT_IN_MATERIALS, { store: memoryStore() });
    const before = wall.getDraft();
    type(FIELD.width, '4');
    type(FIELD.width, '4.5');
    expect(wall.getDraft().widthText).toBe('4.5');
    click(role('undo'));
    expect(wall.getDraft().widthText).toBe(before.widthText);
    expect(el<HTMLInputElement>(FIELD.width).value).toBe(before.widthText);
    const layers = wall.getDraft().layers.length;
    click(root.querySelector('[data-role="add-layer"]') ?? [...root.querySelectorAll('button')].find((b) => /add layer/i.test(b.textContent ?? '')) ?? null);
    expect(wall.getDraft().layers.length).toBe(layers + 1);
    expect(wall.undo()).toBe(true);
    expect(wall.getDraft().layers.length).toBe(layers);
    expect(wall.redo()).toBe(true);
    expect(wall.getDraft().layers.length).toBe(layers + 1);
    // A unit change converts the typed number and is one step too.
    const unit = root.querySelector('select[aria-label="Unit of width and height"]') as HTMLSelectElement;
    chooseValue(unit, 'cm');
    expect(wall.getDraft().dimensionUnit).toBe('cm');
    wall.undo();
    expect(wall.getDraft().dimensionUnit).toBe('m');
  });
});
