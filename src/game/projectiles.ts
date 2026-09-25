import * as THREE from 'three';
import type { InstrumentId } from '../seq/instruments';
import { buildRecord } from '../render/instrumentModels';
import { Shape, type ParticleSystem } from '../render/fx';
import type { Enemy, EnemyManager } from './enemies';
import type { Bounds } from '../render/venues/venue';

export type ProjKind = 'pellet' | 'needle' | 'missile' | 'orb' | 'disc' | 'bell' | 'enemy';

export interface Projectile {
  alive: boolean;
  kind: ProjKind;
  inst: InstrumentId | null;
  x: number;
  z: number;
  vx: number;
  vz: number;
  speed: number;
  dmg: number;
  radius: number;
  life: number;
  pierce: number;
  bounces: number;
  homing: number;
  color: THREE.Color;
  crit: boolean;
  accent: boolean;
  /** disc: returns to player after `turnAt` seconds */
  turnAt: number;
  age: number;
  hits: Set<number>;
  splitOnHit: number;
  stun: number;
  target: Enemy | null;
  spin: number;
}

export interface ProjHooks {
  hit(p: Projectile, e: Enemy): void;
  hitPlayer(p: Projectile): void;
}

const SCREEN_Z = 0.83; // sin(camera pitch): foreshortening of world z on screen

export class ProjectileManager {
  readonly list: Projectile[] = [];
  readonly group = new THREE.Group();
  private readonly discMesh: THREE.InstancedMesh;
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly e = new THREE.Euler();

