import * as THREE from 'three';
import { GroundKind, Shape } from '../render/fx';
import { canvasTexture, M } from '../render/materials';
import { beamGeometry, makeBeamMaterial } from '../render/venues/venue';
import { Boss, type BossCtx } from './bosses';
import type { Enemy } from './enemies';

/* The festival headliners: three new faces of the silence, one per field. */

const TAU = Math.PI * 2;

function screenTex(draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, w = 256, h = 256): THREE.CanvasTexture {
  const t = canvasTexture(w, h, draw);
  t.anisotropy = 4;
  return t;
}

/* ───────────────────────── CURFEW — Sunset Fields ───────────────────────── */

interface Searchlight {
  angle: number;
  speed: number;
  /** 0..1 warm-up before the light starts burning */
  arm: number;
  color: number;
  beam: THREE.Mesh;
  mat: THREE.ShaderMaterial;
}

interface Stomp {
  r: number;
  hit: boolean;
  gap: number;
}

/**
 * CURFEW: the noise ordinance, forty feet tall. Sweeps police searchlights across the
 * field (stand in one too long and you're cited), hands out paper citations in fans, and
 * stomps shockwaves with one gap to slip through. At half health it calls LIGHTS OUT.
 */
export class Curfew extends Boss {
  readonly name = 'CURFEW';
  readonly title = "It's past eleven. Turn it down.";
  readonly color = 0x4d8cff;
  private readonly lights: Searchlight[] = [];
  private readonly stomps: Stomp[] = [];
  private readonly sirens: THREE.Mesh[] = [];
  private readonly sirenMats = [M.glow(0xff2a3a, 3), M.glow(0x2a6bff, 3)];
  private readonly meter: THREE.CanvasTexture;
  private readonly meterCtx: CanvasRenderingContext2D;
  private readonly body = new THREE.Group();
  private readonly megaphone = new THREE.Group();
  private readonly suitMat = new THREE.MeshStandardMaterial({ color: 0x1c2a4a, roughness: 0.55, metalness: 0.2, emissive: 0xffffff, emissiveIntensity: 0 });
  private citeT = 0;
  private level = 0;

