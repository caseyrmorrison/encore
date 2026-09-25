import * as THREE from 'three';
import type { Rng } from '../../core/rng';
import { damp } from '../../core/math';
import { canvasTexture, M } from '../materials';
import {
  addFade,
  BALE_R,
  BALE_W,
  baleGeometry,
  buildArch,
  buildBellTents,
  buildDomeTents,
  buildBlankets,
  buildCrowd,
  buildFerrisWheel,
  buildFoodTruck,
  buildGazebo,
  buildMotes,
  buildSky,
  buildStage,
  buildTrees,
  buildTufts,
  BULB,
  BulbBatch,
  BuntingBatch,
  Fireworks,
  makeBaleMaterial,
  makeBulbMaterial,
  makeClock,
  sagPoint,
  seeded,
  SKY_R,
  WireBatch,
  type Bag,
  type FerrisWheel,
  type FieldClock,
  type Person,
} from './fieldsProps';
import { GLSL_COMMON, RippleBank, ringSpawn, type Bounds, type FrameInfo, type Venue, type VenuePalette } from './venue';

/**
 * SUNSET FIELDS — a local open-air festival on a mown field at golden hour. Hay bales to dodge
 * round, fairy lights strung from two maypoles, a striped bandstand to the north, food trucks
 * down the sides and a ferris wheel turning in the distance. The festoons keep time with your
 * band; the DROP sets the strings strobing and the sky full of fireworks.
 */
const HX = 48;
const HZ = 32;
/** horizontal direction of the low sun (north-north-west, behind the stage) */
const SUN = new THREE.Vector2(-0.36, -0.93).normalize();
/** long evening shadows fall away from it, toward the camera */
const SHADOW = SUN.clone().negate();
const STAGE_Z = -41;
const MASTS: readonly [number, number][] = [
  [-22, -2],
  [22, -2],
];
const MAST_H = 11;
/** the festoon poles stand just outside the ropes */
const PX = HX + 2.5;
const PZ = HZ + 2.5;
/** the baked layout map covers x, z in [-MAP, MAP] */
const MAP = 100;
const FESTIVAL = [0xff6b5a, 0xffc23d, 0x2ec4b6, 0xf4ead5, 0xff7eb6, 0x9d7cff, 0x5ab8ff];

type ClusterKind = 'pyramid' | 'pair' | 'single' | 'stand';
const CLUSTERS: readonly { kind: ClusterKind; x: number; z: number; rot: number }[] = [
  { kind: 'pyramid', x: -33, z: -17, rot: 0.25 },
  { kind: 'pyramid', x: 35, z: 16, rot: -0.35 },
  { kind: 'pair', x: -12, z: -21, rot: 0.55 },
  { kind: 'pair', x: 14, z: 22, rot: -0.4 },
  { kind: 'single', x: -38.5, z: 15, rot: 1.1 },
  { kind: 'stand', x: -35.6, z: 17.8, rot: 0 },
  { kind: 'stand', x: 39.5, z: -19, rot: 0 },
  { kind: 'single', x: 41.9, z: -21.2, rot: 0.3 },
  { kind: 'single', x: 9, z: -15, rot: -0.9 },
  { kind: 'pair', x: -21, z: 23, rot: 0.1 },
  { kind: 'stand', x: 26, z: -24, rot: 0 },
  { kind: 'single', x: -7, z: 17, rot: 0.45 },
];

