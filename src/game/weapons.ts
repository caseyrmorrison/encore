import * as THREE from 'three';
import { INSTRUMENTS, type InstrumentId } from '../seq/instruments';
import type { Track } from '../seq/pattern';
import { GroundKind, Shape, type BeamFx, type GroundFx, type ParticleSystem } from '../render/fx';
import { segDist2 } from '../core/math';
import type { Enemy, EnemyManager } from './enemies';
import type { ProjectileManager } from './projectiles';
import type { Run } from './run';

export interface HitOpts {
  color: THREE.Color;
  inst: InstrumentId | null;
  kx?: number;
  kz?: number;
  knock?: number;
  crit?: boolean;
  stun?: number;
  freeze?: number;
  slow?: number;
  /** skip the number popup (e.g. aura ticks) */
  quiet?: boolean;
}

export interface WeaponCtx {
  run: Run;
  enemies: EnemyManager;
  projectiles: ProjectileManager;
  glow: ParticleSystem;
  ground: GroundFx;
  beams: BeamFx;
  px: number;
  pz: number;
  /** unit aim vector on the ground plane */
  aimX: number;
  aimZ: number;
  /** true when the player is steering aim with the mouse / right stick */
  manualAim: boolean;
  origin(inst: InstrumentId): { x: number; z: number };
  damage(e: Enemy, amount: number, o: HitOpts): void;
  heal(n: number): void;
  shake(n: number): void;
  ripple(x: number, z: number, color: THREE.Color, strength?: number): void;
  schedule(delay: number, fn: () => void): void;
}

export interface FireInfo {
  step: number;
  /** harmony × accent × echo × drop multiplier */
  mult: number;
  accent: boolean;
  /** true for echo/looper repeats (smaller visuals) */
  ghost: boolean;
}

const lv = (t: Track, n: number): number => (t.level >= n ? 1 : 0);
const colorCache = new Map<InstrumentId, THREE.Color>();
export const instColor = (id: InstrumentId): THREE.Color => {
  let c = colorCache.get(id);
  if (!c) {
    c = new THREE.Color(INSTRUMENTS[id].color);
    colorCache.set(id, c);
  }
  return c;
};

/** Pre-crit damage for one hit of this track. */
function base(ctx: WeaponCtx, _t: Track, dmg: number, info: FireInfo): number {
  return dmg * info.mult * ctx.run.stats.dmgMult;
}

function critRoll(ctx: WeaponCtx, t: Track): boolean {
  const bonus = ctx.run.grooves.claveTracks.has(t.inst) ? 0.25 : 0;
  return Math.random() < ctx.run.stats.critChance + bonus;
}

function withCrit(ctx: WeaponCtx, t: Track, dmg: number): { dmg: number; crit: boolean } {
  const crit = critRoll(ctx, t);
  return { dmg: crit ? dmg * ctx.run.stats.critMult : dmg, crit };
}

function aimAt(ctx: WeaponCtx, ox: number, oz: number, range: number): { x: number; z: number } {
  if (ctx.manualAim) return { x: ctx.aimX, z: ctx.aimZ };
  const e = ctx.enemies.nearest(ox, oz, range);
  if (e) {
    const dx = e.x - ox;
    const dz = e.z - oz;
    const d = Math.hypot(dx, dz) || 1;
    return { x: dx / d, z: dz / d };
  }
  return { x: ctx.aimX, z: ctx.aimZ };
}

function extra(ctx: WeaponCtx, t: Track): number {
  return ctx.run.grooves.polyTracks.has(t.inst) ? 1 : 0;
}

/** Radial blast that damages everything within r. */
function blast(
  ctx: WeaponCtx,
  t: Track,
  x: number,
  z: number,
  r: number,
  dmg: number,
  knock: number,
  extraHit: Partial<HitOpts> = {},
): number {
  let hits = 0;
  const color = instColor(t.inst);
  ctx.enemies.hash.query(x, z, r + 1.5, (i) => {
    const e = ctx.enemies.list[i]!;
    if (!e.alive) return;
    const dx = e.x - x;
    const dz = e.z - z;
    const d = Math.hypot(dx, dz);
    if (d > r + e.radius) return;
    const c = withCrit(ctx, t, dmg);
    ctx.damage(e, c.dmg, {
      color,
      inst: t.inst,
      kx: dx / (d || 1),
      kz: dz / (d || 1),
      knock: knock * (1 - (d / (r + e.radius)) * 0.5),
      crit: c.crit,
      ...extraHit,
    });
    hits++;
  });
  return hits;
}

