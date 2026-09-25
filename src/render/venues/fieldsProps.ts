import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildInstrument, buildSpeakerStack } from '../instrumentModels';
import { canvasTexture, M } from '../materials';

/**
 * Set dressing for SUNSET FIELDS: festoon bulbs, bunting, hay bales, the stage, food trucks,
 * the crowd, a ferris wheel, pollen and fireworks. Everything repeated is instanced and every
 * animation runs in a shader off one shared clock, so the field costs a handful of draw calls.
 */

/** Deterministic layout randomness: the field is mown the same way every night. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniforms every animated prop shares by reference: the venue writes them once a frame. */
export interface FieldClock {
  uTime: THREE.IUniform<number>;
  /** beat phase 0..1 (0 = on the beat) */
  uBeat: THREE.IUniform<number>;
  /** sequencer position 0..16, continuous */
  uStep: THREE.IUniform<number>;
  uKick: THREE.IUniform<number>;
  uHat: THREE.IUniform<number>;
  uDrop: THREE.IUniform<number>;
  uFinale: THREE.IUniform<number>;
  uBuild: THREE.IUniform<number>;
  uFlash: THREE.IUniform<number>;
  uJump: THREE.IUniform<number>;
}

export function makeClock(): FieldClock {
  const u = (): THREE.IUniform<number> => ({ value: 0 });
  return {
    uTime: u(),
    uBeat: u(),
    uStep: u(),
    uKick: u(),
    uHat: u(),
    uDrop: u(),
    uFinale: u(),
    uBuild: u(),
    uFlash: u(),
    uJump: u(),
  };
}

/** Everything the venue has to free on the way out. */
export interface Bag {
  textures: THREE.Texture[];
  materials: THREE.Material[];
}

const own = <T extends THREE.Material>(bag: Bag, m: T): T => {
  bag.materials.push(m);
  return m;
};
const ownTex = <T extends THREE.Texture>(bag: Bag, t: T): T => {
  bag.textures.push(t);
  return t;
};

/** Interleaved-gradient noise: a screen-door dither that needs no sorting. */
const IGN = /* glsl */ `float fieldIgn(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }`;

/** Screen-door fade on a lit material (props dissolve when they hide the player). */
export function addFade(m: THREE.MeshStandardMaterial, fade: THREE.IUniform<number>, key: string): void {
  m.onBeforeCompile = (s) => {
    s.uniforms.uFade = fade;
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uFade;\n${IGN}`)
      .replace(
        '#include <clipping_planes_fragment>',
        '#include <clipping_planes_fragment>\n  if (uFade < 0.999 && fieldIgn(gl_FragCoord.xy) > uFade) discard;',
      );
  };
  m.customProgramCacheKey = () => key;
}

/* ───────────────────────────── strings of things ───────────────────────────── */

/** A hanging string: straight line minus a parabola (close enough to a catenary). */
export function sagPoint(a: THREE.Vector3, b: THREE.Vector3, t: number, droop: number, out: THREE.Vector3): THREE.Vector3 {
  out.lerpVectors(a, b, t);
  out.y -= droop * 4 * t * (1 - t);
  return out;
}

const BULB_VERT = /* glsl */ `
attribute vec4 aInfo; // t along its string, string id, kind, seed
uniform float uTime;
uniform float uBeat;
uniform float uStep;
uniform float uKick;
uniform float uDrop;
uniform float uFinale;
uniform float uBuild;
uniform float uFlash;
uniform vec3 uPal[4];
varying vec3 vCol;
varying vec3 vN;
varying vec3 vV;
vec3 pal(float i) {
  float k = mod(floor(i), 4.0);
  return k < 0.5 ? uPal[0] : k < 1.5 ? uPal[1] : k < 2.5 ? uPal[2] : uPal[3];
}
void main() {
  float t = aInfo.x;
  float sid = aInfo.y;
  float kind = aInfo.z;
  float seed = aInfo.w;
  float beat = pow(1.0 - uBeat, 3.0);
  vec3 col = vec3(1.0, 0.56, 0.22);
  float b = 1.45 + 0.25 * sin(uTime * 1.7 + seed * 40.0);
  if (kind < 0.5) {
    // maypole strings: a pulse runs out from the mast on every beat
    b += 2.2 * smoothstep(0.09, 0.0, abs(t - uBeat)) * (1.0 - 0.5 * uBeat);
  } else if (kind < 1.5) {
    // the rope line keeps time: a comet laps the field once a bar, a step per sixteenth
    float d = fract(uStep / 16.0 - t);
    float comet = exp(-d * 22.0);
    b += 4.2 * comet;
    col = mix(col, vec3(1.0, 0.9, 0.7), comet);
  } else if (kind < 2.5) {
    b += beat * 0.45;
  } else if (kind < 3.5) {
    // ferris wheel rim: candy colours chasing round
    col = pal(t * 32.0);
    b = 0.5 + 2.0 * pow(0.5 + 0.5 * sin((t * 4.0 - uStep / 8.0) * 6.28318), 6.0);
  } else {
    // spokes: the one under the playhead burns, a ring runs out from the hub on the beat
    col = vec3(1.0, 0.84, 0.6);
    float cur = 1.0 - step(0.5, abs(sid - floor(uStep)));
    b = 0.3 + cur * 2.4 + 1.3 * smoothstep(0.14, 0.0, abs(t - uBeat));
  }
  b += uKick * 0.5;
  // DROP: sixteenth-note strobe, the strings trade colours every beat
  float on = mod(floor(seed * 97.0) + floor(uStep), 2.0);
  col = mix(col, pal(sid + floor(uStep / 4.0)), uDrop);
  b = mix(b, 0.25 + on * 3.4, uDrop);
  // finale: everything gold and twinkling
  col = mix(col, vec3(1.0, 0.8, 0.4), uFinale);
  b = mix(b, 2.3 + 1.3 * sin(uTime * 11.0 + seed * 60.0), uFinale);
  b += uFlash * (kind > 2.5 ? 2.5 : 0.6);
  b *= 1.0 - uBuild * 0.8;
  vCol = col * b;
#ifdef USE_INSTANCING
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
#else
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
#endif
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const BULB_FRAG = /* glsl */ `
varying vec3 vCol;
varying vec3 vN;
varying vec3 vV;
void main() {
  float f = max(dot(normalize(vN), normalize(vV)), 0.0);
  gl_FragColor = vec4(vCol * (0.35 + 1.1 * f * f), 1.0);
}`;

export const BULB = { mast: 0, fence: 1, steady: 2, rim: 3, spoke: 4 } as const;

export function makeBulbMaterial(clock: FieldClock, palette: number[]): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: clock.uTime,
      uBeat: clock.uBeat,
      uStep: clock.uStep,
      uKick: clock.uKick,
      uDrop: clock.uDrop,
      uFinale: clock.uFinale,
      uBuild: clock.uBuild,
      uFlash: clock.uFlash,
      uPal: { value: palette.map((c) => new THREE.Color(c)) },
    },
    vertexShader: BULB_VERT,
    fragmentShader: BULB_FRAG,
  });
}

/** Collects light bulbs, then becomes one instanced mesh. */
export class BulbBatch {
  private readonly pos: number[] = [];
  private readonly info: number[] = [];

  add(x: number, y: number, z: number, t: number, sid: number, kind: number, seed: number): void {
    this.pos.push(x, y, z);
    this.info.push(t, sid, kind, seed);
  }

  get count(): number {
    return this.pos.length / 3;
  }

  build(mat: THREE.Material, r = 0.12): THREE.InstancedMesh {
    const n = this.count;
    const geo = new THREE.SphereGeometry(r, 10, 8);
    geo.setAttribute('aInfo', new THREE.InstancedBufferAttribute(new Float32Array(this.info), 4));
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < n; i++) {
      m4.makeTranslation(this.pos[i * 3]!, this.pos[i * 3 + 1]!, this.pos[i * 3 + 2]!);
      mesh.setMatrixAt(i, m4);
    }
    mesh.computeBoundingSphere();
    return mesh;
  }
}

/** Collects wires and ropes, then merges them into one mesh. */
export class WireBatch {
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly tmp = new THREE.Vector3();

  add(a: THREE.Vector3, b: THREE.Vector3, droop: number, radius = 0.022, segs = 16): void {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= segs; i++) pts.push(sagPoint(a, b, i / segs, droop, this.tmp).clone());
    this.geos.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), segs * 2, radius, 4, false));
  }

  build(mat: THREE.Material): THREE.Mesh {
    const g = mergeGeometries(this.geos) ?? new THREE.BufferGeometry();
    for (const x of this.geos) x.dispose();
    return new THREE.Mesh(g, mat);
  }
}

/** Bunting: triangle pennants hung along strings, fluttering in a vertex shader. */
export class BuntingBatch {
  private readonly mats: THREE.Matrix4[] = [];
  private readonly cols: THREE.Color[] = [];