const FLOOR_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const floorFrag = (nb: number): string => /* glsl */ `
${GLSL_COMMON}
uniform float uBeat;
uniform float uKick;
uniform float uHat;
uniform float uDrop;
uniform float uBuild;
uniform float uFinale;
uniform float uEnergy;
uniform vec2 uPlayer;
uniform vec2 uHalf;
uniform sampler2D uMap;
uniform vec4 uMapRect;
uniform vec4 uBales[${nb}];
uniform vec3 uMasts[2];
uniform vec2 uShadowDir;
uniform vec4 uBursts[6];
uniform vec3 uBurstCols[6];
uniform vec3 uGlowCol;
uniform vec3 uHaze;
uniform vec3 uHazeSun;
uniform vec2 uSun;
uniform float uFogD;
uniform vec3 uGust;
varying vec3 vWorld;

float fbm3(vec2 p) { return vnoise(p) * 0.55 + vnoise(p * 2.03 + 17.1) * 0.3 + vnoise(p * 4.1 + 31.7) * 0.15; }

// beyond the festival: a patchwork of harvested fields and pasture, stitched with hedgerows
vec3 farmland(vec2 w, float near) {
  vec2 q = w / 58.0 + vec2(0.23, 0.61);
  vec2 cell = floor(q);
  vec2 f = fract(q);
  float h = hash21(cell + 3.0);
  float ang = h * 6.2832;
  float rows = mix(0.5, 0.5 + 0.5 * sin(dot(w, vec2(cos(ang), sin(ang))) * 1.4), 0.3 + 0.7 * near);
  vec3 stubble = mix(vec3(0.05, 0.032, 0.013), vec3(0.095, 0.062, 0.022), rows);
  vec3 pasture = vec3(0.018, 0.034, 0.014) * (0.8 + 0.4 * rows);
  vec3 plough = mix(vec3(0.024, 0.016, 0.013), vec3(0.042, 0.027, 0.018), rows);
  vec3 c = h < 0.5 ? stubble : h < 0.78 ? pasture : plough;
  c *= 0.75 + 0.5 * vnoise(w * 0.04);
  vec2 e = min(f, 1.0 - f) * 58.0;
  c = mix(c, vec3(0.01, 0.02, 0.01), smoothstep(2.4, 1.2, min(e.x, e.y)));
  return c;
}

void main() {
  vec2 w = vWorld.xz;
  float beat = pow(1.0 - uBeat, 2.2);
  vec3 toCam = cameraPosition - vWorld;
  float camD = length(toCam);
  // fine detail fades with distance so the grass never crawls
  float near = smoothstep(120.0, 40.0, camD);
  float edgeD = min(uHalf.x - abs(w.x), uHalf.y - abs(w.y));
  float mown = smoothstep(-1.2, 0.6, edgeD);

  float n1 = vnoise(w * 0.9);
  float n2 = vnoise(w * 0.23 + 7.0);
  // baked layout: R = light under the festoons, G = worn paths, B = trampled grass
  vec3 mp = texture2D(uMap, (w - uMapRect.xy) * uMapRect.zw + (vec2(n1, n2) - 0.5) * 0.004).rgb;

  // grass: deep green, sunlit yellow-green drifts, cool clover patches
  float big = fbm3(w * 0.045);
  vec3 col = mix(vec3(0.014, 0.03, 0.013), vec3(0.054, 0.064, 0.016), smoothstep(0.3, 0.72, big));
  col = mix(col, vec3(0.013, 0.034, 0.026), smoothstep(0.58, 0.72, vnoise(w * 0.11 + 20.0) * 0.65 + vnoise(w * 0.23 + 3.0) * 0.35) * 0.45);
  col *= 0.86 + 0.28 * n2;
  // blades: stretched noise leaning downwind
  vec2 bw = mat2(0.8, 0.6, -0.6, 0.8) * w;
  float blades = vnoise(bw * vec2(5.0, 24.0)) * 0.55 + hash21(floor(w * 12.0)) * 0.45;
  col *= mix(1.0, 0.7 + blades * 0.6, near);
  // clumps: cellular tufts with dark crevices between them
  vec2 tc = w * 1.8;
  vec2 tb = floor(tc - 0.5);
  float cd = 9.0;
  for (int j = 0; j < 4; j++) {
    vec2 c = tb + vec2(mod(float(j), 2.0), floor(float(j) / 2.0));
    cd = min(cd, length(tc - c - 0.5 - (vec2(hash21(c), hash21(c + 5.3)) - 0.5) * 0.7));
  }
  col *= mix(1.0, 0.78 + 0.34 * smoothstep(0.75, 0.15, cd), near);
  // mowing stripes on the arena; the meadow outside the ropes is left long and dark
  float stripe = smoothstep(-0.12, 0.12, sin(w.x * 3.14159 / 6.0));
  col *= mix(1.0, mix(0.84, 1.2, stripe), mown);
  col = mix(col, col * vec3(1.08, 1.06, 0.8), stripe * mown * 0.6);
  col = mix(col * vec3(0.72, 0.8, 1.0), col, mown);
  // golden hour: the field warms toward the sun behind the stage, cools toward the crowd
  col *= mix(vec3(0.9, 0.95, 1.08), vec3(1.14, 1.0, 0.8), smoothstep(45.0, -55.0, w.y + w.x * 0.35));

  // wind: waves of sheen roll across the grass
  vec2 wd = vec2(0.93, 0.36);
  float ph = dot(w, wd) * 0.2 - uTime * 1.2 + (vnoise(w * 0.03 + vec2(0.0, uTime * 0.02)) * 0.7 + vnoise(w * 0.07) * 0.3) * 7.0;
  float wave = pow(0.5 + 0.5 * sin(ph), 4.0);
  float gusty = smoothstep(0.3, 0.7, vnoise(w * 0.025 - wd * uTime * 0.08));
  col += vec3(0.045, 0.05, 0.012) * wave * (0.35 + 0.65 * gusty) * (0.5 + blades) * mix(1.4, 1.0, mown);
  // a snare or clap flattens a ring of grass outward from the performer
  float ga = uTime - uGust.z;
  if (ga > 0.0 && ga < 1.4) {
    float ring = smoothstep(2.6, 0.0, abs(length(w - uGust.xy) - ga * 20.0)) * pow(1.0 - ga / 1.4, 1.5);
    col += vec3(0.08, 0.08, 0.022) * ring * (0.4 + blades);
  }

  // worn paths: dirt in the middle, trampled straw-coloured grass at the edges
  float pv = mp.g + (n1 - 0.5) * 0.3;
  float path = smoothstep(0.5, 0.68, pv);
  if (pv > 0.14) {
    float fringe = smoothstep(0.14, 0.5, pv) * (1.0 - path);
    vec3 dirt = vec3(0.044, 0.031, 0.021) * (0.7 + 0.6 * vnoise(w * 2.3));
    dirt *= 0.9 + 0.35 * smoothstep(0.74, 0.8, vnoise(w * 6.5));
    float tufts = smoothstep(0.62, 0.8, vnoise(w * 1.7 + 3.0));
    col = mix(col, col * vec3(1.3, 1.08, 0.62) + vec3(0.006, 0.004, 0.0), fringe * 0.7);
    col = mix(col, dirt, path * (1.0 - tufts * 0.7));
  }
  col = mix(col, col * vec3(1.25, 1.05, 0.7), smoothstep(0.1, 0.6, mp.b) * 0.55);

  // wildflowers: daisies, buttercups, clover, cornflowers (they sparkle with the hats)
  vec2 fcell = floor(w * 1.5);
  vec2 ff = fract(w * 1.5);
  float fh = hash21(fcell);
  float fdens = mix(0.004, 0.3, smoothstep(0.55, 0.8, vnoise(w * 0.09 + 40.0) * 0.7 + vnoise(w * 0.33) * 0.3)) + (1.0 - mown) * 0.1;
  if (fh < fdens) {
    vec2 fd = ff - (vec2(hash21(fcell + 1.3), hash21(fcell + 7.7)) * 0.6 + 0.2);
    float kind = hash21(fcell + 5.5);
    float rad = 0.12 + 0.09 * hash21(fcell + 3.1);
    float petal = rad * (0.72 + 0.28 * cos(atan(fd.y, fd.x) * 5.0 + fh * 40.0));
    float fl = length(fd);
    float m = smoothstep(petal, petal * 0.6, fl) * (1.0 - path) * near;
    vec3 fc = kind < 0.45 ? vec3(0.42, 0.4, 0.34) : kind < 0.7 ? vec3(0.5, 0.3, 0.02) : kind < 0.87 ? vec3(0.4, 0.07, 0.2) : vec3(0.14, 0.12, 0.45);
    fc = mix(fc, vec3(0.55, 0.32, 0.02), step(kind, 0.45) * smoothstep(rad * 0.35, rad * 0.2, fl));
    fc *= 1.0 + uHat * 1.6 * step(0.5, fract(fh * 91.0));
    col = mix(col, fc, m);
  }

  // hay bales: contact shade, long evening shadows, loose straw
  float shade = 0.0;
  float straw = 0.0;
  vec2 sn = vec2(-uShadowDir.y, uShadowDir.x);
  for (int i = 0; i < ${nb}; i++) {
    vec4 b = uBales[i];
    vec2 d = w - b.xy;
    float dl = length(d);
    if (dl > b.w * 2.5 + 3.0) continue;
    shade = max(shade, smoothstep(b.z * 1.5, b.z * 0.6, dl) * 0.65);
    float along = dot(d, uShadowDir);
    float len = b.w * 2.4;
    float wdt = b.z * mix(0.95, 0.6, clamp(along / len, 0.0, 1.0));
    float sh = smoothstep(wdt, wdt * 0.35, abs(dot(d, sn))) * smoothstep(len, len * 0.35, along) * smoothstep(-0.4, 0.3, along);
    shade = max(shade, sh * 0.55);
    straw = max(straw, smoothstep(b.z * 2.3, b.z * 1.05, dl));
  }
  // the maypoles throw long thin lines across the field
  for (int i = 0; i < 2; i++) {
    vec2 d = w - uMasts[i].xy;
    float along = dot(d, uShadowDir);
    float len = uMasts[i].z * 2.4;
    shade = max(shade, smoothstep(0.32, 0.08, abs(dot(d, sn))) * smoothstep(len, len * 0.5, along) * step(0.0, along) * 0.5);
  }
  col = mix(col, col * vec3(0.42, 0.4, 0.62), shade);
  // loose straw: thin strands blown round the bales
  if (straw > 0.0) {
    vec2 sw = mat2(0.6, -0.8, 0.8, 0.6) * w;
    float strands = smoothstep(0.7, 0.8, vnoise(sw * vec2(3.0, 24.0))) + smoothstep(0.72, 0.82, vnoise(w * vec2(22.0, 3.2) + 9.0));
    col = mix(col, vec3(0.2, 0.13, 0.04) * (0.75 + 0.5 * n1), min(strands, 1.0) * straw * 0.85);
  }

  // outside the ropes: evening shade; out past the campsites, farmland
  col *= mix(0.6, 1.0, smoothstep(-0.8, 0.3, edgeD));
  float farK = smoothstep(0.0, 14.0, max(abs(w.x) - 96.0, abs(w.y) - 66.0));
  if (farK > 0.0) col = mix(col, farmland(w, near), farK);

  // warm light pooled under the festoons and spilling from the stage and the trucks
  // (they pump with the kick, swell with the fight, flash every beat of the DROP)
  float pump = 0.6 + 0.4 * beat + uKick * 0.6 + uEnergy * 0.25 + uDrop * beat * 0.9;
  col += uGlowCol * mp.r * 0.075 * pump * (1.0 - uBuild * 0.85);
  // the headliner falls: the whole field goes gold
  col += vec3(1.0, 0.72, 0.3) * uFinale * (0.02 + 0.03 * beat);
  // fireworks light the grass in their colour
  for (int i = 0; i < 6; i++) {
    float age = uTime - uBursts[i].w;
    if (age < 0.0 || age > 1.6) continue;
    float k = pow(1.0 - age / 1.6, 2.0);
    col += uBurstCols[i] * k * 0.28 * smoothstep(uBursts[i].y * 1.8, 0.0, length(w - uBursts[i].xz));
  }

  float pd = length(w - uPlayer);
  col += vec3(1.0, 0.75, 0.48) * 0.08 * smoothstep(7.0, 0.0, pd);
  col += ripples(w);
  col = paintOver(col, w);

  // dusk haze over the far field, warmer toward the sun
  float fogF = 1.0 - exp(-pow(uFogD * camD, 2.0));
  vec2 vd = normalize(-toCam.xz + 1e-4);
  col = mix(col, mix(uHaze, uHazeSun, pow(max(dot(vd, uSun), 0.0), 4.0) * smoothstep(170.0, 330.0, camD)), fogF);
  col *= 1.0 - uBuild * 0.7;
  gl_FragColor = vec4(col, 1.0);
}`;

