import * as THREE from 'three';
import type { Rng } from '../../core/rng';
import { M } from '../materials';
import { buildSpeakerStack } from '../instrumentModels';
import {
  beamGeometry,
  GLSL_COMMON,
  makeBeamMaterial,
  RippleBank,
  type Bounds,
  type FrameInfo,
  type Venue,
  type VenuePalette,
} from './venue';

const HX = 30;
const HZ = 22;

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
uniform float uBuild;
uniform vec2 uPlayer;
uniform vec2 uHalf;
uniform vec3 uCols[4];
uniform vec4 uSpots[8];
uniform vec3 uSpotCols[8];
varying vec3 vWorld;

void main() {
  vec2 w = vWorld.xz;
  float beat = pow(1.0 - uBeat, 2.2);
  float inside = step(abs(w.x), uHalf.x) * step(abs(w.y), uHalf.y);

  // black gloss deck with plank seams and gaffer tape
  vec3 col = vec3(0.022, 0.022, 0.03) + vec3(0.012) * fbm(w * vec2(0.3, 2.0));
  float plank = smoothstep(0.02, 0.0, abs(fract(w.y / 1.2) - 0.5) - 0.48);
  col *= 1.0 - plank * 0.4;

  // LED strip grid: chases along lines, flashes on the beat
  vec2 g = abs(fract(w / 6.0) - 0.5) * 6.0;
  float line = smoothstep(0.12, 0.0, min(g.x, g.y));
  float chase = 0.5 + 0.5 * sin((w.x + w.y) * 0.25 - uTime * 6.0);
  int ci = int(mod(floor(uBar) + floor((w.x + 40.0) / 12.0), 4.0));
  vec3 lc = uCols[0];
  if (ci == 1) lc = uCols[1]; else if (ci == 2) lc = uCols[2]; else if (ci == 3) lc = uCols[3];
  col += lc * line * (0.25 + chase * 0.45 + beat * 0.8) * (0.4 + uEnergy * 0.8);

  // moving-head light pools
  for (int i = 0; i < 8; i++) {
    float d = length(w - uSpots[i].xy);
    // real follow-spot pools: hard rim, soft interior
    float pool = smoothstep(uSpots[i].z, uSpots[i].z * 0.9, d);
    float rimEdge = smoothstep(uSpots[i].z * 0.8, uSpots[i].z * 0.97, d) * pool;
    col += uSpotCols[i] * (pool * 0.55 + rimEdge * 0.9) * uSpots[i].w;
  }
  // drop: the whole deck strobes in stripes
  col += lc * uDrop * step(0.5, fract(w.x * 0.08 + uTime * 3.0)) * 0.25;

  float pd = length(w - uPlayer);
  col += vec3(1.0, 0.8, 0.6) * 0.14 * smoothstep(7.0, 0.0, pd);
  col += ripples(w);

  // stage edge: glowing lip then the pit
  float edgeD = min(uHalf.x - abs(w.x), uHalf.y - abs(w.y));
  float lip = smoothstep(0.5, 0.0, abs(edgeD)) * (0.8 + beat);
  vec3 pit = vec3(0.01, 0.008, 0.015);
  col = mix(pit, col, inside);
  col += uCols[1] * lip * 0.8;
  col *= 1.0 - uBuild * 0.7;
  gl_FragColor = vec4(col, 1.0);
}`;

const LED_FRAG = /* glsl */ `
uniform float uTime;
uniform float uBeat;
uniform float uBands[16];
uniform float uDrop;
uniform vec3 uA;
uniform vec3 uB;
varying vec2 vUv;
void main() {
  vec2 uv = vUv;
  vec2 cell = floor(uv * vec2(160.0, 48.0));
  vec2 f = fract(uv * vec2(160.0, 48.0)) - 0.5;
  float px = smoothstep(0.5, 0.3, max(abs(f.x), abs(f.y)));
  vec2 c = (cell + 0.5) / vec2(160.0, 48.0);
  float beat = pow(1.0 - uBeat, 3.0);
  // mirrored spectrum bars
  float x = abs(c.x - 0.5) * 2.0;
  int bi = int(clamp(x * 15.99, 0.0, 15.0));
  float band = 0.0;
  for (int i = 0; i < 16; i++) if (i == bi) band = uBands[i];
  float bar = step(abs(c.y - 0.5) * 2.0, band * 1.2 + 0.03);
  // kaleidoscope rings behind
  vec2 q = (c - 0.5) * vec2(3.3, 1.0);
  float r = length(q);
  float a = atan(q.y, q.x + 1e-4);
  float k = 0.5 + 0.5 * sin(r * 18.0 - uTime * 4.0 + sin(a * 6.0 + uTime) * 1.5);
  vec3 col = mix(uA, uB, c.x) * bar * 1.6;
  col += mix(uB, uA, k) * k * 0.25 * (0.5 + beat);
  col += vec3(1.0) * uDrop * step(0.5, fract(uTime * 8.0)) * 0.35;
  col *= px;
  gl_FragColor = vec4(col, 1.0);
}`;

export class Mainstage implements Venue {
  readonly id = 'mainstage' as const;
  readonly name = 'THE MAINSTAGE';
  readonly tagline = 'Eighty thousand people. One microphone. Zero silence.';
  readonly bpm = 136;
  readonly progression = 'mainstage' as const;
  readonly bounds: Bounds = { kind: 'rect', hx: HX, hz: HZ };
  readonly palette: VenuePalette = {
    rim: new THREE.Color(0x8a3ac0),
    floor: new THREE.Color(0x4dc3ff),
    accents: [0xff2dd4, 0x2ee6ff, 0xffe14d, 0x8c5aff],
    fog: 0x06030c,
    fogDensity: 0.007,
    background: 0x030208,
    core: 0xffffff,
  };
  readonly group = new THREE.Group();
  readonly obstacles: { x: number; z: number; r: number }[] = [
    { x: -16, z: -2, r: 1.5 },
    { x: 16, z: -2, r: 1.5 },
  ];
  private readonly floorMat: THREE.ShaderMaterial;
  private readonly ledMat: THREE.ShaderMaterial;
  private readonly rip = new RippleBank();
  private readonly spots = Array.from({ length: 8 }, () => new THREE.Vector4());
  private readonly spotCols = Array.from({ length: 8 }, () => new THREE.Color());
  private readonly heads: { pivot: THREE.Object3D; mat: THREE.ShaderMaterial; phase: number }[] = [];
  private readonly lasers: { pivot: THREE.Object3D; mat: THREE.ShaderMaterial; phase: number }[] = [];
  private readonly crowd: THREE.InstancedMesh;
  private readonly phones: THREE.InstancedMesh;
  private readonly crowdSeeds: { x: number; z: number; s: number; y: number }[] = [];
  private readonly m4 = new THREE.Matrix4();
  private readonly tmp = new THREE.Vector3();
  private readonly bands: number[] = new Array(16).fill(0);
  private pyroT = 0;
  private barrierMat!: THREE.MeshBasicMaterial;
  private readonly pyro: THREE.Mesh[] = [];

  constructor() {
    const acc = this.palette.accents.map((c) => new THREE.Color(c));
    this.floorMat = new THREE.ShaderMaterial({
      vertexShader: FLOOR_VERT,
      fragmentShader: FLOOR_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uBeat: { value: 0 },
        uBar: { value: 0 },
        uEnergy: { value: 0 },
        uDrop: { value: 0 },
        uBuild: { value: 0 },
        uPlayer: { value: new THREE.Vector2() },
        uHalf: { value: new THREE.Vector2(HX, HZ) },
        uCols: { value: acc },
        uSpots: { value: this.spots },
        uSpotCols: { value: this.spotCols },
        ...this.rip.uniforms(),
      },
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(HX * 2 + 60, HZ * 2 + 60), this.floorMat);
    floor.rotation.x = -Math.PI / 2;
    this.group.add(floor);
    // raised deck edge
    const deckEdge = new THREE.Mesh(new THREE.BoxGeometry(HX * 2 + 1, 1.4, HZ * 2 + 1), M.blackPlastic());
    deckEdge.position.y = -0.72;
    this.group.add(deckEdge);

    // LED wall
    this.ledMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uBeat: { value: 0 },
        uBands: { value: this.bands },
        uDrop: { value: 0 },
        uA: { value: new THREE.Color(0xff2dd4) },
        uB: { value: new THREE.Color(0x2ee6ff) },
      },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: LED_FRAG,
      toneMapped: false,
    });
    const led = new THREE.Mesh(new THREE.PlaneGeometry(80, 24), this.ledMat);
    led.position.set(0, 13, -HZ - 10);
    this.group.add(led);
    const ledFrame = new THREE.Mesh(new THREE.BoxGeometry(82, 26, 1), M.blackPlastic());
    ledFrame.position.set(0, 13, -HZ - 10.6);
    this.group.add(ledFrame);

    // trusses
    const trussMat = M.darkChrome();
    const trussBar = (len: number): THREE.Group => {
      const g = new THREE.Group();
      for (const [y, z] of [
        [0.4, 0.4],
        [0.4, -0.4],
        [-0.4, 0.4],
        [-0.4, -0.4],
      ] as const) {
        const b = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, len, 6), trussMat);
        b.rotation.z = Math.PI / 2;
        b.position.set(0, y, z);
        g.add(b);
      }
      for (let i = 0; i < len / 1.2; i++) {
        const d = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.2, 4), trussMat);
        d.position.set(-len / 2 + i * 1.2, 0, 0.4 * (i % 2 ? 1 : -1));
        d.rotation.z = Math.PI / 4;
        g.add(d);
      }
      return g;
    };
    for (const z of [-HZ - 3, -4]) {
      const t = trussBar(HX * 2 + 10);
      t.position.set(0, 20, z);
      this.group.add(t);
    }
    for (const x of [-HX - 5, HX + 5]) {
      const pole = new THREE.Mesh(new THREE.BoxGeometry(1, 22, 1), trussMat);
      pole.position.set(x, 10, -HZ - 3);
      this.group.add(pole);
      // line array speakers
      for (let k = 0; k < 8; k++) {
        const box = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.9, 1.8), M.blackPlastic());
        box.position.set(x * 0.94, 17 - k * 0.92, -HZ + 2);
        box.rotation.x = 0.05 * k;
        this.group.add(box);
        const grille = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.7), M.rubber());
        grille.position.set(x * 0.94, 17 - k * 0.92, -HZ + 2.92);
        grille.rotation.x = 0.05 * k;
        this.group.add(grille);
      }
    }

    // moving heads on the trusses
    const beamGeo = beamGeometry(0.16);
    for (let i = 0; i < 8; i++) {
      const pivot = new THREE.Object3D();
      pivot.position.set(-HX + 4 + i * ((HX * 2 - 8) / 7), 19.2, i % 2 ? -4 : -HZ - 3);
      const mat = makeBeamMaterial(this.palette.accents[i % 4]!, 0.25);
      const cone = new THREE.Mesh(beamGeo, mat);
      cone.scale.set(1, 30, 1);
      pivot.add(cone);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.9, 0.8), M.blackPlastic());
      pivot.add(lamp);
      this.group.add(pivot);
      this.heads.push({ pivot, mat, phase: i * 0.9 });
    }
    // lasers fan out from the top of the LED wall
    const laserGeo = new THREE.CylinderGeometry(0.02, 0.06, 1, 6, 1, true);
    laserGeo.translate(0, -0.5, 0);
    for (let i = 0; i < 12; i++) {
      const pivot = new THREE.Object3D();
      pivot.position.set((i - 5.5) * 3, 25, -HZ - 9);
      const mat = makeBeamMaterial(i % 2 ? 0x2ee6ff : 0xff2dd4, 0.9);
      const beam = new THREE.Mesh(laserGeo, mat);
      beam.scale.set(1, 80, 1);
      pivot.add(beam);
      this.group.add(pivot);
      this.lasers.push({ pivot, mat, phase: i * 0.5 });
    }

    // pyro cannons along the stage front
    for (let i = 0; i < 6; i++) {
      const x = -HX + 6 + i * ((HX * 2 - 12) / 5);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 0.8, 12), M.darkChrome());
      base.position.set(x, 0.4, HZ + 1.2);
      this.group.add(base);
      const flame = new THREE.Mesh(
        new THREE.ConeGeometry(0.9, 7, 16, 1, true),
        new THREE.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      flame.position.set(x, 4.2, HZ + 1.2);
      flame.rotation.x = Math.PI;
      this.group.add(flame);
      this.pyro.push(flame);
    }

    // the crowd: east, west and south of the stage
    const person = (() => {
      const body = new THREE.CapsuleGeometry(0.32, 0.9, 3, 6);
      body.translate(0, 0.8, 0);
      const head = new THREE.SphereGeometry(0.26, 8, 6);
      head.translate(0, 1.75, 0);
      const arm = new THREE.CapsuleGeometry(0.09, 0.8, 2, 4);
      arm.rotateZ(0.35);
      arm.translate(0.32, 2.05, 0);
      const parts = [body, head, arm].map((g) => {
        const ng = g.toNonIndexed();
        for (const k of Object.keys(ng.attributes)) if (k !== 'position' && k !== 'normal') ng.deleteAttribute(k);
        return ng;
      });
      let count = 0;
      for (const p of parts) count += p.getAttribute('position').count;
      const pos = new Float32Array(count * 3);
      const nor = new Float32Array(count * 3);
      let o = 0;
      for (const p of parts) {
        pos.set(p.getAttribute('position').array as Float32Array, o * 3);
        nor.set(p.getAttribute('normal').array as Float32Array, o * 3);
        o += p.getAttribute('position').count;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      return g;
    })();
    const crowdMat = new THREE.MeshStandardMaterial({ color: 0x2a2236, roughness: 0.6, emissive: 0x0c0612 });
    const places: { x: number; z: number }[] = [];
    for (let z = -HZ; z < HZ + 22; z += 1.05) {
      for (let x = HX + 2.2; x < HX + 24; x += 1.05) {
        places.push({ x, z }, { x: -x, z });
      }
    }
    for (let z = HZ + 2.2; z < HZ + 22; z += 1.05) for (let x = -HX - 2.2; x < HX + 2.2; x += 1.05) places.push({ x, z });
    this.crowd = new THREE.InstancedMesh(person, crowdMat, places.length);
    this.phones = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.2, 0.04), M.glow(0xeaf4ff, 3), Math.ceil(places.length / 7));
    let ph = 0;
    places.forEach((p, i) => {
      const jx = p.x + (Math.random() - 0.5) * 0.5;
      const jz = p.z + (Math.random() - 0.5) * 0.5;
      this.crowdSeeds.push({ x: jx, z: jz, s: Math.random(), y: -0.55 - Math.random() * 0.25 });
      if (i % 7 === 0 && ph < this.phones.count) {
        this.m4.makeTranslation(jx + 0.35, 2.4, jz);
        this.phones.setMatrixAt(ph++, this.m4);
      }
    });
    this.crowd.frustumCulled = false;
    this.phones.frustumCulled = false;
    this.group.add(this.crowd, this.phones);

    // obstacles: touring PA stacks on the deck
    for (const o of this.obstacles) {
      const stack = buildSpeakerStack(3, o.x < 0 ? 0xff2dd4 : 0x2ee6ff);
      stack.position.set(o.x, 0, o.z);
      stack.scale.setScalar(0.95);
      this.group.add(stack);
    }
    // crowd barrier: a glowing strip that backlights the front rows
    const barrierMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2dd4).multiplyScalar(1.6), toneMapped: false });
    this.barrierMat = barrierMat;
    for (const [x, z, w, d] of [
      [HX + 1.2, 0, 0.12, HZ * 2 + 4],
      [-HX - 1.2, 0, 0.12, HZ * 2 + 4],
      [0, HZ + 1.2, HX * 2 + 2.4, 0.12],
    ] as const) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, d), barrierMat);
      bar.position.set(x, 0.35, z);
      this.group.add(bar);
      const rail = new THREE.Mesh(new THREE.BoxGeometry(Math.max(w, 0.2), 1.1, Math.max(d, 0.2)), M.darkChrome());
      rail.position.set(x + Math.sign(x) * 0.3, -0.2, z + Math.sign(z) * 0.3);
      this.group.add(rail);
    }
    const crowdWash = new THREE.PointLight(0xff4df0, 120, 40, 1.4);
    crowdWash.position.set(HX + 8, 6, 0);
    const crowdWash2 = new THREE.PointLight(0x2ee6ff, 120, 40, 1.4);
    crowdWash2.position.set(-HX - 8, 6, 0);
    const crowdWash3 = new THREE.PointLight(0xffe14d, 90, 40, 1.4);
    crowdWash3.position.set(0, 6, HZ + 8);
    this.group.add(crowdWash, crowdWash2, crowdWash3);

    const hemi = new THREE.HemisphereLight(0xb08cff, 0x100418, 1.1);
    this.group.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(4, 20, 10);
    this.group.add(key);
  }

  ripple(x: number, z: number, color: THREE.Color | number, strength = 1): void {
    this.rip.add(x, z, this.floorMat.uniforms.uTime!.value as number, color, strength);
  }

  onStep(step: number, bar: number): void {
    if (step === 0 && bar % 8 === 0) this.pyroT = 0.6;
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
    u.uBuild!.value = f.build;
    (u.uPlayer!.value as THREE.Vector2).set(f.playerX, f.playerZ);
    this.ledMat.uniforms.uTime!.value = f.time;
    this.ledMat.uniforms.uBeat!.value = f.beatPhase;
    this.ledMat.uniforms.uDrop!.value = f.drop ? 1 : 0;
    for (let i = 0; i < 16; i++) this.bands[i] = (this.bands[i]! * 0.6 + (f.spectrum[i] ?? 0) * 0.4);
    const beat = Math.pow(1 - f.beatPhase, 3);

    this.heads.forEach((hd, i) => {
      const sp = f.drop ? 2.2 : 0.8;
      const t = f.time * sp + hd.phase;
      hd.pivot.rotation.set(Math.sin(t) * 0.6, 0, Math.cos(t * 0.7) * 0.55);
      hd.mat.uniforms.uTime!.value = f.time;
      hd.mat.uniforms.uOpacity!.value = 0.1 + f.energy * 0.15 + beat * 0.08 + (f.drop ? 0.15 : 0);
      this.tmp.set(0, -1, 0).applyEuler(hd.pivot.rotation);
      const k = hd.pivot.position.y / Math.max(0.2, -this.tmp.y);
      this.spots[i]!.set(hd.pivot.position.x + this.tmp.x * k, hd.pivot.position.z + this.tmp.z * k, 3.5, 0.08 + f.energy * 0.1);
      this.spotCols[i]!.copy(hd.mat.uniforms.uColor!.value as THREE.Color);
    });
    this.lasers.forEach((l) => {
      const t = f.time * (f.drop ? 1.8 : 0.5) + l.phase;
      l.pivot.rotation.set(0.9 + Math.sin(t) * 0.35, 0, Math.sin(t * 1.3) * 0.7);
      l.mat.uniforms.uTime!.value = f.time;
      l.mat.uniforms.uOpacity!.value = (f.energy > 0.5 || f.drop ? 0.8 : 0.25) * (0.6 + beat * 0.4);
    });

    // crowd bounces on the beat; bigger when the fight is intense
    const jump = beat * (0.25 + f.energy * 0.45 + (f.drop ? 0.4 : 0));
    for (let i = 0; i < this.crowdSeeds.length; i++) {
      const c = this.crowdSeeds[i]!;
      const y = c.y + jump * (0.6 + c.s * 0.8) * (Math.sin(i) > -0.3 ? 1 : 0.3);
      this.m4.makeTranslation(c.x, y, c.z);
      this.crowd.setMatrixAt(i, this.m4);
    }
    this.crowd.instanceMatrix.needsUpdate = true;

    this.barrierMat.color.setHex(this.palette.accents[Math.floor(f.time * 0.5) % 4]!).multiplyScalar(1 + beat * 1.5);
    this.pyroT = Math.max(this.pyroT - f.dt, f.drop && beat > 0.9 ? 0.35 : 0);
    const fire = this.pyroT > 0 ? Math.min(1, this.pyroT * 3) : 0;
    for (const p of this.pyro) {
      (p.material as THREE.MeshBasicMaterial).opacity = fire * (0.7 + Math.random() * 0.3);
      p.scale.set(1, 0.4 + fire * (0.8 + Math.random() * 0.4), 1);
    }
  }

  spawnPoint(rng: Rng, px: number, pz: number, out: { x: number; z: number }): void {
    for (let tries = 0; tries < 12; tries++) {
      const side = rng.int(0, 3);
      const t = rng.range(-1, 1);
      if (side === 0) {
        out.x = t * (HX - 1);
        out.z = -HZ + 1;
      } else if (side === 1) {
        out.x = t * (HX - 1);
        out.z = HZ - 1;
      } else if (side === 2) {
        out.x = -HX + 1;
        out.z = t * (HZ - 1);
      } else {
        out.x = HX - 1;
        out.z = t * (HZ - 1);
      }
      if (Math.hypot(out.x - px, out.z - pz) > 18) return;
    }
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
  }
}
