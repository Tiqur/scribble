/**
 * The erase operation: the stroke has already been classified a scribble.
 * Delete the strokes it crosses (plus itself) via the lasso pipeline — the
 * only UNDOABLE delete path (file-level writes are not recorded on the host
 * undo stack).
 *
 * Flow: sanity-check the cache (cheap element-count drift test) → find crossed
 * strokes from the cache (bbox prefilter → polyline intersection on
 * RDP-simplified points, excluding the just-drawn stroke) → lasso the union
 * bounding box (screen coords) → deleteLassoElements → release the lasso.
 * No getElements / per-element reads on the hot path.
 *
 * @format
 */

import { PluginCommAPI, PluginFileAPI } from 'sn-plugin-lib';
import { BUILD_TAG, dlog, LASSO_PAD_PX, LOG } from '../constants';
import { acquireBusy, releaseBusy } from './busy';
import {
  Bbox,
  bboxOf,
  emrBboxToAndroidRect,
  emrBboxToScreenRect,
  padRect,
  polylinesCross,
  Pt,
  Rect,
  RDP_EPSILON,
  simplifyPath,
  unionBbox,
} from '../utils/geometry';
import { cacheOffset, cacheQuery, cacheRemoveNums, cacheSize } from './cache';
import { seedCache } from './seed';

const TYPE_STROKE = 0;

/** Two bounding boxes are the same stroke read back (all corners within eps). */
function sameBbox(a: Bbox, b: Bbox, eps = 3): boolean {
  return (
    Math.abs(a.minX - b.minX) < eps &&
    Math.abs(a.minY - b.minY) < eps &&
    Math.abs(a.maxX - b.maxX) < eps &&
    Math.abs(a.maxY - b.maxY) < eps
  );
}

/**
 * Keep the cache honest with a single cheap native call: the host's element
 * count (from getElementNumList — the same API the seed baseline came from)
 * must equal cacheSize + offset. Host undo, the built-in eraser, or text edits
 * shift the host side → reseed once, then continue. Returns true if a reseed
 * happened.
 */
async function validateCache(filePath: string, page: number): Promise<boolean> {
  const off = cacheOffset(filePath, page);
  if (off === null) {
    // No seed yet (shouldn't happen — scribble.ts seeds eagerly) — seed now.
    await seedCache(filePath, page);
    return true;
  }
  const numRes: any = await PluginFileAPI.getElementNumList(filePath, page);
  if (!numRes || numRes.success !== true || !Array.isArray(numRes.result)) {
    dlog(`${LOG} cache: getElementNumList failed (${JSON.stringify(numRes?.error)}) — trusting cache`);
    return false;
  }
  const hostTotal = numRes.result.length;
  const expected = cacheSize(filePath, page) + off;
  if (hostTotal === expected) return false;
  dlog(
    `${LOG} cache: drift hostTotal=${hostTotal} expected=${expected} (cache=${cacheSize(filePath, page)} off=${off}) — reseeding`,
  );
  await seedCache(filePath, page);
  return true;
}