interface BaleCluster {
  x: number;
  z: number;
  /** half-width across the screen, height: for the occlusion test */
  w: number;
  h: number;
  bales: number[];
  fade: number;
}

export class Fields implements Venue {
  readonly id = 'fields' as const;
  readonly name = 'SUNSET FIELDS';
  readonly tagline = 'Golden hour, hay bales, fairy lights. Your first real festival.';
  readonly bpm = 128;
  readonly progression = 'fields' as const;
  readonly bounds: Bounds = { kind: 'rect', hx: HX, hz: HZ };
  readonly palette: VenuePalette = {
    rim: new THREE.Color(0xc07ad8),
    floor: new THREE.Color(0xd0b060),
    accents: [0xff4f8b, 0xffa02e, 0xffe46b, 0x9b6bff],
    fog: 0x3e2e4c,
    fogDensity: 0.003,
    background: 0x1a0f22,
    core: 0xfff0d0,
  };
  readonly group = new THREE.Group();
  readonly obstacles: { x: number; z: number; r: number }[] = [];
  private readonly clock: FieldClock = makeClock();
  private readonly bag: Bag = { textures: [], materials: [] };
  private readonly rip = new RippleBank();
  private readonly floorMat: THREE.ShaderMaterial;
  private readonly fireworks: Fireworks;
  private readonly wheel: FerrisWheel;
  private readonly stageLens: THREE.MeshBasicMaterial;
  private readonly stageLight: THREE.PointLight;
  private readonly clusters: BaleCluster[] = [];
  private readonly baleAttr: THREE.InstancedBufferAttribute;
  private readonly mastFades: THREE.IUniform<number>[] = [];
  private readonly archFade: THREE.IUniform<number> = { value: 1 };
  private readonly glow = new THREE.Color(1, 0.62, 0.28);
  private readonly palCols: THREE.Color[];
  private readonly rnd = seeded(1977);
  private finaleOn = false;
  private dropOn = false;
  private hasBar = false;
  private px = 0;
  private pz = 0;

  constructor() {
    this.palCols = this.palette.accents.map((c) => new THREE.Color(c));
    const bulbMat = makeBulbMaterial(this.clock, this.palette.accents);
    this.bag.materials.push(bulbMat);
    const bulbs = new BulbBatch();
    const wires = new WireBatch();
    const ropes = new WireBatch();
    const flags = new BuntingBatch();
    this.fireworks = new Fireworks(this.bag, this.clock, this.rnd);

    // ── hay bales (the obstacles) ──
    const bales = this.layBales();
    const baleVecs = bales.shadows;

    // ── the stage to the north ──
    const stage = buildStage(this.bag, this.rnd, STAGE_Z);
    this.group.add(stage.group);
    this.stageLens = stage.lens;
    this.stageLight = stage.light;

    // ── festoons: a rope line of bulbs round the field, strings fanning out from two maypoles ──
    const loop = this.perimeter(stage.corners);
    const lightLines: [THREE.Vector3, THREE.Vector3][] = [];
    this.stringPerimeter(loop, bulbs, wires, lightLines);
    const anchorsWest: [number, number, number][] = [
      [-PX, 5.7, -PZ],
      [-38, 5.7, -PZ],
      [-25.5, 5.7, -PZ],
      [stage.corners[0].x, stage.corners[0].y, stage.corners[0].z],
      [-PX, 5.7, -11.5],
      [-PX, 5.7, 11.5],
      [-PX, 5.7, PZ],
      [-38, 5.7, PZ],
      [-25.5, 5.7, PZ],
      [-13, 5.7, PZ],
      [-3.4, 5.3, PZ],
      // crossing over the middle of the field
      [13, 5.7, PZ],
      [stage.corners[1].x, stage.corners[1].y, stage.corners[1].z],
    ];
    let sid = 0;
    MASTS.forEach(([mx, mz], mi) => {
      this.buildMast(mx, mz, bulbs, flags, mi);
      const crown = new THREE.Vector3(mx, MAST_H - 0.8, mz);
      for (const [ax, ay, az] of anchorsWest) {
        const a = new THREE.Vector3(mi === 0 ? ax : -ax, ay, az);
        const len = crown.distanceTo(a);
        const droop = len * 0.06;
        wires.add(crown, a, droop);
        const n = Math.floor(len / 1.75);
        const p = new THREE.Vector3();
        for (let i = 1; i <= n; i++) {
          const t = i / (n + 0.5);
          sagPoint(crown, a, t, droop, p);
          bulbs.add(p.x, p.y - 0.12, p.z, t, sid, BULB.mast, this.rnd());
        }
        lightLines.push([crown.clone(), a]);
        sid++;
      }
    });
    // bunting: across between the maypoles, and from each to the bandstand and the sides
    const buntLines: [THREE.Vector3, THREE.Vector3, number][] = [
      [new THREE.Vector3(-22, 9.3, -2), new THREE.Vector3(22, 9.3, -2), 1.6],
      [new THREE.Vector3(-22, 9.0, -2), stage.corners[0].clone().setY(7.7), 1.2],
      [new THREE.Vector3(22, 9.0, -2), stage.corners[1].clone().setY(7.7), 1.2],
      [new THREE.Vector3(-22, 8.8, -2), new THREE.Vector3(-PX, 5.2, 0), 1.0],
      [new THREE.Vector3(22, 8.8, -2), new THREE.Vector3(PX, 5.2, 0), 1.0],
    ];
    buntLines.forEach(([a, b, d], i) => {
      wires.add(a, b, d);
      flags.addLine(a, b, d, 0.72, FESTIVAL, 1.25, i * 2);
    });
    {
      // a festoon rides the bridge too, a little above the flags
      const [a, b, d] = buntLines[0]!;
      const n = Math.floor(a.distanceTo(b) / 1.6);
      const p = new THREE.Vector3();
      for (let i = 1; i < n; i++) {
        sagPoint(a, b, i / n, d, p);
        bulbs.add(p.x, p.y + 0.1, p.z, i / n, sid++, BULB.mast, this.rnd());
      }
    }
    // guy ropes steady the maypoles
    for (const [mx, mz] of MASTS)
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + 0.4;
        ropes.add(new THREE.Vector3(mx, MAST_H - 1.6, mz), new THREE.Vector3(mx + Math.cos(a) * 4.2, 0.05, mz + Math.sin(a) * 4.2), 0.05, 0.02, 8);
      }

