import { describe, expect, it } from 'vitest';
import { Run } from '../src/game/run';
import { emptyUpgrades } from '../src/seq/upgrades';

describe('Run with merch upgrades', () => {
  it('starts from plain stats without upgrades', () => {
    const r = new Run(1, 'standard', 0);
    expect(r.stats.dmgMult).toBeCloseTo(1);
    expect(r.stats.maxHp).toBe(120);
    expect(r.rerolls).toBe(2);
    expect(r.level).toBe(1);
    expect(r.pendingDrafts).toBe(0);
    expect(r.stats.xpMult).toBe(1);
  });

  it('applies every purchased upgrade', () => {
    const meta = { ...emptyUpgrades(), amp: 2, presence: 3, magnet: 1, session: 2, soundcheck: 1, warmup: 1, tipjar: 2, hype: 1 };
    const r = new Run(1, 'standard', 0, 'garage', meta);
    expect(r.stats.dmgMult).toBeCloseTo(1.16);
    expect(r.stats.maxHp).toBe(165);
    expect(r.hp).toBe(165);
    expect(r.stats.pickupRadius).toBeCloseTo(4.2 * 1.15);
    expect(r.stats.xpMult).toBeCloseTo(1.2);
    expect(r.stats.tipsMult).toBeCloseTo(1.3);
    expect(r.stats.hypeGain).toBeCloseTo(1.1);
    expect(r.rerolls).toBe(3);
    expect(r.level).toBe(2);
    expect(r.pendingDrafts).toBe(1);
  });

  it('keeps upgrades through stat refreshes and does not share the caller object', () => {
    const meta = { ...emptyUpgrades(), amp: 5 };
    const r = new Run(1, 'standard', 0, 'garage', meta);
    meta.amp = 0;
    r.pattern.version++;
    r.refresh(true);
    expect(r.stats.dmgMult).toBeCloseTo(1.4);
  });
});
