export type InstrumentId =
  | 'kick'
  | 'snare'
  | 'hat'
  | 'clap'
  | 'bass'
  | 'lead'
  | 'pad'
  | 'crash'
  | 'tom'
  | 'cowbell'
  | 'scratch'
  | 'organ'
  | 'gong';

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

export interface InstrumentDef {
  id: InstrumentId;
  name: string;
  /** Three-letter label on the drum machine. */
  short: string;
  color: number;
  css: string;
  weapon: string;
  blurb: string;
  defaultNotes: readonly number[];
  rarity: Rarity;
  /** Available without meta unlocks. */
  starter: boolean;
  evolution: { name: string; hint: string; blurb: string };
  levels: readonly string[];
}

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

function def(d: Omit<InstrumentDef, 'css'>): InstrumentDef {
  return { ...d, css: hex(d.color) };
}

export const INSTRUMENTS: Record<InstrumentId, InstrumentDef> = {
  kick: def({
    id: 'kick',
    name: 'Kick',
    short: 'KCK',
    color: 0xff3b5c,
    weapon: 'Shockwave',
    blurb: 'Every hit blasts a shockwave out from you, knocking The Hush back.',
    defaultNotes: [0, 8],
    rarity: 'common',
    starter: true,
    evolution: {
      name: '808 QUAKE',
      hint: 'Kick Lv5 + Amp Stack pedal',
      blurb: 'The floor cracks. Shockwaves double in size and leave burning fault lines.',
    },
    levels: ['+30% damage', '+25% radius', '+30% damage', '+25% radius, stronger knockback'],
  }),
  snare: def({
    id: 'snare',
    name: 'Snare',
    short: 'SNR',
    color: 0xff9a2e,
    weapon: 'Spread Shot',
    blurb: 'Fires a crackling spread of pellets toward your aim.',
    defaultNotes: [4, 12],
    rarity: 'common',
    starter: true,
    evolution: {
      name: 'RIMSHOT CANNON',
      hint: 'Snare Lv5 + BACKBEAT groove',
      blurb: 'Pellets become ricocheting rimshots that split on every hit.',
    },
    levels: ['+1 pellet', '+30% damage', '+1 pellet', '+30% damage, +1 pierce'],
  }),
  hat: def({
    id: 'hat',
    name: 'Hi-Hat',
    short: 'HAT',
    color: 0xffe14d,
    weapon: 'Needles',
    blurb: 'Fast, precise needles. Cheap to stack, deadly in rolls.',
    defaultNotes: [2, 6, 10, 14],
    rarity: 'common',
    starter: true,
    evolution: {
      name: 'BLAST BEAT',
      hint: 'Hi-Hat Lv5 + Ratchet on 2 steps',
      blurb: 'Every needle becomes a burst of five. The hats never stop.',
    },
    levels: ['+30% damage', '+1 pierce', '+30% damage', '+1 needle per note'],
  }),
  clap: def({
    id: 'clap',
    name: 'Clap',
    short: 'CLP',
    color: 0x8cff5a,
    weapon: 'Chain Lightning',
    blurb: 'A crack of lightning that leaps between nearby enemies.',
    defaultNotes: [4, 12],
    rarity: 'common',
    starter: false,
    evolution: {
      name: 'THUNDERCLAP',
      hint: 'Clap Lv5 + DISCO groove',
      blurb: 'Lightning forks at every jump. Storms follow you.',
    },
    levels: ['+1 jump', '+30% damage', '+2 jumps', '+30% damage, +1 bolt'],
  }),
  bass: def({
    id: 'bass',
    name: 'Bass',
    short: 'BAS',
    color: 0xb04dff,
    weapon: 'Sub Beam',
    blurb: 'A piercing low-end beam along your aim. Plays the chord root.',
    defaultNotes: [0],
    rarity: 'rare',
    starter: true,
    evolution: {
      name: 'WUBMAGEDDON',
      hint: 'Bass Lv5 + HALF-TIME groove',
      blurb: 'The beam wobbles, widens and sweeps. Dubstep was a weapon all along.',
    },
    levels: ['+30% damage', '+35% width', '+30% damage', '+40% length, beam lingers'],
  }),
  lead: def({
    id: 'lead',
    name: 'Lead Synth',
    short: 'LED',
    color: 0x2ee6ff,
    weapon: 'Homing Notes',
    blurb: 'Glowing notes that seek targets and arpeggiate the chord.',
    defaultNotes: [0, 6, 10],
    rarity: 'rare',
    starter: true,
    evolution: {
      name: 'GUITAR SOLO',
      hint: 'Lead Lv5 + Echo on any step',
      blurb: 'Each note splits into a shredding fan on impact. Face-melting.',
    },
    levels: ['+30% damage', '+1 missile', '+30% damage', '+1 missile, faster'],
  }),
  pad: def({
    id: 'pad',
    name: 'Pad',
    short: 'PAD',
    color: 0x3dffc5,
    weapon: 'Warm Aura',
    blurb: 'Swells a chord that heals you and slows everything nearby.',
    defaultNotes: [0],
    rarity: 'rare',
    starter: false,
    evolution: {
      name: 'SANCTUARY',
      hint: 'Pad Lv5 + Roadie Case pedal',
      blurb: 'The aura burns The Hush and overheals into a shield.',
    },
    levels: ['+1 heal', '+25% radius', '+1 heal, deeper slow', '+25% radius, aura damages'],
  }),
  crash: def({
    id: 'crash',
    name: 'Crash',
    short: 'CRS',
    color: 0xfff1b8,
    weapon: 'Cymbal Blast',
    blurb: 'A huge blast on the densest crowd of enemies.',
    defaultNotes: [0],
    rarity: 'rare',
    starter: false,
    evolution: {
      name: 'SUPERNOVA',
      hint: 'Crash Lv5 + Accent on step 1',
      blurb: 'Blasts chain into three more blasts. The sky is a cymbal.',
    },
    levels: ['+30% damage', '+25% radius', '+30% damage', '+1 blast'],
  }),
  tom: def({
    id: 'tom',
    name: 'Toms',
    short: 'TOM',
    color: 0xff5ec8,
    weapon: 'Ricochet',
    blurb: 'Rolling orbs that ricochet between enemies. Descends in pitch.',
    defaultNotes: [13, 14, 15],
    rarity: 'common',
    starter: false,
    evolution: {
      name: 'TOM-TOM TORNADO',
      hint: 'Toms Lv5 + Sustain pedal',
      blurb: 'Orbs never stop bouncing until they have hit twelve times.',
    },
    levels: ['+1 bounce', '+30% damage', '+2 bounces', '+30% damage, bigger orbs'],
  }),
  cowbell: def({
    id: 'cowbell',
    name: 'Cowbell',
    short: 'COW',
    color: 0xffb13d,
    weapon: 'Bell Ring',
    blurb: 'A ringing bell that stuns what it hits. You need more of it.',
    defaultNotes: [3, 11],
    rarity: 'rare',
    starter: false,
    evolution: {
      name: 'MORE COWBELL',
      hint: 'Cowbell Lv5 + tempo ≥ 130 BPM',
      blurb: 'Cowbells rain from the sky on every hit. The fever is cured.',
    },
    levels: ['+30% damage', '+0.3s stun', '+30% damage', '+1 bell'],
  }),
  scratch: def({
    id: 'scratch',
    name: 'Scratch',
    short: 'SCR',
    color: 0xff4df0,
    weapon: 'Vinyl Disc',
    blurb: 'Throws a spinning record that slices out and back. Infinite pierce.',
    defaultNotes: [6, 14],
    rarity: 'rare',
    starter: false,
    evolution: {
      name: 'WIKI-WIKI',
      hint: 'Scratch Lv5 + Wah pedal',
      blurb: 'Discs split into two on the way back. Then they split again.',
    },
    levels: ['+30% damage', '+25% size', '+30% damage', '+1 disc'],
  }),
  organ: def({
    id: 'organ',
    name: 'Organ',
    short: 'ORG',
    color: 0x9fb8ff,
    weapon: 'Light Pillars',
    blurb: 'Pillars of light erupt beneath enemies around you.',
    defaultNotes: [0, 8],
    rarity: 'epic',
    starter: false,
    evolution: {
      name: 'CATHEDRAL',
      hint: 'Organ Lv5 + a Pad track',
      blurb: 'Pillars form rings of twelve and linger as holy fire.',
    },
    levels: ['+1 pillar', '+30% damage', '+1 pillar', '+30% damage, wider pillars'],
  }),
  gong: def({
    id: 'gong',
    name: 'Gong',
    short: 'GNG',
    color: 0xffd36b,
    weapon: 'Time Stop',
    blurb: 'A colossal wave that freezes time for everything it touches.',
    defaultNotes: [0],
    rarity: 'legendary',
    starter: false,
    evolution: {
      name: 'ETERNITY',
      hint: 'Gong Lv5 + DOWNBEAT groove',
      blurb: 'Frozen enemies shatter for triple damage.',
    },
    levels: ['+0.4s freeze', '+30% damage', '+0.4s freeze', '+50% radius'],
  }),
};

export const INSTRUMENT_IDS = Object.keys(INSTRUMENTS) as InstrumentId[];

export const DRUM_IDS: ReadonlySet<InstrumentId> = new Set([
  'kick',
  'snare',
  'hat',
  'clap',
  'crash',
  'tom',
  'cowbell',
  'scratch',
  'gong',
]);

export const MAX_LEVEL = 5;

export const RARITY_COLOR: Record<Rarity, string> = {
  common: '#cfd6e6',
  rare: '#4dc3ff',
  epic: '#c26bff',
  legendary: '#ffc53d',
};
