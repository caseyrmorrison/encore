import * as THREE from 'three';
import type { Rng } from '../../core/rng';
import { canvasTexture, M } from '../materials';
import { damp } from '../../core/math';
import { buildInstrument, buildSpeakerStack } from '../instrumentModels';
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
uniform float uStep;
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

  // centre B-stage: a giant turntable. Vinyl grooves, a label that thumps, and a ring of
  // sixteen ticks that walks with the sequencer so the floor keeps time with your band.
  float r = length(w);
  float ang = atan(w.y, w.x + 1e-4);
  float disc = smoothstep(6.3, 6.1, r);
  float grooves = 0.5 + 0.5 * sin(r * 38.0);
  vec3 vinyl = vec3(0.006, 0.006, 0.009) + vec3(0.018) * grooves * smoothstep(1.9, 2.1, r);
  float sheen = pow(max(0.0, sin(ang * 2.0 - uTime * 0.8)), 8.0) * smoothstep(2.0, 5.5, r) * 0.06;
  vinyl += vec3(sheen);
  float label = smoothstep(1.8, 1.7, r);
  vinyl = mix(vinyl, uCols[0] * (0.35 + beat * 0.9), label);
  vinyl += vec3(1.0) * smoothstep(0.16, 0.1, r) * 0.6;
  col = mix(col, vinyl, disc * inside);
  col += uCols[1] * smoothstep(0.14, 0.0, abs(r - 6.2)) * (0.5 + beat * 0.8);
  float sa = fract(-ang / 6.28318 + 0.25);
  float tick = floor(sa * 16.0);
  float tf = fract(sa * 16.0);
  float tickShape = smoothstep(0.32, 0.22, abs(tf - 0.5)) * smoothstep(0.35, 0.0, abs(r - 7.0) - 0.4);
  float current = 1.0 - step(0.5, abs(tick - uStep));
  float quarter = 1.0 - step(0.5, mod(tick, 4.0));
  col += mix(vec3(0.05), uCols[2], quarter * 0.6) * tickShape * (0.35 + quarter * 0.4);
  col += vec3(1.0, 0.95, 0.85) * tickShape * current * 2.2;

  // spike tape: little gaffer X marks where the crew blocked the show
  vec2 sp = mod(w + vec2(3.0, 5.0), vec2(17.0, 13.0)) - vec2(8.5, 6.5);
  float xm = min(abs(sp.x - sp.y), abs(sp.x + sp.y));
  float tape = smoothstep(0.1, 0.05, xm) * step(max(abs(sp.x), abs(sp.y)), 0.45) * step(8.0, r);
  col = mix(col, vec3(0.5, 0.42, 0.12), tape * 0.8);

  // moving-head light pools
  for (int i = 0; i < 8; i++) {
    float d = length(w - uSpots[i].xy);
    // gobo'd stage light: soft edge with a rotating star pattern (reads as lighting, not a hazard)
    vec2 dv = w - uSpots[i].xy;
    float pool = smoothstep(uSpots[i].z, uSpots[i].z * 0.55, d);
    float ga = atan(dv.y, dv.x + 1e-4) + uTime * (0.6 + float(i) * 0.13);
    float gobo = 0.55 + 0.45 * smoothstep(0.2, 0.7, sin(ga * 5.0) * 0.5 + 0.5 - d / uSpots[i].z * 0.4);
    col += uSpotCols[i] * pool * gobo * uSpots[i].w * 0.9;
  }
  // drop: thin chevrons race across the deck toward the crowd
  float chev = fract((abs(w.x) * 0.5 + w.y) * 0.09 - uTime * 1.6);
  col += lc * uDrop * smoothstep(0.1, 0.0, abs(chev - 0.5)) * 0.35;

  float pd = length(w - uPlayer);
  col += vec3(1.0, 0.8, 0.6) * 0.14 * smoothstep(7.0, 0.0, pd);
  col += ripples(w);
  col = paintOver(col, w);

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
uniform sampler2D uText;
uniform float uTextAmt;
uniform vec3 uTextCol;
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
  // pixel lettering, sampled at the LED cell centre so it stays chunky
  float tx = texture2D(uText, c).r * uTextAmt;
  col = mix(col * (1.0 - uTextAmt * 0.75), uTextCol * (0.95 + beat * 0.7), tx);
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
    // road cases left on the deck by the crew
    { x: -9, z: -13, r: 1.7 },
    { x: 10, z: 12, r: 1.7 },
    { x: -23, z: 12, r: 1.7 },
    { x: 23, z: -13, r: 1.7 },
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
  private finaleOn = false;
  private dropOn = false;
  private readonly aims = Array.from({ length: 8 }, () => ({ x: 0, z: 0, tx: 0, tz: 0 }));
  private readonly texts = new Map<string, THREE.CanvasTexture>();
  private barrierMat!: THREE.MeshBasicMaterial;
  private readonly pyro: THREE.Mesh[] = [];
  private readonly pyroMat = makeFlameMaterial(0xff7a1a);
  private readonly pyroGeo = (() => {
    const g = new THREE.PlaneGeometry(2.6, 9, 1, 8);
    g.translate(0, 4.5, 0);
    return g;
  })();

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
        uStep: { value: 0 },
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
        uText: { value: null },
        uTextAmt: { value: 0 },
        uTextCol: { value: new THREE.Color(0xffffff) },
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
      // a billboarded flame sheet (a cone reads as a traffic cone from the high camera)
      const flame = new THREE.Mesh(this.pyroGeo, this.pyroMat);
      flame.position.set(x, 0.8, HZ + 1.2);
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
        const ng = g.index ? g.toNonIndexed() : g;
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

    // upstage drum riser with the house kit, monitor wedges along the lip
    const riser = new THREE.Mesh(new THREE.BoxGeometry(12, 1.4, 5), new THREE.MeshStandardMaterial({ color: 0x131118, roughness: 0.4, metalness: 0.3 }));
    riser.position.set(0, 0.7, -HZ - 3);
    this.group.add(riser);
    const riserLip = new THREE.Mesh(new THREE.BoxGeometry(12, 0.08, 0.08), M.glow(0x2ee6ff, 3));
    riserLip.position.set(0, 1.42, -HZ - 0.5);
    this.group.add(riserLip);
    const kit: [Parameters<typeof buildInstrument>[0], number, number, number, number][] = [
      ['kick', 0, 2.4, -HZ - 3.6, 1.3],
      ['snare', -2.2, 2.5, -HZ - 2.6, 0.9],
      ['hat', -3.8, 3.3, -HZ - 3.2, 0.9],
      ['crash', 3.2, 4.4, -HZ - 3.8, 1.1],
      ['tom', 2.1, 3.2, -HZ - 2.8, 0.8],
      ['gong', 5.2, 3.4, -HZ - 4.2, 1.1],
    ];
    for (const [id, x, y, z, sc] of kit) {
      const m = buildInstrument(id);
      m.position.set(x, y, z);
      m.scale.multiplyScalar(sc);
      this.group.add(m);
    }
    const wedgeGeo = new THREE.BoxGeometry(2.2, 0.9, 1.3);
    wedgeGeo.translate(0, 0.45, 0);
    for (let i = 0; i < 5; i++) {
      const wx = -HX + 8 + i * ((HX * 2 - 16) / 4);
      const wedge = new THREE.Mesh(wedgeGeo, M.blackPlastic());
      wedge.position.set(wx, 0, HZ + 1.1);
      wedge.rotation.x = -0.45;
      this.group.add(wedge);
      const grille = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.7), M.rubber());
      grille.position.set(wx, 0.62, HZ + 0.52);
      grille.rotation.x = -0.45 - Math.PI * 0;
      this.group.add(grille);
    }

    // obstacles: touring PA stacks and flight cases on the deck
    const caseLabel = canvasTexture(512, 256, (g, w, h) => {
      g.fillStyle = '#16171d';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#e8e2d0';
      g.font = '64px Bungee, Impact, sans-serif';
      g.textAlign = 'center';
      g.fillText('ENCORE', w / 2, 96);
      g.font = '600 30px "JetBrains Mono", monospace';
      g.fillStyle = '#ff9a2e';
      g.fillText('WORLD TOUR · STAGE L', w / 2, 150);
      g.fillStyle = '#ff3b5c';
      g.font = '40px Bungee, Impact, sans-serif';
      g.fillText('▲ FRAGILE ▲', w / 2, 215);
    });
    this.obstacles.slice(2).forEach((o, i) => {
      const c = roadCase(caseLabel, this.palette.accents[i % 4]!);
      c.position.set(o.x, 0, o.z);
      c.rotation.y = (i % 2 ? 0.35 : -0.25) + i * 0.4;
      this.group.add(c);
    });
    for (const o of this.obstacles.slice(0, 2)) {
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
    this.floorMat.uniforms.uStep!.value = step;
    if (step === 0 && bar % 8 === 0) this.pyroT = 0.6;
    // moving heads snap to a new look on every bar, every beat when the room goes off
    const hot = this.dropOn || this.finaleOn;
    if (step === 0 || (hot && step % 4 === 0)) {
      this.aims.forEach((a, i) => {
        const k = Math.sin((bar * 16 + step) * 12.9898 + i * 78.233) * 43758.5453;
        const r = k - Math.floor(k);
        const r2 = (r * 7.31) % 1;
        a.tx = (r - 0.5) * 1.2;
        a.tz = (r2 - 0.5) * 1.1;
      });
      if (this.finaleOn && step % 4 === 0) this.pyroT = 0.3;
    }
  }

  finale(): void {
    this.finaleOn = true;
  }

  /** Chunky pixel lettering for the LED wall. */
  private text(msg: string): THREE.CanvasTexture {
    let t = this.texts.get(msg);
    if (!t) {
      t = canvasTexture(
        320,
        96,
        (g, w, h) => {
          g.fillStyle = '#000';
          g.fillRect(0, 0, w, h);
          g.fillStyle = '#fff';
          g.font = '58px Bungee, Impact, sans-serif';
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText(msg, w / 2, h / 2 + 4);
        },
        false,
      );
      t.minFilter = THREE.NearestFilter;
      t.magFilter = THREE.NearestFilter;
      t.generateMipmaps = false;
      this.texts.set(msg, t);
    }
    return t;
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

    this.dropOn = f.drop;
    const hot = f.drop || this.finaleOn;
    const lu = this.ledMat.uniforms;
    if (this.finaleOn || f.drop) {
      lu.uText!.value = this.text(this.finaleOn ? 'ENCORE!' : 'DROP!');
      lu.uTextAmt!.value = damp(lu.uTextAmt!.value as number, 1, 8, f.dt);
      (lu.uTextCol!.value as THREE.Color).setHex(this.finaleOn ? 0xffa820 : 0xff2d78);
    } else {
      lu.uTextAmt!.value = damp(lu.uTextAmt!.value as number, 0, 5, f.dt);
    }
    if (this.finaleOn) {
      u.uDrop!.value = 1;
      this.ledMat.uniforms.uDrop!.value = 1;
    }

    this.heads.forEach((hd, i) => {
      const a = this.aims[i]!;
      const snap = hot ? 14 : 6;
      a.x = damp(a.x, a.tx, snap, f.dt);
      a.z = damp(a.z, a.tz, snap, f.dt);
      const sway = f.time * 0.9 + hd.phase;
      hd.pivot.rotation.set(a.x + Math.sin(sway) * 0.05, 0, a.z + Math.cos(sway * 0.8) * 0.05);
      hd.mat.uniforms.uTime!.value = f.time;
      hd.mat.uniforms.uOpacity!.value = 0.1 + f.energy * 0.15 + beat * 0.08 + (hot ? 0.15 : 0);
      this.tmp.set(0, -1, 0).applyEuler(hd.pivot.rotation);
      const k = hd.pivot.position.y / Math.max(0.2, -this.tmp.y);
      this.spots[i]!.set(hd.pivot.position.x + this.tmp.x * k, hd.pivot.position.z + this.tmp.z * k, 3.5, 0.08 + f.energy * 0.1);
      this.spotCols[i]!.copy(hd.mat.uniforms.uColor!.value as THREE.Color);
    });
    this.lasers.forEach((l, i) => {
      const t = f.time * (hot ? 1.8 : 0.5) + l.phase;
      l.pivot.rotation.set(0.9 + Math.sin(t) * 0.35, 0, Math.sin(t * 1.3) * 0.7);
      l.mat.uniforms.uTime!.value = f.time;
      l.mat.uniforms.uOpacity!.value = (f.energy > 0.5 || hot ? 0.8 : 0.25) * (0.6 + beat * 0.4);
      if (this.finaleOn) (l.mat.uniforms.uColor!.value as THREE.Color).setHex(i % 3 === 0 ? 0xffffff : 0xffd36b);
    });

    // crowd bounces on the beat; bigger when the fight is intense
    const jump = beat * (0.25 + f.energy * 0.45 + (hot ? 0.4 : 0) + (this.finaleOn ? 0.5 : 0));
    for (let i = 0; i < this.crowdSeeds.length; i++) {
      const c = this.crowdSeeds[i]!;
      const y = c.y + jump * (0.6 + c.s * 0.8) * (Math.sin(i) > -0.3 ? 1 : 0.3);
      this.m4.makeTranslation(c.x, y, c.z);
      this.crowd.setMatrixAt(i, this.m4);
    }
    this.crowd.instanceMatrix.needsUpdate = true;

    this.barrierMat.color
      .setHex(this.finaleOn ? 0xffd36b : this.palette.accents[Math.floor(f.time * 0.5) % 4]!)
      .multiplyScalar(1 + beat * 1.5);
    this.pyroT = Math.max(this.pyroT - f.dt, f.drop && beat > 0.9 ? 0.35 : 0);
    const fire = this.pyroT > 0 ? Math.min(1, this.pyroT * 3) : 0;
    this.pyroMat.uniforms.uTime!.value = f.time;
    this.pyroMat.uniforms.uPower!.value = fire;
    for (const p of this.pyro) {
      p.visible = fire > 0.01;
      if (f.camQuat) p.quaternion.copy(f.camQuat);
      p.scale.set(1, 0.3 + fire * (0.8 + Math.random() * 0.3), 1);
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
    for (const t of this.texts.values()) t.dispose();
  }
}

