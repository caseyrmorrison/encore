import * as THREE from 'three';
import { hushLooks, makeHushMaterial, type HushKind } from '../render/hush';
import { GroundKind, Shape, type BeamFx, type GroundFx, type ParticleSystem } from '../render/fx';
import { canvasTexture, M } from '../render/materials';

let tolexTex: THREE.Texture | null = null;
/** Black amp tolex: fine pebbled grain. */
function tolex(): THREE.Texture {
  if (tolexTex) return tolexTex;
  tolexTex = canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#141216';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 5000; i++) {
      const v = 10 + Math.random() * 26;
      g.fillStyle = `rgb(${v},${v - 2},${v + 2})`;
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
  });
  tolexTex.wrapS = tolexTex.wrapT = THREE.RepeatWrapping;
  tolexTex.repeat.set(2, 2);
  return tolexTex;
}
import type { Enemy, EnemyManager } from './enemies';

export interface BossCtx {
  enemies: EnemyManager;
  glow: ParticleSystem;
  ground: GroundFx;
  beams: BeamFx;
  px: number;
  pz: number;
  playerInvuln: boolean;
  spawnMinion(kind: HushKind, x: number, z: number): void;
  shoot(x: number, z: number, vx: number, vz: number, r?: number): void;
  hurtPlayer(dmg: number, fromX: number, fromZ: number): void;
  shake(n: number): void;
  roar(): void;
  setSilence(on: boolean): void;
  hpMult: number;
  /** camera orientation, for billboards */
  camQuat: THREE.Quaternion;
}

export abstract class Boss {
  abstract readonly name: string;
  abstract readonly title: string;
  abstract readonly color: number;
  readonly group = new THREE.Group();
  entry: Enemy | null = null;
  protected t = 0;
  protected phase = 1;
  dead = false;
  /** Damage multiplier the boss takes (silence shield etc.). */
  armor = 1;

  get hpFrac(): number {
    return this.entry ? Math.max(0, this.entry.hp / this.entry.maxHp) : 0;
  }

  get x(): number {
    return this.entry?.x ?? 0;
  }

  get z(): number {
    return this.entry?.z ?? 0;
  }

  abstract spawn(ctx: BossCtx, x: number, z: number): void;
  abstract onStep(ctx: BossCtx, step: number, bar: number): void;
  abstract update(ctx: BossCtx, dt: number, time: number, beatPhase: number): void;

  protected register(ctx: BossCtx, x: number, z: number, hp: number, radius: number): void {
    const e = ctx.enemies.spawn('mute', x, z, 1, false);
    if (!e) return;
    e.scripted = true;
    e.maxHp = e.hp = hp * ctx.hpMult;
    e.radius = radius;
    e.dmg = 22;
    e.xp = 0;
    e.mass = 999;
    e.elite = true;
    this.entry = e;
  }

  protected radial(ctx: BossCtx, n: number, speed: number, offset: number, r = 0.55): void {
    for (let i = 0; i < n; i++) {
      const a = offset + (i / n) * Math.PI * 2;
      ctx.shoot(this.x + Math.cos(a) * 2, this.z + Math.sin(a) * 2, Math.cos(a) * speed, Math.sin(a) * speed, r);
    }
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    this.extras.forEach((m) => m.removeFromParent());
  }

  /** meshes a boss parks directly in the world (floor sigils) — removed on dispose */
  protected readonly extras: THREE.Object3D[] = [];

  attach(parent: THREE.Object3D): void {
    parent.add(this.group);
    for (const x of this.extras) parent.add(x);
  }
}

/* ───────────────────────── FEEDBACK — the Basement ───────────────────────── */

interface Ring {
  r: number;
  hit: boolean;
  speed: number;
}

