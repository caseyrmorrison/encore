import { describe, expect, it } from 'vitest';
import { Transport } from '../src/audio/transport';

/** Pump like a 60fps game loop would, from `from` to `to`. */
function run(t: Transport, from: number, to: number): void {
  for (let now = from; now <= to; now += 1 / 60) t.pump(now);
}

describe('Transport', () => {
  it('schedules 16 steps per bar at the right times', () => {
    const t = new Transport(120);
    const times: number[] = [];
    t.onSchedule((ev) => times.push(ev.time));
    t.start(1);
    run(t, 1, 3); // two seconds = one bar at 120bpm
    expect(times.length).toBeGreaterThanOrEqual(16);
    expect(times[1]! - times[0]!).toBeCloseTo(0.125, 6);
  });

  it('drain only releases audible events and drops stale ones', () => {
    const t = new Transport(120);
    t.start(0);
    run(t, 0, 0.5);
    const got: number[] = [];
    t.drain(0.26, (ev) => got.push(ev.step));
    expect(got).toEqual([0, 1, 2]);
    const late: number[] = [];
    t.drain(5, (ev) => late.push(ev.step));
    expect(late).toEqual([]);
  });

  it('computes beat phase and grid offsets', () => {
    const t = new Transport(120);
    t.start(0);
    expect(t.beatPhase(0.25)).toBeCloseTo(0.5, 6);
    expect(t.offsetToGrid(0.49, 4)).toBeCloseTo(0.01, 6);
    expect(t.offsetToGrid(0.51, 4)).toBeCloseTo(-0.01, 6);
    expect(t.nextDownbeat(0.1)).toBeCloseTo(2, 6);
  });

  it('jumps forward after a long stall instead of machine-gunning', () => {
    const t = new Transport(120);
    let n = 0;
    t.onSchedule(() => n++);
    t.start(0);
    t.pump(100);
    expect(n).toBeLessThan(10);
  });
});
