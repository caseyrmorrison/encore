/**
 * Tour badges: milestones that follow you between runs. Some of them unlock mic skins.
 */
export type BadgeId =
  | 'opening'
  | 'club'
  | 'world'
  | 'digger'
  | 'genres'
  | 'million'
  | 'metronome'
  | 'unstoppable'
  | 'fullband'
  | 'evolution'
  | 'addict'
  | 'flawless';

export type SkinId = 'classic' | 'gold' | 'vapor' | 'toxic' | 'obsidian' | 'diamond';

export interface BadgeDef {
  id: BadgeId;
  name: string;
  how: string;
  color: string;
  /** the mic skin this badge unlocks, if any */
  skin?: SkinId;
}

export const BADGES: Record<BadgeId, BadgeDef> = {
  opening: { id: 'opening', name: 'Opening Act', how: 'Silence 100 Hush in one show', color: '#3dffb0' },
  club: { id: 'club', name: 'Club Headliner', how: 'Headline the Mainstage', color: '#ffd36b', skin: 'gold' },
  world: { id: 'world', name: 'World Tour', how: 'Headline Megafest', color: '#bfe8ff', skin: 'diamond' },
  digger: { id: 'digger', name: 'Crate Digger', how: 'Discover 5 grooves', color: '#2ee6ff', skin: 'vapor' },
  genres: { id: 'genres', name: 'Every Genre', how: 'Discover every groove', color: '#c26bff' },
  million: { id: 'million', name: 'Seven Figures', how: 'Land a single hit of 1,000,000', color: '#ff9a2e' },
  metronome: { id: 'metronome', name: 'Human Metronome', how: 'Chain 8 perfect dashes', color: '#ffe14d' },
  unstoppable: { id: 'unstoppable', name: 'Unstoppable', how: 'Reach a 500 streak', color: '#ff2d78' },
  fullband: { id: 'fullband', name: 'Full Band', how: 'Fill all 8 tracks of the machine', color: '#8cff5a' },
  evolution: { id: 'evolution', name: 'Evolution', how: 'Evolve an instrument', color: '#ff5ec8' },
  addict: { id: 'addict', name: 'Drop Addict', how: 'Call 5 DROPs in one show', color: '#8cff5a', skin: 'toxic' },
  flawless: { id: 'flawless', name: 'Flawless Set', how: 'Headline a venue without taking a hit', color: '#ff3b5c', skin: 'obsidian' },
};

export const BADGE_IDS = Object.keys(BADGES) as BadgeId[];

export interface SkinDef {
  id: SkinId;
  name: string;
  grille: number;
  /** grille glow (0 = none) */
  glow: number;
  band: number;
  handle: number;
  badge: number;
  /** thin-film rainbow on the grille */
  iridescent?: boolean;
}

export const SKINS: Record<SkinId, SkinDef> = {
  classic: { id: 'classic', name: 'Classic', grille: 0xf2f4fa, glow: 0, band: 0xffc53d, handle: 0x17161b, badge: 0xff2d78 },
  gold: { id: 'gold', name: 'Gold Record', grille: 0xffd36b, glow: 0, band: 0xfff1c8, handle: 0x2a1a08, badge: 0xffd36b },
  vapor: { id: 'vapor', name: 'Vaporwave', grille: 0xa8f6ff, glow: 0x2ee6ff, band: 0xe8e6f0, handle: 0xff5ec8, badge: 0x2ee6ff },
  toxic: { id: 'toxic', name: 'Toxic', grille: 0x8cff5a, glow: 0x4dff2a, band: 0x2a2e26, handle: 0x0e1a08, badge: 0x8cff5a },
  obsidian: { id: 'obsidian', name: 'Obsidian', grille: 0x2a2a32, glow: 0xff2a3a, band: 0xff2a3a, handle: 0x050505, badge: 0xff2a3a },
  diamond: { id: 'diamond', name: 'Diamond', grille: 0xffffff, glow: 0, band: 0xdfe6f5, handle: 0xe8e6f0, badge: 0xb0e0ff, iridescent: true },
};

export const SKIN_IDS = Object.keys(SKINS) as SkinId[];

/** Skins you own: the classic plus whatever your badges unlocked. */
export function ownedSkins(badges: readonly BadgeId[]): SkinId[] {
  const out: SkinId[] = ['classic'];
  for (const b of badges) {
    const s = BADGES[b].skin;
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}
