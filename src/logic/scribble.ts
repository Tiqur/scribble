/**
 * PEN_UP entry point.
 *
 * Every stroke passes through here with its points, so each stroke is cached
 * (bbox + simplified points) for later crossing tests. The first stroke of a
 * page triggers a one-time seed read of the page's existing content. A stroke
 * then triggers an erase only if it (a) looks scribbly enough to be worth
 * checking and (b) actually crosses cached ink (the overlap gate, in
 * eraseByScribble). A scribbly stroke on blank space is just writing/drawing
 * and is left alone.
 *
 * @format
 */

import { PluginCommAPI, NativePluginManager } from 'sn-plugin-lib';
import { BUILD_TAG, dlog, LOG } from '../constants';
import { readStrokePoints } from '../utils/geometry';
import { classifyScribble } from './detect';
import { eraseByScribble } from './erase';
import { cacheAdd, cacheHas } from './cache';
import { seedCache } from './seed';
import { notify } from './notify';

const TYPE_STROKE = 0;

export async function onScribblePenUp(elements: any[]): Promise<void> {
  try {
    if (!Array.isArray(elements) || elements.length === 0) return;

    const pathRes: any = await PluginCommAPI.getCurrentFilePath();
    const pageRes: any = await PluginCommAPI.getCurrentPageNum();
    const filePath: string | null =
      pathRes?.success && typeof pathRes.result === 'string' ? pathRes.result : null;
    const page: number | null =
      pageRes?.success && typeof pageRes.result === 'number' ? pageRes.result : null;
    if (filePath == null || page == null) {
      dlog(`${LOG} pen_up: missing file/page — strokes not cached`);
      for (const el of elements ?? []) {
        if (el?.type !== TYPE_STROKE) continue;
        const pts = await readStrokePoints(el);
        const cls = classifyScribble(pts);
        dlog(
          `${LOG} STROKE ${tagOf(el)} build=${BUILD_TAG} turns=${cls.reversalCount} ` +
            `diag=${cls.diagonal.toFixed(0)} ` +
            `-> ${cls.isScribble ? 'SCRIBBLE' : 'normal'} (no context)`,
        );
      }
      return;
    }

    for (const el of elements) {
      if (el?.type !== TYPE_STROKE) continue;
      // Never treat white-ink strokes as gestures (eraser/synthetic strokes).
      if (el?.stroke?.penColor === 0xfe) continue;

      const pts = await readStrokePoints(el);
      const cls = classifyScribble(pts);
      dlog(
        `${LOG} STROKE ${tagOf(el)} build=${BUILD_TAG} turns=${cls.reversalCount} ` +
          `diag=${cls.diagonal.toFixed(0)} ` +
          `-> ${cls.isScribble ? 'SCRIBBLE' : 'normal'}`,
      );

      // Cache every stroke so future scribbles cross-test in JS only.
      if (!cacheHas(filePath, page)) {
        dlog(`${LOG} cache: cold page — eager seed (one-time full read)`);
        await seedCache(filePath, page);
      }
      cacheAdd(filePath, page, el.numInPage, pts);

      if (!cls.isScribble) continue;

      // Landscape (split-page) mode is not supported: the host's lasso pipeline
      // misbehaves there — lassoElements can hang and never return, freezing the
      // plugin. Skip the erase rather than risk that. getOrientation returns 1/3
      // for the 90°/270° landscape orientations (0/2 are portrait).
      let orientation = 0;
      try {
        const o = await (NativePluginManager as any).getOrientation();
        if (typeof o === 'number') orientation = o;
      } catch {
        /* assume portrait if unavailable */
      }
      if (orientation === 1 || orientation === 3) {
        dlog(`${LOG} STROKE ${tagOf(el)} landscape (orientation=${orientation}) — erase unsupported, skipping`);
        await notify('Scribble erase isn’t available in landscape mode yet.');
        continue;
      }

      await eraseByScribble(el, pts, filePath, page);
    }
  } catch (error) {
    console.error(`${LOG} onScribblePenUp failed:`, error);
  } finally {
    for (const el of elements ?? []) {
      try {
        el?.recycle?.();
      } catch {
        /* ignore */
      }
    }
  }
}

function tagOf(el: any): string {
  return typeof el?.uuid === 'string' ? el.uuid.slice(0, 8) : '????????';
}
