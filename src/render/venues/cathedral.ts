import * as THREE from 'three';
import type { Rng } from '../../core/rng';
import { canvasTexture, M } from '../materials';
import {
  beamGeometry,
  GLSL_COMMON,
  makeBeamMaterial,
  makeFlameMaterial,
  RippleBank,
  type Bounds,
  type FrameInfo,
  type Venue,
  type VenuePalette,
} from './venue';

const R = 30;

const FLOOR_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FLOOR_FRAG = /* glsl */ `
${GLSL_COMMON}
uniform float uBeat;
uniform float uBar;
uniform float uEnergy;
uniform float uDrop;
uniform vec2 uPlayer;
uniform float uR;
uniform vec3 uWin[6];
uniform vec4 uPools[6];
varying vec3 vWorld;

void main() {
  vec2 w = vWorld.xz;
  float r = length(w);
  float ang = atan(w.y, w.x + 1e-4);
  float beat = pow(1.0 - uBeat, 2.5);

  // polished dark marble: slate with pale gold-white veins and a cold sheen
  float veins = fbm(w * 0.16 + fbm(w * 0.32) * 2.6);
  float vein = smoothstep(0.018, 0.0, abs(veins - 0.52));
  float vein2 = smoothstep(0.01, 0.0, abs(fbm(w * 0.4 + 7.0) - 0.5)) * 0.5;
  vec3 marble = mix(vec3(0.045, 0.045, 0.07), vec3(0.085, 0.082, 0.11), fbm(w * 0.5));
  marble += (vein + vein2) * vec3(0.32, 0.28, 0.2);
  // big slab joints
  vec2 slab = abs(fract(w / 6.0) - 0.5);
  float joint = smoothstep(0.485, 0.5, max(slab.x, slab.y));
  marble *= 1.0 - joint * 0.5;
  // polished floor catches a soft cold reflection toward the camera
  marble += vec3(0.03, 0.035, 0.06) * smoothstep(40.0, 0.0, abs(w.y - uPlayer.y + 12.0));

  // gold inlay: rose window at the centre and concentric bands
  // distance to the nearest concentric band (every 7.5 units)
  float ringD = 3.75 - abs(mod(r, 7.5) - 3.75);
  float rings = smoothstep(0.09, 0.0, ringD) * step(1.0, r);
  float spokes = smoothstep(0.06, 0.0, abs(sin(ang * 12.0)) * r * 0.08 - 0.02) * step(r, 7.5);
  float petal = smoothstep(0.06, 0.0, abs(r - (4.0 + 1.6 * cos(ang * 8.0)))) * step(r, 7.0);
  float inlay = max(max(rings, spokes), petal);
  vec3 gold = vec3(1.0, 0.72, 0.28);
  vec3 col = mix(marble, gold * (0.5 + beat * 0.9 + uEnergy * 0.4), inlay * 0.85);

  // stained-glass light pools drifting across the nave
  for (int i = 0; i < 6; i++) {
    vec2 d = (w - uPools[i].xy) / uPools[i].z;
    float pool = smoothstep(1.0, 0.2, length(d * vec2(1.0, 1.6)));
    // leaded-glass pattern inside the pool
    vec2 g = d * 3.0;
    float lead = smoothstep(0.1, 0.0, min(abs(fract(g.x) - 0.5), abs(fract(g.y + g.x * 0.5) - 0.5)));
    col += uWin[i] * pool * (0.75 - lead * 0.5) * uPools[i].w;
  }

  // the choir of light: rings pulse outward from the centre on the beat
  float wave = smoothstep(0.6, 0.0, abs(r - fract(uBar) * uR * 1.1)) * 0.25 * (0.4 + uEnergy);
  col += gold * wave;
  col += vec3(0.6, 0.7, 1.0) * uDrop * 0.2 * step(0.5, fract(ang * 3.0 + uTime * 2.0));

  float pd = length(w - uPlayer);
  col += vec3(1.0, 0.85, 0.65) * 0.14 * smoothstep(7.0, 0.0, pd);
  col += ripples(w);

  // beyond the nave: stone steps into darkness
  float inside = smoothstep(uR + 0.2, uR - 0.2, r);
  vec3 stone = vec3(0.05, 0.05, 0.07) * (0.6 + fbm(w * 0.4) * 0.6) * smoothstep(uR + 14.0, uR, r);
  float step1 = smoothstep(0.1, 0.0, abs(r - uR - 1.5)) + smoothstep(0.1, 0.0, abs(r - uR - 3.5));
  stone += gold * step1 * 0.08;
  col = mix(stone, col, inside);
  col += gold * smoothstep(0.35, 0.0, abs(r - uR)) * (0.5 + beat * 0.8);
  gl_FragColor = vec4(col, 1.0);
}`;

