import type { AudioEngine } from './engine';
import { midiToFreq } from './theory';

/**
 * Synthesised instrument voices. Every function schedules at absolute context time `t`
 * so the transport can queue notes ahead of time with sample accuracy.
 */

type Dest = AudioNode;

function gainEnv(e: AudioEngine, dest: Dest, t: number, peak: number, attack: number, decay: number): GainNode {
  const g = e.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + Math.max(0.001, attack));
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  g.connect(dest);
  return g;
}

function osc(e: AudioEngine, type: OscillatorType, freq: number, t: number, dur: number, dest: Dest): OscillatorNode {
  const o = e.ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.connect(dest);
  o.start(t);
  o.stop(t + dur + 0.05);
  return o;
}

function filter(e: AudioEngine, type: BiquadFilterType, freq: number, q: number, dest: Dest): BiquadFilterNode {
  const f = e.ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  f.connect(dest);
  return f;
}

function send(e: AudioEngine, from: AudioNode, reverb: number, delay = 0): void {
  if (reverb > 0) {
    const g = e.ctx.createGain();
    g.gain.value = reverb;
    from.connect(g);
    g.connect(e.reverbSend);
  }
  if (delay > 0) {
    const g = e.ctx.createGain();
    g.gain.value = delay;
    from.connect(g);
    g.connect(e.delaySend);
  }
}

function noiseBurst(e: AudioEngine, t: number, dur: number, dest: Dest, pink = false): AudioBufferSourceNode {
  const n = e.noiseSource(t, pink);
  n.connect(dest);
  n.stop(t + dur + 0.05);
  return n;
}

/* ───────────────────────────── DRUMS ───────────────────────────── */

export function kick(e: AudioEngine, t: number, vel = 1, big = false): void {
  const out = gainEnv(e, e.bus.drums, t, 1.05 * vel, 0.002, big ? 0.9 : 0.42);
  const shaper = e.ctx.createWaveShaper();
  shaper.curve = e.softClip;
  shaper.connect(out);
  const o = osc(e, 'sine', big ? 120 : 165, t, big ? 1 : 0.5, shaper);
  o.frequency.exponentialRampToValueAtTime(big ? 38 : 50, t + (big ? 0.14 : 0.075));
  o.frequency.exponentialRampToValueAtTime(big ? 30 : 42, t + (big ? 0.9 : 0.4));
  // beater click
  const clickG = gainEnv(e, e.bus.drums, t, 0.35 * vel, 0.001, 0.018);
  noiseBurst(e, t, 0.03, filter(e, 'highpass', 2500, 0.7, clickG));
  e.pump(t, big ? 0.75 : 0.55);
}

export function snare(e: AudioEngine, t: number, vel = 1): void {
  const nG = gainEnv(e, e.bus.drums, t, 0.62 * vel, 0.001, 0.2);
  const hp = filter(e, 'highpass', 1100, 0.6, nG);
  noiseBurst(e, t, 0.25, filter(e, 'peaking', 3400, 1, hp));
  const bodyG = gainEnv(e, e.bus.drums, t, 0.55 * vel, 0.001, 0.11);
  const o = osc(e, 'triangle', 210, t, 0.15, bodyG);
  o.frequency.exponentialRampToValueAtTime(165, t + 0.08);
  send(e, nG, 0.25);
}

const HAT_RATIOS = [2, 3, 4.16, 5.43, 6.79, 8.21];
export function hat(e: AudioEngine, t: number, vel = 1, open = false): void {
  const dec = open ? 0.32 : 0.045;
  const g = gainEnv(e, e.bus.drums, t, 0.26 * vel, 0.001, dec);
  const hp = filter(e, 'highpass', 7200, 0.8, g);
  const bp = filter(e, 'bandpass', 10500, 0.9, hp);
  for (const r of HAT_RATIOS) osc(e, 'square', 40 * r * 1.6, t, dec + 0.02, bp);
  const nG = gainEnv(e, e.bus.drums, t, 0.12 * vel, 0.001, dec * 0.8);
  noiseBurst(e, t, dec + 0.02, filter(e, 'highpass', 9000, 0.7, nG));
}

