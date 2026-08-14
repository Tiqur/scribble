/**
 * The on-device settings panel (App.tsx) mutates the runtime config that
 * classifyScribble reads on every stroke. These tests prove that the mutation
 * path works: a change flips classifications, reset restores the tuned
 * defaults, and the snippet reflects the live values.
 *
 * @format
 */

import {
  copyConstantsSnippet,
  getRecentDecisions,
  getZigzagConfig,
  pushDecision,
  resetZigzagConfig,
  setZigzagConfig,
} from '../src/config';
import { classifyScribble } from '../src/logic/detect';
import corpus from './fixtures/scribble-corpus.json';

type Stroke = { seq: number; label: 'scribble' | 'word'; points: { x: number; y: number }[] };

const strokes = corpus as Stroke[];

beforeEach(() => {
  resetZigzagConfig();
});

describe('runtime config', () => {
  it('defaults match the tuned ZIGZAG_CONFIG values', () => {
    expect(getZigzagConfig()).toEqual({
      MIN_ANGLE_DEG: 140,
      MIN_REVERSALS: 6,
      STEP_DIST_PCT: 5.0,
      EPSILON_PCT: 0.5,
      HOOK_MARGIN_PCT: 5.0,
      MAX_BBOX_DIAGONAL: 12000,
    });
  });

  it('setZigzagConfig applies a patch, reset restores the defaults', () => {
    const defaults = { ...getZigzagConfig() };
    setZigzagConfig({ MIN_REVERSALS: 1 });
    expect(getZigzagConfig().MIN_REVERSALS).toBe(1);
    expect(getZigzagConfig()).not.toEqual(defaults);
    resetZigzagConfig();
    expect(getZigzagConfig()).toEqual(defaults);
  });

  it('classifications respond to live tuning', () => {
    // With the tuned defaults every corpus word classifies as normal.
    const words = strokes.filter(s => s.label === 'word');
    expect(words.every(s => !classifyScribble(s.points).isScribble)).toBe(true);

    // Any word with at least one sharp reversal becomes a scribble once the
    // required count drops to 1.
    setZigzagConfig({ MIN_REVERSALS: 1 });
    const flipped = words.filter(s => classifyScribble(s.points).isScribble);
    expect(flipped.length).toBeGreaterThan(0);

    // Every word that flipped was above zero reversals at the defaults.
    setZigzagConfig({ MIN_REVERSALS: 1, MIN_ANGLE_DEG: 140 });
    for (const s of words) {
      const atDefault = classifyScribble(s.points).reversalCount;
      if (atDefault >= 1) {
        expect(classifyScribble(s.points).isScribble).toBe(true);
      }
    }
  });

  it('reset restores the corpus-tuned verdicts', () => {
    setZigzagConfig({ MIN_REVERSALS: 1 });
    resetZigzagConfig();
    const words = strokes.filter(s => s.label === 'word');
    expect(words.every(s => !classifyScribble(s.points).isScribble)).toBe(true);
    const scribbles = strokes.filter(s => s.label === 'scribble');
    expect(scribbles.every(s => classifyScribble(s.points).isScribble)).toBe(true);
  });
});

describe('settings snippet', () => {
  it('renders the live values as a constants.ts replacement', () => {
    setZigzagConfig({ MIN_ANGLE_DEG: 145, STEP_DIST_PCT: 6.5, EPSILON_PCT: 0.8 });
    const snippet = copyConstantsSnippet(getZigzagConfig());
    expect(snippet).toContain('MIN_ANGLE_DEG: 145');
    expect(snippet).toContain('STEP_DIST_PCT: 6.5');
    expect(snippet).toContain('EPSILON_PCT: 0.8');
    expect(snippet).toContain('MIN_REVERSALS: 6');
    expect(snippet).toContain('MAX_BBOX_DIAGONAL: 12000');
    expect(snippet).toContain('};');
  });

  it('snippet stays parseable after float stepper steps', () => {
    setZigzagConfig({ EPSILON_PCT: 0.2, STEP_DIST_PCT: 12, HOOK_MARGIN_PCT: 0 });
    const snippet = copyConstantsSnippet(getZigzagConfig());
    expect(snippet).toContain('EPSILON_PCT: 0.2');
    expect(snippet).toContain('STEP_DIST_PCT: 12.0');
    expect(snippet).toContain('HOOK_MARGIN_PCT: 0.0');
  });
});

describe('recent decisions ring', () => {
  it('is empty until strokes are pushed', () => {
    expect(getRecentDecisions()).toHaveLength(0);
  });

  it('returns the newest lines, capped at 10', () => {
    for (let i = 1; i <= 15; i++) pushDecision(`stroke ${i}`);
    const lines = getRecentDecisions().map(d => d.line);
    expect(lines).toHaveLength(10);
    expect(lines[lines.length - 1]).toBe('stroke 15');
    expect(lines[0]).toBe('stroke 6');
  });
});
