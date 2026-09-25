import type { Rng } from '../core/rng';
import type { GrooveState } from './grooves';
import { INSTRUMENTS, INSTRUMENT_IDS, MAX_LEVEL, type InstrumentId, type Rarity } from './instruments';
import { MAX_TRACKS, type FxKind, type Pattern } from './pattern';

export type PedalId =
  | 'overdrive'
  | 'fuzz'
  | 'metronome'
  | 'clicktrack'
  | 'wah'
  | 'looper'
  | 'groupies'
  | 'roadie'
  | 'energy'
  | 'stagedive'
  | 'hypeman'
  | 'ampstack'
  | 'encore'
  | 'goldchain'
  | 'harmonizer'
  | 'sustain';

export interface PedalDef {
  id: PedalId;
  name: string;
  blurb: string;
  rarity: Rarity;
  max: number;
  color: number;
}

export const PEDALS: Record<PedalId, PedalDef> = {
  overdrive: { id: 'overdrive', name: 'Overdrive', blurb: '+20% damage to everything.', rarity: 'common', max: 6, color: 0xff7a2e },
  fuzz: { id: 'fuzz', name: 'Fuzz Face', blurb: '+8% crit chance. Crits deal ×2.5.', rarity: 'common', max: 5, color: 0xff3b5c },
  metronome: {
    id: 'metronome',
    name: 'Metronome',
    blurb: 'Perfect-dash window +45ms. Perfects refund a dash.',
    rarity: 'common',
    max: 2,
    color: 0xe8e8e8,
  },
  clicktrack: {
    id: 'clicktrack',
    name: 'Click Track',
    blurb: '+8 BPM. Every track plays faster. Stacks.',
    rarity: 'rare',
    max: 4,
    color: 0x2ee6ff,
  },
  wah: { id: 'wah', name: 'Wah-Wah', blurb: '+25% projectile speed and +15% range.', rarity: 'common', max: 4, color: 0x8cff5a },
  looper: {
    id: 'looper',
    name: 'Looper',
    blurb: '12% chance any note echoes one beat later.',
    rarity: 'rare',
    max: 4,
    color: 0x9fb8ff,
  },
  groupies: { id: 'groupies', name: 'Groupies', blurb: '+45% pickup radius.', rarity: 'common', max: 4, color: 0xff5ec8 },
  roadie: {
    id: 'roadie',
    name: 'Roadie Case',
    blurb: '+25 max health and heal 40.',
    rarity: 'common',
    max: 6,
    color: 0x9aa3b5,
  },
  energy: { id: 'energy', name: 'Energy Drink', blurb: '+10% move speed.', rarity: 'common', max: 4, color: 0x3dffc5 },
  stagedive: {
    id: 'stagedive',
    name: 'Stage Dive',
    blurb: 'Dash travels further. Perfect dashes hit ×2 harder.',
    rarity: 'rare',
    max: 3,
    color: 0xffe14d,
  },
  hypeman: { id: 'hypeman', name: 'Hype Man', blurb: '+35% hype gain. Drops last 1 bar longer.', rarity: 'rare', max: 3, color: 0xffb13d },
  ampstack: { id: 'ampstack', name: 'Amp Stack', blurb: '+20% area on every blast and wave.', rarity: 'common', max: 5, color: 0x2a2a2a },
  encore: {
    id: 'encore',
    name: 'Encore Token',
    blurb: 'When you die, the crowd screams for more. Revive once.',
    rarity: 'epic',
    max: 2,
    color: 0xffd36b,
  },
  goldchain: { id: 'goldchain', name: 'Gold Chain', blurb: '+60% tips from everything.', rarity: 'common', max: 3, color: 0xffc53d },
  harmonizer: {
    id: 'harmonizer',
    name: 'Harmonizer',
    blurb: 'Chord bonus +12% per extra track on a step.',
    rarity: 'rare',
    max: 4,
    color: 0xb04dff,
  },
  sustain: { id: 'sustain', name: 'Sustain', blurb: '+1 pierce on every projectile.', rarity: 'rare', max: 3, color: 0x4dc3ff },
};