  addLine(a: THREE.Vector3, b: THREE.Vector3, droop: number, spacing: number, colors: number[], size = 1, phase = 0): void {
    const len = a.distanceTo(b);
    const n = Math.max(1, Math.floor(len / spacing));
    const tan = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize();
    const up = new THREE.Vector3(0, 1, 0);
    const nor = new THREE.Vector3().crossVectors(tan, up);
    const p = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      sagPoint(a, b, (i + 0.5) / n, droop, p);
      const m = new THREE.Matrix4().makeBasis(tan, up, nor).scale(new THREE.Vector3(size, size, size)).setPosition(p);
      this.mats.push(m);
      this.cols.push(new THREE.Color(colors[(i + phase) % colors.length]!));
    }
  }

  /** One flag at a given spot, pointing its tip along `dir` (a streamer on a mast). */
  addFlag(p: THREE.Vector3, dir: THREE.Vector3, color: number, sx: number, sy: number): void {
    const x = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
    const y = dir.clone().normalize().negate();
    const z = new THREE.Vector3().crossVectors(x, y).normalize();
    this.mats.push(new THREE.Matrix4().makeBasis(x, y, z).scale(new THREE.Vector3(sx, sy, 1)).setPosition(p));
    this.cols.push(new THREE.Color(color));
  }

  build(clock: FieldClock, bag: Bag): THREE.InstancedMesh {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.2, 0, 0, 0.2, 0, 0, 0, -0.44, 0], 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    const mat = own(bag, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, side: THREE.DoubleSide }));
    mat.onBeforeCompile = (s) => {
      s.uniforms.uTime = clock.uTime;
      s.uniforms.uBeat = clock.uBeat;
      s.uniforms.uDrop = clock.uDrop;
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uBeat;\nuniform float uDrop;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
  float seed = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
  float hang = -position.y;
  float kick = pow(1.0 - uBeat, 3.0);
  transformed.z += sin(uTime * (3.0 + uDrop * 5.0) + seed * 6.28 + hang * 4.0) * hang * (0.5 + kick * 0.3);
  transformed.x += sin(uTime * 2.3 + seed * 9.0) * hang * 0.1;`,
        );
      s.fragmentShader = s.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * 0.18;',
      );
    };
    mat.customProgramCacheKey = () => 'fields-flag';
    const mesh = new THREE.InstancedMesh(geo, mat, this.mats.length);
    this.mats.forEach((m, i) => {
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, this.cols[i]!);
    });
    mesh.computeBoundingSphere();
    return mesh;
  }
}

/* ───────────────────────────── hay bales ───────────────────────────── */

export const BALE_R = 0.85;
export const BALE_W = 1.24;

/** A round bale: a lathed drum with a slight belly and rolled-over edges (axis = local Y). */
export function baleGeometry(): THREE.BufferGeometry {
  const R = BALE_R;
  const H = BALE_W / 2;
  const pts: [number, number][] = [
    [0.001, -H],
    [R * 0.5, -H],
    [R - 0.1, -H + 0.004],
    [R - 0.035, -H + 0.035],
    [R - 0.004, -H + 0.11],
    [R + 0.02, -H * 0.4],
    [R + 0.025, 0],
    [R + 0.02, H * 0.4],
    [R - 0.004, H - 0.11],
    [R - 0.035, H - 0.035],
    [R - 0.1, H - 0.004],
    [R * 0.5, H],
    [0.001, H],
  ];
  return new THREE.LatheGeometry(
    pts.map(([x, y]) => new THREE.Vector2(x, y)),
    40,
  );
}

const STRAW_GLSL = /* glsl */ `
float strawH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float strawN(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(strawH(i), strawH(i + vec2(1.0, 0.0)), u.x), mix(strawH(i + vec2(0.0, 1.0)), strawH(i + vec2(1.0, 1.0)), u.x), u.y);
}
vec3 straw(vec3 p, float seed) {
  float r = length(p.xz);
  float a = atan(p.z, p.x);
  vec3 dark = vec3(0.2, 0.11, 0.035);
  vec3 gold = vec3(0.62, 0.4, 0.13);
  vec3 pale = vec3(0.86, 0.66, 0.3);
  // barrel: straw streaks wrapped round the drum
  float s1 = strawN(vec2(a * 34.0 + seed * 10.0, p.y * 7.0));
  float s2 = strawN(vec2(a * 110.0, p.y * 26.0 + seed * 5.0));
  float streak = s1 * 0.6 + s2 * 0.4;
  vec3 barrel = mix(dark, mix(gold, pale, smoothstep(0.45, 0.8, streak)), smoothstep(0.12, 0.5, streak));
  // net wrap: faint pale bands
  barrel = mix(barrel, vec3(0.8, 0.76, 0.62), smoothstep(0.03, 0.0, abs(fract(p.y * 4.0 + 0.5) - 0.5) - 0.46) * 0.35);
  // ends: the rolled spiral, darker at the core
  float spiral = fract(r * 8.0 - a / 6.28318);
  float rings = smoothstep(0.0, 0.2, spiral) * smoothstep(1.0, 0.55, spiral);
  vec3 face = mix(dark, mix(gold, pale, strawN(vec2(a * 18.0, r * 30.0))), 0.3 + 0.7 * rings);
  face *= 0.55 + 0.45 * smoothstep(0.0, 0.5, r);
  float end = smoothstep(0.5, 0.58, abs(p.y));
  vec3 col = mix(barrel, face, end);
  // weathered: a grey-brown cast on some bales
  return mix(col, col * vec3(0.8, 0.78, 0.8), step(0.7, seed) * 0.5);
}`;

/** Golden straw, shaded procedurally in object space, with a per-bale dither fade. */
export function makeBaleMaterial(bag: Bag): THREE.MeshStandardMaterial {
  const m = own(bag, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 }));
  m.onBeforeCompile = (s) => {
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aBale;\nvarying vec2 vBale;\nvarying vec3 vObj;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vObj = position;\n  vBale = aBale;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec2 vBale;\nvarying vec3 vObj;\n${IGN}\n${STRAW_GLSL}`)
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
  if (vBale.x < 0.999 && fieldIgn(gl_FragCoord.xy) > vBale.x) discard;
  diffuseColor.rgb *= straw(vObj, vBale.y);`,
      );
  };
  m.customProgramCacheKey = () => 'fields-bale';
  return m;
}

/* ───────────────────────────── textures ───────────────────────────── */

export function stripeTexture(bag: Bag, a: string, b: string, n: number, w = 512, h = 64): THREE.CanvasTexture {
  return ownTex(
    bag,
    canvasTexture(w, h, (g) => {
      for (let i = 0; i < n; i++) {
        g.fillStyle = i % 2 ? b : a;
        g.fillRect((i * w) / n, 0, w / n + 1, h);
      }
      // sun-faded canvas
      const grd = g.createLinearGradient(0, 0, 0, h);
      grd.addColorStop(0, 'rgba(255,240,220,0.1)');
      grd.addColorStop(1, 'rgba(60,20,10,0.18)');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
    }),
  );
}

/** A scalloped valance (alpha cut) in alternating colours. */
export function valanceTexture(bag: Bag, cols: string[], n: number): THREE.CanvasTexture {
  return ownTex(
    bag,
    canvasTexture(1024, 96, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      const sw = w / n;
      for (let i = 0; i < n; i++) {
        g.fillStyle = cols[i % cols.length]!;
        g.beginPath();
        g.moveTo(i * sw, 0);
        g.lineTo((i + 1) * sw, 0);
        g.lineTo((i + 1) * sw, h * 0.45);
        g.arc((i + 0.5) * sw, h * 0.45, sw / 2, 0, Math.PI, false);
        g.closePath();
        g.fill();
      }
      g.fillStyle = '#f7ead0';
      g.fillRect(0, 0, w, h * 0.12);
    }),
  );
}

/** Hand-painted sign board with a ring of marquee dots. */
export function signTexture(bag: Bag, text: string, sub: string, bg: string, fg: string, w = 512, h = 160): THREE.CanvasTexture {
  return ownTex(
    bag,
    canvasTexture(w, h, (g) => {
      g.fillStyle = bg;
      g.fillRect(0, 0, w, h);
      g.strokeStyle = fg;
      g.lineWidth = 6;
      g.strokeRect(10, 10, w - 20, h - 20);
      g.fillStyle = '#fff3c4';
      const step = 22;
      for (let x = 22; x < w - 14; x += step) {
        g.beginPath();
        g.arc(x, 20, 4, 0, Math.PI * 2);
        g.arc(x, h - 20, 4, 0, Math.PI * 2);
        g.fill();
      }
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = fg;
      g.shadowColor = 'rgba(0,0,0,0.35)';
      g.shadowBlur = 6;
      let size = sub ? h * 0.42 : h * 0.5;
      g.font = `${size}px Bungee, Impact, sans-serif`;
      while (g.measureText(text).width > w - 60 && size > 12) {
        size -= 2;
        g.font = `${size}px Bungee, Impact, sans-serif`;
      }
      g.fillText(text, w / 2, sub ? h * 0.43 : h / 2 + 2);
      if (sub) {
        g.font = `600 ${h * 0.14}px "Space Grotesk", sans-serif`;
        g.fillText(sub, w / 2, h * 0.73);
      }
    }),
  );
}

function planksTexture(bag: Bag, rnd: () => number): THREE.CanvasTexture {
  const t = canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = '#3a2412';
    g.fillRect(0, 0, w, h);
    const rows = 8;
    const ph = h / rows;
    for (let r = 0; r < rows; r++) {
      let x = -rnd() * 200;
      while (x < w) {
        const len = 140 + rnd() * 220;
        g.fillStyle = `hsl(${20 + rnd() * 10}, ${30 + rnd() * 12}%, ${17 + rnd() * 11}%)`;
        g.fillRect(x + 1, r * ph + 1.5, len - 2, ph - 3);
        g.strokeStyle = 'rgba(30,14,4,0.3)';
        for (let k = 0; k < 5; k++) {
          const yy = r * ph + 4 + rnd() * (ph - 8);
          g.beginPath();
          g.moveTo(x, yy);
          g.bezierCurveTo(x + len * 0.3, yy + (rnd() - 0.5) * 6, x + len * 0.6, yy + (rnd() - 0.5) * 6, x + len, yy);
          g.stroke();
        }
        x += len;
      }
    }
  });
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return ownTex(bag, t);
}

/* ───────────────────────────── the stage ───────────────────────────── */

export interface StageRig {
  group: THREE.Group;
  lens: THREE.MeshBasicMaterial;
  light: THREE.PointLight;
  /** front eave corners: the rope-line festoons tie on here */
  corners: [THREE.Vector3, THREE.Vector3];
}

/** A wooden bandstand with a striped canopy, painted backdrop and the house kit. */
export function buildStage(bag: Bag, rnd: () => number, z0: number): StageRig {
  const g = new THREE.Group();
  const DW = 30;
  const DD = 11;
  const DH = 1.4;
  const EAVE = 8.2;
  const RIDGE = 10.6;
  const OV = 6.3; // roof half-depth (overhang past the posts)
  const wood = M.darkWood();
  const planks = planksTexture(bag, rnd);
  planks.repeat.set(4, 1.6);
  const deckTop = own(bag, new THREE.MeshStandardMaterial({ map: planks, roughness: 0.7 }));
  const skirtTex = ownTex(
    bag,
    canvasTexture(2048, 112, (c, w, h) => {
      c.fillStyle = '#23122a';
      c.fillRect(0, 0, w, h);
      // painted bunting along the skirt
      const cols = ['#ff6b5a', '#ffc23d', '#2ec4b6', '#f4ead5', '#ff7eb6', '#9d7cff'];
      for (let i = 0; i < 64; i++) {
        c.fillStyle = cols[i % cols.length]!;
        c.beginPath();
        c.moveTo(i * 32, 0);
        c.lineTo(i * 32 + 30, 0);
        c.lineTo(i * 32 + 15, 26);
        c.fill();
      }
      c.font = '44px Bungee, Impact, sans-serif';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillStyle = '#ffd98a';
      c.shadowColor = '#ff4f8b';
      c.shadowBlur = 12;
      c.fillText('★ SUNSET FIELDS ★ LIVE ON THE GREEN ★ SUNSET FIELDS ★', w / 2, h * 0.64);
    }),
  );
  const skirt = own(bag, new THREE.MeshStandardMaterial({ map: skirtTex, emissive: 0xffffff, emissiveMap: skirtTex, emissiveIntensity: 0.35, roughness: 0.8 }));
  const deck = new THREE.Mesh(new THREE.BoxGeometry(DW, DH, DD), [wood, wood, deckTop, wood, skirt, wood]);
  deck.position.set(0, DH / 2, z0);
  g.add(deck);
  // steps up to the deck, stage left
  for (let i = 0; i < 3; i++) {
    const st = new THREE.Mesh(new THREE.BoxGeometry(2.4, DH * ((i + 1) / 3), 0.5), wood);
    st.position.set(-9, (DH * ((i + 1) / 3)) / 2, z0 + DD / 2 + 1.25 - i * 0.5);
    g.add(st);
  }

  // posts and eave beams
  const postGeo = new THREE.BoxGeometry(0.34, EAVE - DH, 0.34);
  for (const x of [-DW / 2 + 0.3, DW / 2 - 0.3])
    for (const z of [z0 - DD / 2 + 0.3, z0 + DD / 2 - 0.3]) {
      const p = new THREE.Mesh(postGeo, wood);
      p.position.set(x, DH + (EAVE - DH) / 2, z);
      g.add(p);
    }
  for (const z of [z0 - DD / 2 + 0.3, z0 + DD / 2 - 0.3]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(DW, 0.3, 0.3), wood);
    beam.position.set(0, EAVE - 0.2, z);
    g.add(beam);
  }

  // striped canopy: a gable roof, stripes running down the slopes
  const stripe = stripeTexture(bag, '#f3e3c3', '#e2504a', 26, 1024, 32);
  const roofMat = own(bag, new THREE.MeshStandardMaterial({ map: stripe, roughness: 0.85, side: THREE.DoubleSide }));
  const slope = Math.atan2(RIDGE - EAVE, OV);
  const L = Math.hypot(OV, RIDGE - EAVE);
  for (const s of [1, -1]) {
    const roof = new THREE.Mesh(new THREE.PlaneGeometry(DW + 1.6, L), roofMat);
    roof.rotation.x = s > 0 ? -(Math.PI / 2 - slope) : -(Math.PI / 2 + slope);
    roof.position.set(0, (EAVE + RIDGE) / 2, z0 + (s * OV) / 2);
    g.add(roof);
  }
  const ridge = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, DW + 1.8, 8), wood);
  ridge.rotation.z = Math.PI / 2;
  ridge.position.set(0, RIDGE + 0.05, z0);
  g.add(ridge);
  // gable ends
  const gable = new THREE.Shape();
  gable.moveTo(-OV, 0);
  gable.lineTo(OV, 0);
  gable.lineTo(0, RIDGE - EAVE);
  gable.closePath();
  const gableGeo = new THREE.ShapeGeometry(gable);
  const gableMat = own(bag, new THREE.MeshStandardMaterial({ color: 0xe8d6b4, roughness: 0.85, side: THREE.DoubleSide }));
  for (const s of [-1, 1]) {
    const gm = new THREE.Mesh(gableGeo, gableMat);
    gm.rotation.y = Math.PI / 2;
    gm.position.set((s * (DW + 1.6)) / 2, EAVE, z0);
    g.add(gm);
  }
  // scalloped valance all the way round
  const val = valanceTexture(bag, ['#e2504a', '#f3e3c3', '#ffb13d', '#f3e3c3'], 28);
  const valMat = own(bag, new THREE.MeshStandardMaterial({ map: val, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85 }));
  const valFront = new THREE.Mesh(new THREE.PlaneGeometry(DW + 1.6, 0.95), valMat);
  valFront.position.set(0, EAVE - 0.47, z0 + OV);
  g.add(valFront);
  const valBack = valFront.clone();
  valBack.position.z = z0 - OV;
  g.add(valBack);
  const valSideGeo = new THREE.PlaneGeometry(OV * 2, 0.95);
  for (const s of [-1, 1]) {
    const v = new THREE.Mesh(valSideGeo, valMat);
    v.rotation.y = Math.PI / 2;
    v.position.set((s * (DW + 1.6)) / 2, EAVE - 0.47, z0);
    g.add(v);
  }

  // painted backdrop: a retro sunset over hills
  const poster = ownTex(
    bag,
    canvasTexture(1024, 250, (c, w, h) => {
      const bg = c.createLinearGradient(0, 0, 0, h);
      bg.addColorStop(0, '#2a1240');
      bg.addColorStop(0.55, '#a8386a');
      bg.addColorStop(1, '#ff8a4a');
      c.fillStyle = bg;
      c.fillRect(0, 0, w, h);
      const cx = w / 2;
      const cy = h * 0.97;
      const r = h * 0.4;
      const sg = c.createLinearGradient(0, cy - r, 0, cy);
      sg.addColorStop(0, '#ffe46b');
      sg.addColorStop(1, '#ff4f8b');
      c.fillStyle = sg;
      c.beginPath();
      c.arc(cx, cy, r, Math.PI, 0);
      c.fill();
      c.fillStyle = bg;
      for (let i = 0; i < 6; i++) c.fillRect(cx - r, cy - 8 - i * 17, r * 2, 7 - i);
      c.fillStyle = '#2a1030';
      c.beginPath();
      c.moveTo(0, h);
      for (let x = 0; x <= w; x += 16) c.lineTo(x, h - 20 - Math.sin(x * 0.012) * 10 - Math.sin(x * 0.041) * 4);
      c.lineTo(w, h);
      c.fill();
      c.font = '58px Bungee, Impact, sans-serif';
      c.textAlign = 'center';
      c.fillStyle = '#fff1d6';
      c.shadowColor = '#ff4f8b';
      c.shadowBlur = 18;
      c.fillText('SUNSET FIELDS', cx, h * 0.52);
    }),
  );
  const backdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(DW - 0.8, EAVE - DH - 0.5),
    own(bag, new THREE.MeshStandardMaterial({ map: poster, emissive: 0xffffff, emissiveMap: poster, emissiveIntensity: 0.55, roughness: 0.9 })),
  );
  backdrop.position.set(0, DH + (EAVE - DH - 0.5) / 2, z0 - DD / 2 + 0.2);
  g.add(backdrop);

  // par cans under the front beam
  const lens = own(bag, new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb870).multiplyScalar(2) }));
  const canGeo = new THREE.CylinderGeometry(0.24, 0.3, 0.55, 12);
  const lensGeo = new THREE.CircleGeometry(0.22, 12);
  for (let i = 0; i < 7; i++) {
    const x = -9 + i * 3;
    const can = new THREE.Mesh(canGeo, M.blackPlastic());
    can.position.set(x, EAVE - 0.7, z0 + DD / 2 - 0.3);
    can.rotation.x = 0.7;
    g.add(can);
    const l = new THREE.Mesh(lensGeo, lens);
    l.position.set(x, EAVE - 0.92, z0 + DD / 2 - 0.12);
    l.rotation.x = Math.PI / 2 + 0.7;
    g.add(l);
  }

  // the house kit, a mic stand and wedges
  const kit: [Parameters<typeof buildInstrument>[0], number, number, number, number][] = [
    ['kick', 0, DH + 1.0, z0 - 1.6, 1.2],
    ['snare', -2.1, DH + 1.1, z0 - 0.6, 0.9],
    ['hat', -3.6, DH + 1.9, z0 - 1.2, 0.9],
    ['crash', 3.1, DH + 3.0, z0 - 1.8, 1.0],
    ['tom', 2.0, DH + 1.8, z0 - 0.8, 0.8],
  ];
  for (const [id, x, y, z, sc] of kit) {
    const m = buildInstrument(id);
    m.position.set(x, y, z);
    m.scale.multiplyScalar(sc);
    g.add(m);
  }
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.9, 8), M.chrome());
  stand.position.set(0, DH + 1.45, z0 + 3.2);
  g.add(stand);
  const standBase = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.55, 0.1, 18), M.blackPlastic());
  standBase.position.set(0, DH + 0.05, z0 + 3.2);
  g.add(standBase);
  const wedgeGeo = new THREE.BoxGeometry(1.8, 0.7, 1.1);
  for (const x of [-4.5, 4.5]) {
    const wdg = new THREE.Mesh(wedgeGeo, M.blackPlastic());
    wdg.position.set(x, DH + 0.35, z0 + 4.1);
    wdg.rotation.x = -0.4;
    g.add(wdg);
  }
  for (const s of [-1, 1]) {
    const stack = buildSpeakerStack(3, 0xffa02e);
    stack.position.set(s * (DW / 2 + 2.2), 0, z0 + 2.6);
    stack.rotation.y = -s * 0.2;
    g.add(stack);
  }

  const light = new THREE.PointLight(0xffa860, 70, 34, 1.5);
  light.position.set(0, 6.2, z0 + 2.5);
  g.add(light);

  return {
    group: g,
    lens,
    light,
    corners: [new THREE.Vector3(-(DW + 1.6) / 2, EAVE - 0.95, z0 + OV), new THREE.Vector3((DW + 1.6) / 2, EAVE - 0.95, z0 + OV)],
  };
}

/* ───────────────────────────── food trucks & tents ───────────────────────────── */

export interface TruckSpec {
  name: string;
  sub: string;
  body: number;
  trim: number;
  stripeA: string;
  stripeB: string;
  sign: string;
}

/** A food truck with its hatch lit and awning propped: local +z is the serving side. */
export function buildFoodTruck(bag: Bag, spec: TruckSpec, bulbs: BulbBatch, x: number, z: number, rotY: number, sid: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = rotY;
  g.updateMatrixWorld(true);
  const bodyMat = own(bag, new THREE.MeshStandardMaterial({ color: spec.body, roughness: 0.45, metalness: 0.1 }));
  const trimMat = own(bag, new THREE.MeshStandardMaterial({ color: spec.trim, roughness: 0.5 }));
  const white = own(bag, new THREE.MeshStandardMaterial({ color: 0xf2ece2, roughness: 0.5 }));
  const box = (w: number, h: number, d: number, px: number, py: number, pz: number, m: THREE.Material): THREE.Mesh => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(px, py, pz);
    g.add(mesh);
    return mesh;
  };
  box(6.2, 2.7, 2.5, -0.4, 1.9, 0, bodyMat);
  box(1.6, 2.1, 2.4, 3.5, 1.6, 0, bodyMat);
  box(0.05, 0.85, 2.1, 4.31, 2.05, 0, M.blackPlastic());
  box(6.3, 0.16, 2.6, -0.4, 3.33, 0, white);
  box(6.24, 0.3, 2.54, -0.4, 0.95, 0, trimMat);
  box(1.64, 0.3, 2.44, 3.5, 0.95, 0, trimMat);
  box(0.2, 0.25, 2.5, 4.36, 0.7, 0, M.chrome());
  const wheelGeo = new THREE.CylinderGeometry(0.46, 0.46, 0.34, 16);
  for (const wx of [-2.3, 2.9])
    for (const wz of [-1.15, 1.15]) {
      const wh = new THREE.Mesh(wheelGeo, M.rubber());
      wh.rotation.x = Math.PI / 2;
      wh.position.set(wx, 0.46, wz);
      g.add(wh);
    }
  // lit hatch: counter, shelves, a cook
  const hatchTex = ownTex(
    bag,
    canvasTexture(256, 96, (c, w, h) => {
      const grd = c.createLinearGradient(0, 0, 0, h);
      grd.addColorStop(0, '#ffd9a0');
      grd.addColorStop(1, '#ff9a4a');
      c.fillStyle = grd;
      c.fillRect(0, 0, w, h);
      c.fillStyle = 'rgba(90,40,20,0.55)';
      c.fillRect(0, 22, w, 5);
      c.fillRect(0, 46, w, 5);
      for (let i = 0; i < 14; i++) c.fillRect(8 + i * 17, 10, 9, 12);
      c.fillStyle = '#3a1a14';
      c.beginPath();
      c.arc(w * 0.62, 50, 13, 0, Math.PI * 2);
      c.fill();
      c.fillRect(w * 0.62 - 20, 62, 40, 40);
    }),
  );
  const hatchMat = own(bag, new THREE.MeshBasicMaterial({ map: hatchTex, color: new THREE.Color(1.6, 1.6, 1.6) }));
  const hatch = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.2), hatchMat);
  hatch.position.set(-0.6, 2.2, 1.26);
  g.add(hatch);
  box(3.7, 0.08, 0.42, -0.6, 1.58, 1.42, M.chrome());
  // propped awning with a scalloped edge
  const phi = 0.28;
  const awning = new THREE.Mesh(
    new THREE.PlaneGeometry(3.9, 1.5),
    own(bag, new THREE.MeshStandardMaterial({ map: stripeTexture(bag, spec.stripeA, spec.stripeB, 10), roughness: 0.8, side: THREE.DoubleSide })),
  );
  const hinge = new THREE.Vector3(-0.6, 2.9, 1.26);
  const dir = new THREE.Vector3(0, Math.sin(phi), Math.cos(phi));
  awning.rotation.x = Math.PI / 2 - phi;
  awning.position.copy(hinge).addScaledVector(dir, 0.75);
  g.add(awning);
  const edge = hinge.clone().addScaledVector(dir, 1.5);
  const val = new THREE.Mesh(
    new THREE.PlaneGeometry(3.9, 0.36),
    own(bag, new THREE.MeshStandardMaterial({ map: valanceTexture(bag, [spec.stripeA, spec.stripeB], 12), alphaTest: 0.5, side: THREE.DoubleSide })),
  );
  val.position.set(edge.x, edge.y - 0.18, edge.z);
  g.add(val);
  for (const sx of [-1.6, 1.6]) {
    const a = new THREE.Vector3(sx - 0.6, 2.0, 1.26);
    const b = new THREE.Vector3(sx - 0.6, edge.y, edge.z);
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, a.distanceTo(b), 5), M.chrome());
    strut.position.copy(a).add(b).multiplyScalar(0.5);
    strut.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    g.add(strut);
  }
  const wp = new THREE.Vector3();
  for (let i = 0; i < 9; i++) {
    wp.set(-0.6 - 1.85 + i * (3.7 / 8), edge.y - 0.04 - Math.sin((i / 8) * Math.PI) * 0.12, edge.z + 0.02);
    g.localToWorld(wp);
    bulbs.add(wp.x, wp.y, wp.z, i / 8, sid, BULB.steady, (i * 0.37 + sid) % 1);
  }
  // roof sign, tipped back so it reads from above
  const signTex = signTexture(bag, spec.name, spec.sub, spec.sign, '#fff4dc');
  const signMat = own(bag, new THREE.MeshStandardMaterial({ map: signTex, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 0.7, roughness: 0.6 }));
  const sign = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.06, 0.12), [white, white, white, white, signMat, white]);
  sign.position.set(-0.4, 4.05, 0.55);
  sign.rotation.x = -0.55;
  g.add(sign);
  box(0.12, 0.6, 0.12, -0.4, 3.6, 0.3, white);
  return g;
}

/** A pop-up gazebo: striped pyramid roof, a trestle table, a lantern. */
export function buildGazebo(bag: Bag, name: string, stripeA: string, stripeB: string, bulbs: BulbBatch, x: number, z: number, rotY: number, sid: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.rotation.y = rotY;
  g.updateMatrixWorld(true);
  const S = 1.7;
  const legGeo = new THREE.CylinderGeometry(0.05, 0.05, 2.4, 6);
  for (const lx of [-S, S])
    for (const lz of [-S, S]) {
      const leg = new THREE.Mesh(legGeo, M.chrome());
      leg.position.set(lx, 1.2, lz);
      g.add(leg);
    }
  const roofTex = stripeTexture(bag, stripeA, stripeB, 16);
  const roof = new THREE.Mesh(
    new THREE.ConeGeometry(S * Math.SQRT2 + 0.15, 1.3, 4, 1, true),
    own(bag, new THREE.MeshStandardMaterial({ map: roofTex, roughness: 0.85, side: THREE.DoubleSide })),
  );
  roof.rotation.y = Math.PI / 4;
  roof.position.y = 2.4 + 0.65;
  g.add(roof);
  const valMat = own(bag, new THREE.MeshStandardMaterial({ map: valanceTexture(bag, [stripeA, stripeB], 10), alphaTest: 0.5, side: THREE.DoubleSide }));
  const valGeo = new THREE.PlaneGeometry(S * 2 + 0.2, 0.34);
  for (let k = 0; k < 4; k++) {
    const v = new THREE.Mesh(valGeo, valMat);
    const a = (k * Math.PI) / 2;
    v.position.set(Math.sin(a) * (S + 0.1), 2.3, Math.cos(a) * (S + 0.1));
    v.rotation.y = a;
    g.add(v);
  }
  const table = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.08, 0.8), M.wood());
  table.position.set(0, 0.9, S - 0.3);
  g.add(table);
  const cloth = new THREE.Mesh(new THREE.BoxGeometry(2.84, 0.7, 0.04), own(bag, new THREE.MeshStandardMaterial({ color: 0xf4ead5, roughness: 0.9 })));
  cloth.position.set(0, 0.55, S + 0.1);
  g.add(cloth);
  const signTex = signTexture(bag, name, '', '#2a1a30', stripeB === '#f4ead5' ? stripeA : stripeB, 512, 128);
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, 0.6),
    own(bag, new THREE.MeshStandardMaterial({ map: signTex, emissive: 0xffffff, emissiveMap: signTex, emissiveIntensity: 0.6 })),
  );
  sign.position.set(0, 2.0, S + 0.16);
  sign.rotation.x = -0.35;
  g.add(sign);
  const wp = new THREE.Vector3();
  for (let k = 0; k < 4; k++)
    for (let i = 0; i < 5; i++) {
      const a = (k * Math.PI) / 2;
      const u = -S + (i + 0.5) * ((2 * S) / 5);
      wp.set(Math.sin(a) * (S + 0.14) + Math.cos(a) * u, 2.44, Math.cos(a) * (S + 0.14) - Math.sin(a) * u);
      g.localToWorld(wp);
      bulbs.add(wp.x, wp.y, wp.z, i / 4, sid, BULB.steady, (k * 5 + i) * 0.13);
    }
  wp.set(0.9, 1.15, S - 0.3);
  g.localToWorld(wp);
  bulbs.add(wp.x, wp.y, wp.z, 0, sid, BULB.steady, 0.5);
  return g;
}

/* ───────────────────────────── the entrance arch ───────────────────────────── */

export function buildArch(bag: Bag, bulbs: BulbBatch, z: number, fade: THREE.IUniform<number>): THREE.Group {
  const g = new THREE.Group();
  const wood = own(bag, new THREE.MeshStandardMaterial({ color: 0x5a3a20, roughness: 0.6 }));
  addFade(wood, fade, 'fields-fade');
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.42, 5.6, 0.42), wood);
    post.position.set(s * 3.4, 2.8, z);
    g.add(post);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(8.2, 0.36, 0.4), wood);
  beam.position.set(0, 5.3, z);
  g.add(beam);
  const tex = signTexture(bag, 'SUNSET FIELDS', '·  OPEN-AIR  ·  ALL NIGHT  ·', '#2a1630', '#ffd98a', 768, 192);
  const signMat = own(bag, new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.8, roughness: 0.7 }));
  addFade(signMat, fade, 'fields-fade');
  const board = new THREE.Mesh(new THREE.BoxGeometry(6.8, 1.7, 0.14), [wood, wood, wood, wood, signMat, wood]);
  board.position.set(0, 6.3, z + 0.1);
  board.rotation.x = -0.55;
  g.add(board);
  board.updateMatrixWorld(true);
  const wp = new THREE.Vector3();
  for (let i = 0; i < 16; i++) {
    const u = (i / 15) * 6.8 - 3.4;
    for (const y of [0.92, -0.92]) {
      wp.set(u, y, 0.1);
      board.localToWorld(wp);
      bulbs.add(wp.x, wp.y, wp.z, i / 15, 90, BULB.steady, (i * 0.31) % 1);
    }
  }
  return g;
}

/* ───────────────────────────── the crowd ───────────────────────────── */

export interface Person {
  x: number;
  z: number;
  ry: number;
  s: number;
  /** 0 standing, 1 arm up, 2 sitting */
  kind: 0 | 1 | 2;
}

function stripToPN(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(ng.attributes)) if (k !== 'position' && k !== 'normal') ng.deleteAttribute(k);
  return ng;
}

function personGeometry(kind: 0 | 1 | 2): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  if (kind === 2) {
    const body = new THREE.CapsuleGeometry(0.25, 0.4, 3, 8);
    body.scale(1.2, 1, 0.85);
    body.translate(0, 0.55, 0);
    const head = new THREE.SphereGeometry(0.21, 10, 8);
    head.translate(0, 1.24, 0);
    parts.push(body, head);
    for (const s of [-1, 1]) {
      const leg = new THREE.CapsuleGeometry(0.12, 0.55, 2, 6);
      leg.rotateX(Math.PI / 2);
      leg.translate(s * 0.14, 0.16, 0.36);
      parts.push(leg);
    }
  } else {
    // broad shoulders tapering to the legs, a head clear of the collar
    const body = new THREE.CapsuleGeometry(0.25, 0.92, 3, 8);
    body.scale(1.3, 1, 0.8);
    const p = body.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      const k = 0.72 + 0.28 * THREE.MathUtils.smoothstep(y, -0.5, 0.35);
      p.setX(i, p.getX(i) * k);
    }
    body.computeVertexNormals();
    body.translate(0, 0.72, 0);
    const head = new THREE.SphereGeometry(0.22, 10, 8);
    head.translate(0, 1.7, 0);
    parts.push(body, head);
    const armL = new THREE.CapsuleGeometry(0.075, 0.62, 2, 5);
    armL.rotateZ(-0.14);
    armL.translate(-0.38, 1.02, 0);
    parts.push(armL);
    const armR = new THREE.CapsuleGeometry(0.075, 0.66, 2, 5);
    if (kind === 1) {
      armR.rotateZ(0.35);
      armR.translate(0.42, 1.8, 0);
    } else {
      armR.rotateZ(0.14);
      armR.translate(0.38, 1.02, 0);
    }
    parts.push(armR);
  }
  return mergeGeometries(parts.map(stripToPN)) ?? new THREE.BufferGeometry();
}

/** Silhouettes against the low sun: bobbing on the beat in the vertex shader, rimmed in peach. */
export function buildCrowd(bag: Bag, people: Person[], clock: FieldClock, rnd: () => number): THREE.Group {
  const g = new THREE.Group();
  const tones = [0x2a1e30, 0x1e2536, 0x362222, 0x223026, 0x3a2e20, 0x2e1c30, 0x1c2c34, 0x3c2838];
  const loud = [0x8a3a4a, 0x3a6a8a, 0x8a7a3a, 0x5a3a8a, 0x2a7a6a];
  const glowCols = [0xff4f8b, 0x2ee6ff, 0x9dff5a, 0xffe46b, 0xb07bff];
  const makeMat = (hop: number, headY: number, key: string, lit: boolean): THREE.Material => {
    const hopU = { value: hop };
    const headU = { value: headY };
    const m = lit
      ? own(bag, new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 3, 3) }))
      : own(bag, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }));
    m.onBeforeCompile = (s) => {
      s.uniforms.uTime = clock.uTime;
      s.uniforms.uBeat = clock.uBeat;
      s.uniforms.uJump = clock.uJump;
      s.uniforms.uHop = hopU;
      s.uniforms.uHeadY = headU;
      s.vertexShader = s.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nattribute float aSeed;\nuniform float uTime;\nuniform float uBeat;\nuniform float uJump;\nuniform float uHop;\nvarying float vLocalY;\nvarying float vSeed;',
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
  vLocalY = position.y;
  vSeed = aSeed;
  float kick = pow(1.0 - uBeat, 3.0);
  float jumper = step(0.3, fract(aSeed * 7.13));
  transformed.y += kick * uJump * uHop * (0.4 + 0.6 * fract(aSeed * 3.71)) * jumper;
  transformed.x += sin(uTime * 1.9 + aSeed * 40.0) * 0.07 * position.y;`,
        );
      if (!lit)
        s.fragmentShader = s.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform float uHeadY;\nvarying float vLocalY;\nvarying float vSeed;')
          .replace(
            '#include <color_fragment>',
            `#include <color_fragment>
  // heads: dark, brown, fair or red hair
  float hs = fract(vSeed * 13.7);
  vec3 hair = hs < 0.4 ? vec3(0.02, 0.016, 0.014) : hs < 0.65 ? vec3(0.09, 0.045, 0.022) : hs < 0.85 ? vec3(0.32, 0.22, 0.09) : vec3(0.26, 0.07, 0.025);
  diffuseColor.rgb = mix(diffuseColor.rgb, hair, step(uHeadY, vLocalY));`,
          )
          .replace(
            '#include <emissivemap_fragment>',
            `#include <emissivemap_fragment>
  float rimK = 1.0 - abs(dot(normal, normalize(-vViewPosition)));
  totalEmissiveRadiance += vec3(1.0, 0.6, 0.3) * pow(rimK, 3.5) * 0.22;`,
          );
    };
    m.customProgramCacheKey = () => key;
    return m;
  };
  const standMat = makeMat(1, 1.5, 'fields-crowd', false);
  const sitMat = makeMat(0.15, 1.04, 'fields-crowd', false);
  const glowMat = makeMat(1, 0, 'fields-crowd-glow', true);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const sc = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const col = new THREE.Color();
  const glowSeeds: number[] = [];
  const glowMats: THREE.Matrix4[] = [];
  const glowColors: number[] = [];
  for (const kind of [0, 1, 2] as const) {
    const list = people.filter((p) => p.kind === kind);
    if (!list.length) continue;
    const geo = personGeometry(kind);
    const seeds = new Float32Array(list.length);
    const mesh = new THREE.InstancedMesh(geo, kind === 2 ? sitMat : standMat, list.length);
    list.forEach((p, i) => {
      const seed = rnd();
      seeds[i] = seed;
      q.setFromAxisAngle(up, p.ry);
      m4.compose(pos.set(p.x, 0, p.z), q, sc.setScalar(p.s));
      mesh.setMatrixAt(i, m4);
      mesh.setColorAt(i, col.setHex(rnd() < 0.18 ? loud[Math.floor(rnd() * loud.length)]! : tones[Math.floor(rnd() * tones.length)]!));
      // one in four waves a glow stick / phone light
      if (kind === 1 && rnd() < 0.55) {
        const hand = new THREE.Vector3(0.66, 2.2, 0).applyQuaternion(q).multiplyScalar(p.s).add(pos);
        glowMats.push(new THREE.Matrix4().compose(hand, q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.35)), new THREE.Vector3(1, 1, 1)));
        glowSeeds.push(seed);
        glowColors.push(glowCols[Math.floor(rnd() * glowCols.length)]!);
      }
    });
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
    mesh.computeBoundingSphere();
    g.add(mesh);
  }
  if (glowMats.length) {
    const geo = new THREE.BoxGeometry(0.07, 0.42, 0.07);
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(glowSeeds), 1));
    const sticks = new THREE.InstancedMesh(geo, glowMat, glowMats.length);
    glowMats.forEach((m, i) => {
      sticks.setMatrixAt(i, m);
      sticks.setColorAt(i, col.setHex(glowColors[i]!));
    });
    sticks.computeBoundingSphere();
    g.add(sticks);
  }
  return g;
}

