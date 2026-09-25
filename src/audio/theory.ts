/** Music theory helpers: every melodic sound the game makes is snapped to the current chord. */

export const midiToFreq = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

export interface Chord {
  /** MIDI note of the root in octave 3 (e.g. A3 = 57). */
  root: number;
  /** Semitone offsets from root: [0, 3, 7] minor, [0, 4, 7] major, etc. */
  intervals: readonly number[];
  name: string;
}

const MIN = [0, 3, 7] as const;
const MAJ = [0, 4, 7] as const;
const MIN7 = [0, 3, 7, 10] as const;
const MAJ7 = [0, 4, 7, 11] as const;
const SUS2 = [0, 2, 7] as const;

export interface Progression {
  key: string;
  chords: readonly Chord[];
  /** Minor pentatonic scale of the key, used for kill "plinks" so they never clash. */
  pentatonicRoot: number;
}

export const PROGRESSIONS = {
  basement: {
    key: 'A minor',
    pentatonicRoot: 57,
    chords: [
      { root: 57, intervals: MIN7, name: 'Am7' },
      { root: 53, intervals: MAJ7, name: 'Fmaj7' },
      { root: 48, intervals: MAJ, name: 'C' },
      { root: 55, intervals: MAJ, name: 'G' },
    ],
  },
  cathedral: {
    key: 'D minor',
    pentatonicRoot: 50,
    chords: [
      { root: 50, intervals: MIN, name: 'Dm' },
      { root: 46, intervals: MAJ7, name: 'Bbmaj7' },
      { root: 53, intervals: MAJ, name: 'F' },
      { root: 48, intervals: SUS2, name: 'Csus2' },
    ],
  },
  mainstage: {
    key: 'E minor',
    pentatonicRoot: 52,
    chords: [
      { root: 52, intervals: MIN, name: 'Em' },
      { root: 48, intervals: MAJ, name: 'C' },
      { root: 55, intervals: MAJ, name: 'G' },
      { root: 50, intervals: MAJ, name: 'D' },
    ],
  },
  // festival season: brighter, bigger keys as the fields get larger
  fields: {
    key: 'G major',
    pentatonicRoot: 52,
    chords: [
      { root: 55, intervals: MAJ, name: 'G' },
      { root: 50, intervals: MAJ, name: 'D' },
      { root: 52, intervals: MIN7, name: 'Em7' },
      { root: 48, intervals: MAJ7, name: 'Cmaj7' },
    ],
  },
  desert: {
    key: 'F# minor',
    pentatonicRoot: 54,
    chords: [
      { root: 54, intervals: MIN, name: 'F#m' },
      { root: 50, intervals: MAJ7, name: 'Dmaj7' },
      { root: 57, intervals: MAJ, name: 'A' },
      { root: 52, intervals: SUS2, name: 'Esus2' },
    ],
  },
  megafest: {
    key: 'B minor',
    pentatonicRoot: 47,
    chords: [
      { root: 47, intervals: MIN, name: 'Bm' },
      { root: 43, intervals: MAJ, name: 'G' },
      { root: 50, intervals: MAJ, name: 'D' },
      { root: 45, intervals: MAJ, name: 'A' },
    ],
  },
  boss: {
    key: 'C minor',
    pentatonicRoot: 48,
    chords: [
      { root: 48, intervals: MIN, name: 'Cm' },
      { root: 48, intervals: MIN, name: 'Cm' },
      { root: 44, intervals: MAJ, name: 'Ab' },
      { root: 43, intervals: MAJ, name: 'G' },
    ],
  },
  menu: {
    key: 'A minor',
    pentatonicRoot: 57,
    chords: [
      { root: 57, intervals: MIN7, name: 'Am7' },
      { root: 53, intervals: MAJ7, name: 'Fmaj7' },
      { root: 50, intervals: MIN7, name: 'Dm7' },
      { root: 52, intervals: [0, 3, 7, 10], name: 'Em7' },
    ],
  },
} as const satisfies Record<string, Progression>;

export type ProgressionId = keyof typeof PROGRESSIONS;

const PENTA = [0, 3, 5, 7, 10];

/** Note in the minor pentatonic of the key; `degree` can be any integer (wraps across octaves). */
export function pentatonicNote(root: number, degree: number): number {
  const oct = Math.floor(degree / PENTA.length);
  const idx = ((degree % PENTA.length) + PENTA.length) % PENTA.length;
  return root + oct * 12 + PENTA[idx]!;
}

/** The nth chord tone (wrapping up through octaves). */
export function chordTone(chord: Chord, n: number, octaveShift = 0): number {
  const len = chord.intervals.length;
  const oct = Math.floor(n / len);
  const idx = ((n % len) + len) % len;
  return chord.root + chord.intervals[idx]! + 12 * (oct + octaveShift);
}
