import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { canvasTexture } from '../materials';

/**
 * Set dressing for MEGAFEST: everything here is built once, merged or instanced, and animated
 * on the GPU (crowds, drones, streamers) so a stadium of sixty thousand costs a few draw calls.
 */

/* ───────────────────────────── geometry helpers ───────────────────────────── */

/** position+normal only, non-indexed, so mixed primitives merge into one draw call. */
function prep(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  for (const name of Object.keys(ng.attributes)) if (name !== 'position' && name !== 'normal') ng.deleteAttribute(name);
  return ng;
}

export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const m = mergeGeometries(parts.map(prep))!;
  m.computeBoundingSphere();
  return m;
}

/** A box placed by its centre. */
export function box(w: number, h: number, d: number, x: number, y: number, z: number, ry = 0, rx = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
}

const UP = new THREE.Vector3(0, 1, 0);

/** A thin open tube between two points (scaffold, truss chords, cables). */
export function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 4): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1, true);
  const dir = b.clone().sub(a).normalize();
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

const v3 = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

/** Box truss between two points: four chords with zig-zag lacing on every face. */
export function truss(a: THREE.Vector3, b: THREE.Vector3, size = 0.8, r = 0.06): THREE.BufferGeometry[] {
  const dir = b.clone().sub(a);
  const len = dir.length();
  dir.normalize();
  const ref = Math.abs(dir.y) > 0.9 ? v3(1, 0, 0) : UP;
  const u = new THREE.Vector3().crossVectors(dir, ref).normalize();
  const v = new THREE.Vector3().crossVectors(u, dir).normalize();
  const h = size / 2;
  const corners = [
    [h, h],
    [h, -h],
    [-h, -h],
    [-h, h],
  ].map(([cu, cv]) => u.clone().multiplyScalar(cu!).addScaledVector(v, cv!));
  const parts: THREE.BufferGeometry[] = [];
  for (const c of corners) parts.push(rod(a.clone().add(c), b.clone().add(c), r, 5));
  const n = Math.max(1, Math.round(len / (size * 1.2)));
  for (let i = 0; i < n; i++) {
    const p0 = a.clone().addScaledVector(dir, (i / n) * len);
    const p1 = a.clone().addScaledVector(dir, ((i + 1) / n) * len);
    for (let k = 0; k < 4; k++) {
      const c0 = corners[k]!;
      const c1 = corners[(k + 1) % 4]!;
      const [s, e] = i % 2 ? [c0, c1] : [c1, c0];
      parts.push(rod(p0.clone().add(s), p1.clone().add(e), r * 0.6, 3));
    }
  }
  return parts;
}

/** Bend a plane into a shallow arc, concave toward +z (the audience). */
export function curvedPanel(width: number, height: number, radius: number, segs = 40): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(width, height, segs, 1);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const a = pos.getX(i) / radius;
    pos.setXYZ(i, Math.sin(a) * radius, pos.getY(i), radius * (1 - Math.cos(a)));
  }
  g.computeVertexNormals();
  return g;
}

/** Deterministic little PRNG so the crowd is the same crowd every night. */
export function mulberry(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ───────────────────────────── shared GLSL ───────────────────────────── */

const GLSL_PAL = /* glsl */ `
uniform vec3 uCols[4];
vec3 pal(float i) {
  int k = int(mod(i, 4.0));
  if (k == 1) return uCols[1];
  if (k == 2) return uCols[2];
  if (k == 3) return uCols[3];
  return uCols[0];
}`;

/**
 * Raver pose, shared by the bodies and the lights they hold so a phone stays in its hand.
 * Every raver is one instance; arms are tagged per-vertex (aPart) and swung here.
 */
const GLSL_RAVER = /* glsl */ `
uniform float uTime;
uniform float uBeats;
uniform float uHype;
uniform float uFinale;
${GLSL_PAL}
// how far this arm is raised (radians from hanging): hands go up with the hype;
// anyone holding a light keeps the right hand high
float raverRaise(float s, float side, float lit) {
  float want = 0.2 + uHype * 0.55 + uFinale;
  float up = step(fract(s * 13.37 + side * 0.31), want);
  float holds = step(0.5, lit) * step(0.0, side);
  up = max(up, holds);
  float t = uTime * (1.3 + fract(s * 3.7)) + s * 40.0;
  float wave = sin(t + side) * mix(0.32, 0.1, holds);
  float pump = pow(1.0 - fract(uBeats + s * 0.05), 4.0) * 0.35 * (1.0 - holds);
  return mix(0.16 + 0.08 * sin(t), 2.65 + wave - pump, up);
}
// bounce on the beat: more ravers leave the ground as the show heats up
float raverJump(float s) {
  float amp = (0.05 + uHype * 0.28 + uFinale * 0.2) * step(fract(s * 5.31), 0.3 + uHype * 0.55 + uFinale);
  float ph = fract(uBeats - fract(s * 9.1) * 0.09);
  return amp * pow(sin(ph * 3.14159), 2.0);
}
vec2 rot2(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
// arm geometry hangs from the shoulder along -y; swing it sideways and hang it off the body
vec3 armPose(vec3 p, float raise, float side) {
  p.xy = rot2(p.xy, raise * side);
  return p + vec3(side * 0.23, 1.34, 0.0);
}
`;

/* ───────────────────────────── crowd ───────────────────────────── */

export interface Raver {
  x: number;
  y: number;
  z: number;
  yaw: number;
  seed: number;
  /** 0 empty-handed, 1 phone torch, 2 LED wristband */
  lit: number;
}

/**
 * One raver, hand-built indexed (37 vertices): hexagonal body, bipyramid head, two square arms.
 * aPart: 0 body, 1 left arm, 2 right arm, 3 head.
 */
function personGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const part: number[] = [];
  const idx: number[] = [];
  const vert = (x: number, y: number, z: number, nx: number, ny: number, nz: number, p: number): number => {
    const l = Math.hypot(nx, ny, nz) || 1;
    pos.push(x, y, z);
    nor.push(nx / l, ny / l, nz / l);
    part.push(p);
    return pos.length / 3 - 1;
  };
  // body: tapered hexagonal column, feet to shoulders, with a shoulder cap
  const b0 = pos.length / 3;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    vert(Math.cos(a) * 0.18, 0, Math.sin(a) * 0.16, Math.cos(a), -0.1, Math.sin(a), 0);
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    vert(Math.cos(a) * 0.3, 1.34, Math.sin(a) * 0.25, Math.cos(a), 0.6, Math.sin(a), 0);
  }
  const cap = vert(0, 1.44, 0, 0, 1, 0, 0);
  for (let i = 0; i < 6; i++) {
    const j = (i + 1) % 6;
    idx.push(b0 + i, b0 + 6 + i, b0 + j, b0 + j, b0 + 6 + i, b0 + 6 + j);
    idx.push(b0 + 6 + i, cap, b0 + 6 + j);
  }
  // head: hexagonal bipyramid (reads round from the high camera)
  const h0 = pos.length / 3;
  const hy = 1.62;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    vert(Math.cos(a) * 0.22, hy, Math.sin(a) * 0.22, Math.cos(a), 0.15, Math.sin(a), 3);
  }
  const top = vert(0, hy + 0.24, 0, 0, 1, 0, 3);
  const bot = vert(0, hy - 0.22, 0, 0, -1, 0, 3);
  for (let i = 0; i < 6; i++) {
    const j = (i + 1) % 6;
    idx.push(h0 + i, top, h0 + j, h0 + j, bot, h0 + i);
  }
  // arms: square tubes hanging from the shoulder pivot (the shader swings them)
  for (const p of [1, 2]) {
    const a0 = pos.length / 3;
    const r = 0.07;
    for (const y of [0.02, -0.66]) {
      for (const [x, z] of [
        [-r, -r],
        [r, -r],
        [r, r],
        [-r, r],
      ] as const) {
        vert(x, y, z, x, y < 0 ? -0.3 : 0.3, z, p);
      }
    }
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      idx.push(a0 + i, a0 + j, a0 + 4 + i, a0 + j, a0 + 4 + j, a0 + 4 + i);
    }
    idx.push(a0 + 4, a0 + 5, a0 + 6, a0 + 4, a0 + 6, a0 + 7);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  g.setIndex(idx);
  return g;
}

export interface CrowdUniforms {
  [k: string]: THREE.IUniform;
  uTime: THREE.IUniform<number>;
  uBeats: THREE.IUniform<number>;
  uHype: THREE.IUniform<number>;
  uFinale: THREE.IUniform<number>;
  uFlash: THREE.IUniform<number>;
  uCols: THREE.IUniform<THREE.Color[]>;
  uFogColor: THREE.IUniform<THREE.Color>;
  uFogDensity: THREE.IUniform<number>;
}

export function crowdUniforms(cols: THREE.Color[], fog: number, density: number): CrowdUniforms {
  return {
    uTime: { value: 0 },
    uBeats: { value: 0 },
    uHype: { value: 0 },
    uFinale: { value: 0 },
    uFlash: { value: 0 },
    uCols: { value: cols },
    uFogColor: { value: new THREE.Color(fog) },
    uFogDensity: { value: density },
  };
}

