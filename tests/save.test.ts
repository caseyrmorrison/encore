import { describe, expect, it } from 'vitest';
import { defaultSave, loadSave, sanitize, STARTER_UNLOCKS, writeSave } from '../src/core/save';

describe('save sanitising', () => {
  it('returns defaults for garbage', () => {
    for (const bad of [null, 42, 'x', [], { fans: 'lots' }]) {
      const s = sanitize(bad);
      expect(s.fans).toBe(0);
      expect(s.unlocked).toEqual(expect.arrayContaining(STARTER_UNLOCKS));
    }
  });

  it('clamps numbers and whitelists ids', () => {
    const s = sanitize({
      fans: 1e99,
      unlocked: ['gong', '<img onerror=alert(1)>', 'gong', '__proto__'],
      grooves: ['four', 'evil'],
      settings: { master: 5, quality: 'ultra', autoAim: 'yes' },
      dailyBest: { '2026-09-24': 10, 'not-a-date': 5, '2026-09-25': Infinity },
    });
    expect(s.fans).toBeLessThanOrEqual(1e15);
    expect(s.unlocked).toContain('gong');
    expect(s.unlocked).not.toContain('<img onerror=alert(1)>');
    expect(s.unlocked.filter((u) => u === 'gong')).toHaveLength(1);
    expect(s.grooves).toEqual(['four']);
    expect(s.settings.master).toBe(1);
    expect(s.settings.quality).toBe('high');
    expect(s.settings.autoAim).toBe(false);
    expect(Object.keys(s.dailyBest)).toEqual(['2026-09-24']);
  });

  it('survives prototype pollution attempts', () => {
    const s = sanitize(JSON.parse('{"__proto__": {"polluted": true}, "fans": 5}'));
    expect(s.fans).toBe(5);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('round-trips through storage and ignores oversized blobs', () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    const s = defaultSave();
    s.fans = 77;
    writeSave(s, storage);
    expect(loadSave(storage).fans).toBe(77);
    store.set('encore.save.v1', 'x'.repeat(300_000));
    expect(loadSave(storage).fans).toBe(0);
    store.set('encore.save.v1', '{not json');
    expect(loadSave(storage).fans).toBe(0);
  });
});
