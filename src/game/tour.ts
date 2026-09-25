import { Basement } from '../render/venues/basement';
import { Cathedral } from '../render/venues/cathedral';
import { Mainstage } from '../render/venues/mainstage';
import type { Venue, VenueId } from '../render/venues/venue';

/**
 * The festival stages are big and only needed after the club tour, so they live in their
 * own chunk: fetched quietly once the title is up, and awaited (almost always instantly)
 * before the tour goes outside.
 */
type FestivalModule = typeof import('./festivals');
let festivals: FestivalModule | null = null;
let festivalsLoading: Promise<FestivalModule> | null = null;

export function loadFestivals(): Promise<FestivalModule> {
  festivalsLoading ??= import('./festivals').then((m) => (festivals = m));
  return festivalsLoading;
}

export const festivalsLoaded = (): boolean => festivals !== null;

function festival(name: 'Fields' | 'Desert' | 'Megafest'): () => Venue {
  return () => {
    if (!festivals) throw new Error('festival stages not loaded yet');
    return new festivals[name]();
  };
}

/**
 * The tour. Three clubs make a run; headline the Mainstage and the encore takes the same
 * build out into festival season — three open-air stages, each far bigger than the last.
 * Headline Megafest and the tour loops "after hours", harder every time round.
 */
export interface TourStop {
  id: VenueId;
  name: string;
  tier: 'club' | 'festival';
  make(): Venue;
}

export const TOUR: readonly TourStop[] = [
  { id: 'basement', name: 'THE BASEMENT', tier: 'club', make: () => new Basement() },
  { id: 'cathedral', name: 'THE CATHEDRAL', tier: 'club', make: () => new Cathedral() },
  { id: 'mainstage', name: 'THE MAINSTAGE', tier: 'club', make: () => new Mainstage() },
  { id: 'fields', name: 'SUNSET FIELDS', tier: 'festival', make: festival('Fields') },
  { id: 'desert', name: 'NEON DESERT', tier: 'festival', make: festival('Desert') },
  { id: 'megafest', name: 'MEGAFEST', tier: 'festival', make: festival('Megafest') },
];

/** The Mainstage: headlining it wins a run (and opens festival season). */
export const CLUB_FINAL = 2;
export const FESTIVAL_START = 3;
/** Megafest: headlining it completes the world tour. */
export const TOUR_FINAL = TOUR.length - 1;

export const isFinalStop = (i: number): boolean => i === CLUB_FINAL || i === TOUR_FINAL;

export const stopName = (i: number): string => TOUR[i]?.name ?? 'THE VENUE';
