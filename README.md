# ENCORE

*A rhythm roguelite where your weapons are a drum machine.*

The Hush has swallowed every song in the universe. You are the last live microphone.
Every instrument you pick up becomes a track on a 16-step sequencer. Kick drums fire
shockwaves, snares fire spreads, hi-hats fire needles, bass fires beams, and all of it
**fires on the beat**. Compose well and the soundtrack gets louder, fuller and more
absurdly powerful until you're headlining the end of the world.

**▶ Play: https://caseyrmorrison.github.io/encore/**

## How to play

| Input | Action |
| --- | --- |
| `WASD` / arrows | move |
| Mouse | aim (or enable auto-aim in Settings) |
| `SPACE` / `SHIFT` | dash — **on the beat** for a PERFECT (shockwave + i-frames + hype) |
| `Q` / right-click | call the DROP when hype is full |
| `1` `2` `3` / click | pick a card |
| `R` | reroll |
| `ESC` | pause |
| `M` | mute |

Gamepads work too (left stick move, right stick aim, A/RB dash, B/LB drop).

**Phones and tablets:** drag anywhere on the left half to move, tap **DASH** (on the beat!)
and **DROP** on the right; weapons auto-aim. Landscape is best.

## Breaking the game (on purpose)

- **Notes are attacks.** More lit steps = more shots. Move notes around between rounds.
- **Chords.** Tracks sharing a step get a harmony bonus.
- **Step FX.** *Accent* doubles a step, *Ratchet* rolls it up to ×4, *Echo* repeats it.
- **Grooves.** Real rhythms are secret set bonuses: four-on-the-floor, backbeat, breakbeat,
  son clave, half-time dubstep, three-against-four… each discovered one is remembered.
- **Evolutions.** Max an instrument and meet its hidden condition to transform it.
- **Drops.** Fill hype, press `Q`: the game builds to the next downbeat and everything doubles.
- **Encore.** Beat all three venues and keep your build for an endless, faster encore loop.
- **Share a show.** Every run has a seed: *Copy result* or *Save poster* gives your friends a
  `?seed=` link to play the exact same set.

## Tech

- three.js + pmndrs/postprocessing (bloom, AgX tone mapping, chromatic aberration).
- Every model is procedural geometry built in code: the mic, the drum kits, pedals, the amp boss.
  Card art is rendered from those same models at startup.
- Every sound is synthesized live with WebAudio: drum voices, FM bells, formant choir,
  organ drawbars, a sample-accurate step scheduler and sidechain pumping.
- Deterministic seeded runs (`Daily Setlist` is the same run for everyone, every UTC day).
- Static site, no backend, no cookies, no network calls after load: a strict CSP
  (`default-src 'none'`, Trusted Types) is baked into the page at build time.

```bash
npm install
npm run dev        # http://localhost:5310
npm test           # vitest unit tests
npm run lint && npm run typecheck
npm run build      # static site in dist/
npm run shots      # scripted screenshots + FPS via local Chrome (dev server must be running)
node tools/shots.mjs touch --mobile --w=844 --h=390   # phone-sized touch run
```

See [docs/DESIGN.md](docs/DESIGN.md) for the design document and [SECURITY.md](SECURITY.md)
for the security posture.
