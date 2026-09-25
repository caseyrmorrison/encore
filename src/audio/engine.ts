/**
 * WebAudio master graph.
 *
 *  drums ─┐
 *  music ─┴─ duck (sidechain) ─┐
 *  crowd ── duck ──────────────┤
 *  sfx ────────────────────────┼─ pre ─ muffle(LP) ─ glue(comp) ─ limiter ─ master ─ analyser ─ out
 *  reverb/delay returns ───────┘
 *  ui ──────────────────────────────────────────────────────────── master
 */
export interface Buses {
  drums: GainNode;
  music: GainNode;
  crowd: GainNode;
  sfx: GainNode;
  ui: GainNode;
}

export class AudioEngine {
  readonly ctx: AudioContext;
  readonly offline: boolean;
  /** Pre-rendered drum hits (synthesised once at boot); voices fall back to live synthesis. */
  readonly samples = new Map<string, AudioBuffer>();
  readonly bus: Buses;
  readonly reverbSend: GainNode;
  readonly delaySend: GainNode;
  readonly analyser: AnalyserNode;
  readonly noise: AudioBuffer;
  readonly pinkNoise: AudioBuffer;
  readonly softClip: Float32Array<ArrayBuffer>;
  readonly hardClip: Float32Array<ArrayBuffer>;

  private readonly master: GainNode;
  private readonly musicVol: GainNode;
  private readonly sfxVol: GainNode;
  private readonly duck: GainNode;
  private readonly muffle: BiquadFilterNode;
  private readonly reverb: ConvolverNode;
  private readonly delay: DelayNode;
  private readonly delayFeedback: GainNode;
  private readonly freq: Uint8Array<ArrayBuffer>;
  private hitBudget = 0;
  private hitBudgetTime = 0;