export function clap(e: AudioEngine, t: number, vel = 1): void {
  const g = e.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  // three slapback transients then a tail — the classic 808 clap
  for (let i = 0; i < 3; i++) {
    const s = t + i * 0.011;
    g.gain.setValueAtTime(0.75 * vel, s);
    g.gain.exponentialRampToValueAtTime(0.08, s + 0.009);
  }
  g.gain.setValueAtTime(0.5 * vel, t + 0.034);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
  g.connect(e.bus.drums);
  const bp = filter(e, 'bandpass', 1150, 1.3, g);
  noiseBurst(e, t, 0.3, bp);
  send(e, g, 0.35);
}

export function tom(e: AudioEngine, t: number, vel = 1, pitch = 0): void {
  const f = 190 * Math.pow(2, pitch / 12);
  const g = gainEnv(e, e.bus.drums, t, 0.8 * vel, 0.002, 0.34);
  const o = osc(e, 'sine', f, t, 0.4, g);
  o.frequency.exponentialRampToValueAtTime(f * 0.62, t + 0.25);
  const nG = gainEnv(e, e.bus.drums, t, 0.18 * vel, 0.001, 0.05);
  noiseBurst(e, t, 0.06, filter(e, 'lowpass', 3000, 0.7, nG));
  send(e, g, 0.2);
}

export function cowbell(e: AudioEngine, t: number, vel = 1): void {
  const g = e.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.5 * vel, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.18 * vel, t + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
  g.connect(e.bus.drums);
  const bp = filter(e, 'bandpass', 2000, 1.4, g);
  osc(e, 'square', 562, t, 0.36, bp);
  osc(e, 'square', 845, t, 0.36, bp);
  send(e, g, 0.2);
}

export function crash(e: AudioEngine, t: number, vel = 1): void {
  const g = gainEnv(e, e.bus.drums, t, 0.42 * vel, 0.002, 1.7);
  const hp = filter(e, 'highpass', 4200, 0.6, g);
  noiseBurst(e, t, 1.8, hp);
  const mg = gainEnv(e, e.bus.drums, t, 0.1 * vel, 0.002, 1.2);
  const bp = filter(e, 'bandpass', 8200, 0.5, mg);
  for (const r of HAT_RATIOS) osc(e, 'square', 57 * r * 1.9, t, 1.3, bp);
  send(e, g, 0.5);
}

export function scratch(e: AudioEngine, t: number, vel = 1, dur = 0.16): void {
  const g = gainEnv(e, e.bus.drums, t, 0.55 * vel, 0.004, dur);
  const bp = filter(e, 'bandpass', 900, 3.2, g);
  const src = noiseBurst(e, t, dur + 0.05, bp);
  src.playbackRate.setValueAtTime(0.5, t);
  bp.frequency.setValueAtTime(500, t);
  bp.frequency.exponentialRampToValueAtTime(2600, t + dur * 0.45);
  bp.frequency.exponentialRampToValueAtTime(700, t + dur);
  const saw = e.ctx.createGain();
  saw.gain.value = 0.25;
  saw.connect(bp);
  const o = osc(e, 'sawtooth', 180, t, dur, saw);
  o.frequency.setValueAtTime(180, t);
  o.frequency.exponentialRampToValueAtTime(520, t + dur * 0.45);
  o.frequency.exponentialRampToValueAtTime(140, t + dur);
}

const GONG_PARTIALS = [1, 1.47, 1.93, 2.41, 3.09, 4.17, 5.2];
export function gong(e: AudioEngine, t: number, vel = 1): void {
  const base = 73;
  GONG_PARTIALS.forEach((p, i) => {
    const g = gainEnv(e, e.bus.drums, t, (0.3 / (i + 1)) * vel, 0.02 + i * 0.01, 3.6 - i * 0.3);
    const o = osc(e, 'sine', base * p, t, 3.8, g);
    o.frequency.exponentialRampToValueAtTime(base * p * 0.985, t + 3);
    send(e, g, 0.6);
  });
  const ng = gainEnv(e, e.bus.drums, t, 0.1 * vel, 0.2, 1.4);
  noiseBurst(e, t, 1.8, filter(e, 'bandpass', 2400, 0.7, ng));
}

/* ───────────────────────────── TONAL ───────────────────────────── */

