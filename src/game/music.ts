import type { AudioEngine } from '../audio/engine';
import { chordTone, pentatonicNote, PROGRESSIONS, type Chord, type ProgressionId } from '../audio/theory';
import type { StepEvent, Transport } from '../audio/transport';
import * as V from '../audio/voices';
import type { InstrumentId } from '../seq/instruments';
import type { Pattern } from '../seq/pattern';

/** One audible note of one track. Gameplay fires the matching weapon when it is heard. */
export interface NoteEvent {
  inst: InstrumentId;
  time: number;
  step: number;
  accent: boolean;
  /** echo / looper repeats: weaker, smaller */
  ghost: boolean;
  /** tracks sounding on this step (chord bonus) */
  harmony: number;
}

export type Backing = ProgressionId;

/**
 * Turns the live pattern into sound. Schedules every note ahead of time on the audio clock
 * and queues a matching NoteEvent so the weapon fires exactly when the note is heard.
 */
export class Music {
  pattern: Pattern | null = null;
  backing: Backing = 'menu';
  /** Bar index (inclusive) until which the DROP is active. */
  dropUntil = -1;
  /** Bar index at which a drop has been called (riser plays the bar before). */
  dropAtBar = -1;
  looperChance = 0;
  /** Weapons & per-note sounds silenced (e.g. the Hush boss's silence phase). */
  hushed = false;
  /** 0..1 crowd intensity for the venue ambience. */
  crowd = 0;
  readonly queue: NoteEvent[] = [];
  private leadIdx = 0;
  private plinksThisStep = 0;
  private plinkStepTime = 0;
  private streakDegree = 0;

  constructor(
    private readonly eng: AudioEngine,
    private readonly transport: Transport,
  ) {
    transport.onSchedule((ev) => this.onStep(ev));
  }

  chordAt(bar: number): Chord {
    const prog = PROGRESSIONS[this.backing];
    return prog.chords[((bar % prog.chords.length) + prog.chords.length) % prog.chords.length]!;
  }

  get currentChord(): Chord {
    return this.chordAt(this.transport.bar);
  }

  isDrop(bar: number): boolean {
    return bar <= this.dropUntil && bar >= this.dropAtBar;
  }

  private onStep(ev: StepEvent): void {
    const chord = this.chordAt(ev.bar);
    this.playBacking(ev, chord);
    const p = this.pattern;
    if (!p) return;
    const fx = p.fx[ev.step]!;
    const harmony = p.tracksOnStep(ev.step);
    const drop = this.isDrop(ev.bar);
    const ratchet = fx.ratchet * (drop ? 2 : 1);

    for (const t of p.tracks) {
      if (!t.notes[ev.step]) continue;
      for (let k = 0; k < ratchet; k++) {
        const time = ev.time + (k * ev.dur) / ratchet;
        const vel = (fx.accent ? 1 : 0.78) * (k === 0 ? 1 : 0.8);
        this.voice(t.inst, time, vel, chord, ev.dur / ratchet, t.evolved);
        this.queue.push({ inst: t.inst, time, step: ev.step, accent: fx.accent, ghost: false, harmony });
      }
      if (fx.echo) {
        const time = ev.time + ev.dur * 3;
        this.voice(t.inst, time, 0.42, this.chordAt(ev.bar + (ev.step + 3 >= 16 ? 1 : 0)), ev.dur, t.evolved);
        this.queue.push({ inst: t.inst, time, step: ev.step, accent: false, ghost: true, harmony: 1 });
      }
      if (this.looperChance > 0 && Math.random() < this.looperChance) {
        const time = ev.time + ev.dur * 4;
        this.voice(t.inst, time, 0.4, chord, ev.dur, t.evolved);
        this.queue.push({ inst: t.inst, time, step: ev.step, accent: false, ghost: true, harmony: 1 });
      }
    }
    this.queue.sort((a, b) => a.time - b.time);
  }

  /** Pop note events that are audible by `now`. Stale events (after a pause) are dropped. */
  drain(now: number, fn: ((n: NoteEvent) => void) | null): void {
    while (this.queue.length && this.queue[0]!.time <= now) {
      const n = this.queue.shift()!;
      if (fn && now - n.time < 0.3) fn(n);
    }
  }

  private voice(inst: InstrumentId, t: number, vel: number, chord: Chord, dur: number, evolved: boolean): void {
    if (this.hushed) vel *= 0.25;
    const e = this.eng;
    switch (inst) {
      case 'kick':
        V.kick(e, t, vel, evolved);
        break;
      case 'snare':
        V.snare(e, t, vel);
        break;
      case 'hat':
        V.hat(e, t, vel * 0.9, false);
        break;
      case 'clap':
        V.clap(e, t, vel);
        break;
      case 'bass':
        V.bass(e, t, chordTone(chord, 0, -2), Math.max(dur * 1.8, 0.14), vel, evolved ? 6 / (dur * 16) : 0);
        break;
      case 'lead': {
        const n = chordTone(chord, this.leadIdx++ % 7, 1);
        V.lead(e, t, n, vel, Math.min(0.24, dur * 1.6));
        break;
      }
      case 'pad':
        V.pad(
          e,
          t,
          [0, 1, 2, 3].map((k) => chordTone(chord, k, 0)),
          dur * 8,
          vel * 1.4,
          0.6,
        );
        break;
      case 'crash':
        V.crash(e, t, vel);
        break;
      case 'tom':
        V.tom(e, t, vel, -((this.leadIdx++ % 3) * 3));
        break;
      case 'cowbell':
        V.cowbell(e, t, vel);
        break;
      case 'scratch':
        V.scratch(e, t, vel, Math.min(0.2, dur * 1.5));
        break;
      case 'organ':
        V.organ(
          e,
          t,
          [0, 1, 2].map((k) => chordTone(chord, k, 0)),
          dur * 4,
          vel,
        );
        break;
      case 'gong':
        V.gong(e, t, vel);
        break;
    }
  }

