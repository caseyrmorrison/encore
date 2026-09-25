import { AudioEngine } from '../audio/engine';
import { chordTone, PROGRESSIONS } from '../audio/theory';
import * as V from '../audio/voices';

/**
 * Dev-only mix meter: renders each voice offline through the real master chain and reports
 * peak / RMS in dBFS so the mix can be balanced without ears in the loop.
 */
export async function mixReport(): Promise<Record<string, { peak: number; rms: number }>> {
  const chord = PROGRESSIONS.basement.chords[0]!;
  const tones = [0, 1, 2, 3].map((k) => chordTone(chord, k, 0));
  const voices: Record<string, (e: AudioEngine, t: number) => void> = {
    kick: (e, t) => V.kick(e, t, 1),
    kick808: (e, t) => V.kick(e, t, 1, true),
    snare: (e, t) => V.snare(e, t, 1),
    hat: (e, t) => V.hat(e, t, 0.9),
    hatOpen: (e, t) => V.hat(e, t, 0.9, true),
    clap: (e, t) => V.clap(e, t, 1),
    tom: (e, t) => V.tom(e, t, 1),
    cowbell: (e, t) => V.cowbell(e, t, 1),
    crash: (e, t) => V.crash(e, t, 1),
    scratch: (e, t) => V.scratch(e, t, 1),
    gong: (e, t) => V.gong(e, t, 1),
    bass: (e, t) => V.bass(e, t, chordTone(chord, 0, -2), 0.25, 1, 0),
    wub: (e, t) => V.bass(e, t, chordTone(chord, 0, -2), 0.5, 1, 6),
    lead: (e, t) => V.lead(e, t, chordTone(chord, 1, 1), 1),
    pad: (e, t) => V.pad(e, t, tones, 1.2, 0.9, 0.6),
    organ: (e, t) => V.organ(e, t, tones.slice(0, 3), 1, 1),
    choir: (e, t) => V.choir(e, t, tones.slice(0, 2), 1, 1),
    plink: (e, t) => V.bell(e, t, 69, 1.25),
    pickup: (e, t) => V.bell(e, t, 93, 0.6, undefined, 0.18),
    riser: (e, t) => V.riser(e, t, 1.5),
    impact: (e, t) => V.impact(e, t, 1),
    whoosh: (e, t) => V.whoosh(e, t, 0.8),
    hurt: (e, t) => V.hurt(e, t),
    shh: (e, t) => V.shh(e, t, 0.8),
    tick: (e, t) => V.tick(e, t, 0.6),
    cheer: (e, t) => V.crowdCheer(e, t, 1, 2),
    roar: (e, t) => V.roar(e, t, 1),
    zap: (e, t) => V.zap(e, t, 0.6),
    uiClick: (e, t) => V.uiClick(e, t),
  };
  const out: Record<string, { peak: number; rms: number }> = {};
  const rate = 44100;
  for (const [name, fn] of Object.entries(voices)) {
    const ctx = new OfflineAudioContext(2, rate * 2.5, rate);
    const e = new AudioEngine(ctx);
    fn(e, 0.05);
    const buf = await ctx.startRendering();
    const d = buf.getChannelData(0);
    let peak = 0;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < d.length; i++) {
      const v = Math.abs(d[i]!);
      if (v > peak) peak = v;
      if (v > 1e-4) {
        sum += v * v;
        n++;
      }
    }
    const db = (x: number): number => +(20 * Math.log10(Math.max(1e-9, x))).toFixed(1);
    out[name] = { peak: db(peak), rms: db(Math.sqrt(sum / Math.max(1, n))) };
  }
  return out;
}

/** Worst-case density: every track on every step, ratchet ×4 — how fast can we render it? */
export async function densityReport(): Promise<{ audioSeconds: number; renderMs: number; realtimeFactor: number; voices: number }> {
  const rate = 44100;
  const seconds = 2;
  const ctx = new OfflineAudioContext(2, rate * seconds, rate);
  const e = new AudioEngine(ctx);
  await V.bakeDrumSamples(e);
  const chord = PROGRESSIONS.mainstage.chords[0]!;
  const step = 60 / 140 / 4;
  let voices = 0;
  for (let s = 0; s < 16; s++) {
    for (let k = 0; k < 4; k++) {
      const t = 0.05 + s * step + (k * step) / 4;
      V.kick(e, t, 0.8);
      V.snare(e, t, 0.8);
      V.hat(e, t, 0.8);
      V.clap(e, t, 0.8);
      V.tom(e, t, 0.8);
      V.cowbell(e, t, 0.8);
      V.bass(e, t, chordTone(chord, 0, -2), step / 4, 0.8, 0);
      V.lead(e, t, chordTone(chord, s % 4, 1), 0.8);
      voices += 8;
    }
  }
  const t0 = performance.now();
  await ctx.startRendering();
  const renderMs = performance.now() - t0;
  return { audioSeconds: seconds, renderMs: Math.round(renderMs), realtimeFactor: +((seconds * 1000) / renderMs).toFixed(2), voices };
}
