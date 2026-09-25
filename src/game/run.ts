import { Rng } from '../core/rng';
import { emptyPedals, type PedalId } from '../seq/cards';
import { detectGrooves, type GrooveId, type GrooveState } from '../seq/grooves';
import type { InstrumentId } from '../seq/instruments';
import { Pattern, STEPS } from '../seq/pattern';
import { SETLISTS, type SetlistId } from '../seq/setlists';

export interface RunStats {
  dmgMult: number;
  critChance: number;
  critMult: number;
  projSpeed: number;
  range: number;
  area: number;
  pickupRadius: number;
  moveSpeed: number;
  dashDist: number;
  perfectWindow: number;
  perfectDmg: number;
  hypeGain: number;
  dropBars: number;
  pierce: number;
  harmonyPer: number;
  looperChance: number;
  tipsMult: number;
  maxHp: number;
  bpmBonus: number;
}

export function computeStats(pedals: Record<PedalId, number>, grooves: GrooveState, loudness: number): RunStats {
  const g = grooves.active;
  return {
    dmgMult:
      (1 + pedals.overdrive * 0.2) *
      (g.has('breakbeat') ? 1.2 : 1) *
      (g.has('wall') ? 1.4 : 1) *
      (g.has('minimal') ? 1.8 : 1),
    critChance: 0.05 + pedals.fuzz * 0.08,
    critMult: pedals.fuzz > 0 ? 2.5 : 2,
    projSpeed: 1 + pedals.wah * 0.25,
    range: 1 + pedals.wah * 0.15,
    area: 1 + pedals.ampstack * 0.2,
    pickupRadius: 3.2 * (1 + pedals.groupies * 0.45),
    moveSpeed: 9.5 * (1 + pedals.energy * 0.1) * (g.has('breakbeat') ? 1.12 : 1),
    dashDist: 1 + pedals.stagedive * 0.3,
    perfectWindow: 0.085 + pedals.metronome * 0.045,
    perfectDmg: 1 + pedals.stagedive,
    hypeGain: 1 + pedals.hypeman * 0.35,
    dropBars: 2 + pedals.hypeman,
    pierce: pedals.sustain,
    harmonyPer: 0.18 + pedals.harmonizer * 0.12,
    looperChance: pedals.looper * 0.12,
    tipsMult: 1 + pedals.goldchain * 0.6,
    maxHp: 120 + pedals.roadie * 25 - loudness * 6,
    bpmBonus: pedals.clicktrack * 8,
  };
}

export type RunMode = 'standard' | 'daily';

/** Everything that belongs to one run. */
export class Run {
  readonly seed: number;
  readonly mode: RunMode;
  readonly draftRng: Rng;
  readonly spawnRng: Rng;
  readonly lootRng: Rng;
  readonly pattern = new Pattern();
  readonly pedals = emptyPedals();
  grooves: GrooveState = { active: new Set(), claveTracks: new Set(), polyTracks: new Set() };
  readonly discovered = new Set<GrooveId>();
  readonly evolvedNow = new Set<InstrumentId>();
  stats: RunStats;
  venueIndex = 0;
  loop = 0;
  level = 1;
  xp = 0;
  hp = 100;
  hype = 0;
  tips = 0;
  kills = 0;
  damage = 0;
  bestHit = 0;
  time = 0;
  setTime = 0;
  perfects = 0;
  drops = 0;
  rerolls = 2;
  revives = 0;
  bestStreak = 0;
  pendingDrafts = 0;
  pendingGold = 0;
  loudness: number;
  readonly setlist: SetlistId;
  private lastPatternVersion = -1;

  constructor(seed: number, mode: RunMode, loudness: number, setlist: SetlistId = 'garage') {
    this.seed = seed;
    this.mode = mode;
    this.loudness = loudness;
    const root = new Rng(seed);
    this.draftRng = root.fork('draft');
    this.spawnRng = root.fork('spawn');
    this.lootRng = root.fork('loot');
    this.setlist = setlist;
    for (const t of SETLISTS[setlist].tracks) {
      const tr = this.pattern.addTrack(t.inst);
      if (tr && t.notes) {
        tr.notes = new Array<boolean>(STEPS).fill(false);
        for (const n of t.notes) tr.notes[n] = true;
      }
    }
    this.stats = computeStats(this.pedals, this.grooves, loudness);
    this.stats.maxHp += SETLISTS[setlist].maxHpMod;
    this.stats.hypeGain *= SETLISTS[setlist].hypeMod;
    this.hp = this.stats.maxHp;
  }

  get xpToNext(): number {
    const l = this.level;
    // L1→2 in ~10s, a draft every ~12-15s through the Basement, ~L35 by the final headliner
    return Math.round(5 + l * 5 + l * l * 0.6);
  }

  /** Recompute grooves & stats if the pattern or pedals changed. Returns newly discovered grooves. */
  refresh(force = false): GrooveId[] {
    const fresh: GrooveId[] = [];
    if (force || this.pattern.version !== this.lastPatternVersion) {
      this.lastPatternVersion = this.pattern.version;
      this.grooves = detectGrooves(this.pattern);
      for (const g of this.grooves.active) {
        if (!this.discovered.has(g)) {
          this.discovered.add(g);
          fresh.push(g);
        }
      }
    }
    const prevMax = this.stats.maxHp;
    this.stats = computeStats(this.pedals, this.grooves, this.loudness);
    this.stats.maxHp += SETLISTS[this.setlist].maxHpMod;
    this.stats.hypeGain *= SETLISTS[this.setlist].hypeMod;
    if (this.stats.maxHp > prevMax) this.hp += this.stats.maxHp - prevMax;
    this.hp = Math.min(this.hp, this.stats.maxHp);
    return fresh;
  }
}
