import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { canEvolve, drawGoldOffers, drawOffers, drawShopStock, emptyPedals, type DraftContext } from '../src/seq/cards';
import { detectGrooves } from '../src/seq/grooves';
import { INSTRUMENT_IDS } from '../src/seq/instruments';
import { Pattern, STEPS } from '../src/seq/pattern';

function setNotes(p: Pattern, inst: Parameters<Pattern['addTrack']>[0], steps: number[]): void {
  const t = p.track(inst) ?? p.addTrack(inst)!;
  t.notes = new Array(STEPS).fill(false);
  for (const s of steps) t.notes[s] = true;
  p.version++;
}

describe('Pattern', () => {
  it('adds tracks with default notes and caps duplicates', () => {
    const p = new Pattern();
    expect(p.addTrack('kick')).toBeDefined();
    expect(p.addTrack('kick')).toBeUndefined();
    expect(p.noteCount(p.track('kick')!)).toBe(2);
  });

  it('toggle moves notes through the spare pool and never empties a track', () => {
    const p = new Pattern();
    p.addTrack('kick'); // steps 0, 8
    expect(p.toggle(0, 0)).toBe('lifted');
    expect(p.track('kick')!.spare).toBe(1);
    expect(p.toggle(0, 8)).toBe('none'); // last note stays
    expect(p.toggle(0, 3)).toBe('placed');
    expect(p.toggle(0, 5)).toBe('none'); // no spare left
  });

  it('autoPlace uses every spare note', () => {
    const p = new Pattern();
    p.addTrack('snare');
    p.addSpare('snare', 3);
    expect(p.autoPlace(0)).toBe(3);
    expect(p.track('snare')!.spare).toBe(0);
    expect(p.noteCount(p.track('snare')!)).toBe(5);
  });

  it('step fx respect limits', () => {
    const p = new Pattern();
    expect(p.applyFx(0, 'accent')).toBe(true);
    expect(p.applyFx(0, 'accent')).toBe(false);
    for (let i = 0; i < 3; i++) expect(p.applyFx(4, 'ratchet')).toBe(true);
    expect(p.applyFx(4, 'ratchet')).toBe(false);
    expect(p.fxCount('ratchet')).toBe(1);
  });
});

describe('grooves', () => {
  it('recognises four on the floor and backbeat', () => {
    const p = new Pattern();
    setNotes(p, 'kick', [0, 4, 8, 12]);
    setNotes(p, 'snare', [4, 12]);
    const g = detectGrooves(p);
    expect(g.active.has('four')).toBe(true);
    expect(g.active.has('backbeat')).toBe(true);
    expect(g.active.has('breakbeat')).toBe(false);
  });

  it('recognises breakbeat, half-time, clave, polyrhythm', () => {
    const p = new Pattern();
    setNotes(p, 'kick', [0, 10]);
    setNotes(p, 'snare', [4, 12]);
    expect(detectGrooves(p).active.has('breakbeat')).toBe(true);

    const q = new Pattern();
    setNotes(q, 'snare', [8]);
    q.addTrack('bass');
    expect(detectGrooves(q).active.has('halftime')).toBe(true);

    const c = new Pattern();
    setNotes(c, 'cowbell', [0, 3, 6, 10, 12]);
    const gc = detectGrooves(c);
    expect(gc.active.has('clave')).toBe(true);
    expect(gc.claveTracks.has('cowbell')).toBe(true);

    const r = new Pattern();
    setNotes(r, 'hat', [0, 3, 6, 9, 12, 15]);
    expect(detectGrooves(r).polyTracks.has('hat')).toBe(true);
  });

  it('minimal requires 4+ tracks with no shared steps', () => {
    const p = new Pattern();
    setNotes(p, 'kick', [0]);
    setNotes(p, 'snare', [4]);
    setNotes(p, 'hat', [8]);
    setNotes(p, 'clap', [12]);
    expect(detectGrooves(p).active.has('minimal')).toBe(true);
    setNotes(p, 'clap', [0]);
    expect(detectGrooves(p).active.has('minimal')).toBe(false);
  });
});

describe('draft', () => {
  const ctx = (p: Pattern): DraftContext => ({
    pattern: p,
    pedals: emptyPedals(),
    grooves: detectGrooves(p),
    bpm: 112,
    unlocked: new Set(INSTRUMENT_IDS),
    luck: 0,
  });

  it('always offers 3 distinct cards', () => {
    const p = new Pattern();
    p.addTrack('kick');
    p.addTrack('snare');
    const rng = new Rng(3);
    for (let i = 0; i < 200; i++) {
      const offers = drawOffers(ctx(p), rng);
      expect(offers).toHaveLength(3);
      expect(new Set(offers.map((o) => JSON.stringify(o))).size).toBe(3);
    }
  });

  it('never offers locked instruments', () => {
    const p = new Pattern();
    p.addTrack('kick');
    const c = { ...ctx(p), unlocked: new Set(['kick', 'snare'] as const) };
    const rng = new Rng(11);
    for (let i = 0; i < 300; i++) {
      for (const o of drawOffers(c, rng)) if (o.kind === 'instrument') expect(o.inst).toBe('snare');
    }
  });

  it('forces an evolution offer when conditions are met', () => {
    const p = new Pattern();
    p.addTrack('snare');
    setNotes(p, 'snare', [4, 12]);
    p.track('snare')!.level = 5;
    const c = ctx(p);
    expect(canEvolve('snare', c)).toBe(true);
    const offers = drawOffers(c, new Rng(1));
    expect(offers[0]).toEqual({ kind: 'evolve', inst: 'snare' });
  });

  it('gold offers skip commons (except upgrades)', () => {
    const p = new Pattern();
    p.addTrack('kick');
    const rng = new Rng(8);
    for (let i = 0; i < 100; i++) {
      for (const o of drawGoldOffers(ctx(p), rng)) {
        if (o.kind === 'pedal') expect(['overdrive', 'fuzz', 'metronome', 'wah', 'groupies', 'roadie', 'energy', 'ampstack', 'goldchain']).not.toContain(o.pedal);
      }
    }
  });

  it('backstage stock never shows the same card twice', () => {
    const p = new Pattern();
    p.addTrack('kick');
    p.addTrack('snare');
    const rng = new Rng(21);
    for (let i = 0; i < 300; i++) {
      const stock = drawShopStock({ ...ctx(p), luck: 0.3 }, rng);
      expect(stock).toHaveLength(4);
      const keys = stock.map((c) => JSON.stringify(c));
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});
