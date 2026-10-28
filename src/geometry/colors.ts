/**
 * Colours that identify the material CATEGORY of a layer in the 3D view and
 * the layer list. They are only labels: a colour never means a temperature or
 * any thermal result. (Temperature colouring, if added later, will be a
 * separate, explicitly labelled mode.)
 */
export const CATEGORY_COLORS: Readonly<Record<string, string>> = {
  Concrete: '#9aa0a6',
  'Cement plaster': '#cdb79e',
  'Gypsum plaster': '#f2ebe3',
  'Clay brick': '#b5533c',
  'Concrete block': '#7f8c9a',
  EPS: '#8ecae6',
  XPS: '#3fa796',
  'Mineral wool': '#f4c542',
  Polyurethane: '#f28f3b',
  Other: '#9b7fc4',
};

export const FALLBACK_COLOR = '#b0b0b0';

export function colorForCategory(category: string): string {
  return Object.hasOwn(CATEGORY_COLORS, category) ? (CATEGORY_COLORS[category] as string) : FALLBACK_COLOR;
}
