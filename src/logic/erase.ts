/**
 * The erase operation: the stroke has already been classified a scribble. Delete
 * the strokes it crosses (plus itself) via the lasso pipeline — the only undoable
 * delete path.
 *
 * Sequence: read the page → find crossed strokes (bbox prefilter → polyline
 * intersection, excluding the just-drawn stroke) → lasso the union bounding box
 * (screen coords) → deleteLassoElements → release the lasso. The page read
 * happens only here (on a confirmed scribble), never during normal writing.
 *
 * @format
 */

import { PluginCommAPI, PluginFileAPI } from 'sn-plugin-lib';
import { BUILD_TAG, dlog, LASSO_PAD_PX, LOG } from '../constants';
import { acquireBusy, releaseBusy } from './busy';
import {
  Bbox,
  bboxesOverlap,
  bboxOf,
  emrBboxToAndroidRect,
  emrBboxToScreenRect,
  padRect,
  polylinesCross,
  Pt,
  readStrokePoints,
  Rect,
  unionBbox,
} from '../utils/geometry';

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
  let pageEls: any[] = [];
  const t0 = Date.now();
  try {
    const scribbleBox = bboxOf(scribblePts);
    if (!scribbleBox) {
      dlog(`${LOG} erase: scribble has no bbox`);
      return;
    }

    // Find the pre-existing strokes the candidate actually crosses.
    const elsRes: any = await PluginFileAPI.getElements(page, filePath);
    pageEls = elsRes?.success ? (elsRes.result ?? []) : [];
    const crossed: { uuid: string; box: Bbox }[] = [];
    for (const e of pageEls) {
      if (e?.type !== TYPE_STROKE || e?.uuid === scribbleEl?.uuid) continue;
      const pts = await readStrokePoints(e);
      const box = bboxOf(pts);
      if (!box || !bboxesOverlap(box, scribbleBox)) continue; // cheap prefilter
      // Robust self-exclusion: the just-drawn stroke is ALSO in getElements,
      // often with a different uuid (uuid isn't consistent across SDK APIs), so
      // the uuid check above can miss it. Skip it by geometry — otherwise a
      // self-intersecting cursive word "crosses itself" and erases itself.
      if (sameBbox(box, scribbleBox)) continue;
      if (polylinesCross(scribblePts, pts)) crossed.push({ uuid: e.uuid, box });
    }
    const t1 = Date.now();
    dlog(
      `${LOG} build=${BUILD_TAG} elements=${pageEls.length} crossed=${crossed.length} ` +
        `scanMs=${t1 - t0} elemsMs=${Math.round((t1 - t0) / Math.max(1, pageEls.length))}/el`,
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
    for (const e of pageEls) {
      try {
        e?.recycle?.();
      } catch {
        /* ignore */
      }
    }
    releaseBusy();
    dlog(`${LOG} totalMs=${Date.now() - t0}`);
  }
}