const CROWD_VERT = /* glsl */ `
attribute float aPart;
attribute vec4 aSpot;   // x, y, z, seed
attribute vec2 aYawLit; // facing, light held
uniform float uFlash;
uniform float uFogDensity;
varying vec3 vN;
varying vec3 vWash;
varying vec3 vBase;
varying vec3 vWorld;
varying float vFog;
${GLSL_RAVER}

// the show lights the crowd: moving heads rake the field, the stage end glows white-hot,
// and the LED floor spills colour over the front rows
vec3 crowdWash(vec2 xz, float s) {
  // one deep stage colour drifting across the field (violet to pink, pockets of cyan) —
  // summing every light at once washes the crowd out to beige
  float hue = 0.5 + 0.5 * sin(xz.x * 0.018 + xz.y * 0.011 + uTime * 0.15);
  vec3 base = mix(uCols[3], uCols[1], hue);
  base = mix(base, uCols[0], smoothstep(0.55, 1.0, sin(xz.y * 0.021 - xz.x * 0.013 + uTime * 0.1 + 1.7)));
  vec3 w = base * (0.24 + 0.14 * fract(s * 11.7));
  // a moving-head sweep rakes across the field in the colour of the bar
  float b = pow(max(0.0, sin(dot(xz, vec2(0.74, 0.67)) * 0.035 + uTime * 0.45)), 14.0);
  w += pal(floor(uBeats * 0.125) + 2.0) * b * 0.7;
  // the LED deck spills onto the front rows
  vec2 e = max(abs(xz) - vec2(66.0, 42.0), 0.0);
  w += uCols[0] * smoothstep(9.0, 0.0, length(e)) * 0.3;
  w *= 1.0 + uFlash * 0.8;
  float st = smoothstep(230.0, 30.0, length(xz - vec2(0.0, -60.0)));
  return mix(w, vec3(1.0, 0.62, 0.2) * (0.4 + b * 0.5 + st * 0.25), uFinale * 0.85);
}

void main() {
  float s = aSpot.w;
  vec3 p = position;
  vec3 n = normal;
  if (aPart > 0.5 && aPart < 2.5) {
    float side = aPart < 1.5 ? -1.0 : 1.0;
    float r = raverRaise(s, side, aYawLit.y);
    p = armPose(p, r, side);
    n.xy = rot2(n.xy, r * side);
  }
  // a little variety in build
  float sc = 0.9 + fract(s * 17.3) * 0.22;
  p *= sc;
  p.xz = rot2(p.xz, aYawLit.x);
  n.xz = rot2(n.xz, aYawLit.x);
  vec3 wp = aSpot.xyz + p;
  wp.y += raverJump(s);
  vWorld = wp;
  vN = n;
  vWash = crowdWash(aSpot.xz, s);
  float c = fract(s * 29.1);
  vBase = c < 0.2 ? vec3(0.03, 0.03, 0.036) : c < 0.4 ? vec3(0.012, 0.015, 0.035) : c < 0.52 ? vec3(0.04, 0.01, 0.016)
        : c < 0.6 ? vec3(0.08, 0.08, 0.085) : vec3(0.014, 0.012, 0.018);
  if (aPart > 2.5) vBase = vec3(0.03, 0.022, 0.02);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  float d = length(mv.xyz);
  vFog = 1.0 - exp(-uFogDensity * uFogDensity * d * d);
  gl_Position = projectionMatrix * mv;
}`;

const CROWD_FRAG = /* glsl */ `
uniform vec3 uFogColor;
varying vec3 vN;
varying vec3 vWash;
varying vec3 vBase;
varying vec3 vWorld;
varying float vFog;
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vWorld);
  float rim = pow(1.0 - max(dot(n, v), 0.0), 2.2);
  float top = max(n.y, 0.0);
  vec3 col = vBase * (0.45 + 0.55 * top) + vWash * (0.9 * rim + 0.07);
  // light from above catches heads and shoulders, so each raver reads as a person
  col += vWash * 0.22 * top * top;
  gl_FragColor = vec4(mix(col, uFogColor, vFog), 1.0);
}`;

export function makeCrowdMaterial(u: CrowdUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({ uniforms: u, vertexShader: CROWD_VERT, fragmentShader: CROWD_FRAG });
}

/**
 * Bodies in spatial chunks, so the follow camera only draws the few blocks of crowd it can see
 * (instance offsets live in attributes; each chunk carries its own bounding sphere).
 */
export function buildCrowd(ravers: Raver[], mat: THREE.ShaderMaterial, cell = 48): THREE.Mesh[] {
  const base = personGeometry();
  const buckets = new Map<string, Raver[]>();
  for (const r of ravers) {
    const k = `${Math.floor(r.x / cell)},${Math.floor(r.z / cell)}`;
    let b = buckets.get(k);
    if (!b) buckets.set(k, (b = []));
    b.push(r);
  }
  const meshes: THREE.Mesh[] = [];
  for (const list of buckets.values()) {
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.getAttribute('position'));
    g.setAttribute('normal', base.getAttribute('normal'));
    g.setAttribute('aPart', base.getAttribute('aPart'));
    const spot = new Float32Array(list.length * 4);
    const yl = new Float32Array(list.length * 2);
    const bb = new THREE.Box3();
    list.forEach((r, i) => {
      spot.set([r.x, r.y, r.z, r.seed], i * 4);
      yl.set([r.yaw, r.lit], i * 2);
      bb.expandByPoint(new THREE.Vector3(r.x, r.y, r.z));
    });
    g.setAttribute('aSpot', new THREE.InstancedBufferAttribute(spot, 4));
    g.setAttribute('aYawLit', new THREE.InstancedBufferAttribute(yl, 2));
    g.instanceCount = list.length;
    bb.max.y += 2.6;
    g.boundingSphere = bb.getBoundingSphere(new THREE.Sphere());
    g.boundingSphere.radius += 2;
    g.boundingBox = bb;
    meshes.push(new THREE.Mesh(g, mat));
  }
  return meshes;
}

const LIGHT_VERT = /* glsl */ `
attribute vec4 aSpot;
attribute vec2 aYawLit;
attribute vec2 aCorner;
uniform float uFogDensity;
varying vec2 vUv;
varying vec3 vCol;
varying float vFog;
${GLSL_RAVER}
// LED wristbands: colour waves roll out from the stage every bar, all gold at the finale
vec3 bandColor(vec2 xz, float s) {
  float d = length(xz - vec2(0.0, -45.0));
  float k = floor(uBeats * 0.25 - d / 55.0);
  float spin = atan(xz.x, xz.y + 45.0) / 6.28318;
  k = mix(k, floor(spin * 8.0 + uBeats), step(0.5, uHype - 0.6));
  float pulse = 0.55 + 0.45 * pow(1.0 - fract(uBeats), 3.0);
  vec3 c = pal(k) * pulse;
  return mix(c, vec3(1.0, 0.75, 0.3) * (0.7 + 0.5 * step(0.8, fract(s * 7.0 + uTime * 0.7))), uFinale);
}
void main() {
  float s = aSpot.w;
  float r = raverRaise(s, 1.0, aYawLit.y);
  vec3 hand = armPose(vec3(0.0, -0.7, 0.0), r, 1.0) * (0.9 + fract(s * 17.3) * 0.22);
  hand.xz = rot2(hand.xz, aYawLit.x);
  vec3 wp = aSpot.xyz + hand;
  wp.y += raverJump(s);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  // phones are tiny: keep them at least a couple of pixels wide in the far stands
  float phone = step(aYawLit.y, 1.5);
  float size = max(phone > 0.5 ? 0.36 : 0.3, -mv.z * 0.0042);
  mv.xy += aCorner * size;
  vUv = aCorner + 0.5;
  // torches flicker as people sway; some are switched off until the hype comes
  float on = step(fract(s * 3.1), 0.45 + uHype * 0.5 + uFinale);
  vec3 torch = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.8, 0.45), uFinale) * (0.8 + 0.3 * sin(uTime * 3.0 + s * 50.0));
  vCol = (phone > 0.5 ? torch * 1.6 : bandColor(aSpot.xz, s) * 1.7) * on;
  float d = length(mv.xyz);
  vFog = 1.0 - exp(-uFogDensity * uFogDensity * d * d * 0.35);
  gl_Position = projectionMatrix * mv;
}`;

