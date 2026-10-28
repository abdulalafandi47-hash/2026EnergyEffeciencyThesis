/**
 * Editing operations on a wall draft.
 *
 * Every function takes a draft and returns a NEW draft; the old one is never
 * modified (so the interface can compare, undo, or re-render safely). A key
 * that does not exist (e.g. a stale click on a removed layer) leaves the draft
 * unchanged instead of throwing.
 *
 * Changing a UNIT converts the typed number so the physical value stays the
 * same (80 mm → 8 cm). It never silently reinterprets "80" as 80 cm.
 * If the typed text is not a valid number, only the unit changes.
 */
import { celsiusToTemperature, lengthToMetres, metresToLength, temperatureToCelsius } from '../units';
import type { MaterialRecord } from '../materials';
import { formatNumber, parseNumberInput } from './parseNumber';
import type { LayerDraft, LengthUnit, SurfaceMode, TemperatureUnit, WallDraft } from './types';

/** Starter wall shown when the editor first opens: 3.0 m × 2.5 m, four layers (example values). */
export function createInitialDraft(materials: readonly MaterialRecord[]): WallDraft {
  const has = (id: string): string | null => (materials.some((m) => m.id === id) ? id : null);
  const starter: Array<[string, string]> = [
    ['gypsum-plaster', '15'],
    ['clay-brick-solid', '200'],
    ['eps-slab', '80'],
    ['cement-plaster', '20'],
  ];
  return {
    widthText: '3',
    heightText: '2.5',
    dimensionUnit: 'm',
    layers: starter.map(([id, thickness], index) => ({
      key: `layer-${index + 1}`,
      materialId: has(id),
      thicknessText: thickness,
      thicknessUnit: 'mm' as const,
    })),
    insideTemperatureText: '20',
    outsideTemperatureText: '5',
    temperatureUnit: 'C',
    durationText: '24',
    surfaceMode: 'preset-horizontal',
    surfaceInsideText: '0.13',
    surfaceOutsideText: '0.04',
    nextLayerNumber: starter.length + 1,
  };
}

/** A draft with no layers and empty fields (every field then reports a clear error). */
export function createEmptyDraft(): WallDraft {
  return {
    widthText: '',
    heightText: '',
    dimensionUnit: 'm',
    layers: [],
    insideTemperatureText: '',
    outsideTemperatureText: '',
    temperatureUnit: 'C',
    durationText: '',
    surfaceMode: 'preset-horizontal',
    surfaceInsideText: '',
    surfaceOutsideText: '',
    nextLayerNumber: 1,
  };
}

// ---- helpers ----------------------------------------------------------------

function convertText(text: string, convert: (value: number) => number): string {
  const parsed = parseNumberInput(text);
  return parsed.ok ? formatNumber(convert(parsed.value)) : text;
}

function updateLayer(draft: WallDraft, key: string, change: (layer: LayerDraft) => LayerDraft): WallDraft {
  if (!draft.layers.some((layer) => layer.key === key)) return draft;
  return { ...draft, layers: draft.layers.map((layer) => (layer.key === key ? change(layer) : layer)) };
}

// ---- layers -----------------------------------------------------------------

/**
 * Adds a layer. By default it goes at the EXTERIOR end; pass `atIndex`
 * (0 = interior face) to insert elsewhere. The new layer has no material and
 * no thickness yet, so it is reported as incomplete until the user fills it in.
 */
export function addLayer(draft: WallDraft, atIndex: number = draft.layers.length): WallDraft {
  const index = Math.max(0, Math.min(draft.layers.length, Math.trunc(atIndex)));
  const layer: LayerDraft = {
    key: `layer-${draft.nextLayerNumber}`,
    materialId: null,
    thicknessText: '',
    thicknessUnit: 'mm',
  };
  const layers = [...draft.layers.slice(0, index), layer, ...draft.layers.slice(index)];
  return { ...draft, layers, nextLayerNumber: draft.nextLayerNumber + 1 };
}

export function removeLayer(draft: WallDraft, key: string): WallDraft {
  if (!draft.layers.some((layer) => layer.key === key)) return draft;
  return { ...draft, layers: draft.layers.filter((layer) => layer.key !== key) };
}