export function bass(e: AudioEngine, t: number, midi: number, dur: number, vel = 1, wub = 0): void {
  const f = midiToFreq(midi);
  const out = e.ctx.createGain();
  out.gain.setValueAtTime(0.0001, t);
  out.gain.exponentialRampToValueAtTime(0.5 * vel, t + 0.006);
  out.gain.setTargetAtTime(0.34 * vel, t + 0.03, 0.08);
  out.gain.setTargetAtTime(0.0001, t + dur, 0.04);
  out.connect(e.bus.music);
  const shaper = e.ctx.createWaveShaper();
  shaper.curve = e.softClip;
  shaper.connect(out);
  const lp = filter(e, 'lowpass', 2400, 7, shaper);
  lp.frequency.setValueAtTime(wub > 0 ? 300 : 2600, t);
  if (wub > 0) {
    // LFO wobble synced to 8th-note triplets-ish
    const lfo = e.ctx.createOscillator();
    lfo.frequency.value = wub;
    const depth = e.ctx.createGain();
    depth.gain.value = 1100;
    lfo.connect(depth);
    depth.connect(lp.frequency);
    lfo.start(t);
    lfo.stop(t + dur + 0.3);
    lp.frequency.setValueAtTime(1200, t);
  } else {
    lp.frequency.exponentialRampToValueAtTime(190, t + 0.26);
  }
  osc(e, 'sawtooth', f, t, dur + 0.25, lp);
  const sq = e.ctx.createGain();
  sq.gain.value = 0.6;
  sq.connect(lp);
  osc(e, 'square', f * 0.5, t, dur + 0.25, sq);
  const subG = e.ctx.createGain();
  subG.gain.value = 0.55;
  subG.connect(out);
  osc(e, 'sine', f * 0.5, t, dur + 0.25, subG);
}

export function lead(e: AudioEngine, t: number, midi: number, vel = 1, dur = 0.18): void {
  const f = midiToFreq(midi);
  const g = gainEnv(e, e.bus.music, t, 0.2 * vel, 0.004, dur + 0.12);
  const lp = filter(e, 'lowpass', 5200, 3, g);
  lp.frequency.setValueAtTime(5200, t);
  lp.frequency.exponentialRampToValueAtTime(900, t + dur + 0.1);
  for (const det of [-9, 9]) {
    const o = osc(e, 'sawtooth', f, t, dur + 0.15, lp);
    o.detune.value = det;
  }
  const sq = e.ctx.createGain();
  sq.gain.value = 0.5;
  sq.connect(lp);
  osc(e, 'square', f * 2, t, dur + 0.15, sq);
  send(e, g, 0.25, 0.35);
}

export function pad(e: AudioEngine, t: number, midis: number[], dur: number, vel = 1, bright = 0.5): void {
  const g = e.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.1 * vel, t + Math.min(0.35, dur * 0.4));
  g.gain.setTargetAtTime(0.0001, t + dur, 0.35);
  g.connect(e.bus.music);
  const lp = filter(e, 'lowpass', 700 + bright * 2400, 0.7, g);
  for (const m of midis) {
    for (const det of [-11, 0, 12]) {
      const o = osc(e, 'sawtooth', midiToFreq(m), t, dur + 1.4, lp);
      o.detune.value = det;
    }
  }
  send(e, g, 0.8);
}

export function organ(e: AudioEngine, t: number, midis: number[], dur: number, vel = 1): void {
  const g = e.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.085 * vel, t + 0.03);
  g.gain.setTargetAtTime(0.0001, t + dur, 0.25);
  g.connect(e.bus.music);
  const drawbars = [
    [0.5, 0.6],
    [1, 1],
    [2, 0.55],
    [3, 0.35],
    [4, 0.3],
    [6, 0.16],
    [8, 0.12],
  ] as const;
  for (const m of midis) {
    const f = midiToFreq(m);
    for (const [h, a] of drawbars) {
      const pg = e.ctx.createGain();
      pg.gain.value = a;
      pg.connect(g);
      osc(e, 'sine', f * h, t, dur + 1, pg);
    }
  }
  send(e, g, 0.9);
}

