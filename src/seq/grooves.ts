import type { InstrumentId } from './instruments';
import { STEPS, type Pattern } from './pattern';

export type GrooveId =
  | 'four'
  | 'backbeat'
  | 'disco'
  | 'trap'
  | 'halftime'
  | 'breakbeat'
  | 'clave'
  | 'downbeat'
  | 'minimal'
  | 'wall'
  | 'poly';

export interface GrooveDef {
  id: GrooveId;
  name: string;
  genre: string;
  /** How to build it, shown once discovered (and as a riddle before). */
  recipe: string;
  riddle: string;
  bonus: string;
  color: string;
}

export const GROOVES: Record<GrooveId, GrooveDef> = {
  four: {
    id: 'four',
    name: 'FOUR ON THE FLOOR',
    genre: 'HOUSE',
    recipe: 'Kick on steps 1 · 5 · 9 · 13',
    riddle: 'The kick walks on every beat.',
    bonus: '+35% kick damage, massive knockback',
    color: '#ff3b5c',
  },
  backbeat: {
    id: 'backbeat',
    name: 'BACKBEAT',
    genre: 'ROCK',
    recipe: 'Snare on steps 5 · 13',
    riddle: 'The snare answers on two and four.',
    bonus: 'Snare pellets pierce +1',
    color: '#ff9a2e',
  },
  disco: {
    id: 'disco',
    name: 'OFFBEAT HATS',
    genre: 'DISCO',
    recipe: 'Hi-hat on steps 3 · 7 · 11 · 15',
    riddle: 'The hats live between the beats.',
    bonus: 'Hi-hats fire +1 needle',
    color: '#ffe14d',
  },
  trap: {
    id: 'trap',
    name: 'HAT ROLL',
    genre: 'TRAP',
    recipe: '12 or more hi-hat notes',
    riddle: 'Hats that never stop.',
    bonus: 'Hi-hat needles home in',
    color: '#ffe14d',
  },
  halftime: {
    id: 'halftime',
    name: 'HALF-TIME',
    genre: 'DUBSTEP',
    recipe: 'Snare only on step 9, with a Bass track',
    riddle: 'One heavy snare in the middle. And bass.',
    bonus: 'Bass beam ×2 width, +60% bass damage',
    color: '#b04dff',
  },
  breakbeat: {
    id: 'breakbeat',
    name: 'BREAKBEAT',
    genre: 'JUNGLE',
    recipe: 'Kick on 1 · 11, snare on 5 · 13, no kick on 9',
    riddle: 'The kick stumbles late; the snare holds firm.',
    bonus: '+12% move speed, +20% all damage',
    color: '#8cff5a',
  },
  clave: {
    id: 'clave',
    name: 'SON CLAVE',
    genre: 'SALSA',
    recipe: 'Any track on 1 · 4 · 7 · 11 · 13',
    riddle: 'Three, then two. The oldest key in rhythm.',
    bonus: 'That track: +25% crit chance',
    color: '#ff5ec8',
  },
  downbeat: {
    id: 'downbeat',
    name: 'THE ONE',
    genre: 'FUNK',
    recipe: '4+ tracks all playing on step 1',
    riddle: 'Everybody on the one.',
    bonus: 'Step 1 also detonates a nova around you',
    color: '#fff1b8',
  },
  minimal: {
    id: 'minimal',
    name: 'NEGATIVE SPACE',
    genre: 'MINIMAL',
    recipe: '4+ tracks and no two share a step',
    riddle: 'Never speak over each other.',
    bonus: 'Every note deals ×1.8 damage',
    color: '#9fb8ff',
  },
  wall: {
    id: 'wall',
    name: 'WALL OF SOUND',
    genre: 'SHOEGAZE',
    recipe: '40+ notes on the grid',
    riddle: 'Fill the machine.',
    bonus: '+40% all damage',
    color: '#c26bff',
  },
  poly: {
    id: 'poly',
    name: 'THREE AGAINST FOUR',
    genre: 'POLYRHYTHM',
    recipe: 'Any track on 1 · 4 · 7 · 10 · 13 · 16',
    riddle: 'Count in threes against the fours.',
    bonus: 'That track fires +1 projectile',
    color: '#2ee6ff',
  },
};

export const GROOVE_IDS = Object.keys(GROOVES) as GrooveId[];

export interface GrooveState {
  active: Set<GrooveId>;
  /** Tracks singled out by per-track grooves. */
  claveTracks: Set<InstrumentId>;
  polyTracks: Set<InstrumentId>;
}

const hasAll = (notes: readonly boolean[], steps: readonly number[]): boolean => steps.every((s) => notes[s]);

const CLAVE = [0, 3, 6, 10, 12];
const POLY = [0, 3, 6, 9, 12, 15];

export function detectGrooves(p: Pattern): GrooveState {
  const active = new Set<GrooveId>();
  const claveTracks = new Set<InstrumentId>();
  const polyTracks = new Set<InstrumentId>();
  const kick = p.track('kick');
  const snare = p.track('snare');
  const hat = p.track('hat');

  if (kick && hasAll(kick.notes, [0, 4, 8, 12])) active.add('four');
  if (snare && hasAll(snare.notes, [4, 12])) active.add('backbeat');
  if (hat && hasAll(hat.notes, [2, 6, 10, 14])) active.add('disco');
  if (hat && p.noteCount(hat) >= 12) active.add('trap');
  if (snare && p.has('bass') && snare.notes[8] && p.noteCount(snare) === 1) active.add('halftime');
  if (kick && snare && kick.notes[0] && kick.notes[10] && !kick.notes[8] && hasAll(snare.notes, [4, 12]))
    active.add('breakbeat');

  for (const t of p.tracks) {
    if (hasAll(t.notes, CLAVE)) claveTracks.add(t.inst);
    if (hasAll(t.notes, POLY)) polyTracks.add(t.inst);
  }
  if (claveTracks.size) active.add('clave');
  if (polyTracks.size) active.add('poly');

  if (p.tracksOnStep(0) >= 4) active.add('downbeat');

  if (p.tracks.length >= 4) {
    let shared = false;
    for (let s = 0; s < STEPS && !shared; s++) if (p.tracksOnStep(s) > 1) shared = true;
    if (!shared) active.add('minimal');
  }
  if (p.totalNotes() >= 40) active.add('wall');

  return { active, claveTracks, polyTracks };
}