  constructor() {
    super();
    const trim = M.chrome();
    const dark = new THREE.MeshStandardMaterial({ color: 0x10141e, roughness: 0.7 });
    // treads and a boxy torso: municipal equipment, not a creature
    for (const x of [-1.6, 1.6]) {
      const tread = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.1, 3.4), dark);
      tread.position.set(x, 0.55, 0);
      this.body.add(tread);
      for (let k = 0; k < 4; k++) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.25, 16), trim);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(x, 0.5, -1.2 + k * 0.8);
        this.body.add(wheel);
      }
    }
    const torso = new THREE.Mesh(new THREE.BoxGeometry(3.6, 3.2, 2.4), this.suitMat);
    torso.position.y = 2.9;
    this.body.add(torso);
    // police livery: a checkered reflective band around the torso reads from the high camera
    const check = screenTex(
      (g, w, h) => {
        for (let x = 0; x < 16; x++)
          for (let y = 0; y < 2; y++) {
            g.fillStyle = (x + y) % 2 ? '#f2f4ff' : '#2a6bff';
            g.fillRect((x * w) / 16, (y * h) / 2, w / 16 + 1, h / 2 + 1);
          }
      },
      256,
      32,
    );
    const band = new THREE.Mesh(new THREE.BoxGeometry(3.66, 0.5, 2.46), new THREE.MeshStandardMaterial({ map: check, roughness: 0.4, emissive: 0x2a3a80, emissiveIntensity: 0.4 }));
    band.position.y = 1.7;
    this.body.add(band);
    const top = new THREE.Mesh(new THREE.BoxGeometry(3.64, 0.06, 2.44), M.glow(0xf2f4ff, 1.2));
    top.position.y = 4.52;
    this.body.add(top);
    const badge = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 1.1),
      new THREE.MeshStandardMaterial({
        map: screenTex(
          (g, w, h) => {
            g.fillStyle = '#e9e2cf';
            g.fillRect(0, 0, w, h);
            g.strokeStyle = '#1c2a4a';
            g.lineWidth = 10;
            g.strokeRect(8, 8, w - 16, h - 16);
            g.fillStyle = '#1c2a4a';
            g.font = '44px Bungee, Impact, sans-serif';
            g.textAlign = 'center';
            g.fillText('NOISE', w / 2, 82);
            g.fillText('CONTROL', w / 2, 132);
            g.font = '600 20px "JetBrains Mono", monospace';
            g.fillText('ORDINANCE 11PM', w / 2, 170);
          },
          256,
          192,
        ),
        roughness: 0.6,
      }),
    );
    badge.position.set(0, 3.1, 1.21);
    this.body.add(badge);
    for (const x of [-2.1, 2.1]) {
      const pad = new THREE.Mesh(new THREE.SphereGeometry(0.8, 18, 12), this.suitMat);
      pad.scale.set(1, 0.7, 1);
      pad.position.set(x, 4.3, 0);
      this.body.add(pad);
    }
    // the head is a decibel meter: a needle that swings with how loud YOU are
    const head = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.9, 1.6), dark);
    head.position.y = 5.5;
    this.body.add(head);
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 160;
    this.meterCtx = c.getContext('2d')!;
    this.meter = new THREE.CanvasTexture(c);
    this.meter.colorSpace = THREE.SRGBColorSpace;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 1.45), new THREE.MeshBasicMaterial({ map: this.meter, toneMapped: false }));
    face.position.set(0, 5.5, 0.81);
    this.body.add(face);
    // siren bar on top
    const bar = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.3, 0.6), trim);
    bar.position.y = 6.6;
    this.body.add(bar);
    [-0.7, 0.7].forEach((x, i) => {
      const s = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.6, 6, 12), this.sirenMats[i]!);
      s.rotation.z = Math.PI / 2;
      s.position.set(x, 6.9, 0);
      this.body.add(s);
      this.sirens.push(s);
    });
    // megaphone arm (right) and clipboard arm (left)
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.25, 1.8, 24, 1, true), new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4, side: THREE.DoubleSide }));
    cone.rotation.x = Math.PI / 2;
    cone.position.z = 1.1;
    this.megaphone.add(cone);
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.8, 0.3), dark);
    grip.position.set(0, -0.5, 0.2);
    this.megaphone.add(grip);
    this.megaphone.position.set(2.6, 3.4, 0.8);
    this.body.add(this.megaphone);
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 1.6, 0.08),
      new THREE.MeshStandardMaterial({
        map: screenTex((g, w, h) => {
          g.fillStyle = '#b8864a';
          g.fillRect(0, 0, w, h);
          g.fillStyle = '#fbf6e9';
          g.fillRect(22, 40, w - 44, h - 60);
          g.fillStyle = '#c33';
          g.font = '30px Bungee, Impact, sans-serif';
          g.textAlign = 'center';
          g.fillText('CITATION', w / 2, 90);
          g.fillStyle = '#555';
          for (let y = 120; y < h - 40; y += 22) g.fillRect(40, y, w - 80, 4);
        }),
        roughness: 0.7,
      }),
    );
    board.position.set(-2.6, 3.0, 0.9);
    board.rotation.set(-0.3, 0.4, 0.2);
    this.body.add(board);
    this.group.add(this.body);

    // two searchlights mounted on the shoulders; a third joins at LIGHTS OUT
    const geo = beamGeometry(0.28);
    [0xff3a4a, 0x3a7bff, 0xffffff].forEach((color, i) => {
      const mat = makeBeamMaterial(color, 0.0);
      const beam = new THREE.Mesh(geo, mat);
      this.extras.push(beam);
      this.lights.push({ angle: i * 2.1, speed: 0.45 + i * 0.12, arm: 0, color, beam, mat });
    });
  }

  override threat(px: number, pz: number): boolean {
    const d = Math.hypot(px - this.x, pz - this.z);
    return this.stomps.some((s) => !s.hit && d - s.r > 0 && d - s.r < 1.6);
  }

  spawn(ctx: BossCtx, x: number, z: number): void {
    this.register(ctx, x, z, 20000, 4.2);
    this.group.position.set(x, 0, z);
  }

  onStep(ctx: BossCtx, step: number, bar: number): void {
    if (!this.entry?.alive) return;
    // STOMP on the downbeat: a shockwave with one gap to slip through
    if (step === 0) {
      this.stomps.push({ r: 3, hit: false, gap: Math.random() * TAU });
      ctx.ground.add(GroundKind.Shock, this.x, this.z, 2, 7, 0.35, this.color);
      ctx.shake(0.15);
    }
    // CITATIONS: a fan of paper aimed at you
    if (step === 8 || (this.phase === 2 && step === 12)) {
      const base = Math.atan2(ctx.pz - this.z, ctx.px - this.x);
      // an odd count with a wider spread: there's always a lane between two citations
      const n = this.phase === 2 ? 7 : 5;
      for (let i = 0; i < n; i++) {
        const a = base + (i - (n - 1) / 2) * 0.22;
        ctx.shoot(this.x + Math.cos(a) * 3, this.z + Math.sin(a) * 3, Math.cos(a) * 9, Math.sin(a) * 9, 0.5);
      }
      this.citeT = 1;
    }
    if (step === 4 && bar % 4 === 1) {
      for (let i = 0; i < (this.phase === 2 ? 8 : 5); i++) {
        const a = Math.random() * TAU;
        ctx.spawnMinion(i % 2 ? 'shusher' : 'mote', this.x + Math.cos(a) * 6, this.z + Math.sin(a) * 6);
      }
    }
  }

  update(ctx: BossCtx, dt: number, time: number, beatPhase: number): void {
    const e = this.entry;
    if (!e) return;
    if (this.phase === 1 && this.hpFrac < 0.5) {
      this.phase = 2;
      ctx.roar();
      ctx.shake(0.5);
      ctx.announce('LIGHTS OUT', 'a third searchlight joins the sweep', '#4d8cff');
    }
    const dx = ctx.px - e.x;
    const dz = ctx.pz - e.z;
    const d = Math.hypot(dx, dz) || 1;
    if (d > 11) {
      e.x += (dx / d) * 2.4 * dt;
      e.z += (dz / d) * 2.4 * dt;
    }
    this.group.position.set(e.x, 0, e.z);
    this.group.rotation.y = Math.atan2(dx, dz);
    const kick = Math.pow(1 - beatPhase, 4);
    this.body.position.y = kick * 0.15;
    this.suitMat.emissiveIntensity = Math.min(0.5, e.flash * 0.6);
    // sirens alternate on the beat
    const flip = Math.floor(time * 4) % 2;
    this.sirenMats[0]!.emissiveIntensity = flip ? 6 : 0.6;
    this.sirenMats[1]!.emissiveIntensity = flip ? 0.6 : 6;
    this.citeT = Math.max(0, this.citeT - dt * 3);
    this.megaphone.rotation.x = -this.citeT * 0.5;

    // decibel meter: the needle reads how loud the room is right now
    this.level += ((0.35 + kick * 0.5 + (this.phase === 2 ? 0.15 : 0)) - this.level) * Math.min(1, dt * 8);
    this.drawMeter();

    // searchlights: arm up, then burn anyone standing in the pool
    const n = this.phase === 2 ? 3 : 2;
    this.lights.forEach((l, i) => {
      const on = i < n;
      l.arm = on ? Math.min(1, l.arm + dt * 0.5) : 0;
      l.angle += l.speed * dt * (this.phase === 2 ? 1.35 : 1) * (i % 2 ? -1 : 1);
      const reach = 9 + Math.sin(time * 0.7 + i * 2) * 5;
      const gx = e.x + Math.cos(l.angle) * reach;
      const gz = e.z + Math.sin(l.angle) * reach;
      const hx = e.x + (i - 0.5) * 2.4;
      const hy = 5.2;
      const beam = l.beam;
      beam.visible = on;
      if (!on) return;
      const len = Math.hypot(gx - hx, hy, gz - e.z);
      beam.position.set(hx, hy, e.z);
      beam.scale.set(3.4, len, 3.4);
      beam.lookAt(gx, 0, gz);
      beam.rotateX(-Math.PI / 2);
      l.mat.uniforms.uTime!.value = time;
      l.mat.uniforms.uOpacity!.value = 0.18 + l.arm * 0.5;
      // the pool on the ground: pale while arming, hard-edged once it can cite you
      ctx.glow.emit({ x: gx, y: 0.15, z: gz, life: dt * 1.5, size: 5.6, color: l.color, shape: Shape.Dot, alpha: 0.12 + l.arm * 0.3 });
      ctx.ground.add(GroundKind.Disc, gx, gz, 2.6, 2.6, dt * 1.6, 0xffffff, { fixed: true, alpha: 0.12 + l.arm * 0.35 });
      ctx.ground.add(GroundKind.Ring, gx, gz, 2.7, 2.7, dt * 1.6, l.color, { fixed: true, thickness: 0.06, alpha: 0.4 + l.arm * 0.6 });
      if (l.arm >= 1) {
        if (Math.hypot(ctx.px - gx, ctx.pz - gz) < 2.6 && !ctx.playerInvuln) ctx.hurtPlayer(14, gx, gz);
      }
    });

    // stomp waves
    const pd = Math.hypot(ctx.px - e.x, ctx.pz - e.z);
    const pa = Math.atan2(ctx.pz - e.z, ctx.px - e.x);
    for (let i = this.stomps.length - 1; i >= 0; i--) {
      const s = this.stomps[i]!;
      s.r += (this.phase === 2 ? 14 : 11) * dt;
      const inGap = Math.abs(Math.atan2(Math.sin(pa - s.gap), Math.cos(pa - s.gap))) < 0.45;
      if (!s.hit && Math.abs(pd - s.r) < 0.7) {
        s.hit = true;
        if (!ctx.playerInvuln && !inGap) ctx.hurtPlayer(12, e.x, e.z);
      }
      ctx.ground.add(GroundKind.Wave, e.x, e.z, s.r, s.r, dt * 1.5, this.color, { thickness: 0.02, alpha: 1, fixed: true, rot: s.gap });
      if (s.r > 44) this.stomps.splice(i, 1);
    }
  }

  private drawMeter(): void {
    const g = this.meterCtx;
    const w = 256;
    const h = 160;
    g.fillStyle = '#0d1420';
    g.fillRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h - 18;
    g.lineWidth = 16;
    const zones: [number, number, string][] = [
      [Math.PI, Math.PI * 1.55, '#3dffb0'],
      [Math.PI * 1.55, Math.PI * 1.8, '#ffe14d'],
      [Math.PI * 1.8, Math.PI * 2, '#ff3b5c'],
    ];
    for (const [a0, a1, col] of zones) {
      g.strokeStyle = col;
      g.beginPath();
      g.arc(cx, cy, 104, a0, a1);
      g.stroke();
    }
    const a = Math.PI + Math.min(1, this.level) * Math.PI;
    g.strokeStyle = '#ffffff';
    g.lineWidth = 6;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(a) * 96, cy + Math.sin(a) * 96);
    g.stroke();
    g.fillStyle = '#ffffff';
    g.font = '22px Bungee, Impact, sans-serif';
    g.textAlign = 'center';
    g.fillText('dB', cx, cy - 30);
    this.meter.needsUpdate = true;
  }
}