export class Feedback extends Boss {
  readonly name = 'FEEDBACK';
  readonly title = 'The amp that screams back';
  readonly color = 0xff3b30;
  private readonly cones: THREE.Mesh[] = [];
  private readonly coneMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: 0xff2a1a, emissiveIntensity: 1 });
  private readonly bodyMat: THREE.ShaderMaterial;
  private readonly tubes: THREE.Mesh[] = [];
  private readonly cable: THREE.InstancedMesh;
  private tolexMat!: THREE.MeshStandardMaterial;
  private readonly rings: Ring[] = [];
  private pulse = 0;
  private spiral = 0;

  constructor(rim: THREE.Color) {
    super();
    const look = hushLooks().bouncer;
    this.bodyMat = makeHushMaterial(look, rim, new THREE.Color(0x401010));
    (this.bodyMat.uniforms.uEyeParams!.value as THREE.Vector4).set(99, 0, 0, 0);
    const body = new THREE.Group();
    body.scale.setScalar(1.3);
    this.group.add(body);
    const cab = new THREE.BoxGeometry(3.2, 2.6, 2.2);
    // a real speaker: surround, cone, dust cap
    const coneGeo = new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.14, 0.06),
        new THREE.Vector2(0.2, 0.0),
        new THREE.Vector2(0.44, -0.12),
        new THREE.Vector2(0.5, -0.1),
      ],
      28,
    );
    coneGeo.rotateX(Math.PI / 2);
    const capGeo = new THREE.SphereGeometry(0.16, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    capGeo.rotateX(Math.PI / 2);
    const surroundGeo = new THREE.TorusGeometry(0.5, 0.045, 8, 32);
    const grille = new THREE.MeshStandardMaterial({ color: 0x0c0a0c, roughness: 0.95 });
    const tolexMat = new THREE.MeshStandardMaterial({ map: tolex(), color: 0x2a2630, roughness: 0.62, metalness: 0.05 });
    this.tolexMat = tolexMat;
    const piping = new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.4 });
    const pipeH = new THREE.BoxGeometry(3.2, 0.06, 0.06);
    const pipeV = new THREE.BoxGeometry(0.06, 2.6, 0.06);
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(cab, tolexMat);
      m.position.set(i % 2 ? 1.65 : -1.65, 1.35 + Math.floor(i / 2) * 2.65, 0);
      body.add(m);
      for (const dy of [-1.3, 1.3]) {
        const p = new THREE.Mesh(pipeH, piping);
        p.position.set(m.position.x, m.position.y + dy, 1.11);
        body.add(p);
      }
      for (const dx of [-1.6, 1.6]) {
        const p = new THREE.Mesh(pipeV, piping);
        p.position.set(m.position.x + dx, m.position.y, 1.11);
        body.add(p);
      }
      const baffle = new THREE.Mesh(new THREE.PlaneGeometry(2.9, 2.3), grille);
      baffle.position.set(m.position.x, m.position.y, 1.105);
      body.add(baffle);
      for (let c = 0; c < 4; c++) {
        const cx = m.position.x + (c % 2 ? 0.7 : -0.7);
        const cy = m.position.y + (c < 2 ? 0.58 : -0.58);
        const cone = new THREE.Mesh(coneGeo, M.rubber());
        cone.position.set(cx, cy, 1.12);
        body.add(cone);
        const cap = new THREE.Mesh(capGeo, M.darkChrome());
        cap.position.set(cx, cy, 1.1);
        body.add(cap);
        const ring = new THREE.Mesh(surroundGeo, this.coneMat);
        ring.position.set(cx, cy, 1.13);
        body.add(ring);
        this.cones.push(cone);
      }
    }
    const head = new THREE.Mesh(new THREE.BoxGeometry(4.2, 1.3, 2), tolexMat);
    head.position.set(0, 6.3, 0);
    body.add(head);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(3.9, 0.7, 0.05), M.gold());
    panel.position.set(0, 6.05, 1.01);
    body.add(panel);
    for (const s of [-1, 1]) {
      const valve = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.5, 6, 12), M.glow(0xffa040, 4));
      valve.position.set(s * 0.9, 6.35, 1.05);
      valve.rotation.z = Math.PI / 2;
      body.add(valve);
      this.tubes.push(valve);
      const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.12, 16), M.chrome());
      knob.rotation.x = Math.PI / 2;
      knob.position.set(s * 1.7, 6.1, 1.02);
      body.add(knob);
    }

    // writhing cables, jacked into the stack
    this.cable = new THREE.InstancedMesh(new THREE.SphereGeometry(0.24, 10, 8), M.rubber(), 4 * 30);
    this.group.add(this.cable);
  }

  spawn(ctx: BossCtx, x: number, z: number): void {
    this.register(ctx, x, z, 9000, 4.4);
    this.group.position.set(x, 0, z);
  }

  onStep(ctx: BossCtx, step: number, bar: number): void {
    if (!this.entry?.alive) return;
    if (step === 0 || (this.phase === 2 && step === 8)) {
      this.rings.push({ r: 4, hit: false, speed: this.phase === 2 ? 15 : 12 });
      ctx.ground.add(GroundKind.Shock, this.x, this.z, 2, 6, 0.3, this.color);
      this.pulse = 1;
      ctx.shake(0.1);
    }
    if (step === 8 && bar % 2 === 1) this.radial(ctx, this.phase === 2 ? 16 : 12, 9, this.spiral);
    if (this.phase === 2 && step % 4 === 2) {
      this.spiral += 0.45;
      this.radial(ctx, 4, 8, this.spiral, 0.45);
    }
    if (step === 0 && bar % 4 === 2) {
      for (let i = 0; i < (this.phase === 2 ? 8 : 5); i++) {
        const a = Math.random() * Math.PI * 2;
        ctx.spawnMinion('mote', this.x + Math.cos(a) * 4, this.z + Math.sin(a) * 4);
      }
    }
  }

  update(ctx: BossCtx, dt: number, time: number, beatPhase: number): void {
    const e = this.entry;
    if (!e) return;
    this.t += dt;
    if (this.phase === 1 && this.hpFrac < 0.5) {
      this.phase = 2;
      ctx.roar();
      ctx.shake(0.5);
    }
    const dx = ctx.px - e.x;
    const dz = ctx.pz - e.z;
    const d = Math.hypot(dx, dz) || 1;
    if (d > 9) {
      e.x += (dx / d) * 2.2 * dt;
      e.z += (dz / d) * 2.2 * dt;
    }
    this.group.position.set(e.x, 0, e.z);
    this.group.rotation.y = Math.atan2(dx, dz);
    this.pulse *= Math.exp(-dt * 6);
    const kick = Math.pow(1 - beatPhase, 4);
    this.coneMat.emissiveIntensity = 0.8 + kick * 4 + this.pulse * 5;
    for (const c of this.cones) c.position.z = 1.12 + kick * 0.12;
    this.group.scale.set(1 + kick * 0.03, 1 - kick * 0.03, 1 + kick * 0.03);
    this.tolexMat.emissive.setRGB(1, 0.3, 0.2).multiplyScalar(Math.min(1, e.flash) * 0.6);

    // cables whip around the stack
    const m4 = new THREE.Matrix4();
    for (let c = 0; c < 4; c++) {
      const base = (c / 4) * Math.PI * 2 + 0.4;
      for (let k = 0; k < 30; k++) {
        const s = k / 29;
        const a = base + Math.sin(time * 2 + c + s * 4) * 0.6 * s;
        const r = 3.2 + s * 6.5;
        m4.makeTranslation(Math.cos(a) * r, 0.4 + Math.sin(s * Math.PI) * 1.5 + Math.sin(time * 5 + k) * 0.1, Math.sin(a) * r);
        this.cable.setMatrixAt(c * 30 + k, m4);
      }
    }
    this.cable.instanceMatrix.needsUpdate = true;

    // feedback rings: dash through them (on the beat, ideally)
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]!;
      r.r += r.speed * dt;
      const pd = Math.hypot(ctx.px - e.x, ctx.pz - e.z);
      if (!r.hit && Math.abs(pd - r.r) < 0.7) {
        r.hit = true;
        if (!ctx.playerInvuln) ctx.hurtPlayer(16, e.x, e.z);
      }
      ctx.ground.add(GroundKind.Wave, e.x, e.z, r.r, r.r, dt * 1.5, this.color, { thickness: 0.02, alpha: 1, fixed: true });
      if (r.r > 40) this.rings.splice(i, 1);
    }
    if (Math.random() < 0.3) {
      ctx.glow.emit({
        x: e.x + (Math.random() - 0.5) * 4,
        y: 6.8,
        z: e.z + (Math.random() - 0.5) * 2,
        vy: 3,
        life: 0.8,
        size: 0.5,
        sizeEnd: 1.4,
        color: 0x301010,
        shape: Shape.Dot,
        alpha: 0.4,
      });
    }
  }
}

