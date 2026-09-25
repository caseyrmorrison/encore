import * as THREE from 'three';
import { noteGeometry, pickGeometry } from '../render/instrumentModels';
import { M } from '../render/materials';

export type PickupKind = 'xp' | 'tip' | 'record' | 'heart';

export interface Pickup {
  alive: boolean;
  kind: PickupKind;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  value: number;
  age: number;
  magnet: boolean;
  seed: number;
}

const XP_COLORS: [number, number][] = [
  [1, 0x2ee6ff],
  [4, 0x8cff5a],
  [12, 0xff4df0],
  [40, 0xffc53d],
];

export function xpColor(v: number): number {
  let c = XP_COLORS[0]![1];
  for (const [t, col] of XP_COLORS) if (v >= t) c = col;
  return c;
}

export class PickupManager {
  readonly list: Pickup[] = [];
  readonly group = new THREE.Group();
  private readonly notes: THREE.InstancedMesh;
  private readonly picks: THREE.InstancedMesh;
  private readonly records: THREE.InstancedMesh;
  private readonly hearts: THREE.InstancedMesh;
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();

  constructor() {
    const noteMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    this.notes = new THREE.InstancedMesh(noteGeometry(), noteMat, 900);
    this.notes.frustumCulled = false;
    this.notes.count = 0;
    this.notes.setColorAt(0, new THREE.Color());
    this.picks = new THREE.InstancedMesh(pickGeometry(), M.gold(), 200);
    this.picks.frustumCulled = false;
    this.picks.count = 0;
    const rec = new THREE.CylinderGeometry(1, 1, 0.08, 40);
    this.records = new THREE.InstancedMesh(rec, M.gold(), 16);
    this.records.frustumCulled = false;
    this.records.count = 0;
    const heartShape = new THREE.Shape();
    heartShape.moveTo(0, -0.9);
    heartShape.bezierCurveTo(0.2, -0.6, 1.0, -0.2, 1.0, 0.3);
    heartShape.bezierCurveTo(1.0, 0.8, 0.35, 1.0, 0, 0.55);
    heartShape.bezierCurveTo(-0.35, 1.0, -1.0, 0.8, -1.0, 0.3);
    heartShape.bezierCurveTo(-1.0, -0.2, -0.2, -0.6, 0, -0.9);
    const hg = new THREE.ExtrudeGeometry(heartShape, { depth: 0.3, bevelEnabled: true, bevelSize: 0.1, bevelThickness: 0.1 });
    hg.center();
    this.hearts = new THREE.InstancedMesh(hg, M.glow(0xff3b5c, 2.2), 40);
    this.hearts.frustumCulled = false;
    this.hearts.count = 0;
    this.group.add(this.notes, this.picks, this.records, this.hearts);
  }

  spawn(kind: PickupKind, x: number, z: number, value: number, burst = 1): void {
    let p = this.list.find((q) => !q.alive);
    if (!p) {
      if (this.list.length >= 1000) {
        // merge into an existing xp note rather than dropping value on the floor
        if (kind === 'xp') {
          const target = this.list.find((q) => q.alive && q.kind === 'xp');
          if (target) target.value += value;
        }
        return;
      }
      p = { alive: false, kind, x, y: 0, z, vx: 0, vy: 0, vz: 0, value, age: 0, magnet: false, seed: 0 };
      this.list.push(p);
    }
    const a = Math.random() * Math.PI * 2;
    const sp = (1.5 + Math.random() * 3) * burst;
    Object.assign(p, {
      alive: true,
      kind,
      x,
      y: 0.8,
      z,
      vx: Math.cos(a) * sp,
      vy: 5 + Math.random() * 3,
      vz: Math.sin(a) * sp,
      value,
      age: 0,
      magnet: false,
      seed: Math.random() * 10,
    });
  }

  clear(): void {
    for (const p of this.list) p.alive = false;
  }