/* ───────────────────────── THE MIRAGE — Neon Desert ───────────────────────── */

interface Decoy {
  entry: Enemy;
  id: number;
  group: THREE.Group;
}

const PRISM_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vView;
varying vec3 vObj;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vView = normalize(cameraPosition - wp.xyz);
  vObj = position;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const PRISM_FRAG = /* glsl */ `
uniform float uTime;
uniform float uFlash;
uniform float uGhost;
uniform float uBeat;
varying vec3 vN;
varying vec3 vView;
varying vec3 vObj;
void main() {
  vec3 n = normalize(vN);
  float ndv = max(dot(n, vView), 0.0);
  float fres = pow(1.0 - ndv, 2.5);
  // thin-film rainbow that slides with view angle and time: glass in desert heat
  float t = fres * 2.2 + vObj.y * 0.25 + uTime * 0.2;
  vec3 film = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + t));
  vec3 col = mix(vec3(0.03, 0.02, 0.06), film, 0.25 + fres * 0.75);
  col += film * pow(fres, 3.0) * 1.6;
  col += vec3(1.0) * uFlash * fres * 2.0;
  // the tell: only the real one's glass throbs with the music
  col += film * uBeat * (1.0 - uGhost) * 0.9;
  // decoys shimmer: scanline heat haze
  float haze = 0.5 + 0.5 * sin(vObj.y * 30.0 + uTime * 12.0);
  float a = mix(1.0, 0.55 + haze * 0.3, uGhost);
  gl_FragColor = vec4(col, a);
}`;