function stainedGlass(hue: number, seed: number): THREE.CanvasTexture {
  return canvasTexture(256, 640, (g, w, h) => {
    g.fillStyle = '#050308';
    g.fillRect(0, 0, w, h);
    // pointed arch clip
    g.save();
    g.beginPath();
    g.moveTo(10, h);
    g.lineTo(10, h * 0.32);
    g.quadraticCurveTo(10, 10, w / 2, 6);
    g.quadraticCurveTo(w - 10, 10, w - 10, h * 0.32);
    g.lineTo(w - 10, h);
    g.closePath();
    g.clip();
    let s = seed;
    const rnd = (): number => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 140; i++) {
      const x = rnd() * w;
      const y = rnd() * h;
      const hh = (hue + (rnd() - 0.5) * 80 + 360) % 360;
      g.fillStyle = `hsl(${hh}, ${60 + rnd() * 35}%, ${35 + rnd() * 35}%)`;
      g.beginPath();
      const n = 3 + Math.floor(rnd() * 3);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + rnd();
        const r = 18 + rnd() * 34;
        g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      }
      g.closePath();
      g.fill();
    }
    // rose at the top
    g.strokeStyle = '#0a0608';
    g.lineWidth = 7;
    for (let i = 0; i < 90; i++) {
      g.beginPath();
      g.moveTo(rnd() * w, rnd() * h);
      g.lineTo(rnd() * w, rnd() * h);
      g.stroke();
    }
    g.lineWidth = 10;
    g.beginPath();
    g.arc(w / 2, h * 0.22, 60, 0, Math.PI * 2);
    g.stroke();
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      g.beginPath();
      g.moveTo(w / 2, h * 0.22);
      g.lineTo(w / 2 + Math.cos(a) * 60, h * 0.22 + Math.sin(a) * 60);
      g.stroke();
    }
    g.restore();
    g.strokeStyle = '#2a2230';
    g.lineWidth = 12;
    g.beginPath();
    g.moveTo(10, h);
    g.lineTo(10, h * 0.32);
    g.quadraticCurveTo(10, 10, w / 2, 6);
    g.quadraticCurveTo(w - 10, 10, w - 10, h * 0.32);
    g.lineTo(w - 10, h);
    g.stroke();
  });
}

export class Cathedral implements Venue {
  readonly id = 'cathedral' as const;
  readonly name = 'THE CATHEDRAL';
  readonly tagline = 'They said no amplification. You brought eight hundred watts.';
  readonly bpm = 124;
  readonly progression = 'cathedral' as const;
  readonly bounds: Bounds = { kind: 'circle', r: R };
  readonly palette: VenuePalette = {
    rim: new THREE.Color(0x4a5a9a),
    floor: new THREE.Color(0xffc870),
    accents: [0x6f8bff, 0xffc53d, 0xff5ec8, 0x3dffc5],
    fog: 0x0a0a1a,
    fogDensity: 0.009,
    background: 0x04040c,
    core: 0xfff0d0,
  };
  readonly group = new THREE.Group();
  readonly obstacles = [
    { x: -12, z: -10, r: 1.5 },
    { x: 12, z: -10, r: 1.5 },
    { x: -12, z: 10, r: 1.5 },
    { x: 12, z: 10, r: 1.5 },
  ];
  private readonly floorMat: THREE.ShaderMaterial;
  private readonly rip = new RippleBank();
  private readonly pools = Array.from({ length: 6 }, () => new THREE.Vector4());
  private readonly winCols: THREE.Color[];
  private readonly rays: THREE.ShaderMaterial[] = [];
  private readonly candles: THREE.InstancedMesh;
  private readonly flames: THREE.InstancedMesh;
  private readonly pipes: THREE.Mesh[] = [];
  private readonly windowMats: THREE.MeshBasicMaterial[] = [];
  private readonly m4 = new THREE.Matrix4();
  private readonly candlePos: THREE.Vector3[] = [];
  private readonly flameMats: THREE.ShaderMaterial[] = [];

