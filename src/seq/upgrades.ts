/**
 * Permanent upgrades bought with fans at the merch table. Each run starts a little stronger;
 * the numbers are deliberately modest per level so skill and the draft still decide a run.
 */
export type UpgradeId =
  | 'amp'
  | 'presence'
  | 'magnet'
  | 'session'
  | 'soundcheck'
  | 'dash'
  | 'tipjar'
  | 'warmup'
  | 'lucky'
  | 'hype'
  | 'secondwind';

/** Which prop the icon factory renders for the card. */
export type UpgradeIcon =
  | { kind: 'gear'; id: string }
  | { kind: 'heart' }
  | { kind: 'note'; color: number }
  | { kind: 'fx'; fx: 'accent' | 'ratchet' | 'echo' }
  | { kind: 'gold' }
  | { kind: 'mic' };

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  /** what one more level does */
  blurb: string;
  /** what the current level adds up to */
  total: (level: number) => string;
  costs: number[];
  color: string;
  icon: UpgradeIcon;
}

export const UPGRADES: Record<UpgradeId, UpgradeDef> = {
  amp: {
    id: 'amp',
    name: 'Bigger Amp',
    blurb: '+8% damage from everything.',
    total: (l) => `+${l * 8}% damage`,
    costs: [150, 300, 500, 800, 1200],
    color: '#ff7a2e',
    icon: { kind: 'gear', id: 'ampstack' },
  },
  presence: {
    id: 'presence',
    name: 'Stage Presence',
    blurb: '+15 max health.',
    total: (l) => `+${l * 15} max health`,
    costs: [120, 250, 450, 700, 1000],
    color: '#ff3b5c',
    icon: { kind: 'heart' },
  },
  magnet: {
    id: 'magnet',
    name: 'Groupie Magnet',
    blurb: '+15% pickup radius.',
    total: (l) => `+${l * 15}% pickup radius`,
    costs: [100, 250, 500],
    color: '#ff5ec8',
    icon: { kind: 'gear', id: 'groupies' },
  },
  session: {
    id: 'session',
    name: 'Session Player',
    blurb: '+10% notes (XP) from every pickup.',
    total: (l) => `+${l * 10}% XP`,
    costs: [150, 300, 500, 800, 1200],
    color: '#3dffc5',
    icon: { kind: 'note', color: 0x3dffc5 },
  },
  soundcheck: {
    id: 'soundcheck',
    name: 'Soundcheck',
    blurb: '+1 reroll every run.',
    total: (l) => `+${l} reroll${l === 1 ? '' : 's'}`,
    costs: [200, 500, 900],
    color: '#ffe14d',
    icon: { kind: 'fx', fx: 'ratchet' },
  },
  dash: {
    id: 'dash',
    name: 'Stage Diver',
    blurb: '+1 dash charge.',
    total: (l) => `+${l} dash charge`,
    costs: [1200],
    color: '#2ee6ff',
    icon: { kind: 'gear', id: 'stagedive' },
  },
  tipjar: {
    id: 'tipjar',
    name: 'Tip Jar',
    blurb: '+15% tips for the backstage shop.',
    total: (l) => `+${l * 15}% tips`,
    costs: [100, 250, 500],
    color: '#ffc53d',
    icon: { kind: 'gear', id: 'goldchain' },
  },
  warmup: {
    id: 'warmup',
    name: 'Warm-up Act',
    blurb: 'Start every run with one free level-up.',
    total: (l) => `${l} free level-up${l === 1 ? '' : 's'} at the start`,
    costs: [400, 900],
    color: '#8cff5a',
    icon: { kind: 'gear', id: 'energy' },
  },
  lucky: {
    id: 'lucky',
    name: 'Lucky Pick',
    blurb: 'Rare cards show up more often.',
    total: (l) => `+${l * 15}% luck`,
    costs: [300, 700, 1200],
    color: '#c26bff',
    icon: { kind: 'gold' },
  },
  hype: {
    id: 'hype',
    name: 'Hype Crew',
    blurb: 'Hype fills 10% faster.',
    total: (l) => `+${l * 10}% hype`,
    costs: [200, 450, 800],
    color: '#ff2d78',
    icon: { kind: 'gear', id: 'hypeman' },
  },
  secondwind: {
    id: 'secondwind',
    name: 'Second Encore',
    blurb: 'Once per run, the crowd pulls you back up at 60% health.',
    total: (l) => (l > 0 ? 'one revive per run' : ''),
    costs: [2000],
    color: '#ffd36b',
    icon: { kind: 'mic' },
  },
};

export const UPGRADE_IDS = Object.keys(UPGRADES) as UpgradeId[];

export type UpgradeLevels = Record<UpgradeId, number>;

export function emptyUpgrades(): UpgradeLevels {
  const r = {} as UpgradeLevels;
  for (const id of UPGRADE_IDS) r[id] = 0;
  return r;
}

export function maxLevel(id: UpgradeId): number {
  return UPGRADES[id].costs.length;
}

/** Price of the next level, or null when maxed. */
export function nextCost(id: UpgradeId, level: number): number | null {
  return UPGRADES[id].costs[level] ?? null;
}
