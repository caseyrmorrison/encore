import * as THREE from 'three';
import type { InstrumentId } from '../seq/instruments';
import { INSTRUMENTS } from '../seq/instruments';
import { buildInstrument } from '../render/instrumentModels';
import { M } from '../render/materials';

interface Member {
  intro: number;
  inst: InstrumentId;
  root: THREE.Group;
  model: THREE.Group;
  halo: THREE.Mesh;
  bump: number;
  x: number;
  z: number;
  evolved: boolean;
}

/**
 * Your band: every instrument you own floats in orbit around MIC and physically jumps
 * when its note plays. Shots fire from the instrument itself, so a full kit visibly
 * becomes a flying artillery ring.
 */
export class Band {
  readonly group = new THREE.Group();
  private readonly members: Member[] = [];
  private angle = 0;
  private readonly haloGeo = new THREE.RingGeometry(0.75, 0.95, 40);

  sync(insts: { inst: InstrumentId; evolved: boolean }[]): void {
    for (let i = this.members.length - 1; i >= 0; i--) {
      const m = this.members[i]!;
      const still = insts.find((x) => x.inst === m.inst);
      if (!still || still.evolved !== m.evolved) {
        this.group.remove(m.root);
        this.members.splice(i, 1);
      }
    }
    for (const { inst, evolved } of insts) {
      if (this.members.some((m) => m.inst === inst)) continue;
      const root = new THREE.Group();
      const inner = buildInstrument(inst);
      const box = new THREE.Box3().setFromObject(inner);
      const size = box.getSize(new THREE.Vector3()).length();
      inner.scale.multiplyScalar((evolved ? 1.35 : 1) * (2.1 / size));
      // animate a wrapper so each model keeps its authored tilt
      const model = new THREE.Group();
      model.add(inner);
      root.add(model);
      const halo = new THREE.Mesh(
        this.haloGeo,
        new THREE.MeshBasicMaterial({
          color: evolved ? 0xffd36b : INSTRUMENTS[inst].color,
          transparent: true,
          opacity: 0.35,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
      halo.rotation.x = -Math.PI / 2;
      halo.position.y = -1.9;
      root.add(halo);
      if (evolved) {
        const crown = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.05, 8, 24), M.glow(0xffd36b, 3));
        crown.rotation.x = Math.PI / 2;
        crown.position.y = 0.85;
        root.add(crown);
      }
      this.group.add(root);
      this.members.push({ inst, root, model, halo, bump: 0, x: 0, z: 0, evolved, intro: 0 });
    }
  }

  /** Drop a member in from above (after a draft adds them). */
  introduce(inst: InstrumentId): void {
    const m = this.members.find((q) => q.inst === inst);
    if (m) m.intro = 1;
  }

  hit(inst: InstrumentId, strength = 1): void {
    const m = this.members.find((q) => q.inst === inst);
    if (m) m.bump = Math.min(1.4, m.bump + strength);
  }

  origin(inst: InstrumentId, px: number, pz: number): { x: number; z: number } {
    const m = this.members.find((q) => q.inst === inst);
    return m ? { x: m.x, z: m.z } : { x: px, z: pz };
  }

  update(dt: number, time: number, px: number, pz: number): void {
    this.angle += dt * 0.6;
    const n = this.members.length;
    const radius = 3.1 + Math.max(0, n - 3) * 0.3;
    this.members.forEach((m, i) => {
      const a = this.angle + (i / Math.max(1, n)) * Math.PI * 2;
      m.x = px + Math.cos(a) * radius;
      m.z = pz + Math.sin(a) * radius;
      m.bump = Math.max(0, m.bump - dt * 5);
      const b = m.bump;
      m.intro = Math.max(0, m.intro - dt * 1.6);
      const fall = m.intro * m.intro * 16;
      m.root.position.set(m.x, 2.0 + Math.sin(time * 2 + i) * 0.15 + b * 0.5 + fall, m.z);
      m.root.scale.setScalar((1 + b * 0.35) * (1 + m.intro * 0.8));
      m.model.rotation.x = m.intro * 6;
      m.model.rotation.y = -a + Math.PI / 2 + Math.sin(time + i) * 0.2;
      // a big band dims its resting halos so the space around the player stays readable
      const rest = (m.evolved ? 0.14 : 0.22) * (n > 4 ? 0.45 : 1);
      (m.halo.material as THREE.MeshBasicMaterial).opacity = rest + b * 0.55;
      m.halo.scale.setScalar(1 + b * 0.8);
    });
  }
}
