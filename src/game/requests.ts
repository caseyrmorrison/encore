import type { Rng } from '../core/rng';

/**
 * Crowd requests: every set the crowd shouts one thing it wants to see. Play it and they
 * throw tips (and a lot of noise). Goals scale with the size of the venue.
 */
export type RequestKind = 'kills' | 'perfects' | 'drops' | 'streak' | 'untouched' | 'groove';

export interface CrowdRequest {
  kind: RequestKind;
  goal: number;
  text: string;
  done: boolean;
}

interface RequestDef {
  kind: RequestKind;
  goal: (venue: number) => number;
  text: (goal: number) => string;
}

const DEFS: RequestDef[] = [
  { kind: 'kills', goal: (v) => 250 + v * 150, text: (n) => `Silence ${n} Hush this set` },
  { kind: 'perfects', goal: (v) => 4 + v, text: (n) => `Land ${n} perfect dashes` },
  { kind: 'drops', goal: (v) => (v >= 3 ? 2 : 1), text: (n) => (n === 1 ? 'Call a DROP' : `Call ${n} DROPs`) },
  { kind: 'streak', goal: (v) => 80 + v * 40, text: (n) => `Hit a ×${n} streak` },
  { kind: 'untouched', goal: (v) => 30 + v * 5, text: (n) => `Go ${n}s without taking a hit` },
  { kind: 'groove', goal: () => 1, text: () => 'Lock in a new groove' },
];

export function pickRequest(rng: Rng, venue: number, knownAllGrooves: boolean): CrowdRequest {
  const pool = DEFS.filter((d) => d.kind !== 'groove' || !knownAllGrooves);
  const d = pool[Math.floor(rng.next() * pool.length)]!;
  const goal = d.goal(venue);
  return { kind: d.kind, goal, text: d.text(goal), done: false };
}
