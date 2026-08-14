export const LOG = '[Scribble]';
// Gates the diagnostic logs. Errors (`console.error`) and user-facing `alert`s
// are never gated. Flip on while developing.
export const DEBUG = false;
export function dlog(...args: any[]): void {
  if (DEBUG) console.log(...args);
}

// Logged at each action start to confirm which build is actually live: pushing a
// new .snplg doesn't always replace the running one. Bump per deploy.
export const BUILD_TAG = 'v1.3.2';

// Zig-zag / scribble detection (angle-profile based, tuned against the labeled
// corpus on-device strokes). A scribble is a stroke with several sharp
// hairpin turns; handwriting's turns are softer and fewer.
// - MIN_ANGLE_DEG: reversals must be tighter than this to count as a hairpin.
//   Cursive 'm'/'w' turns sit around 70–110°; corpus scribbles produce turns
//   at/above 140°, corpus words stay below. 140 is the separation point.
// - MIN_REVERSALS: corpus scribbles yield ≥8 hairpins, words ≤4 — 6 sits in
//   the middle with margin.
// - STEP_DIST_PCT: the arc-length window (as % of bbox diagonal) used to form
//   the turn-angle chords; big enough to ignore jitter, small enough to not
//   cut corners.
// - EPSILON_PCT: RDP pre-filter tolerance (% of bbox diagonal). 0.5% keeps
//   enough detail that corner apexes survive.
// - HOOK_MARGIN_PCT: ignore the first/last portion of the stroke (pen-down and
//   pen-up hooks create fake sharp turns).
// - MAX_BBOX_DIAGONAL: loose size backstop (EMR).
export const ZIGZAG_CONFIG = {
  MIN_ANGLE_DEG: 140,
  MIN_REVERSALS: 6,
  STEP_DIST_PCT: 5.0,
  EPSILON_PCT: 0.5,
  HOOK_MARGIN_PCT: 5.0,
  MAX_BBOX_DIAGONAL: 12000,
};

// The erase lassoes the union bbox of the crossed strokes + the scribble. The
// scribble defines that box's outer edge, so with the lasso's "fully inside"
// selection it sits right on the boundary — and a slightly tighter device lasso
// (higher-DPI screens buy less margin from integer rounding) drops it, so the
// text erases but the scribble doesn't. Pad the rect outward by this many screen
// px so boundary strokes are comfortably inside.
export const LASSO_PAD_PX = 8;

// SDK element type codes (from getElements / getLassoElements).
export const ELEMENT_TYPES = {
  STROKE: 0,
  TITLE: 100,
  PICTURE: 200,
  TEXT: 500,
  TEXT_DIGEST_QUOTE: 501,
  TEXT_DIGEST_CREATE: 502,
  LINK: 600,
  GEO: 700,
};