/** A touring flight case: laminate box, aluminium extrusions, ball corners, a stencilled lid. */
function roadCase(label: THREE.Texture, stripe: number): THREE.Group {
  const g = new THREE.Group();
  const W = 3.2;
  const H = 1.5;
  const D = 2;
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(W, H, D),
    new THREE.MeshStandardMaterial({ color: 0x1a1c24, roughness: 0.42, metalness: 0.1 }),
  );
  body.position.y = H / 2;
  g.add(body);
  const lid = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.3, D - 0.3), new THREE.MeshStandardMaterial({ map: label, roughness: 0.6 }));
  lid.rotation.x = -Math.PI / 2;
  lid.position.y = H + 0.01;
  g.add(lid);
  const alu = M.chrome();
  const e = 0.07;
  for (const y of [0.04, H / 2, H - 0.04]) {
    for (const z of [-D / 2, D / 2]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(W + e, e, e), alu);
      bar.position.set(0, y, z);
      g.add(bar);
    }
    for (const x of [-W / 2, W / 2]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(e, e, D + e), alu);
      bar.position.set(x, y, 0);
      g.add(bar);
    }
  }
  for (const x of [-W / 2, W / 2])
    for (const z of [-D / 2, D / 2]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(e, H, e), alu);
      post.position.set(x, H / 2, z);
      g.add(post);
      for (const y of [0.06, H - 0.06]) {
        const ball = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), alu);
        ball.position.set(x, y, z);
        g.add(ball);
      }
    }
  // latches and a strip of glow tape so it reads in the dark
  for (const x of [-0.8, 0.8]) {
    const latch = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.06), alu);
    latch.position.set(x, H - 0.28, D / 2 + 0.03);
    g.add(latch);
  }
  const tape = new THREE.Mesh(new THREE.BoxGeometry(W + 0.02, 0.1, D + 0.02), M.glow(stripe, 2.2));
  tape.position.y = 0.42;
  g.add(tape);
  return g;
}