const LIGHT_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec3 vCol;
varying float vFog;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.0, d);
  a = a * a * 0.6 + smoothstep(0.4, 0.0, d) * 0.9;
  gl_FragColor = vec4(vCol * a * (1.0 - vFog), 1.0);
}`;

/** Phone torches and LED wristbands: one billboard per raised hand, all in one draw call. */
export function buildCrowdLights(ravers: Raver[], u: CrowdUniforms): THREE.Mesh {
  const lit = ravers.filter((r) => r.lit > 0);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
  g.setAttribute('aCorner', new THREE.Float32BufferAttribute([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const spot = new Float32Array(lit.length * 4);
  const yl = new Float32Array(lit.length * 2);
  lit.forEach((r, i) => {
    spot.set([r.x, r.y, r.z, r.seed], i * 4);
    yl.set([r.yaw, r.lit], i * 2);
  });
  g.setAttribute('aSpot', new THREE.InstancedBufferAttribute(spot, 4));
  g.setAttribute('aYawLit', new THREE.InstancedBufferAttribute(yl, 2));
  g.instanceCount = lit.length;
  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: LIGHT_VERT,
    fragmentShader: LIGHT_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const m = new THREE.Mesh(g, mat);
  m.frustumCulled = false;
  m.renderOrder = 3;
  return m;
}

const FLAG_VERT = /* glsl */ `
attribute vec4 aFlag;    // x, z, seed, yaw
attribute vec2 aCloth;   // along the cloth (0 at the pole), is-cloth
uniform float uTime;
uniform float uBeats;
uniform float uHype;
uniform float uFinale;
uniform float uFogDensity;
uniform vec3 uCols[4];
varying vec3 vCol;
varying float vFog;
varying float vShade;
vec3 flagPal(float i) {
  int k = int(mod(i, 5.0));
  if (k == 1) return uCols[1];
  if (k == 2) return uCols[2];
  if (k == 3) return uCols[3];
  if (k == 4) return vec3(0.92, 0.93, 1.0);
  return uCols[0];
}
void main() {
  float s = aFlag.z;
  vec3 p = position;
  // waved overhead on the beat, cloth rippling in the wind
  float sway = sin(uTime * (1.1 + fract(s * 3.3)) + s * 20.0) * (0.12 + uHype * 0.18 + uFinale * 0.15);
  float u = aCloth.x;
  float wave = sin(u * 4.0 - uTime * (5.0 + s * 2.0) + s * 30.0) * 0.28 * u;
  p.z += wave * aCloth.y;
  p.y -= (1.0 - cos(u * 1.6)) * 0.25 * aCloth.y;
  // the whole pole rocks from the raver's hands
  float h = p.y - 1.4;
  p.x += sin(sway) * h;
  p.y = 1.4 + cos(sway) * h;
  float c = cos(aFlag.w), sn = sin(aFlag.w);
  p.xz = vec2(c * p.x - sn * p.z, sn * p.x + c * p.z);
  vec3 wp = vec3(aFlag.x, 0.0, aFlag.y) + p;
  wp.y += pow(max(0.0, sin(fract(uBeats - s * 0.1) * 3.14159)), 2.0) * (0.05 + uHype * 0.2);
  // two-colour festival flags; the finale turns them all gold and white
  float k = floor(s * 20.0);
  vec3 a = flagPal(k);
  vec3 b = flagPal(k + 1.0 + floor(fract(s * 7.0) * 3.0));
  vec3 col = mix(a, b, step(0.5, uv.y));
  col = mix(col, mix(vec3(1.0, 0.72, 0.25), vec3(1.0), step(0.5, uv.y)), uFinale);
  vCol = mix(vec3(0.05), col, aCloth.y);
  vShade = 0.55 + 0.45 * sin(u * 4.0 - uTime * 5.0 + s * 30.0 + 1.2);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  float d = length(mv.xyz);
  vFog = 1.0 - exp(-uFogDensity * uFogDensity * d * d);
  gl_Position = projectionMatrix * mv;
}`;

const FLAG_FRAG = /* glsl */ `
uniform vec3 uFogColor;
varying vec3 vCol;
varying float vFog;
varying float vShade;
void main() {
  // cloth backlit by the stage: bright where it catches the light, deep in the folds
  vec3 col = vCol * (0.12 + 0.3 * vShade);
  gl_FragColor = vec4(mix(col, uFogColor, vFog), 1.0);
}`;

/** Festival flags waved on poles above the crowd (cloth rippled in the vertex shader). */
export function buildFlags(spots: { x: number; z: number; seed: number; yaw: number }[], u: CrowdUniforms): THREE.Mesh {
  // pole + an 8x3 cloth; aCloth = (distance along the cloth, 1 for cloth)
  const pole = new THREE.BoxGeometry(0.07, 4.6, 0.07);
  pole.translate(0, 1.4 + 2.3, 0);
  const cloth = new THREE.PlaneGeometry(2.5, 1.5, 8, 3);
  cloth.translate(1.25, 1.4 + 4.6 - 0.78, 0);
  const tag = (g: THREE.BufferGeometry, isCloth: number): THREE.BufferGeometry => {
    const ng = g.toNonIndexed();
    const pos = ng.getAttribute('position');
    const a = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      a[i * 2] = isCloth ? pos.getX(i) / 2.5 : 0;
      a[i * 2 + 1] = isCloth;
    }
    ng.setAttribute('aCloth', new THREE.BufferAttribute(a, 2));
    ng.deleteAttribute('normal');
    return ng;
  };
  const base = mergeGeometries([tag(pole, 0), tag(cloth, 1)])!;
  const g = new THREE.InstancedBufferGeometry();
  for (const k of ['position', 'uv', 'aCloth']) g.setAttribute(k, base.getAttribute(k));
  const f = new Float32Array(spots.length * 4);
  spots.forEach((s, i) => f.set([s.x, s.z, s.seed, s.yaw], i * 4));
  g.setAttribute('aFlag', new THREE.InstancedBufferAttribute(f, 4));
  g.instanceCount = spots.length;
  const mat = new THREE.ShaderMaterial({ uniforms: u, vertexShader: FLAG_VERT, fragmentShader: FLAG_FRAG, side: THREE.DoubleSide });
  const m = new THREE.Mesh(g, mat);
  m.frustumCulled = false;
  return m;
}

/* ───────────────────────────── stadium ───────────────────────────── */

export interface PathPt {
  x: number;
  z: number;
  nx: number;
  nz: number;
}

/**
 * Inner edge of the stadium bowl: up the east side, round the south end, back up the west
 * (the north end is the stage). Outward normals, so tiers are offsets along them.
 */
export function standPath(W: number, S: number, R: number, zN: number, step: number): PathPt[] {
  const pts: PathPt[] = [];
  for (let z = zN; z < S - R; z += step) pts.push({ x: W, z, nx: 1, nz: 0 });
  const cx = W - R;
  const cz = S - R;
  const da = step / R;
  for (let a = 0; a < Math.PI / 2; a += da) pts.push({ x: cx + Math.cos(a) * R, z: cz + Math.sin(a) * R, nx: Math.cos(a), nz: Math.sin(a) });
  for (let x = cx; x > -cx; x -= step) pts.push({ x, z: S, nx: 0, nz: 1 });
  for (let a = Math.PI / 2; a < Math.PI; a += da) pts.push({ x: -cx + Math.cos(a) * R, z: cz + Math.sin(a) * R, nx: Math.cos(a), nz: Math.sin(a) });
  for (let z = S - R; z >= zN; z -= step) pts.push({ x: -W, z, nx: -1, nz: 0 });
  return pts;
}

/** Quad strip along the path between two offsets/heights (tier treads, risers, fascia). */
export function pathStrip(
  path: PathPt[],
  d0: number,
  y0: number,
  d1: number,
  y1: number,
  uvScale = 0,
): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  let s = 0;
  path.forEach((p, i) => {
    if (i > 0) {
      const q = path[i - 1]!;
      s += Math.hypot(p.x + p.nx * d0 - q.x - q.nx * d0, p.z + p.nz * d0 - q.z - q.nz * d0);
    }
    pos.push(p.x + p.nx * d0, y0, p.z + p.nz * d0, p.x + p.nx * d1, y1, p.z + p.nz * d1);
    uv.push(s * uvScale, 0, s * uvScale, 1);
    if (i > 0) {
      const a = (i - 1) * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Walk a path offset by d, dropping a point every `spacing` units. */
export function alongPath(path: PathPt[], d: number, spacing: number, fn: (x: number, z: number, nx: number, nz: number) => void): void {
  let carry = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1]!;
    const b = path[i]!;
    const ax = a.x + a.nx * d;
    const az = a.z + a.nz * d;
    const bx = b.x + b.nx * d;
    const bz = b.z + b.nz * d;
    const len = Math.hypot(bx - ax, bz - az);
    let t = carry;
    while (t < len) {
      const k = t / len;
      fn(ax + (bx - ax) * k, az + (bz - az) * k, a.nx + (b.nx - a.nx) * k, a.nz + (b.nz - a.nz) * k);
      t += spacing;
    }
    carry = t - len;
  }
}

/* ───────────────────────────── light beams ───────────────────────────── */

const BEAM_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vN;
varying vec3 vView;
varying vec3 vCol;
void main() {
  vUv = uv;
  mat4 m = modelMatrix * instanceMatrix;
  vec4 wp = m * vec4(position, 1.0);
  vN = normalize(transpose(inverse(mat3(m))) * normal);
  vView = normalize(cameraPosition - wp.xyz);
  vCol = instanceColor;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const BEAM_FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vView;
varying vec3 vCol;
void main() {
  float edge = pow(abs(dot(normalize(vN), vView)), 1.5);
  float along = pow(clamp(vUv.y, 0.0, 1.0), 1.6);
  float dust = 0.82 + 0.18 * sin(vUv.y * 40.0 + uTime * 1.3 + vUv.x * 12.0);
  gl_FragColor = vec4(vCol * edge * along * dust, 1.0);
}`;

/**
 * Every beam in the stadium (moving heads, lasers, follow spots, searchlights) in one
 * instanced draw: per-instance matrix aims it, per-instance colour carries its brightness.
 */