  constructor() {
    const rec = buildRecord(0xff4df0);
    const geos: THREE.BufferGeometry[] = [];
    const mats: THREE.Material[] = [];
    rec.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        geos.push(o.geometry);
        mats.push(o.material as THREE.Material);
      }
    });
    // a record = disc + label; render the disc body instanced, label glow comes from particles
    this.discMesh = new THREE.InstancedMesh(geos[0]!, mats[0]!, 64);
    this.discMesh.count = 0;
    this.discMesh.frustumCulled = false;
    this.group.add(this.discMesh);
  }

  spawn(p: Partial<Projectile> & Pick<Projectile, 'kind' | 'x' | 'z' | 'vx' | 'vz' | 'dmg'>): Projectile {
    let slot = this.list.find((q) => !q.alive);
    if (!slot) {
      if (this.list.length >= 1600) {
        slot = this.list[Math.floor(Math.random() * this.list.length)]!;
      } else {
        slot = {
          alive: false,
          kind: 'pellet',
          inst: null,
          x: 0,
          z: 0,
          vx: 0,
          vz: 0,
          speed: 0,
          dmg: 0,
          radius: 0.3,
          life: 1,
          pierce: 0,
          bounces: 0,
          homing: 0,
          color: new THREE.Color(),
          crit: false,
          accent: false,
          turnAt: 0,
          age: 0,
          hits: new Set(),
          splitOnHit: 0,
          stun: 0,
          target: null,
          spin: 0,
        };
        this.list.push(slot);
      }
    }
    const color = slot.color;
    const hits = slot.hits;
    Object.assign(slot, {
      alive: true,
      inst: null,
      radius: 0.3,
      life: 1,
      pierce: 0,
      bounces: 0,
      homing: 0,
      crit: false,
      accent: false,
      turnAt: 0,
      age: 0,
      splitOnHit: 0,
      stun: 0,
      target: null,
      spin: 0,
      ...p,
      color,
      hits,
    });
    slot.speed = Math.hypot(slot.vx, slot.vz);
    hits.clear();
    if (p.color) color.copy(p.color);
    return slot;
  }

  clear(): void {
    for (const p of this.list) p.alive = false;
  }

  update(
    dt: number,
    enemies: EnemyManager,
    px: number,
    pz: number,
    playerR: number,
    bounds: Bounds,
    hooks: ProjHooks,
    glow: ParticleSystem,
    dark: ParticleSystem,
    freezeEnemyShots: boolean,
  ): void {
    for (const p of this.list) {
      if (!p.alive) continue;
      p.age += dt;
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        continue;
      }
      if (p.kind === 'enemy') {
        if (!freezeEnemyShots) {
          p.x += p.vx * dt;
          p.z += p.vz * dt;
        }
        if ((p.x - px) ** 2 + (p.z - pz) ** 2 < (p.radius + playerR) ** 2) {
          hooks.hitPlayer(p);
          p.alive = false;
          continue;
        }
        // render: black core, pale rim — anti-light reads instantly against our colours
        dark.emit({ x: p.x, y: 1, z: p.z, life: dt * 1.05, size: p.radius * 3.4, color: 0x0a0010, shape: Shape.Dot, alpha: 0.95 });
        dark.emit({ x: p.x, y: 1.01, z: p.z, life: dt * 1.05, size: p.radius * 3.0, color: 0xf2e8ff, shape: Shape.Ring, alpha: 0.9 });
        if (Math.random() < 0.3) {
          dark.emit({ x: p.x, y: 1, z: p.z, life: 0.35, size: p.radius * 1.6, sizeEnd: 0, color: 0x1a0626, shape: Shape.Dot, alpha: 0.6 });
        }
        continue;
      }

      // homing
      if (p.homing > 0) {
        if (!p.target || !p.target.alive) p.target = enemies.nearest(p.x, p.z, 16, p.hits);
        if (p.target) {
          const want = Math.atan2(p.target.z - p.z, p.target.x - p.x);
          const cur = Math.atan2(p.vz, p.vx);
          let d = want - cur;
          d = Math.atan2(Math.sin(d), Math.cos(d));
          const na = cur + Math.max(-1, Math.min(1, d)) * Math.min(1, p.homing * dt);
          p.speed = Math.min(p.speed * (1 + dt * 0.8), 34);
          p.vx = Math.cos(na) * p.speed;
          p.vz = Math.sin(na) * p.speed;
        }
      }
      if (p.kind === 'disc') {
        if (p.age > p.turnAt) {
          // on the way back every enemy can be sliced a second time
          if (p.bounces > 0) {
            p.bounces = 0;
            p.hits.clear();
          }
          const dx = px - p.x;
          const dz = pz - p.z;
          const d = Math.hypot(dx, dz) || 1;
          const sp = Math.min(40, p.speed + (p.age - p.turnAt) * 30);
          p.vx += ((dx / d) * sp - p.vx) * Math.min(1, dt * 6);
          p.vz += ((dz / d) * sp - p.vz) * Math.min(1, dt * 6);
          if (d < 1.2) {
            p.alive = false;
            continue;
          }
        } else {
          p.vx *= Math.exp(-dt * 1.6);
          p.vz *= Math.exp(-dt * 1.6);
        }
        p.spin += dt * 22;
      }
      p.x += p.vx * dt;
      p.z += p.vz * dt;

      // walls: most projectiles die, orbs bounce
      if (bounds.kind === 'rect') {
        if (Math.abs(p.x) > bounds.hx + 2 || Math.abs(p.z) > bounds.hz + 2) {
          if (p.kind === 'orb' && p.bounces > 0) {
            if (Math.abs(p.x) > bounds.hx + 2) p.vx = -p.vx;
            if (Math.abs(p.z) > bounds.hz + 2) p.vz = -p.vz;
            p.bounces--;
          } else if (p.kind !== 'disc') {
            p.alive = false;
            continue;
          }
        }
      } else if (Math.hypot(p.x, p.z) > bounds.r + 2 && p.kind !== 'disc') {
        p.alive = false;
        continue;
      }

      // collisions
      let dead = false;
      enemies.hash.query(p.x, p.z, p.radius + 1.6, (i) => {
        const e = enemies.list[i]!;
        if (!e.alive) return;
        const rr = p.radius + e.radius;
        if ((e.x - p.x) ** 2 + (e.z - p.z) ** 2 > rr * rr) return;
        if (p.kind === 'disc') {
          if (p.hits.has(e.id)) return;
          p.hits.add(e.id);
          hooks.hit(p, e);
          return;
        }
        if (p.hits.has(e.id)) return;
        p.hits.add(e.id);
        hooks.hit(p, e);
        if (p.kind === 'orb' && p.bounces > 0) {
          p.bounces--;
          const next = enemies.nearest(p.x, p.z, 9, p.hits);
          if (next) {
            const a = Math.atan2(next.z - p.z, next.x - p.x);
            p.vx = Math.cos(a) * p.speed;
            p.vz = Math.sin(a) * p.speed;
          }
          return true;
        }
        if (p.pierce > 0) {
          p.pierce--;
          return;
        }
        dead = true;
        return true;
      });
      if (dead) {
        p.alive = false;
        continue;
      }
      this.draw(p, dt, glow);
      if (p.kind !== 'disc') {
        // a dark halo under every shot keeps it readable on lit floors
        dark.emit({ x: p.x, y: 0.95, z: p.z, life: dt * 1.05, size: p.radius * 3.6, color: 0x06040a, shape: Shape.Dot, alpha: 0.55 });
      }
    }

    // records
    let n = 0;
    for (const p of this.list) {
      if (!p.alive || p.kind !== 'disc' || n >= 64) continue;
      this.e.set(0.35, p.spin, 0);
      this.q.setFromEuler(this.e);
      this.v.set(p.x, 1.1, p.z);
      this.s.setScalar(p.radius * 0.9);
      this.m4.compose(this.v, this.q, this.s);
      this.discMesh.setMatrixAt(n++, this.m4);
    }
    this.discMesh.count = n;
    this.discMesh.instanceMatrix.needsUpdate = true;
  }

  private draw(p: Projectile, dt: number, glow: ParticleSystem): void {
    const ang = Math.atan2(-p.vz * SCREEN_Z, p.vx);
    const boost = p.crit ? 1.35 : 1;
    switch (p.kind) {
      case 'pellet':
        glow.emit({ x: p.x, y: 1, z: p.z, life: dt * 1.05, size: 0.9 * boost, color: p.color, shape: Shape.Dot });
        glow.emit({ x: p.x, y: 1, z: p.z, life: 0.16, size: 0.5, sizeEnd: 0.05, color: p.color, shape: Shape.Streak, rot: ang, stretch: 2.2, alpha: 0.7 });
        break;
      case 'needle':
        glow.emit({ x: p.x, y: 1, z: p.z, life: dt * 1.05, size: 0.55 * boost, color: 0xffffff, shape: Shape.Streak, rot: ang, stretch: 4 });
        glow.emit({ x: p.x, y: 1, z: p.z, life: 0.12, size: 0.7, sizeEnd: 0.1, color: p.color, shape: Shape.Streak, rot: ang, stretch: 3, alpha: 0.6 });
        break;
      case 'missile':
        glow.emit({ x: p.x, y: 1.2, z: p.z, life: dt * 1.05, size: 1.25 * boost, color: p.color, shape: Shape.Note, rot: 0 });
        glow.emit({ x: p.x, y: 1.2, z: p.z, life: dt * 1.05, size: 1.6, color: p.color, shape: Shape.Dot, alpha: 0.35 });
        if (Math.random() < 0.6)
          glow.emit({ x: p.x, y: 1.1, z: p.z, vy: 0.6, life: 0.45, size: 0.3, sizeEnd: 0, color: p.color, shape: Shape.Spark });
        break;
      case 'orb':
        glow.emit({ x: p.x, y: 0.9, z: p.z, life: dt * 1.05, size: 1.3 * boost, color: p.color, shape: Shape.Dot });
        glow.emit({ x: p.x, y: 0.9, z: p.z, life: dt * 1.05, size: 1.1, color: 0xffffff, shape: Shape.Ring, alpha: 0.6 });
        glow.emit({ x: p.x, y: 0.9, z: p.z, life: 0.25, size: 0.8, sizeEnd: 0, color: p.color, shape: Shape.Dot, alpha: 0.5 });
        break;
      case 'disc':
        glow.emit({ x: p.x, y: 1.1, z: p.z, life: dt * 1.05, size: p.radius * 2.6, color: p.color, shape: Shape.Ring, alpha: 0.6 });
        glow.emit({ x: p.x, y: 1.1, z: p.z, life: 0.2, size: p.radius * 1.4, sizeEnd: 0, color: p.color, shape: Shape.Dot, alpha: 0.35 });
        break;
      case 'bell':
        glow.emit({ x: p.x, y: 1, z: p.z, life: dt * 1.05, size: 1.1 * boost, color: p.color, shape: Shape.Dot });
        glow.emit({ x: p.x, y: 1, z: p.z, life: 0.3, size: 0.4, sizeEnd: 1.8, color: p.color, shape: Shape.Ring, alpha: 0.5 });
        break;
      default:
        break;
    }
  }
}