/* ───────────────────────── THE CANTOR — the Cathedral ───────────────────────── */

export class Cantor extends Boss {
  readonly name = 'THE CANTOR';
  readonly title = 'Choirmaster of the unsung';
  readonly color = 0x9fb8ff;
  private readonly bodyMat: THREE.ShaderMaterial;
  private halo: THREE.Mesh;
  private readonly hands: THREE.Mesh[] = [];
  private angle = 0;
  private tx = 0;
  private tz = 0;
  private fade = 1;
  private readonly zones: { x: number; z: number; life: number }[] = [];

  private readonly sigil: THREE.Mesh;
  private readonly sigilMat: THREE.ShaderMaterial;
  private readonly crown: THREE.Group;

  constructor(_rim: THREE.Color) {
    super();
    const look = hushLooks().mute;
    // the Cantor's robe catches gold at its edges so it reads on dark marble from above
    this.bodyMat = makeHushMaterial(look, new THREE.Color(0xffc870), new THREE.Color(0x6040ff));
    (this.bodyMat.uniforms.uEyeParams!.value as THREE.Vector4).set(1.62, 0.2, 0.09, 3);
    // tall robe seen from above is mostly grazing: keep the gold to a thin edge
    (this.bodyMat.uniforms.uRimShape!.value as THREE.Vector2).set(9, 0.9);
    const robe = new THREE.Mesh(look.geometry, this.bodyMat);
    robe.scale.setScalar(3.4);
    this.group.add(robe);
    // crown of light: a flat golden ring with rays, visible from the camera
    this.crown = new THREE.Group();
    this.crown.position.set(0, 7.4, 0);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.16, 12, 64), M.glow(0xffd36b, 3.5));
    ring.rotation.x = Math.PI / 2;
    this.crown.add(ring);
    this.halo = ring;
    const rayGeo = new THREE.ConeGeometry(0.22, 1.4, 8);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const ray = new THREE.Mesh(rayGeo, M.glow(0xffe9a8, 3));
      ray.position.set(Math.cos(a) * 3.1, 0, Math.sin(a) * 3.1);
      ray.rotation.z = -Math.PI / 2;
      ray.rotation.y = -a;
      this.crown.add(ray);
    }
    this.group.add(this.crown);
    const handGeo = new THREE.SphereGeometry(0.6, 16, 12);
    for (const s of [-1, 1]) {
      const h = new THREE.Mesh(handGeo, this.bodyMat);
      h.position.set(s * 2.9, 3.6, 0.9);
      this.group.add(h);
      this.hands.push(h);
    }
    // rotating rose-window sigil on the floor beneath
    this.sigilMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPulse: { value: 0 } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform float uPulse; varying vec2 vUv;
        void main(){
          vec2 q = (vUv - 0.5) * 2.0; float r = length(q); float a = atan(q.y, q.x + 1e-4) + uTime * 0.3;
          float rim = smoothstep(0.03, 0.0, abs(r - 0.95)) + smoothstep(0.02, 0.0, abs(r - 0.8));
          float petals = smoothstep(0.035, 0.0, abs(r - (0.5 + 0.22 * cos(a * 8.0)))) * step(r, 0.8);
          float spokes = smoothstep(0.02, 0.0, abs(sin(a * 12.0)) * r) * step(0.25, r) * step(r, 0.8);
          float v = (rim + petals + spokes * 0.6) * (0.6 + uPulse * 0.8);
          gl_FragColor = vec4(vec3(1.0, 0.78, 0.35) * v * 1.6, v);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.sigil = new THREE.Mesh(new THREE.PlaneGeometry(13, 13), this.sigilMat);
    this.sigil.rotation.x = -Math.PI / 2;
    this.sigil.position.y = 0.08;
    this.extras.push(this.sigil);
  }

  get sigilMesh(): THREE.Mesh {
    return this.sigil;
  }

  spawn(ctx: BossCtx, x: number, z: number): void {
    this.register(ctx, x, z, 26000, 2.8);
    this.tx = x;
    this.tz = z;
    this.group.position.set(x, 0.6, z);

  }

  onStep(ctx: BossCtx, step: number, bar: number): void {
    if (!this.entry?.alive) return;
    if (step % 2 === 0 && this.fade > 0.9) {
      this.angle += 0.37;
      const arms = this.phase === 2 ? 4 : 3;
      this.radial(ctx, arms, 7.5, this.angle, 0.5);
      if (this.phase === 2) this.radial(ctx, arms, 6, -this.angle * 1.3, 0.45);
    }
    if (step === 0 && bar % 2 === 1) {
      // teleport somewhere near the player, but always inside the nave
      const a = Math.random() * Math.PI * 2;
      let tx = ctx.px + Math.cos(a) * 12;
      let tz = ctx.pz + Math.sin(a) * 12;
      const d = Math.hypot(tx, tz);
      if (d > 24) {
        tx = (tx / d) * 24;
        tz = (tz / d) * 24;
      }
      this.tx = tx;
      this.tz = tz;
      ctx.ground.add(GroundKind.Telegraph, this.tx, this.tz, 3, 3, 0.9, this.color, { fixed: true });
    }
    if (step === 0 && bar % 4 === 0) {
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.random();
        const zx = ctx.px + Math.cos(a) * 7;
        const zz = ctx.pz + Math.sin(a) * 7;
        this.zones.push({ x: zx, z: zz, life: 4.5 });
        ctx.ground.add(GroundKind.Telegraph, zx, zz, 4, 4, 0.8, 0x4020a0, { fixed: true, alpha: 0.7 });
      }
    }
    if (step === 8 && bar % 4 === 2) {
      for (let i = 0; i < (this.phase === 2 ? 6 : 3); i++) {
        const a = Math.random() * Math.PI * 2;
        ctx.spawnMinion(this.phase === 2 ? 'mute' : 'static', this.x + Math.cos(a) * 5, this.z + Math.sin(a) * 5);
      }
    }
  }

  update(ctx: BossCtx, dt: number, time: number, beatPhase: number): void {
    const e = this.entry;
    if (!e) return;
    if (this.phase === 1 && this.hpFrac < 0.5) {
      this.phase = 2;
      ctx.roar();
    }
    const far = Math.hypot(this.tx - e.x, this.tz - e.z) > 0.5;
    if (far) {
      this.fade = Math.max(0, this.fade - dt * 3);
      if (this.fade === 0) {
        e.x = this.tx;
        e.z = this.tz;
      }
    } else {
      this.fade = Math.min(1, this.fade + dt * 3);
    }
    this.group.position.set(e.x, 0.6 + Math.sin(time * 1.3) * 0.4, e.z);
    this.group.scale.setScalar(0.2 + this.fade * 0.8);
    this.group.rotation.y = Math.atan2(ctx.px - e.x, ctx.pz - e.z);
    const kick = Math.pow(1 - beatPhase, 3);
    this.crown.rotation.y = time * 0.6;
    this.crown.scale.setScalar(1 + kick * 0.12);
    this.sigil.position.x = e.x;
    this.sigil.position.z = e.z;
    this.sigil.scale.setScalar(0.3 + this.fade * 0.7);
    this.sigilMat.uniforms.uTime!.value = time;
    this.sigilMat.uniforms.uPulse!.value = kick;
    void this.halo;
    this.hands.forEach((h, i) => {
      h.position.y = 3.4 + Math.sin(time * 2 + i * 2) * 0.6;
    });
    this.bodyMat.uniforms.uTime!.value = time;
    (this.bodyMat.uniforms.uState!.value as THREE.Vector4).x = Math.min(1, e.flash);
    (this.bodyMat.uniforms.uCamDir!.value as THREE.Vector3).set(0, 0, 1).applyQuaternion(ctx.camQuat);
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const zn = this.zones[i]!;
      zn.life -= dt;
      if (zn.life > 3.7) continue;
      ctx.ground.add(GroundKind.Disc, zn.x, zn.z, 4, 4, dt * 1.5, 0x3a1a90, { fixed: true, alpha: 0.55 });
      if (Math.random() < 0.2)
        ctx.glow.emit({ x: zn.x + (Math.random() - 0.5) * 6, y: 0.3, z: zn.z + (Math.random() - 0.5) * 6, vy: 2, life: 0.8, size: 0.3, color: 0x6040ff, shape: Shape.Note });
      if (zn.life <= 0) this.zones.splice(i, 1);
    }
  }

  inSilence(x: number, z: number): boolean {
    return this.zones.some((zn) => zn.life < 3.7 && (zn.x - x) ** 2 + (zn.z - z) ** 2 < 16);
  }
}