/** Picnic blankets (plaid, tinted per instance) with the odd basket. */
export function buildBlankets(bag: Bag, list: { x: number; z: number; ry: number; c: number }[]): THREE.Group {
  const g = new THREE.Group();
  const tex = ownTex(
    bag,
    canvasTexture(128, 128, (c, w, h) => {
      c.fillStyle = '#ffffff';
      c.fillRect(0, 0, w, h);
      c.fillStyle = 'rgba(40,20,30,0.3)';
      for (let i = 0; i < 8; i++) {
        c.fillRect(i * 16, 0, 8, h);
        c.fillRect(0, i * 16, w, 8);
      }
      c.fillStyle = 'rgba(255,250,235,0.5)';
      for (let i = 0; i < 8; i++) {
        c.fillRect(i * 16 + 11, 0, 2, h);
        c.fillRect(0, i * 16 + 11, w, 2);
      }
    }),
  );
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2, 1.5);
  const geo = new THREE.PlaneGeometry(2.4, 1.8);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.InstancedMesh(geo, own(bag, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 })), list.length);
  const basket = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.3, 0.34), M.wood(), list.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  const col = new THREE.Color();
  list.forEach((b, i) => {
    q.setFromAxisAngle(up, b.ry);
    m4.compose(new THREE.Vector3(b.x, 0.03, b.z), q, one);
    mesh.setMatrixAt(i, m4);
    mesh.setColorAt(i, col.setHex(b.c));
    const bp = new THREE.Vector3(0.75, 0.15, -0.5).applyQuaternion(q).add(new THREE.Vector3(b.x, 0, b.z));
    m4.compose(bp, q, one);
    basket.setMatrixAt(i, m4);
  });
  mesh.computeBoundingSphere();
  basket.computeBoundingSphere();
  g.add(mesh, basket);
  return g;
}

