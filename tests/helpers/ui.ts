/**
 * Helpers for tests that run the page in a simulated browser (happy-dom) with a
 * FAKE 3D viewer that records what it is asked to draw.
 */
import type { FlowDirection, ThermalOverlay, WallLayout } from '../../src/geometry';
import type { NavigationMode, ViewerFactory, ViewerHandlers, ViewPreset, WallViewer } from '../../src/viewer3d';

export interface FakeViewer extends WallViewer {
  layouts: WallLayout[];
  selections: Array<string | null>;
  labels: boolean[];
  views: ViewPreset[];
  overlays: Array<ThermalOverlay | null>;
  flows: Array<FlowDirection | null>;
  grids: boolean[];
  axes: boolean[];
  modes: NavigationMode[];
  zooms: number[];
  destroyed: number;
  handlers: ViewerHandlers;
}

export function makeFake(): { factory: ViewerFactory; viewer: () => FakeViewer; containers: HTMLElement[] } {
  let created: FakeViewer | null = null;
  const containers: HTMLElement[] = [];
  const factory: ViewerFactory = async (container, handlers) => {
    containers.push(container);
    const fake: FakeViewer = {
      layouts: [],
      selections: [],
      labels: [],
      views: [],
      overlays: [],
      flows: [],
      grids: [],
      axes: [],
      modes: [],
      zooms: [],
      destroyed: 0,
      handlers,
      update: (layout) => void fake.layouts.push(layout),
      select: (id) => void fake.selections.push(id),
      setLabelsVisible: (v) => void fake.labels.push(v),
      setView: (p) => void fake.views.push(p),
      setThermalOverlay: (o) => void fake.overlays.push(o),
      setHeatFlow: (d) => void fake.flows.push(d),
      setGridVisible: (v) => void fake.grids.push(v),
      setAxesVisible: (v) => void fake.axes.push(v),
      setNavigationMode: (m) => void fake.modes.push(m),
      zoom: (f) => void fake.zooms.push(f),
      destroy: () => void fake.destroyed++,
    };
    created = fake;
    return fake;
  };
  return { factory, viewer: () => created as FakeViewer, containers };
}

export const domId = (field: string): string => `f-${field.replace(/[^a-zA-Z0-9]+/g, '-')}`;
export const el = <T extends HTMLElement>(field: string): T => document.getElementById(domId(field)) as T;

export function type(field: string, text: string): void {
  const input = el<HTMLInputElement>(field);
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
export function chooseValue(select: HTMLSelectElement, value: string): void {
  select.value = value;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}
export const click = (node: Element | null | undefined): void => void node?.dispatchEvent(new Event('click', { bubbles: true }));
export function setChecked(box: HTMLInputElement, on: boolean): void {
  box.checked = on;
  box.dispatchEvent(new Event('change', { bubbles: true }));
}