  /** Pull every xp note on the field toward the player (after a DROP or boss kill). */
  vacuum(kinds: PickupKind[] = ['xp', 'tip']): void {
    for (const p of this.list) if (p.alive && kinds.includes(p.kind)) p.magnet = true;
  }

  update(
    dt: number,
    time: number,
    px: number,
    pz: number,
    radius: number,
    collect: (p: Pickup) => void,
  ): void {
    for (const p of this.list) {
      if (!p.alive) continue;
      p.age += dt;
      const dx = px - p.x;
      const dz = pz - p.z;
      const d = Math.hypot(dx, dz);
      if (!p.magnet && p.age > 0.35 && (d < radius || (p.kind === 'record' && d < radius * 1.5))) p.magnet = true;
      if (p.magnet) {
        const sp = 14 + p.age * 10;
        p.vx += ((dx / (d || 1)) * sp - p.vx) * Math.min(1, dt * 10);
        p.vz += ((dz / (d || 1)) * sp - p.vz) * Math.min(1, dt * 10);
        p.vy += (1.2 - p.y) * dt * 10;
      } else {
        p.vx *= Math.exp(-dt * 3);
        p.vz *= Math.exp(-dt * 3);
        p.vy -= 22 * dt;
      }
      p.x += p.vx * dt;
      p.z += p.vz * dt;
      p.y += p.vy * dt;
      const rest = 0.6 + Math.sin(time * 4 + p.seed) * 0.15;
      if (!p.magnet && p.y < rest) {
        p.y = rest;
        p.vy = Math.abs(p.vy) * 0.3;
      }
      if (d < 0.95) {
        p.alive = false;
        collect(p);
      }
      if (p.age > 60 && p.kind === 'xp') p.magnet = true;
    }
  }

  render(time: number): void {
    let n = 0;
    let t = 0;
    let r = 0;
    let h = 0;
    for (const p of this.list) {
      if (!p.alive) continue;
      const spin = time * 3 + p.seed;
      this.v.set(p.x, p.y, p.z);
      if (p.kind === 'xp' && n < 900) {
        const sc = 0.32 + Math.min(0.5, Math.log2(1 + p.value) * 0.08);
        this.e.set(-0.5, spin, 0);
        this.q.setFromEuler(this.e);
        this.s.setScalar(sc);
        this.m4.compose(this.v, this.q, this.s);
        this.notes.setMatrixAt(n, this.m4);
        this.c.setHex(xpColor(p.value)).multiplyScalar(2.2);
        this.notes.setColorAt(n, this.c);
        n++;
      } else if (p.kind === 'tip' && t < 200) {
        this.e.set(-0.9, spin * 1.3, 0.3);
        this.q.setFromEuler(this.e);
        this.s.setScalar(0.42);
        this.m4.compose(this.v, this.q, this.s);
        this.picks.setMatrixAt(t++, this.m4);
      } else if (p.kind === 'record' && r < 16) {
        this.e.set(1.2, spin, 0);
        this.q.setFromEuler(this.e);
        this.s.setScalar(0.85 + Math.sin(time * 8) * 0.06);
        this.m4.compose(this.v, this.q, this.s);
        this.records.setMatrixAt(r++, this.m4);
      } else if (p.kind === 'heart' && h < 40) {
        this.e.set(-0.4, spin, 0);
        this.q.setFromEuler(this.e);
        this.s.setScalar(0.45 + Math.sin(time * 10) * 0.05);
        this.m4.compose(this.v, this.q, this.s);
        this.hearts.setMatrixAt(h++, this.m4);
      }
    }
    this.notes.count = n;
    this.picks.count = t;
    this.records.count = r;
    this.hearts.count = h;
    this.notes.instanceMatrix.needsUpdate = true;
    if (this.notes.instanceColor) this.notes.instanceColor.needsUpdate = true;
    this.picks.instanceMatrix.needsUpdate = true;
    this.records.instanceMatrix.needsUpdate = true;
    this.hearts.instanceMatrix.needsUpdate = true;
  }
}