/**
 * Moves a layer one place towards the interior or the exterior.
 * Moving past either end does nothing.
 */
export function moveLayer(draft: WallDraft, key: string, direction: 'toward-interior' | 'toward-exterior'): WallDraft {
  const from = draft.layers.findIndex((layer) => layer.key === key);
  const to = direction === 'toward-interior' ? from - 1 : from + 1;
  if (from < 0 || to < 0 || to >= draft.layers.length) return draft;
  return moveLayerTo(draft, key, to);
}

/** Moves a layer to a given position (0 = interior face). Out-of-range positions are clamped. */
export function moveLayerTo(draft: WallDraft, key: string, toIndex: number): WallDraft {
  const from = draft.layers.findIndex((layer) => layer.key === key);
  if (from < 0) return draft;
  const to = Math.max(0, Math.min(draft.layers.length - 1, Math.trunc(toIndex)));
  if (to === from) return draft;
  const layers = [...draft.layers];
  const [moved] = layers.splice(from, 1);
  if (!moved) return draft;
  layers.splice(to, 0, moved);
  return { ...draft, layers };
}

export function setLayerMaterial(draft: WallDraft, key: string, materialId: string | null): WallDraft {
  return updateLayer(draft, key, (layer) => ({ ...layer, materialId: materialId === '' ? null : materialId }));
}

export function setLayerThickness(draft: WallDraft, key: string, text: string): WallDraft {
  return updateLayer(draft, key, (layer) => ({ ...layer, thicknessText: text }));
}

/** Changes the thickness unit of one layer, converting the typed number so the thickness stays the same. */
export function setLayerThicknessUnit(draft: WallDraft, key: string, unit: LengthUnit): WallDraft {
  return updateLayer(draft, key, (layer) => ({
    ...layer,
    thicknessUnit: unit,
    thicknessText: convertText(layer.thicknessText, (value) =>
      metresToLength(lengthToMetres(value, layer.thicknessUnit), unit),
    ),
  }));
}

// ---- dimensions ---------------------------------------------------------------

export function setWidth(draft: WallDraft, text: string): WallDraft {
  return { ...draft, widthText: text };
}

export function setHeight(draft: WallDraft, text: string): WallDraft {
  return { ...draft, heightText: text };
}

/** Changes the unit of width and height, converting both typed numbers. */
export function setDimensionUnit(draft: WallDraft, unit: LengthUnit): WallDraft {
  const convert = (value: number) => metresToLength(lengthToMetres(value, draft.dimensionUnit), unit);
  return {
    ...draft,
    dimensionUnit: unit,
    widthText: convertText(draft.widthText, convert),
    heightText: convertText(draft.heightText, convert),
  };
}

// ---- boundary conditions ------------------------------------------------------

export function setInsideTemperature(draft: WallDraft, text: string): WallDraft {
  return { ...draft, insideTemperatureText: text };
}

export function setOutsideTemperature(draft: WallDraft, text: string): WallDraft {
  return { ...draft, outsideTemperatureText: text };
}

/** Changes the temperature unit, converting both typed ABSOLUTE temperatures (e.g. 20 °C → 293.15 K). */
export function setTemperatureUnit(draft: WallDraft, unit: TemperatureUnit): WallDraft {
  const convert = (value: number) => celsiusToTemperature(temperatureToCelsius(value, draft.temperatureUnit), unit);
  return {
    ...draft,
    temperatureUnit: unit,
    insideTemperatureText: convertText(draft.insideTemperatureText, convert),
    outsideTemperatureText: convertText(draft.outsideTemperatureText, convert),
  };
}

export function setDuration(draft: WallDraft, text: string): WallDraft {
  return { ...draft, durationText: text };
}

export function setSurfaceMode(draft: WallDraft, mode: SurfaceMode): WallDraft {
  return { ...draft, surfaceMode: mode };
}

export function setSurfaceInside(draft: WallDraft, text: string): WallDraft {
  return { ...draft, surfaceInsideText: text };
}

export function setSurfaceOutside(draft: WallDraft, text: string): WallDraft {
  return { ...draft, surfaceOutsideText: text };
}