/** Formant "aah" voice for choir stabs and fanfares. */
export function choir(e: AudioEngine, t: number, midis: number[], dur: number, vel = 1): void {
  const g = e.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(0.16 * vel, t + 0.12);
  g.gain.setTargetAtTime(0.0001, t + dur, 0.3);
  g.connect(e.bus.music);
  const formants = [
    [800, 0.9],
    [1150, 0.5],
    [2900, 0.25],
  ] as const;
  const mix = e.ctx.createGain();
  for (const [fq, a] of formants) {
    const fg = e.ctx.createGain();
    fg.gain.value = a;
    fg.connect(g);
    const bp = filter(e, 'bandpass', fq, 7, fg);
    mix.connect(bp);
  }
  for (const m of midis) {
    for (const det of [-14, 6, 17]) {
      const o = osc(e, 'sawtooth', midiToFreq(m), t, dur + 1, mix);
      o.detune.value = det;
      const vib = e.ctx.createOscillator();
      vib.frequency.value = 5 + Math.random();
      const vd = e.ctx.createGain();
      vd.gain.value = 9;
      vib.connect(vd);
      vd.connect(o.detune);
      vib.start(t);
      vib.stop(t + dur + 1);
    }
  }
  send(e, g, 1);
}

/** FM bell — kill "plinks", pickups, UI sparkle. */
export function bell(e: AudioEngine, t: number, midi: number, vel = 1, dest?: AudioNode, decay = 0.5): void {
  const f = midiToFreq(midi);
  const g = gainEnv(e, dest ?? e.bus.sfx, t, 0.16 * vel, 0.002, decay);
  const car = osc(e, 'sine', f, t, decay + 0.05, g);
  const mod = e.ctx.createOscillator();
  mod.frequency.value = f * 3.5;
  const idx = e.ctx.createGain();
  idx.gain.setValueAtTime(f * 1.6, t);
  idx.gain.exponentialRampToValueAtTime(1, t + decay * 0.7);
  mod.connect(idx);
  idx.connect(car.frequency);
  mod.start(t);
  mod.stop(t + decay + 0.05);
  send(e, g, 0.3, 0.15);
}

/* ───────────────────────────── FX ───────────────────────────── */

export function riser(e: AudioEngine, t: number, dur: number): void {
  const g = e.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.35, t + dur);
  g.gain.setValueAtTime(0.0001, t + dur + 0.01);
  g.connect(e.bus.sfx);
  const bp = filter(e, 'bandpass', 300, 2.5, g);
  bp.frequency.setValueAtTime(300, t);
  bp.frequency.exponentialRampToValueAtTime(9000, t + dur);
  noiseBurst(e, t, dur + 0.05, bp);
  const sg = e.ctx.createGain();
  sg.gain.value = 0.25;
  sg.connect(g);
  for (const det of [-20, 20]) {
    const o = osc(e, 'sawtooth', 110, t, dur, sg);
    o.detune.value = det;
    o.frequency.exponentialRampToValueAtTime(880, t + dur);
  }
  send(e, g, 0.4);
}

export function impact(e: AudioEngine, t: number, vel = 1): void {
  const g = gainEnv(e, e.bus.sfx, t, 1.0 * vel, 0.003, 1.6);
  const sh = e.ctx.createWaveShaper();
  sh.curve = e.softClip;
  sh.connect(g);
  const o = osc(e, 'sine', 70, t, 1.7, sh);
  o.frequency.exponentialRampToValueAtTime(28, t + 1.4);
  const ng = gainEnv(e, e.bus.sfx, t, 0.6 * vel, 0.002, 0.9);
  noiseBurst(e, t, 1, filter(e, 'lowpass', 1800, 0.7, ng));
  send(e, ng, 0.6);
  e.pump(t, 0.9);
}

export function whoosh(e: AudioEngine, t: number, vel = 1, up = true, dur = 0.25): void {
  const g = e.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.3 * vel, t + dur * 0.6);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  g.connect(e.bus.sfx);
  const bp = filter(e, 'bandpass', up ? 400 : 4000, 1.4, g);
  bp.frequency.exponentialRampToValueAtTime(up ? 5000 : 350, t + dur);
  noiseBurst(e, t, dur + 0.05, bp);
}

export function hurt(e: AudioEngine, t: number): void {
  const g = gainEnv(e, e.bus.sfx, t, 0.6, 0.002, 0.28);
  const sh = e.ctx.createWaveShaper();
  sh.curve = e.hardClip;
  sh.connect(g);
  const o = osc(e, 'square', 150, t, 0.3, sh);
  o.frequency.exponentialRampToValueAtTime(55, t + 0.25);
  const ng = gainEnv(e, e.bus.sfx, t, 0.3, 0.001, 0.12);
  noiseBurst(e, t, 0.15, filter(e, 'lowpass', 1200, 1, ng));
}

