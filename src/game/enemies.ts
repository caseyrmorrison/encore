import * as THREE from 'three';
import { SpatialHash } from '../core/spatialHash';
import { HushBatch, hushLooks, type HushKind } from '../render/hush';
import { clampToBounds, pushOutOfObstacles, type Bounds } from '../render/venues/venue';

export interface EnemyDef {
  hp: number;
  speed: number;
  radius: number;
  dmg: number;
  xp: number;
  mass: number;
  scale: number;
}

export const ENEMY_DEFS: Record<HushKind, EnemyDef> = {
  mote: { hp: 14, speed: 4.3, radius: 0.55, dmg: 8, xp: 1, mass: 1, scale: 1.3 },
  wisp: { hp: 7, speed: 7.2, radius: 0.4, dmg: 5, xp: 0, mass: 0.5, scale: 1.2 },
  static: { hp: 24, speed: 5.4, radius: 0.6, dmg: 10, xp: 2, mass: 1, scale: 1.25 },
  mute: { hp: 75, speed: 2.7, radius: 0.8, dmg: 16, xp: 4, mass: 3, scale: 1.2 },
  damper: { hp: 55, speed: 3.0, radius: 0.95, dmg: 12, xp: 3, mass: 3, scale: 1.2 },
  shusher: { hp: 34, speed: 3.3, radius: 0.55, dmg: 8, xp: 2, mass: 1.2, scale: 1.25 },
  bouncer: { hp: 460, speed: 3.7, radius: 1.2, dmg: 24, xp: 30, mass: 9, scale: 1.2 },
};

export const DAMPER_RADIUS = 5;

export interface Enemy {
  id: number;
  alive: boolean;
  kind: HushKind;
  x: number;
  z: number;
  vx: number;
  vz: number;
  kx: number;
  kz: number;
  hp: number;
  maxHp: number;
  speed: number;
  radius: number;
  dmg: number;
  xp: number;
  mass: number;
  scale: number;
  elite: boolean;
  flash: number;
  freeze: number;
  stun: number;
  slow: number;
  seed: number;
  spawnT: number;
  yaw: number;
  attackT: number;
  /** telegraph / charge state for bouncers & shushers */
  mode: number;
  modeT: number;
  tx: number;
  tz: number;
  /** per-enemy hit cooldown for piercing weapons (scratch discs) */
  lastHitBy: number;
  lastHitT: number;
  /** Driven by a boss script: skipped by the swarm AI and the instanced renderer. */
  scripted: boolean;
  /** damage waiting to be shown as one number (keeps shockwave spam readable) */
  numAcc: number;
  numT: number;
  numCrit: boolean;
  numColor: number;
}

export interface EnemyHooks {
  /** A ranged enemy fires at the player. */
  shoot(e: Enemy, dx: number, dz: number): void;
  /** Telegraph warning (x, z, radius, duration). */
  telegraph(x: number, z: number, r: number, dur: number, color: number): void;
}

const MAX_ENEMIES = 720;

export class EnemyManager {
  readonly list: Enemy[] = [];
  readonly hash: SpatialHash;
  readonly group = new THREE.Group();
  private readonly batches: Record<HushKind, HushBatch>;
  private nextId = 1;
  private readonly tmp = { x: 0, z: 0 };
  private readonly shadows: THREE.InstancedMesh;
  private readonly sm = new THREE.Matrix4();
  aliveCount = 0;