export const PEDAL_IDS = Object.keys(PEDALS) as PedalId[];

export const FX_INFO: Record<FxKind, { name: string; blurb: string; rarity: Rarity; color: string }> = {
  accent: {
    name: 'Accent',
    blurb: 'Pick a step. Every note on it hits ×2 harder and bigger.',
    rarity: 'rare',
    color: '#ff3b5c',
  },
  ratchet: {
    name: 'Ratchet',
    blurb: 'Pick a step. It fires one extra time (roll). Stacks to ×4.',
    rarity: 'epic',
    color: '#ffe14d',
  },
  echo: {
    name: 'Echo',
    blurb: 'Pick a step. Its notes repeat 3 steps later at 60%.',
    rarity: 'rare',
    color: '#2ee6ff',
  },
};

export type Card =
  | { kind: 'instrument'; inst: InstrumentId }
  | { kind: 'notes'; inst: InstrumentId; n: number }
  | { kind: 'level'; inst: InstrumentId }
  | { kind: 'fx'; fx: FxKind }
  | { kind: 'pedal'; pedal: PedalId }
  | { kind: 'evolve'; inst: InstrumentId }
  | { kind: 'heal' }
  | { kind: 'tips'; amount: number };

export interface DraftContext {
  pattern: Pattern;
  pedals: Record<PedalId, number>;
  grooves: GrooveState;
  bpm: number;
  unlocked: ReadonlySet<InstrumentId>;
  /** 0..1, raised by Gold Records and luck. */
  luck: number;
}

export function cardRarity(c: Card): Rarity {
  switch (c.kind) {
    case 'instrument':
      return INSTRUMENTS[c.inst].rarity;
    case 'notes':
      return c.n >= 3 ? 'rare' : 'common';
    case 'level':
      return 'common';
    case 'fx':
      return FX_INFO[c.fx].rarity;
    case 'pedal':
      return PEDALS[c.pedal].rarity;
    case 'evolve':
      return 'legendary';
    case 'heal':
    case 'tips':
      return 'common';
  }
}

export function canEvolve(inst: InstrumentId, ctx: DraftContext): boolean {
  const t = ctx.pattern.track(inst);
  if (!t || t.evolved || t.level < MAX_LEVEL) return false;
  const p = ctx.pattern;
  switch (inst) {
    case 'kick':
      return ctx.pedals.ampstack > 0;
    case 'snare':
      return ctx.grooves.active.has('backbeat');
    case 'hat':
      return p.fxCount('ratchet') >= 2;
    case 'clap':
      return ctx.grooves.active.has('disco');
    case 'bass':
      return ctx.grooves.active.has('halftime');
    case 'lead':
      return p.fxCount('echo') >= 1;
    case 'pad':
      return ctx.pedals.roadie > 0;
    case 'crash':
      return p.fx[0]!.accent;
    case 'tom':
      return ctx.pedals.sustain > 0;
    case 'cowbell':
      return ctx.bpm >= 130;
    case 'scratch':
      return ctx.pedals.wah > 0;
    case 'organ':
      return p.has('pad');
    case 'gong':
      return ctx.grooves.active.has('downbeat');
  }
}

const RARITY_WEIGHT: Record<Rarity, number> = { common: 1, rare: 0.55, epic: 0.22, legendary: 0.07 };

function cardKey(c: Card): string {
  switch (c.kind) {
    case 'instrument':
    case 'level':
    case 'evolve':
      return `${c.kind}:${c.inst}`;
    case 'notes':
      return `notes:${c.inst}`;
    case 'fx':
      return `fx:${c.fx}`;
    case 'pedal':
      return `pedal:${c.pedal}`;
    default:
      return c.kind;
  }
}

