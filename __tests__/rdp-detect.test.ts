/**
 * The crossing test runs on RDP-simplified points, so simplification must not
 * change the classifier's verdict on the labeled corpus — otherwise a scribble
 * could fail to trigger (false negative) after simplification.
 *
 * @format
 */

import { classifyScribble } from '../src/logic/detect';
import { RDP_EPSILON, simplifyPath } from '../src/utils/geometry';
import corpus from './fixtures/scribble-corpus.json';

type Stroke = { seq: number; label: 'scribble' | 'word'; points: { x: number; y: number }[] };

describe('RDP simplification preserves classification', () => {
  const strokes = corpus as Stroke[];

  it('classifies simplified strokes identically to full-resolution strokes', () => {
    const wrong = strokes
      .map(s => {
        const full = classifyScribble(s.points).isScribble;
        const simp = classifyScribble(simplifyPath(s.points, RDP_EPSILON)).isScribble;
        return { seq: s.seq, label: s.label, full, simp, pts: s.points.length, simpPts: simplifyPath(s.points, RDP_EPSILON).length };
      })
      .filter(r => r.full !== r.simp);
    expect(wrong).toEqual([]);
  });

  it('actually reduces point counts (straight runs collapse)', () => {
    for (const s of strokes) {
      const simp = simplifyPath(s.points, RDP_EPSILON);
      expect(simp.length).toBeLessThanOrEqual(s.points.length);
    }
    const reductions = strokes.map(
      s => s.points.length - simplifyPath(s.points, RDP_EPSILON).length,
    );
    const totalReduction = reductions.reduce((a, b) => a + b, 0);
    expect(totalReduction).toBeGreaterThan(0);
  });
});