    // ── the rope fence with its pennants ──
    this.buildFence(ropes, flags);

    // ── entrance arch (south, on the camera side: it fades) ──
    this.group.add(buildArch(this.bag, bulbs, PZ, this.archFade));

    // ── food trucks, a merch tent and a bar down the sides ──
    const trucks: [Parameters<typeof buildFoodTruck>[1], number, number, number][] = [
      [{ name: 'TACOS', sub: 'AL PASTOR · VEGGIE', body: 0x7fd6b8, trim: 0xe8574a, stripeA: '#e8574a', stripeB: '#f4ead5', sign: '#2a1a30' }, -61, -15, Math.PI / 2],
      [{ name: 'PIZZA', sub: 'WOOD-FIRED', body: 0xe8674f, trim: 0xf4ead5, stripeA: '#f4ead5', stripeB: '#2e8a6e', sign: '#1e2a24' }, -61, 15, Math.PI / 2],
      [{ name: 'ICE CREAM', sub: 'SOFT SERVE · SPRINKLES', body: 0xf7a6c4, trim: 0x7fd6b8, stripeA: '#ff7eb6', stripeB: '#f4ead5', sign: '#3a1a34' }, 61, -15, -Math.PI / 2],
      [{ name: 'LEMONADE', sub: 'FRESH SQUEEZED', body: 0xf5d25a, trim: 0x2ec4b6, stripeA: '#2ec4b6', stripeB: '#f4ead5', sign: '#1a2a2e' }, 61, 15, -Math.PI / 2],
    ];
    trucks.forEach(([spec, x, z, r], i) => this.group.add(buildFoodTruck(this.bag, spec, bulbs, x, z, r, 60 + i)));
    this.group.add(buildGazebo(this.bag, 'MERCH', '#9d7cff', '#f4ead5', bulbs, -59.5, 1, Math.PI / 2, 70));
    this.group.add(buildGazebo(this.bag, 'BAR', '#ffc23d', '#f4ead5', bulbs, 59.5, 1, -Math.PI / 2, 71));
    this.group.add(buildGazebo(this.bag, 'CIDER', '#e8574a', '#f4ead5', bulbs, 46, 45, -2.6, 72));
    this.group.add(buildGazebo(this.bag, 'FIRST AID', '#2ec4b6', '#f4ead5', bulbs, -46, 45, 2.6, 73));

    // ── the crowd, picnics and the far field ──
    const blankets = this.layPicnics(bulbs);
    this.group.add(buildBlankets(this.bag, blankets.list));
    this.group.add(buildCrowd(this.bag, blankets.people.concat(this.layCrowd()), this.clock, this.rnd));
    this.group.add(buildTrees(this.bag, this.layTrees(), this.rnd));
    const tents: { x: number; z: number; ry: number }[] = [];
    for (let i = 0; i < 11; i++) tents.push({ x: -86 + (i % 4) * 7 + this.rnd() * 2, z: -70 + Math.floor(i / 4) * 8 + this.rnd() * 2, ry: 0.5 + this.rnd() * 0.5 });
    this.group.add(buildBellTents(this.bag, tents));
    this.group.add(buildDomeTents(this.bag, this.layCampsite(bulbs)));
    this.group.add(buildTufts(this.bag, this.clock, this.layTufts(), this.rnd));

    this.wheel = buildFerrisWheel(this.bag, bulbMat);
    this.wheel.group.position.set(62, 0, -96);
    this.wheel.group.rotation.y = -0.3;
    this.group.add(this.wheel.group);

    // ── build the batches ──
    this.group.add(bulbs.build(bulbMat, 0.15));
    this.group.add(wires.build(this.mat(new THREE.MeshStandardMaterial({ color: 0x1c1410, roughness: 0.7 }))));
    this.group.add(ropes.build(this.mat(new THREE.MeshStandardMaterial({ color: 0xc8b48a, roughness: 0.9 }))));
    this.group.add(flags.build(this.clock, this.bag));
    this.group.add(buildMotes(this.bag, this.clock, this.rnd, HX, HZ));
    this.group.add(this.fireworks.points);
    this.group.add(buildSky(this.bag, this.clock, SUN));

