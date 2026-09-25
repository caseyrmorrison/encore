# ENCORE — Design Document

> *The Hush has swallowed every song in the universe. You are the last live microphone.
> Play the basement. Play the cathedral. Headline the end of the world.*

## Pillars

1. **Your build is the soundtrack.** Every weapon is an instrument track on a 16-step drum machine.
   Notes fire on the beat. As you grow stronger the music literally gets fuller, louder, better.
2. **Composition is strategy.** *Where* you put notes matters: stacking tracks on one step makes
   **chords** (harmony bonus), special patterns unlock **grooves** (genre set-bonuses), step FX
   (accent / ratchet / echo) multiply triggers. Understanding the grid is how you break the game.
3. **Rhythm is skill.** Dash on the beat for a **PERFECT** (shockwave + i-frames + hype).
   Fill hype, call the **DROP** — the game waits for the downbeat, plays a riser, then detonates.
4. **Everything dances.** Floors, lights, enemies, camera, UI — all driven by the transport clock.
5. **Exaggerate success.** Every achievement gets light, sound, time, and screen space.

## The loop

- Move `WASD`, aim with the mouse (or auto-aim), dash `SPACE`, drop `Q` / right-click.
  On touch: a floating stick under the left thumb, DASH/DROP buttons under the right, auto-aim.
- Kill The Hush → they burst into light and a quantized note (Rez-style, always in key).
- Collect **notes** (XP) → level up → draft 1 of 3 cards → edit the pattern.
- Elites drop **Gold Records** (a rare+ pick). Between venues: **Backstage** shop & free editing.
- Three venues, each a "set" that ends with a headliner-grade boss:
  1. **The Basement** — 112 BPM, A minor, LED dance floor, red/amber haze. Boss: **FEEDBACK**.
  2. **The Cathedral** — 124 BPM, D minor, marble + stained glass + organ pipes. Boss: **THE CANTOR**.
  3. **The Mainstage** — 136 BPM, E minor, festival stage, lasers, crowd of thousands. Boss: **THE HUSH**.
- Win → **ENCORE** endless mode: +8 BPM and harder crowds every loop. This is where broken builds sing.

## Big moments (the "make people happy" budget)

Every accomplishment gets a dedicated, never-overlapping centre-screen beat:

- **Headliner entrance** — letterbox bars, slow motion, one spotlight, the name slammed over a
  band of the boss colour; the fight starts with a shove of sound when the bars open.
- **DROP** — riser + filter sweep, a colour-heating 4-3-2-1 countdown above the performer, the
  room darkens, then the downbeat detonates (light pillar, confetti cannons, floor strobes).
  Groove stamps queue behind drops and each other; a queued drop dismisses any stamp on screen.
- **Groove / evolution stamps** — a rubber-stamp card with the genre name.
- **Victory lap** — the final headliner's crowd pops outward in a ripple, the camera cranes back
  to reveal the whole show (crowd, LED wall spelling ENCORE!, pyro), fireworks keep going behind
  a gold results screen.

## Damage model (multiplicative on purpose)

```
note damage = base × level × harmony × accent × groove × pedals × drop × crit
triggers    = notes × ratchet × (1 + echo) × BPM
harmony     = 1 + 0.18 × (tracks on this step − 1)
```

Enemies scale roughly linearly with time; a well-composed build scales multiplicatively.
That gap is the power fantasy.

## Grooves (discoverable set bonuses)

| Groove | Pattern | Bonus |
| --- | --- | --- |
| FOUR ON THE FLOOR | kick on 1·5·9·13 | kicks knock back hard, +35% kick dmg |
| BACKBEAT | snare on 5·13 | snare pellets pierce +1 |
| DISCO | hats on the off-beats 3·7·11·15 | hats fire +1 needle |
| TRAP ROLL | 12+ hat notes | hat needles home |
| HALF-TIME | snare only on 9, bass present | bass beam ×2 width, +60% bass dmg |
| BREAKBEAT | kick 1·11 + snare 5·13, kick not on 9 | +12% move speed, +20% all dmg |
| CLAVE | any track on 1·4·7·11·13 | that track crits 25% more |
| DOWNBEAT | 4+ tracks on step 1 | step 1 detonates (bonus nova) |
| MINIMAL | 4+ tracks, no step shared | every note ×1.8 |
| WALL OF SOUND | 40+ total notes | +40% all dmg |
| POLYRHYTHM | any track on every 3rd step (1·4·7·10·13·16) | that track +1 projectile |

## Instruments (weapons)

| Track | Weapon | Default notes |
| --- | --- | --- |
| Kick | radial shockwave | 1·9 |
| Snare | 3-pellet spread | 5·13 |
| Hi-hat | fast needle | 3·7·11·15 |
| Clap | chain lightning | 5·13 |
| Bass | piercing beam (plays chord root) | 1 |
| Lead | homing note-missiles (arpeggiates chord) | 1·7·11 |
| Pad | healing slow aura | 1 |
| Crash | big blast at target | 1 |
| Tom | ricochet orbs | 15·16 |
| Cowbell | stunning bell ring | 4·12 |
| Scratch | vinyl boomerang, infinite pierce | 7·15 |
| Organ | pillars of light under enemies | 1·9 |
| Gong | time-freezing wave (legendary) | 1 |

Each instrument levels to 5. Level 5 + its partner unlocks an **evolution** (hidden until found).

## Security & engineering

- Static site, zero backend, zero third-party requests; strict CSP.
- Save data is schema-validated and clamped; a corrupt save resets instead of crashing.
- Seeds from the URL are validated against a strict pattern.
- DOM is built with `textContent` only (lint-enforced no `innerHTML`).
- Deterministic seeded RNG: share a seed with friends and play the same run (Daily Setlist).
- The CSP is injected at build time (`default-src 'none'`, path-scoped `script-src`,
  `require-trusted-types-for 'script'`), and `npm run verify:dist` fails the deploy if the
  built page ever loses it, gains an inline script, or ships dev-only code.
