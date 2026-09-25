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
  /** The crowd throws the performer a lifeline: hearts land near the player. */
  crowdAid(hearts: number): void;
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

  /** Is an unavoidable-looking attack about to reach (px, pz)? (used by the dev autopilot) */
  threat(_px: number, _pz: number): boolean {
    return false;
  }

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
  /** angle of the safe gap you can walk through */
  gap: number;
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
    // woven grille cloth: dark basket weave with a faint silver fleck
    const cloth = canvasTexture(128, 128, (g, w, h) => {
      g.fillStyle = '#0e0d10';
      g.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 4)
        for (let x = 0; x < w; x += 4) {
          const on = ((x + y) / 4) % 2 === 0;
          g.fillStyle = on ? '#2a2830' : '#17161b';
          g.fillRect(x, y, 4, 2);
          g.fillStyle = on ? '#1d1c22' : '#302e37';
          g.fillRect(x, y + 2, 4, 2);
        }
    });
    cloth.wrapS = cloth.wrapT = THREE.RepeatWrapping;
    cloth.repeat.set(6, 5);
    const grille = new THREE.MeshStandardMaterial({ map: cloth, roughness: 0.92, envMapIntensity: 0.15 });
    // black leather, not cardboard: the club's bright environment map would wash a
    // mid-rough dark box out to tan, so the tolex barely takes it
    const tolexMat = new THREE.MeshStandardMaterial({ map: tolex(), color: 0x1c1a20, roughness: 0.8, metalness: 0, envMapIntensity: 0.18 });
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
    // the name plate on top — what the high camera actually sees — and a leather handle
    const logo = canvasTexture(512, 192, (g, w, h) => {
      g.fillStyle = '#16141a';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = '#e8dcc0';
      g.lineWidth = 6;
      g.strokeRect(10, 10, w - 20, h - 20);
      g.font = '96px Bungee, Impact, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#f2e6c8';
      g.fillText('FEEDBACK', w / 2, h / 2 + 6);
    });
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 1.4), new THREE.MeshStandardMaterial({ map: logo, roughness: 0.6, envMapIntensity: 0.2 }));
    plate.rotation.x = -Math.PI / 2;
    plate.position.set(0, 6.96, 0.1);
    body.add(plate);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.09, 8, 20, Math.PI), M.rubber());
    handle.position.set(0, 6.95, -0.6);
    body.add(handle);
    // CLIP lights: blaze whenever the stack attacks
    for (const sx of [-1.75, 1.75]) {
      const clip = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), this.clipMat);
      clip.position.set(sx, 6.6, 1.02);
      body.add(clip);
    }
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

    // writhing cords, jacked into the stack
    const seg = new THREE.CylinderGeometry(0.17, 0.17, 1, 8, 1, true);
    seg.translate(0, 0.5, 0);
    this.cable = new THREE.InstancedMesh(seg, M.rubber(), 4 * 30);
    this.cable.frustumCulled = false;
    this.group.add(this.cable);
    for (let c = 0; c < 4; c++) {
      const jack = new THREE.Group();
      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.7, 14), M.darkChrome());
      jack.add(sleeve);
      const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.6, 10), M.gold());
      tip.position.y = 0.6;
      jack.add(tip);
      this.group.add(jack);
      this.jacks.push(jack);
    }
    // a face in the grille: two cones burn as eyes, a slot of red mouth below
    const eyeMat = M.glow(0xff3b20, 5);
    for (const sx of [-1.95, 1.35]) {
      const eye = new THREE.Mesh(new THREE.CircleGeometry(0.36, 20), eyeMat);
      eye.position.set(sx + 0.3, 4.6 + 0.6, 1.18);
      body.add(eye);
      this.eyes.push(eye);
    }
    const mouth = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.22), M.glow(0xff2a1a, 3));
    mouth.position.set(0, 3.25, 1.19);
    body.add(mouth);
    this.mouth = mouth;
  }

  private readonly clipMat = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff1a1a, emissiveIntensity: 0.2 });
  private readonly jacks: THREE.Group[] = [];
  private readonly eyes: THREE.Mesh[] = [];
  private mouth!: THREE.Mesh;
  private readonly pts: THREE.Vector3[] = Array.from({ length: 31 }, () => new THREE.Vector3());
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly dir = new THREE.Vector3();
  private readonly qq = new THREE.Quaternion();
  private readonly sc = new THREE.Vector3();

  override threat(px: number, pz: number): boolean {
    const d = Math.hypot(px - this.x, pz - this.z);
    return this.rings.some((r) => !r.hit && d - r.r > 0 && d - r.r < 1.6);
  }

  spawn(ctx: BossCtx, x: number, z: number): void {
    this.register(ctx, x, z, 7000, 4.4);
    this.group.position.set(x, 0, z);
  }

  onStep(ctx: BossCtx, step: number, bar: number): void {
    if (!this.entry?.alive) return;
    if (step === 0 || (this.phase === 2 && step === 8)) {
      this.rings.push({ r: 4, hit: false, speed: this.phase === 2 ? 15 : 12, gap: Math.random() * Math.PI * 2 });
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
    this.clipMat.emissiveIntensity = 0.2 + this.pulse * 7 + (kick > 0.8 ? 1.5 : 0);
    for (const c of this.cones) c.position.z = 1.12 + kick * 0.12;
    this.group.scale.set(1 + kick * 0.03, 1 - kick * 0.03, 1 + kick * 0.03);
    this.tolexMat.emissive.setRGB(1, 0.3, 0.2).multiplyScalar(Math.min(1, e.flash) * 0.6);

    // cords whip around the stack: a chain of oriented segments ending in a jack plug
    const m4 = new THREE.Matrix4();
    for (let c = 0; c < 4; c++) {
      const base = (c / 4) * Math.PI * 2 + 0.4;
      for (let k = 0; k <= 30; k++) {
        const s = k / 30;
        const a = base + Math.sin(time * 2 + c + s * 4) * 0.6 * s;
        const r = 3.2 + s * 6.5;
        this.pts[k]!.set(Math.cos(a) * r, 0.4 + Math.sin(s * Math.PI) * 1.5 + Math.sin(time * 5 + k * 0.7) * 0.12, Math.sin(a) * r);
      }
      for (let k = 0; k < 30; k++) {
        const p0 = this.pts[k]!;
        const p1 = this.pts[k + 1]!;
        this.dir.subVectors(p1, p0);
        const len = this.dir.length();
        this.qq.setFromUnitVectors(this.up, this.dir.normalize());
        this.sc.set(1, len * 1.08, 1);
        m4.compose(p0, this.qq, this.sc);
        this.cable.setMatrixAt(c * 30 + k, m4);
      }
      const end = this.pts[30]!;
      const jack = this.jacks[c]!;
      jack.position.copy(end);
      this.dir.subVectors(end, this.pts[29]!).normalize();
      jack.quaternion.setFromUnitVectors(this.up, this.dir);
    }
    this.cable.instanceMatrix.needsUpdate = true;
    for (const eye of this.eyes) eye.scale.setScalar(1 + kick * 0.5 + this.pulse * 0.6);
    this.mouth.scale.y = 1 + this.pulse * 3 + kick;

    // feedback rings: dash through them (on the beat, ideally)
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i]!;
      r.r += r.speed * dt;
      const pd = Math.hypot(ctx.px - e.x, ctx.pz - e.z);
      const pa = Math.atan2(ctx.pz - e.z, ctx.px - e.x);
      const inGap = Math.abs(Math.atan2(Math.sin(pa - r.gap), Math.cos(pa - r.gap))) < 0.42;
      if (!r.hit && Math.abs(pd - r.r) < 0.7) {
        r.hit = true;
        if (!ctx.playerInvuln && !inGap) ctx.hurtPlayer(12, e.x, e.z);
      }
      ctx.ground.add(GroundKind.Wave, e.x, e.z, r.r, r.r, dt * 1.5, this.color, {
        thickness: 0.02,
        alpha: 1,
        fixed: true,
        rot: r.gap,
      });
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
  private readonly robeMat: THREE.MeshStandardMaterial;
  private readonly mouth: THREE.Mesh;
  private sing = 0;
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
    // an ivory-and-gold choirmaster: pale against the black marble so it reads from above
    this.robeMat = new THREE.MeshStandardMaterial({ color: 0xece3d2, roughness: 0.5, metalness: 0.05, emissive: 0xffffff, emissiveIntensity: 0 });
    const gold = M.gold();
    const profile: [number, number][] = [
      [0.01, 0],
      [2.3, 0.05],
      [2.45, 0.4],
      [2.0, 2.4],
      [1.55, 4.2],
      [1.7, 4.75],
      [1.3, 5.3],
      [0.2, 5.45],
    ];
    const v2 = (k: number): THREE.Vector2[] => profile.map(([r, y]) => new THREE.Vector2(r * k, y));
    const robe = new THREE.Mesh(new THREE.LatheGeometry(v2(1), 40), this.robeMat);
    this.group.add(robe);
    // gold stoles following the robe's curve down the front
    for (const phi of [-0.34, 0.2]) {
      const stole = new THREE.Mesh(new THREE.LatheGeometry(v2(1.015), 4, phi, 0.14), gold);
      this.group.add(stole);
    }
    for (const [r, y, t] of [
      [2.43, 0.38, 0.12],
      [1.56, 4.2, 0.08],
      [1.66, 4.78, 0.1],
    ] as const) {
      const band = new THREE.Mesh(new THREE.TorusGeometry(r, t, 8, 48), gold);
      band.rotation.x = Math.PI / 2;
      band.position.y = y;
      this.group.add(band);
    }
    // hood with a dark face: two cold slit eyes and a mouth that opens as it sings
    const hood = new THREE.Mesh(new THREE.SphereGeometry(1.2, 28, 20), this.robeMat);
    hood.position.set(0, 5.85, 0);
    hood.scale.set(1, 1.08, 1);
    this.group.add(hood);
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.78, 28), new THREE.MeshBasicMaterial({ color: 0x05030a }));
    face.position.set(0, 5.8, 1.19);
    face.rotation.x = -0.12;
    face.scale.set(0.9, 1.1, 1);
    this.group.add(face);
    const eyeMat = M.glow(0xcfe0ff, 4);
    for (const sx of [-0.28, 0.28]) {
      const eye = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.07), eyeMat);
      eye.position.set(sx, 6.02, 1.22);
      eye.rotation.set(-0.12, 0, sx > 0 ? -0.18 : 0.18);
      this.group.add(eye);
    }
    this.mouth = new THREE.Mesh(new THREE.CircleGeometry(0.2, 20), M.glow(0xffe9a8, 4));
    this.mouth.position.set(0, 5.5, 1.23);
    this.mouth.rotation.x = -0.12;
    this.group.add(this.mouth);
    // mitre: a pointed-arch cap with a gold cross-band
    const arch = new THREE.Shape();
    arch.moveTo(-0.85, 0);
    arch.lineTo(0.85, 0);
    arch.quadraticCurveTo(0.95, 1.2, 0, 2.3);
    arch.quadraticCurveTo(-0.95, 1.2, -0.85, 0);
    const mitreGeo = new THREE.ExtrudeGeometry(arch, { depth: 1.1, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 2 });
    mitreGeo.translate(0, 0, -0.55);
    const mitre = new THREE.Mesh(mitreGeo, this.robeMat);
    mitre.position.set(0, 6.75, 0);
    this.group.add(mitre);
    const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.9, 0.08), gold);
    crossV.position.set(0, 7.65, 0.62);
    this.group.add(crossV);
    const crossH = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.2, 0.08), gold);
    crossH.position.set(0, 7.9, 0.63);
    this.group.add(crossH);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.22, 1.3), gold);
    brim.position.set(0, 6.8, 0);
    this.group.add(brim);
    // crown of light: a flat golden ring with rays, visible from the camera
    // a thin gold halo behind the head (tilted toward the camera so it reads from above)
    this.crown = new THREE.Group();
    this.crown.position.set(0, 7.4, -1.1);
    this.crown.rotation.x = -0.35;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.08, 10, 64), M.glow(0xffd36b, 3.2));
    this.crown.add(ring);
    this.halo = ring;
    const inner = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.03, 8, 64), M.glow(0xfff1c8, 2.4));
    this.crown.add(inner);
    const rayGeo = new THREE.BoxGeometry(0.05, 0.5, 0.05);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const ray = new THREE.Mesh(rayGeo, M.glow(0xffe9a8, 2.4));
      ray.position.set(Math.cos(a) * 2.05, Math.sin(a) * 2.05, 0);
      ray.rotation.z = a - Math.PI / 2;
      this.crown.add(ray);
    }
    this.group.add(this.crown);
    const handGeo = new THREE.SphereGeometry(0.55, 16, 12);
    const cuffGeo = new THREE.TorusGeometry(0.5, 0.1, 8, 24);
    for (const s of [-1, 1]) {
      const h = new THREE.Mesh(handGeo, this.robeMat);
      h.position.set(s * 2.9, 3.6, 0.9);
      const cuff = new THREE.Mesh(cuffGeo, gold);
      cuff.rotation.y = Math.PI / 2;
      cuff.position.x = -s * 0.35;
      h.add(cuff);
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
          float rim = smoothstep(0.018, 0.0, abs(r - 0.95)) + smoothstep(0.012, 0.0, abs(r - 0.8));
          float petals = smoothstep(0.02, 0.0, abs(r - (0.5 + 0.22 * cos(a * 8.0)))) * step(r, 0.8);
          float spokes = smoothstep(0.02, 0.0, abs(sin(a * 12.0)) * r) * step(0.25, r) * step(r, 0.8);
          float v = (rim + petals + spokes * 0.6) * (0.45 + uPulse * 0.5);
          gl_FragColor = vec4(vec3(1.0, 0.78, 0.35) * v * 0.8, v);
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
    this.register(ctx, x, z, 20000, 2.8);
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
      this.sing = 1;
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
    this.crown.rotation.z = time * 0.4;
    this.crown.scale.setScalar(1 + kick * 0.1);
    this.sigil.position.x = e.x;
    this.sigil.position.z = e.z;
    this.sigil.scale.setScalar(0.3 + this.fade * 0.7);
    this.sigilMat.uniforms.uTime!.value = time;
    this.sigilMat.uniforms.uPulse!.value = kick;
    void this.halo;
    this.hands.forEach((h, i) => {
      h.position.y = 3.4 + Math.sin(time * 2 + i * 2) * 0.6;
    });
    // hits make the ivory flare; the mouth opens wide on every note it sings
    this.robeMat.emissiveIntensity = Math.min(0.5, e.flash * 0.7);
    this.sing = Math.max(this.sing * Math.exp(-dt * 5), kick * 0.6);
    this.mouth.scale.set(1 + this.sing * 0.4, 0.5 + this.sing * 2.2, 1);
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

  constructor(_rim: THREE.Color) {
    super();
    const look = hushLooks().mote;
    this.bodyMat = makeHushMaterial(look, new THREE.Color(0x2a1a40), new THREE.Color(0x000000));
    (this.bodyMat.uniforms.uEyeParams!.value as THREE.Vector4).set(0.6, 0.16, 0.2, 5);
    (this.bodyMat.uniforms.uRimShape!.value as THREE.Vector2).set(6, 0.5);
    this.bodyMat.uniforms.uVoid!.value = 1;
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
          // (kept dim: bloom spreads anything brighter over the body and the eclipse turns grey)
          float rim = smoothstep(0.018, 0.0, abs(r - 0.47)) * (1.2 + uPulse * 1.4);
          float f1 = pow(max(0.0, sin(a * 7.0 + uTime * 0.8)), 16.0);
          float f2 = pow(max(0.0, sin(a * 13.0 - uTime * 1.3 + 1.7)), 26.0);
          float flare = (f1 * 0.5 + f2 * 0.6) * smoothstep(0.85, 0.47, r) * step(0.47, r);
          float glow = smoothstep(0.7, 0.47, r) * step(0.47, r) * 0.1;
          float v = rim + flare * (0.5 + uPulse * 0.6) + glow;
          gl_FragColor = vec4(uColor * v * 0.55, clamp(v, 0.0, 1.0));
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.corona = new THREE.Mesh(new THREE.PlaneGeometry(17, 17), this.coronaMat);
    this.corona.position.y = 4;
    this.group.add(this.corona);
  }

  spawn(ctx: BossCtx, x: number, z: number): void {
    // ×6.2 venue scaling → ~200K: a strong build that uses its DROPs ends it in about 90s
    this.register(ctx, x, z, 32000, 4.2);
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
    if (step === 8 && this.phase >= 3) this.radial(ctx, 12, 10, -this.spin, 0.5);
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
      ctx.crowdAid(2);
    }
    if (this.phase === 2 && this.hpFrac < 0.33) {
      this.phase = 3;
      ctx.roar();
      ctx.crowdAid(3);
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
    // an eclipse never lifts out of black: hits only catch the rim and blaze the eyes
    (this.bodyMat.uniforms.uState!.value as THREE.Vector4).x = Math.min(0.3, e.flash);
    (this.bodyMat.uniforms.uState!.value as THREE.Vector4).z = this.stunned > 0 ? 0.6 : 0;
    (this.bodyMat.uniforms.uCamDir!.value as THREE.Vector3).set(0, 0, 1).applyQuaternion(ctx.camQuat);

    if (this.phase >= 3 && this.stunned === 0) {
      // three sweeping corona lasers (dash through them: dashing is invulnerable)
      this.laserAngle += dt * 0.45;
      for (let k = 0; k < 3; k++) {
        const a = this.laserAngle + (k * Math.PI * 2) / 3;
        const ex = e.x + Math.cos(a) * 34;
        const ez = e.z + Math.sin(a) * 34;
        ctx.beams.add(e.x, 1.2, e.z, ex, 1.2, ez, 0.9, 0xfff0d8, dt * 1.6);
        ctx.beams.add(e.x, 1.2, e.z, ex, 1.2, ez, 2.6, 0x8060ff, dt * 1.6, 0.35);
        // player hit test
        const px = ctx.px - e.x;
        const pz = ctx.pz - e.z;
        const along = px * Math.cos(a) + pz * Math.sin(a);
        const perp = Math.abs(-px * Math.sin(a) + pz * Math.cos(a));
        if (along > 0 && along < 34 && perp < 0.9 && !ctx.playerInvuln) ctx.hurtPlayer(15, e.x, e.z);
      }
    }
  }
}