    // ── the field itself ──
    const map = this.bakeLayout(lightLines);
    const haze = new THREE.Color(this.palette.fog);
    this.floorMat = new THREE.ShaderMaterial({
      vertexShader: FLOOR_VERT,
      fragmentShader: floorFrag(baleVecs.length),
      uniforms: {
        uTime: this.clock.uTime,
        uBeat: this.clock.uBeat,
        uKick: this.clock.uKick,
        uHat: this.clock.uHat,
        uDrop: this.clock.uDrop,
        uBuild: this.clock.uBuild,
        uFinale: this.clock.uFinale,
        uEnergy: { value: 0 },
        uPlayer: { value: new THREE.Vector2() },
        uHalf: { value: new THREE.Vector2(HX, HZ) },
        uMap: { value: map },
        uMapRect: { value: new THREE.Vector4(-MAP, -MAP, 1 / (2 * MAP), 1 / (2 * MAP)) },
        uBales: { value: baleVecs },
        uMasts: { value: MASTS.map(([x, z]) => new THREE.Vector3(x, z, MAST_H)) },
        uShadowDir: { value: SHADOW },
        uBursts: { value: this.fireworks.bursts },
        uBurstCols: { value: this.fireworks.colors },
        uGlowCol: { value: this.glow },
        uHaze: { value: haze },
        uHazeSun: { value: new THREE.Color(0xb86a58) },
        uSun: { value: SUN },
        uFogD: { value: this.palette.fogDensity },
        uGust: { value: new THREE.Vector3(0, 0, -99) },
        ...this.rip.uniforms(),
      },
    });
    this.bag.materials.push(this.floorMat);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(SKY_R - 0.5, 96), this.floorMat);
    floor.rotation.x = -Math.PI / 2;
    this.group.add(floor);

    // hay bales go in last: one instanced draw
    this.baleAttr = bales.attr;
    this.group.add(bales.mesh);

    // light: the low sun behind the stage, a pink sky fill from the camera side, lamps
    const hemi = new THREE.HemisphereLight(0xd8a0c8, 0x34401c, 1.05);
    const sun = new THREE.DirectionalLight(0xffb46a, 2.6);
    sun.position.set(SUN.x * 60, 26, SUN.y * 60);
    const fill = new THREE.DirectionalLight(0xff9ab0, 0.6);
    fill.position.set(18, 30, 50);
    const truckL = new THREE.PointLight(0xffb070, 60, 26, 1.5);
    truckL.position.set(-56, 4.5, 0);
    const truckR = truckL.clone();
    truckR.position.x = 56;
    this.group.add(hemi, sun, fill, truckL, truckR);
  }

  private mat<T extends THREE.Material>(m: T): T {
    this.bag.materials.push(m);
    return m;
  }

  /** Round bales in stacks, pairs and singles; returns the instanced mesh and shadow casters. */
  private layBales(): { mesh: THREE.InstancedMesh; attr: THREE.InstancedBufferAttribute; shadows: THREE.Vector4[] } {
    const R = BALE_R;
    const place: { x: number; y: number; z: number; rot: number; lying: boolean }[] = [];
    const shadows: THREE.Vector4[] = [];
    for (const c of CLUSTERS) {
      const cs = Math.cos(c.rot);
      const sn = Math.sin(c.rot);
      const at = (lx: number, lz: number): [number, number] => [c.x + cs * lx + sn * lz, c.z - sn * lx + cs * lz];
      const first = place.length;
      const add = (lx: number, y: number, lz: number, lying: boolean, r: number, h: number, obstacle: boolean): void => {
        const [x, z] = at(lx, lz);
        place.push({ x, y, z, rot: c.rot, lying });
        shadows.push(new THREE.Vector4(x, z, r, h));
        if (obstacle) this.obstacles.push({ x, z, r });
      };
      let w = 1;
      let h = 1.7;
      if (c.kind === 'pyramid') {
        add(0, R, -(R + 0.02), true, 0.95, 1.7, true);
        add(0, R, R + 0.02, true, 0.95, 1.7, true);
        add(0, R + Math.sqrt(3) * R, 0, true, 0.9, 3.2, false);
        w = 1.9;
        h = 3.2;
      } else if (c.kind === 'pair') {
        add(-(BALE_W / 2 + 0.04), R, 0, true, 0.92, 1.7, true);
        add(BALE_W / 2 + 0.04, R, 0, true, 0.92, 1.7, true);
        w = 1.6;
      } else if (c.kind === 'single') {
        add(0, R, 0, true, 0.95, 1.7, true);
      } else {
        add(0, BALE_W / 2, 0, false, 0.92, 1.24, true);
        h = 1.24;
      }
      this.clusters.push({ x: c.x, z: c.z, w, h, bales: place.map((_, i) => i).slice(first), fade: 1 });
    }
    // rows of bales waiting in the harvested fields beyond the festival
    for (const [x0, z0, rows, cols, rot] of [
      [-150, -44, 3, 5, 0.3],
      [108, -72, 3, 5, -0.2],
      [-40, -126, 2, 7, 0.05],
      [120, 40, 3, 4, 0.5],
    ] as const)
      for (let r = 0; r < rows; r++)
        for (let k = 0; k < cols; k++) {
          if (this.rnd() < 0.2) continue;
          const lx = k * 8 + (this.rnd() - 0.5) * 2;
          const lz = r * 11 + (this.rnd() - 0.5) * 2;
          place.push({ x: x0 + Math.cos(rot) * lx + Math.sin(rot) * lz, y: R, z: z0 - Math.sin(rot) * lx + Math.cos(rot) * lz, rot: this.rnd() * 6, lying: true });
        }
    const geo = baleGeometry();
    const data = new Float32Array(place.length * 2);
    const mesh = new THREE.InstancedMesh(geo, makeBaleMaterial(this.bag), place.length);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const lie = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
    const up = new THREE.Vector3(0, 1, 0);
    place.forEach((b, i) => {
      q.setFromAxisAngle(up, b.rot + (this.rnd() - 0.5) * 0.12);
      if (b.lying) q.multiply(lie);
      else q.multiply(new THREE.Quaternion().setFromAxisAngle(up, this.rnd() * 6));
      m4.compose(new THREE.Vector3(b.x, b.y, b.z), q, new THREE.Vector3(1, 1, 1));
      mesh.setMatrixAt(i, m4);
      data[i * 2] = 1;
      data[i * 2 + 1] = this.rnd();
    });
    const attr = new THREE.InstancedBufferAttribute(data, 2);
    attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aBale', attr);
    mesh.computeBoundingSphere();
    return { mesh, attr, shadows };
  }

  /** A maypole: a ribbon-wrapped mast with a crown of bulbs and a streamer on top. */
  private buildMast(x: number, z: number, bulbs: BulbBatch, flags: BuntingBatch, i: number): void {
    const tex = canvasTexture(64, 64, (g, w, h) => {
      g.fillStyle = '#f2e6cc';
      g.fillRect(0, 0, w, h);
      for (let k = -2; k < 4; k++) {
        g.fillStyle = k % 2 === 0 ? '#e2504a' : '#2ec4b6';
        g.beginPath();
        g.moveTo(0, k * 32);
        g.lineTo(w, k * 32 + 64);
        g.lineTo(w, k * 32 + 64 + 13);
        g.lineTo(0, k * 32 + 13);
        g.closePath();
        g.fill();
      }
    });
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, 9);
    this.bag.textures.push(tex);
    const fade = { value: 1 };
    this.mastFades.push(fade);
    const poleMat = this.mat(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
    addFade(poleMat, fade, 'fields-fade');
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.2, MAST_H, 12), poleMat);
    pole.position.set(x, MAST_H / 2, z);
    this.group.add(pole);
    const brass = this.mat(new THREE.MeshStandardMaterial({ color: 0xffc85a, metalness: 1, roughness: 0.25 }));
    addFade(brass, fade, 'fields-fade');
    const crown = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.05, 6, 24), brass);
    crown.rotation.x = Math.PI / 2;
    crown.position.set(x, MAST_H - 0.8, z);
    this.group.add(crown);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), brass);
    ball.position.set(x, MAST_H + 0.2, z);
    this.group.add(ball);
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.65, 0.35, 16), M.darkWood());
    collar.position.set(x, 0.17, z);
    this.group.add(collar);
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      bulbs.add(x + Math.cos(a) * 0.62, MAST_H - 0.85, z + Math.sin(a) * 0.62, k / 10, 80 + i, BULB.steady, k * 0.1);
    }
    flags.addFlag(new THREE.Vector3(x, MAST_H + 0.1, z), new THREE.Vector3(0.93, -0.25, 0.36), i ? 0xffc23d : 0xff4f8b, 2.2, 6.5);
    this.obstacles.push({ x, z, r: 0.7 });
  }

  /** Festoon pole positions round the field (clockwise from the north-west corner). */
  private perimeter(corners: [THREE.Vector3, THREE.Vector3]): THREE.Vector3[] {
    const y = 5.7;
    const pts: THREE.Vector3[] = [
      new THREE.Vector3(-PX, y, -PZ),
      new THREE.Vector3(-38, y, -PZ),
      new THREE.Vector3(-25.5, y, -PZ),
      corners[0].clone(),
      corners[1].clone(),
      new THREE.Vector3(25.5, y, -PZ),
      new THREE.Vector3(38, y, -PZ),
      new THREE.Vector3(PX, y, -PZ),
    ];
    for (const z of [-23, -11.5, 0, 11.5, 23]) pts.push(new THREE.Vector3(PX, y, z));
    pts.push(new THREE.Vector3(PX, y, PZ));
    for (const x of [38, 25.5, 13]) pts.push(new THREE.Vector3(x, y, PZ));
    pts.push(new THREE.Vector3(3.4, 5.3, PZ), new THREE.Vector3(-3.4, 5.3, PZ));
    for (const x of [-13, -25.5, -38]) pts.push(new THREE.Vector3(x, y, PZ));
    pts.push(new THREE.Vector3(-PX, y, PZ));
    for (const z of [23, 11.5, 0, -11.5, -23]) pts.push(new THREE.Vector3(-PX, y, z));
    return pts;
  }

  /** Poles and the rope line of bulbs; its chase laps the field once a bar. */
  private stringPerimeter(loop: THREE.Vector3[], bulbs: BulbBatch, wires: WireBatch, lines: [THREE.Vector3, THREE.Vector3][]): void {
    let total = 0;
    for (let i = 0; i < loop.length; i++) total += loop[i]!.distanceTo(loop[(i + 1) % loop.length]!);
    let run = 0;
    const p = new THREE.Vector3();
    const poleGeo = new THREE.CylinderGeometry(0.1, 0.13, 6, 8);
    poleGeo.translate(0, 3, 0);
    const poles: THREE.Vector3[] = [];
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i]!;
      const b = loop[(i + 1) % loop.length]!;
      const len = a.distanceTo(b);
      const stageFront = Math.abs(a.z - b.z) < 1e-3 && Math.abs(a.y - 5.7) > 0.5 && a.z < 0;
      const droop = stageFront ? 0.15 : len * 0.035;
      wires.add(a, b, droop);
      const n = Math.max(2, Math.round(len / 1.4));
      for (let k = 0; k < n; k++) {
        const t = k / n;
        sagPoint(a, b, t, droop, p);
        bulbs.add(p.x, p.y - 0.12, p.z, (run + t * len) / total, 50, BULB.fence, this.rnd());
      }
      run += len;
      if (Math.abs(a.y - 5.7) < 1e-3) poles.push(a);
      lines.push([a, b]);
    }
    const inst = new THREE.InstancedMesh(poleGeo, M.darkWood(), poles.length);
    const m4 = new THREE.Matrix4();
    poles.forEach((q, i) => inst.setMatrixAt(i, m4.makeTranslation(q.x, 0, q.z)));
    inst.computeBoundingSphere();
    this.group.add(inst);
  }

  /** Stakes and a rope just outside the play area, hung with little pennants. */
  private buildFence(ropes: WireBatch, flags: BuntingBatch): void {
    const ox = HX + 0.9;
    const oz = HZ + 0.9;
    const corners = [
      new THREE.Vector3(-ox, 1, -oz),
      new THREE.Vector3(ox, 1, -oz),
      new THREE.Vector3(ox, 1, oz),
      new THREE.Vector3(-ox, 1, oz),
    ];
    const stakes: THREE.Vector3[] = [];
    for (let s = 0; s < 4; s++) {
      const a = corners[s]!;
      const b = corners[(s + 1) % 4]!;
      const len = a.distanceTo(b);
      const n = Math.round(len / 4);
      for (let i = 0; i < n; i++) {
        const p0 = a.clone().lerp(b, i / n);
        const p1 = a.clone().lerp(b, (i + 1) / n);
        stakes.push(p0);
        // the gap under the entrance arch
        if (s === 2 && Math.abs((p0.x + p1.x) / 2) < 3.4) continue;
        ropes.add(p0, p1, 0.1, 0.035, 6);
        flags.addLine(p0, p1, 0.1, 0.62, FESTIVAL, 0.72, i * 3 + s);
      }
    }
    const geo = new THREE.BoxGeometry(0.1, 1.15, 0.1);
    geo.translate(0, 0.575, 0);
    const inst = new THREE.InstancedMesh(geo, M.darkWood(), stakes.length);
    const m4 = new THREE.Matrix4();
    stakes.forEach((p, i) => inst.setMatrixAt(i, m4.makeTranslation(p.x, 0, p.z)));
    inst.computeBoundingSphere();
    this.group.add(inst);
  }

  /** Blankets on the south lawn, each with a group sitting round a jar lantern. */
  private layPicnics(bulbs: BulbBatch): { list: { x: number; z: number; ry: number; c: number }[]; people: Person[] } {
    const list: { x: number; z: number; ry: number; c: number }[] = [];
    const people: Person[] = [];
    const cols = [0xd94a4a, 0x4a7ad9, 0xe0b43a, 0x5aa05a, 0x8a5ac8, 0x2ec4b6, 0xe07a3a];
    const spots: [number, number][] = [
      [-40, 39],
      [-31, 42],
      [-22, 38.5],
      [-14, 44],
      [-8, 39],
      [9, 40],
      [17, 45],
      [24, 39],
      [33, 43],
      [41, 38.5],
      [-47, 46],
      [2, 48],
      [-58, 34],
      [58, 35],
      [-56, -30],
      [56, -29],
    ];
    spots.forEach(([x, z], i) => {
      const ry = (this.rnd() - 0.5) * 1.2;
      list.push({ x, z, ry, c: cols[i % cols.length]! });
      const n = 1 + Math.floor(this.rnd() * 3);
      for (let k = 0; k < n; k++) {
        const a = ry + (k / n) * Math.PI * 2 + this.rnd() * 0.5;
        people.push({ x: x + Math.cos(a) * 0.8, z: z + Math.sin(a) * 0.55, ry: -a - Math.PI / 2, s: 0.95 + this.rnd() * 0.1, kind: 2 });
      }
      if (i % 2 === 0) bulbs.add(x + 0.3, 0.3, z - 0.2, 0, 95, BULB.steady, this.rnd());
    });
    return { list, people };
  }

  /** A sparse crowd round the ropes: the lawn, the truck queues and the flanks of the stage. */
  private layCrowd(): Person[] {
    const out: Person[] = [];
    const add = (x: number, z: number, face: number): void => {
      out.push({ x, z, ry: face + (this.rnd() - 0.5) * 0.9, s: 0.9 + this.rnd() * 0.2, kind: this.rnd() < 0.3 ? 1 : 0 });
    };
    const busy = (x: number, z: number): boolean =>
      Math.abs(x) < 4.5 ||
      Math.hypot(x - 46, z - 45) < 4 ||
      Math.hypot(x + 46, z - 45) < 4;
    // south lawn: looser the further back
    for (let i = 0; i < 260; i++) {
      const x = (this.rnd() * 2 - 1) * 58;
      const z = HZ + 3.2 + Math.pow(this.rnd(), 1.6) * 20;
      if (busy(x, z)) continue;
      add(x, z, Math.PI);
    }
    // the sides, thicker in front of the trucks
    for (const s of [-1, 1]) {
      for (let i = 0; i < 150; i++) {
        const x = s * (HX + 3.6 + this.rnd() * 6.5);
        const z = (this.rnd() * 2 - 1) * (HZ + 2);
        add(x, z, s > 0 ? -Math.PI / 2 : Math.PI / 2);
      }
      for (const tz of [-15, 1, 15])
        for (let k = 0; k < 7; k++) add(s * (58.4 - k * 0.85), tz + (this.rnd() - 0.5) * 1.2, s > 0 ? -Math.PI / 2 : Math.PI / 2);
    }
    // flanking the bandstand
    for (let i = 0; i < 150; i++) {
      const s = this.rnd() < 0.5 ? -1 : 1;
      const x = s * (18 + this.rnd() * 30);
      const z = -HZ - 3.5 - this.rnd() * 12;
      add(x, z, Math.atan2(-x * 0.3, STAGE_Z - z) + Math.PI);
    }
    return out;
  }

  /** Campsites beyond the food trucks: dome tents in rows, lanterns between them. */
  private layCampsite(bulbs: BulbBatch): { x: number; z: number; ry: number; c: number; s: number }[] {
    const cols = [0xc86a3a, 0x3a6ab0, 0x4a8a4a, 0xb04040, 0xc8a040, 0x707070, 0x2a9a90, 0x7a5ab8, 0x3a3a48];
    const out: { x: number; z: number; ry: number; c: number; s: number }[] = [];
    for (const s of [-1, 1])
      for (let row = 0; row < 7; row++)
        for (let k = 0; k < 13; k++) {
          if (this.rnd() < 0.25) continue;
          const x = s * (71 + row * 3.8 + (this.rnd() - 0.5) * 1.6);
          const z = -38 + k * 6.4 + (this.rnd() - 0.5) * 2.4;
          out.push({ x, z, ry: this.rnd() * 6.28, c: cols[Math.floor(this.rnd() * cols.length)]!, s: 0.62 + this.rnd() * 0.4 });
          if (this.rnd() < 0.12) bulbs.add(x + 1.6, 0.35, z + 1.2, 0, 96, BULB.steady, this.rnd());
        }
    return out;
  }

  /** Long grass: thick along the outside of the ropes, clumped round the poles and bales. */
  private layTufts(): { x: number; z: number; s: number; r: number }[] {
    const out: { x: number; z: number; s: number; r: number }[] = [];
    const add = (x: number, z: number, s: number): void => {
      out.push({ x, z, s, r: this.rnd() * 6.28 });
    };
    for (let i = 0; i < 1300; i++) {
      const d = 0.7 + Math.pow(this.rnd(), 1.8) * 10;
      const t = this.rnd() * 2 - 1;
      const side = this.rnd();
      if (side < 0.3) add(t * (HX + d), -HZ - d, 0.8 + this.rnd() * 0.7);
      else if (side < 0.6) {
        const x = t * (HX + d);
        if (Math.abs(x) > 5) add(x, HZ + d, 0.8 + this.rnd() * 0.7);
      } else add((side < 0.8 ? -1 : 1) * (HX + d), t * (HZ + d), 0.8 + this.rnd() * 0.7);
    }
    // a few survivors at the foot of the bales and the maypoles
    for (const c of CLUSTERS)
      for (let k = 0; k < 5; k++) {
        const a = this.rnd() * 6.28;
        add(c.x + Math.cos(a) * (1.4 + this.rnd()), c.z + Math.sin(a) * (1.4 + this.rnd()), 0.5 + this.rnd() * 0.4);
      }
    for (const [mx, mz] of MASTS)
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * 6.28;
        add(mx + Math.cos(a) * 0.8, mz + Math.sin(a) * 0.8, 0.6 + this.rnd() * 0.4);
      }
    return out;
  }

  /** Hedgerow trees round the far field, a row of poplars behind the stage. */
  private layTrees(): { x: number; z: number; s: number; poplar: boolean }[] {
    const out: { x: number; z: number; s: number; poplar: boolean }[] = [];
    for (let i = 0; i < 90 && out.length < 60; i++) {
      const a = -Math.PI * 0.5 + (this.rnd() * 2 - 1) * Math.PI * 0.62;
      const r = 78 + this.rnd() * 92;
      const x = Math.sin(a) * r;
      const z = -Math.cos(a) * r;
      if (z > 40) continue;
      if (Math.hypot(x - 62, z + 96) < 30 || Math.hypot(x + 78, z + 62) < 22) continue;
      out.push({ x, z, s: 1.1 + this.rnd() * 0.9, poplar: false });
    }
    for (let x = -46; x <= 46; x += 6.5) {
      if (Math.abs(x) < 16) continue;
      out.push({ x: x + (this.rnd() - 0.5) * 2, z: -58 - this.rnd() * 4, s: 1.1 + this.rnd() * 0.3, poplar: true });
    }
    return out;
  }

  /** Paint the layout into a map the floor shader samples: light, paths, trampled grass. */
  private bakeLayout(lightLines: [THREE.Vector3, THREE.Vector3][]): THREE.CanvasTexture {
    const S = 1024;
    const k = S / (2 * MAP);
    const X = (x: number): number => (x + MAP) * k;
    const tex = canvasTexture(
      S,
      S,
      (g) => {
        g.fillStyle = '#000';
        g.fillRect(0, 0, S, S);
        g.globalCompositeOperation = 'lighter';
        g.lineCap = 'round';
        g.lineJoin = 'round';
        const rgba = (ch: number, a: number): string => `rgba(${ch === 0 ? 255 : 0},${ch === 1 ? 255 : 0},${ch === 2 ? 255 : 0},${a})`;
        const blob = (x: number, z: number, r: number, a: number, ch: number): void => {
          const grd = g.createRadialGradient(X(x), X(z), 0, X(x), X(z), r * k);
          grd.addColorStop(0, rgba(ch, a));
          grd.addColorStop(1, rgba(ch, 0));
          g.fillStyle = grd;
          g.fillRect(X(x) - r * k, X(z) - r * k, r * k * 2, r * k * 2);
        };
        const curve = (pts: readonly (readonly [number, number])[]): void => {
          g.beginPath();
          g.moveTo(X(pts[0]![0]), X(pts[0]![1]));
          for (let i = 1; i < pts.length - 1; i++) {
            const [x, z] = pts[i]!;
            const [nx, nz] = pts[i + 1]!;
            g.quadraticCurveTo(X(x), X(z), X((x + nx) / 2), X((z + nz) / 2));
          }
          const last = pts[pts.length - 1]!;
          g.lineTo(X(last[0]), X(last[1]));
        };
        const stroke = (pts: readonly (readonly [number, number])[], w: number, ch: number, layers: readonly (readonly [number, number])[]): void => {
          for (const [mul, a] of layers) {
            g.lineWidth = w * mul * k;
            g.strokeStyle = rgba(ch, a);
            curve(pts);
            g.stroke();
          }
        };
        // R: a soft band under every festoon, brighter where the strings gather at a mast
        for (const [a, b] of lightLines)
          stroke(
            [
              [a.x, a.z],
              [b.x, b.z],
            ],
            1,
            0,
            [
              [6, 0.035],
              [3.4, 0.06],
              [1.6, 0.1],
            ],
          );
        blob(0, -33, 17, 0.5, 0);
        blob(0, -36.5, 9, 0.45, 0);
        for (const s of [-1, 1]) {
          for (const z of [-15, 15]) blob(s * 56, z, 7.5, 0.5, 0);
          blob(s * 57, 1, 5.5, 0.4, 0);
          blob(s * 22, -2, 7, 0.3, 0);
          blob(s * 46, 45, 5, 0.35, 0);
        }
        blob(0, PZ, 6.5, 0.45, 0);
        // G: the worn paths
        const paths: [readonly (readonly [number, number])[], number][] = [
          [
            [
              [0, 60],
              [0, 38],
              [-4, 26],
              [3.5, 12],
              [1, 2],
              [-5, -9],
              [-2, -20],
              [2.5, -29],
              [0, -36],
            ],
            2.3,
          ],
          [
            [
              [-60, -15],
              [-45, -12],
              [-33, -6],
              [-22, -2],
              [-10, 3],
              [1, 2],
              [12, 1],
              [22, -2],
              [34, 5],
              [46, 12],
              [60, 15],
            ],
            1.8,
          ],
          [
            [
              [-60, 15],
              [-46, 19],
              [-31, 26.5],
              [-18, 30],
              [-9, 37],
            ],
            1.6,
          ],
          [
            [
              [60, -15],
              [47, -19],
              [33, -13],
              [22, -2],
            ],
            1.6,
          ],
          [
            [
              [-HX - 5, -HZ - 5],
              [HX + 5, -HZ - 5],
              [HX + 5, HZ + 5],
              [-HX - 5, HZ + 5],
              [-HX - 5, -HZ - 5],
              [HX + 5, -HZ - 5],
            ],
            2.4,
          ],
        ];
        for (const [pts, w] of paths)
          stroke(pts, w, 1, [
            [2.3, 0.14],
            [1.5, 0.22],
            [1, 0.5],
            [0.55, 0.45],
          ]);
        for (const [mx, mz] of MASTS) {
          g.lineWidth = 1.7 * k;
          g.strokeStyle = rgba(1, 0.7);
          g.beginPath();
          g.arc(X(mx), X(mz), 3.6 * k, 0, Math.PI * 2);
          g.stroke();
          g.lineWidth = 3.2 * k;
          g.strokeStyle = rgba(1, 0.2);
          g.stroke();
        }
        // B: trampled grass in front of the stage, round the trucks and the maypoles
        blob(0, -31, 13, 0.7, 2);
        blob(0, 36, 7, 0.6, 2);
        for (const s of [-1, 1]) {
          for (const z of [-15, 1, 15]) blob(s * 55, z, 6.5, 0.7, 2);
          blob(s * 22, -2, 6.5, 0.5, 2);
        }
      },
      false,
    );
    tex.flipY = false;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    this.bag.textures.push(tex);
    return tex;
  }

  ripple(x: number, z: number, color: THREE.Color | number, strength = 1): void {
    this.rip.add(x, z, this.clock.uTime.value, color, strength);
  }

  setBar(b: number): void {
    this.hasBar = true;
    this.clock.uStep.value = (b - Math.floor(b)) * 16;
  }

  onStep(step: number, bar: number): void {
    if (!this.hasBar) this.clock.uStep.value = step;
    const t = this.clock.uTime.value;
    const pick = (): number => this.palette.accents[Math.floor(this.rnd() * 4)]!;
    if (this.finaleOn) {
      if (step % 2 === 0) this.fireworks.launch((this.rnd() * 2 - 1) * 40, 10 + this.rnd() * 6, -52 + this.rnd() * 34, this.rnd() < 0.3 ? 0xffd36b : pick(), t);
    } else if (this.dropOn && step % 4 === 0) {
      // the show: over the bandstand, and now and then right over the field
      const over = this.rnd() < 0.45;
      this.fireworks.launch(
        (this.rnd() * 2 - 1) * (over ? 36 : 44),
        over ? 14 + this.rnd() * 4 : 18 + this.rnd() * 8,
        over ? -24 + this.rnd() * 40 : -64 + this.rnd() * 22,
        pick(),
        t,
      );
    } else if (step === 0 && bar % 16 === 15) {
      // a lone rocket far behind the stage: somebody couldn't wait
      this.fireworks.launch((this.rnd() * 2 - 1) * 30, 26 + this.rnd() * 6, -80, pick(), t);
    }
  }

  onNote(inst: string, strength: number): void {
    const c = this.clock;
    if (inst === 'kick') c.uKick.value = Math.min(1, c.uKick.value + strength * 0.7);
    else if (inst === 'snare' || inst === 'clap') {
      // the snare blows a ring of wind through the grass from where you stand
      (this.floorMat.uniforms.uGust!.value as THREE.Vector3).set(this.px, this.pz, c.uTime.value);
    } else if (inst === 'hat' || inst === 'tom' || inst === 'cowbell' || inst === 'scratch') c.uHat.value = Math.min(1, c.uHat.value + strength * 0.7);
    else if (inst === 'crash' || inst === 'gong') c.uFlash.value = Math.min(1, c.uFlash.value + strength);
  }

  finale(): void {
    this.finaleOn = true;
    this.clock.uFlash.value = 1;
  }

  update(f: FrameInfo): void {
    const c = this.clock;
    c.uTime.value = f.time;
    c.uBeat.value = f.beatPhase;
    c.uBuild.value = f.build;
    c.uDrop.value = f.drop && !this.finaleOn ? 1 : 0;
    c.uFinale.value = damp(c.uFinale.value, this.finaleOn ? 1 : 0, 3, f.dt);
    c.uKick.value *= Math.exp(-f.dt * 8);
    c.uHat.value *= Math.exp(-f.dt * 9);
    c.uFlash.value *= Math.exp(-f.dt * 4);
    c.uJump.value = 0.14 + f.energy * 0.25 + (f.drop ? 0.3 : 0) + (this.finaleOn ? 0.45 : 0);
    if (f.drop && !this.dropOn) {
      // the downbeat of the DROP: the wheel flashes and the sky opens up
      c.uFlash.value = 1;
      for (let i = 0; i < 3; i++)
        this.fireworks.launch((i - 1) * 26, 20 + this.rnd() * 6, -58 - this.rnd() * 10, this.palette.accents[i]!, f.time + i * 0.12);
    }
    this.dropOn = f.drop;
    this.px = f.playerX;
    this.pz = f.playerZ;
    const u = this.floorMat.uniforms;
    u.uEnergy!.value = f.energy;
    (u.uPlayer!.value as THREE.Vector2).set(f.playerX, f.playerZ);

    const beat = Math.pow(1 - f.beatPhase, 3);
    // the light the festoons pool on the grass: warm, colour-cycling in the drop, gold at the end
    if (this.finaleOn) this.glow.setRGB(1, 0.72, 0.3).multiplyScalar(1.6);
    else if (f.drop) this.glow.copy(this.palCols[Math.floor(c.uStep.value / 4) % 4]!).multiplyScalar(1.5);
    else this.glow.setRGB(1, 0.62, 0.28);
    this.wheel.update(f.dt, 0.045 + (f.drop ? 0.12 : 0) + (this.finaleOn ? 0.1 : 0));
    this.stageLight.intensity = 55 + beat * 45 + (f.drop ? 40 : 0);
    this.stageLens.color
      .copy(f.drop ? this.palCols[Math.floor(f.time * 4) % 4]! : this.glow)
      .multiplyScalar((1.4 + beat * 2.5) * (1 - f.build * 0.8));
  }

  occlude(px: number, pz: number): void {
    // bale stacks dissolve when the player is just "north" of them on screen
    let dirty = false;
    for (const c of this.clusters) {
      const hidden = Math.abs(px - c.x) < c.w + 0.9 && pz < c.z + 0.3 && pz > c.z - c.h * 0.7 - 1.0;
      const next = c.fade + ((hidden ? 0.45 : 1) - c.fade) * 0.15;
      if (Math.abs(next - c.fade) < 1e-3) continue;
      c.fade = Math.abs(next - 1) < 2e-3 ? 1 : next;
      for (const i of c.bales) this.baleAttr.setX(i, c.fade);
      dirty = true;
    }
    if (dirty) this.baleAttr.needsUpdate = true;
    MASTS.forEach(([mx, mz], i) => {
      const hidden = Math.abs(px - mx) < 1.6 && pz < mz && pz > mz - 9;
      const f = this.mastFades[i]!;
      f.value += ((hidden ? 0.25 : 1) - f.value) * 0.15;
    });
    const archHidden = Math.abs(px) < 5.5 && pz > PZ - 7;
    this.archFade.value += ((archHidden ? 0.25 : 1) - this.archFade.value) * 0.15;
  }

  spawnPoint(rng: Rng, px: number, pz: number, out: { x: number; z: number }): void {
    ringSpawn(this.bounds, this.obstacles, rng, px, pz, out);
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points) o.geometry.dispose();
    });
    for (const t of this.bag.textures) t.dispose();
    for (const m of this.bag.materials) m.dispose();
  }
}
