/**
 * Thickness as text for labels: "15 mm", "0.5 mm", "1.25 m". Always built from
 * the TRUE thickness in metres, never from a display-scaled size.
 */
export function formatThickness(thicknessM: number): string {
  if (!Number.isFinite(thicknessM)) return '—';
  if (thicknessM >= 1) return `${Number(thicknessM.toFixed(3))} m`;
  return `${Number((thicknessM * 1000).toFixed(2))} mm`;
}
