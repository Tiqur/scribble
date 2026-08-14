/**
 * Zig-zag / scribble detection from the stroke's own points (cheap, no SDK
 * read of other elements).
 *
 * A scribble is a stroke with several SHARP hairpin turns: at each point we
 * measure the turn angle between chords taken a fixed ARC-LENGTH ahead and
 * behind (a % of the stroke's bounding-box diagonal, so it's scale-agnostic),
 * count true local-max apexes after spatial non-maximum suppression, and call
 * it a scribble when enough hairpins survive. Handwriting's turns are softer
 * and fewer, so it stays below the threshold.
 *
 * All distances are relative to the stroke's own size (bbox diagonal) —
 * works identically in EMR or pixel space, any DPI.
 *
 * Tuned against the labeled corpus: scribbles yield ≥8 hairpins, words ≤4,
 * at MIN_ANGLE_DEG=140 / MIN_REVERSALS=6.
 *
 * @format
 */

import { getZigzagConfig } from '../config';
import { bboxOf, diagonalOf, Pt, simplifyPath } from '../utils/geometry';

export interface ScribbleClass {
  isScribble: boolean;
  reversalCount: number;
  diagonal: number;
}

export function classifyScribble(rawPoints: Pt[]): ScribbleClass {
  if (!rawPoints || rawPoints.length < 3) {
    return { isScribble: false, reversalCount: 0, diagonal: 0 };
  }

  const box = bboxOf(rawPoints);
  const diagonal = box ? diagonalOf(box) : 0;
  if (diagonal <= 0 || diagonal > getZigzagConfig().MAX_BBOX_DIAGONAL) {
    return { isScribble: false, reversalCount: 0, diagonal };
  }

  // 1. Relative geometry: everything is a % of the stroke's own size.
  const cfg = getZigzagConfig();
  const epsilon = (cfg.EPSILON_PCT / 100) * diagonal;
  const stepDist = (cfg.STEP_DIST_PCT / 100) * diagonal;

  // 2. RDP pre-filter: strips collinear jitter, preserves corner apexes.
  const points = simplifyPath(rawPoints, epsilon);

  // 3. Cumulative arc lengths — "how far along the string" every point is.
  const arcLengths: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    arcLengths.push(arcLengths[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  const totalLength = arcLengths[arcLengths.length - 1];
  if (totalLength < stepDist * 1.5) {
    // Too short for even one analysis window — a dot, not a scribble.
    return { isScribble: false, reversalCount: 0, diagonal };
  }
  const hookMargin = totalLength * (cfg.HOOK_MARGIN_PCT / 100);

  // Exact coordinate at a given distance along the stroke.
  function pointAtArcLength(targetLen: number): Pt {
    targetLen = Math.max(0, Math.min(totalLength, targetLen));
    for (let i = 0; i < arcLengths.length - 1; i++) {
      if (arcLengths[i] <= targetLen && targetLen <= arcLengths[i + 1]) {
        const segLen = arcLengths[i + 1] - arcLengths[i];
        if (segLen === 0) return points[i];
        const t = (targetLen - arcLengths[i]) / segLen;
        return {
          x: points[i].x + t * (points[i + 1].x - points[i].x),
          y: points[i].y + t * (points[i + 1].y - points[i].y),
        };
      }
    }
    return points[points.length - 1];
  }

  // 4. Turn-deflection angles from arc-length chords (0 = straight, 180 = U-turn).
  const angleProfile: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const currLen = arcLengths[i];
    // Ignore pen-down/pen-up hooks.
    if (currLen < hookMargin || currLen > totalLength - hookMargin) {
      angleProfile.push(0);
      continue;
    }
    const pPrev = pointAtArcLength(currLen - stepDist);
    const pCurr = points[i];
    const pNext = pointAtArcLength(currLen + stepDist);
    const v1x = pCurr.x - pPrev.x;
    const v1y = pCurr.y - pPrev.y;
    const v2x = pNext.x - pCurr.x;
    const v2y = pNext.y - pCurr.y;
    const len1 = Math.sqrt(v1x * v1x + v1y * v1y);
    const len2 = Math.sqrt(v2x * v2x + v2y * v2y);
    if (len1 < 1e-3 || len2 < 1e-3) {
      angleProfile.push(0);
      continue;
    }
    const dot = (v1x * v2x + v1y * v2y) / (len1 * len2);
    angleProfile.push((Math.acos(Math.max(-1, Math.min(1, dot))) * 180) / Math.PI);
  }

  // 5. Local maxima + NMS by ARC-LENGTH distance (not array index — RDP
  //    spacing is irregular, index windows could swallow adjacent peaks).
  const candidates: { angleDeg: number; arcLen: number }[] = [];
  for (let i = 1; i < points.length - 1; i++) {
    const angle = angleProfile[i];
    if (angle < cfg.MIN_ANGLE_DEG) continue;
    let isLocalMax = true;
    for (let j = 0; j < points.length; j++) {
      if (i === j) continue;
      if (Math.abs(arcLengths[j] - arcLengths[i]) <= stepDist && angleProfile[j] > angle) {
        isLocalMax = false;
        break;
      }
    }
    if (isLocalMax) {
      candidates.push({ angleDeg: angle, arcLen: arcLengths[i] });
    }
  }

  // 6. Greedy dedup of near-duplicate apexes — keep the sharper one.
  const reversals: { angleDeg: number; arcLen: number }[] = [];
  for (const curr of candidates) {
    const prev = reversals[reversals.length - 1];
    if (prev && curr.arcLen - prev.arcLen < stepDist * 1.5) {
      if (curr.angleDeg > prev.angleDeg) reversals[reversals.length - 1] = curr;
    } else {
      reversals.push(curr);
    }
  }

  // 7. Classification.
  return {
    isScribble: reversals.length >= cfg.MIN_REVERSALS,
    reversalCount: reversals.length,
    diagonal,
  };
}
