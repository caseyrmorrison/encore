/**
 * Dev-only section profiler. In production builds `enabled` is false and every call is a
 * cheap early-return, so it can stay in hot paths.
 */
const enabled = import.meta.env.DEV;
const stats = new Map<string, { max: number; sum: number; n: number }>();
const starts = new Map<string, number>();

export const prof = {
  begin(name: string): void {
    if (!enabled) return;
    starts.set(name, performance.now());
  },
  end(name: string): void {
    if (!enabled) return;
    const t0 = starts.get(name);
    if (t0 === undefined) return;
    const d = performance.now() - t0;
    let s = stats.get(name);
    if (!s) stats.set(name, (s = { max: 0, sum: 0, n: 0 }));
    s.max = Math.max(s.max, d);
    s.sum += d;
    s.n++;
  },
  report(): Record<string, { max: number; avg: number }> {
    const out: Record<string, { max: number; avg: number }> = {};
    for (const [k, v] of stats) out[k] = { max: +v.max.toFixed(2), avg: +(v.sum / Math.max(1, v.n)).toFixed(3) };
    return out;
  },
  reset(): void {
    stats.clear();
  },
};
