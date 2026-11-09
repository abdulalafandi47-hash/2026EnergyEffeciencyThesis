/**
 * The application SHELL: a switch between the single-wall calculator and the
 * building-envelope workspace. Both stay mounted once opened, so switching
 * never loses what was typed. Custom materials defined in the wall calculator
 * are also offered in the building workspace.
 */
import { BUILT_IN_MATERIALS } from '../materials';
import type { HouseViewerFactory, ViewerFactory } from '../viewer3d';
import { mountWallEditor } from './app';
import type { WallEditorHandle } from './app';
import { mountBuildingWorkspace } from './buildingWorkspace';
import type { BuildingWorkspaceHandle } from './buildingWorkspace';
import { h } from './dom';
import { browserStore, readKey, STORAGE_KEYS, writeKey } from './storage';
import type { KeyValueStore } from './storage';
import { createWelcome } from './welcome';

export type WorkspaceMode = 'wall' | 'building';

export interface ShellOptions {
  viewerFactory?: ViewerFactory;
  houseViewerFactory?: HouseViewerFactory;
  initialMode?: WorkspaceMode;
  /** Called after every switch (the browser keeps the mode in the address, e.g. #building). */
  onModeChange?: (mode: WorkspaceMode) => void;
  confirm?: (message: string) => boolean;
  /** Browser storage for the last wall, the last building and the project library; the browser's by default, null for none. */
  store?: KeyValueStore | null;
  /** Show the welcome dialog now; by default only on the first visit (remembered in browser storage). */
  showWelcome?: boolean;
}

export interface ShellHandle {
  getMode(): WorkspaceMode;
  setMode(mode: WorkspaceMode): void;
  wall: WallEditorHandle;
  /** The building workspace; created the first time it is opened. */
  building(): BuildingWorkspaceHandle | null;
  /** Opens the welcome dialog (the "Help" button does the same). */
  openWelcome(): void;
  destroy(): void;
}

const MODES: Array<[WorkspaceMode, string]> = [
  ['wall', 'Single wall'],
  ['building', 'Building envelope'],
];

export function mountShell(root: HTMLElement, options: ShellOptions = {}): ShellHandle {
  let mode: WorkspaceMode = options.initialMode ?? 'wall';
  const switches: HTMLButtonElement[][] = [];

  /** One switch per top bar; all of them show the same state. */
  function modeSwitch(): HTMLElement {
    const buttons = MODES.map(([id, label]) => {
      const b = h('button', { type: 'button', class: 'tool', 'data-mode': id, 'aria-pressed': String(id === mode) }, label);
      b.addEventListener('click', () => setMode(id));
      return b;
    });
    switches.push(buttons);
    const help = h('button', { type: 'button', class: 'tool', 'data-role': 'open-welcome', title: 'What this program does, how to start, and its limits' }, 'Help');
    help.addEventListener('click', () => welcome.open());
    return h('span', { class: 'topbar-extra' }, h('div', { class: 'mode-switch', role: 'group', 'aria-label': 'Workspace' }, ...buttons), help);
  }

  const store = options.store === undefined ? browserStore() : options.store;
  const welcome = createWelcome({
    onExample: () => {
      setMode('building');
      building?.loadExample();
    },
    onBlank: () => {
      setMode('building');
      building?.newBlank();
    },
    onWall: () => setMode('wall'),
    onClose: () => void writeKey(store, STORAGE_KEYS.welcomeSeen, '1'),
  });
  const wallRoot = h('div', { 'data-workspace': 'wall' });
  const buildingRoot = h('div', { 'data-workspace': 'building', hidden: true });
  root.replaceChildren(wallRoot, buildingRoot, welcome.element);

  let restoring = true;
  const wall: WallEditorHandle = mountWallEditor(wallRoot, BUILT_IN_MATERIALS, {
    ...(options.viewerFactory ? { viewerFactory: options.viewerFactory } : {}),
    topbarExtra: modeSwitch(),
    store,
    // Keep the last wall in this browser (not while the saved one is being read back).
    onChange: () => {
      if (!restoring) writeKey(store, STORAGE_KEYS.lastWall, wall.serialize());
    },
  });
  const lastWall = readKey(store, STORAGE_KEYS.lastWall);
  if (lastWall) wall.openWallText(lastWall, 'your last wall (restored from this browser)');
  restoring = false;
  let building: BuildingWorkspaceHandle | null = null;

  function setMode(next: WorkspaceMode): void {
    mode = next;
    if (next === 'building' && !building) {
      building = mountBuildingWorkspace(buildingRoot, {
        ...(options.houseViewerFactory ? { houseViewerFactory: options.houseViewerFactory } : {}),
        ...(options.confirm ? { confirm: options.confirm } : {}),
        getMaterials: () => [...BUILT_IN_MATERIALS, ...wall.getCustomMaterials()],
        onImportMaterials: (records) => wall.importCustomMaterials(records),
        store,
        topbarExtra: modeSwitch(),
      });
    }
    wallRoot.hidden = next !== 'wall';
    buildingRoot.hidden = next !== 'building';
    for (const buttons of switches) for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.mode === next));
    options.onModeChange?.(next);
  }

  setMode(mode);
  if (options.showWelcome ?? readKey(store, STORAGE_KEYS.welcomeSeen) !== '1') welcome.open();

  return {
    getMode: () => mode,
    setMode,
    wall,
    building: () => building,
    openWelcome: () => welcome.open(),
    destroy(): void {
      wall.destroy();
      building?.destroy();
    },
  };
}