export function fireTrack(ctx: WeaponCtx, t: Track, info: FireInfo): void {
  const o = ctx.origin(t.inst);
  const color = instColor(t.inst);
  const st = ctx.run.stats;
  const g = ctx.run.grooves.active;
  const ghost = info.ghost ? 0.6 : 1;
  const acc = info.accent ? 1.35 : 1;

  switch (t.inst) {
    case 'kick': {
      const four = g.has('four');
      let dmg = 16 * (1 + 0.3 * lv(t, 2) + 0.3 * lv(t, 4)) * (four ? 1.35 : 1);
      let r = 3.6 * (1 + 0.25 * lv(t, 3) + 0.25 * lv(t, 5)) * st.area * acc;
      let knock = (7 + 4 * lv(t, 5)) * (four ? 2 : 1);
      if (t.evolved) {
        dmg *= 1.5;
        r *= 1.9;
        knock *= 1.3;
      }
      const d = base(ctx, t, dmg, info);
      // kicks come from the player, not the orbiting drum
      blast(ctx, t, ctx.px, ctx.pz, r, d, knock);
      ctx.ground.add(GroundKind.Shock, ctx.px, ctx.pz, 0.5, r, 0.32, color, { thickness: 0.07, alpha: 0.85 * ghost });
      ctx.ground.add(GroundKind.Disc, ctx.px, ctx.pz, r * 0.5, r * 0.9, 0.14, color, { alpha: 0.1 * ghost });
      ctx.ripple(ctx.px, ctx.pz, color, 0.35 * ghost);
      ctx.shake(0.12 * ghost * acc);
      if (t.evolved) {
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2 + Math.random() * 0.4;
          const L = r * 1.6;
          const ex = ctx.px + Math.cos(a) * L;
          const ez = ctx.pz + Math.sin(a) * L;
          ctx.beams.add(ctx.px, 0.15, ctx.pz, ex, 0.15, ez, 0.35, 0xff7a2e, 0.5);
          lineDamage(ctx, t, ctx.px, ctx.pz, ex, ez, 0.8, d * 0.5, color);
        }
        ctx.ground.add(GroundKind.Crack, ctx.px, ctx.pz, r * 1.2, r * 1.2, 0.8, 0xff7a2e, { fixed: true, alpha: 0.8 });
      }
      break;
    }
    case 'snare': {
      const n = 3 + lv(t, 2) + lv(t, 4) + extra(ctx, t);
      const dmg = base(ctx, t, 8 * (1 + 0.3 * lv(t, 3) + 0.3 * lv(t, 5)), info);
      const pierce = lv(t, 5) + (g.has('backbeat') ? 1 : 0) + st.pierce;
      const a = aimAt(ctx, o.x, o.z, 18);
      const ang0 = Math.atan2(a.z, a.x);
      const spread = 0.5;
      for (let k = 0; k < n; k++) {
        const ang = ang0 + (n === 1 ? 0 : (k / (n - 1) - 0.5) * spread) + (Math.random() - 0.5) * 0.05;
        const sp = 30 * st.projSpeed;
        const c = withCrit(ctx, t, dmg);
        ctx.projectiles.spawn({
          kind: 'pellet',
          inst: t.inst,
          x: o.x,
          z: o.z,
          vx: Math.cos(ang) * sp,
          vz: Math.sin(ang) * sp,
          dmg: c.dmg,
          crit: c.crit,
          radius: 0.4 * acc,
          life: (16 * st.range) / sp,
          pierce,
          color,
          accent: info.accent,
          splitOnHit: t.evolved ? 2 : 0,
          bounces: t.evolved ? 2 : 0,
        });
      }
      ctx.glow.burst(o.x, 1, o.z, 6, color, 6, { life: 0.25, size: 0.4 });
      break;
    }
    case 'hat': {
      let n = 1 + lv(t, 5) + (g.has('disco') ? 1 : 0) + extra(ctx, t);
      if (t.evolved) n *= 5;
      const dmg = base(ctx, t, 7 * (1 + 0.3 * lv(t, 2) + 0.3 * lv(t, 4)), info);
      const a = aimAt(ctx, o.x, o.z, 20);
      const ang0 = Math.atan2(a.z, a.x);
      for (let k = 0; k < n; k++) {
        const ang = ang0 + (n === 1 ? 0 : (k / (n - 1) - 0.5) * (t.evolved ? 0.45 : 0.2));
        const sp = 46 * st.projSpeed;
        const c = withCrit(ctx, t, dmg);
        ctx.projectiles.spawn({
          kind: 'needle',
          inst: t.inst,
          x: o.x,
          z: o.z,
          vx: Math.cos(ang) * sp,
          vz: Math.sin(ang) * sp,
          dmg: c.dmg,
          crit: c.crit,
          radius: 0.28,
          life: (20 * st.range) / sp,
          pierce: lv(t, 3) + st.pierce,
          homing: g.has('trap') ? 7 : 0,
          color,
        });
      }
      break;
    }
    case 'clap': {
      const jumps = 3 + lv(t, 2) + 2 * lv(t, 4);
      const bolts = 1 + lv(t, 5) + extra(ctx, t);
      const dmg = base(ctx, t, 12 * (1 + 0.3 * lv(t, 3) + 0.3 * lv(t, 5)), info);
      for (let b = 0; b < bolts; b++) {
        const hit = new Set<number>();
        let fx = o.x;
        let fz = o.z;
        let cur = ctx.enemies.nearest(fx, fz, 11, hit);
        for (let j = 0; j < jumps && cur; j++) {
          hit.add(cur.id);
          ctx.beams.bolt(fx, fz, cur.x, cur.z, color, 0.32 * acc, 0.2);
          ctx.beams.bolt(fx, fz, cur.x, cur.z, 0xffffff, 0.12, 0.12);
          const c = withCrit(ctx, t, dmg);
          ctx.damage(cur, c.dmg, { color, inst: t.inst, crit: c.crit, stun: 0.12 });
          ctx.glow.burst(cur.x, 1, cur.z, 5, color, 5, { life: 0.25, size: 0.35, shape: Shape.Spark });
          fx = cur.x;
          fz = cur.z;
          if (t.evolved) {
            const fork = ctx.enemies.nearest(fx, fz, 7, hit);
            if (fork) {
              ctx.beams.bolt(fx, fz, fork.x, fork.z, color, 0.25, 0.18);
              ctx.damage(fork, c.dmg * 0.7, { color, inst: t.inst });
            }
          }
          cur = ctx.enemies.nearest(fx, fz, 8, hit);
        }
      }
      break;
    }
    case 'bass': {
      const half = g.has('halftime');
      const dmg = base(ctx, t, 18 * (1 + 0.3 * lv(t, 2) + 0.3 * lv(t, 4)) * (half ? 1.6 : 1), info);
      const width = 0.9 * (1 + 0.35 * lv(t, 3)) * (half ? 2 : 1) * (t.evolved ? 1.5 : 1) * acc;
      const len = 15 * (1 + 0.4 * lv(t, 5)) * st.range;
      const a = aimAt(ctx, o.x, o.z, len);
      const ang0 = Math.atan2(a.z, a.x);
      const fan = t.evolved ? [-0.35, 0, 0.35] : [0];
      const beams = fan.length + extra(ctx, t);
      for (let k = 0; k < beams; k++) {
        const ang = ang0 + (fan[k] ?? (k % 2 ? 0.6 : -0.6)) + (t.evolved ? Math.sin(performance.now() / 120) * 0.25 : 0);
        const ex = o.x + Math.cos(ang) * len;
        const ez = o.z + Math.sin(ang) * len;
        lineDamage(ctx, t, o.x, o.z, ex, ez, width, dmg, color);
        ctx.beams.add(o.x, 1, o.z, ex, 1, ez, width * 2.2, color, 0.22 * (lv(t, 5) ? 1.6 : 1));
        ctx.beams.add(o.x, 1, o.z, ex, 1, ez, width * 0.7, 0xffffff, 0.14);
      }
      ctx.shake(0.08);
      break;
    }
    case 'lead': {
      const n = 1 + lv(t, 3) + lv(t, 5) + extra(ctx, t);
      const dmg = base(ctx, t, 13 * (1 + 0.3 * lv(t, 2) + 0.3 * lv(t, 4)), info);
      for (let k = 0; k < n; k++) {
        const ang = Math.random() * Math.PI * 2;
        const sp = (12 + lv(t, 5) * 4) * st.projSpeed;
        const c = withCrit(ctx, t, dmg);
        ctx.projectiles.spawn({
          kind: 'missile',
          inst: t.inst,
          x: o.x,
          z: o.z,
          vx: Math.cos(ang) * sp,
          vz: Math.sin(ang) * sp,
          dmg: c.dmg,
          crit: c.crit,
          radius: 0.45,
          life: 3.2,
          homing: 5.5,
          color,
          splitOnHit: t.evolved ? 3 : 0,
          pierce: st.pierce,
        });
      }
      break;
    }
    case 'pad': {
      const r = 5 * (1 + 0.25 * lv(t, 3) + 0.25 * lv(t, 5)) * st.area;
      const heal = (1.5 + lv(t, 2) + lv(t, 4)) * (t.evolved ? 2 : 1) * info.mult;
      ctx.heal(heal);
      const slow = 0.5 + 0.2 * lv(t, 4);
      const auraDmg = (lv(t, 5) ? 6 : 0) + (t.evolved ? 20 : 0);
      ctx.enemies.hash.query(ctx.px, ctx.pz, r, (i) => {
        const e = ctx.enemies.list[i]!;
        if (!e.alive) return;
        e.slow = Math.max(e.slow, slow);
        if (auraDmg > 0) ctx.damage(e, base(ctx, t, auraDmg, info), { color, inst: t.inst, quiet: !t.evolved });
      });
      ctx.ground.add(GroundKind.Disc, ctx.px, ctx.pz, r * 0.7, r, 0.9, color, { alpha: 0.25 });
      ctx.ground.add(GroundKind.Ring, ctx.px, ctx.pz, r * 0.4, r, 0.9, color, { alpha: 0.6, thickness: 0.05 });
      break;
    }
    case 'crash': {
      const r = 4.5 * (1 + 0.25 * lv(t, 3)) * st.area * acc;
      const dmg = base(ctx, t, 36 * (1 + 0.3 * lv(t, 2) + 0.3 * lv(t, 4)), info);
      const blasts = 1 + lv(t, 5) + extra(ctx, t);
      for (let b = 0; b < blasts; b++) {
        const target = ctx.enemies.densest(ctx.px, ctx.pz, 18) ?? {
          x: ctx.px + ctx.aimX * 8,
          z: ctx.pz + ctx.aimZ * 8,
        };
        const tx = target.x + (b ? (Math.random() - 0.5) * 6 : 0);
        const tz = target.z + (b ? (Math.random() - 0.5) * 6 : 0);
        crashAt(ctx, t, tx, tz, r, dmg, color);
        if (t.evolved) {
          for (let k = 0; k < 3; k++) {
            const a = (k / 3) * Math.PI * 2 + Math.random();
            ctx.schedule(0.12 + k * 0.08, () =>
              crashAt(ctx, t, tx + Math.cos(a) * r * 1.4, tz + Math.sin(a) * r * 1.4, r * 0.8, dmg * 0.6, color),
            );
          }
        }
      }
      break;
    }
    case 'tom': {
      const n = 1 + extra(ctx, t);
      const bounces = t.evolved ? 12 : 2 + lv(t, 2) + 2 * lv(t, 4);
      const dmg = base(ctx, t, 11 * (1 + 0.3 * lv(t, 3) + 0.3 * lv(t, 5)), info);
      for (let k = 0; k < n; k++) {
        const a = aimAt(ctx, o.x, o.z, 16);
        const ang = Math.atan2(a.z, a.x) + (k ? 0.4 : 0);
        const sp = 22 * st.projSpeed;
        const c = withCrit(ctx, t, dmg);
        ctx.projectiles.spawn({
          kind: 'orb',
          inst: t.inst,
          x: o.x,
          z: o.z,
          vx: Math.cos(ang) * sp,
          vz: Math.sin(ang) * sp,
          dmg: c.dmg,
          crit: c.crit,
          radius: 0.55 * (lv(t, 5) ? 1.3 : 1),
          life: 3,
          bounces,
          color,
        });
      }
      break;
    }
    case 'cowbell': {
      const n = 1 + lv(t, 5) + extra(ctx, t);
      const dmg = base(ctx, t, 18 * (1 + 0.3 * lv(t, 2) + 0.3 * lv(t, 4)), info);
      const stun = 0.6 + 0.3 * lv(t, 3);
      for (let k = 0; k < n; k++) {
        const a = aimAt(ctx, o.x, o.z, 16);
        const ang = Math.atan2(a.z, a.x) + (k - (n - 1) / 2) * 0.3;
        const sp = 18 * st.projSpeed;
        const c = withCrit(ctx, t, dmg);
        ctx.projectiles.spawn({
          kind: 'bell',
          inst: t.inst,
          x: o.x,
          z: o.z,
          vx: Math.cos(ang) * sp,
          vz: Math.sin(ang) * sp,
          dmg: c.dmg,
          crit: c.crit,
          radius: 0.6,
          life: 1.2 * st.range,
          pierce: 2 + st.pierce,
          stun,
          color,
        });
      }
      if (t.evolved) {
        for (let k = 0; k < 3; k++) {
          const e = ctx.enemies.nearest(ctx.px + (Math.random() - 0.5) * 20, ctx.pz + (Math.random() - 0.5) * 14, 12);
          if (!e) continue;
          const ex = e.x;
          const ez = e.z;
          ctx.ground.add(GroundKind.Telegraph, ex, ez, 1.8, 1.8, 0.3, color, { fixed: true, alpha: 0.8 });
          ctx.schedule(0.3, () => {
            blast(ctx, t, ex, ez, 2.2, dmg * 1.5, 4, { stun: 1 });
            ctx.glow.burst(ex, 1, ez, 16, color, 9, { life: 0.4, size: 0.5, shape: Shape.Spark });
            ctx.ground.add(GroundKind.Shock, ex, ez, 0.3, 2.6, 0.3, color);
          });
        }
      }
      break;
    }
    case 'scratch': {
      const n = (t.evolved ? 3 : 1 + lv(t, 5)) + extra(ctx, t);
      const dmg = base(ctx, t, 10 * (1 + 0.3 * lv(t, 2) + 0.3 * lv(t, 4)), info);
      const size = 0.95 * (1 + 0.25 * lv(t, 3)) * acc;
      const a = aimAt(ctx, o.x, o.z, 14);
      const ang0 = Math.atan2(a.z, a.x);
      for (let k = 0; k < n; k++) {
        const ang = ang0 + (n === 1 ? 0 : (k / (n - 1) - 0.5) * 1.1);
        const sp = 26 * st.projSpeed;
        const c = withCrit(ctx, t, dmg);
        ctx.projectiles.spawn({
          kind: 'disc',
          inst: t.inst,
          x: o.x,
          z: o.z,
          vx: Math.cos(ang) * sp,
          vz: Math.sin(ang) * sp,
          dmg: c.dmg,
          crit: c.crit,
          radius: size,
          life: 4,
          turnAt: 0.5 * st.range,
          bounces: 1,
          color,
        });
      }
      break;
    }
    case 'organ': {
      const n = (t.evolved ? 12 : 3 + lv(t, 2) + lv(t, 4)) + extra(ctx, t);
      const dmg = base(ctx, t, 24 * (1 + 0.3 * lv(t, 3) + 0.3 * lv(t, 5)), info);
      const w = 1.4 * (lv(t, 5) ? 1.3 : 1) * st.area;
      const used = new Set<number>();
      for (let k = 0; k < n; k++) {
        let tx: number;
        let tz: number;
        if (t.evolved && k < 12) {
          const a = (k / 12) * Math.PI * 2;
          tx = ctx.px + Math.cos(a) * 6;
          tz = ctx.pz + Math.sin(a) * 6;
        } else {
          const e = ctx.enemies.nearest(ctx.px + (Math.random() - 0.5) * 16, ctx.pz + (Math.random() - 0.5) * 12, 14, used);
          if (!e) continue;
          used.add(e.id);
          tx = e.x;
          tz = e.z;
        }
        ctx.ground.add(GroundKind.Telegraph, tx, tz, w, w, 0.14, color, { fixed: true, alpha: 0.7 });
        const fx = tx;
        const fz = tz;
        ctx.schedule(0.14 + k * 0.02, () => {
          blast(ctx, t, fx, fz, w, dmg, 2);
          ctx.beams.add(fx, 0, fz, fx, 14, fz, w * 1.6, color, 0.4);
          ctx.beams.add(fx, 0, fz, fx, 14, fz, w * 0.5, 0xffffff, 0.25);
          ctx.ground.add(GroundKind.Disc, fx, fz, w, w * 1.3, 0.4, color, { alpha: 0.6 });
          ctx.glow.burst(fx, 0.5, fz, 8, color, 3, { vy: 12, life: 0.6, size: 0.35, shape: Shape.Spark });
        });
      }
      break;
    }
    case 'gong': {
      const r = 9 * (1 + 0.5 * lv(t, 5)) * st.area;
      const dmg = base(ctx, t, 45 * (1 + 0.3 * lv(t, 3)), info);
      const freeze = 1.2 + 0.4 * lv(t, 2) + 0.4 * lv(t, 4);
      blast(ctx, t, ctx.px, ctx.pz, r, dmg, 3, { freeze });
      ctx.ground.add(GroundKind.Shock, ctx.px, ctx.pz, 1, r, 0.7, color, { thickness: 0.06 });
      ctx.ground.add(GroundKind.Ring, ctx.px, ctx.pz, 1, r * 0.8, 0.9, 0x9fe6ff, { thickness: 0.04 });
      ctx.ripple(ctx.px, ctx.pz, color, 1);
      ctx.shake(0.3);
      break;
    }
  }
}