/** Build the full weighted pool of legal offers for this moment of the run. */
export function buildPool(ctx: DraftContext, rng: Rng): { card: Card; w: number }[] {
  const p = ctx.pattern;
  const pool: { card: Card; w: number }[] = [];
  const luckBoost = (r: Rarity): number => RARITY_WEIGHT[r] * (r === 'common' ? 1 : 1 + ctx.luck * 2);

  if (p.tracks.length < MAX_TRACKS) {
    for (const id of INSTRUMENT_IDS) {
      if (p.has(id) || !ctx.unlocked.has(id)) continue;
      // new tracks are exciting early, less so once the machine is full
      const w = luckBoost(INSTRUMENTS[id].rarity) * (p.tracks.length < 4 ? 1.1 : 0.55);
      pool.push({ card: { kind: 'instrument', inst: id }, w });
    }
  }
  for (const t of p.tracks) {
    const n = rng.chance(0.25 + ctx.luck * 0.3) ? 3 : 2;
    pool.push({ card: { kind: 'notes', inst: t.inst, n }, w: 1.1 * luckBoost(n >= 3 ? 'rare' : 'common') });
    if (t.level < MAX_LEVEL) pool.push({ card: { kind: 'level', inst: t.inst }, w: 1.0 });
    if (canEvolve(t.inst, ctx)) pool.push({ card: { kind: 'evolve', inst: t.inst }, w: 50 });
  }
  for (const fx of ['accent', 'ratchet', 'echo'] as const) {
    pool.push({ card: { kind: 'fx', fx }, w: luckBoost(FX_INFO[fx].rarity) * 0.9 });
  }
  for (const id of Object.keys(PEDALS) as PedalId[]) {
    const def = PEDALS[id];
    if (ctx.pedals[id] >= def.max) continue;
    pool.push({ card: { kind: 'pedal', pedal: id }, w: luckBoost(def.rarity) * 0.55 });
  }
  return pool;
}

/** Draw `count` distinct offers. Evolutions, when available, are always offered. */
export function drawOffers(ctx: DraftContext, rng: Rng, count = 3, exclude: ReadonlySet<string> = new Set()): Card[] {
  const pool = buildPool(ctx, rng);
  const offers: Card[] = [];
  const used = new Set<string>(exclude);
  const evo = pool.find((e) => e.card.kind === 'evolve');
  if (evo) {
    offers.push(evo.card);
    used.add(cardKey(evo.card));
  }
  let guard = 0;
  while (offers.length < count && guard++ < 200) {
    const pick = rng.weighted(pool, (e) => (used.has(cardKey(e.card)) ? 0 : e.w));
    if (!pick) break;
    used.add(cardKey(pick.card));
    offers.push(pick.card);
  }
  // filler so there are always choices, even with a maxed build
  while (offers.length < count) {
    offers.push(offers.some((c) => c.kind === 'heal') ? { kind: 'tips', amount: 25 } : { kind: 'heal' });
  }
  return offers;
}

/** Offers for a Gold Record: rare-or-better only. */
export function drawGoldOffers(ctx: DraftContext, rng: Rng, count = 3, exclude: ReadonlySet<string> = new Set()): Card[] {
  const boosted: DraftContext = { ...ctx, luck: Math.min(1, ctx.luck + 0.6) };
  const pool = buildPool(boosted, rng).filter((e) => cardRarity(e.card) !== 'common' || e.card.kind === 'level');
  const offers: Card[] = [];
  const used = new Set<string>(exclude);
  let guard = 0;
  while (offers.length < count && guard++ < 200) {
    const pick = rng.weighted(pool, (e) => (used.has(cardKey(e.card)) ? 0 : e.w));
    if (!pick) break;
    used.add(cardKey(pick.card));
    offers.push(pick.card);
  }
  while (offers.length < count) offers.push({ kind: 'tips', amount: 60 });
  return offers;
}

/** Backstage stock: three regular cards and one rare-or-better, never the same card twice. */
export function drawShopStock(ctx: DraftContext, rng: Rng): Card[] {
  const base = drawOffers(ctx, rng, 3);
  return [...base, ...drawGoldOffers(ctx, rng, 1, new Set(base.map(cardKey)))];
}

export function emptyPedals(): Record<PedalId, number> {
  const r = {} as Record<PedalId, number>;
  for (const id of PEDAL_IDS) r[id] = 0;
  return r;
}