export class BeamBatch {
  readonly mesh: THREE.InstancedMesh;
  readonly material: THREE.ShaderMaterial;
  private readonly m4 = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly c = new THREE.Color();
  private readonly down = new THREE.Vector3(0, -1, 0);

  constructor(count: number) {
    const g = new THREE.CylinderGeometry(0.03, 1, 1, 24, 1, true);
    g.translate(0, -0.5, 0);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: BEAM_VERT,
      fragmentShader: BEAM_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.InstancedMesh(g, this.material, count);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    for (let i = 0; i < count; i++) this.mesh.setColorAt(i, this.c.setRGB(0, 0, 0));
  }

  /** Aim beam i from `o` along unit `dir`; `radius` at the far end. */
  set(i: number, o: THREE.Vector3, dir: THREE.Vector3, length: number, radius: number, color: THREE.Color | number, k: number): void {
    this.q.setFromUnitVectors(this.down, dir);
    this.s.set(radius, length, radius);
    this.m4.compose(o, this.q, this.s);
    this.mesh.setMatrixAt(i, this.m4);
    if (typeof color === 'number') this.c.setHex(color);
    else this.c.copy(color);
    this.mesh.setColorAt(i, this.c.multiplyScalar(k));
  }

  commit(time: number): void {
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.material.uniforms.uTime!.value = time;
  }
}

/* ───────────────────────────── LED screens ───────────────────────────── */

const LED_VERT = /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

/**
 * One program for every screen in the stadium; uMode picks the content:
 * 0 main wall (circular spectrum iris + mirrored bars), 1 IMAG side screens (tunnel + halo),
 * 2 halo band / side stages (marquee over colour bars), 3 stage-front fascia / ribbon boards (chases).
 */
const LED_FRAG = /* glsl */ `
uniform float uTime;
uniform float uBeat;
uniform float uBeats;
uniform float uBands[16];
uniform float uDrop;
uniform float uEnergy;
uniform float uFinale;
uniform float uMode;
uniform vec2 uCells;
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uC;
uniform sampler2D uText;
uniform float uTextAmt;
uniform vec3 uTextCol;
uniform vec3 uTextScroll; // x repeat, x speed, 1 = marquee
uniform float uGain;
varying vec2 vUv;

float band(float x) { return uBands[int(clamp(x, 0.0, 15.0))]; }

void main() {
  vec2 g = vUv * uCells;
  vec2 cell = floor(g);
  vec2 f = fract(g) - 0.5;
  // LED pitch: crisp square diodes up close, an even glow far away (no moire)
  float fw = fwidth(g.x) + fwidth(g.y);
  float px = mix(smoothstep(0.5, 0.3, max(abs(f.x), abs(f.y))), 0.62, smoothstep(0.35, 1.1, fw));
  vec2 c = (cell + 0.5) / uCells;
  float beat = pow(1.0 - uBeat, 3.0);
  float aspect = uCells.x / uCells.y;
  vec3 col = vec3(0.0);

  if (uMode < 0.5) {
    vec2 q = (c - 0.5) * vec2(aspect, 1.0);
    float r = length(q);
    float a = atan(q.y, q.x);
    // mirrored circular spectrum: an iris that opens with the band energies
    float bi = abs(fract(a / 6.28318 + 0.25) - 0.5) * 2.0 * 15.99;
    float b = band(bi);
    float iris = step(r, 0.2 + b * 0.24) * step(0.15, r);
    float core = smoothstep(0.14, 0.0, r) * (0.4 + beat);
    // mirrored horizontal bars sweeping out to the screen edges
    float x = abs(c.x - 0.5) * 2.0;
    float hb = band(x * 15.99);
    float bars = step(abs(c.y - 0.5) * 2.0, hb * 1.05 + 0.03) * step(0.2, x);
    // concentric rings rushing out, twisted by the beat
    float k = 0.5 + 0.5 * sin(r * 22.0 - uTime * 5.0 + sin(a * 6.0 + uTime) * 1.2);
    col = mix(uA, uB, x) * bars * 1.4;
    col += mix(uB, uC, bi / 16.0) * iris * 1.6 + vec3(1.0) * core;
    col += mix(uA, uC, k) * k * 0.2 * (0.4 + beat) * smoothstep(0.1, 0.5, r);
    // scan bar sweeping down each bar
    col += vec3(0.5, 0.6, 1.0) * smoothstep(0.03, 0.0, abs(c.y - (1.0 - fract(uBeats * 0.25)))) * 0.5;
  } else if (uMode < 1.5) {
    vec2 q = (c - 0.5) * vec2(aspect, 1.0);
    float r = length(q);
    float a = atan(q.y, q.x);
    // square tunnel rushing at the viewer
    float sq = max(abs(q.x), abs(q.y));
    float tun = step(0.6, fract(log(sq + 0.02) * 3.0 - uTime * 1.5));
    col = mix(uA, uB, fract(log(sq + 0.02) * 0.5 - uTime * 0.2)) * tun * 0.35 * smoothstep(0.02, 0.3, sq);
    // the performer's halo in close-up: a ring of spectrum ticks round a white-hot core
    float t = fract(a / 6.28318 + 0.5) * 32.0;
    float tick = step(abs(fract(t) - 0.5), 0.3);
    float b = band(abs(floor(t) - 15.5));
    float halo = tick * step(0.2, r) * step(r, 0.22 + b * 0.2);
    col += mix(uC, uA, b) * halo * 1.6;
    col += vec3(1.0, 0.95, 0.85) * smoothstep(0.13, 0.08, r) * (0.8 + beat * 0.8);
    // "LIVE" tally in the corner
    col += vec3(1.0, 0.1, 0.15) * step(0.9, c.x) * step(0.92, c.y) * step(0.5, fract(uTime));
  } else if (uMode < 2.5) {
    float x = c.x;
    float bars = step(c.y, band(mod(cell.x, 16.0)) * 1.1 + 0.05);
    col = mix(uA, uB, 0.5 + 0.5 * sin(x * 12.0 - uTime * 2.0)) * (0.15 + bars * 0.5);
    col += uC * step(0.94, fract(x * 6.0 - uBeats * 0.5)) * 0.8;
  } else {
    float k = fract(c.x * 3.0 - uBeats * 0.5);
    col = mix(uA, uB, step(0.5, fract(c.x * 1.5 + floor(uBeats) * 0.25))) * (0.15 + step(0.85, k) * 0.9 + beat * 0.25);
    col += uC * step(0.97, fract(c.x * 24.0 + uTime * 3.0)) * 0.6;
  }

  col *= 0.75 + uEnergy * 0.35;
  col += vec3(1.0) * uDrop * step(0.5, fract(uBeats * 2.0)) * 0.25;
  // pixel lettering, sampled at the LED cell centre so it stays chunky
  vec2 tuv = uTextScroll.z > 0.5 ? vec2(c.x * uTextScroll.x + uTime * uTextScroll.y, c.y) : c;
  float tx = texture2D(uText, tuv).r * uTextAmt;
  col = mix(col * (1.0 - uTextAmt * 0.8), uTextCol * (0.95 + beat * 0.7), tx);
  // the finale: everything gold
  float lum = dot(col, vec3(0.3, 0.5, 0.2));
  col = mix(col, vec3(1.0, 0.72, 0.28) * lum * 1.6 + uTextCol * tx * 0.4, uFinale * (1.0 - tx) * 0.7);
  gl_FragColor = vec4(col * px * uGain, 1.0);
}`;

export interface LedOpts {
  mode: number;
  cells: [number, number];
  a: number;
  b: number;
  c: number;
  bands: number[];
  gain?: number;
}

export function makeLedMaterial(o: LedOpts): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uBeat: { value: 0 },
      uBeats: { value: 0 },
      uBands: { value: o.bands },
      uDrop: { value: 0 },
      uEnergy: { value: 0 },
      uFinale: { value: 0 },
      uMode: { value: o.mode },
      uCells: { value: new THREE.Vector2(o.cells[0], o.cells[1]) },
      uA: { value: new THREE.Color(o.a) },
      uB: { value: new THREE.Color(o.b) },
      uC: { value: new THREE.Color(o.c) },
      uText: { value: null },
      uTextAmt: { value: 0 },
      uTextCol: { value: new THREE.Color(0xffffff) },
      uTextScroll: { value: new THREE.Vector3(1, 0, 0) },
      uGain: { value: o.gain ?? 1 },
    },
    vertexShader: LED_VERT,
    fragmentShader: LED_FRAG,
    toneMapped: false,
  });
}