/**
 * THE MIRAGE: heat made of glass. Splits into shimmering copies that fire like the real
 * thing; only the real one bleeds (its core beats in time and it casts a shadow). Every few
 * bars they shuffle like a shell game, and sand-worms tear lines across the playa.
 */
export class Mirage extends Boss {
  readonly name = 'THE MIRAGE';
  readonly title = 'Nothing out here is real';
  readonly color = 0xff4df0;
  private readonly mat: THREE.ShaderMaterial;
  private readonly ghostMat: THREE.ShaderMaterial;
  private readonly core: THREE.Mesh;
  private readonly shards: THREE.Mesh[] = [];
  private readonly decoys: Decoy[] = [];
  private readonly worms: { x0: number; z0: number; x1: number; z1: number; t: number; fired: boolean }[] = [];
  private spin = 0;
  private flash = 0;
  private orbit = 0;

  constructor() {
    super();
    this.mat = new THREE.ShaderMaterial({
      vertexShader: PRISM_VERT,
      fragmentShader: PRISM_FRAG,
      uniforms: { uTime: { value: 0 }, uFlash: { value: 0 }, uGhost: { value: 0 }, uBeat: { value: 0 } },
    });
    this.ghostMat = this.mat.clone();
    this.ghostMat.uniforms.uGhost!.value = 1;
    this.ghostMat.uniforms.uBeat!.value = 0;
    this.ghostMat.transparent = true;
    this.ghostMat.depthWrite = false;
    this.buildFigure(this.group, this.mat, true);
    this.core = this.group.getObjectByName('core') as THREE.Mesh;
  }