  private playBacking(ev: StepEvent, chord: Chord): void {
    const e = this.eng;
    const t = ev.time;
    const barDur = ev.dur * 16;
    const drop = this.isDrop(ev.bar);
    // riser into a called drop
    if (this.dropAtBar === ev.bar + 1 && ev.step === 0) V.riser(e, t, barDur - 0.02);
    if (drop && ev.step === 0) {
      V.crash(e, t, 0.9);
      if (ev.bar === this.dropAtBar) V.impact(e, t, 1);
    }
    if (drop) {
      // the drop adds a driving sub and open hats
      if (ev.step % 4 === 2) V.hat(e, t, 0.5, true);
      if (ev.step % 2 === 0) V.bass(e, t, chordTone(chord, 0, -2), ev.dur * 1.5, 0.5, 0);
    }

    switch (this.backing) {
      case 'menu': {
        // lo-fi lounge loop while you browse
        if (ev.step === 0) V.pad(e, t, [0, 1, 2, 3].map((k) => chordTone(chord, k, 0)), barDur * 0.95, 0.55, 0.25);
        if (ev.step === 0 || ev.step === 7 || ev.step === 10) V.kick(e, t, 0.45);
        if (ev.step === 4 || ev.step === 12) V.snare(e, t, 0.25);
        if (ev.step % 2 === 0) V.hat(e, t + (ev.step % 4 === 2 ? ev.dur * 0.18 : 0), 0.22);
        if (ev.step === 0 || ev.step === 6 || ev.step === 11) V.bell(e, t, chordTone(chord, (ev.step / 3) | 0, 1), 0.35, e.bus.music, 0.9);
        break;
      }
      case 'basement':
        if (ev.step === 0) V.pad(e, t, [0, 1, 2].map((k) => chordTone(chord, k, 0)), barDur * 0.9, 0.5, 0.2);
        break;
      case 'cathedral':
        if (ev.step === 0) V.organ(e, t, [0, 1, 2].map((k) => chordTone(chord, k, -1)), barDur * 0.95, 0.35);
        if (ev.step === 0 && ev.bar % 2 === 0) V.choir(e, t, [chordTone(chord, 0, 1), chordTone(chord, 2, 1)], barDur * 1.8, 0.5);
        break;
      case 'mainstage':
        if (ev.step === 0) V.pad(e, t, [0, 1, 2, 3].map((k) => chordTone(chord, k, 0)), barDur * 0.95, 0.65, 0.7);
        if (ev.step === 0 && ev.bar % 4 === 0) V.crowdCheer(e, t, 0.25 + this.crowd * 0.4, 3);
        break;
      case 'boss':
        if (ev.step === 0) V.pad(e, t, [0, 1, 2].map((k) => chordTone(chord, k, -1)), barDur, 0.6, 0.35);
        if (ev.step % 2 === 0) V.bass(e, t, chordTone(chord, 0, -2), ev.dur * 0.9, 0.32, 0);
        if (ev.step === 0 && ev.bar % 2 === 0) V.choir(e, t, [chordTone(chord, 0, 0), chordTone(chord, 1, 0)], barDur * 2, 0.45);
        break;
    }
  }

  /** Quantised, in-key note when an enemy dies. Streak raises the pitch like a scale. */
  plink(streak: number): void {
    const t = this.transport.upcoming;
    if (Math.abs(t - this.plinkStepTime) > 1e-4) {
      this.plinkStepTime = t;
      this.plinksThisStep = 0;
    }
    if (this.plinksThisStep++ >= 3) return;
    const root = PROGRESSIONS[this.backing].pentatonicRoot;
    this.streakDegree = Math.min(18, Math.floor(streak / 3));
    const deg = this.streakDegree + this.plinksThisStep;
    V.bell(this.eng, t, pentatonicNote(root + 12, deg), 0.55, undefined, 0.45);
  }

  /** Ascending pickup sparkle, quantised to 32nds for a musical shimmer. */
  pickup(chain: number): void {
    const root = PROGRESSIONS[this.backing].pentatonicRoot;
    const t = this.eng.now + 0.005;
    V.bell(this.eng, t, pentatonicNote(root + 24, chain % 15), 0.28, undefined, 0.18);
  }

  fanfare(big = false): void {
    const e = this.eng;
    const chord = this.currentChord;
    const t = this.transport.upcoming;
    const notes = [0, 1, 2, 3, 4, 5].map((k) => chordTone(chord, k, 1));
    notes.forEach((n, i) => V.bell(e, t + i * 0.055, n, 0.7, e.bus.sfx, 0.7));
    V.whoosh(e, t - 0.2, 0.8, true, 0.3);
    if (big) {
      V.choir(e, t, [chordTone(chord, 0, 0), chordTone(chord, 1, 0), chordTone(chord, 2, 0)], 1.6, 0.9);
      V.crash(e, t, 0.7);
      V.crowdCheer(e, t, 0.8, 2.4);
    }
  }
}
