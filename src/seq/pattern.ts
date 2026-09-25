import { INSTRUMENTS, MAX_LEVEL, type InstrumentId } from './instruments';

export const STEPS = 16;
export const MAX_TRACKS = 8;
export const MAX_RATCHET = 4;

export interface Track {
  inst: InstrumentId;
  notes: boolean[];
  /** Notes owned but not placed on the grid. */
  spare: number;
  level: number;
  evolved: boolean;
}

export interface StepFx {
  accent: boolean;
  /** 1 = normal; 2..4 = step fires that many times. */
  ratchet: number;
  echo: boolean;
}

export type FxKind = 'accent' | 'ratchet' | 'echo';

export class Pattern {
  readonly tracks: Track[] = [];
  readonly fx: StepFx[] = Array.from({ length: STEPS }, () => ({ accent: false, ratchet: 1, echo: false }));
  /** Bumped on every edit so derived data (grooves, UI) can cache. */
  version = 0;

  has(inst: InstrumentId): boolean {
    return this.tracks.some((t) => t.inst === inst);
  }

  track(inst: InstrumentId): Track | undefined {
    return this.tracks.find((t) => t.inst === inst);
  }

  addTrack(inst: InstrumentId): Track | undefined {
    if (this.has(inst) || this.tracks.length >= MAX_TRACKS) return undefined;
    const notes = new Array<boolean>(STEPS).fill(false);
    for (const s of INSTRUMENTS[inst].defaultNotes) notes[s] = true;
    const t: Track = { inst, notes, spare: 0, level: 1, evolved: false };
    this.tracks.push(t);
    this.version++;
    return t;
  }

  noteCount(t: Track): number {
    let n = 0;
    for (const b of t.notes) if (b) n++;
    return n;
  }

  totalNotes(): number {
    let n = 0;
    for (const t of this.tracks) n += this.noteCount(t);
    return n;
  }

  tracksOnStep(step: number): number {
    let n = 0;
    for (const t of this.tracks) if (t.notes[step]) n++;
    return n;
  }

  addSpare(inst: InstrumentId, n: number): void {
    const t = this.track(inst);
    if (!t) return;
    t.spare += n;
    this.version++;
  }

  /**
   * Toggle a cell: a lit note is lifted back into the spare pool; an empty cell consumes a
   * spare note. Returns what happened so the UI can play the right sound.
   */
  toggle(trackIndex: number, step: number): 'placed' | 'lifted' | 'none' {
    const t = this.tracks[trackIndex];
    if (!t || step < 0 || step >= STEPS) return 'none';
    if (t.notes[step]) {
      // never leave a track completely silent
      if (this.noteCount(t) <= 1) return 'none';
      t.notes[step] = false;
      t.spare++;
      this.version++;
      return 'lifted';
    }
    if (t.spare <= 0) return 'none';
    t.notes[step] = true;
    t.spare--;
    this.version++;
    return 'placed';
  }

  /** Place all spare notes of a track on the emptiest-looking useful steps. */
  autoPlace(trackIndex: number): number {
    const t = this.tracks[trackIndex];
    if (!t) return 0;
    let placed = 0;
    // preference: steps other tracks already hit (harmony), then on-beat, then off-beat
    const order = [...Array(STEPS).keys()].sort((a, b) => this.placeScore(b) - this.placeScore(a));
    for (const s of order) {
      if (t.spare <= 0) break;
      if (!t.notes[s]) {
        t.notes[s] = true;
        t.spare--;
        placed++;
      }
    }
    if (placed) this.version++;
    return placed;
  }

  private placeScore(step: number): number {
    const onBeat = step % 4 === 0 ? 2 : step % 2 === 0 ? 1 : 0;
    return this.tracksOnStep(step) * 1.5 + onBeat + (this.fx[step]!.accent ? 2 : 0) + (this.fx[step]!.ratchet - 1);
  }

  levelUp(inst: InstrumentId): boolean {
    const t = this.track(inst);
    if (!t || t.level >= MAX_LEVEL) return false;
    t.level++;
    this.version++;
    return true;
  }

  applyFx(step: number, kind: FxKind): boolean {
    const f = this.fx[step];
    if (!f) return false;
    if (kind === 'accent') {
      if (f.accent) return false;
      f.accent = true;
    } else if (kind === 'echo') {
      if (f.echo) return false;
      f.echo = true;
    } else {
      if (f.ratchet >= MAX_RATCHET) return false;
      f.ratchet++;
    }
    this.version++;
    return true;
  }

  canApplyFx(step: number, kind: FxKind): boolean {
    const f = this.fx[step];
    if (!f) return false;
    if (kind === 'accent') return !f.accent;
    if (kind === 'echo') return !f.echo;
    return f.ratchet < MAX_RATCHET;
  }

  fxCount(kind: FxKind): number {
    let n = 0;
    for (const f of this.fx) {
      if (kind === 'accent' && f.accent) n++;
      if (kind === 'echo' && f.echo) n++;
      if (kind === 'ratchet' && f.ratchet > 1) n++;
    }
    return n;
  }

  /** Compact, shareable string: "kick:1010...;snare:..." — validated on parse. */
  serialize(): string {
    return this.tracks
      .map((t) => `${t.inst}.${t.level}${t.evolved ? 'e' : ''}.${t.notes.map((b) => (b ? '1' : '0')).join('')}`)
      .join('|');
  }
}
