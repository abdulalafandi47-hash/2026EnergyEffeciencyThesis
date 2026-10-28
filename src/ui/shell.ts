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

export type WorkspaceMode = 'wall' | 'building';

export interface ShellOptions {
  viewerFactory?: ViewerFactory;
  houseViewerFactory?: HouseViewerFactory;
  initialMode?: WorkspaceMode;
  /** Called after every switch (the browser keeps the mode in the address, e.g. #building). */
  onModeChange?: (mode: WorkspaceMode) => void;
  confirm?: (message: string) => boolean;
}

export interface ShellHandle {
  getMode(): WorkspaceMode;
  setMode(mode: WorkspaceMode): void;
  wall: WallEditorHandle;
  /** The building workspace; created the first time it is opened. */
  building(): BuildingWorkspaceHandle | null;
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
    return h('div', { class: 'mode-switch', role: 'group', 'aria-label': 'Workspace' }, ...buttons);
  }

  const wallRoot = h('div', { 'data-workspace': 'wall' });
  const buildingRoot = h('div', { 'data-workspace': 'building', hidden: true });
  root.replaceChildren(wallRoot, buildingRoot);

  const wall = mountWallEditor(wallRoot, BUILT_IN_MATERIALS, { ...(options.viewerFactory ? { viewerFactory: options.viewerFactory } : {}), topbarExtra: modeSwitch() });
  let building: BuildingWorkspaceHandle | null = null;

  function setMode(next: WorkspaceMode): void {
    mode = next;
    if (next === 'building' && !building) {
      building = mountBuildingWorkspace(buildingRoot, {
        ...(options.houseViewerFactory ? { houseViewerFactory: options.houseViewerFactory } : {}),
        ...(options.confirm ? { confirm: options.confirm } : {}),
        getMaterials: () => [...BUILT_IN_MATERIALS, ...wall.getCustomMaterials()],
        topbarExtra: modeSwitch(),
      });
    }
    wallRoot.hidden = next !== 'wall';
    buildingRoot.hidden = next !== 'building';
    for (const buttons of switches) for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.mode === next));
    options.onModeChange?.(next);
  }

  setMode(mode);

  return {
    getMode: () => mode,
    setMode,
    wall,
    building: () => building,
    destroy(): void {
      wall.destroy();
      building?.destroy();
    },
  };
}