export async function eraseByScribble(
  scribbleEl: any,
  scribblePts: Pt[],
  filePath: string,
  page: number,
): Promise<void> {
  // Shared single-flight guard: a second scribble while one erase is in flight
  // would interleave lasso state and writes. Whoever holds it runs; others back off.
  if (!acquireBusy()) {
    dlog(`${LOG} erase: busy — ignoring`);
    return;
  }
  let lassoOpen = false;
  const t0 = Date.now();
  try {
    const scribbleBox = bboxOf(scribblePts);
    if (!scribbleBox) {
      dlog(`${LOG} erase: scribble has no bbox`);
      return;
    }

    const tV = Date.now();
    await validateCache(filePath, page);
    dlog(`${LOG} validateMs=${Date.now() - tV}`);

    // Find the pre-existing strokes the candidate actually crosses — from the
    // cache, crossing against RDP-simplified points (no page re-read).
    const scribbleSimp = simplifyPath(scribblePts, RDP_EPSILON);
    // Self-exclusion: the gesture is cached too (added before the erase). If
    // numInPage is missing for some reason, fall back to geometry.
    const excludeNum =
      typeof scribbleEl?.numInPage === 'number' ? scribbleEl.numInPage : -1;
    const candidates = cacheQuery(filePath, page, scribbleBox, excludeNum).filter(
      c => !sameBbox(c.bbox, scribbleBox),
    );
    const crossed: { num: number; box: Bbox }[] = [];
    for (const c of candidates) {
      if (polylinesCross(scribbleSimp, c.pts)) crossed.push({ num: c.num, box: c.bbox });
    }
    const t1 = Date.now();
    dlog(
      `${LOG} build=${BUILD_TAG} cached=${cacheSize(filePath, page)} ` +
        `candidates=${candidates.length} crossed=${crossed.length} scanMs=${t1 - t0}`,
    );

    // A scribble on blank space is just drawing — leave it alone.
    if (crossed.length === 0) {
      dlog(`${LOG} erase: scribble crossed nothing — no-op`);
      return;
    }

    // Lasso the union bbox of the crossed strokes plus the scribble itself.
    const region = unionBbox([scribbleBox, ...crossed.map(c => c.box)]);
    if (!region) return;
    const psRes: any = await PluginFileAPI.getPageSize(filePath, page);
    const pageSize: any = psRes?.success ? psRes.result : null;
    if (!pageSize || typeof pageSize.width !== 'number' || typeof pageSize.height !== 'number') {
      dlog(`${LOG} erase: getPageSize failed (${JSON.stringify(psRes)})`);
      return;
    }
    // EMR→screen. PointUtils.emrPoint2Android scales by the pageSize-derived EMR
    // max, which is wrong when the device's true EMR range differs from it
    // (the element's maxX/maxY carries the real page max). Scale by maxX/maxY
    // when available; fall back to the library converter otherwise.
    const emrMaxX = typeof scribbleEl?.maxX === 'number' ? scribbleEl.maxX : 0;
    const emrMaxY = typeof scribbleEl?.maxY === 'number' ? scribbleEl.maxY : 0;
    // EMR bbox → padded integer screen rect. Padding outward keeps the scribble
    // (which defines the union box's edge) and other boundary strokes inside the
    // "fully inside" lasso — without it a tighter device lasso erases the text
    // but leaves the scribble.
    const toRect = (box: Bbox): Rect => {
      const raw =
        emrMaxX > 0 && emrMaxY > 0
          ? emrBboxToScreenRect(box, pageSize, emrMaxX, emrMaxY)
          : emrBboxToAndroidRect(box, pageSize);
      return padRect(raw, LASSO_PAD_PX, pageSize.width - 1, pageSize.height - 1);
    };

    // The lasso box still renders (setLassoBoxState(1) here does not prevent
    // it); the call is kept as it seems to make the selection phase complete
    // faster. If the host rejects it, we fall through unchanged.
    try {
      const hide: any = await PluginCommAPI.setLassoBoxState(1);
      dlog(`${LOG} pre-hide setLassoBoxState(1) => success=${hide?.success} err=${JSON.stringify(hide?.error)}`);
    } catch (e) {
      dlog(`${LOG} pre-hide failed: ${e}`);
    }

    const lr: any = await PluginCommAPI.lassoElements(toRect(region));
    const t2 = Date.now();
    dlog(
      `${LOG} lassoElements => success=${lr?.success} lassoMs=${t2 - t1} ` +
        `err=${JSON.stringify(lr?.error)}`,
    );
    if (!lr?.success) return;
    // From here a lasso is open; the finally always releases it, so an abort or
    // an exception can't leave a dangling selection (which would silently
    // corrupt the host's element list across the next mutation).
    lassoOpen = true;

    const selRes: any = await PluginCommAPI.getLassoElements();
    const selected: any[] = selRes?.success ? (selRes.result ?? []) : [];
    const t3 = Date.now();
    dlog(`${LOG} getLassoElements => selected=${selected.length} selMs=${t3 - t2}`);
    if (selected.length === 0) {
      dlog(`${LOG} erase: lasso selected nothing — aborting`);
      return;
    }

    const del: any = await PluginCommAPI.deleteLassoElements();
    const t4 = Date.now();
    dlog(
      `${LOG} deleted=${selected.length} crossed=${crossed.length} delMs=${t4 - t3} ` +
        `success=${del?.success}`,
    );
    if (del && del.success === true) {
      // Exact cache sync from the actual selection (keeps the drift check quiet).
      const deletedNums = selected
        .filter((e: any) => e?.type === TYPE_STROKE && typeof e.numInPage === 'number')
        .map((e: any) => e.numInPage);
      const removed = cacheRemoveNums(filePath, page, deletedNums);
      dlog(`${LOG} cache: removed ${removed} exact stroke(s) from lasso selection`);
    }
    for (const e of selected) {
      try {
        e?.recycle?.();
      } catch {
        /* ignore */
      }
    }
  } catch (err) {
    console.error(`${LOG} eraseByScribble failed:`, err);
  } finally {
    // Release the lasso on every path (success or exception) before any later
    // mutation can run.
    if (lassoOpen) {
      try {
        await PluginCommAPI.setLassoBoxState(2);
      } catch (e) {
        dlog(`${LOG} erase: setLassoBoxState failed: ${e}`);
      }
    }
    releaseBusy();
    dlog(`${LOG} totalMs=${Date.now() - t0}`);
  }
}