  /**
   * Pass an OfflineAudioContext to render/measure sounds without a speaker. `dry` skips all
   * master processing (used to bake samples).
   */
  constructor(offlineCtx?: OfflineAudioContext, dry = false) {
    if (offlineCtx) {
      this.ctx = offlineCtx as unknown as AudioContext;
      this.offline = true;
    } else {
      const Ctor: typeof AudioContext =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor({ latencyHint: 'interactive' });
      this.offline = false;
    }
    const ctx = this.ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.72;
    this.freq = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount));
    this.master.connect(this.analyser);
    this.analyser.connect(ctx.destination);

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;
    limiter.connect(this.master);

    const glue = ctx.createDynamicsCompressor();
    glue.threshold.value = -16;
    glue.knee.value = 8;
    glue.ratio.value = 3;
    glue.attack.value = 0.01;
    glue.release.value = 0.2;
    glue.connect(limiter);

    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 20000;
    this.muffle.Q.value = 0.9;
    this.muffle.connect(glue);

    const pre = ctx.createGain();
    pre.connect(this.muffle);

    this.musicVol = ctx.createGain();
    this.musicVol.connect(pre);
    this.sfxVol = ctx.createGain();
    this.sfxVol.connect(pre);

    this.duck = ctx.createGain();
    this.duck.connect(this.musicVol);

    const mk = (dest: AudioNode, v = 1): GainNode => {
      const g = ctx.createGain();
      g.gain.value = v;
      g.connect(dest);
      return g;
    };
    this.bus = {
      drums: mk(this.musicVol, 0.9),
      music: mk(this.duck, 0.8),
      crowd: mk(this.duck, 0.5),
      sfx: mk(this.sfxVol, 0.85),
      ui: mk(this.master, 0.6),
    };

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(2.4, 2.6);
    this.reverbSend = ctx.createGain();
    this.reverbSend.connect(this.reverb);
    const reverbReturn = mk(pre, 0.55);
    this.reverb.connect(reverbReturn);

    this.delay = ctx.createDelay(2);
    this.delay.delayTime.value = 0.4;
    this.delayFeedback = ctx.createGain();
    this.delayFeedback.gain.value = 0.38;
    const delayTone = ctx.createBiquadFilter();
    delayTone.type = 'lowpass';
    delayTone.frequency.value = 3200;
    this.delaySend = ctx.createGain();
    this.delaySend.connect(this.delay);
    this.delay.connect(delayTone);
    delayTone.connect(this.delayFeedback);
    this.delayFeedback.connect(this.delay);
    const delayReturn = mk(pre, 0.5);
    delayTone.connect(delayReturn);

    this.noise = this.makeNoise(2, false);
    this.pinkNoise = this.makeNoise(3, true);
    if (dry) {
      for (const b of Object.values(this.bus)) {
        b.disconnect();
        b.connect(ctx.destination);
      }
      this.bus.drums.gain.value = 1;
      this.reverbSend.disconnect();
      this.delaySend.disconnect();
      this.duck.gain.value = 1;
    }
    this.softClip = makeCurve((x) => Math.tanh(x * 2.2));
    this.hardClip = makeCurve((x) => Math.max(-0.7, Math.min(0.7, x * 3)) / 0.7);
  }

  get now(): number {
    return this.ctx.currentTime;
  }

  /** Context time of what is audible *right now* (compensates output latency). */
  audibleTime(): number {
    const ctx = this.ctx;
    if (typeof ctx.getOutputTimestamp === 'function') {
      const ts = ctx.getOutputTimestamp();
      if (ts.contextTime !== undefined && ts.performanceTime !== undefined && ts.performanceTime > 0) {
        return ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
      }
    }
    return ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0);
  }

  get latency(): number {
    return this.ctx.outputLatency || this.ctx.baseLatency || 0;
  }

  async resume(): Promise<void> {
    if (this.ctx.state !== 'running') {
      try {
        await this.ctx.resume();
      } catch {
        /* user gesture missing; retried on next input */
      }
    }
  }

  suspend(): void {
    if (this.ctx.state === 'running') void this.ctx.suspend();
  }

  setVolumes(master: number, music: number, sfx: number): void {
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(master * 0.9, t, 0.05);
    this.musicVol.gain.setTargetAtTime(music, t, 0.05);
    this.sfxVol.gain.setTargetAtTime(sfx, t, 0.05);
  }

  /** 0 = open, 1 = heavily muffled (pause menu, being hit, the Hush's silence). */
  setMuffle(amount: number, tau = 0.08): void {
    const hz = 20000 * Math.pow(320 / 20000, Math.min(1, Math.max(0, amount)));
    this.muffle.frequency.setTargetAtTime(hz, this.ctx.currentTime, tau);
  }

  /** Sidechain pump triggered by kicks. */
  pump(t: number, depth = 0.55): void {
    const g = this.duck.gain;
    g.setTargetAtTime(1 - depth, t, 0.004);
    g.setTargetAtTime(1, t + 0.04, 0.085);
  }

  setTempo(bpm: number): void {
    const dotted8th = (60 / bpm) * 0.75;
    this.delay.delayTime.setTargetAtTime(dotted8th, this.ctx.currentTime, 0.1);
  }

  setRoom(seconds: number, decay: number, wet: number): void {
    this.reverb.buffer = this.makeImpulse(seconds, decay);
    this.reverbSend.gain.value = 1;
    (this.reverb as ConvolverNode).normalize = true;
    void wet;
  }

  /** Rate-limit tiny hit ticks so 200 simultaneous hits don't become white noise. */
  allowHit(maxPer50ms = 6): boolean {
    const t = this.ctx.currentTime;
    if (t - this.hitBudgetTime > 0.05) {
      this.hitBudgetTime = t;
      this.hitBudget = 0;
    }
    return ++this.hitBudget <= maxPer50ms;
  }

  /** Normalised spectrum energy in [0,1] for `bands` bands (for audio-reactive visuals). */
  spectrum(out: Float32Array): Float32Array {
    this.analyser.getByteFrequencyData(this.freq);
    const n = out.length;
    const bins = this.freq.length;
    for (let i = 0; i < n; i++) {
      // log-ish mapping so bass isn't squashed into one band
      const a = Math.floor(Math.pow(i / n, 1.7) * bins * 0.8);
      const b = Math.max(a + 1, Math.floor(Math.pow((i + 1) / n, 1.7) * bins * 0.8));
      let s = 0;
      for (let k = a; k < b; k++) s += this.freq[k]!;
      out[i] = s / (b - a) / 255;
    }
    return out;
  }

  noiseSource(t: number, pink = false): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = pink ? this.pinkNoise : this.noise;
    src.loop = true;
    const buf = src.buffer!;
    src.start(t, Math.random() * (buf.duration - 0.5));
    return src;
  }

  private makeNoise(seconds: number, pink: boolean): AudioBuffer {
    const len = Math.floor(this.ctx.sampleRate * seconds);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0,
      b1 = 0,
      b2 = 0,
      b3 = 0,
      b4 = 0,
      b5 = 0,
      b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (!pink) {
        d[i] = w;
        continue;
      }
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
    return buf;
  }

  private makeImpulse(seconds: number, decay: number): AudioBuffer {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // early reflections for the first 40ms, then a smooth diffuse tail
        const early = i < rate * 0.04 && Math.random() < 0.02 ? (Math.random() * 2 - 1) * 0.8 : 0;
        d[i] = ((Math.random() * 2 - 1) * Math.pow(1 - t, decay) + early) * (i < rate * 0.008 ? i / (rate * 0.008) : 1);
      }
    }
    return buf;
  }
}

function makeCurve(fn: (x: number) => number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) curve[i] = fn((i / (n - 1)) * 2 - 1);
  return curve;
}