/* ───────────────────────────── the far field ───────────────────────────── */

function colored(g: THREE.BufferGeometry, c: number): THREE.BufferGeometry {
  const ng = stripToPN(g);
  const col = new THREE.Color(c);
  const n = ng.getAttribute('position').count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.toArray(arr, i * 3);
  ng.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return ng;
}

/** Hedgerow trees and poplars: flat-shaded blobs, warm on the sun side. */
export function buildTrees(bag: Bag, list: { x: number; z: number; s: number; poplar: boolean }[], rnd: () => number): THREE.Group {
  const g = new THREE.Group();
  const trunk = new THREE.CylinderGeometry(0.22, 0.34, 3, 6);
  trunk.translate(0, 1.5, 0);
  const round = (): THREE.BufferGeometry => {
    const parts = [colored(trunk.clone(), 0x3a2618)];
    for (const [x, y, z, r, c] of [
      [0, 4.4, 0, 2.3, 0x31522a],
      [1.2, 3.7, 0.4, 1.7, 0x2a4624],
      [-1.1, 3.9, -0.3, 1.8, 0x385c2c],
      [0.2, 5.6, -0.2, 1.5, 0x46682f],
    ] as const) {
      const b = new THREE.IcosahedronGeometry(r, 1);
      b.translate(x, y, z);
      parts.push(colored(b, c));
    }
    return mergeGeometries(parts) ?? new THREE.BufferGeometry();
  };
  const poplar = (): THREE.BufferGeometry => {
    const b = new THREE.IcosahedronGeometry(1, 1);
    b.scale(1.5, 5, 1.5);
    b.translate(0, 6.2, 0);
    return mergeGeometries([colored(trunk.clone(), 0x3a2618), colored(b, 0x2c4a26)]) ?? new THREE.BufferGeometry();
  };
  const mat = own(bag, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 }));
  for (const isPoplar of [false, true]) {
    const sub = list.filter((t) => t.poplar === isPoplar);
    if (!sub.length) continue;
    const mesh = new THREE.InstancedMesh(isPoplar ? poplar() : round(), mat, sub.length);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    sub.forEach((t, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI * 2);
      m4.compose(new THREE.Vector3(t.x, 0, t.z), q, new THREE.Vector3(t.s, t.s * (0.85 + rnd() * 0.3), t.s));
      mesh.setMatrixAt(i, m4);
    });
    mesh.computeBoundingSphere();
    g.add(mesh);
  }
  trunk.dispose();
  return g;
}

