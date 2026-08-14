/**
 * The incremental stroke cache: add/query/remove + the offset-based drift
 * detection that backs erase correctness.
 *
 * @format
 */

import {
  cacheAdd,
  cacheClear,
  cacheHas,
  cacheOffset,
  cacheQuery,
  cacheRemoveNums,
  cacheReset,
  cacheSetOffset,
  cacheSize,
} from '../src/logic/cache';

const FILE = '/notes/test.note';
const PAGE = 0;

describe('stroke cache', () => {
  beforeEach(() => cacheReset());

  it('stores and queries strokes by bbox overlap', () => {
    // Two strokes far apart, one nearby.
    const left = [{ x: 0, y: 0 }, { x: 100, y: 100 }];
    const right = [{ x: 5000, y: 0 }, { x: 5100, y: 100 }];
    const near = [{ x: 90, y: 90 }, { x: 200, y: 200 }];
    cacheAdd(FILE, PAGE, 1, left);
    cacheAdd(FILE, PAGE, 2, right);
    cacheAdd(FILE, PAGE, 3, near);

    expect(cacheSize(FILE, PAGE)).toBe(3);

    // Query box overlapping `left` only.
    const box = { minX: 0, minY: 0, maxX: 150, maxY: 150 };
    const hits = cacheQuery(FILE, PAGE, box).map(c => c.num).sort();
    expect(hits).toEqual([1, 3]);

    // Excluding the gesture (num 3) hides it.
    const excl = cacheQuery(FILE, PAGE, box, 3).map(c => c.num);
    expect(excl).toEqual([1]);
  });

  it('replaces entries with the same num (self-exclusion stays stable)', () => {
    cacheAdd(FILE, PAGE, 7, [{ x: 0, y: 0 }, { x: 100, y: 100 }]);
    cacheAdd(FILE, PAGE, 7, [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 200, y: 200 }]);
    expect(cacheSize(FILE, PAGE)).toBe(1);
  });

  it('cacheRemoveNums drops exactly the given strokes', () => {
    cacheAdd(FILE, PAGE, 1, [{ x: 0, y: 0 }, { x: 100, y: 100 }]);
    cacheAdd(FILE, PAGE, 2, [{ x: 5000, y: 5000 }, { x: 5100, y: 5100 }]);
    const removed = cacheRemoveNums(FILE, PAGE, [1, 999]);
    expect(removed).toBe(1);
    expect(cacheSize(FILE, PAGE)).toBe(1);
    expect(cacheQuery(FILE, PAGE, { minX: 0, minY: 0, maxX: 100, maxY: 100 }).length).toBe(0);
  });

  it('drift detection: offset + cacheSize must equal the host total', () => {
    cacheSetOffset(FILE, PAGE, 2); // e.g. two non-stroke elements on the page
    cacheAdd(FILE, PAGE, 1, [{ x: 0, y: 0 }, { x: 100, y: 100 }]);
    cacheAdd(FILE, PAGE, 2, [{ x: 200, y: 200 }, { x: 300, y: 300 }]);
    // hostTotal would be 4 (2 strokes + offset 2) → no drift
    expect(cacheSize(FILE, PAGE) + (cacheOffset(FILE, PAGE) as number)).toBe(4);
    // After host undo restored a stroke we don't know about, hostTotal=5 → drift
    expect(cacheSize(FILE, PAGE) + (cacheOffset(FILE, PAGE) as number)).not.toBe(5);
  });

  it('cacheClear removes page state including offset', () => {
    cacheSetOffset(FILE, PAGE, 2);
    cacheAdd(FILE, PAGE, 1, [{ x: 0, y: 0 }, { x: 100, y: 100 }]);
    cacheClear(FILE, PAGE);
    expect(cacheHas(FILE, PAGE)).toBe(false);
    expect(cacheOffset(FILE, PAGE)).toBeNull();
  });
});