  constructor(rim: THREE.Color, floor: THREE.Color) {
    this.hash = new SpatialHash(60, 3, MAX_ENEMIES + 8);
    const looks = hushLooks();
    const caps: Record<HushKind, number> = {
      mote: 520,
      wisp: 200,
      static: 220,
      mute: 160,
      damper: 60,
      shusher: 120,
      bouncer: 24,
    };
    this.batches = {} as Record<HushKind, HushBatch>;
    for (const k of Object.keys(looks) as HushKind[]) {
      const b = new HushBatch(looks[k], caps[k], rim, floor);
      this.batches[k] = b;
      this.group.add(b.mesh);
    }
    for (let i = 0; i < MAX_ENEMIES; i++) this.list.push(this.blank());
    // soft contact shadows ground the silhouettes on the glowing floors
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d')!;
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(0,0,0,0.85)');
    grd.addColorStop(0.55, 'rgba(0,0,0,0.5)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
    const tex = new THREE.CanvasTexture(c);
    const sg = new THREE.PlaneGeometry(1, 1);
    sg.rotateX(-Math.PI / 2);
    this.shadows = new THREE.InstancedMesh(
      sg,
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, color: 0x000000 }),
      MAX_ENEMIES,
    );
    this.shadows.frustumCulled = false;
    this.shadows.renderOrder = 3;
    this.shadows.count = 0;
    this.group.add(this.shadows);
  }

  private blank(): Enemy {
    return {
      id: 0,
      alive: false,
      kind: 'mote',
      x: 0,
      z: 0,
      vx: 0,
      vz: 0,
      kx: 0,
      kz: 0,
      hp: 0,
      maxHp: 0,
      speed: 0,
      radius: 0,
      dmg: 0,
      xp: 0,
      mass: 1,
      scale: 1,
      elite: false,
      flash: 0,
      freeze: 0,
      stun: 0,
      slow: 0,
      seed: 0,
      spawnT: 0,
      yaw: 0,
      attackT: 0,
      mode: 0,
      modeT: 0,
      tx: 0,
      tz: 0,
      lastHitBy: 0,
      lastHitT: 0,
      scripted: false,
      numAcc: 0,
      numT: 0,
      numCrit: false,
      numColor: 0xffffff,
    };
  }

  setColors(rim: THREE.Color, floor: THREE.Color): void {
    for (const b of Object.values(this.batches)) b.setColors(rim, floor);
  }

  spawn(kind: HushKind, x: number, z: number, hpMult: number, elite = false): Enemy | null {
    let e: Enemy | undefined;
    for (const c of this.list) {
      if (!c.alive) {
        e = c;
        break;
      }
    }
    if (!e) return null;
    const d = ENEMY_DEFS[kind];
    const eliteMult = elite ? 5 : 1;
    e.id = this.nextId++;
    e.alive = true;
    e.kind = kind;
    e.x = x;
    e.z = z;
    e.vx = 0;
    e.vz = 0;
    e.kx = 0;
    e.kz = 0;
    e.maxHp = e.hp = d.hp * hpMult * eliteMult;
    e.speed = d.speed * (0.9 + Math.random() * 0.2) * (elite ? 0.9 : 1);
    e.scale = d.scale * (elite ? 1.45 : 1) * (0.94 + Math.random() * 0.12);
    e.radius = d.radius * (e.scale / d.scale) * d.scale;
    e.dmg = d.dmg * (elite ? 1.5 : 1);
    e.xp = d.xp * (elite ? 6 : 1);
    e.mass = d.mass * (elite ? 3 : 1);
    e.elite = elite || kind === 'bouncer';
    e.flash = 0;
    e.freeze = 0;
    e.stun = 0;
    e.slow = 0;
    e.seed = Math.random();
    e.spawnT = 0;
    e.yaw = 0;
    e.attackT = 1 + Math.random() * 2;
    e.mode = 0;
    e.modeT = 0;
    e.lastHitBy = 0;
    e.lastHitT = 0;
    e.scripted = false;
    e.numAcc = 0;
    e.numT = 0;
    e.numCrit = false;
    return e;
  }

  clear(): void {
    for (const e of this.list) e.alive = false;
    this.aliveCount = 0;
  }

  rebuildHash(): void {
    this.hash.clear();
    let n = 0;
    for (let i = 0; i < this.list.length; i++) {
      const e = this.list[i]!;
      if (!e.alive) continue;
      this.hash.insert(i, e.x, e.z);
      n++;
    }
    this.aliveCount = n;
  }

  /** Nearest living enemy to (x,z) within maxR. */
  nearest(x: number, z: number, maxR: number, exclude?: Set<number>): Enemy | null {
    let best: Enemy | null = null;
    let bestD = Infinity;
    this.hash.query(x, z, maxR, (i, d2) => {
      const e = this.list[i]!;
      if (!e.alive || (exclude && exclude.has(e.id))) return;
      if (d2 < bestD) {
        bestD = d2;
        best = e;
      }
    });
    return best;
  }

  /** Centre of the densest cluster near the player (for crash cymbals). */
  densest(x: number, z: number, range: number): { x: number; z: number } | null {
    let best: Enemy | null = null;
    let bestScore = 0;
    let checked = 0;
    for (const e of this.list) {
      if (!e.alive) continue;
      if ((e.x - x) ** 2 + (e.z - z) ** 2 > range * range) continue;
      if (checked++ > 60) break;
      let score = 0;
      this.hash.query(e.x, e.z, 4, () => {
        score++;
      });
      if (score > bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best ? { x: (best as Enemy).x, z: (best as Enemy).z } : null;
  }

  update(
    dt: number,
    px: number,
    pz: number,
    bounds: Bounds,
    obstacles: readonly { x: number; z: number; r: number }[],
    hooks: EnemyHooks,
    speedMult: number,
  ): void {
    for (let i = 0; i < this.list.length; i++) {
      const e = this.list[i]!;
      if (!e.alive) continue;
      e.flash = Math.max(0, e.flash - dt * 11);
      if (e.scripted) continue;
      e.spawnT = Math.min(1, e.spawnT + dt * 2.5);
      e.freeze = Math.max(0, e.freeze - dt);
      e.stun = Math.max(0, e.stun - dt);
      e.slow = Math.max(0, e.slow - dt * 0.8);

      const dx = px - e.x;
      const dz = pz - e.z;
      const dist = Math.hypot(dx, dz) || 1;
      const nx = dx / dist;
      const nz = dz / dist;
      const frozen = e.freeze > 0 || e.stun > 0;
      let spd = e.speed * speedMult * (1 - Math.min(0.75, e.slow)) * (frozen ? 0 : 1) * (0.3 + e.spawnT * 0.7);
      let dirX = nx;
      let dirZ = nz;

      switch (e.kind) {
        case 'mote':
        case 'wisp': {
          // swarm: approach on a slight curl so crowds wrap around you
          const curl = (e.seed - 0.5) * 0.9;
          dirX = nx * Math.cos(curl) - nz * Math.sin(curl);
          dirZ = nx * Math.sin(curl) + nz * Math.cos(curl);
          break;
        }
        case 'static': {
          e.modeT -= dt;
          if (e.modeT <= 0 && dist > 5 && dist < 26 && !frozen) {
            // blink forward
            const jump = Math.min(dist - 3, 6);
            hooks.telegraph(e.x, e.z, 0.9, 0.2, 0x9fb8ff);
            e.x += nx * jump;
            e.z += nz * jump;
            e.flash = 0.6;
            e.modeT = 2.4 + Math.random() * 1.6;
          }
          break;
        }
        case 'shusher': {
          // keep range; fire on a timer (telegraphed)
          const want = 10;
          if (dist < want - 2) {
            dirX = -nx;
            dirZ = -nz;
          } else if (dist < want + 2) {
            dirX = -nz * (e.seed > 0.5 ? 1 : -1);
            dirZ = nx * (e.seed > 0.5 ? 1 : -1);
            spd *= 0.6;
          }
          e.attackT -= dt;
          if (e.attackT <= 0 && dist < 22 && !frozen) {
            hooks.shoot(e, nx, nz);
            e.attackT = 2.6 + Math.random() * 1.4;
            e.flash = 0.5;
          }
          break;
        }
        case 'bouncer': {
          // walk → telegraph → charge
          if (e.mode === 0) {
            e.attackT -= dt;
            if (e.attackT <= 0 && dist < 18 && !frozen) {
              e.mode = 1;
              e.modeT = 0.8;
              e.tx = nx;
              e.tz = nz;
              hooks.telegraph(e.x + nx * 7, e.z + nz * 7, 2.2, 0.8, 0xff3b30);
            }
          } else if (e.mode === 1) {
            spd = 0;
            e.modeT -= dt;
            if (e.modeT <= 0) {
              e.mode = 2;
              e.modeT = 0.55;
            }
          } else {
            dirX = e.tx;
            dirZ = e.tz;
            spd = frozen ? 0 : 19;
            e.modeT -= dt;
            if (e.modeT <= 0) {
              e.mode = 0;
              e.attackT = 3 + Math.random() * 2;
            }
          }
          break;
        }
        default:
          break;
      }

      // steer around pillars instead of grinding into them
      for (const o of obstacles) {
        const ox = e.x - o.x;
        const oz = e.z - o.z;
        const od = Math.hypot(ox, oz);
        const reach = o.r + e.radius + 2.2;
        if (od > reach || od < 1e-4) continue;
        // only when heading into it
        if (dirX * -ox + dirZ * -oz <= 0) continue;
        const side = ox * dirZ - oz * dirX > 0 ? 1 : -1;
        const w = 1 - (od - o.r - e.radius) / 2.2;
        dirX += (-oz / od) * side * w * 1.6;
        dirZ += (ox / od) * side * w * 1.6;
        const l = Math.hypot(dirX, dirZ) || 1;
        dirX /= l;
        dirZ /= l;
      }

      // separation
      let sx = 0;
      let sz = 0;
      this.hash.query(e.x, e.z, e.radius + 1.2, (j) => {
        if (j === i) return;
        const o = this.list[j]!;
        const ox = e.x - o.x;
        const oz = e.z - o.z;
        const d = Math.hypot(ox, oz);
        const min = e.radius + o.radius;
        if (d < min && d > 1e-4) {
          const push = (min - d) / min;
          sx += (ox / d) * push;
          sz += (oz / d) * push;
        }
      });

      const tvx = dirX * spd + sx * 5;
      const tvz = dirZ * spd + sz * 5;
      const k = 1 - Math.exp(-8 * dt);
      e.vx += (tvx - e.vx) * k;
      e.vz += (tvz - e.vz) * k;
      e.kx *= Math.exp(-6 * dt);
      e.kz *= Math.exp(-6 * dt);
      e.x += (e.vx + e.kx) * dt;
      e.z += (e.vz + e.kz) * dt;
      pushOutOfObstacles(obstacles, e.x, e.z, e.radius, this.tmp);
      clampToBounds(bounds, this.tmp.x, this.tmp.z, e.radius * 0.5, this.tmp);
      e.x = this.tmp.x;
      e.z = this.tmp.z;
      if (!frozen) {
        const want = Math.atan2(nx, nz);
        let dy = want - e.yaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        e.yaw += dy * Math.min(1, dt * 8);
      }
    }
  }

  render(time: number, beatPhase: number): void {
    for (const b of Object.values(this.batches)) b.begin();
    const pulse = Math.pow(1 - beatPhase, 3);
    let ns = 0;
    for (const e of this.list) {
      if (!e.alive || e.scripted) continue;
      const b = this.batches[e.kind];
      const sr = e.radius * 2.6 * (0.3 + 0.7 * e.spawnT);
      this.sm.makeScale(sr, 1, sr);
      this.sm.setPosition(e.x, 0.04, e.z);
      this.shadows.setMatrixAt(ns++, this.sm);
      const s = e.scale * (0.2 + 0.8 * easeOutBack(e.spawnT));
      const hop = e.kind === 'mote' || e.kind === 'wisp' ? pulse * 0.25 : 0;
      const float = e.kind === 'wisp' || e.kind === 'static' ? 0.3 + Math.sin(time * 3 + e.seed * 10) * 0.15 : 0;
      const charging = e.kind === 'bouncer' && e.mode === 1 ? Math.sin(time * 60) * 0.08 : 0;
      b.push(
        e.x + charging,
        hop + float,
        e.z,
        e.yaw,
        s,
        Math.min(1, e.flash),
        e.seed,
        e.freeze > 0 ? 1 : e.stun > 0 ? 0.5 : 0,
        e.elite ? 1 : 0,
        e.freeze > 0 ? 0 : pulse,
      );
    }
    for (const b of Object.values(this.batches)) b.end(time);
    this.shadows.count = ns;
    this.shadows.instanceMatrix.needsUpdate = true;
  }
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
