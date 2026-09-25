import { describe, expect, it } from 'vitest';
import { dailyKey, dailySeed, hashString, parseSeedCode, Rng, seedToCode } from '../src/core/rng';

describe('Rng', () => {
  it('is deterministic for a seed', () => {
    const a = new Rng(1234);
    const b = new Rng(1234);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('stays in [0,1) and int() is inclusive', () => {
    const r = new Rng(7);
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      seen.add(r.int(1, 3));
    }
    expect([...seen].sort()).toEqual([1, 2, 3]);
  });

  it('weighted() never picks zero-weight items', () => {
    const r = new Rng(99);
    for (let i = 0; i < 500; i++) {
      expect(r.weighted(['a', 'b', 'c'], (x) => (x === 'b' ? 0 : 1))).not.toBe('b');
    }
    expect(r.weighted(['a'], () => 0)).toBeUndefined();
  });

  it('forks are independent of each other', () => {
    const root = new Rng(5);
    const a = root.fork('draft');
    const b = root.fork('spawn');
    expect(a.next()).not.toBe(b.next());
  });
});

describe('seed codes', () => {
  it('round-trips', () => {
    for (const s of [0, 1, 42, 123456789, 4294967295]) expect(parseSeedCode(seedToCode(s))).toBe(s >>> 0);
  });

  it('rejects hostile or malformed input', () => {
    for (const bad of ['', ' ', '<script>', 'abc-def', '12345678901', 'ÄÖ', null, undefined, '../../x']) {
      expect(parseSeedCode(bad as string)).toBeNull();
    }
  });

  it('daily seed is stable per UTC day', () => {
    const d1 = new Date(Date.UTC(2026, 8, 24, 1));
    const d2 = new Date(Date.UTC(2026, 8, 24, 23));
    expect(dailyKey(d1)).toBe('2026-09-24');
    expect(dailySeed(d1)).toBe(dailySeed(d2));
    expect(hashString('x')).not.toBe(hashString('y'));
  });
});
