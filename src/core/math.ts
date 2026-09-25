export const TAU = Math.PI * 2;

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number): number => (b === a ? 0 : (v - a) / (b - a));

/** Frame-rate independent exponential smoothing. `rate` ≈ 1/seconds-to-settle. */
export const damp = (current: number, target: number, rate: number, dt: number): number =>
  lerp(current, target, 1 - Math.exp(-rate * dt));

export const wrapAngle = (a: number): number => {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
};

export const dampAngle = (current: number, target: number, rate: number, dt: number): number =>
  current + wrapAngle(target - current) * (1 - Math.exp(-rate * dt));

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
export const easeOutBack = (t: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
export const easeInOutSine = (t: number): number => -(Math.cos(Math.PI * t) - 1) / 2;
export const easeOutElastic = (t: number): number => {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
};

export const dist2 = (ax: number, az: number, bx: number, bz: number): number => {
  const dx = ax - bx;
  const dz = az - bz;
  return dx * dx + dz * dz;
};

/** Distance from point P to segment AB (all on the XZ plane), squared. */
export function segDist2(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const abx = bx - ax;
  const abz = bz - az;
  const len2 = abx * abx + abz * abz;
  let t = len2 > 0 ? ((px - ax) * abx + (pz - az) * abz) / len2 : 0;
  t = clamp01(t);
  const cx = ax + abx * t;
  const cz = az + abz * t;
  return dist2(px, pz, cx, cz);
}

export const formatInt = (n: number): string => {
  if (!Number.isFinite(n)) return '∞';
  const abs = Math.abs(n);
  if (abs < 1e4) return Math.round(n).toLocaleString('en-US');
  const units = ['', 'K', 'M', 'B', 'T', 'Qa', 'Qi', 'Sx', 'Sp', 'Oc', 'No', 'Dc'];
  let u = 0;
  let v = abs;
  while (v >= 1000 && u < units.length - 1) {
    v /= 1000;
    u++;
  }
  const s = v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
  return (n < 0 ? '-' : '') + s + units[u];
};

export const formatTime = (seconds: number): string => {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
