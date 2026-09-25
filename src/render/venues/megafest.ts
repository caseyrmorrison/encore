import * as THREE from 'three';
import type { Rng } from '../../core/rng';
import { damp } from '../../core/math';
import { buildInstrument } from '../instrumentModels';
import { M } from '../materials';
import {
  barricade,
  BeamBatch,
  bannerTexture,
  box,
  buildCrowd,
  buildCrowdLights,
  buildDrones,
  buildFlags,
  buildStars,
  buildStreamers,
  cameraCrane,
  crowdUniforms,
  curvedPanel,
  delayTower,
  fohRiser,
  ledText,
  lightTower,
  makeCrowdMaterial,
  makeGlowMaterial,
  makeLedMaterial,
  makePlumeMaterial,
  merge,
  mulberry,
  neonTexture,
  sideStage,
  stadium,
  stageRoof,
  type Crane,
  type CrowdUniforms,
  type DelayTower,
  type DroneSwarm,
  type Raver,
  type Streamers,
} from './megafestProps';
import { GLSL_COMMON, RippleBank, ringSpawn, type Bounds, type FrameInfo, type Venue, type VenuePalette } from './venue';

/**
 * MEGAFEST — the biggest festival on Earth and the last night of the world tour.
 * The play area is the golden circle: a pit of LED deck in front of a stadium-sized main stage,
 * with a catwalk out to a round B-stage. Around it: delay towers, ~30k GPU-animated ravers in
 * the field and the bowl, side stages, floodlight masts and a drone swarm overhead.
 * The floor is the sequencer: sixteen spokes keep time, the instruments play the deck, and
 * the finale turns the whole stadium gold while the drones crown the B-stage.
 */
const HX = 66;
const HZ = 42;
/** stage front (the deck rises here, just north of the pit) */
const DECK_Z = -43;
const DECK_H = 2.6;
const ROOF_Y = 30;
/** the B-stage at the end of the catwalk: also where the victory camera looks */
const BST = new THREE.Vector2(0, -9);

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
uniform float uBeats;
uniform float uStep;
uniform float uEnergy;
uniform float uDrop;
uniform float uBuild;
uniform float uFinale;
uniform vec2 uPlayer;
uniform vec2 uHalf;
uniform vec3 uCols[4];
uniform vec4 uSpots[8];
uniform vec3 uSpotCols[8];
uniform vec4 uHits;   // kick, snare/clap, hats, bass (each decays from 1)
uniform vec2 uHits2;  // lead, crash
uniform float uBands[16];
varying vec3 vWorld;

const vec2 BST = vec2(0.0, -9.0);

vec3 pal(float i) {
  int k = int(mod(i, 4.0));
  if (k == 1) return uCols[1];
  if (k == 2) return uCols[2];
  if (k == 3) return uCols[3];
  return uCols[0];
}
// (WebGL2: uniform arrays take a computed index, no 16-way loop per lookup)
float band(float x) { return uBands[int(clamp(x, 0.0, 15.0))]; }
float noise2(vec2 p) { return vnoise(p) * 0.65 + vnoise(p * 2.03 + 17.1) * 0.35; }

