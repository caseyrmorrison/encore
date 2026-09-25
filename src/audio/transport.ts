/**
 * Sample-accurate step clock ("a tale of two clocks"): steps are scheduled into the
 * AudioContext slightly ahead of time, and the same events are queued for gameplay so
 * weapons fire exactly when their sound is heard.
 */
export interface StepEvent {
  /** 0..15 within the bar. */
  step: number;
  /** Bars since the transport started. */
  bar: number;
  /** Absolute AudioContext time of the step. */
  time: number;
  /** Seconds per 16th at the time of scheduling. */
  dur: number;
}

export const STEPS = 16;

export class Transport {
  bpm: number;
  step = 0;
  bar = 0;
  running = false;
  readonly lookahead = 0.12;
  private nextTime = 0;
  private pendingBpm: number | null = null;
  private readonly queue: StepEvent[] = [];
  private readonly schedulers: ((ev: StepEvent) => void)[] = [];
  /** anchor for continuous phase queries */
  private anchorTime = 0;
  private anchorSteps = 0;
  private stepsElapsed = 0;

  constructor(bpm: number) {
    this.bpm = bpm;
  }

  get stepDur(): number {
    return 60 / this.bpm / 4;
  }

  /** Time of the next step that has not been scheduled yet (for quantising one-shots). */
  get upcoming(): number {
    return this.nextTime;
  }

  /** Called when a step is scheduled (≈lookahead before it sounds). Schedule audio here. */
  onSchedule(fn: (ev: StepEvent) => void): () => void {
    this.schedulers.push(fn);
    return () => {
      const i = this.schedulers.indexOf(fn);
      if (i >= 0) this.schedulers.splice(i, 1);
    };
  }

  start(at: number): void {
    this.running = true;
    this.nextTime = at;
    this.step = 0;
    this.bar = 0;
    this.stepsElapsed = 0;
    this.anchorTime = at;
    this.anchorSteps = 0;
    this.queue.length = 0;
  }

  stop(): void {
    this.running = false;
    this.queue.length = 0;
  }

  setBpm(bpm: number): void {
    this.pendingBpm = Math.max(40, Math.min(400, bpm));
  }

  /** Schedule everything up to now + lookahead. Call every frame (and from a timer). */
  pump(now: number): void {
    if (!this.running) return;
    // If we fell badly behind (tab suspended, debugger), jump forward instead of machine-gunning.
    if (this.nextTime < now - 0.25) {
      const skip = Math.ceil((now - this.nextTime) / this.stepDur);
      for (let i = 0; i < skip; i++) this.advance();
      this.anchorTime = this.nextTime;
      this.anchorSteps = this.stepsElapsed;
    }
    while (this.nextTime < now + this.lookahead) {
      if (this.pendingBpm !== null && this.step % 4 === 0) {
        this.bpm = this.pendingBpm;
        this.pendingBpm = null;
        this.anchorTime = this.nextTime;
        this.anchorSteps = this.stepsElapsed;
      }
      const ev: StepEvent = { step: this.step, bar: this.bar, time: this.nextTime, dur: this.stepDur };
      for (const fn of this.schedulers) fn(ev);
      this.queue.push(ev);
      this.advance();
    }
  }

  private advance(): void {
    this.nextTime += this.stepDur;
    this.stepsElapsed++;
    this.step++;
    if (this.step >= STEPS) {
      this.step = 0;
      this.bar++;
    }
  }

  /** Pop every queued step whose audible time has arrived. */
  drain(audibleNow: number, fn: (ev: StepEvent) => void): void {
    while (this.queue.length > 0 && this.queue[0]!.time <= audibleNow) {
      const ev = this.queue.shift()!;
      // stale (e.g. after a long pause) → drop silently
      if (audibleNow - ev.time < 0.3) fn(ev);
    }
  }

  /** Continuous step position (fractional) at context time t. */
  positionAt(t: number): number {
    return this.anchorSteps + (t - this.anchorTime) / this.stepDur;
  }

  /** Phase within the current quarter-note beat in [0,1). */
  beatPhase(t: number): number {
    const p = this.positionAt(t) / 4;
    return p - Math.floor(p);
  }

  /** Phase within the current bar in [0,1). */
  barPhase(t: number): number {
    const p = this.positionAt(t) / STEPS;
    return p - Math.floor(p);
  }

  /** Signed seconds to the nearest 8th-note grid line (negative = late). */
  offsetToGrid(t: number, gridSteps = 2): number {
    const pos = this.positionAt(t) / gridSteps;
    const frac = pos - Math.round(pos);
    return -frac * gridSteps * this.stepDur;
  }

  /** Absolute time of the next bar's downbeat after t. */
  nextDownbeat(t: number): number {
    const pos = this.positionAt(t);
    const next = Math.ceil(pos / STEPS + 1e-6) * STEPS;
    return this.anchorTime + (next - this.anchorSteps) * this.stepDur;
  }
}