/** Glamping bell tents with lamp-lit doorways. */
export function buildBellTents(bag: Bag, list: { x: number; z: number; ry: number }[]): THREE.Group {
  const g = new THREE.Group();
  const cone = new THREE.ConeGeometry(2.3, 3.0, 14);
  cone.translate(0, 1.5, 0);
  const tents = new THREE.InstancedMesh(cone, own(bag, new THREE.MeshStandardMaterial({ color: 0xa8987c, roughness: 0.9 })), list.length);
  const door = new THREE.BufferGeometry();
  door.setAttribute('position', new THREE.Float32BufferAttribute([-0.55, 0.02, 0, 0.55, 0.02, 0, 0, 1.6, 0], 3));
  door.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  const doors = new THREE.InstancedMesh(door, own(bag, new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.2, 0.5) })), list.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  list.forEach((t, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.ry);
    m4.compose(new THREE.Vector3(t.x, 0, t.z), q, one);
    tents.setMatrixAt(i, m4);
    const dp = new THREE.Vector3(0, 0, 1.62).applyQuaternion(q).add(new THREE.Vector3(t.x, 0, t.z));
    const tilt = q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.62));
    m4.compose(dp, tilt, one);
    doors.setMatrixAt(i, m4);
  });
  tents.computeBoundingSphere();
  doors.computeBoundingSphere();
  g.add(tents, doors);
  return g;
}