void main() {
  vec2 w = vWorld.xz;
  float beat = pow(1.0 - uBeat, 2.2);
  vec2 e2 = abs(w) - uHalf;
  float inside = step(e2.x, 0.0) * step(e2.y, 0.0);
  vec2 g = w * 2.0;
  // (derivatives taken before any branching)
  float fw = fwidth(g.x) + fwidth(g.y);
  vec3 col;
  if (inside > 0.5) {
  // ── the deck: 4x4 LED modules of half-unit diodes, black between the pixels ──
  vec2 pc = floor(g);
  vec2 pf = fract(g) - 0.5;
  vec2 cc = (pc + 0.5) * 0.5;
  float diode = mix(smoothstep(0.5, 0.36, max(abs(pf.x), abs(pf.y))), 0.72, smoothstep(0.3, 0.9, fw));
  vec2 mq = abs(fract(w * 0.25) - 0.5) * 4.0;
  float seam = smoothstep(0.07 + fw * 0.2, 0.0, 2.0 - max(mq.x, mq.y));
  float mh = hash21(floor(w * 0.25));
  col = vec3(0.014, 0.014, 0.022) * (0.8 + 0.4 * mh) + vec3(0.005) * vnoise(w * 0.6);
  col *= 1.0 - seam * 0.6;

  // ── what the LED deck is showing, evaluated per pixel ──
  vec2 q = cc - BST;
  float rb = length(q);
  float sa = fract(atan(q.x, -q.y) / 6.28318 + 1.0);   // 0 toward the stage, clockwise
  vec3 L = vec3(0.0);
  // aurora: slow drifting patches, most of the deck stays black
  float au = noise2(cc * 0.022 + vec2(uTime * 0.03, -uTime * 0.045));
  L += mix(uCols[3], uCols[0], smoothstep(0.5, 0.8, au)) * smoothstep(0.56, 0.82, au) * 0.028 * (0.4 + uEnergy);
  // sound waves rolling off the main stage, one per beat, each in its own colour
  float sd = length(cc - vec2(0.0, -50.0));
  float wph = sd / 14.0 - uBeats;
  float wave = pow(max(0.0, 0.5 + 0.5 * cos(6.28318 * wph)), 18.0) * smoothstep(130.0, 12.0, sd);
  L += pal(floor(-wph + 0.5)) * wave * (0.045 + uEnergy * 0.05 + uDrop * 0.18);
  // the sequencer sunburst: sixteen spokes off the B-stage, quarter notes gold, the playhead white
  float si = floor(sa * 16.0);
  float dA = abs(sa * 16.0 - si - 0.5) * 6.28318 / 16.0 * rb;
  float spoke = smoothstep(0.5, 0.2, dA) * smoothstep(10.8, 11.8, rb);
  float cur = 1.0 - step(0.5, abs(si - floor(uStep)));
  float quarter = 1.0 - step(0.5, mod(si, 4.0));
  float comet = smoothstep(8.0, 0.0, abs(rb - 11.0 - fract(uBeats) * 70.0)) * quarter;
  L += mix(uCols[3] * 0.55, uCols[2], quarter) * spoke * (0.025 + quarter * 0.03 + comet * 0.35 + uHits2.x * 0.25);
  L += vec3(1.0, 0.94, 0.82) * spoke * cur * (0.32 - fract(uStep) * 0.2) * smoothstep(85.0, 11.0, rb);
  // EQ meters grow in from the pit walls: 32 across the south end, 16 up each side (dim bars, hot tips)
  float fromS = uHalf.y - cc.y;
  float cw = uHalf.x / 16.0;
  float bx = abs(cc.x) / cw;
  float lenS = band(floor(bx)) * 15.0 + 0.6;
  float eqS = step(fromS, lenS) * step(abs(fract(bx) - 0.5), 0.36) * step(0.5, mod(pc.y, 3.0));
  float fromE = uHalf.x - abs(cc.x);
  float bz = (cc.y + uHalf.y) / (uHalf.y / 8.0);
  float lenE = band(floor(bz)) * 13.0 + 0.6;
  float eqE = step(fromE, lenE) * step(abs(fract(bz) - 0.5), 0.36) * step(0.5, mod(pc.x, 3.0));
  L += mix(uCols[0], uCols[1], clamp(fromS / 13.0, 0.0, 1.0)) * eqS * (0.035 + step(lenS - 1.1, fromS) * 0.12 + uDrop * 0.08);
  L += mix(uCols[0], uCols[3], clamp(fromE / 11.0, 0.0, 1.0)) * eqE * (0.035 + step(lenE - 1.1, fromE) * 0.12 + uDrop * 0.08);

  // your instruments play the floor
  float pd = length(cc - uPlayer);
  float wpd = length(w - uPlayer);
  // kick: a shock ring runs out through the module seams
  float kr = (1.0 - uHits.x) * 38.0 + 2.0;
  float kick = smoothstep(4.0, 0.0, abs(wpd - kr)) * uHits.x;
  L += uCols[2] * kick * 0.08;
  // snare & clap: a cross of light races out along the rows through the performer
  float reach = (1.0 - uHits.y) * 44.0 + 4.0;
  float xrow = step(abs(cc.y - uPlayer.y), 0.55) * smoothstep(reach, reach - 10.0, abs(cc.x - uPlayer.x));
  float xcol = step(abs(cc.x - uPlayer.x), 0.55) * smoothstep(reach, reach - 10.0, abs(cc.y - uPlayer.y));
  L += uCols[1] * max(xrow, xcol) * uHits.y * 0.85;
  // hats, toms & cowbells: pixels glitter round the performer
  L += vec3(1.0, 0.95, 0.8) * step(0.97, hash21(pc + floor(uTime * 24.0))) * uHits.z * smoothstep(24.0, 3.0, pd);
  // bass, pads & organ: a violet swell underfoot
  L += uCols[3] * uHits.w * smoothstep(18.0, 0.0, pd) * 0.3;
  // crash & gong: the whole deck flashes
  L += mix(uCols[0], vec3(1.0), 0.5) * uHits2.y * 0.2;
  // DROP: chevrons stream off the stage toward the crowd, strobing on the eighths
  float cph = (cc.y - abs(cc.x) * 0.55) * 0.055 - uTime * 1.3;
  L += pal(floor(cph)) * step(0.86, fract(cph)) * uDrop * 0.2 * (0.6 + 0.4 * step(0.5, fract(uBeats * 2.0)));
  // FINALE: the deck turns to gold; every spoke blazes and the pixels glitter
  vec3 fin = uCols[2] * (spoke * (0.3 + comet * 0.6) + wave * 0.35 + step(0.975, hash21(pc + floor(uTime * 12.0))) * 0.35 + 0.012)
           + vec3(1.0, 0.9, 0.7) * spoke * cur * 0.4;
  L = mix(L, fin + L * 0.3, uFinale);
  col += L * diode;
  col += vec3(1.0, 0.85, 0.6) * seam * (kick * 0.3 + uFinale * 0.06 * beat);

  // ── the golden circle: twin brass rings set into the deck, studs chasing round ──
  float rw = length(w - BST);
  float aw = fract(atan(w.x - BST.x, -(w.y - BST.y)) / 6.28318 + 1.0);
  float gring = smoothstep(0.09, 0.03, abs(abs(rw - 27.0) - 0.4));
  col = mix(col, vec3(0.16, 0.11, 0.04) + uCols[2] * (0.1 + beat * 0.14 + uFinale * 0.3), gring * 0.85);
  float stud = smoothstep(0.2, 0.08, length(vec2((fract(aw * 84.0) - 0.5) * 6.28318 * 27.0 / 84.0, rw - 27.0)));
  col += uCols[2] * stud * (0.15 + 0.6 * step(0.8, fract(aw * 6.0 - uBeats * 0.25)));

  // ── the catwalk: mirror-black acrylic, edge strips racing toward the B-stage ──
  float onRun = step(abs(w.x), 3.6) * step(w.y, -16.5) * step(-42.5, w.y);
  vec3 run = vec3(0.008, 0.008, 0.013) + vec3(0.01, 0.01, 0.018) * smoothstep(3.6, 0.0, abs(w.x));
  float redge = smoothstep(0.09, 0.02, abs(abs(w.x) - 3.45));
  float dash = step(0.45, fract(w.y * 0.35 - uTime * 1.8));
  run += mix(mix(uCols[0], vec3(1.0), 0.55), uCols[2], uFinale) * redge * (0.35 + 0.65 * dash) * (0.7 + beat * 0.6);
  float rch = fract((w.y + abs(w.x) * 0.7) * 0.2 - uBeats);
  run += uCols[2] * smoothstep(0.1, 0.0, abs(rch - 0.5) - 0.03) * step(abs(w.x), 3.0) * (0.14 + uDrop * 0.2 + uFinale * 0.3);
  float foot = smoothstep(0.14, 0.05, length(vec2(abs(w.x) - 2.95, (fract(w.y * 0.5) - 0.5) * 2.0)));
  run += vec3(1.0, 0.9, 0.72) * foot * 0.55;
  col = mix(col, run, onRun);

  // ── the B-stage: a round LED stage — radial spectrum round a gold star ──
  float disc = smoothstep(8.05, 7.9, rw);
  vec3 bs = vec3(0.006, 0.006, 0.01) + vec3(0.014, 0.012, 0.022) * pow(max(0.0, 0.5 + 0.5 * sin(rw * 9.0)), 3.0);
  float t32 = aw * 32.0;
  float bb = band(abs(floor(t32) - 15.5));
  float rspec = step(abs(fract(t32) - 0.5), 0.3) * step(3.5, rw) * step(rw, 3.7 + bb * 3.8);
  bs += mix(uCols[0], uCols[1], smoothstep(3.6, 7.5, rw)) * rspec * (0.22 + beat * 0.3);
  float starR = 1.1 + 2.1 * pow(abs(cos(aw * 6.28318 * 4.0)), 6.0);
  float star = smoothstep(0.12, 0.0, rw - starR);
  bs += uCols[2] * star * (0.2 + beat * 0.45 + uFinale * 0.9);
  bs += uCols[2] * smoothstep(0.14, 0.03, abs(rw - 7.85)) * (0.6 + beat * 0.8);
  col = mix(col, bs, disc);
  // sixteen pads ring the B-stage: the playhead lit white, quarter notes gold
  float ta = aw * 16.0;
  float tick = floor(ta);
  float pad = smoothstep(0.42, 0.34, abs(fract(ta) - 0.5)) * smoothstep(0.7, 0.55, abs(rw - 9.4));
  float tcur = 1.0 - step(0.5, abs(tick - floor(uStep)));
  float tq = 1.0 - step(0.5, mod(tick, 4.0));
  col += mix(uCols[3] * 0.25, uCols[2] * 0.6, tq) * pad * (0.5 + beat * 0.3 + uFinale);
  col += vec3(1.0, 0.9, 0.7) * pad * tcur * 0.7;

  // moving-head pools with rotating gobos (near-white with a tint: coloured discs read as paint)
  for (int i = 0; i < 8; i++) {
    vec2 dv = w - uSpots[i].xy;
    float d = length(dv);
    if (d > uSpots[i].z) continue;
    // soft coloured light with a hot core and a turning gobo (grey discs read as objects)
    float pool = smoothstep(uSpots[i].z, uSpots[i].z * 0.55, d);
    float core = smoothstep(uSpots[i].z * 0.6, 0.0, d);
    float ga = atan(dv.y, dv.x + 1e-4) + uTime * (0.5 + float(i) * 0.11);
    float gobo = 0.55 + 0.45 * smoothstep(0.3, 0.8, sin(ga * 5.0) * 0.5 + 0.5 - d / uSpots[i].z * 0.5);
    vec3 sc = uSpotCols[i] / max(0.001, max(uSpotCols[i].r, max(uSpotCols[i].g, uSpotCols[i].b)));
    col += mix(sc, vec3(1.0, 0.95, 0.88), core * 0.5) * pool * gobo * uSpots[i].w;
  }
  // follow spots on the headliner, and the white-hot spill off the stage
  col += vec3(1.0, 0.9, 0.75) * 0.1 * smoothstep(4.5, 0.8, wpd);
  col += vec3(0.8, 0.85, 1.0) * 0.02 * smoothstep(-26.0, -42.0, w.y);

  } else {
    // ── outside the pit: trampled field mats under the crowd ──
    vec2 tm = abs(fract(w / 1.25) - 0.5);
    vec3 field = vec3(0.011, 0.012, 0.013) * (0.55 + noise2(w * 0.25) * 0.9);
    field *= 1.0 - smoothstep(0.44, 0.5, max(tm.x, tm.y)) * 0.5;
    float ed = length(max(e2, 0.0));
    field += mix(uCols[0], uCols[3], 0.5) * 0.05 * smoothstep(6.0, 0.0, ed);
    col = field * smoothstep(280.0, 140.0, length(w));
  }
  float lip = smoothstep(0.3, 0.0, abs(max(e2.x, e2.y)));
  col += mix(mix(uCols[0], uCols[3], 0.5 + 0.5 * sin(w.x * 0.05 + w.y * 0.05 - uTime * 2.0)), uCols[2], uFinale) * lip * (0.5 + beat * 0.7);
  col *= 1.0 - uBuild * 0.7;
  col += ripples(w);
  col = paintOver(col, w);
  gl_FragColor = vec4(col, 1.0);
}`;

/** One beam in the batch and how it moves. */
interface Head {
  o: THREE.Vector3;
  kind: 'pit' | 'sky' | 'wing' | 'laser' | 'follow' | 'search' | 'side' | 'tower';
  /** index among heads of the same kind */
  n: number;
  phase: number;
  col: number;
  /** pit heads: current and target aim point on the deck */
  ax: number;
  az: number;
  tx: number;
  tz: number;
  side: number;
  facing?: THREE.Vector3;
  dir: THREE.Vector3;
}

export class Megafest implements Venue {
  readonly id = 'megafest' as const;
  readonly name = 'MEGAFEST';
  readonly tagline = 'Sixty thousand voices. One golden circle. The last night of the world tour.';
  readonly bpm = 150;
  readonly progression = 'megafest' as const;
  readonly bounds: Bounds = { kind: 'rect', hx: HX, hz: HZ };
  readonly palette: VenuePalette = {
    rim: new THREE.Color(0x9fb8ff),
    floor: new THREE.Color(0x6fd6ff),
    accents: [0x2ee6ff, 0xff2d78, 0xffd36b, 0x8c5aff],
    fog: 0x07050f,
    fogDensity: 0.0032,
    background: 0x030210,
    core: 0xfff4dc,
  };
  readonly group = new THREE.Group();
  /** delay towers standing in the golden circle */
  readonly obstacles: { x: number; z: number; r: number }[] = [
    { x: -30, z: -25, r: 1.9 },
    { x: 30, z: -25, r: 1.9 },
    { x: -30, z: 19, r: 1.9 },
    { x: 30, z: 19, r: 1.9 },
    { x: -55, z: -3, r: 1.9 },
    { x: 55, z: -3, r: 1.9 },
  ];
  private readonly cols: THREE.Color[];
  private readonly floorMat: THREE.ShaderMaterial;
  private readonly rip = new RippleBank();
  private readonly spots = Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, 1, 0));
  private readonly spotCols = Array.from({ length: 8 }, () => new THREE.Color());
  private readonly bands: number[] = new Array(16).fill(0);
  private readonly hits = new THREE.Vector4();
  private readonly hits2 = new THREE.Vector2();
  private readonly leds: THREE.ShaderMaterial[] = [];
  private readonly mainLed: THREE.ShaderMaterial;
  private readonly sideLeds: THREE.ShaderMaterial[] = [];
  private readonly haloLed: THREE.ShaderMaterial;
  private readonly texts = new Map<string, THREE.CanvasTexture>();
  private readonly ownTextures: THREE.Texture[] = [];
  private readonly beams: BeamBatch;
  private readonly heads: Head[] = [];
  private readonly fixtures: THREE.InstancedMesh;
  private readonly lenses: THREE.InstancedMesh;
  private readonly crowdU: CrowdUniforms;
  private readonly drones: DroneSwarm;
  private readonly streamers: Streamers;
  private readonly towers: DelayTower[] = [];
  private readonly towerFade: number[] = [];
  private readonly cranes: Crane[] = [];
  private readonly pyro: THREE.Mesh[] = [];
  private readonly pyroFinale: THREE.Mesh[] = [];
  private readonly pyroMat = makePlumeMaterial(0xff6a14);
  private readonly pyroGold = makePlumeMaterial(0xffb030);
  private readonly co2Mat = makePlumeMaterial(0xcfe8ff, 1);
  private readonly co2: THREE.Mesh[] = [];
  private readonly strobeMat = new THREE.MeshBasicMaterial({ color: 0x202020, toneMapped: false });
  private co2T = 0;
  private strobe = 0;
  private readonly trimMat: THREE.MeshBasicMaterial;
  private readonly signMat: THREE.MeshBasicMaterial;
  private readonly hazeMat: THREE.ShaderMaterial;
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private readonly zero = new THREE.Vector3(0, 0, 0);
  private readonly down = new THREE.Vector3(0, -1, 0);
  private readonly c = new THREE.Color();
  private bars = 0;
  private time = 0;
  private pyroT = 0;
  private finaleOn = false;
  private finaleK = 0;
  private dropOn = false;
  private hot = false;
  private dropMix = 0;
  private flash = 0;
  /** where the performer stands (the pit heads can converge on them) */
  private px = 0;
  private pz = 0;

  constructor() {
    this.cols = this.palette.accents.map((c) => new THREE.Color(c));
    this.floorMat = new THREE.ShaderMaterial({
      vertexShader: FLOOR_VERT,
      fragmentShader: FLOOR_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uBeat: { value: 0 },
        uBeats: { value: 0 },
        uStep: { value: 0 },
        uEnergy: { value: 0 },
        uDrop: { value: 0 },
        uBuild: { value: 0 },
        uFinale: { value: 0 },
        uPlayer: { value: new THREE.Vector2() },
        uHalf: { value: new THREE.Vector2(HX, HZ) },
        uCols: { value: this.cols },
        uSpots: { value: this.spots },
        uSpotCols: { value: this.spotCols },
        uHits: { value: this.hits },
        uHits2: { value: this.hits2 },
        uBands: { value: this.bands },
        ...this.rip.uniforms(),
      },
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), this.floorMat);
    floor.rotation.x = -Math.PI / 2;
    this.group.add(floor);

    this.trimMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x2ee6ff).multiplyScalar(2), toneMapped: false });
    this.buildStage();
    const screens = this.buildScreens();
    this.mainLed = screens.main;
    this.haloLed = screens.halo;
    this.buildRoof();
    this.signMat = this.buildSign();
    this.buildHeads();
    this.buildTowers();
    this.buildCranes();

    // crowd barrier with its LED rail
    const railLed = this.led({ mode: 3, cells: [140, 1], a: 0x2ee6ff, b: 0x8c5aff, c: 0xffffff, gain: 1.4 });
    this.group.add(barricade(HX, HZ, DECK_Z, railLed));

    // the crowd: field + bowl, bodies and the lights they hold, all animated on the GPU
    const rnd = mulberry(1977);
    const ribbon = this.led({ mode: 3, cells: [360, 4], a: 0xff2d78, b: 0x2ee6ff, c: 0xffd36b, gain: 1.2 });
    const bowl = stadium(ribbon, rnd);
    this.group.add(bowl.group);
    const field = this.fieldRavers(rnd);
    const ravers = [...field, ...bowl.ravers];
    this.crowdU = crowdUniforms(this.cols, this.palette.fog, this.palette.fogDensity);
    const crowdMat = makeCrowdMaterial(this.crowdU);
    for (const m of buildCrowd(ravers, crowdMat)) this.group.add(m);
    this.group.add(buildCrowdLights(ravers, this.crowdU));
    // flags waved above the field, thickest along the barrier where the camera can see them
    const flags = field
      .filter((r) => {
        const edge = Math.max(Math.abs(r.x) - HX, r.z - HZ);
        return rnd() < (edge < 12 ? 0.02 : 0.0025);
      })
      .map((r) => ({ x: r.x, z: r.z, seed: rnd(), yaw: -0.4 + (rnd() - 0.5) * 0.8 }));
    this.group.add(buildFlags(flags, this.crowdU));

    // floodlight masts at the corners of the bowl
    const glare = makeGlowMaterial(0xe8f0ff, 0.5);
    for (const [x, z] of [
      [-140, -90],
      [140, -90],
      [-168, 150],
      [168, 150],
    ] as const)
      this.group.add(lightTower(x, z, 46, glare));

    // side stages east and west, angled toward the field
    const sideLed = this.led({ mode: 2, cells: [48, 21], a: 0x8c5aff, b: 0xff2d78, c: 0xffd36b });
    const sideLed2 = this.led({ mode: 2, cells: [48, 21], a: 0x2ee6ff, b: 0x8c5aff, c: 0xffffff });
    for (const [sx, mat] of [
      [-1, sideLed],
      [1, sideLed2],
    ] as const) {
      const ss = sideStage(sx * 104, -44, sx * 20, 30, mat, this.trimMat);
      this.group.add(ss.group);
      ss.heads.forEach((o, i) => this.addHead(o, 'side', this.palette.accents[(i + (sx > 0 ? 2 : 0)) % 4]!, sx, ss.facing));
    }

    // everything that throws light shares one instanced draw; lamp bodies follow their beams
    this.beams = new BeamBatch(this.heads.length);
    this.group.add(this.beams.mesh);
    const fix = merge([box(0.9, 1.1, 0.9, 0, -0.3, 0), box(1.3, 0.25, 0.5, 0, 0.35, 0)]);
    this.fixtures = new THREE.InstancedMesh(fix, M.blackPlastic(), this.heads.length);
    const lensGeo = new THREE.CircleGeometry(0.36, 14);
    lensGeo.rotateX(Math.PI / 2);
    lensGeo.translate(0, -0.87, 0);
    this.lenses = new THREE.InstancedMesh(lensGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), this.heads.length);
    for (let i = 0; i < this.heads.length; i++) this.lenses.setColorAt(i, this.c.setRGB(1, 1, 1));
    this.fixtures.frustumCulled = false;
    this.lenses.frustumCulled = false;
    this.group.add(this.fixtures, this.lenses);

    // the mixing desk out in the field
    const foh = fohRiser(M.glow(0x9fb8ff, 2.5));
    foh.position.set(0, 0, 72);
    this.group.add(foh);

    // drones, streamers, stars, haze
    this.drones = buildDrones(900, this.cols);
    this.group.add(this.drones.mesh);
    const cannons = [-52, -32, -12, 12, 32, 52].map((x) => new THREE.Vector3(x, DECK_H + 1.1, DECK_Z - 1.2));
    this.streamers = buildStreamers(cannons, 240, this.cols);
    this.group.add(this.streamers.mesh);
    this.group.add(buildStars(1400));
    this.hazeMat = makeGlowMaterial(0x6a2fd0, 0.55);
    const haze = new THREE.Mesh(new THREE.PlaneGeometry(420, 170), this.hazeMat);
    haze.position.set(0, 40, -175);
    this.group.add(haze);

    // the few real lights: stadium key, sky/ground fill and two stage washes
    const hemi = new THREE.HemisphereLight(0x8c98ff, 0x14081c, 0.9);
    const key = new THREE.DirectionalLight(0xffffff, 1.8);
    key.position.set(30, 80, 60);
    const washA = new THREE.PointLight(0xff2d78, 260, 80, 1.4);
    washA.position.set(-36, 14, -40);
    const washB = new THREE.PointLight(0x2ee6ff, 260, 80, 1.4);
    washB.position.set(36, 14, -40);
    this.group.add(hemi, key, washA, washB);
  }

  /* ───────────────────────────── construction ───────────────────────────── */

  private led(o: { mode: number; cells: [number, number]; a: number; b: number; c: number; gain?: number }): THREE.ShaderMaterial {
    const m = makeLedMaterial({ ...o, bands: this.bands });
    this.leds.push(m);
    return m;
  }

  private buildStage(): void {
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x15141b, roughness: 0.45, metalness: 0.3 });
    const W = HX + 4;
    const D = 27;
    const parts = [
      box(W - 3.8, DECK_H, D, -(W + 3.8) / 2, DECK_H / 2, DECK_Z - D / 2),
      box(W - 3.8, DECK_H, D, (W + 3.8) / 2, DECK_H / 2, DECK_Z - D / 2),
      box(7.6, DECK_H, D - 4, 0, DECK_H / 2, DECK_Z - 4 - (D - 4) / 2),
    ];
    // stairs from the catwalk up onto the deck
    for (let i = 0; i < 5; i++) {
      const h = ((i + 1) / 5) * DECK_H;
      parts.push(box(7.6, h, 0.8, 0, h / 2, DECK_Z - 0.4 - i * 0.8));
    }
    this.group.add(new THREE.Mesh(merge(parts), deckMat));
    // glowing lip + stair nosings
    const trim: THREE.BufferGeometry[] = [
      box(W - 3.8, 0.1, 0.1, -(W + 3.8) / 2, DECK_H + 0.02, DECK_Z - 0.05),
      box(W - 3.8, 0.1, 0.1, (W + 3.8) / 2, DECK_H + 0.02, DECK_Z - 0.05),
    ];
    for (let i = 0; i < 5; i++) trim.push(box(7.6, 0.06, 0.08, 0, ((i + 1) / 5) * DECK_H + 0.02, DECK_Z - i * 0.8 - 0.04));
    this.group.add(new THREE.Mesh(merge(trim), this.trimMat));
    // LED fascia along the stage front
    const fascia = this.led({ mode: 3, cells: [124, 4], a: 0x8c5aff, b: 0x2ee6ff, c: 0xffd36b, gain: 1.1 });
    for (const sx of [-1, 1]) {
      const f = new THREE.Mesh(new THREE.PlaneGeometry(W - 4.4, 2.0), fascia);
      f.position.set((sx * (W + 3.8)) / 2, DECK_H / 2, DECK_Z + 0.02);
      this.group.add(f);
    }

    // front line: monitor wedges, pyro projectors, streamer cannons
    const dark: THREE.BufferGeometry[] = [];
    const grille: THREE.BufferGeometry[] = [];
    for (const x of [-44, -26, -14, 14, 26, 44]) {
      dark.push(box(2.2, 0.9, 1.3, x, DECK_H + 0.45, DECK_Z - 1.6, 0, -0.45));
      const gr = new THREE.PlaneGeometry(1.9, 0.7);
      gr.rotateX(-0.45);
      gr.translate(x, DECK_H + 0.5, DECK_Z - 0.98);
      grille.push(gr);
    }
    const pyroX = [-62, -50, -38, -20, -7, 7, 20, 38, 50, 62];
    for (const x of pyroX) dark.push(box(1.0, 0.55, 1.0, x, DECK_H + 0.28, DECK_Z - 0.8));
    for (const x of [-52, -32, -12, 12, 32, 52]) {
      dark.push(box(1.4, 0.5, 1.4, x, DECK_H + 0.25, DECK_Z - 1.4));
      const tube = new THREE.CylinderGeometry(0.32, 0.36, 1.8, 12);
      tube.rotateX(0.55);
      tube.translate(x, DECK_H + 1.1, DECK_Z - 1.2);
      dark.push(tube);
    }
    // band gear: drum riser, keys and DJ risers
    dark.push(box(16, 1.2, 5, 0, DECK_H + 0.6, -48.8));
    dark.push(box(9, 1.0, 4, -17, DECK_H + 0.5, -48.3), box(9, 1.0, 4, 17, DECK_H + 0.5, -48.3));
    dark.push(box(5, 1.1, 1.6, -17, DECK_H + 1.55, -48.3), box(5.5, 1.0, 1.8, 17, DECK_H + 1.5, -48.3));
    // subwoofer walls under the wings
    for (const sx of [-1, 1]) for (let i = 0; i < 6; i++) dark.push(box(2.4, 1.6, 2, sx * (30 + i * 2.5), DECK_H + 0.8, -46.5));
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x121117, roughness: 0.5, metalness: 0.3 });
    this.group.add(new THREE.Mesh(merge(dark), darkMat));
    this.group.add(new THREE.Mesh(merge(grille), M.rubber()));
    const glow: THREE.BufferGeometry[] = [];
    for (const x of pyroX) glow.push(box(0.6, 0.04, 0.6, x, DECK_H + 0.57, DECK_Z - 0.8));
    glow.push(box(16, 0.08, 0.08, 0, DECK_H + 1.22, -46.3));
    glow.push(box(9, 0.06, 0.06, -17, DECK_H + 1.02, -46.3), box(9, 0.06, 0.06, 17, DECK_H + 1.02, -46.3));
    for (const x of [-52, -32, -12, 12, 32, 52]) {
      const ring = new THREE.TorusGeometry(0.33, 0.05, 6, 16);
      ring.rotateX(0.55 + Math.PI / 2);
      ring.translate(x, DECK_H + 1.1 + Math.cos(0.55) * 0.9, DECK_Z - 1.2 + Math.sin(0.55) * 0.9);
      glow.push(ring);
    }
    this.group.add(new THREE.Mesh(merge(glow), M.glow(0xffb040, 3)));

    // the house kit on the riser
    const kit: [Parameters<typeof buildInstrument>[0], number, number, number, number][] = [
      ['kick', 0, DECK_H + 2.2, -49.4, 1.5],
      ['snare', -2.6, DECK_H + 2.3, -48.2, 1.0],
      ['hat', -4.4, DECK_H + 3.1, -48.8, 1.0],
      ['crash', 3.6, DECK_H + 4.2, -49.6, 1.3],
      ['tom', 2.4, DECK_H + 3.0, -48.4, 0.9],
      ['gong', 6.2, DECK_H + 3.4, -50.0, 1.3],
    ];
    for (const [id, x, y, z, sc] of kit) {
      const m = buildInstrument(id);
      m.position.set(x, y, z);
      m.scale.multiplyScalar(sc);
      this.group.add(m);
    }

    // pyro plumes (camera-facing sheets) along the lip; the finale adds a line down the catwalk
    const pyroGeo = new THREE.PlaneGeometry(3.6, 13);
    pyroGeo.translate(0, 6.5, 0);
    for (const x of pyroX) {
      const f = new THREE.Mesh(pyroGeo, this.pyroMat);
      f.position.set(x, DECK_H + 0.5, DECK_Z - 0.8);
      f.visible = false;
      this.group.add(f);
      this.pyro.push(f);
    }
    for (const z of [-40, -32, -24]) {
      for (const sx of [-1, 1]) {
        const f = new THREE.Mesh(pyroGeo, this.pyroGold);
        f.position.set(sx * 5.2, 0, z);
        f.scale.setScalar(0.75);
        f.visible = false;
        this.group.add(f);
        this.pyroFinale.push(f);
      }
    }
    // CO2 cryo jets: white blasts on the drops
    const co2Geo = new THREE.PlaneGeometry(6, 11);
    co2Geo.translate(0, 5.5, 0);
    for (const x of [-44, -26, 26, 44]) {
      const f = new THREE.Mesh(co2Geo, this.co2Mat);
      f.position.set(x, DECK_H + 0.4, DECK_Z - 1.0);
      f.visible = false;
      this.group.add(f);
      this.co2.push(f);
    }
    // a row of strobes along the lip
    const strobes: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 28; i++) {
      const x = -66 + i * (132 / 27);
      if (Math.abs(x) < 5) continue;
      strobes.push(box(1.1, 0.22, 0.3, x, DECK_H + 0.14, DECK_Z - 0.25));
    }
    this.group.add(new THREE.Mesh(merge(strobes), this.strobeMat));
  }

  /** Main curved wall, the halo band above it, IMAG side screens. */
  private buildScreens(): { main: THREE.ShaderMaterial; halo: THREE.ShaderMaterial } {
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x0a0a0e, roughness: 0.6, metalness: 0.2 });
    // (sized so the victory camera frames the whole wall: its top edge sits just inside the shot)
    const main = this.led({ mode: 0, cells: [144, 24], a: 0xff2d78, b: 0x2ee6ff, c: 0xffd36b });
    const wall = new THREE.Mesh(curvedPanel(72, 12, 110, 48), main);
    wall.position.set(0, 3.2 + 6, -52);
    this.group.add(wall);
    const back = new THREE.Mesh(curvedPanel(74, 13.4, 110, 48), frameMat);
    back.position.set(0, 3.2 + 6, -52.35);
    this.group.add(back);
    // LED hems along the wall's curved top and bottom, and its two sides
    const hem: THREE.BufferGeometry[] = [];
    const R = 110;
    for (let i = 0; i < 36; i++) {
      const x0 = -36.6 + (i / 36) * 73.2;
      const x1 = -36.6 + ((i + 1) / 36) * 73.2;
      const a = (x0 + x1) / 2 / R;
      const len = x1 - x0 + 0.05;
      for (const y of [2.55, 15.85]) hem.push(box(len, 0.14, 0.14, Math.sin(a) * R, y, -52 + R * (1 - Math.cos(a)) + 0.1, -a));
    }
    for (const sx of [-1, 1]) {
      const a = (sx * 36.6) / R;
      hem.push(box(0.14, 13.3, 0.14, Math.sin(a) * R, 9.2, -52 + R * (1 - Math.cos(a)) + 0.1));
    }
    this.group.add(new THREE.Mesh(merge(hem), this.trimMat));
    const halo = this.led({ mode: 2, cells: [176, 10], a: 0x8c5aff, b: 0x2ee6ff, c: 0xffd36b });
    const band = new THREE.Mesh(curvedPanel(88, 4.6, 110, 48), halo);
    band.position.set(0, 19.2, -53);
    this.group.add(band);
    const bandBack = new THREE.Mesh(curvedPanel(90, 5.6, 110, 48), frameMat);
    bandBack.position.set(0, 19.2, -53.3);
    this.group.add(bandBack);
    for (const sx of [-1, 1]) {
      const m = this.led({ mode: 1, cells: [28, 24], a: 0x8c5aff, b: 0xff2d78, c: 0x2ee6ff });
      this.sideLeds.push(m);
      const s = new THREE.Mesh(new THREE.PlaneGeometry(14, 12), m);
      s.position.set(sx * 46.5, 3.2 + 6, -48);
      s.rotation.y = Math.atan2(-s.position.x, -6 - s.position.z);
      this.group.add(s);
      const f = new THREE.Mesh(new THREE.BoxGeometry(15, 13, 0.6), frameMat);
      f.position.copy(s.position);
      f.rotation.y = s.rotation.y;
      f.translateZ(-0.35);
      this.group.add(f);
      const outline = new THREE.Mesh(
        merge([box(14.9, 0.14, 0.14, 0, 6.45, 0), box(14.9, 0.14, 0.14, 0, -6.45, 0), box(0.14, 13, 0.14, -7.45, 0, 0), box(0.14, 13, 0.14, 7.45, 0, 0)]),
        this.trimMat,
      );
      outline.position.copy(s.position);
      outline.rotation.y = s.rotation.y;
      outline.translateZ(0.05);
      this.group.add(outline);
      // screen legs down to the deck
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.5, 3.6, 0.5), frameMat);
      leg.position.set(s.position.x, DECK_H + 0.5, s.position.z - 0.5);
      this.group.add(leg);
    }
    return { main, halo };
  }

  private buildRoof(): void {
    this.group.add(new THREE.Mesh(stageRoof(HX + 2, -46, -66, ROOF_Y), new THREE.MeshStandardMaterial({ color: 0x4c505c, metalness: 0.9, roughness: 0.35 })));
    // PA: main hangs flanking the wall, out-fills beyond the side screens
    const boxes: THREE.BufferGeometry[] = [];
    const grilles: THREE.BufferGeometry[] = [];
    const hang = (x: number, n: number, top: number): void => {
      for (let i = 0; i < n; i++) {
        const tilt = 0.02 + Math.pow(i / n, 1.6) * 0.5;
        const y = top - i * 1.02;
        const z = -46.5 + Math.sin(tilt) * 0.6;
        boxes.push(box(3.4, 0.95, 2.1, x, y, z, 0, tilt));
        const gr = new THREE.PlaneGeometry(3.2, 0.78);
        gr.rotateX(tilt);
        gr.translate(x, y - Math.sin(tilt) * 1.06, z + Math.cos(tilt) * 1.06);
        grilles.push(gr);
      }
      boxes.push(box(3.8, 0.3, 2.4, x, top + 0.7, -46.5));
      boxes.push(box(0.1, ROOF_Y - top - 0.7, 0.1, x - 1.2, (ROOF_Y + top + 0.7) / 2, -46.5), box(0.1, ROOF_Y - top - 0.7, 0.1, x + 1.2, (ROOF_Y + top + 0.7) / 2, -46.5));
    };
    for (const sx of [-1, 1]) {
      hang(sx * 39.5, 14, 27.5);
      hang(sx * 61, 10, 26);
    }
    this.group.add(new THREE.Mesh(merge(boxes), M.blackPlastic()));
    this.group.add(new THREE.Mesh(merge(grilles), M.rubber()));
    // wing towers: scaffold stacks with vertical LED strips facing the field
    const wing: THREE.BufferGeometry[] = [];
    const wingGlow: THREE.BufferGeometry[] = [];
    for (const sx of [-1, 1]) {
      const x = sx * (HX + 3);
      wing.push(box(6, 38, 6, x, 19, -50));
      for (let k = 0; k < 3; k++) wingGlow.push(box(0.25, 34, 0.12, x - 2 + k * 2, 19, -46.93));
    }
    this.group.add(new THREE.Mesh(merge(wing), new THREE.MeshStandardMaterial({ color: 0x0f0e14, roughness: 0.6, metalness: 0.3 })));
    this.group.add(new THREE.Mesh(merge(wingGlow), this.trimMat));
  }

  /** The festival's name in neon tubes on the roof. */
  private buildSign(): THREE.MeshBasicMaterial {
    const tex = neonTexture('MEGAFEST', '#ffb830');
    this.ownTextures.push(tex);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(46, 8.6), mat);
    sign.position.set(0, ROOF_Y + 5.5, -46);
    this.group.add(sign);
    return mat;
  }

  private addHead(o: THREE.Vector3, kind: Head['kind'], col: number, side = 0, facing?: THREE.Vector3): void {
    const n = this.heads.filter((h) => h.kind === kind).length;
    const h: Head = { o, kind, n, phase: this.heads.length * 0.77, col, ax: 0, az: 0, tx: 0, tz: 0, side, dir: new THREE.Vector3(0, -1, 0) };
    if (facing) h.facing = facing;
    this.heads.push(h);
  }

  private buildHeads(): void {
    const acc = this.palette.accents;
    for (let i = 0; i < 14; i++) {
      const x = -58 + i * (116 / 13);
      this.addHead(new THREE.Vector3(x, ROOF_Y - 1.1, -46), 'pit', acc[i % 4]!);
      const h = this.heads[this.heads.length - 1]!;
      h.ax = h.tx = x * 0.8;
      h.az = h.tz = -10 + (i % 3) * 12;
    }
    for (let i = 0; i < 10; i++) this.addHead(new THREE.Vector3(-54 + i * 12, ROOF_Y - 1.1, -56), 'sky', acc[(i + 1) % 4]!);
    for (const sx of [-1, 1]) for (let i = 0; i < 4; i++) this.addHead(new THREE.Vector3(sx * (HX + 3), 12 + i * 7, -46.5), 'wing', acc[(i + 2) % 4]!, sx);
    for (let i = 0; i < 12; i++) this.addHead(new THREE.Vector3(-11 + i * 2, ROOF_Y - 1.5, -45.5), 'laser', i % 2 ? 0x2ee6ff : 0xff2d78);
    for (const sx of [-1, 1]) this.addHead(new THREE.Vector3(sx * 22, ROOF_Y - 1.1, -46), 'follow', 0xfff0d8, sx);
    for (const [x, y, z] of [
      [-140, 52, -90],
      [140, 52, -90],
      [-168, 52, 150],
      [168, 52, 150],
      [-40, ROOF_Y + 2, -66],
      [40, ROOF_Y + 2, -66],
    ] as const)
      this.addHead(new THREE.Vector3(x, y, z), 'search', 0xdfe8ff);
  }

  private buildTowers(): void {
    const banner = bannerTexture();
    this.ownTextures.push(banner);
    this.obstacles.forEach((o, i) => {
      const t = delayTower(this.palette.accents[i % 4]!, banner, o.r);
      t.group.position.set(o.x, 0, o.z);
      this.group.add(t.group);
      this.towers.push(t);
      this.towerFade.push(1);
      // the tower's follow-spot: dark all set, it crowns the B-stage for the encore
      this.addHead(new THREE.Vector3(o.x + 0.4, 13.3, o.z - 1.1), 'tower', 0xfff0d0);
    });
  }

  private buildCranes(): void {
    for (const sx of [-1, 1]) {
      const cr = cameraCrane();
      cr.group.position.set(sx * 58, DECK_H, DECK_Z - 2.2);
      this.group.add(cr.group);
      this.cranes.push(cr);
    }
  }

  /** The field: packed from the barrier back to the stands, thinning toward the back. */
  private fieldRavers(rnd: () => number): Raver[] {
    const out: Raver[] = [];
    const sp = 1.2;
    for (let z = -70; z < 108; z += sp) {
      for (let x = -126; x < 126; x += sp) {
        const px = x + (rnd() - 0.5) * 0.7;
        const pz = z + (rnd() - 0.5) * 0.7;
        // keep clear of the pit, the stage, the side stages and the mixing desk
        if (Math.abs(px) < HX + 3.4 && pz < HZ + 3.4) continue;
        if (Math.abs(px) < HX + 12 && pz < -40) continue;
        if (Math.hypot(Math.abs(px) - 104, pz + 44) < 20) continue;
        if (Math.abs(px) < 9 && pz > 62 && pz < 82) continue;
        const back = Math.max(0, (pz - 60) / 60) + Math.max(0, (Math.abs(px) - 100) / 40);
        if (rnd() < back * 0.35) continue;
        const add = (x: number, z: number): void => {
          const r = rnd();
          out.push({
            x,
            y: 0,
            z,
            yaw: Math.atan2(x, -45 - z) + (rnd() - 0.5) * 0.5,
            seed: rnd(),
            lit: r < 0.16 ? 1 : r < 0.46 ? 2 : 0,
          });
        };
        add(px, pz);
        // the crush at the barrier: the front rows pack in twice as tight
        const edge = Math.max(Math.abs(px) - HX, pz - HZ);
        if (edge < 11 && rnd() < 0.75) add(px + Math.sign(px) * 0.6, pz + 0.6);
      }
    }
    return out;
  }

  /** Chunky pixel lettering, cached per message. */
  private text(msg: string, w: number, h: number, font: number, repeat = false): THREE.CanvasTexture {
    const key = `${msg}|${w}|${h}`;
    let t = this.texts.get(key);
    if (!t) {
      t = ledText(msg, w, h, font, repeat);
      this.texts.set(key, t);
    }
    return t;
  }

  /* ───────────────────────────── the show ───────────────────────────── */

  ripple(x: number, z: number, color: THREE.Color | number, strength = 1): void {
    this.rip.add(x, z, this.floorMat.uniforms.uTime!.value as number, color, strength);
  }

  setBar(b: number): void {
    this.bars = b;
    this.floorMat.uniforms.uBeats!.value = b * 4;
    this.floorMat.uniforms.uStep!.value = (b - Math.floor(b)) * 16;
  }

  onStep(step: number, bar: number): void {
    // moving heads snap to a new look every bar, every beat when the room goes off
    if (step === 0 || (this.hot && step % 4 === 0)) this.retarget(bar * 16 + step);
    if (step === 0) {
      if (bar % 8 === 0 || this.dropOn) this.pyroT = 0.6;
      if ((this.dropOn && bar % 4 === 0) || (this.finaleOn && bar % 2 === 0)) this.fireStreamers(bar % 2 ? 1 : 0);
      if ((this.dropOn && bar % 2 === 1) || (this.finaleOn && bar % 2 === 1)) this.co2T = 0.9;
    }
    if (this.finaleOn && step % 4 === 0) this.pyroT = Math.max(this.pyroT, 0.32);
    // strobes: a hit every four bars, eighths in a drop, every beat for the encore
    if ((this.dropOn && step % 2 === 0) || (this.finaleOn && step % 4 === 0) || (step === 0 && bar % 4 === 0)) this.strobe = 1;
  }

  onNote(inst: string, strength: number): void {
    const h = this.hits;
    const k = Math.min(1, strength);
    if (inst === 'kick') h.x = Math.max(h.x, k);
    else if (inst === 'snare' || inst === 'clap') h.y = Math.max(h.y, k);
    else if (inst === 'hat' || inst === 'tom' || inst === 'cowbell' || inst === 'scratch') h.z = Math.min(1, h.z + k * 0.8);
    else if (inst === 'bass' || inst === 'pad' || inst === 'organ') h.w = Math.max(h.w, k);
    else if (inst === 'lead') this.hits2.x = Math.max(this.hits2.x, k);
    else if (inst === 'crash' || inst === 'gong') this.hits2.y = Math.max(this.hits2.y, k);
    if (inst === 'kick' || inst === 'crash') this.flash = Math.max(this.flash, k);
  }

  finale(): void {
    if (this.finaleOn) return;
    this.finaleOn = true;
    this.pyroT = 0.9;
    this.fireStreamers(0);
    this.fireStreamers(1);
    this.retarget(0);
  }

  /** Streamer cannons: set 0 = the outer four, set 1 = the inner pair and the ends. */
  private fireStreamers(set: number): void {
    const f = this.streamers.fire;
    const pick = set === 0 ? [0, 1, 4, 5] : [2, 3, 0, 5];
    pick.forEach((i, k) => (f[i] = this.time + k * 0.06));
  }

  /** New aim points for the pit heads: scatter, sweep, converge on the performer, or a fan. */
  private retarget(seed: number): void {
    const pattern = this.finaleOn ? 4 : Math.floor(seed / 16) % 4;
    const pit = this.heads.filter((h) => h.kind === 'pit');
    pit.forEach((h, i) => {
      const k = Math.sin((seed + 1) * 12.9898 + i * 78.233) * 43758.5453;
      const r = k - Math.floor(k);
      const r2 = (r * 7.31) % 1;
      if (pattern === 0) {
        h.tx = (r - 0.5) * HX * 1.7;
        h.tz = (r2 - 0.5) * HZ * 1.6;
      } else if (pattern === 1) {
        h.tx = -HX * 0.85 + (i / (pit.length - 1)) * HX * 1.7;
        h.tz = (Math.floor(seed / 16) % 2 ? -1 : 1) * HZ * 0.45;
      } else if (pattern === 2) {
        // a ring round the performer (not piled on them: the fight has to stay readable)
        const a = (i / pit.length) * Math.PI * 2;
        h.tx = this.px + Math.cos(a) * 10;
        h.tz = this.pz + Math.sin(a) * 10;
      } else if (pattern === 3) {
        h.tx = (i - 6.5) * 9;
        h.tz = -34 + Math.abs(i - 6.5) * 6;
      } else {
        // finale: a ring of light round the B-stage that turns a notch on every beat
        const a = (i / pit.length) * Math.PI * 2 + seed * 0.1;
        h.tx = BST.x + Math.cos(a) * 16;
        h.tz = BST.y + Math.sin(a) * 16;
      }
    });
  }

  update(f: FrameInfo): void {
    const dt = f.dt;
    this.time = f.time;
    this.px = f.playerX;
    this.pz = f.playerZ;
    const beats = this.bars * 4;
    const beat = Math.pow(1 - f.beatPhase, 3);
    const drop = f.drop || this.finaleOn;
    if (f.drop && !this.dropOn) {
      this.fireStreamers(0);
      this.retarget(Math.floor(beats) * 4);
      this.co2T = 1.2;
    }
    this.dropOn = f.drop;
    this.hot = drop;
    this.finaleK = damp(this.finaleK, this.finaleOn ? 1 : 0, 1.6, dt);
    this.dropMix = damp(this.dropMix, f.drop && !this.finaleOn ? 1 : 0, 1.2, dt);
    for (let i = 0; i < 16; i++) this.bands[i] = this.bands[i]! * 0.6 + (f.spectrum[i] ?? 0) * 0.4;
    // instrument hits fade
    this.hits.x *= Math.exp(-dt * 3.2);
    this.hits.y *= Math.exp(-dt * 3.0);
    this.hits.z *= Math.exp(-dt * 9);
    this.hits.w *= Math.exp(-dt * 2.5);
    this.hits2.x *= Math.exp(-dt * 4);
    this.hits2.y *= Math.exp(-dt * 2.2);
    this.flash *= Math.exp(-dt * 6);

    const u = this.floorMat.uniforms;
    u.uTime!.value = f.time;
    u.uBeat!.value = f.beatPhase;
    u.uEnergy!.value = f.energy;
    u.uDrop!.value = f.drop ? 1 : 0;
    u.uBuild!.value = f.build;
    u.uFinale!.value = this.finaleK;
    (u.uPlayer!.value as THREE.Vector2).set(f.playerX, f.playerZ);

    // screens
    for (const m of this.leds) {
      const lu = m.uniforms;
      lu.uTime!.value = f.time;
      lu.uBeat!.value = f.beatPhase;
      lu.uBeats!.value = beats;
      lu.uDrop!.value = f.drop ? 1 : 0;
      lu.uEnergy!.value = f.energy;
      lu.uFinale!.value = this.finaleK;
    }
    this.updateTexts(f, beats);

    // crowd
    const cu = this.crowdU;
    cu.uTime.value = f.time;
    cu.uBeats.value = beats;
    cu.uHype.value = damp(cu.uHype.value, Math.min(1, 0.25 + f.energy * 0.55 + (f.drop ? 0.5 : 0)), 2, dt);
    cu.uFinale.value = this.finaleK;
    cu.uFlash.value = this.flash;

    // drones
    const du = this.drones.material.uniforms;
    du.uTime!.value = f.time;
    du.uBeats!.value = beats;
    du.uMixB!.value = this.dropMix;
    du.uMixC!.value = this.finaleK;

    // streamers, stars, haze
    this.streamers.material.uniforms.uTime!.value = f.time;
    this.hazeMat.uniforms.uOpacity!.value = 0.4 + beat * 0.15 + (drop ? 0.25 : 0);
    (this.hazeMat.uniforms.uColor!.value as THREE.Color).setHex(this.finaleOn ? 0xb07020 : 0x6a2fd0);

    // trims and the sign pulse with the kick
    this.trimMat.color
      .setHex(this.finaleOn ? 0xffd36b : this.palette.accents[Math.floor(beats / 4) % 4]!)
      .multiplyScalar(1.4 + beat * 1.6);
    this.signMat.color.setScalar(0.8 + beat * 0.5 + (drop ? 0.3 : 0));

    this.updateBeams(f, beat, drop);
    this.updateProps(f, beat);
  }

  private updateTexts(f: FrameInfo, beats: number): void {
    const main = this.mainLed.uniforms;
    let msg: string | null = null;
    let col = 0xffffff;
    if (this.finaleOn) {
      msg = 'ENCORE!';
      col = 0xffb020;
    } else if (f.drop) {
      msg = 'DROP!';
      col = 0xff2d78;
    } else if (Math.floor(beats / 4) % 8 === 7) {
      msg = 'MEGAFEST';
      col = 0xffd36b;
    }
    if (msg) {
      main.uText!.value = this.text(msg, 288, 48, 34);
      (main.uTextCol!.value as THREE.Color).setHex(col);
    }
    main.uTextAmt!.value = damp(main.uTextAmt!.value as number, msg ? 1 : 0, msg ? 8 : 5, f.dt);
    // IMAG screens spell WORLD TOUR for the finale
    this.sideLeds.forEach((m, i) => {
      const su = m.uniforms;
      if (this.finaleOn) {
        su.uText!.value = this.text(i === 0 ? 'WORLD' : 'TOUR', 56, 48, i === 0 ? 13 : 17);
        (su.uTextCol!.value as THREE.Color).setHex(0xffc040);
      }
      su.uTextAmt!.value = damp(su.uTextAmt!.value as number, this.finaleOn ? 1 : 0, 6, f.dt);
    });
    // the halo band and the ribbon boards run a marquee all night
    const marquee = this.finaleOn ? 'THANK YOU WORLD • ENCORE •' : 'MEGAFEST • WORLD TOUR • FINAL NIGHT •';
    const hu = this.haloLed.uniforms;
    hu.uText!.value = this.text(marquee, 352, 20, 15, true);
    (hu.uTextScroll!.value as THREE.Vector3).set(1, 0.05, 1);
    (hu.uTextCol!.value as THREE.Color).setHex(this.finaleOn ? 0xffd36b : 0xffffff);
    hu.uTextAmt!.value = 0.9;
  }

  private updateBeams(f: FrameInfo, beat: number, drop: boolean): void {
    const t = f.time;
    const acc = this.palette.accents;
    const bar = Math.floor(this.bars);
    const gold = this.finaleOn;
    let spot = 0;
    this.heads.forEach((h, i) => {
      const dir = h.dir;
      let len: number;
      let rad: number;
      let k: number;
      let col: number;
      if (h.kind === 'pit') {
        const snap = drop ? 12 : 5;
        h.ax = damp(h.ax, h.tx, snap, f.dt);
        h.az = damp(h.az, h.tz, snap, f.dt);
        const sx = h.ax + Math.sin(t * 0.9 + h.phase) * 2.5;
        const sz = h.az + Math.cos(t * 0.7 + h.phase) * 2.5;
        dir.set(sx - h.o.x, -h.o.y, sz - h.o.z);
        len = dir.length();
        dir.divideScalar(len);
        rad = len * 0.05;
        col = gold ? (i % 3 === 0 ? 0xffffff : 0xffc850) : acc[(i + bar) % 4]!;
        k = 0.06 + f.energy * 0.06 + beat * 0.04 + (drop ? 0.1 : 0);
        // eight of them paint gobo pools on the deck
        if (i % 2 === 0 || i === 13) {
          if (spot < 8) {
            this.spots[spot]!.set(sx, sz, rad * 1.1, gold ? 0.16 : 0.05 + f.energy * 0.04 + (drop ? 0.06 : 0));
            this.spotCols[spot]!.setHex(gold ? 0xffb030 : col);
            spot++;
          }
        }
      } else if (h.kind === 'sky') {
        const fan = (h.n - 4.5) * 0.12 + Math.sin(t * (drop ? 1.6 : 0.5) + h.phase) * 0.35;
        const tilt = 0.35 + 0.25 * Math.sin(t * 0.6 + h.phase * 1.7);
        dir.set(Math.sin(fan) * Math.sin(tilt), Math.cos(tilt), Math.cos(fan) * Math.sin(tilt) * 0.9 + 0.15).normalize();
        len = 170;
        rad = 4.5;
        col = gold ? 0xffd36b : acc[(i + bar) % 4]!;
        k = 0.05 + beat * 0.04 + (drop ? 0.07 : 0);
      } else if (h.kind === 'wing') {
        const a = Math.sin(t * 0.45 + h.phase) * 0.7;
        dir.set(h.side * Math.cos(a) * 0.8, 0.1 + Math.sin(t * 0.3 + h.phase) * 0.35, Math.sin(a) * 0.8 + 0.4).normalize();
        len = 130;
        rad = 5;
        col = gold ? 0xffd36b : h.col;
        k = 0.05 + (drop ? 0.06 : 0);
      } else if (h.kind === 'laser') {
        const j = h.n;
        const sp = drop ? 1.8 : 0.55;
        const yaw = (j - 5.5) * 0.17 + Math.sin(t * sp * 1.3 + j * 0.4) * 0.45;
        const el = 0.12 + 0.12 * (0.5 + 0.5 * Math.sin(t * sp + j));
        dir.set(Math.sin(yaw) * Math.cos(el), -Math.sin(el), Math.cos(yaw) * Math.cos(el));
        len = 190;
        rad = 0.1;
        col = gold ? (j % 3 === 0 ? 0xffffff : 0xffd36b) : h.col;
        // lasers sit back until the room heats up
        k = (drop ? 0.7 : 0.06 + Math.max(0, f.energy - 0.4) * 0.3) * (0.6 + beat * 0.4);
      } else if (h.kind === 'follow') {
        dir.set(f.playerX - h.o.x, 0.6 - h.o.y, f.playerZ - h.o.z);
        len = dir.length();
        dir.divideScalar(len);
        rad = 2.4;
        col = gold ? 0xffe0a0 : h.col;
        k = 0.05;
      } else if (h.kind === 'tower') {
        // trained on the stage all night; at the encore they swing onto the B-stage
        const tx = gold ? BST.x + Math.sin(t * 0.9 + h.phase) * 2.5 : h.o.x * 0.6;
        const tz = gold ? BST.y + Math.cos(t * 0.8 + h.phase) * 2.5 : -46;
        dir.set(tx - h.o.x, (gold ? 0 : 6) - h.o.y, tz - h.o.z);
        len = dir.length();
        dir.divideScalar(len);
        rad = 3.2;
        col = 0xffe6b0;
        k = gold ? 0.2 * this.finaleK : 0;
      } else if (h.kind === 'search') {
        const a = t * 0.25 + h.phase * 2.1;
        dir.set(Math.sin(a) * 0.45, 1, Math.cos(a * 0.8) * 0.45).normalize();
        len = 260;
        rad = 7;
        col = gold ? 0xffe0a0 : h.col;
        k = 0.05;
      } else {
        const fc = h.facing!;
        const a = Math.sin(t * (drop ? 1.4 : 0.5) + h.phase) * 0.6;
        dir.set(fc.x * 0.6 + Math.cos(a) * fc.z * 0.5, 0.45 + 0.2 * Math.sin(t * 0.7 + h.phase), fc.z * 0.6 - Math.cos(a) * fc.x * 0.5).normalize();
        len = 110;
        rad = 3.5;
        col = gold ? 0xffd36b : h.col;
        k = 0.06 + (drop ? 0.05 : 0);
      }
      this.beams.set(i, h.o, dir, len, rad, col, k);
      // lamp bodies follow their beams
      this.q.setFromUnitVectors(this.down, dir);
      // (tower spots already have a lamp modelled on the tower)
      this.m4.compose(h.o, this.q, h.kind === 'tower' ? this.zero : this.one);
      this.fixtures.setMatrixAt(i, this.m4);
      this.lenses.setMatrixAt(i, this.m4);
      this.lenses.setColorAt(i, this.c.setHex(col).multiplyScalar(1.5 + k * 8));
    });
    for (; spot < 8; spot++) this.spots[spot]!.w = 0;
    this.beams.commit(t);
    this.fixtures.instanceMatrix.needsUpdate = true;
    this.lenses.instanceMatrix.needsUpdate = true;
    if (this.lenses.instanceColor) this.lenses.instanceColor.needsUpdate = true;
  }

  private updateProps(f: FrameInfo, beat: number): void {
    const t = f.time;
    // delay towers: beacons blink, collars pulse
    this.towers.forEach((tw, i) => {
      tw.beacon.color.setHex(0xff2020).multiplyScalar(Math.sin(t * 3 + i) > 0.6 ? 3 : 0.25);
      tw.glow.color.setHex(this.finaleOn ? 0xffd36b : this.palette.accents[i % 4]!).multiplyScalar(1.3 + beat * 1.4);
    });
    // camera jibs swing over the front of the pit
    this.cranes.forEach((cr, i) => {
      const s = i ? -1 : 1;
      cr.arm.rotation.y = s * (0.55 + Math.sin(t * 0.23 + i * 2) * 0.5);
      cr.arm.rotation.x = -0.12 + Math.sin(t * 0.31 + i) * 0.1;
      cr.tally.color.setHex(Math.sin(t * 0.5 + i * 3) > 0 ? 0xff2030 : 0x301010);
    });
    // pyro: the jet leaps up, then the fireball lifts off and fades
    this.pyroT = Math.max(this.pyroT - f.dt, f.drop && beat > 0.9 ? 0.3 : 0);
    const fire = this.pyroT > 0 ? Math.min(1, this.pyroT * 3) : 0;
    for (const m of [this.pyroMat, this.pyroGold]) {
      m.uniforms.uTime!.value = t;
      m.uniforms.uPower!.value = fire;
    }
    for (const p of this.pyro) {
      p.visible = fire > 0.01;
      if (f.camQuat) p.quaternion.copy(f.camQuat);
    }
    for (const p of this.pyroFinale) {
      p.visible = this.finaleOn && fire > 0.01;
      if (f.camQuat) p.quaternion.copy(f.camQuat);
    }
    this.co2T = Math.max(0, this.co2T - f.dt);
    const blast = Math.min(1, this.co2T * 1.6);
    this.co2Mat.uniforms.uTime!.value = t;
    this.co2Mat.uniforms.uPower!.value = blast;
    for (const p of this.co2) {
      p.visible = blast > 0.01;
      if (f.camQuat) p.quaternion.copy(f.camQuat);
    }
    this.strobe *= Math.exp(-f.dt * 16);
    this.strobeMat.color.setScalar(0.08 + this.strobe * 6);
  }

  occlude(px: number, pz: number): void {
    // a tower hides the deck just "north" of it on screen: ghost it while the performer is there
    this.obstacles.forEach((o, i) => {
      const hidden = Math.abs(px - o.x) < 3.6 && pz < o.z + 1.5 && pz > o.z - 10.5;
      const cur = this.towerFade[i]!;
      const next = cur + ((hidden ? 0.18 : 1) - cur) * 0.15;
      this.towerFade[i] = next;
      for (const m of this.towers[i]!.mats) {
        m.opacity = next;
        m.depthWrite = next > 0.9;
      }
    });
  }

  spawnPoint(rng: Rng, px: number, pz: number, out: { x: number; z: number }): void {
    ringSpawn(this.bounds, this.obstacles, rng, px, pz, out);
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.Points) o.geometry.dispose();
    });
    for (const t of this.texts.values()) t.dispose();
    for (const t of this.ownTextures) t.dispose();
  }
}