/* ───────────────────────── THE HUSH — the Mainstage ───────────────────────── */

export class TheHush extends Boss {
  readonly name = 'THE HUSH';
  readonly title = 'The end of every song';
  readonly color = 0xf2e8ff;
  private readonly sun: THREE.Mesh;
  private readonly corona: THREE.Mesh;
  private readonly coronaMat: THREE.ShaderMaterial;
  private readonly bodyMat: THREE.ShaderMaterial;
  private silence = false;
  private readonly coronaBack = new THREE.Vector3();
  private stunned = 0;
  private laserAngle = 0;
  private spin = 0;

  constructor(rim: THREE.Color) {
    super();
    const look = hushLooks().mote;
    this.bodyMat = makeHushMaterial(look, rim, new THREE.Color(0x000000));
    (this.bodyMat.uniforms.uEyeParams!.value as THREE.Vector4).set(0.6, 0.2, 0.11, 0);
    this.sun = new THREE.Mesh(look.geometry, this.bodyMat);
    this.sun.scale.setScalar(8);
    this.sun.position.y = -1;
    this.group.add(this.sun);
    this.coronaMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPulse: { value: 0 }, uColor: { value: new THREE.Color(0xfff0d8) } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform float uPulse; uniform vec3 uColor; varying vec2 vUv;
        void main(){
          vec2 q = (vUv - 0.5) * 2.0; float r = length(q); float a = atan(q.y, q.x + 1e-4);
          // eclipse: a razor-thin white-hot rim, then streaming coronal flares
          float rim = smoothstep(0.03, 0.0, abs(r - 0.4)) * (1.5 + uPulse * 2.0);
          float f1 = pow(max(0.0, sin(a * 7.0 + uTime * 0.8)), 14.0);
          float f2 = pow(max(0.0, sin(a * 13.0 - uTime * 1.3 + 1.7)), 22.0);
          float flare = (f1 * 0.6 + f2 * 0.8) * smoothstep(0.8, 0.4, r) * step(0.39, r);
          float glow = smoothstep(0.75, 0.4, r) * step(0.39, r) * 0.25;
          float v = rim + flare * (0.9 + uPulse) + glow;
          gl_FragColor = vec4(uColor * v * 0.85, clamp(v, 0.0, 1.0));
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.corona = new THREE.Mesh(new THREE.PlaneGeometry(19, 19), this.coronaMat);
    this.corona.position.y = 4;
    this.group.add(this.corona);
  }

  spawn(ctx: BossCtx, x: number, z: number): void {
    this.register(ctx, x, z, 90000, 4.2);
    this.group.position.set(x, 0, z);
  }

  /** A DROP shatters the silence and staggers the boss. */
  breakSilence(ctx: BossCtx): void {
    if (!this.silence) return;
    this.silence = false;
    this.stunned = 6;
    this.armor = 3;
    ctx.setSilence(false);
  }

  get silent(): boolean {
    return this.silence;
  }

  onStep(ctx: BossCtx, step: number, bar: number): void {
    if (!this.entry?.alive || this.stunned > 0) return;
    if (step === 0) {
      this.spin += 0.2;
      this.radial(ctx, this.phase >= 2 ? 28 : 22, 8, this.spin, 0.6);
    }
    if (step === 8 && this.phase >= 3) this.radial(ctx, 16, 10, -this.spin, 0.5);
    if (step === 4 && bar % 2 === 0) {
      for (let i = 0; i < 6; i++) {
        const a = Math.random() * Math.PI * 2;
        ctx.spawnMinion(i % 2 ? 'static' : 'wisp', this.x + Math.cos(a) * 6, this.z + Math.sin(a) * 6);
      }
    }
  }

  update(ctx: BossCtx, dt: number, time: number, beatPhase: number): void {
    const e = this.entry;
    if (!e) return;
    this.stunned = Math.max(0, this.stunned - dt);
    if (this.stunned === 0) this.armor = this.silence ? 0.15 : 1;
    if (this.phase === 1 && this.hpFrac < 0.66) {
      this.phase = 2;
      this.silence = true;
      ctx.setSilence(true);
      ctx.roar();
    }
    if (this.phase === 2 && this.hpFrac < 0.33) {
      this.phase = 3;
      ctx.roar();
    }
    const dx = ctx.px - e.x;
    const dz = ctx.pz - e.z;
    const d = Math.hypot(dx, dz) || 1;
    if (d > 12 && this.stunned === 0) {
      e.x += (dx / d) * 1.6 * dt;
      e.z += (dz / d) * 1.6 * dt;
    }
    this.group.position.set(e.x, 1.5 + Math.sin(time) * 0.5, e.z);
    this.sun.rotation.y = Math.atan2(dx, dz);
    const kick = Math.pow(1 - beatPhase, 3);
    this.coronaMat.uniforms.uTime!.value = time;
    this.coronaMat.uniforms.uPulse!.value = kick + (this.silence ? 0 : 0.2);
    (this.coronaMat.uniforms.uColor!.value as THREE.Color).setHex(this.silence ? 0x6040ff : this.stunned > 0 ? 0xff4040 : 0xfff0d8);
    this.corona.quaternion.copy(ctx.camQuat);
    // sit the corona behind the body (away from the camera) so the eclipse stays black
    this.coronaBack.set(0, 0, -1).applyQuaternion(ctx.camQuat).multiplyScalar(-4.5);
    this.corona.position.set(this.coronaBack.x, 3 + this.coronaBack.y, this.coronaBack.z);
    this.bodyMat.uniforms.uTime!.value = time;
    (this.bodyMat.uniforms.uState!.value as THREE.Vector4).x = Math.min(1, e.flash);
    (this.bodyMat.uniforms.uState!.value as THREE.Vector4).z = this.stunned > 0 ? 0.6 : 0;
    (this.bodyMat.uniforms.uCamDir!.value as THREE.Vector3).set(0, 0, 1).applyQuaternion(ctx.camQuat);

    if (this.phase >= 3 && this.stunned === 0) {
      // four sweeping corona lasers
      this.laserAngle += dt * 0.55;
      for (let k = 0; k < 4; k++) {
        const a = this.laserAngle + (k * Math.PI) / 2;
        const ex = e.x + Math.cos(a) * 34;
        const ez = e.z + Math.sin(a) * 34;
        ctx.beams.add(e.x, 1.2, e.z, ex, 1.2, ez, 0.9, 0xfff0d8, dt * 1.6);
        ctx.beams.add(e.x, 1.2, e.z, ex, 1.2, ez, 2.6, 0x8060ff, dt * 1.6, 0.35);
        // player hit test
        const px = ctx.px - e.x;
        const pz = ctx.pz - e.z;
        const along = px * Math.cos(a) + pz * Math.sin(a);
        const perp = Math.abs(-px * Math.sin(a) + pz * Math.cos(a));
        if (along > 0 && along < 34 && perp < 0.9 && !ctx.playerInvuln) ctx.hurtPlayer(20, e.x, e.z);
      }
    }
  }
}
