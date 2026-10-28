/**
 * Keeps on-screen labels from sitting on top of each other.
 *
 * Thin layers are close together on screen, so their labels would overlap.
 * `spreadLabels` takes each label's preferred screen position and moves labels
 * just far enough that no two overlap. It is plain arithmetic (pixels in,
 * pixels out) so it can be tested without a browser.
 */
export interface LabelAnchor {
  id: string;
  /** Preferred centre x in pixels. */
  x: number;
  /** Preferred top y in pixels. */
  y: number;
  width: number;
  height: number;
}

export interface PlacedLabel {
  id: string;
  x: number;
  y: number;
}

export interface SpreadOptions {
  /** Minimum space between labels, pixels. Default 2. */
  gap?: number;
  /** Which way colliding labels move: 'down' (default) or 'up' (stack upwards, away from content below). */
  direction?: 'down' | 'up';
  /** If given, the whole group is shifted down just enough that no label sits above this y. */
  minY?: number;
}

type Box = PlacedLabel & { width: number; height: number };

const collide = (a: Box, b: Box, gap: number): boolean =>
  Math.abs(a.x - b.x) < (a.width + b.width) / 2 + gap && a.y < b.y + b.height + gap && b.y < a.y + a.height + gap;

export function spreadLabels(anchors: readonly LabelAnchor[], options: SpreadOptions = {}): PlacedLabel[] {
  const gap = options.gap ?? 2;
  const up = options.direction === 'up';
  // Process left to right, then top to bottom, so the result is stable while the camera moves.
  const order = [...anchors].sort((a, b) => a.x - b.x || a.y - b.y || a.id.localeCompare(b.id));
  const placed: Box[] = [];
  for (const anchor of order) {
    const candidate: Box = { id: anchor.id, x: anchor.x, y: anchor.y, width: anchor.width, height: anchor.height };
    // Each pass moves past the most extreme label it collides with; bounded so it always ends.
    for (let pass = 0; pass <= order.length; pass++) {
      const hits = placed.filter((p) => collide(candidate, p, gap));
      if (hits.length === 0) break;
      candidate.y = up
        ? Math.min(...hits.map((p) => p.y)) - candidate.height - gap
        : Math.max(...hits.map((p) => p.y + p.height)) + gap;
    }
    placed.push(candidate);
  }
  if (options.minY !== undefined && placed.length > 0) {
    const shift = options.minY - Math.min(...placed.map((p) => p.y));
    if (shift > 0) for (const p of placed) p.y += shift;
  }
  // Return in the caller's original order.
  return anchors.map((a) => {
    const p = placed.find((q) => q.id === a.id) as Box;
    return { id: p.id, x: p.x, y: p.y };
  });
}
