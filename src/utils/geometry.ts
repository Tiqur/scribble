/**
 * Pure geometry helpers for scribble detection and erase. No SDK calls except
 * reading a stroke's points (which is inherently SDK-backed) and the EMR→screen
 * coordinate conversion. Kept side-effect-free and unit-testable.
 *
 * @format
 */

import { PointUtils } from 'sn-plugin-lib';

export interface Pt {
  x: number;
  y: number;
}

export interface Bbox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Reads all sample points of a stroke via its uuid-keyed accessor (2 bridge calls). */
export async function readStrokePoints(el: any): Promise<Pt[]> {
  const acc = el?.stroke?.points;
  if (!acc || typeof acc.size !== 'function') return [];
  const size: number = await acc.size();
  if (!size || size <= 0) return [];
  const raw: any[] = (await acc.getRange(0, size)) ?? [];
  return raw
    .filter(p => p && typeof p.x === 'number' && typeof p.y === 'number')
    .map(p => ({ x: p.x, y: p.y }));
}

export function bboxOf(pts: Pt[]): Bbox | null {
  if (!pts.length) return null;
  let minX = pts[0].x, maxX = pts[0].x, minY = pts[0].y, maxY = pts[0].y;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export function unionBbox(boxes: (Bbox | null)[]): Bbox | null {
  const valid = boxes.filter((b): b is Bbox => b !== null);
  if (!valid.length) return null;
  return valid.reduce((a, b) => ({
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  }));
}

export function bboxesOverlap(a: Bbox, b: Bbox): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

export function diagonalOf(b: Bbox): number {
  return Math.hypot(b.maxX - b.minX, b.maxY - b.minY);
}

function orient(a: Pt, b: Pt, c: Pt): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function onSegment(a: Pt, b: Pt, c: Pt): boolean {
  return (
    Math.min(a.x, b.x) <= c.x && c.x <= Math.max(a.x, b.x) &&
    Math.min(a.y, b.y) <= c.y && c.y <= Math.max(a.y, b.y)
  );
}

/** Standard segment/segment intersection (proper or collinear-overlap). */
export function segmentsIntersect(p1: Pt, p2: Pt, p3: Pt, p4: Pt): boolean {
  const d1 = orient(p3, p4, p1);
  const d2 = orient(p3, p4, p2);
  const d3 = orient(p1, p2, p3);
  const d4 = orient(p1, p2, p4);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  if (d1 === 0 && onSegment(p3, p4, p1)) return true;
  if (d2 === 0 && onSegment(p3, p4, p2)) return true;
  if (d3 === 0 && onSegment(p1, p2, p3)) return true;
  if (d4 === 0 && onSegment(p1, p2, p4)) return true;
  return false;
}

/** True if any segment of polyline `a` intersects any segment of polyline `b`. */
export function polylinesCross(a: Pt[], b: Pt[]): boolean {
  for (let i = 1; i < a.length; i++) {
    for (let j = 1; j < b.length; j++) {
      if (segmentsIntersect(a[i - 1], a[i], b[j - 1], b[j])) return true;
    }
  }
  return false;
}

/**
 * Douglas–Peucker simplification: keeps only the "turning points" of a
 * polyline (anything farther than `epsilon` from the chord is kept). This
 * collapses long straight runs while preserving every real reversal, so it is
 * ideal for cheap crossing tests. O(n²) worst case, fine for stroke sizes.
 */
export const RDP_EPSILON = 60; // EMR: small enough to preserve real crossings
/**
 * Cached candidate strokes keep MORE detail than the scribble (which is the
 * big, expensive side of the crossing test): at epsilon 60 a small curved
 * stroke (e.g. a cursive 'e', ~150 EMR tall) can collapse to a line and a real
 * crossing would be missed. 20 preserves small strokes while still cutting
 * jitter and memory.
 */
export const RDP_CANDIDATE_EPSILON = 20;

export function simplifyPath(pts: Pt[], epsilon: number): Pt[] {
  if (pts.length < 3) return pts.slice();
  const n = pts.length;
  const keep = new Array<boolean>(n).fill(false);
  keep[0] = keep[n - 1] = true;
  const stack: Array<[number, number]> = [[0, n - 1]];
  while (stack.length > 0) {
    const [s, e] = stack.pop() as [number, number];
    const a = pts[s];
    const b = pts[e];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let maxD = 0;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const p = pts[i];
      let d: number;
      if (len2 === 0) {
        d = Math.hypot(p.x - a.x, p.y - a.y);
      } else {
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
        const px = a.x + t * dx;
        const py = a.y + t * dy;
        d = Math.hypot(p.x - px, p.y - py);
      }
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx > 0 && maxD > epsilon) {
      keep[idx] = true;
      stack.push([s, idx], [idx, e]);
    }
  }
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(pts[i]);
  return out;
}

/** The 4 corners of a bbox, in a fixed order shared by the EMR→screen converters below. */
function cornersOf(b: Bbox): Pt[] {
  return [
    { x: b.minX, y: b.minY },
    { x: b.maxX, y: b.minY },
    { x: b.minX, y: b.maxY },
    { x: b.maxX, y: b.maxY },
  ];
}

/**
 * Converts an EMR-space bounding box to an integer Android/screen-space rect for
 * `lassoElements`. `emrPoint2Android` rescales AND swaps/flips axes, so convert
 * all four corners and rebuild from their min/max; round outward to integers
 * (lassoElements rejects non-integers with error 107).
 */
export function emrBboxToAndroidRect(b: Bbox, pageSize: { width: number; height: number }): Rect {
  const a = cornersOf(b).map(c => PointUtils.emrPoint2Android(c, pageSize) as Pt);
  return rectFromCorners(a);
}

/**
 * EMR→screen using the page's ACTUAL EMR max (from an element's `maxX`/`maxY`),
 * not the pageSize-derived guess that `PointUtils.emrPoint2Android` uses — which
 * is wrong on devices whose EMR range doesn't match the reported pageSize.
 * Replicates the library's axis-swap transform with the correct scale.
 */
export function emrBboxToScreenRect(
  b: Bbox,
  pageSize: { width: number; height: number },
  emrMaxX: number,
  emrMaxY: number,
): Rect {
  const mtX = emrMaxX / (pageSize.height - 1);
  const mtY = emrMaxY / (pageSize.width - 1);
  const conv = (p: Pt): Pt => ({
    x: pageSize.width - 1 - p.y / mtY,
    y: p.x / mtX,
  });
  return rectFromCorners(cornersOf(b).map(conv));
}

/** Expands a rect by `pad` px on every side, clamped to [0, maxX] × [0, maxY]. */
export function padRect(r: Rect, pad: number, maxX: number, maxY: number): Rect {
  return {
    left: Math.max(0, r.left - pad),
    top: Math.max(0, r.top - pad),
    right: Math.min(maxX, r.right + pad),
    bottom: Math.min(maxY, r.bottom + pad),
  };
}

function rectFromCorners(a: Pt[]): Rect {
  const xs = a.map(p => p.x);
  const ys = a.map(p => p.y);
  return {
    left: Math.floor(Math.min(...xs)),
    top: Math.floor(Math.min(...ys)),
    right: Math.ceil(Math.max(...xs)),
    bottom: Math.ceil(Math.max(...ys)),
  };
}