/** The Hush dies: a breathy reversed "shh". */
export function shh(e: AudioEngine, t: number, vel = 1): void {
  const g = e.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.09 * vel, t + 0.05);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
  g.connect(e.bus.sfx);
  noiseBurst(e, t, 0.14, filter(e, 'bandpass', 5200, 1.6, g));
}

export function tick(e: AudioEngine, t: number, vel = 1): void {
  const g = gainEnv(e, e.bus.sfx, t, 0.08 * vel, 0.001, 0.025);
  noiseBurst(e, t, 0.04, filter(e, 'bandpass', 2600 + Math.random() * 1200, 2, g));
}

export function uiClick(e: AudioEngine, t: number, pitch = 0): void {
  const g = gainEnv(e, e.bus.ui, t, 0.3, 0.001, 0.06);
  const o = osc(e, 'triangle', 1300 * Math.pow(2, pitch / 12), t, 0.08, g);
  o.frequency.exponentialRampToValueAtTime(700 * Math.pow(2, pitch / 12), t + 0.05);
}

export function uiHover(e: AudioEngine, t: number, pitch = 0): void {
  const g = gainEnv(e, e.bus.ui, t, 0.08, 0.001, 0.03);
  osc(e, 'sine', 2200 * Math.pow(2, pitch / 12), t, 0.04, g);
}

export function uiError(e: AudioEngine, t: number): void {
  const g = gainEnv(e, e.bus.ui, t, 0.2, 0.002, 0.18);
  osc(e, 'square', 140, t, 0.2, filter(e, 'lowpass', 900, 1, g));
  osc(e, 'square', 147, t, 0.2, filter(e, 'lowpass', 900, 1, g));
}

export function crowdCheer(e: AudioEngine, t: number, size = 1, dur = 2.2): void {
  const g = e.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.42 * size, t + 0.25);
  g.gain.setTargetAtTime(0.0001, t + dur * 0.45, dur * 0.25);
  g.connect(e.bus.crowd);
  // many throats: detuned formant bands with fast random amplitude flutter
  const bands = [520, 780, 1150, 1650, 2400, 3300];
  for (const fq of bands) {
    const bg = e.ctx.createGain();
    bg.gain.value = 0.5;
    const lfo = e.ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 5 + Math.random() * 9;
    const ld = e.ctx.createGain();
    ld.gain.value = 0.35;
    lfo.connect(ld);
    ld.connect(bg.gain);
    lfo.start(t);
    lfo.stop(t + dur + 1);
    bg.connect(g);
    const bp = filter(e, 'bandpass', fq * (0.9 + Math.random() * 0.2), 2.2, bg);
    noiseBurst(e, t, dur + 1, bp, true);
  }
  send(e, g, 0.7);
}

export function roar(e: AudioEngine, t: number, vel = 1): void {
  const g = gainEnv(e, e.bus.sfx, t, 0.55 * vel, 0.08, 1.8);
  const sh = e.ctx.createWaveShaper();
  sh.curve = e.hardClip;
  const lp = filter(e, 'lowpass', 1400, 2, g);
  lp.frequency.exponentialRampToValueAtTime(220, t + 1.6);
  sh.connect(lp);
  for (const f of [55, 58.3, 82.4, 110.6]) {
    const o = osc(e, 'sawtooth', f, t, 1.9, sh);
    o.frequency.exponentialRampToValueAtTime(f * 0.7, t + 1.7);
  }
  const ng = gainEnv(e, e.bus.sfx, t, 0.3 * vel, 0.05, 1.2);
  noiseBurst(e, t, 1.4, filter(e, 'bandpass', 600, 0.8, ng));
  send(e, g, 0.5);
}

export function zap(e: AudioEngine, t: number, vel = 1): void {
  const g = gainEnv(e, e.bus.sfx, t, 0.12 * vel, 0.001, 0.09);
  const o = osc(e, 'sawtooth', 2400, t, 0.1, filter(e, 'highpass', 900, 1, g));
  o.frequency.exponentialRampToValueAtTime(300, t + 0.09);
}