  /** The figure: a stack of prisms (head, torso, flared robe) with orbiting shards and a core. */
  private buildFigure(parent: THREE.Group, mat: THREE.ShaderMaterial, real: boolean): void {
    const robe = new THREE.Mesh(new THREE.ConeGeometry(2.2, 4.6, 6, 1, true), mat);
    robe.position.y = 2.3;
    parent.add(robe);
    const torso = new THREE.Mesh(new THREE.OctahedronGeometry(1.5, 0), mat);
    torso.scale.set(1, 1.5, 1);
    torso.position.y = 5.2;
    parent.add(torso);
    const head = new THREE.Mesh(new THREE.OctahedronGeometry(0.85, 0), mat);
    head.position.y = 7.6;
    parent.add(head);
    // a heart that sits proud of the chest, so the camera can see which one beats
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.6, 1), M.glow(0xff9af0, 5));
    core.position.set(0, 5.3, 1.35);
    core.name = 'core';
    core.visible = real;
    parent.add(core);
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Mesh(new THREE.TetrahedronGeometry(0.6, 0), mat);
      s.userData.a = (i / 6) * TAU;
      parent.add(s);
      if (real) this.shards.push(s);
    }
  }

  spawn(ctx: BossCtx, x: number, z: number): void {
    this.register(ctx, x, z, 36000, 3);
    this.group.position.set(x, 0, z);
    this.split(ctx, 2);
  }

  /** Throw off shimmering copies (each is a real target that shatters when hit enough). */
  private split(ctx: BossCtx, n: number): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const e = ctx.enemies.spawn('mute', this.x + Math.cos(a) * 10, this.z + Math.sin(a) * 10, 1, false);
      if (!e) continue;
      e.scripted = true;
      e.maxHp = e.hp = (this.entry?.maxHp ?? 1000) * 0.03;
      e.radius = 3;
      e.dmg = 18;
      e.xp = 0;
      e.mass = 999;
      const g = new THREE.Group();
      this.buildFigure(g, this.ghostMat, false);
      g.position.set(e.x, 0, e.z);
      // before the boss is attached, copies ride along as extras (attach adds them)
      if (this.group.parent) this.group.parent.add(g);
      else this.extras.push(g);
      this.decoys.push({ entry: e, id: e.id, group: g });
    }
  }

  onStep(ctx: BossCtx, step: number, bar: number): void {
    if (!this.entry?.alive) return;
    // heat spirals from every figure, real or not
    if (step % 4 === 0) {
      this.spin += 0.5;
      const arms = this.phase === 2 ? 4 : 3;
      this.radial(ctx, arms, 8, this.spin, 0.5);
      for (const dcy of this.decoys) {
        if (!dcy.entry.alive || dcy.entry.id !== dcy.id) continue;
        for (let i = 0; i < arms; i++) {
          const a = -this.spin + (i / arms) * TAU;
          ctx.shoot(dcy.entry.x + Math.cos(a) * 2, dcy.entry.z + Math.sin(a) * 2, Math.cos(a) * 7, Math.sin(a) * 7, 0.45);
        }
      }
    }
    // the shell game: every four bars the real one trades places with a copy
    if (step === 0 && bar % 4 === 3) {
      const live = this.decoys.filter((d) => d.entry.alive && d.entry.id === d.id);
      const swap = live[Math.floor(Math.random() * live.length)];
      if (swap && this.entry) {
        const ex = this.entry.x;
        const ez = this.entry.z;
        this.entry.x = swap.entry.x;
        this.entry.z = swap.entry.z;
        swap.entry.x = ex;
        swap.entry.z = ez;
        ctx.glow.burst(ex, 4, ez, 40, 0xffffff, 14, { life: 0.5, size: 0.4, shape: Shape.Spark });
        ctx.glow.burst(this.entry.x, 4, this.entry.z, 40, 0xffffff, 14, { life: 0.5, size: 0.4, shape: Shape.Spark });
      }
      // lost copies grow back
      if (live.length < (this.phase === 2 ? 4 : 2)) this.split(ctx, 1);
    }
    // sand-worms: a line telegraphs, then erupts
    if (step === 8 && bar % 2 === 0) {
      const a = Math.random() * TAU;
      const cx = ctx.px + (Math.random() - 0.5) * 6;
      const cz = ctx.pz + (Math.random() - 0.5) * 6;
      const L = 26;
      this.worms.push({ x0: cx - Math.cos(a) * L, z0: cz - Math.sin(a) * L, x1: cx + Math.cos(a) * L, z1: cz + Math.sin(a) * L, t: 1.1, fired: false });
    }
    if (step === 4 && bar % 4 === 1) {
      for (let i = 0; i < (this.phase === 2 ? 6 : 4); i++) {
        const a = Math.random() * TAU;
        ctx.spawnMinion('wisp', this.x + Math.cos(a) * 5, this.z + Math.sin(a) * 5);
      }
    }
  }

  update(ctx: BossCtx, dt: number, time: number, beatPhase: number): void {
    const e = this.entry;
    if (!e) return;
    if (this.phase === 1 && this.hpFrac < 0.5) {
      this.phase = 2;
      ctx.roar();
      ctx.announce('HEATSTROKE', 'more copies — find the one that beats', '#ff4df0');
      this.split(ctx, 2);
    }
    // every figure keeps its own station on a slow carousel around the player, so the
    // copies surround you instead of bunching into one blob
    const figures = [e, ...this.decoys.filter((q) => q.entry.alive && q.entry.id === q.id).map((q) => q.entry)];
    this.orbit += dt * 0.12;
    figures.forEach((f, i) => {
      const a = this.orbit + (i / figures.length) * TAU;
      const tx = ctx.px + Math.cos(a) * 14;
      const tz = ctx.pz + Math.sin(a) * 14;
      const k = Math.min(1, dt * 0.8);
      f.x += (tx - f.x) * k;
      f.z += (tz - f.z) * k;
    });
    const kick = Math.pow(1 - beatPhase, 3);
    this.flash = Math.max(this.flash * Math.exp(-dt * 8), Math.min(1, e.flash));
    const bob = Math.sin(time * 1.4) * 0.4;
    this.group.position.set(e.x, 1 + bob, e.z);
    this.group.rotation.y = time * 0.3;
    this.mat.uniforms.uTime!.value = time;
    this.mat.uniforms.uFlash!.value = this.flash;
    this.mat.uniforms.uBeat!.value = kick;
    this.ghostMat.uniforms.uTime!.value = time;
    // the tell: the real core beats with the music
    this.core.scale.setScalar(1 + kick * 0.6);
    for (const s of this.shards) {
      const a = s.userData.a + time * 1.3;
      s.position.set(Math.cos(a) * 3, 5 + Math.sin(time * 2 + a) * 0.8, Math.sin(a) * 3);
      s.rotation.set(time, time * 1.3, 0);
    }
    // the real one casts a shadow; copies don't
    ctx.ground.add(GroundKind.Disc, e.x, e.z, 2.6, 2.6, dt * 1.5, 0x000000, { fixed: true, alpha: 0.25 });
    for (let i = this.decoys.length - 1; i >= 0; i--) {
      const dcy = this.decoys[i]!;
      if (!dcy.entry.alive || dcy.entry.id !== dcy.id) {
        // a copy dies: it shatters into glitter
        ctx.glow.burst(dcy.group.position.x, 4, dcy.group.position.z, 70, 0xff9af0, 20, { vy: 6, life: 1, size: 0.45, shape: Shape.Spark, gravity: 8 });
        dcy.group.removeFromParent();
        this.decoys.splice(i, 1);
        continue;
      }
      const q = dcy.entry;
      dcy.group.position.set(q.x, 1 + Math.sin(time * 1.4 + i) * 0.4, q.z);
      dcy.group.rotation.y = time * 0.3 + i;
    }
    // sand-worms
    for (let i = this.worms.length - 1; i >= 0; i--) {
      const w = this.worms[i]!;
      w.t -= dt;
      const steps = 14;
      for (let k = 0; k <= steps; k++) {
        const s = k / steps;
        const x = w.x0 + (w.x1 - w.x0) * s;
        const z = w.z0 + (w.z1 - w.z0) * s;
        if (!w.fired) ctx.ground.add(GroundKind.Disc, x, z, 1.4, 1.4, dt * 1.5, 0xff4df0, { fixed: true, alpha: 0.18 + (1 - w.t) * 0.3 });
      }
      if (!w.fired && w.t <= 0) {
        w.fired = true;
        for (let k = 0; k <= steps; k++) {
          const s = k / steps;
          const x = w.x0 + (w.x1 - w.x0) * s;
          const z = w.z0 + (w.z1 - w.z0) * s;
          ctx.ground.add(GroundKind.Shock, x, z, 0.5, 2.4, 0.5, 0xffb0f5, { thickness: 0.1 });
          ctx.glow.burst(x, 0.6, z, 6, 0xffd0a0, 8, { vy: 6, life: 0.6, size: 0.35, shape: Shape.Square, gravity: 14 });
        }
        // distance from the player to the worm line
        const lx = w.x1 - w.x0;
        const lz = w.z1 - w.z0;
        const l2 = lx * lx + lz * lz || 1;
        const s = Math.max(0, Math.min(1, ((ctx.px - w.x0) * lx + (ctx.pz - w.z0) * lz) / l2));
        const px = w.x0 + lx * s;
        const pz = w.z0 + lz * s;
        if (Math.hypot(ctx.px - px, ctx.pz - pz) < 1.9 && !ctx.playerInvuln) ctx.hurtPlayer(16, px, pz);
        ctx.shake(0.25);
      }
      if (w.fired && w.t < -0.4) this.worms.splice(i, 1);
    }
  }

  override dispose(): void {
    for (const d of this.decoys) d.group.removeFromParent();
    this.decoys.length = 0;
    super.dispose();
  }
}

