import type { InstrumentId } from '../seq/instruments';
import { INSTRUMENT_IDS } from '../seq/instruments';
import type { GrooveId } from '../seq/grooves';
import { GROOVE_IDS } from '../seq/grooves';
import { emptyUpgrades, maxLevel, UPGRADE_IDS, type UpgradeLevels } from '../seq/upgrades';
import { BADGE_IDS, ownedSkins, type BadgeId, type SkinId } from '../seq/badges';

/**
 * Persistent meta-progression. Everything read from localStorage is treated as untrusted:
 * parsed defensively, whitelisted, clamped. A corrupt or tampered save degrades to
 * defaults instead of crashing or injecting anything into the page.
 */
export interface Settings {
  master: number;
  music: number;
  sfx: number;
  quality: 'high' | 'medium' | 'low';
  shake: number;
  autoAim: boolean;
  flashes: boolean;
}

export interface SaveData {
  version: 1;
  fans: number;
  totalFans: number;
  unlocked: InstrumentId[];
  grooves: GrooveId[];
  evolutions: InstrumentId[];
  runs: number;
  wins: number;
  bestKills: number;
  bestVenue: number;
  bestHit: number;
  loudness: number;
  settings: Settings;
  dailyBest: Record<string, number>;
  seenTutorial: boolean;
  setlist: string;
  /** permanent upgrades bought at the merch table */
  upgrades: UpgradeLevels;
  /** tour badges earned */
  badges: BadgeId[];
  /** the mic skin in use (must be unlocked by a badge) */
  skin: SkinId;
}

const KEY = 'encore.save.v1';
const SETLIST_WHITELIST = ['garage', 'rhythm', 'dj', 'drumline', 'choir'];
const MAX_NUM = 1e15;

export const DEFAULT_SETTINGS: Settings = {
  master: 0.8,
  music: 0.9,
  sfx: 0.85,
  quality: 'high',
  shake: 1,
  autoAim: false,
  flashes: true,
};

export const STARTER_UNLOCKS: InstrumentId[] = ['kick', 'snare', 'hat', 'bass', 'lead', 'clap'];

export function defaultSave(): SaveData {
  return {
    version: 1,
    fans: 0,
    totalFans: 0,
    unlocked: [...STARTER_UNLOCKS],
    grooves: [],
    evolutions: [],
    runs: 0,
    wins: 0,
    bestKills: 0,
    bestVenue: 0,
    bestHit: 0,
    loudness: 0,
    settings: { ...DEFAULT_SETTINGS },
    dailyBest: {},
    seenTutorial: false,
    setlist: 'garage',
    upgrades: emptyUpgrades(),
    badges: [],
    skin: 'classic',
  };
}

const num = (v: unknown, lo: number, hi: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

function whitelist<T extends string>(v: unknown, allowed: readonly T[]): T[] {
  if (!Array.isArray(v)) return [];
  const set = new Set<T>();
  for (const x of v) if (typeof x === 'string' && (allowed as readonly string[]).includes(x)) set.add(x as T);
  return [...set];
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function sanitize(raw: unknown): SaveData {
  const d = defaultSave();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  d.fans = Math.floor(num(r.fans, 0, MAX_NUM, 0));
  d.totalFans = Math.floor(num(r.totalFans, 0, MAX_NUM, 0));
  const unlocked = whitelist(r.unlocked, INSTRUMENT_IDS);
  d.unlocked = [...new Set([...STARTER_UNLOCKS, ...unlocked])];
  d.grooves = whitelist(r.grooves, GROOVE_IDS);
  d.evolutions = whitelist(r.evolutions, INSTRUMENT_IDS);
  d.runs = Math.floor(num(r.runs, 0, MAX_NUM, 0));
  d.wins = Math.floor(num(r.wins, 0, MAX_NUM, 0));
  d.bestKills = Math.floor(num(r.bestKills, 0, MAX_NUM, 0));
  d.bestVenue = Math.floor(num(r.bestVenue, 0, 99, 0));
  d.bestHit = num(r.bestHit, 0, 1e300, 0);
  d.loudness = Math.floor(num(r.loudness, 0, 10, 0));
  d.seenTutorial = bool(r.seenTutorial, false);
  d.setlist = typeof r.setlist === 'string' && SETLIST_WHITELIST.includes(r.setlist) ? r.setlist : 'garage';
  const s = (r.settings && typeof r.settings === 'object' ? r.settings : {}) as Record<string, unknown>;
  d.settings = {
    master: num(s.master, 0, 1, DEFAULT_SETTINGS.master),
    music: num(s.music, 0, 1, DEFAULT_SETTINGS.music),
    sfx: num(s.sfx, 0, 1, DEFAULT_SETTINGS.sfx),
    quality: s.quality === 'low' || s.quality === 'medium' || s.quality === 'high' ? s.quality : 'high',
    shake: num(s.shake, 0, 1, DEFAULT_SETTINGS.shake),
    autoAim: bool(s.autoAim, DEFAULT_SETTINGS.autoAim),
    flashes: bool(s.flashes, DEFAULT_SETTINGS.flashes),
  };
  // upgrades: only known ids, integer levels clamped to each upgrade's max
  if (r.upgrades && typeof r.upgrades === 'object') {
    const u = r.upgrades as Record<string, unknown>;
    for (const id of UPGRADE_IDS) {
      if (Object.prototype.hasOwnProperty.call(u, id)) d.upgrades[id] = Math.floor(num(u[id], 0, maxLevel(id), 0));
    }
  }
  d.badges = whitelist(r.badges, BADGE_IDS);
  // a skin only counts if a badge actually unlocked it
  d.skin = typeof r.skin === 'string' && (ownedSkins(d.badges) as string[]).includes(r.skin) ? (r.skin as SkinId) : 'classic';
  if (r.dailyBest && typeof r.dailyBest === 'object') {
    const entries = Object.entries(r.dailyBest as Record<string, unknown>)
      .filter(([k, v]) => DATE_KEY.test(k) && typeof v === 'number' && Number.isFinite(v))
      .slice(-60);
    for (const [k, v] of entries) d.dailyBest[k] = num(v, 0, MAX_NUM, 0);
  }
  return d;
}

export function loadSave(storage: Pick<Storage, 'getItem'> | null = safeStorage()): SaveData {
  try {
    const txt = storage?.getItem(KEY);
    if (!txt || txt.length > 200_000) return defaultSave();
    return sanitize(JSON.parse(txt));
  } catch {
    return defaultSave();
  }
}

export function writeSave(data: SaveData, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(KEY, JSON.stringify(data));
  } catch {
    /* storage full or blocked (private mode) — the run still works */
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}
