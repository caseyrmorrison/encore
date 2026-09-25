import type { SaveData } from '../core/save';
import type { InstrumentId } from './instruments';

export type SetlistId = 'garage' | 'rhythm' | 'dj' | 'drumline' | 'choir';

export interface Setlist {
  id: SetlistId;
  name: string;
  blurb: string;
  tracks: { inst: InstrumentId; notes?: number[] }[];
  maxHpMod: number;
  hypeMod: number;
  unlocked(save: SaveData): boolean;
  unlockText: string;
}

export const SETLISTS: Record<SetlistId, Setlist> = {
  garage: {
    id: 'garage',
    name: 'GARAGE BAND',
    blurb: 'Kick and snare. Where every legend starts.',
    tracks: [{ inst: 'kick' }, { inst: 'snare' }],
    maxHpMod: 0,
    hypeMod: 1,
    unlocked: () => true,
    unlockText: '',
  },
  rhythm: {
    id: 'rhythm',
    name: 'RHYTHM SECTION',
    blurb: 'Kick and bass from bar one. Low end, high damage.',
    tracks: [{ inst: 'kick' }, { inst: 'bass', notes: [0, 8] }],
    maxHpMod: 0,
    hypeMod: 1,
    unlocked: (s) => s.bestVenue >= 1,
    unlockText: 'Headline the Basement',
  },
  dj: {
    id: 'dj',
    name: 'THE DJ',
    blurb: 'Four-on-the-floor kick and a turntable. Fragile, but it bangs.',
    tracks: [{ inst: 'kick', notes: [0, 4, 8, 12] }, { inst: 'scratch' }],
    maxHpMod: -20,
    hypeMod: 1.2,
    unlocked: (s) => s.grooves.length >= 3,
    unlockText: 'Discover 3 grooves',
  },
  drumline: {
    id: 'drumline',
    name: 'DRUMLINE',
    blurb: 'Kick, snare and hats — but the crowd is harder to hype.',
    tracks: [{ inst: 'kick' }, { inst: 'snare' }, { inst: 'hat' }],
    maxHpMod: 0,
    hypeMod: 0.7,
    unlocked: (s) => s.wins > 0,
    unlockText: 'Win a run',
  },
  choir: {
    id: 'choir',
    name: 'THE CHOIR',
    blurb: 'Organ pillars and a healing pad. No drums at all.',
    tracks: [{ inst: 'organ' }, { inst: 'pad' }],
    maxHpMod: 10,
    hypeMod: 1,
    unlocked: (s) => s.bestVenue >= 2,
    unlockText: 'Reach the Mainstage',
  },
};

export const SETLIST_IDS = Object.keys(SETLISTS) as SetlistId[];