/* ───────────────────────── THE ALGORITHM — Megafest ───────────────────────── */

/**
 * THE ALGORITHM: everything sounds the same now. A monolith of screens that learns your
 * song and plays it back at you (AUTOPLAY fires on your own lit steps), SKIPs next to you,
 * and sweeps TRENDING beams from its orbit of phones.
 */
export class Algorithm extends Boss {
  readonly name = 'THE ALGORITHM';
  readonly title = 'Everything sounds the same now';
  readonly color = 0x2ee6ff;
  private readonly cube = new THREE.Group();
  private readonly faceMat: THREE.MeshBasicMaterial;
  private readonly feed: THREE.CanvasTexture;
  private readonly feedCtx: CanvasRenderingContext2D;
  private readonly phones: THREE.InstancedMesh;
  private readonly spinner: THREE.Mesh;
  private readonly shellMat = new THREE.MeshStandardMaterial({ color: 0x06060a, roughness: 0.25, metalness: 0.6, emissive: 0xffffff, emissiveIntensity: 0 });
  private beamAngle = 0;
  private skipT = -1;
  private skipX = 0;
  private skipZ = 0;
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3(1, 1, 1);
  private feedT = 0;

  constructor() {
    super();
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    this.feedCtx = c.getContext('2d')!;
    this.feed = new THREE.CanvasTexture(c);
    this.feed.colorSpace = THREE.SRGBColorSpace;
    this.faceMat = new THREE.MeshBasicMaterial({ map: this.feed, toneMapped: false });
    const shell = new THREE.Mesh(new THREE.BoxGeometry(5.6, 5.6, 5.6), this.shellMat);
    this.cube.add(shell);
    // six screens, each showing the feed with a play-button eye
    const faces: [number, number, number, number, number][] = [
      [0, 0, 2.81, 0, 0],
      [0, 0, -2.81, 0, Math.PI],
      [2.81, 0, 0, 0, Math.PI / 2],
      [-2.81, 0, 0, 0, -Math.PI / 2],
      [0, 2.81, 0, -Math.PI / 2, 0],
      [0, -2.81, 0, Math.PI / 2, 0],
    ];
    for (const [x, y, z, rx, ry] of faces) {
      const f = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), this.faceMat);
      f.position.set(x, y, z);
      f.rotation.set(rx, ry, 0);
      this.cube.add(f);
    }
    this.cube.position.y = 6;
    this.group.add(this.cube);
    // loading spinner beneath it
    this.spinner = new THREE.Mesh(new THREE.TorusGeometry(3.4, 0.14, 8, 64, Math.PI * 1.5), M.glow(0x2ee6ff, 3));
    this.spinner.rotation.x = -Math.PI / 2;
    this.spinner.position.y = 0.3;
    this.group.add(this.spinner);
    // an orbit of phones, screens lit with random "thumbnails"
    const phoneGeo = new THREE.BoxGeometry(0.9, 1.6, 0.08);
    this.phones = new THREE.InstancedMesh(phoneGeo, new THREE.MeshBasicMaterial({ toneMapped: false }), 24);
    const col = new THREE.Color();
    const pal = [0xff2d78, 0x2ee6ff, 0xffd36b, 0x8cff5a, 0xb04dff];
    for (let i = 0; i < 24; i++) this.phones.setColorAt(i, col.setHex(pal[i % pal.length]!).multiplyScalar(1.6));
    this.phones.frustumCulled = false;
    this.group.add(this.phones);
    this.drawFeed(0);
  }

  spawn(ctx: BossCtx, x: number, z: number): void {
    // the tour's last boss: a strong build (~150k DPS) should still get a real fight
    this.register(ctx, x, z, 44000, 3.6);
    this.group.position.set(x, 0, z);
  }

  onStep(ctx: BossCtx, step: number, bar: number): void {
    if (!this.entry?.alive) return;
    // AUTOPLAY: every lit step of YOUR machine fires back at you
    // (a dense machine would make this a wall: the volley is capped, and in phase two it
    // plays every step but aims either side of you on alternate steps)
    const hits = ctx.patternHits(step);
    if (hits > 0 && (this.phase === 2 || step % 2 === 0)) {
      const side = this.phase === 2 ? (step % 2 ? 0.35 : -0.35) : 0;
      const base = Math.atan2(ctx.pz - this.z, ctx.px - this.x) + side;
      const n = Math.min(this.phase === 2 ? 2 : 3, hits);
      for (let i = 0; i < n; i++) {
        const a = base + (i - (n - 1) / 2) * 0.26;
        ctx.shoot(this.x + Math.cos(a) * 3.5, this.z + Math.sin(a) * 3.5, Math.cos(a) * 8, Math.sin(a) * 8, 0.45);
      }
    }
    // SKIP: telegraph a spot beside you, then appear there with a burst
    if (step === 0 && bar % 4 === 2 && this.skipT < 0) {
      const a = Math.random() * TAU;
      this.skipX = ctx.px + Math.cos(a) * 11;
      this.skipZ = ctx.pz + Math.sin(a) * 11;
      this.skipT = 1.2;
      ctx.ground.add(GroundKind.Telegraph, this.skipX, this.skipZ, 4, 4, 1.2, this.color, { fixed: true });
    }
    if (step === 8 && bar % 2 === 1) {
      for (let i = 0; i < (this.phase === 2 ? 8 : 5); i++) {
        const a = Math.random() * TAU;
        ctx.spawnMinion(i % 2 ? 'static' : 'wisp', this.x + Math.cos(a) * 6, this.z + Math.sin(a) * 6);
      }
    }
  }

  update(ctx: BossCtx, dt: number, time: number, beatPhase: number): void {
    const e = this.entry;
    if (!e) return;
    if (this.phase === 1 && this.hpFrac < 0.5) {
      this.phase = 2;
      ctx.roar();
      ctx.announce('RECOMMENDED FOR YOU', 'it plays every step of your song now', '#2ee6ff');
    }
    const dx = ctx.px - e.x;
    const dz = ctx.pz - e.z;
    const d = Math.hypot(dx, dz) || 1;
    if (this.skipT >= 0) {
      this.skipT -= dt;
      if (this.skipT < 0) {
        e.x = this.skipX;
        e.z = this.skipZ;
        ctx.glow.burst(e.x, 5, e.z, 60, 0x2ee6ff, 18, { life: 0.6, size: 0.45, shape: Shape.Square });
        this.radial(ctx, this.phase === 2 ? 18 : 12, 9, Math.random() * TAU, 0.5);
        ctx.shake(0.3);
      }
    } else if (d > 12) {
      e.x += (dx / d) * 1.8 * dt;
      e.z += (dz / d) * 1.8 * dt;
    }
    const kick = Math.pow(1 - beatPhase, 3);
    this.group.position.set(e.x, Math.sin(time) * 0.3, e.z);
    this.cube.rotation.set(time * 0.3, time * 0.45, 0);
    this.cube.scale.setScalar(1 + kick * 0.05);
    this.spinner.rotation.z = -time * 4;
    this.shellMat.emissiveIntensity = Math.min(0.4, e.flash * 0.5);
    this.feedT += dt;
    if (this.feedT > 0.12) {
      this.feedT = 0;
      this.drawFeed(time);
    }
    // phones orbit on two tilted rings
    for (let i = 0; i < 24; i++) {
      const ring = i % 2;
      const a = (i / 24) * TAU + time * (ring ? 0.6 : -0.45);
      const r = ring ? 7 : 8.5;
      this.v.set(Math.cos(a) * r, 5 + Math.sin(a * 2 + time) * (ring ? 1.4 : -1.2), Math.sin(a) * r);
      this.q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, -a + Math.PI / 2);
      this.m4.compose(this.v, this.q, this.s);
      this.phones.setMatrixAt(i, this.m4);
    }
    this.phones.instanceMatrix.needsUpdate = true;

    // TRENDING: beams sweep out from the monolith (dash through them)
    const beams = this.phase === 2 ? 3 : 2;
    this.beamAngle += dt * (this.phase === 2 ? 0.55 : 0.4);
    for (let k = 0; k < beams; k++) {
      const a = this.beamAngle + (k * TAU) / beams;
      const ex = e.x + Math.cos(a) * 34;
      const ez = e.z + Math.sin(a) * 34;
      ctx.beams.add(e.x, 1.2, e.z, ex, 1.2, ez, 0.8, 0xffffff, dt * 1.6);
      ctx.beams.add(e.x, 1.2, e.z, ex, 1.2, ez, 2.4, 0x2ee6ff, dt * 1.6, 0.35);
      const px = ctx.px - e.x;
      const pz = ctx.pz - e.z;
      const along = px * Math.cos(a) + pz * Math.sin(a);
      const perp = Math.abs(-px * Math.sin(a) + pz * Math.cos(a));
      if (along > 3 && along < 34 && perp < 0.9 && !ctx.playerInvuln) ctx.hurtPlayer(14, e.x, e.z);
    }
  }

  /** The feed: scrolling thumbnails around a big play-button eye that looks at you. */
  private drawFeed(time: number): void {
    const g = this.feedCtx;
    const w = 256;
    g.fillStyle = '#05050a';
    g.fillRect(0, 0, w, w);
    const pal = ['#ff2d78', '#2ee6ff', '#ffd36b', '#8cff5a', '#b04dff'];
    const off = (time * 60) % 64;
    for (let y = -64; y < w; y += 64)
      for (let x = 0; x < w; x += 64) {
        g.fillStyle = pal[((x + y + Math.floor(time * 2) * 64) / 64) % pal.length | 0]!;
        g.globalAlpha = 0.22;
        g.fillRect(x + 4, y + off + 4, 56, 56);
      }
    g.globalAlpha = 1;
    // the eye: a white play triangle in a cyan→magenta lozenge
    const grad = g.createLinearGradient(58, 78, 198, 178);
    grad.addColorStop(0, '#2ee6ff');
    grad.addColorStop(1, '#ff2dd4');
    g.fillStyle = grad;
    g.beginPath();
    g.roundRect(58, 78, 140, 100, 50);
    g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath();
    g.moveTo(108, 100);
    g.lineTo(158, 128);
    g.lineTo(108, 156);
    g.closePath();
    g.fill();
    // progress bar that never finishes
    g.fillStyle = '#ffffff33';
    g.fillRect(20, 226, 216, 6);
    g.fillStyle = '#2ee6ff';
    g.fillRect(20, 226, 216 * ((time * 0.05) % 1), 6);
    this.feed.needsUpdate = true;
  }
}
