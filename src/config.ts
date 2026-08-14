/**
 * Runtime-tunable detection settings.
 *
 * The detection thresholds live here as mutable state instead of compile-time
 * constants so they can be fine-tuned on-device from the settings panel
 * (App.tsx). Defaults come from ZIGZAG_CONFIG in constants.ts; every change
 * applies to the very next classification.
 *
 * Persistence: the SDK has no file-write API, so settings are in-memory only —
 * they survive as long as the plugin's JS context is loaded and reset on
 * process restart. To make a tuned value permanent, copy the snippet from the
 * panel (copyConstantsSnippet) into constants.ts and rebuild.
 *
 * @format
 */

import { ZIGZAG_CONFIG } from './constants';

export interface ZigzagConfig {
  MIN_ANGLE_DEG: number;
  MIN_REVERSALS: number;
  STEP_DIST_PCT: number;
  EPSILON_PCT: number;
  HOOK_MARGIN_PCT: number;
  MAX_BBOX_DIAGONAL: number;
}

let cfg: ZigzagConfig = { ...ZIGZAG_CONFIG };

export function getZigzagConfig(): ZigzagConfig {
  return cfg;
}

export function setZigzagConfig(patch: Partial<ZigzagConfig>): void {
  cfg = { ...cfg, ...patch };
}

export function resetZigzagConfig(): void {
  cfg = { ...ZIGZAG_CONFIG };
}

// Ring of recent classification lines for the settings panel's live feedback.
// One line per stroke, appended in order; the panel shows the newest first.
const MAX_DECISIONS = 10;
const recentDecisions: { id: number; line: string }[] = [];
let decisionSeq = 0;

export function pushDecision(line: string): void {
  recentDecisions.push({ id: ++decisionSeq, line });
  if (recentDecisions.length > MAX_DECISIONS) recentDecisions.shift();
}

export function getRecentDecisions(): { id: number; line: string }[] {
  return recentDecisions.slice();
}

function fmt1(v: number): string {
  return (Math.round(v * 10) / 10).toFixed(1);
}

// Renders the current settings as a drop-in replacement for ZIGZAG_CONFIG in
// constants.ts — the "make it permanent" path.
export function copyConstantsSnippet(c: ZigzagConfig = cfg): string {
  return [
    'export const ZIGZAG_CONFIG = {',
    `  MIN_ANGLE_DEG: ${c.MIN_ANGLE_DEG},`,
    `  MIN_REVERSALS: ${c.MIN_REVERSALS},`,
    `  STEP_DIST_PCT: ${fmt1(c.STEP_DIST_PCT)},`,
    `  EPSILON_PCT: ${fmt1(c.EPSILON_PCT)},`,
    `  HOOK_MARGIN_PCT: ${fmt1(c.HOOK_MARGIN_PCT)},`,
    `  MAX_BBOX_DIAGONAL: ${c.MAX_BBOX_DIAGONAL},`,
    '};',
  ].join('\n');
}