/** Chunky pixel lettering for the LED screens (white on black, sampled nearest). */
export function ledText(msg: string, w: number, h: number, font: number, repeat = false): THREE.CanvasTexture {
  const t = canvasTexture(
    w,
    h,
    (g) => {
      g.fillStyle = '#000';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#fff';
      g.font = `${font}px Bungee, Impact, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(msg, w / 2, h / 2 + font * 0.06);
    },
    false,
  );
  t.minFilter = THREE.NearestFilter;
  t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  if (repeat) t.wrapS = THREE.RepeatWrapping;
  return t;
}

/* ───────────────────────────── drones ───────────────────────────── */

const DRONE_VERT = /* glsl */ `
attribute vec3 aA;
attribute vec3 aB;
attribute vec3 aC;
attribute vec2 aCorner;
attribute float aSeed;
uniform float uTime;
uniform float uBeats;
uniform float uMixB;
uniform float uMixC;
uniform vec3 uCols[4];
varying vec2 vUv;
varying vec3 vCol;
vec2 rot2(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
void main() {
  float s = aSeed;
  // idle: a slow spiral galaxy of drones hanging behind the stage
  vec3 a = aA;
  a.xy = rot2(a.xy, uTime * 0.05);
  a += vec3(0.0, 40.0, -125.0);
  a.y += sin(uTime * 0.7 + s * 30.0) * 0.6;
  // drop: they spell the show's name in the sky
  vec3 b = aB + vec3(sin(uTime * 1.3 + s * 20.0) * 0.15, 0.0, 0.0);
  // finale: a slowly turning crown over the B-stage
  vec3 cr = aC;
  cr.xz = rot2(cr.xz, uTime * 0.25);
  cr += vec3(0.0, 0.0, -9.0);
  // staggered hand-offs so the swarm pours from one shape into the next
  float kb = smoothstep(s * 0.5, s * 0.5 + 0.5, uMixB);
  float kc = smoothstep(s * 0.45, s * 0.45 + 0.55, uMixC);
  vec3 p = mix(a, b, kb);
  p = mix(p, cr, kc);
  p.y += sin(kb * 3.14159) * 10.0 + sin(kc * 3.14159) * 18.0;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float size = max(0.55, -mv.z * 0.0045) * (0.8 + 0.4 * fract(s * 7.7));
  mv.xy += aCorner * size;
  vUv = aCorner + 0.5;
  vec3 ca = mix(uCols[0], uCols[3], fract(s * 3.3)) * 0.9;
  vec3 cb = mix(uCols[0], uCols[1], smoothstep(-50.0, 50.0, aB.x)) * 1.3;
  vec3 cc = vec3(1.0, 0.74, 0.3) * 1.5 + vec3(0.8) * step(0.93, fract(s * 11.0 + uTime * 0.8));
  vCol = mix(mix(ca, cb, kb), cc, kc) * (0.8 + 0.3 * pow(1.0 - fract(uBeats), 3.0));
  gl_Position = projectionMatrix * mv;
}`;

const DRONE_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec3 vCol;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = smoothstep(1.0, 0.0, d);
  a = a * a * 0.5 + smoothstep(0.35, 0.0, d);
  gl_FragColor = vec4(vCol * a, 1.0);
}`;

/** Sample `count` points inside the glyphs of `msg` (x, y in 0..1, y up). */
function textPoints(msg: string, count: number, rnd: () => number): [number, number][] {
  const W = 480;
  const H = 110;
  const pts: [number, number][] = [];
  const tex = canvasTexture(W, H, (g) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    g.fillStyle = '#fff';
    g.font = '96px Bungee, Impact, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(msg, W / 2, H / 2 + 6);
    const d = g.getImageData(0, 0, W, H).data;
    const filled: number[] = [];
    for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) if (d[(y * W + x) * 4]! > 128) filled.push(x, y);
    const n = filled.length / 2;
    for (let i = 0; i < count && n > 0; i++) {
      const k = Math.floor(rnd() * n) * 2;
      pts.push([(filled[k]! + rnd()) / W, 1 - (filled[k + 1]! + rnd()) / H]);
    }
  });
  tex.dispose();
  while (pts.length < count) pts.push([rnd(), rnd()]);
  return pts;
}

export interface DroneSwarm {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
}

/** A drone light show: galaxy (idle) → the name in the sky (drops) → a crown (finale). */
export function buildDrones(count: number, cols: THREE.Color[]): DroneSwarm {
  const rnd = mulberry(4242);
  const A = new Float32Array(count * 3);
  const B = new Float32Array(count * 3);
  const C = new Float32Array(count * 3);
  const seed = new Float32Array(count);
  const text = textPoints('ENCORE', count, rnd);
  // crown layout: two bands, jewels, eight spikes with orbs on the tips
  const crown: [number, number, number][] = [];
  const R = 13;
  for (const y of [4.2, 5.8]) for (let i = 0; i < 170; i++) crown.push([(i / 170) * Math.PI * 2, R, y]);
  for (let i = 0; i < 16; i++) for (let k = 0; k < 4; k++) crown.push([(i / 16) * Math.PI * 2 + (k - 1.5) * 0.02, R, 5 + (k % 2) * 0.2]);
  const spikes = 8;
  for (let i = 0; i < spikes; i++) {
    const a0 = (i / spikes) * Math.PI * 2;
    const half = Math.PI / spikes;
    for (let k = 0; k < 24; k++) {
      const t = k / 23;
      crown.push([a0 - half + half * t, R, 5.8 + 5.6 * t]);
      crown.push([a0 + half - half * t, R, 5.8 + 5.6 * t]);
    }
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      crown.push([a0 + Math.cos(a) * 0.05, R + Math.sin(a) * 0.6, 12.2 + Math.cos(a) * 0.6]);
    }
  }
  for (let i = 0; i < count; i++) {
    // galaxy: two log-spiral arms plus a bright core
    const arm = i % 2;
    const t = rnd();
    const r = 3 + t * 40;
    const th = arm * Math.PI + Math.log(r) * 2.2 + (rnd() - 0.5) * 0.5;
    A.set([Math.cos(th) * r * 1.2, Math.sin(th) * r * 0.42, (rnd() - 0.5) * 6], i * 3);
    const [tx, ty] = text[i]!;
    B.set([(tx - 0.5) * 118, 20 + ty * 27, -118 + (rnd() - 0.5) * 2], i * 3);
    const c = crown[i];
    if (c) {
      const [a, rr, y] = c;
      C.set([Math.cos(a) * rr, y, Math.sin(a) * rr], i * 3);
    } else {
      // spare drones: a sparkling halo ring above the crown
      const a = rnd() * Math.PI * 2;
      C.set([Math.cos(a) * (R + 3.5), 14 + rnd() * 1.5, Math.sin(a) * (R + 3.5)], i * 3);
    }
    seed[i] = rnd();
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Array(12).fill(0), 3));
  g.setAttribute('aCorner', new THREE.Float32BufferAttribute([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.setAttribute('aA', new THREE.InstancedBufferAttribute(A, 3));
  g.setAttribute('aB', new THREE.InstancedBufferAttribute(B, 3));
  g.setAttribute('aC', new THREE.InstancedBufferAttribute(C, 3));
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
  g.instanceCount = count;
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uBeats: { value: 0 },
      uMixB: { value: 0 },
      uMixC: { value: 0 },
      uCols: { value: cols },
    },
    vertexShader: DRONE_VERT,
    fragmentShader: DRONE_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const mesh = new THREE.Mesh(g, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  return { mesh, material };
}

/* ───────────────────────────── streamer cannons ───────────────────────────── */

const STREAMER_VERT = /* glsl */ `
attribute vec3 aOrigin;
attribute vec3 aVel;
attribute vec2 aSeedCannon;
attribute vec2 aCorner;
uniform float uTime;
uniform float uFire[6];
uniform vec3 uCols[4];
varying vec3 vCol;
varying float vShine;
void main() {
  float s = aSeedCannon.x;
  int ci = int(aSeedCannon.y);
  float fire = uFire[0];
  for (int i = 1; i < 6; i++) if (i == ci) fire = uFire[i];
  float t = uTime - fire;
  float alive = step(0.0, t) * step(t, 9.0);
  // blasted out, braked by the air, then drifting down fluttering
  float k = 2.2;
  float e = (1.0 - exp(-k * t)) / k;
  vec3 p = aOrigin + aVel * e;
  p.y -= t * (1.6 + s * 0.8);
  p.x += sin(t * 2.3 + s * 40.0) * 0.6 * min(t, 1.0);
  p.z += cos(t * 1.9 + s * 30.0) * 0.4 * min(t, 1.0);
  p.y = max(p.y, 0.02);
  // a paper strip spinning about its long axis
  float spin = t * (6.0 + s * 8.0) + s * 20.0;
  vec3 axis = normalize(vec3(sin(s * 50.0), 0.4, cos(s * 50.0)));
  vec3 side = normalize(cross(axis, vec3(0.0, 1.0, 0.0))) * cos(spin) + vec3(0.0, 1.0, 0.0) * sin(spin) * 0.6;
  vec3 wp = p + axis * aCorner.y * 0.9 + side * aCorner.x * 0.16;
  vShine = 0.35 + 0.65 * abs(cos(spin));
  int k2 = int(mod(floor(s * 7.0), 4.0));
  vec3 c = k2 == 0 ? uCols[2] : k2 == 1 ? vec3(0.9, 0.92, 1.0) : k2 == 2 ? uCols[1] : uCols[0];
  vCol = c;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0) * alive;
}`;

const STREAMER_FRAG = /* glsl */ `
varying vec3 vCol;
varying float vShine;
void main() { gl_FragColor = vec4(vCol * vShine * 1.2, 1.0); }`;

export interface Streamers {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  fire: number[];
}

/** Mylar streamer cannons along the stage lip; uFire[i] is when cannon i last went off. */
export function buildStreamers(cannons: THREE.Vector3[], perCannon: number, cols: THREE.Color[]): Streamers {
  const rnd = mulberry(99);
  const n = cannons.length * perCannon;
  const O = new Float32Array(n * 3);
  const V = new Float32Array(n * 3);
  const S = new Float32Array(n * 2);
  cannons.forEach((c, ci) => {
    for (let k = 0; k < perCannon; k++) {
      const i = ci * perCannon + k;
      O.set([c.x, c.y, c.z], i * 3);
      const spread = 0.5;
      const up = 26 + rnd() * 16;
      V.set([(rnd() - 0.5) * 30 * spread + -c.x * 0.12, up, 14 + rnd() * 26], i * 3);
      S.set([rnd(), ci], i * 2);
    }
  });
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Array(12).fill(0), 3));
  g.setAttribute('aCorner', new THREE.Float32BufferAttribute([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.setAttribute('aOrigin', new THREE.InstancedBufferAttribute(O, 3));
  g.setAttribute('aVel', new THREE.InstancedBufferAttribute(V, 3));
  g.setAttribute('aSeedCannon', new THREE.InstancedBufferAttribute(S, 2));
  g.instanceCount = n;
  const fire = new Array(6).fill(-99);
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uFire: { value: fire }, uCols: { value: cols } },
    vertexShader: STREAMER_VERT,
    fragmentShader: STREAMER_FRAG,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(g, material);
  mesh.frustumCulled = false;
  return { mesh, material, fire };
}

/* ───────────────────────────── pyro ───────────────────────────── */

/**
 * A pyro / CO2 plume on a camera-facing sheet: a turbulent column that billows as it rises,
 * white-hot at the nozzle. `billow` > 0 makes it a cold cryo jet (wide, soft, smoky).
 */
export function makePlumeMaterial(color: number, billow = 0): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(color) }, uPower: { value: 0 }, uBillow: { value: billow } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uPower;
      uniform float uBillow;
      varying vec2 vUv;
      float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), u.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), u.x), u.y); }
      void main() {
        // (clamped: interpolated uvs can dip below zero, and pow() of a negative is NaN,
        // which the bloom chain would smear across half the screen)
        float y = clamp(vUv.y, 0.0, 1.0);
        float x = vUv.x - 0.5;
        float wob = (n(vec2(y * 3.0 - uTime * 5.0, uTime * 0.7)) - 0.5) * 0.3 * y;
        float width = mix(0.1, 0.36 + uBillow * 0.12, pow(y, 0.55));
        float dx = (x - wob) / width;
        float body = exp(-dx * dx * 2.2);
        float tongues = n(vec2(x * 7.0, y * 4.0 - uTime * 7.0)) * 0.6 + n(vec2(x * 15.0, y * 9.0 - uTime * 12.0)) * 0.4;
        float reach = max(0.02, uPower * (1.0 - uBillow * 0.25));
        float top = smoothstep(reach, reach * 0.45, y + (tongues - 0.5) * 0.35);
        float a = body * top * smoothstep(0.0, 0.04, y) * min(1.0, uPower * 2.0);
        a *= mix(1.0, 0.55 + tongues * 0.6, uBillow);
        vec3 col = mix(uColor, vec3(1.0, 0.96, 0.85), smoothstep(0.25, 0.0, y) * body * (1.0 - uBillow * 0.5));
        col = mix(col, uColor * 0.45, smoothstep(0.55, 1.0, y) * (1.0 - uBillow));
        gl_FragColor = vec4(col * a * 2.3, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

/* ───────────────────────────── sky ───────────────────────────── */

/** A dome of faint stars above the light haze (only the far shots ever look up). */
export function buildStars(count: number): THREE.Points {
  const rnd = mulberry(7);
  const p = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const a = rnd() * Math.PI * 2;
    const e = 0.12 + rnd() * 1.2;
    const r = 330;
    p.set([Math.cos(a) * Math.cos(e) * r, Math.sin(e) * r * 0.6 + 40, Math.sin(a) * Math.cos(e) * r], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  const m = new THREE.PointsMaterial({ color: 0x9aa4d8, size: 1.3, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.7 });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  return pts;
}

/** Soft additive glow card (light haze over the stage, hot spots on floodlights). */
export function makeGlowMaterial(color: number, opacity = 1): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: opacity } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uOpacity; varying vec2 vUv;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float a = pow(max(0.0, 1.0 - d), 2.2) * uOpacity;
        gl_FragColor = vec4(uColor * a, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
}

/* ───────────────────────────── structures ───────────────────────────── */

let steelShared: THREE.MeshStandardMaterial | null = null;
function steel(): THREE.MeshStandardMaterial {
  if (!steelShared) steelShared = new THREE.MeshStandardMaterial({ color: 0x4c505c, metalness: 0.9, roughness: 0.35 });
  return steelShared;
}

/** Neon tube lettering on a transparent card (additive). */
export function neonTexture(text: string, color: string, w = 1024, h = 192, font = 128): THREE.CanvasTexture {
  return canvasTexture(w, h, (g) => {
    g.clearRect(0, 0, w, h);
    g.font = `${font}px Bungee, Impact, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.shadowColor = color;
    for (const blur of [50, 24, 10]) {
      g.shadowBlur = blur;
      g.strokeStyle = color;
      g.lineWidth = 9;
      g.strokeText(text, w / 2, h / 2);
    }
    g.shadowBlur = 0;
    g.strokeStyle = '#ffffff';
    g.lineWidth = 3.5;
    g.strokeText(text, w / 2, h / 2);
  });
}

/** Black mesh scrim hung on the delay towers: the festival mark, readable from the pit. */
export function bannerTexture(): THREE.CanvasTexture {
  return canvasTexture(256, 720, (g, w, h) => {
    g.fillStyle = '#07060c';
    g.fillRect(0, 0, w, h);
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, 'rgba(46,230,255,0.25)');
    grd.addColorStop(0.5, 'rgba(140,90,255,0.08)');
    grd.addColorStop(1, 'rgba(255,45,120,0.25)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    g.save();
    g.translate(w / 2, h / 2);
    g.rotate(-Math.PI / 2);
    g.font = '92px Bungee, Impact, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#ffd36b';
    g.shadowColor = '#ffb020';
    g.shadowBlur = 18;
    g.fillText('MEGAFEST', 0, -10);
    g.shadowBlur = 0;
    g.font = '600 30px "JetBrains Mono", monospace';
    g.fillStyle = '#e8f6ff';
    g.fillText('WORLD TOUR · FINAL NIGHT', 0, 68);
    g.restore();
    g.strokeStyle = '#ffd36b';
    g.lineWidth = 6;
    g.strokeRect(10, 10, w - 20, h - 20);
  });
}

export interface DelayTower {
  group: THREE.Group;
  /** every material on the tower, so it can be ghosted when the performer walks behind it */
  mats: THREE.Material[];
  glow: THREE.MeshBasicMaterial;
  beacon: THREE.MeshBasicMaterial;
}

/**
 * Delay tower: a scaffold column carrying a hang of speakers that face the back of the
 * field, a follow-spot platform and a red aviation beacon. Black ballast plinth at the foot
 * with a glowing collar marks exactly where you bump into it.
 */
export function delayTower(accent: number, banner: THREE.Texture, r: number): DelayTower {
  const H = 12.2;
  const s = 1.05;
  const posts: [number, number][] = [
    [-s, -s],
    [s, -s],
    [s, s],
    [-s, s],
  ];
  const st: THREE.BufferGeometry[] = [];
  for (const [x, z] of posts) st.push(rod(v3(x, 0.7, z), v3(x, H, z), 0.1, 6));
  for (let y = 2.5; y < H; y += 2.3)
    for (let k = 0; k < 4; k++) {
      const [ax, az] = posts[k]!;
      const [bx, bz] = posts[(k + 1) % 4]!;
      st.push(rod(v3(ax, y, az), v3(bx, y, bz), 0.05, 4));
      st.push(rod(v3(ax, y - 2.3, az), v3(bx, y, bz), 0.035, 3));
    }
  st.push(box(3.2, 0.18, 3.2, 0, H, 0));
  const R = 1.55;
  for (const y of [H + 0.55, H + 1.05])
    for (let k = 0; k < 4; k++) {
      const [ax, az] = posts[k]!;
      const [bx, bz] = posts[(k + 1) % 4]!;
      st.push(rod(v3((ax / s) * R, y, (az / s) * R), v3((bx / s) * R, y, (bz / s) * R), 0.04, 4));
    }
  for (const [x, z] of posts) st.push(rod(v3((x / s) * R, H, (z / s) * R), v3((x / s) * R, H + 1.05, (z / s) * R), 0.04, 4));
  // cantilever carrying the speaker hang out over the south side
  st.push(box(0.22, 0.22, 2.6, -0.5, H - 0.25, 2.2), box(0.22, 0.22, 2.6, 0.5, H - 0.25, 2.2));
  st.push(rod(v3(-1.2, H, -1.2), v3(-1.2, H + 2.6, -1.2), 0.05, 5));
  // follow-spot on its stand, trained on the stage
  st.push(rod(v3(0.4, H, -0.4), v3(0.4, H + 1.0, -0.4), 0.06, 5));
  const dark: THREE.BufferGeometry[] = [];
  const grille: THREE.BufferGeometry[] = [];
  const plinth = new THREE.CylinderGeometry(r, r * 1.04, 0.72, 8);
  plinth.rotateY(Math.PI / 8);
  plinth.translate(0, 0.36, 0);
  dark.push(plinth);
  for (let i = 0; i < 5; i++) {
    const y = H - 1.0 - i * 0.76;
    const z = 3.0 + i * 0.05;
    const tilt = 0.05 + i * 0.07;
    dark.push(box(1.8, 0.72, 1.1, 0, y, z, 0, tilt));
    const gr = new THREE.PlaneGeometry(1.62, 0.56);
    gr.rotateX(tilt);
    gr.translate(0, y - Math.sin(tilt) * 0.56, z + Math.cos(tilt) * 0.56);
    grille.push(gr);
  }
  const spot = new THREE.CylinderGeometry(0.34, 0.28, 1.5, 12);
  spot.rotateX(Math.PI / 2 - 0.25);
  spot.translate(0.4, H + 1.25, -0.4);
  dark.push(spot);
  const glowG: THREE.BufferGeometry[] = [];
  const collar = new THREE.TorusGeometry(r * 1.01, 0.06, 6, 40);
  collar.rotateX(Math.PI / 2);
  collar.translate(0, 0.72, 0);
  glowG.push(collar);
  for (const x of [-s, s]) glowG.push(box(0.07, H - 1.2, 0.07, x * 1.07, 0.7 + (H - 1.2) / 2, s * 1.07));
  glowG.push(box(3.24, 0.06, 0.06, 0, H + 0.1, 1.6), box(3.24, 0.06, 0.06, 0, H + 0.1, -1.6));
  const lens = new THREE.CircleGeometry(0.26, 16);
  lens.rotateX(Math.PI - 0.25);
  lens.translate(0.4, H + 1.25 - 0.18, -1.15);
  glowG.push(lens);

  const mk = <T extends THREE.Material>(m: T): T => {
    m.transparent = true;
    return m;
  };
  const steelMat = mk(new THREE.MeshStandardMaterial({ color: 0x6a6f7c, metalness: 0.85, roughness: 0.32 }));
  const darkMat = mk(new THREE.MeshStandardMaterial({ color: 0x131219, roughness: 0.55, metalness: 0.25 }));
  const grilleMat = mk(new THREE.MeshStandardMaterial({ color: 0x050507, roughness: 0.95 }));
  const glow = mk(new THREE.MeshBasicMaterial({ color: new THREE.Color(accent).multiplyScalar(2), toneMapped: false }));
  const bannerMat = mk(new THREE.MeshBasicMaterial({ map: banner, color: 0xbbbbbb }));
  const beacon = mk(new THREE.MeshBasicMaterial({ color: 0xff2020, toneMapped: false }));
  const group = new THREE.Group();
  group.add(new THREE.Mesh(merge(st), steelMat));
  group.add(new THREE.Mesh(merge(dark), darkMat));
  group.add(new THREE.Mesh(merge(grille), grilleMat));
  group.add(new THREE.Mesh(merge(glowG), glow));
  const scrim = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 5.6), bannerMat);
  scrim.position.set(0, 5.4, s + 0.08);
  group.add(scrim);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), beacon);
  bulb.position.set(-1.2, H + 2.7, -1.2);
  group.add(bulb);
  return { group, mats: [steelMat, darkMat, grilleMat, glow, bannerMat, beacon], glow, beacon };
}

/**
 * Crowd barrier round the pit (east, west, south): steel front, a top rail carrying an LED
 * strip, and feet on the crowd side.
 */
export function barricade(hx: number, hz: number, zNorth: number, led: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const parts: THREE.BufferGeometry[] = [];
  const x = hx + 1.3;
  const zS = hz + 1.3;
  const lenZ = zS - zNorth;
  const midZ = (zS + zNorth) / 2;
  for (const sx of [-1, 1]) {
    parts.push(box(0.1, 1.15, lenZ, sx * x, 0.58, midZ));
    parts.push(box(0.26, 0.12, lenZ, sx * x, 1.2, midZ));
    parts.push(box(1.1, 0.08, lenZ, sx * (x + 0.55), 0.04, midZ));
    for (let z = zNorth + 1; z < zS; z += 2.2) parts.push(box(0.06, 1.1, 0.9, sx * (x + 0.45), 0.55, z));
  }
  parts.push(box(x * 2, 1.15, 0.1, 0, 0.58, zS));
  parts.push(box(x * 2, 0.12, 0.26, 0, 1.2, zS));
  parts.push(box(x * 2, 0.08, 1.1, 0, 0.04, zS + 0.55));
  for (let xx = -x + 1; xx < x; xx += 2.2) parts.push(box(0.9, 1.1, 0.06, xx, 0.55, zS + 0.45));
  g.add(new THREE.Mesh(merge(parts), new THREE.MeshStandardMaterial({ color: 0x565a66, metalness: 0.85, roughness: 0.35 })));
  // LED strips along the top rails (uv.x runs along the strip)
  const strip = (len: number): THREE.PlaneGeometry => {
    const p = new THREE.PlaneGeometry(len, 0.16);
    p.rotateX(-Math.PI / 2);
    return p;
  };
  for (const sx of [-1, 1]) {
    const m = new THREE.Mesh(strip(lenZ), led);
    m.rotation.y = (sx * Math.PI) / 2;
    m.position.set(sx * x, 1.27, midZ);
    g.add(m);
  }
  const s = new THREE.Mesh(strip(x * 2), led);
  s.position.set(0, 1.27, zS);
  g.add(s);
  return g;
}

export interface Stadium {
  group: THREE.Group;
  ravers: Raver[];
  ribbon: THREE.Mesh;
}

/**
 * The bowl: two tiers of stands wrapping the field (east, south, west), an LED ribbon board
 * between the tiers, and a crown of floodlights on the rim. Returns seat positions for the crowd.
 */
export function stadium(ribbonMat: THREE.Material, rnd: () => number): Stadium {
  const W = 132;
  const S = 112;
  const RC = 42;
  const zN = -80;
  const path = standPath(W, S, RC, zN, 3);
  const TD = 1.7;
  const tiers: { d: number; h: number }[] = [];
  for (let k = 0; k < 22; k++) {
    const upper = k >= 10 ? 1 : 0;
    tiers.push({ d: 3 + k * TD + upper * 1.6, h: 1.4 + k * 0.82 + upper * 2.8 });
  }
  const parts: THREE.BufferGeometry[] = [];
  parts.push(pathStrip(path, 3, 0, 3, tiers[0]!.h));
  tiers.forEach((t, k) => {
    const next = tiers[k + 1];
    const end = next ? next.d : t.d + TD;
    parts.push(pathStrip(path, t.d, t.h, end, t.h));
    if (next) parts.push(pathStrip(path, end, t.h, end, next.h));
  });
  const last = tiers[tiers.length - 1]!;
  const rim = last.d + TD;
  parts.push(pathStrip(path, rim, last.h, rim, last.h + 5));
  parts.push(pathStrip(path, rim, last.h + 5, rim + 3, last.h + 5));
  for (const p of parts) p.deleteAttribute('uv');
  const bowl = mergeGeometries(parts)!;
  const group = new THREE.Group();
  group.add(new THREE.Mesh(bowl, new THREE.MeshStandardMaterial({ color: 0x1b1a24, roughness: 0.92, metalness: 0.05, side: THREE.DoubleSide })));
  // ribbon board on the fascia between the tiers
  const t9 = tiers[9]!;
  const t10 = tiers[10]!;
  const ribbon = new THREE.Mesh(pathStrip(path, t10.d - 0.02, t9.h + 0.25, t10.d - 0.02, t10.h - 0.25, 1 / 24), ribbonMat);
  group.add(ribbon);
  // floodlight crown along the rim: hot white lamps angled into the bowl
  const lamps: THREE.Vector3[] = [];
  alongPath(path, rim + 1.5, 9, (x, z) => lamps.push(new THREE.Vector3(x, last.h + 6.4, z)));
  const lampMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(2.2, 1.1, 0.3),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff4e0).multiplyScalar(2.2), toneMapped: false }),
    lamps.length,
  );
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  lamps.forEach((p, i) => {
    q.setFromEuler(new THREE.Euler(-0.5, Math.atan2(-p.x, -p.z), 0, 'YXZ'));
    m4.compose(p, q, one);
    lampMesh.setMatrixAt(i, m4);
  });
  group.add(lampMesh);
  // the crowd: a raver on every seat
  const ravers: Raver[] = [];
  for (const t of tiers) {
    alongPath(path, t.d + TD * 0.55, 1.12 + rnd() * 0.08, (x, z) => {
      if (rnd() < 0.06) return;
      const px = x + (rnd() - 0.5) * 0.3;
      const pz = z + (rnd() - 0.5) * 0.3;
      const r = rnd();
      ravers.push({
        x: px,
        y: t.h,
        z: pz,
        yaw: Math.atan2(px, -40 - pz) + (rnd() - 0.5) * 0.4,
        seed: rnd(),
        lit: r < 0.14 ? 1 : r < 0.5 ? 2 : 0,
      });
    });
  }
  return { group, ravers, ribbon };
}

/** A floodlight mast: lattice tower, a head frame full of white-hot lamps, and its glare. */
export function lightTower(x: number, z: number, h: number, glare: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const parts: THREE.BufferGeometry[] = [];
  parts.push(...truss(v3(0, 0, 0), v3(0, h, 0), 2.4, 0.12));
  parts.push(box(9, 0.4, 1.2, 0, h + 0.2, 0));
  parts.push(box(9, 6, 0.5, 0, h + 3.2, -0.4));
  g.add(new THREE.Mesh(merge(parts), steel()));
  const lamps: THREE.BufferGeometry[] = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) lamps.push(box(1.2, 1.1, 0.2, -3.6 + c * 1.45, h + 0.9 + r * 1.4, -0.1));
  g.add(new THREE.Mesh(merge(lamps), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xf4f7ff).multiplyScalar(3), toneMapped: false })));
  const card = new THREE.Mesh(new THREE.PlaneGeometry(40, 30), glare);
  card.position.set(0, h + 3, 1.5);
  g.add(card);
  g.position.set(x, 0, z);
  // face the field centre
  g.rotation.y = Math.atan2(-x, -z);
  return g;
}

export interface SideStage {
  group: THREE.Group;
  /** beam origins in world space */
  heads: THREE.Vector3[];
  facing: THREE.Vector3;
}

/** A second stage off to the side of the field: deck, screen, truss arch, PA and a light rig. */
export function sideStage(x: number, z: number, lookX: number, lookZ: number, led: THREE.Material, trim: THREE.Material): SideStage {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(box(30, 2.2, 14, 0, 1.1, -3), new THREE.MeshStandardMaterial({ color: 0x141319, roughness: 0.5 })));
  const t: THREE.BufferGeometry[] = [];
  t.push(...truss(v3(-16, 0, -8), v3(-16, 17, -8), 1.2, 0.07));
  t.push(...truss(v3(16, 0, -8), v3(16, 17, -8), 1.2, 0.07));
  t.push(...truss(v3(-16.6, 17, -8), v3(16.6, 17, -8), 1.2, 0.07));
  t.push(...truss(v3(-16, 14, 2), v3(16, 14, 2), 0.9, 0.06));
  t.push(...truss(v3(-16, 17, -8), v3(-16, 14, 2), 0.9, 0.06));
  t.push(...truss(v3(16, 17, -8), v3(16, 14, 2), 0.9, 0.06));
  g.add(new THREE.Mesh(merge(t), steel()));
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(24, 10.5), led);
  screen.position.set(0, 8.2, -8.6);
  g.add(screen);
  g.add(new THREE.Mesh(box(25, 11.5, 0.5, 0, 8.2, -9.1), new THREE.MeshStandardMaterial({ color: 0x0b0b0f, roughness: 0.6 })));
  const pa: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) for (let i = 0; i < 7; i++) pa.push(box(2.4, 0.8, 1.5, sx * 18.5, 15 - i * 0.84, 0, 0, 0.04 * i));
  for (const sx of [-1, 1]) pa.push(box(3, 2.2, 2.2, sx * 12, 3.3, 3));
  g.add(new THREE.Mesh(merge(pa), new THREE.MeshStandardMaterial({ color: 0x111116, roughness: 0.6 })));
  g.add(new THREE.Mesh(box(30, 0.12, 0.12, 0, 2.22, 4), trim));
  g.position.set(x, 0, z);
  g.rotation.y = Math.atan2(lookX - x, lookZ - z);
  g.updateMatrixWorld(true);
  const heads: THREE.Vector3[] = [];
  for (let i = 0; i < 4; i++) heads.push(new THREE.Vector3(-12 + i * 8, 13.4, 2).applyMatrix4(g.matrixWorld));
  const facing = new THREE.Vector3(0, 0, 1).applyQuaternion(g.quaternion);
  return { group: g, heads, facing };
}

export interface Crane {
  group: THREE.Group;
  arm: THREE.Object3D;
  tally: THREE.MeshBasicMaterial;
}

/** Camera jib on the stage lip: dolly, post, a long truss arm and a remote head with a tally light. */
export function cameraCrane(): Crane {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x17161d, roughness: 0.5, metalness: 0.4 });
  g.add(new THREE.Mesh(merge([box(2.4, 0.5, 2.4, 0, 0.25, 0), rod(v3(0, 0.5, 0), v3(0, 4.2, 0), 0.22, 10)]), dark));
  const arm = new THREE.Object3D();
  arm.position.y = 4.3;
  const a: THREE.BufferGeometry[] = [];
  a.push(...truss(v3(0, 0, -3.5), v3(0, 0, 13), 0.55, 0.05));
  a.push(box(1.2, 1.2, 1.2, 0, -0.3, -4.1));
  a.push(box(0.9, 0.8, 1.3, 0, -0.9, 13.4));
  a.push(rod(v3(0, -0.4, 13.2), v3(0, -0.9, 13.4), 0.08, 5));
  arm.add(new THREE.Mesh(merge(a), dark));
  const lensGeo = new THREE.CylinderGeometry(0.28, 0.34, 0.6, 14);
  lensGeo.rotateX(Math.PI / 2);
  lensGeo.translate(0, -0.9, 14.3);
  arm.add(new THREE.Mesh(lensGeo, new THREE.MeshStandardMaterial({ color: 0x0a0a0c, metalness: 0.6, roughness: 0.2 })));
  const tally = new THREE.MeshBasicMaterial({ color: 0xff2030, toneMapped: false });
  const tl = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), tally);
  tl.position.set(0, -0.4, 13.9);
  arm.add(tl);
  g.add(arm);
  return { group: g, arm, tally };
}

/**
 * Front-of-house: the mixing riser out in the field, two decks of scaffold under a black
 * canopy, desk glow spilling out, a pair of follow-spot operators on the top deck.
 */
export function fohRiser(glow: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const st: THREE.BufferGeometry[] = [];
  const posts: [number, number][] = [];
  for (const x of [-6, -2, 2, 6]) for (const z of [-4, 0, 4]) posts.push([x, z]);
  for (const [x, z] of posts) st.push(rod(v3(x, 0, z), v3(x, 7.4, z), 0.08, 5));
  for (const y of [1.3, 4.4])
    for (const z of [-4, 0, 4]) st.push(rod(v3(-6, y, z), v3(6, y, z), 0.05, 4));
  for (const x of [-6, 6]) st.push(rod(v3(x, 5.4, -4), v3(x, 5.4, 4), 0.04, 4));
  st.push(box(12.6, 0.15, 8.6, 0, 1.3, 0), box(12.6, 0.15, 8.6, 0, 4.4, 0));
  g.add(new THREE.Mesh(merge(st), steel()));
  const dark: THREE.BufferGeometry[] = [];
  // canopy: a shallow black pyramid roof with an LED hem
  const roof = new THREE.ConeGeometry(8.4, 1.4, 4, 1);
  roof.rotateY(Math.PI / 4);
  roof.scale(1.05, 1, 0.75);
  roof.translate(0, 8.1, 0);
  g.add(new THREE.Mesh(roof, new THREE.MeshStandardMaterial({ color: 0x050508, roughness: 0.9, metalness: 0 })));
  dark.push(box(8, 1.0, 2.2, 0, 1.9, -1), box(6, 0.9, 1.6, 0, 5.0, 1.5));
  for (const x of [-3, 3]) dark.push(box(0.8, 0.8, 1.6, x, 5.3, -2.6));
  g.add(new THREE.Mesh(merge(dark), new THREE.MeshStandardMaterial({ color: 0x101016, roughness: 0.7, metalness: 0.2 })));
  const gl: THREE.BufferGeometry[] = [box(7.6, 0.04, 1.8, 0, 2.42, -1.1), box(5.6, 0.04, 1.2, 0, 5.46, 1.4)];
  gl.push(box(12.7, 0.06, 0.06, 0, 1.4, 4.35), box(12.7, 0.06, 0.06, 0, 4.5, 4.35));
  gl.push(box(12.5, 0.08, 0.08, 0, 7.42, 4.45), box(12.5, 0.08, 0.08, 0, 7.42, -4.45));
  gl.push(box(0.08, 0.08, 8.9, -6.25, 7.42, 0), box(0.08, 0.08, 8.9, 6.25, 7.42, 0));
  g.add(new THREE.Mesh(merge(gl), glow));
  return g;
}

/** Stage roof: front/mid/back truss spans on four tower legs, with wing towers either side. */
export function stageRoof(hx: number, zFront: number, zBack: number, y: number): THREE.BufferGeometry {
  const t: THREE.BufferGeometry[] = [];
  const zMid = (zFront + zBack) / 2;
  for (const z of [zFront, zMid, zBack]) t.push(...truss(v3(-hx - 1, y, z), v3(hx + 1, y, z), 1.5, 0.08));
  for (let x = -hx; x <= hx + 0.1; x += hx / 3) t.push(...truss(v3(x, y, zFront), v3(x, y, zBack), 1.2, 0.07));
  for (const x of [-hx, hx]) for (const z of [zFront, zBack]) t.push(...truss(v3(x, 0, z), v3(x, y + 0.8, z), 2.2, 0.1));
  return merge(t);
}