function crashAt(ctx: WeaponCtx, t: Track, x: number, z: number, r: number, dmg: number, color: THREE.Color): void {
  blast(ctx, t, x, z, r, dmg, 5);
  ctx.ground.add(GroundKind.Shock, x, z, 0.4, r * 1.1, 0.45, color, { thickness: 0.09 });
  ctx.ground.add(GroundKind.Disc, x, z, r * 0.6, r, 0.25, 0xffffff, { alpha: 0.45 });
  ctx.glow.burst(x, 0.8, z, 26, color, 12, { vy: 8, life: 0.55, size: 0.45, shape: Shape.Spark, gravity: 12 });
  ctx.glow.emit({ x, y: 1, z, life: 0.22, size: r * 2.4, sizeEnd: r * 3, color: 0xffffff, shape: Shape.Ring, alpha: 0.8 });
  ctx.ripple(x, z, color, 0.8);
  ctx.shake(0.18);
}

function lineDamage(
  ctx: WeaponCtx,
  t: Track,
  ax: number,
  az: number,
  bx: number,
  bz: number,
  width: number,
  dmg: number,
  color: THREE.Color,
): void {
  const mx = (ax + bx) / 2;
  const mz = (az + bz) / 2;
  const half = Math.hypot(bx - ax, bz - az) / 2;
  const dx = bx - ax;
  const dz = bz - az;
  const L = Math.hypot(dx, dz) || 1;
  ctx.enemies.hash.query(mx, mz, half + width + 2, (i) => {
    const e = ctx.enemies.list[i]!;
    if (!e.alive) return;
    const rr = width + e.radius;
    if (segDist2(e.x, e.z, ax, az, bx, bz) > rr * rr) return;
    const c = withCrit(ctx, t, dmg);
    ctx.damage(e, c.dmg, { color, inst: t.inst, kx: dx / L, kz: dz / L, knock: 2, crit: c.crit });
  });
}
