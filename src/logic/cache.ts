/**
 * Incremental per-page stroke cache (pure storage — no SDK imports).
 *
 * Every stroke that lands on the page already passes through the PEN_UP
 * handler with its full point data (we read it to classify). This module
 * remembers each stroke's bounding box + RDP-simplified points, so a later
 * scribble's crossing test runs entirely in JS against cached geometry —
 * no `getElements` and no per-element bridge reads on the hot path.
 *
 * Seeding (the one SDK read) lives in ./seed.
 *
 * @format
 */

import {
  Bbox,
  bboxOf,
  bboxesOverlap,
  Pt,
  RDP_CANDIDATE_EPSILON,
  simplifyPath,
} from '../utils/geometry';

export interface CachedStroke {
  num: number; // numInPage at cache time (identity for self-exclusion only)
  bbox: Bbox; // EMR
  pts: Pt[]; // RDP-simplified EMR points, for the crossing test
}

const _pages = new Map<string, CachedStroke[]>();
/** hostTotalElements - cachedStrokes, captured at seed time (≈ non-strokes). */
const _offset = new Map<string, number>();

const key = (file: string, page: number): string => `${file}|${page}`;

export function cacheHas(file: string, page: number): boolean {
  return _pages.has(key(file, page));
}

export function cacheSize(file: string, page: number): number {
  return _pages.get(key(file, page))?.length ?? 0;
}

/** Add (or replace by num) a stroke's cached geometry. */
export function cacheAdd(file: string, page: number, num: number, pts: Pt[]): void {
  const b = bboxOf(pts);
  if (!b) return;
  const k = key(file, page);
  const arr = _pages.get(k) ?? [];
  const entry: CachedStroke = {
    num,
    bbox: b,
    pts: simplifyPath(pts, RDP_CANDIDATE_EPSILON),
  };
  const i = arr.findIndex(c => c.num === num);
  if (i >= 0) arr[i] = entry;
  else arr.push(entry);
  _pages.set(k, arr);
}

/** Strokes whose bbox overlaps `box`, excluding `excludeNum` (the gesture). */
export function cacheQuery(file: string, page: number, box: Bbox, excludeNum?: number): CachedStroke[] {
  const arr = _pages.get(key(file, page)) ?? [];
  return arr.filter(
    c => (excludeNum === undefined || c.num !== excludeNum) && bboxesOverlap(c.bbox, box),
  );
}

/** Drop exactly the given stroke nums (from a completed deletion). */
export function cacheRemoveNums(file: string, page: number, nums: number[]): number {
  const k = key(file, page);
  const arr = _pages.get(k) ?? [];
  if (nums.length === 0) return 0;
  const numSet = new Set(nums);
  const kept = arr.filter(c => !numSet.has(c.num));
  const removed = arr.length - kept.length;
  if (kept.length > 0) _pages.set(k, kept);
  else _pages.delete(k);
  return removed;
}

export function cacheClear(file: string, page: number): void {
  _pages.delete(key(file, page));
  _offset.delete(key(file, page));
}

export function cacheReset(): void {
  _pages.clear();
  _offset.clear();
}

export function cacheOffset(file: string, page: number): number | null {
  const v = _offset.get(key(file, page));
  return typeof v === 'number' ? v : null;
}

export function cacheSetOffset(file: string, page: number, offset: number): void {
  _offset.set(key(file, page), offset);
}
