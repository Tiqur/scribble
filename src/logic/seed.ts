/**
 * Seeding: the one full page read the plugin ever does. Caches every
 * pre-existing stroke (bbox + simplified points) and records the offset used
 * by the erase-time drift check — computed FROM getElementNumList, the same
 * API the drift check uses, so the comparison is self-consistent regardless of
 * whether that API returns all elements or strokes only.
 *
 * Called on the first stroke of a page and when the drift check fires (host
 * undo / built-in eraser / edits). Fetched elements are recycled afterwards —
 * the SDK keeps them in native memory until then.
 *
 * @format
 */

import { PluginFileAPI } from 'sn-plugin-lib';
import { dlog, LOG } from '../constants';
import { readStrokePoints } from '../utils/geometry';
import { cacheAdd, cacheSetOffset, cacheSize } from './cache';

export async function seedCache(file: string, page: number): Promise<boolean> {
  const elsRes: any = await PluginFileAPI.getElements(page, file);
  if (!elsRes || elsRes.success !== true || !Array.isArray(elsRes.result)) {
    dlog(`${LOG} cache: seed failed (getElements ${JSON.stringify(elsRes?.error)})`);
    return false;
  }
  const els: any[] = elsRes.result;
  for (const e of els) {
    if (e?.type !== 0) continue;
    try {
      const pts = await readStrokePoints(e);
      if (pts.length >= 2) cacheAdd(file, page, e.numInPage, pts);
    } catch (_) {
      /* skip unreadable stroke */
    }
  }
  // Offset baseline from the same API the drift check uses at erase time.
  let hostTotal = -1;
  try {
    const numRes: any = await PluginFileAPI.getElementNumList(file, page);
    if (numRes && numRes.success === true && Array.isArray(numRes.result)) {
      hostTotal = numRes.result.length;
    }
  } catch (_) {
    /* fall through to els.length below */
  }
  if (hostTotal < 0) hostTotal = els.length;
  const offset = hostTotal - cacheSize(file, page);
  cacheSetOffset(file, page, offset);
  dlog(
    `${LOG} cache: seeded ${file}|${page} — ${cacheSize(file, page)} strokes / ${hostTotal} host elements (offset=${offset})`,
  );
  for (const e of els) {
    try {
      e?.recycle?.();
    } catch {
      /* ignore */
    }
  }
  return true;
}
