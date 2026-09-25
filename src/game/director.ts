import type { Rng } from '../core/rng';
import type { HushKind } from '../render/hush';

export interface VenueTuning {
  length: number;
  rate0: number;
  rateGrowth: number;
  hp: number;
  /** fraction of the set at which each kind starts appearing */
  unlock: Partial<Record<HushKind, number>>;
  elitesAt: number[];
  ringsAt: number[];
}

export const TUNING: VenueTuning[] = [
  {
    length: 165,
    rate0: 2.2,
    rateGrowth: 1 / 24,
    hp: 1,
    unlock: { mote: 0, static: 0.15, shusher: 0.32, mute: 0.45, damper: 0.62 },
    elitesAt: [0.38, 0.74],
    ringsAt: [0.27, 0.55, 0.86],
  },
  {
    length: 175,
    rate0: 2.6,
    rateGrowth: 1 / 18,
    hp: 2.8,
    unlock: { mote: 0, static: 0, shusher: 0.1, mute: 0.2, damper: 0.3 },
    elitesAt: [0.25, 0.5, 0.75],
    ringsAt: [0.2, 0.45, 0.7, 0.9],
  },
  {
    length: 185,
    rate0: 3.2,
    rateGrowth: 1 / 16,
    hp: 6.2,
    unlock: { mote: 0, static: 0, shusher: 0, mute: 0.05, damper: 0.15 },
    elitesAt: [0.2, 0.4, 0.6, 0.8],
    ringsAt: [0.15, 0.35, 0.55, 0.75, 0.92],
  },
  // festival season: open fields, far more Hush, everything tougher
  {
    length: 180,
    rate0: 5,
    rateGrowth: 1 / 10,
    hp: 24,
    unlock: { mote: 0, static: 0, shusher: 0, mute: 0, damper: 0.1 },
    elitesAt: [0.15, 0.35, 0.55, 0.75, 0.9],
    ringsAt: [0.12, 0.3, 0.5, 0.7, 0.88],
  },
  {
    length: 190,
    rate0: 5.8,
    rateGrowth: 1 / 9,
    hp: 48,
    unlock: { mote: 0, static: 0, shusher: 0, mute: 0, damper: 0.05 },
    elitesAt: [0.12, 0.3, 0.45, 0.6, 0.75, 0.9],
    ringsAt: [0.1, 0.25, 0.4, 0.55, 0.7, 0.85],
  },
  {
    length: 200,
    rate0: 6.6,
    rateGrowth: 1 / 8,
    hp: 90,
    unlock: { mote: 0, static: 0, shusher: 0, mute: 0, damper: 0 },
    elitesAt: [0.1, 0.25, 0.4, 0.55, 0.7, 0.82, 0.92],
    ringsAt: [0.08, 0.22, 0.36, 0.5, 0.64, 0.78, 0.9],
  },
];

const WEIGHTS: Record<HushKind, number> = {
  mote: 10,
  static: 3.2,
  shusher: 2.2,
  mute: 2,
  damper: 0.9,
  bouncer: 0,
  wisp: 0,
};

export interface SpawnOrder {
  kind: HushKind;
  count: number;
  elite: boolean;
  ring: boolean;
}

/**
 * Decides *what* arrives *when*. Spawns are released on quarter-note beats so The Hush
 * literally marches in on the rhythm.
 */
export class Director {
  readonly tuning: VenueTuning;
  private budget = 0;
  private elitesDone = 0;
  private ringsDone = 0;
  bossTriggered = false;
  readonly loopMult: number;

  constructor(
    venueIndex: number,
    readonly loop: number,
    private readonly rng: Rng,
  ) {
    this.tuning = TUNING[Math.min(venueIndex, TUNING.length - 1)]!;
    this.loopMult = Math.pow(3.2, loop);
  }

  get length(): number {
    return this.tuning.length;
  }

  hpMult(setTime: number): number {
    const f = Math.min(1.2, setTime / this.tuning.length);
    return this.tuning.hp * (1 + f * 1.3) * this.loopMult;
  }

  rate(setTime: number): number {
    return (this.tuning.rate0 + setTime * this.tuning.rateGrowth) * (1 + this.loop * 0.35);
  }

  /** Accumulate budget; return spawn orders to release on this beat. */
  onBeat(setTime: number, beatDur: number, alive: number, bossActive: boolean): SpawnOrder[] {
    const out: SpawnOrder[] = [];
    const f = setTime / this.tuning.length;
    if (bossActive) {
      // a trickle of motes keeps boss fights lively and feeds xp
      if (alive < 40 && this.rng.chance(0.25)) out.push({ kind: 'mote', count: 3, elite: false, ring: false });
      return out;
    }
    if (f >= 1) return out;
    this.budget += this.rate(setTime) * beatDur;
    const cap = 360;
    if (alive < cap) {
      while (this.budget >= 1) {
        const kind = this.pickKind(f);
        const group = kind === 'mote' ? Math.min(Math.floor(this.budget), this.rng.int(3, 7)) : 1;
        this.budget -= group;
        out.push({ kind, count: Math.max(1, group), elite: false, ring: false });
      }
    } else {
      this.budget = Math.min(this.budget, 4);
    }
    while (this.elitesDone < this.tuning.elitesAt.length && f >= this.tuning.elitesAt[this.elitesDone]!) {
      this.elitesDone++;
      out.push({ kind: 'bouncer', count: 1, elite: true, ring: false });
      if (this.loop > 0 || this.tuning.hp > 1) {
        out.push({ kind: this.pickKind(f), count: 1, elite: true, ring: false });
      }
    }
    while (this.ringsDone < this.tuning.ringsAt.length && f >= this.tuning.ringsAt[this.ringsDone]!) {
      this.ringsDone++;
      out.push({ kind: 'mote', count: 12 + this.ringsDone * 4 + Math.round(this.tuning.hp * 2), elite: false, ring: true });
    }
    return out;
  }

  private pickKind(f: number): HushKind {
    const kinds = Object.keys(this.tuning.unlock) as HushKind[];
    return (
      this.rng.weighted(kinds, (k) => {
        const at = this.tuning.unlock[k] ?? 2;
        return f >= at ? WEIGHTS[k] : 0;
      }) ?? 'mote'
    );
  }
}