  constructor() {
    this.winCols = [0x4d6bff, 0xff3d6e, 0xffc53d, 0x3dffc5, 0xb04dff, 0xff8a3d].map((c) => new THREE.Color(c));
    this.floorMat = new THREE.ShaderMaterial({
      vertexShader: FLOOR_VERT,
      fragmentShader: FLOOR_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uBeat: { value: 0 },
        uBar: { value: 0 },
        uEnergy: { value: 0 },
        uDrop: { value: 0 },
        uPlayer: { value: new THREE.Vector2() },
        uR: { value: R },
        uWin: { value: this.winCols },
        uPools: { value: this.pools },
        ...this.rip.uniforms(),
      },
    });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(R + 30, 96), this.floorMat);
    floor.rotation.x = -Math.PI / 2;
    this.group.add(floor);

    // ring of columns with stained glass between them
    const colGeo = new THREE.CylinderGeometry(1.1, 1.3, 26, 20);
    const capGeo = new THREE.BoxGeometry(3.2, 1, 3.2);
    const stone = new THREE.MeshStandardMaterial({ color: 0x423e4e, roughness: 0.75 });
    const n = 14;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.PI / n;
      const cx = Math.cos(a) * (R + 5);
      const cz = Math.sin(a) * (R + 5);
      const c = new THREE.Mesh(colGeo, stone);
      c.position.set(cx, 13, cz);
      this.group.add(c);
      const base = new THREE.Mesh(capGeo, stone);
      base.position.set(cx, 0.5, cz);
      this.group.add(base);
      // windows (only the far half shows well; skip the camera side)
      const wa = (i / n) * Math.PI * 2;
      if (Math.sin(wa) < 0.3) {
        const mat = new THREE.MeshBasicMaterial({ map: stainedGlass((i * 53) % 360, 1000 + i * 77), toneMapped: false });
        mat.color.setScalar(1.4);
        this.windowMats.push(mat);
        const win = new THREE.Mesh(new THREE.PlaneGeometry(6, 15), mat);
        win.position.set(Math.cos(wa) * (R + 6.5), 11, Math.sin(wa) * (R + 6.5));
        win.lookAt(0, 11, 0);
        this.group.add(win);
      }
    }

    // the organ: golden pipes rising behind the altar (north)
    const pipeMatA = M.gold();
    const pipeMatB = M.chrome();
    for (let i = 0; i < 29; i++) {
      const x = (i - 14) * 1.05;
      const hgt = 8 + Math.cos((i - 14) * 0.22) * 9 + (i % 2) * 1.5;
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, hgt, 16), i % 3 === 0 ? pipeMatB : pipeMatA);
      p.position.set(x, 3 + hgt / 2, -R - 9 + Math.abs(i - 14) * 0.15);
      this.group.add(p);
      this.pipes.push(p);
      const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.1), M.glow(0xffc53d, 2.5));
      mouth.position.set(x, 4, p.position.z + 0.42);
      this.group.add(mouth);
    }
    const organBase = new THREE.Mesh(new THREE.BoxGeometry(34, 3, 5), M.darkWood());
    organBase.position.set(0, 1.5, -R - 9);
    this.group.add(organBase);
    const altar = new THREE.Mesh(new THREE.BoxGeometry(8, 1.2, 3), new THREE.MeshStandardMaterial({ color: 0xe8e0d0, roughness: 0.4 }));
    altar.position.set(0, 0.6, -R - 3.5);
    this.group.add(altar);

    // god rays from high windows
    const beamGeo = beamGeometry(0.28);
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i - 2) * 0.45;
      // front faces only: from inside the shaft it vanishes instead of tinting the whole frame
      const mat = makeBeamMaterial(this.winCols[i]!.getHex(), 0.18, THREE.FrontSide);
      const pivot = new THREE.Object3D();
      pivot.position.set(Math.cos(a) * (R + 4), 24, Math.sin(a) * (R + 4));
      const cone = new THREE.Mesh(beamGeo, mat);
      cone.scale.set(5, 36, 5);
      pivot.add(cone);
      pivot.lookAt(Math.cos(a) * 14, -30, Math.sin(a) * 14);
      pivot.rotateX(-Math.PI / 2);
      this.group.add(pivot);
      this.rays.push(mat);
    }

    // candles around the nave
    const nC = 64;
    this.candles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.12, 0.14, 1, 8), M.ivory(), nC);
    this.flames = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 8, 6), M.glow(0xffb040, 5), nC);
    for (let i = 0; i < nC; i++) {
      const a = (i / nC) * Math.PI * 2;
      const rr = R + 1.2 + (i % 3) * 0.5;
      const hgt = 0.6 + ((i * 37) % 7) * 0.12;
      this.m4.makeScale(1, hgt, 1);
      this.m4.setPosition(Math.cos(a) * rr, hgt / 2, Math.sin(a) * rr);
      this.candles.setMatrixAt(i, this.m4);
      this.candlePos.push(new THREE.Vector3(Math.cos(a) * rr, hgt + 0.15, Math.sin(a) * rr));
    }
    this.group.add(this.candles, this.flames);

    // braziers (obstacles): carved plinths with golden fire bowls
    const plinthMat = new THREE.MeshStandardMaterial({ color: 0x3a3646, roughness: 0.55, metalness: 0.1 });
    const bowlGeo = new THREE.LatheGeometry(
      [
        new THREE.Vector2(0.2, 0),
        new THREE.Vector2(0.9, 0.15),
        new THREE.Vector2(1.45, 0.6),
        new THREE.Vector2(1.55, 0.75),
        new THREE.Vector2(1.4, 0.72),
        new THREE.Vector2(0.6, 0.35),
      ],
      32,
    );
    for (const o of this.obstacles) {
      const plinth = new THREE.Mesh(new THREE.CylinderGeometry(o.r * 0.8, o.r * 1.05, 2.6, 8), plinthMat);
      plinth.position.set(o.x, 1.3, o.z);
      this.group.add(plinth);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(o.r * 1.2, o.r * 1.25, 0.4, 8), plinthMat);
      base.position.set(o.x, 0.2, o.z);
      this.group.add(base);
      const bowl = new THREE.Mesh(bowlGeo, M.gold());
      bowl.position.set(o.x, 2.6, o.z);
      this.group.add(bowl);
      const flameMat = makeFlameMaterial(0xff5a1a);
      this.flameMats.push(flameMat);
      for (let k = 0; k < 2; k++) {
        const f = new THREE.Mesh(new THREE.ConeGeometry(1.1 - k * 0.35, 3.2 - k * 0.8, 20, 1, true), flameMat);
        f.position.set(o.x, 3.2 + 1.6 - k * 0.4 - 0.2, o.z);
        f.rotation.y = k * 1.3;
        this.group.add(f);
      }
      const fl = new THREE.PointLight(0xff9a40, 24, 12, 1.6);
      fl.position.set(o.x, 4, o.z);
      this.group.add(fl);
    }

    const hemi = new THREE.HemisphereLight(0xaab8ff, 0x201018, 1.0);
    this.group.add(hemi);
    const key = new THREE.DirectionalLight(0xfff0d8, 1.4);
    key.position.set(-8, 20, 6);
    this.group.add(key);
    const organLight = new THREE.PointLight(0xffc870, 80, 40, 1.5);
    organLight.position.set(0, 10, -R - 4);
    this.group.add(organLight);
  }

  ripple(x: number, z: number, color: THREE.Color | number, strength = 1): void {
    this.rip.add(x, z, this.floorMat.uniforms.uTime!.value as number, color, strength);
  }

  onStep(): void {
    /* organ breathes in update */
  }

  setBar(b: number): void {
    this.floorMat.uniforms.uBar!.value = b;
  }

  update(f: FrameInfo): void {
    const u = this.floorMat.uniforms;
    u.uTime!.value = f.time;
    u.uBeat!.value = f.beatPhase;
    u.uEnergy!.value = f.energy;
    u.uDrop!.value = f.drop ? 1 : 0;
    (u.uPlayer!.value as THREE.Vector2).set(f.playerX, f.playerZ);
    const beat = Math.pow(1 - f.beatPhase, 3);
    for (let i = 0; i < 6; i++) {
      const a = f.time * 0.05 + i * 1.05;
      this.pools[i]!.set(Math.cos(a) * (8 + i * 3), Math.sin(a * 1.3) * (6 + i * 2), 6 + (i % 3), 0.35 + f.energy * 0.3 + beat * 0.15);
    }
    this.rays.forEach((m, i) => {
      m.uniforms.uTime!.value = f.time;
      m.uniforms.uOpacity!.value = 0.09 + Math.sin(f.time * 0.4 + i) * 0.03 + f.energy * 0.05 + (f.drop ? 0.1 : 0);
    });
    this.windowMats.forEach((m, i) => m.color.setScalar(1.1 + beat * 0.5 + Math.sin(f.time + i) * 0.1 + (f.drop ? 0.6 : 0)));
    this.pipes.forEach((p, i) => {
      const band = f.spectrum[Math.min(15, Math.floor((i / this.pipes.length) * 12))] ?? 0;
      p.scale.set(1 + band * 0.12, 1, 1 + band * 0.12);
    });
    for (let i = 0; i < this.candlePos.length; i++) {
      const c = this.candlePos[i]!;
      const fl = 0.8 + Math.sin(f.time * 13 + i * 3.1) * 0.15 + Math.random() * 0.1;
      this.m4.makeScale(fl, fl * 1.6, fl);
      this.m4.setPosition(c.x, c.y, c.z);
      this.flames.setMatrixAt(i, this.m4);
    }
    this.flames.instanceMatrix.needsUpdate = true;
    for (const m of this.flameMats) {
      m.uniforms.uTime!.value = f.time;
      m.uniforms.uPower!.value = 0.85 + beat * 0.35 + (f.drop ? 0.4 : 0);
    }
  }

  spawnPoint(rng: Rng, px: number, pz: number, out: { x: number; z: number }): void {
    for (let tries = 0; tries < 12; tries++) {
      const a = rng.range(0, Math.PI * 2);
      out.x = Math.cos(a) * (R - 1);
      out.z = Math.sin(a) * (R - 1);
      if (Math.hypot(out.x - px, out.z - pz) > 16) return;
    }
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
  }
}