/** A campsite of little dome tents in every colour, lanterns here and there. */
export function buildDomeTents(bag: Bag, list: { x: number; z: number; ry: number; c: number; s: number }[]): THREE.InstancedMesh {
  const dome = new THREE.SphereGeometry(1.2, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.scale(1.2, 0.9, 1);
  const mesh = new THREE.InstancedMesh(dome, own(bag, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, flatShading: true })), list.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();
  list.forEach((t, i) => {
    q.setFromAxisAngle(up, t.ry);
    m4.compose(new THREE.Vector3(t.x, 0, t.z), q, new THREE.Vector3(t.s, t.s, t.s));
    mesh.setMatrixAt(i, m4);
    mesh.setColorAt(i, col.setHex(t.c));
  });
  mesh.computeBoundingSphere();
  return mesh;
}

/** Long grass left standing outside the ropes: blade clumps leaning in the evening wind. */
export function buildTufts(bag: Bag, clock: FieldClock, list: { x: number; z: number; s: number; r: number }[], rnd: () => number): THREE.InstancedMesh {
  const pos: number[] = [];
  const col: number[] = [];
  const nor: number[] = [];
  const base = new THREE.Color(0x0c1a0a);
  const tips = [new THREE.Color(0x8a7c36), new THREE.Color(0x5a7a2a), new THREE.Color(0xa08a44)];
  for (let k = 0; k < 11; k++) {
    const a = rnd() * Math.PI * 2;
    const lean = 0.15 + rnd() * 0.4;
    const h = 0.4 + rnd() * 0.55;
    const r0 = rnd() * 0.16;
    const bx = Math.cos(a) * r0;
    const bz = Math.sin(a) * r0;
    const wx = -Math.sin(a) * 0.04;
    const wz = Math.cos(a) * 0.04;
    pos.push(bx - wx, 0, bz - wz, bx + wx, 0, bz + wz, bx + Math.cos(a) * lean * h, h, bz + Math.sin(a) * lean * h);
    const tip = tips[k % tips.length]!;
    col.push(base.r, base.g, base.b, base.r, base.g, base.b, tip.r, tip.g, tip.b);
    nor.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const mat = own(bag, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.9 }));
  mat.onBeforeCompile = (s) => {
    s.uniforms.uTime = clock.uTime;
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime;').replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
  vec2 ip = instanceMatrix[3].xz;
  // the wind, taken into the tuft's own frame
  vec3 wl = normalize((vec4(0.93, 0.0, 0.36, 0.0) * instanceMatrix).xyz);
  float gust = 0.5 + 0.5 * sin(uTime * 1.2 - ip.x * 0.2 - ip.y * 0.08);
  transformed += wl * (0.06 + 0.22 * gust) * position.y * position.y * 2.0;
  transformed.y -= 0.05 * gust * position.y;`,
    );
  };
  mat.customProgramCacheKey = () => 'fields-tuft';
  const mesh = new THREE.InstancedMesh(geo, mat, list.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  list.forEach((t, i) => {
    q.setFromAxisAngle(up, t.r);
    m4.compose(new THREE.Vector3(t.x, 0, t.z), q, new THREE.Vector3(t.s, t.s, t.s));
    mesh.setMatrixAt(i, m4);
  });
  mesh.computeBoundingSphere();
  return mesh;
}

/* ───────────────────────────── the ferris wheel ───────────────────────────── */

export interface FerrisWheel {
  group: THREE.Group;
  update(dt: number, speed: number): void;
}

export function buildFerrisWheel(bag: Bag, bulbMat: THREE.ShaderMaterial): FerrisWheel {
  const R = 19;
  const HUB = 22.5;
  const D = 1.6;
  const N = 16;
  const group = new THREE.Group();
  const spin = new THREE.Group();
  spin.position.y = HUB;
  group.add(spin);
  const steel = own(bag, new THREE.MeshStandardMaterial({ color: 0xece4f0, roughness: 0.5, metalness: 0.3 }));
  const parts: THREE.BufferGeometry[] = [];
  const Y = new THREE.Vector3(0, 1, 0);
  const rod = (a: THREE.Vector3, b: THREE.Vector3, r: number): void => {
    const c = new THREE.CylinderGeometry(r, r, a.distanceTo(b), 6);
    const q = new THREE.Quaternion().setFromUnitVectors(Y, b.clone().sub(a).normalize());
    c.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
    parts.push(stripToPN(c));
  };
  for (const z of [-D, D]) {
    const rim = new THREE.TorusGeometry(R, 0.2, 6, 128);
    rim.translate(0, 0, z);
    parts.push(stripToPN(rim));
    const inner = new THREE.TorusGeometry(R * 0.45, 0.13, 5, 64);
    inner.translate(0, 0, z);
    parts.push(stripToPN(inner));
  }
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const a2 = ((i + 0.5) / N) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    for (const z of [-D, D]) rod(new THREE.Vector3(c * 1.2, s * 1.2, z * 0.5), new THREE.Vector3(c * R, s * R, z), 0.09);
    rod(new THREE.Vector3(c * R, s * R, -D), new THREE.Vector3(c * R, s * R, D), 0.08);
    // zig-zag truss between the rims
    rod(new THREE.Vector3(c * R, s * R, -D), new THREE.Vector3(Math.cos(a2) * R, Math.sin(a2) * R, D), 0.05);
    rod(new THREE.Vector3(c * R * 0.45, s * R * 0.45, D), new THREE.Vector3(Math.cos(a2) * R * 0.45, Math.sin(a2) * R * 0.45, -D), 0.04);
  }
  const hub = new THREE.CylinderGeometry(1.3, 1.3, D * 2 + 0.8, 16);
  hub.rotateX(Math.PI / 2);
  parts.push(stripToPN(hub));
  spin.add(new THREE.Mesh(mergeGeometries(parts) ?? new THREE.BufferGeometry(), steel));
  const star = new THREE.Mesh(new THREE.CircleGeometry(1.0, 10), M.glow(0xffc86b, 3));
  star.position.z = D + 0.42;
  spin.add(star);

  // A-frame legs, axle and a platform
  const legs: THREE.BufferGeometry[] = [];
  const legRod = (a: THREE.Vector3, b: THREE.Vector3, r: number): void => {
    const c = new THREE.CylinderGeometry(r, r * 1.2, a.distanceTo(b), 8);
    const q = new THREE.Quaternion().setFromUnitVectors(Y, b.clone().sub(a).normalize());
    c.applyMatrix4(new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
    legs.push(stripToPN(c));
  };
  for (const z of [-(D + 1.4), D + 1.4]) {
    const top = new THREE.Vector3(0, HUB, z * 0.8);
    legRod(new THREE.Vector3(-9, 0, z), top, 0.34);
    legRod(new THREE.Vector3(9, 0, z), top, 0.34);
    legRod(new THREE.Vector3(-6.4, 7, z * 0.93), new THREE.Vector3(6.4, 7, z * 0.93), 0.16);
  }
  const axle = new THREE.CylinderGeometry(0.35, 0.35, (D + 1.6) * 2, 10);
  axle.rotateX(Math.PI / 2);
  axle.translate(0, HUB, 0);
  legs.push(stripToPN(axle));
  const plat = new THREE.BoxGeometry(22, 0.7, 8);
  plat.translate(0, 0.35, 0);
  legs.push(stripToPN(plat));
  group.add(new THREE.Mesh(mergeGeometries(legs) ?? new THREE.BufferGeometry(), steel));

  // gondolas stay level as the wheel turns
  const cab = [new THREE.BoxGeometry(1.6, 1.3, 1.5), new THREE.ConeGeometry(1.2, 0.6, 4), new THREE.CylinderGeometry(0.05, 0.05, 1.2, 4)];
  cab[1]!.rotateY(Math.PI / 4);
  cab[1]!.translate(0, 0.95, 0);
  cab[2]!.translate(0, 1.6, 0);
  const cabGeo = mergeGeometries(cab.map(stripToPN)) ?? new THREE.BufferGeometry();
  const gondolas = new THREE.InstancedMesh(cabGeo, own(bag, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, emissive: 0x2a1408 })), N);
  const candy = [0xff5a6e, 0x3ec6c0, 0xffc93d, 0x9a6bff, 0xff8a3d, 0x5aa8ff];
  const col = new THREE.Color();
  for (let i = 0; i < N; i++) gondolas.setColorAt(i, col.setHex(candy[i % candy.length]!));
  gondolas.frustumCulled = false;
  group.add(gondolas);

  // lights: two rims of chasing bulbs, sixteen spokes (one per step), a hub ring
  const bulbs = new BulbBatch();
  const RIM = 72;
  for (const z of [-D, D])
    for (let i = 0; i < RIM; i++) {
      const a = (i / RIM) * Math.PI * 2;
      bulbs.add(Math.cos(a) * (R + 0.25), Math.sin(a) * (R + 0.25), z + Math.sign(z) * 0.2, i / RIM, 0, BULB.rim, (i * 0.618) % 1);
    }
  for (let i = 0; i < N; i++) {
    // spoke i points at the i-th sixteenth, clockwise from the top
    const a = Math.PI / 2 - (i / N) * Math.PI * 2;
    for (let k = 0; k < 7; k++) {
      const r = 2.4 + (k / 6) * (R - 3.4);
      bulbs.add(Math.cos(a) * r, Math.sin(a) * r, D + 0.22, (r - 2) / (R - 2), i, BULB.spoke, (k * 0.37) % 1);
    }
  }
  spin.add(bulbs.build(bulbMat, 0.26));

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const p = new THREE.Vector3();
  const place = (): void => {
    for (let i = 0; i < N; i++) {
      const a = spin.rotation.z + (i / N) * Math.PI * 2 + Math.PI / N;
      p.set(Math.cos(a) * R, HUB + Math.sin(a) * R - 1.75, 0);
      m4.compose(p, q, one);
      gondolas.setMatrixAt(i, m4);
    }
    gondolas.instanceMatrix.needsUpdate = true;
  };
  place();
  return {
    group,
    update(dt: number, speed: number): void {
      spin.rotation.z -= dt * speed;
      place();
    },
  };
}

/* ───────────────────────────── particles ───────────────────────────── */

const tmpSize = new THREE.Vector2();
function attachPointScale(p: THREE.Points, u: THREE.IUniform<number>): void {
  p.onBeforeRender = (renderer, _scene, camera) => {
    renderer.getDrawingBufferSize(tmpSize);
    u.value = tmpSize.y * 0.5 * camera.projectionMatrix.elements[5]!;
  };
}

const MOTE_VERT = /* glsl */ `
attribute vec3 aData; // kind, seed, size
uniform float uTime;
uniform float uBeat;
uniform float uHat;
uniform float uBuild;
uniform float uScale;
varying vec3 vCol;
void main() {
  float kind = aData.x;
  float s = aData.y;
  vec3 p = position;
  float t = uTime;
  if (kind < 0.5) {
    // pollen and seed fluff drifting downwind through the low sun
    p.x = mod(p.x + t * (0.5 + s * 0.8) + 80.0, 160.0) - 80.0;
    p.z += sin(t * 0.3 + s * 17.0) * 1.5;
    p.y += sin(t * 0.8 + s * 31.0) * 0.35;
    float tw = 0.5 + 0.5 * sin(t * 2.0 + s * 50.0);
    vCol = vec3(1.0, 0.8, 0.5) * (0.45 + tw * 0.6 + uHat * 1.2);
  } else {
    // fireflies: lazy loops in the long grass, blinking, answering the beat
    p += vec3(sin(t * 0.37 + s * 11.0) * 1.4, sin(t * 0.9 + s * 5.0) * 0.35, cos(t * 0.29 + s * 7.0) * 1.4);
    float blink = smoothstep(0.55, 1.0, sin(t * (0.8 + s * 0.9) + s * 50.0));
    blink = max(blink, pow(1.0 - uBeat, 5.0) * step(0.55, fract(s * 13.0)));
    vCol = vec3(0.75, 1.0, 0.35) * blink * 3.2;
  }
  vCol *= 1.0 - uBuild * 0.8;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = max(1.0, aData.z * uScale / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const SOFT_POINT_FRAG = /* glsl */ `
varying vec3 vCol;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d);
  gl_FragColor = vec4(vCol * a, a);
}`;

/** Pollen over the field, fireflies in the long grass outside the ropes. */
export function buildMotes(bag: Bag, clock: FieldClock, rnd: () => number, hx: number, hz: number): THREE.Points {
  const pos: number[] = [];
  const data: number[] = [];
  for (let i = 0; i < 520; i++) {
    pos.push(rnd() * 160 - 80, 0.4 + rnd() * rnd() * 6, rnd() * 100 - 55);
    data.push(0, rnd(), 0.07 + rnd() * 0.08);
  }
  for (let i = 0; i < 260; i++) {
    // mostly just outside the ropes
    const side = rnd();
    let x: number;
    let z: number;
    if (side < 0.5) {
      x = (rnd() < 0.5 ? -1 : 1) * (hx + 2 + rnd() * 18);
      z = rnd() * (hz * 2 + 20) - hz - 10;
    } else {
      x = rnd() * (hx * 2 + 30) - hx - 15;
      z = rnd() < 0.3 ? -(hz + 2 + rnd() * 10) : hz + 2 + rnd() * 16;
    }
    if (rnd() < 0.2) {
      x = rnd() * hx * 2 - hx;
      z = rnd() * hz * 2 - hz;
    }
    pos.push(x, 0.3 + rnd() * 2.2, z);
    data.push(1, rnd(), 0.18 + rnd() * 0.1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aData', new THREE.Float32BufferAttribute(data, 3));
  const scale = { value: 800 };
  const mat = own(
    bag,
    new THREE.ShaderMaterial({
      uniforms: { uTime: clock.uTime, uBeat: clock.uBeat, uHat: clock.uHat, uBuild: clock.uBuild, uScale: scale },
      vertexShader: MOTE_VERT,
      fragmentShader: SOFT_POINT_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  attachPointScale(pts, scale);
  return pts;
}

const SPARK_VERT = /* glsl */ `
attribute vec4 aSpark; // direction, slot
uniform vec4 uB[6];
uniform vec3 uC[6];
uniform float uTime;
uniform float uScale;
varying vec3 vCol;
void main() {
  vec4 b = uB[0];
  vec3 c = uC[0];
  for (int i = 1; i < 6; i++) {
    if (abs(float(i) - aSpark.w) < 0.5) { b = uB[i]; c = uC[i]; }
  }
  float age = uTime - b.w;
  float alive = step(0.0, age) * step(age, 2.2);
  age = clamp(age, 0.0, 2.2);
  vec3 p = b.xyz + aSpark.xyz * 8.0 * (1.0 - exp(-2.2 * age));
  p.y -= 1.5 * age * age;
  float life = 1.0 - age / 2.2;
  float tw = 0.6 + 0.4 * sin(age * 40.0 + aSpark.x * 70.0);
  vCol = mix(vec3(2.0, 1.9, 1.7), c * 2.6, smoothstep(0.0, 0.3, age)) * life * life * tw * alive;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = alive * (0.9 * life + 0.3) * uScale / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

/** Fireworks over the stage: bursts are parametric, the CPU only stamps a start time. */
export class Fireworks {
  readonly points: THREE.Points;
  readonly bursts = Array.from({ length: 6 }, () => new THREE.Vector4(0, 0, 0, -99));
  readonly colors = Array.from({ length: 6 }, () => new THREE.Color());
  private next = 0;

  constructor(bag: Bag, clock: FieldClock, rnd: () => number) {
    const n = 110;
    const spark: number[] = [];
    const pos: number[] = [];
    const v = new THREE.Vector3();
    for (let s = 0; s < 6; s++)
      for (let i = 0; i < n; i++) {
        v.set(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1);
        if (v.lengthSq() < 1e-4) v.set(0, 1, 0);
        v.normalize().multiplyScalar(0.75 + rnd() * 0.25);
        spark.push(v.x, v.y, v.z, s);
        pos.push(0, 0, 0);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aSpark', new THREE.Float32BufferAttribute(spark, 4));
    const scale = { value: 800 };
    const mat = own(
      bag,
      new THREE.ShaderMaterial({
        uniforms: { uB: { value: this.bursts }, uC: { value: this.colors }, uTime: clock.uTime, uScale: scale },
        vertexShader: SPARK_VERT,
        fragmentShader: SOFT_POINT_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    attachPointScale(this.points, scale);
  }

  launch(x: number, y: number, z: number, color: number, time: number): void {
    const i = this.next++ % 6;
    this.bursts[i]!.set(x, y, z, time);
    this.colors[i]!.setHex(color);
  }
}

/* ───────────────────────────── the sky ───────────────────────────── */

const SKY_FRAG = /* glsl */ `
uniform float uTime;
uniform float uDrop;
uniform float uFinale;
uniform vec2 uSun;
uniform float uR;
varying vec3 vWorld;
float skyH1(float x) { return fract(sin(x * 127.1) * 43758.5453); }
float skyN1(float x) { float i = floor(x), f = fract(x); return mix(skyH1(i), skyH1(i + 1.0), f * f * (3.0 - 2.0 * f)); }
float skyH2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float skyN2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(skyH2(i), skyH2(i + vec2(1.0, 0.0)), u.x), mix(skyH2(i + vec2(0.0, 1.0)), skyH2(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  float y = vWorld.y;
  vec2 d = normalize(vWorld.xz);
  float ang = atan(d.x, -d.y);
  float da = ang - atan(uSun.x, -uSun.y);
  da = mod(da + 3.14159, 6.28318) - 3.14159;
  float toSun = dot(d, uSun);
  float e = max(y, 0.0) / uR;
  // dusk: gold on the horizon, coral, mauve, violet, then indigo overhead
  vec3 col = vec3(1.45, 0.6, 0.18);
  col = mix(col, vec3(1.0, 0.3, 0.26), smoothstep(0.0, 0.08, e));
  col = mix(col, vec3(0.42, 0.11, 0.36), smoothstep(0.06, 0.22, e));
  col = mix(col, vec3(0.09, 0.045, 0.18), smoothstep(0.18, 0.45, e));
  col = mix(col, vec3(0.022, 0.018, 0.06), smoothstep(0.42, 0.8, e));
  // the sun side burns; the far side is already blue hour
  float glow = pow(max(toSun, 0.0), 3.0);
  col *= mix(vec3(0.5, 0.45, 0.85), vec3(1.0), 0.3 + 0.7 * glow);
  col += vec3(1.0, 0.42, 0.12) * pow(max(toSun, 0.0), 14.0) * exp(-e * 9.0) * 1.3;
  // the sun: a fat disc sinking into the hills, with a halo
  float sd = length(vec2(da * uR, y - 11.0));
  col = mix(col, vec3(3.4, 1.9, 0.75), smoothstep(15.0, 13.8, sd));
  col += vec3(1.3, 0.5, 0.14) * exp(-sd * 0.05) * 0.7;
  // crepuscular rays fanning up from the sun
  float ra = atan(y - 11.0, da * uR);
  float rays = pow(0.5 + 0.5 * sin(ra * 38.0 + skyN1(ra * 6.0) * 4.0), 3.0) * step(11.0, y);
  col += vec3(1.0, 0.5, 0.25) * rays * exp(-sd * 0.012) * 0.22;
  // long thin clouds, lit from underneath
  float band = skyN2(vec2(ang * 2.2 + uTime * 0.003, y * 0.07)) * skyN2(vec2(ang * 9.0, y * 0.3));
  float cloud = smoothstep(0.26, 0.5, band) * smoothstep(18.0, 30.0, y) * smoothstep(90.0, 50.0, y);
  vec3 cloudCol = mix(vec3(0.28, 0.1, 0.24), vec3(1.3, 0.55, 0.36), 0.2 + glow * 0.8);
  col = mix(col, cloudCol, cloud * 0.75);
  // first stars
  vec2 sc = vec2(ang * 180.0, y * 1.1);
  float star = step(0.994, skyH2(floor(sc))) * smoothstep(60.0, 110.0, y);
  col += vec3(0.8, 0.85, 1.0) * star * (0.4 + 0.6 * sin(uTime * 3.0 + skyH2(floor(sc)) * 40.0));
  // far hills (hazy) and the treeline (dark, gold-rimmed toward the sun)
  float hill = 8.0 + 9.0 * skyN1(ang * 2.2 + 4.0) + 4.0 * skyN1(ang * 6.0);
  vec3 hillCol = mix(vec3(0.3, 0.13, 0.22), vec3(0.62, 0.28, 0.2), glow);
  col = mix(col, hillCol, smoothstep(hill + 0.3, hill - 0.3, y));
  float trees = 3.0 + 4.0 * skyN1(ang * 9.0) + 2.2 * pow(skyN1(ang * 70.0), 2.0) + 1.2 * skyN1(ang * 190.0);
  vec3 treeCol = mix(vec3(0.06, 0.04, 0.08), vec3(0.14, 0.06, 0.08), glow);
  col = mix(col, treeCol, smoothstep(trees + 0.25, trees - 0.25, y));
  col += vec3(1.0, 0.45, 0.15) * glow * smoothstep(0.7, 0.0, abs(y - trees)) * 0.6;
  // other stages glowing beyond the trees
  float far = pow(skyN1(ang * 14.0 + 3.0), 6.0) * smoothstep(trees + 6.0, trees, y) * step(trees, y);
  col += vec3(0.9, 0.3, 0.8) * far * (0.4 + 0.3 * sin(uTime * 2.0 + ang * 30.0)) * (1.0 + uDrop);
  col *= 1.0 + uFinale * 0.25;
  gl_FragColor = vec4(col, 1.0);
}`;

export const SKY_R = 185;

/** A painted dusk: a cylinder wall far out, gradient, sun, clouds, hills and treeline. */
export function buildSky(bag: Bag, clock: FieldClock, sun: THREE.Vector2): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(SKY_R, SKY_R, 180, 128, 1, true);
  geo.translate(0, 72, 0);
  const mat = own(
    bag,
    new THREE.ShaderMaterial({
      uniforms: { uTime: clock.uTime, uDrop: clock.uDrop, uFinale: clock.uFinale, uSun: { value: sun }, uR: { value: SKY_R } },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
    }),
  );
  const m = new THREE.Mesh(geo, mat);
  m.renderOrder = -10;
  m.frustumCulled = false;
  return m;
}
