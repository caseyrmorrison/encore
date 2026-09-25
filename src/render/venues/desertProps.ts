import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { canvasTexture, M } from '../materials';
import { beamGeometry, makeBeamMaterial, makeFlameMaterial } from './venue';

/**
 * Set dressing for the NEON DESERT: the art installations, art cars and the effigy on the
 * horizon. Everything is procedural; the animated neon runs in shaders that share a handful
 * of uniforms with the venue, so the CPU only touches a few dozen transforms per frame.
 */

export interface SharedUniforms {
  uTime: THREE.IUniform<number>;
  /** 0..1 kick envelope (1 on the beat) */
  uBeat: THREE.IUniform<number>;
  uDrop: THREE.IUniform<number>;
  uFinale: THREE.IUniform<number>;
  /** alternates 0/1 on every 16th: the DROP strobe */
  uStrobe: THREE.IUniform<number>;
  uEnergy: THREE.IUniform<number>;
  uCols: THREE.IUniform<THREE.Color[]>;
}

const UP = new THREE.Vector3(0, 1, 0);

/* ───────────────────────────── geometry helpers ───────────────────────────── */

/** A cylinder strut from a to b. */
export function strut(a: THREE.Vector3, b: THREE.Vector3, r: number, radial = 5): THREE.BufferGeometry {
  const d = new THREE.Vector3().subVectors(b, a);
  const g = new THREE.CylinderGeometry(r, r, d.length(), radial, 1, true);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

/** Merge parts that only share position/normal(/uv), tagging each with optional per-part floats. */
export function merge(parts: THREE.BufferGeometry[], keepUv = false, tags?: Record<string, number[]>): THREE.BufferGeometry {
  const clean = parts.map((g, i) => {
    const ng = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(ng.attributes)) if (k !== 'position' && k !== 'normal' && !(keepUv && k === 'uv')) ng.deleteAttribute(k);
    if (tags) {
      for (const [name, vals] of Object.entries(tags)) {
        const n = ng.getAttribute('position').count;
        ng.setAttribute(name, new THREE.BufferAttribute(new Float32Array(n).fill(vals[i] ?? 0), 1));
      }
    }
    return ng;
  });
  const m = mergeGeometries(clean)!;
  m.computeBoundingSphere();
  return m;
}

const hash = (n: number): number => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/* ───────────────────────────── materials ───────────────────────────── */

const neonCache = new Map<string, THREE.MeshBasicMaterial>();
/** Unlit neon: colour pushed past 1 so the bloom picks it up. */
export function neon(color: number, k = 2.2): THREE.MeshBasicMaterial {
  const key = `${color}_${k}`;
  let m = neonCache.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k) });
    neonCache.set(key, m);
  }
  return m;
}

const CHASE_VERT = /* glsl */ `
uniform vec3 uAxis;
uniform float uUseAxis;
varying float vAlong;
void main() {
  vAlong = uUseAxis > 0.5 ? dot(position, uAxis) : uv.x;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const CHASE_FRAG = /* glsl */ `
uniform vec3 uA;
uniform vec3 uB;
uniform float uTime;
uniform float uFreq;
uniform float uSpeed;
uniform float uBase;
uniform float uBoost;
uniform float uOpacity;
uniform float uDrop;
uniform float uStrobe;
uniform float uFinale;
varying float vAlong;
void main() {
  // pulses of light race along the tube (or up the object), faster in a DROP
  float s = fract(vAlong * uFreq - uTime * uSpeed * (1.0 + uDrop));
  float pulse = smoothstep(0.0, 0.05, s) * smoothstep(0.45, 0.05, s);
  float k = uBase + pulse * 1.5 + uBoost;
  vec3 col = mix(uA, uB, pulse) * k;
  col = mix(col, vec3(2.6, 2.4, 2.2), uStrobe * uDrop * 0.35);
  col = mix(col, vec3(1.0, 0.68, 0.22) * (k + 0.6) * 1.2, uFinale * 0.75);
  gl_FragColor = vec4(col, uOpacity);
}`;

export interface ChaseOpts {
  axis?: [number, number, number];
  freq?: number;
  speed?: number;
  base?: number;
}

/** Neon whose light chases along the tube's length (uv.x) or along an object-space axis. */
export function chaseMat(u: SharedUniforms, a: number, b: number, o: ChaseOpts = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uA: { value: new THREE.Color(a) },
      uB: { value: new THREE.Color(b) },
      uAxis: { value: new THREE.Vector3(...(o.axis ?? [0, 1, 0])) },
      uUseAxis: { value: o.axis ? 1 : 0 },
      uFreq: { value: o.freq ?? 3 },
      uSpeed: { value: o.speed ?? 0.5 },
      uBase: { value: o.base ?? 1.1 },
      uBoost: { value: 0 },
      uOpacity: { value: 1 },
      uTime: u.uTime,
      uDrop: u.uDrop,
      uStrobe: u.uStrobe,
      uFinale: u.uFinale,
    },
    vertexShader: CHASE_VERT,
    fragmentShader: CHASE_FRAG,
  });
}

/** Fade helper for props that can stand between the camera and the performer. */
export class Fader {
  private readonly mats: THREE.Material[] = [];
  opacity = 1;
  add<T extends THREE.Material>(m: T): T {
    m.transparent = true;
    this.mats.push(m);
    return m;
  }
  update(target: number): void {
    this.opacity += (target - this.opacity) * 0.15;
    const depth = this.opacity > 0.9;
    for (const m of this.mats) {
      if (m instanceof THREE.ShaderMaterial) m.uniforms.uOpacity!.value = this.opacity;
      else m.opacity = this.opacity;
      m.depthWrite = depth;
    }
  }
}

/* ───────────────────────────── geodesic dome ───────────────────────────── */

export interface Dome {
  group: THREE.Group;
  fader: Fader;
  struts: THREE.ShaderMaterial;
  orb: THREE.Mesh;
  orbMat: THREE.MeshBasicMaterial;
  panels: THREE.MeshBasicMaterial;
}

/** A 3V geodesic frame: glowing struts, bright hubs, a few panels of coloured shade cloth. */
export function buildDome(u: SharedUniforms, radius: number): Dome {
  const group = new THREE.Group();
  const ico = new THREE.IcosahedronGeometry(1, 2);
  // stand the icosahedron on a vertex so the crown is a five-way hub
  const top = new THREE.Vector3(0, 1, 1.618034).normalize();
  ico.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(top, UP));
  const pos = ico.getAttribute('position') as THREE.BufferAttribute;
  const key = (v: THREE.Vector3): string => `${v.x.toFixed(3)},${v.y.toFixed(3)},${v.z.toFixed(3)}`;
  const edges = new Map<string, [THREE.Vector3, THREE.Vector3]>();
  const hubs = new Map<string, THREE.Vector3>();
  const panelParts: THREE.BufferGeometry[] = [];
  const panelCols: number[] = [];
  const cloth = [0xff3df0, 0x2ee6ff, 0x9a4dff, 0xffb347];
  const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  for (let t = 0; t < pos.count; t += 3) {
    for (let k = 0; k < 3; k++) v[k]!.fromBufferAttribute(pos, t + k);
    const minY = Math.min(v[0]!.y, v[1]!.y, v[2]!.y);
    for (let k = 0; k < 3; k++) {
      const a = v[k]!.clone();
      const b = v[(k + 1) % 3]!.clone();
      if (Math.max(a.y, b.y) < 0.02) continue;
      a.y = Math.max(a.y, 0);
      b.y = Math.max(b.y, 0);
      const ka = key(a);
      const kb = key(b);
      edges.set(ka < kb ? ka + kb : kb + ka, [a, b]);
      hubs.set(ka, a);
      hubs.set(kb, b);
    }
    // shade cloth on a scattering of the upper triangles
    if (minY > 0.15 && hash(t * 0.37) < 0.22) {
      const g = new THREE.BufferGeometry().setFromPoints(v.map((p) => p.clone().multiplyScalar(0.985)));
      g.computeVertexNormals();
      panelParts.push(g);
      panelCols.push(cloth[Math.floor(hash(t * 1.7) * 4)]!);
    }
  }
  const parts: THREE.BufferGeometry[] = [];
  for (const [a, b] of edges.values()) parts.push(strut(a.clone().multiplyScalar(radius), b.clone().multiplyScalar(radius), 0.075, 5));
  const fader = new Fader();
  const struts = fader.add(chaseMat(u, 0x7a3dff, 0x2ee6ff, { axis: [0, 1, 0], freq: 0.22, speed: 0.45, base: 0.9 }));
  group.add(new THREE.Mesh(merge(parts), struts));
  const hubGeo = merge([...hubs.values()].map((h) => new THREE.SphereGeometry(0.16, 8, 6).translate(h.x * radius, h.y * radius, h.z * radius)));
  group.add(new THREE.Mesh(hubGeo, fader.add(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xe8f4ff).multiplyScalar(2.4) }))));
  // coloured shade cloth (tinted per panel with vertex colours)
  const clothGeo = merge(panelParts.map((g) => g.scale(radius, radius, radius)));
  const col = new Float32Array(clothGeo.getAttribute('position').count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < panelParts.length; i++) {
    c.setHex(panelCols[i]!);
    for (let k = 0; k < 3; k++) col.set([c.r, c.g, c.b], (i * 3 + k) * 3);
  }
  clothGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const panels = new THREE.MeshBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.2,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  group.add(new THREE.Mesh(clothGeo, panels));
  // a chill-out rug under the frame and a lantern orb hanging from the crown
  const rug = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.86, 48), new THREE.MeshStandardMaterial({ map: mandala(), roughness: 0.95 }));
  rug.rotation.x = -Math.PI / 2;
  rug.position.y = 0.03;
  group.add(rug);
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, radius * 0.3, 4), M.darkChrome());
  cord.position.y = radius * 0.85;
  group.add(cord);
  const orbMat = fader.add(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xb07aff).multiplyScalar(2.5) }));
  const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 2), orbMat);
  orb.position.y = radius * 0.66;
  group.add(orb);
  return { group, fader, struts, orb, orbMat, panels };
}

function mandala(): THREE.CanvasTexture {
  return canvasTexture(512, 512, (g, w, h) => {
    const cx = w / 2;
    const cy = h / 2;
    g.fillStyle = '#2a1030';
    g.fillRect(0, 0, w, h);
    const rings = ['#6a1f5a', '#c2473a', '#e8a33a', '#2a6a8a', '#5a2a8a', '#c23a7a'];
    for (let i = 0; i < 14; i++) {
      const r = 240 - i * 17;
      g.fillStyle = rings[i % rings.length]!;
      g.beginPath();
      const petals = 8 + (i % 3) * 4;
      for (let k = 0; k <= petals * 8; k++) {
        const a = (k / (petals * 8)) * Math.PI * 2;
        const rr = r * (0.92 + 0.08 * Math.cos(a * petals));
        g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      }
      g.fill();
    }
    g.strokeStyle = 'rgba(255,230,190,0.35)';
    g.lineWidth = 2;
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(cx + Math.cos(a) * 240, cy + Math.sin(a) * 240);
      g.stroke();
    }
    // dust on the rug: it's been out here all week
    const grd = g.createRadialGradient(cx, cy, 60, cx, cy, 256);
    grd.addColorStop(0, 'rgba(120,100,90,0.05)');
    grd.addColorStop(1, 'rgba(150,130,110,0.45)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  });
}

/* ───────────────────────────── hamsa hand ───────────────────────────── */

const EYE_FRAG = /* glsl */ `
uniform vec2 uIris;
uniform float uLid;
uniform float uGlow;
uniform float uTime;
uniform float uOpacity;
uniform float uFinale;
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * vec2(2.8, 1.8);
  // almond: two arcs meeting at pointed corners; uLid closes it for a blink
  float half_ = 0.82 * (1.0 - p.x * p.x / 1.96) * uLid;
  float inEye = step(abs(p.y), half_) * step(abs(p.x), 1.4);
  float edge = abs(abs(p.y) - half_);
  float outline = smoothstep(0.07, 0.0, edge) * step(abs(p.x), 1.4);
  vec2 q = p - uIris;
  float ir = length(q);
  float iris = smoothstep(0.52, 0.49, ir);
  float pupil = smoothstep(0.22, 0.2, ir);
  float ang = atan(q.y, q.x);
  vec3 irisCol = mix(vec3(0.1, 0.9, 1.0), vec3(0.7, 0.25, 1.0), 0.5 + 0.5 * sin(ang * 6.0 + uTime));
  irisCol *= 0.7 + 0.6 * smoothstep(0.2, 0.5, ir);
  vec3 col = vec3(0.12, 0.1, 0.16);
  col = mix(col, irisCol * (1.2 + uGlow * 2.0), iris);
  col = mix(col, vec3(0.0), pupil);
  col += vec3(1.0) * smoothstep(0.08, 0.04, length(q - vec2(-0.14, 0.14))) * 1.5;
  col *= inEye;
  vec3 gold = mix(vec3(1.0, 0.72, 0.25), vec3(1.0, 0.45, 0.1), uFinale);
  col += gold * outline * (2.2 + uGlow);
  float a = max(inEye, outline) * uOpacity;
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, a);
}`;

export interface Hand {
  group: THREE.Group;
  eye: THREE.ShaderMaterial;
  fader: Fader;
  outline: THREE.ShaderMaterial;
  /** world position of the eye (for its gaze) */
  eyeWorld: THREE.Vector3;
}

/** A giant hamsa rising from the dust, outlined in neon, an eye in the palm that follows you. */
export function buildHand(u: SharedUniforms): Hand {
  const group = new THREE.Group();
  const fader = new Fader();
  const half = new THREE.Path();
  half.moveTo(0, 0);
  half.lineTo(1.25, 0);
  half.quadraticCurveTo(1.45, 0.6, 1.65, 1.4);
  half.quadraticCurveTo(2.35, 1.6, 2.85, 2.6);
  half.quadraticCurveTo(3.35, 3.2, 3.1, 3.85);
  half.quadraticCurveTo(2.7, 4.05, 2.3, 3.55);
  half.quadraticCurveTo(1.95, 3.9, 1.95, 4.7);
  half.lineTo(1.95, 6.5);
  half.quadraticCurveTo(1.95, 7.15, 1.52, 7.15);
  half.quadraticCurveTo(1.1, 7.15, 1.1, 6.5);
  half.lineTo(1.06, 5.35);
  half.lineTo(0.64, 5.35);
  half.lineTo(0.6, 7.55);
  half.quadraticCurveTo(0.6, 8.25, 0, 8.25);
  const right = half.getPoints(6);
  const left = right
    .slice(1, -1)
    .reverse()
    .map((p) => new THREE.Vector2(-p.x, p.y));
  const outlinePts = [...right, ...left];
  const shape = new THREE.Shape(outlinePts);
  const body = new THREE.ExtrudeGeometry(shape, { depth: 0.7, bevelEnabled: true, bevelThickness: 0.14, bevelSize: 0.1, bevelSegments: 2, curveSegments: 6 });
  body.translate(0, 0, -0.35);
  const metal = fader.add(new THREE.MeshStandardMaterial({ color: 0x241a2e, metalness: 0.65, roughness: 0.38 }));
  group.add(new THREE.Mesh(body, metal));
  // neon outline hugging the front face
  const curve = new THREE.CatmullRomCurve3(outlinePts.map((p) => new THREE.Vector3(p.x * 1.02, p.y * 1.01, 0.52)), true, 'centripetal');
  const outline = fader.add(chaseMat(u, 0xff3df0, 0xffd0ff, { freq: 2, speed: 0.35, base: 1.3 }));
  group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 260, 0.075, 6, true), outline));
  // mehndi dots along the fingers and an arc over the eye
  const dots: THREE.BufferGeometry[] = [];
  for (const x of [-1.52, 1.52]) for (let k = 0; k < 4; k++) dots.push(new THREE.SphereGeometry(0.1, 8, 6).translate(x, 5.2 + k * 0.45, 0.5));
  for (let k = 0; k < 6; k++) dots.push(new THREE.SphereGeometry(0.11, 8, 6).translate(0, 5.0 + k * 0.45, 0.5));
  for (let k = 0; k < 11; k++) {
    const a = Math.PI * (0.12 + (k / 10) * 0.76);
    dots.push(new THREE.SphereGeometry(0.09, 8, 6).translate(Math.cos(a) * 1.75, 3.1 + Math.sin(a) * 1.35, 0.5));
  }
  group.add(new THREE.Mesh(merge(dots), fader.add(new THREE.MeshBasicMaterial({ color: new THREE.Color(0x2ee6ff).multiplyScalar(2.2) }))));
  // the eye
  const eye = new THREE.ShaderMaterial({
    uniforms: {
      uIris: { value: new THREE.Vector2() },
      uLid: { value: 1 },
      uGlow: { value: 0 },
      uTime: u.uTime,
      uFinale: u.uFinale,
      uOpacity: { value: 1 },
    },
    vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: EYE_FRAG,
  });
  fader.add(eye);
  const eyeMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 1.8), eye);
  eyeMesh.position.set(0, 3.0, 0.53);
  group.add(eyeMesh);
  // a drift of sand the wrist erupts from
  const mound = new THREE.Mesh(new THREE.SphereGeometry(2.4, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2), fader.add(new THREE.MeshStandardMaterial({ color: 0x3a2e2c, roughness: 1 })));
  mound.scale.set(1.25, 0.32, 0.9);
  group.add(mound);
  return { group, eye, fader, outline, eyeWorld: new THREE.Vector3() };
}

/* ───────────────────────────── double-helix spiral ───────────────────────────── */

export interface Spiral {
  group: THREE.Group;
  spin: THREE.Group;
  fader: Fader;
  mats: THREE.ShaderMaterial[];
  crown: THREE.MeshBasicMaterial;
}

export function buildSpiral(u: SharedUniforms): Spiral {
  const group = new THREE.Group();
  const spin = new THREE.Group();
  group.add(spin);
  const fader = new Fader();
  const H = 9.5;
  const turns = 3.2;
  const helix = (phase: number): THREE.Vector3[] => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 120; i++) {
      const t = i / 120;
      const a = t * turns * Math.PI * 2 + phase;
      const r = 2.5 * (1 - t * 0.72);
      pts.push(new THREE.Vector3(Math.cos(a) * r, 0.4 + t * H, Math.sin(a) * r));
    }
    return pts;
  };
  const a = helix(0);
  const b = helix(Math.PI);
  const mats = [
    fader.add(chaseMat(u, 0xffb347, 0xfff2c0, { freq: 4, speed: 0.6, base: 1.2 })),
    fader.add(chaseMat(u, 0xff3df0, 0xffd0ff, { freq: 4, speed: 0.6, base: 1.2 })),
  ];
  spin.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(a), 360, 0.13, 7), mats[0]));
  spin.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(b), 360, 0.13, 7), mats[1]));
  // rungs between the strands, a dark mast through the middle
  const rungs: THREE.BufferGeometry[] = [];
  for (let i = 4; i < 120; i += 6) rungs.push(strut(a[i]!, b[i]!, 0.045, 4));
  const steel = fader.add(new THREE.MeshStandardMaterial({ color: 0x3a3440, metalness: 0.9, roughness: 0.3 }));
  spin.add(new THREE.Mesh(merge(rungs), steel));
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, H + 1.4, 10), steel);
  mast.position.y = (H + 1.4) / 2;
  group.add(mast);
  const crown = fader.add(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff0c0).multiplyScalar(2.6) }));
  const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 0), crown);
  star.position.y = H + 1.6;
  star.scale.set(1, 1.6, 1);
  spin.add(star);
  // plinth with a glowing lip
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(2.7, 2.9, 0.45, 32), fader.add(new THREE.MeshStandardMaterial({ color: 0x1c1822, roughness: 0.6 })));
  plinth.position.y = 0.22;
  group.add(plinth);
  const lip = new THREE.Mesh(new THREE.TorusGeometry(2.72, 0.05, 6, 64), neon(0xffb347, 2.4));
  lip.rotation.x = Math.PI / 2;
  lip.position.y = 0.46;
  group.add(lip);
  return { group, spin, fader, mats, crown };
}

/* ───────────────────────────── neon flowers ───────────────────────────── */

const PETAL_VERT = /* glsl */ `
varying float vR;
varying vec3 vN;
varying vec3 vV;
void main() {
  vR = length(position.xz);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const PETAL_FRAG = /* glsl */ `
uniform vec3 uA;
uniform vec3 uB;
uniform float uTime;
uniform float uPhase;
uniform float uBoost;
uniform float uOpacity;
uniform float uDrop;
uniform float uFinale;
varying float vR;
varying vec3 vN;
varying vec3 vV;
void main() {
  // steel petals: a dark heart, glowing tips, a neon rim, and rings of light running outward
  float t = clamp(vR / 1.75, 0.0, 1.0);
  float rim = pow(1.0 - abs(dot(normalize(vN), vV)), 2.5);
  float run = smoothstep(0.12, 0.0, abs(t - fract(uTime * (0.45 + uDrop * 0.8) + uPhase)));
  vec3 a = mix(uA, vec3(1.0, 0.62, 0.2), uFinale);
  vec3 col = mix(a * 0.05, a * 0.8, t * t) + uB * (rim * 0.9 + run * 0.9 + uBoost * t * t);
  gl_FragColor = vec4(col, uOpacity);
}`;

function petalMat(u: SharedUniforms, a: number, b: number, phase: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uA: { value: new THREE.Color(a) },
      uB: { value: new THREE.Color(b) },
      uPhase: { value: phase },
      uBoost: { value: 0 },
      uOpacity: { value: 1 },
      uTime: u.uTime,
      uDrop: u.uDrop,
      uFinale: u.uFinale,
    },
    vertexShader: PETAL_VERT,
    fragmentShader: PETAL_FRAG,
    side: THREE.DoubleSide,
  });
}

export interface Flowers {
  group: THREE.Group;
  heads: THREE.Group[];
  fader: Fader;
  petalMats: THREE.ShaderMaterial[];
}

/** A little meadow of giant steel flowers whose petals glow and open with the bass. */
export function buildFlowers(u: SharedUniforms): Flowers {
  const group = new THREE.Group();
  const fader = new Fader();
  const heads: THREE.Group[] = [];
  const petalMats: THREE.ShaderMaterial[] = [];
  const stemMat = fader.add(new THREE.MeshStandardMaterial({ color: 0x1a2a22, metalness: 0.6, roughness: 0.4 }));
  const cols: [number, number][] = [
    [0xff2d9a, 0xff6ad0],
    [0x8a3dff, 0xb070ff],
    [0x1ad0ff, 0x6ae8ff],
    [0xff5a2a, 0xffa060],
    [0x6aff3d, 0xb0ff70],
  ];
  const spots: [number, number, number][] = [
    [0, 0, 6.2],
    [-1.8, 0.9, 4.6],
    [1.7, 0.7, 5.0],
    [-0.6, -1.6, 3.6],
    [1.2, -1.4, 3.1],
  ];
  const petal = new THREE.SphereGeometry(1, 12, 8);
  petal.scale(0.42, 0.08, 1);
  petal.translate(0, 0, 1);
  spots.forEach(([x, z, h], i) => {
    const lean = new THREE.Vector3(x * 0.25, 0, z * 0.25 + 0.6);
    const stem = new THREE.CatmullRomCurve3([
      new THREE.Vector3(x, 0, z),
      new THREE.Vector3(x + lean.x * 0.2, h * 0.4, z + lean.z * 0.2),
      new THREE.Vector3(x + lean.x * 0.7, h * 0.8, z + lean.z * 0.7),
      new THREE.Vector3(x + lean.x, h, z + lean.z),
    ]);
    group.add(new THREE.Mesh(new THREE.TubeGeometry(stem, 24, 0.09 + h * 0.012, 6), stemMat));
    // a leaf halfway up
    const leaf = new THREE.Mesh(petal, stemMat);
    leaf.position.copy(stem.getPoint(0.35));
    leaf.rotation.set(0.5, i * 2.1, 0.3);
    leaf.scale.setScalar(0.8);
    group.add(leaf);
    const head = new THREE.Group();
    head.position.set(x + lean.x, h, z + lean.z);
    head.rotation.x = 0.35;
    const [ca, cb] = cols[i % cols.length]!;
    const pm = fader.add(petalMat(u, ca, cb, i * 0.7));
    petalMats.push(pm);
    const n = 8;
    const parts: THREE.BufferGeometry[] = [];
    for (let k = 0; k < n; k++) {
      const g = petal.clone();
      g.rotateX(-0.55);
      g.rotateY((k / n) * Math.PI * 2);
      parts.push(g);
    }
    head.add(new THREE.Mesh(merge(parts), pm));
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 10), fader.add(new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc24d).multiplyScalar(2.2) })));
    core.scale.y = 0.6;
    head.add(core);
    group.add(head);
    heads.push(head);
  });
  return { group, heads, fader, petalMats };
}

/* ───────────────────────────── LED totems ───────────────────────────── */

const TOTEM_VERT = /* glsl */ `
attribute float aSeg;
varying float vSeg;
varying float vPhase;
void main() {
  vSeg = aSeg;
  vec3 ip = instanceMatrix[3].xyz;
  vPhase = fract(sin(dot(ip.xz, vec2(12.9898, 78.233))) * 43758.5453);
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
}`;

const TOTEM_FRAG = /* glsl */ `
uniform vec3 uCols[4];
uniform float uTime;
uniform float uBeat;
uniform float uDrop;
uniform float uStrobe;
uniform float uFinale;
uniform float uLevel;
varying float vSeg;
varying float vPhase;
vec3 pal(float t) {
  t = fract(t) * 4.0;
  if (t < 1.0) return mix(uCols[0], uCols[1], t);
  if (t < 2.0) return mix(uCols[1], uCols[3], t - 1.0);
  if (t < 3.0) return mix(uCols[3], uCols[2], t - 2.0);
  return mix(uCols[2], uCols[0], t - 3.0);
}
void main() {
  const float N = 10.0;
  // a comet of light climbs each pole; the bottom segments are a VU meter for the band
  float head = fract(uTime * 0.55 + vPhase) * (N + 5.0) - 2.5;
  float comet = smoothstep(3.0, 0.0, head - vSeg) * step(vSeg, head + 0.5);
  float vu = step(vSeg + 0.5, uLevel * N);
  vec3 c = pal(vSeg * 0.06 + vPhase + uTime * 0.04);
  vec3 col = c * (0.35 + comet * 1.8 + vu * 0.7 + uBeat * 0.35) * 1.4;
  // DROP: every totem strobes white on alternate 16ths
  col = mix(col, vec3(3.2), uDrop * uStrobe);
  col = mix(col, pal(vSeg * 0.1 - uTime) * 2.2, uDrop * (1.0 - uStrobe) * 0.6);
  col = mix(col, vec3(2.6, 1.7, 0.6) * (0.6 + uStrobe * 0.8), uFinale);
  gl_FragColor = vec4(col, 1.0);
}`;

export interface Totems {
  group: THREE.Group;
  sleeves: THREE.ShaderMaterial;
  toppers: THREE.Object3D[];
}

export const TOTEM_H = 9;

export function buildTotems(u: SharedUniforms, spots: readonly { x: number; z: number }[]): Totems {
  const group = new THREE.Group();
  const n = spots.length;
  const poleGeo = new THREE.CylinderGeometry(0.1, 0.13, TOTEM_H, 8);
  poleGeo.translate(0, TOTEM_H / 2, 0);
  const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ color: 0x18161c, metalness: 0.7, roughness: 0.35 }), n);
  const segs: THREE.BufferGeometry[] = [];
  const idx: number[] = [];
  for (let k = 0; k < 10; k++) {
    segs.push(new THREE.CylinderGeometry(0.24, 0.24, 0.5, 12, 1).translate(0, 1.6 + k * 0.66, 0));
    idx.push(k);
  }
  const sleeveGeo = merge(segs, false, { aSeg: idx });
  const sleeves = new THREE.ShaderMaterial({
    uniforms: {
      uCols: u.uCols,
      uTime: u.uTime,
      uBeat: u.uBeat,
      uDrop: u.uDrop,
      uStrobe: u.uStrobe,
      uFinale: u.uFinale,
      uLevel: { value: 0 },
    },
    vertexShader: TOTEM_VERT,
    fragmentShader: TOTEM_FRAG,
  });
  const sleeveMesh = new THREE.InstancedMesh(sleeveGeo, sleeves, n);
  // weighted tripod feet so they read as planted, not floating sticks
  const feet: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    feet.push(strut(new THREE.Vector3(0, 1.2, 0), new THREE.Vector3(Math.cos(a) * 0.75, 0, Math.sin(a) * 0.75), 0.05, 4));
    feet.push(new THREE.SphereGeometry(0.14, 8, 6).translate(Math.cos(a) * 0.75, 0.05, Math.sin(a) * 0.75));
  }
  const footMesh = new THREE.InstancedMesh(merge(feet), M.darkChrome(), n);
  const m4 = new THREE.Matrix4();
  spots.forEach((s, i) => {
    m4.makeTranslation(s.x, 0, s.z);
    poles.setMatrixAt(i, m4);
    sleeveMesh.setMatrixAt(i, m4);
    footMesh.setMatrixAt(i, m4);
  });
  group.add(poles, sleeveMesh, footMesh);
  // toppers: every pole flies its own flag
  const toppers: THREE.Object3D[] = [];
  const topCols = [0x2ee6ff, 0xff3df0, 0xffc24d, 0x9a4dff, 0x7dff4d, 0xff6a4d];
  spots.forEach((s, i) => {
    const kind = i % 3;
    const c = topCols[i % topCols.length]!;
    let t: THREE.Object3D;
    if (kind === 0) {
      t = new THREE.Mesh(new THREE.IcosahedronGeometry(0.7, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(2.4), wireframe: true }));
    } else if (kind === 1) {
      const star = new THREE.Shape();
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2 + Math.PI / 2;
        const r = k % 2 ? 0.32 : 0.8;
        if (k === 0) star.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else star.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      const g = new THREE.ExtrudeGeometry(star, { depth: 0.14, bevelEnabled: false });
      g.translate(0, 0, -0.07);
      t = new THREE.Mesh(g, neon(c, 2.2));
    } else {
      t = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.07, 8, 32), neon(c, 2.4));
      const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.05, 8, 28), neon(0xffffff, 1.8));
      ring2.rotation.y = Math.PI / 2;
      t.add(ring, ring2);
    }
    t.position.set(s.x, TOTEM_H + 0.8, s.z);
    group.add(t);
    toppers.push(t);
  });
  return { group, sleeves, toppers };
}

/* ───────────────────────────── art cars ───────────────────────────── */

export interface ArtCar {
  group: THREE.Group;
  /** lane radius and angular speed of its loop round the arena */
  lane: number;
  speed: number;
  phase: number;
  glow: number;
  mats: THREE.ShaderMaterial[];
  spinner?: THREE.Object3D;
  flames?: { mat: THREE.ShaderMaterial; sprites: THREE.Mesh[] };
}

function wheels(len: number, width: number, n: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + (i / (n - 1)) * len;
    for (const z of [-width / 2, width / 2]) {
      const w = new THREE.CylinderGeometry(0.6, 0.6, 0.45, 14);
      w.rotateX(Math.PI / 2);
      w.translate(x, 0.6, z);
      parts.push(w);
    }
  }
  return merge(parts);
}

/** A glowing ellipse under a car (it also lights the floor via the venue shader). */
function underglow(len: number, width: number, color: number): THREE.Mesh {
  const tex = canvasTexture(128, 128, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grd.addColorStop(0, 'rgba(255,255,255,0.9)');
    grd.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  });
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(len * 1.5, width * 2.2),
    new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(color).multiplyScalar(0.9), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.05;
  return m;
}

/** A neon angler fish on a flatbed: ribbed body, fins, a lure dangling ahead. */
export function buildFishCar(u: SharedUniforms): ArtCar {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(wheels(5.6, 3, 3), M.rubber()));
  const deck = new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.5, 3.2), M.blackPlastic());
  deck.position.y = 1.2;
  g.add(deck);
  g.add(underglow(7.4, 3.2, 0x2ee6ff));
  const skin = new THREE.MeshStandardMaterial({ color: 0x0e2a3a, metalness: 0.55, roughness: 0.35 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18), skin);
  body.scale.set(3.6, 1.9, 1.55);
  body.position.set(0.2, 3.2, 0);
  g.add(body);
  // glowing ribs chase from nose to tail
  const ribs: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 7; k++) {
    const x = -2.6 + k * 0.85;
    const t = x / 3.6;
    const s = Math.sqrt(Math.max(0.05, 1 - (t - 0.05) * (t - 0.05)));
    // torus lies in the xy plane: size it to the body's cross-section, then wrap it round x
    const ring = new THREE.TorusGeometry(1, 0.06, 6, 36);
    ring.scale(1.55 * s * 1.02, 1.9 * s * 1.02, 1);
    ring.rotateY(Math.PI / 2);
    ring.translate(x + 0.2, 3.2, 0);
    ribs.push(ring);
  }
  const ribMat = chaseMat(u, 0x2ee6ff, 0xe0ffff, { axis: [-1, 0, 0], freq: 0.3, speed: 0.9, base: 1.1 });
  const ribMesh = new THREE.Mesh(merge(ribs), ribMat);
  g.add(ribMesh);
  // tail and fins (flat neon-edged blades)
  const fin = (pts: [number, number][], color: number): THREE.Group => {
    const f = new THREE.Group();
    const sh = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
    const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.12, bevelEnabled: false });
    geo.translate(0, 0, -0.06);
    f.add(new THREE.Mesh(geo, skin));
    const edge = new THREE.CatmullRomCurve3(
      pts.map(([x, y]) => new THREE.Vector3(x, y, 0)),
      true,
      'catmullrom',
      0.1,
    );
    f.add(new THREE.Mesh(new THREE.TubeGeometry(edge, 48, 0.05, 5, true), neon(color, 2.4)));
    return f;
  };
  const tail = fin(
    [
      [0, 0],
      [-1.8, 1.7],
      [-1.4, 0],
      [-1.8, -1.7],
    ],
    0xff3df0,
  );
  tail.position.set(-3.2, 3.2, 0);
  g.add(tail);
  const dorsal = fin(
    [
      [-1.2, 0],
      [0.4, 0],
      [-0.6, 1.3],
      [-1.8, 1.1],
    ],
    0xff3df0,
  );
  dorsal.position.set(0, 4.9, 0);
  g.add(dorsal);
  // eyes and a lure on a whip antenna
  for (const z of [-1.05, 1.05]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12), M.ivory());
    eye.position.set(2.6, 3.7, z);
    g.add(eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), M.rubber());
    pupil.position.set(2.85, 3.75, z * 1.18);
    g.add(pupil);
  }
  const whip = new THREE.CatmullRomCurve3([new THREE.Vector3(2.4, 4.8, 0), new THREE.Vector3(3.4, 6.4, 0), new THREE.Vector3(4.6, 6.3, 0), new THREE.Vector3(5.0, 5.4, 0)]);
  g.add(new THREE.Mesh(new THREE.TubeGeometry(whip, 20, 0.04, 4), M.darkChrome()));
  const lure = new THREE.Mesh(new THREE.SphereGeometry(0.32, 12, 10), neon(0xfff2a0, 3));
  lure.position.set(5.0, 5.3, 0);
  g.add(lure);
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.06, 6, 24), neon(0xff3df0, 2.4));
  mouth.rotation.y = Math.PI / 2;
  mouth.position.set(3.72, 2.9, 0);
  mouth.scale.set(1, 0.6, 1);
  g.add(mouth);
  return { group: g, lane: 61.8, speed: 0.052, phase: 0.4, glow: 0.8, mats: [ribMat] };
}

const BALL_FRAG = /* glsl */ `
uniform float uTime;
uniform float uBeat;
varying vec3 vObj;
varying vec3 vN;
varying vec3 vW;
float h(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
void main() {
  vec3 cell = floor(normalize(vObj) * 12.0);
  float r = h(cell);
  vec3 v = normalize(cameraPosition - vW);
  float ndv = max(dot(normalize(vN), v), 0.0);
  vec3 base = mix(vec3(0.1, 0.1, 0.14), mix(vec3(1.0, 0.4, 0.9), vec3(0.4, 0.9, 1.0), r), 0.3) * (0.5 + ndv);
  float flash = step(0.88, fract(r * 7.3 + uTime * 1.1)) * (0.7 + uBeat * 1.5);
  vec3 f = fract(normalize(vObj) * 12.0);
  float grout = step(0.1, min(min(f.x, f.y), f.z));
  gl_FragColor = vec4((base + vec3(1.0, 0.96, 0.9) * flash * 3.0) * mix(0.3, 1.0, grout), 1.0);
}`;

/** A double-decker disco bus: glowing windows, a mirror ball on the roof deck throwing beams. */
export function buildDiscoBus(u: SharedUniforms): ArtCar {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(wheels(7.6, 2.9, 3), M.rubber()));
  g.add(underglow(10, 3.2, 0xff3df0));
  const paint = new THREE.MeshStandardMaterial({ color: 0x2a0c3a, metalness: 0.4, roughness: 0.3 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(10, 3.4, 3), paint);
  body.position.y = 2.6;
  g.add(body);
  const windowsTex = canvasTexture(1024, 128, (c, w, h) => {
    c.fillStyle = '#12051a';
    c.fillRect(0, 0, w, h);
    for (let i = 0; i < 9; i++) {
      const x = 12 + i * 112;
      const grd = c.createLinearGradient(0, 10, 0, h - 10);
      grd.addColorStop(0, i % 2 ? '#ff7ae0' : '#7ae8ff');
      grd.addColorStop(1, i % 2 ? '#8a2aa0' : '#2a5aa0');
      c.fillStyle = grd;
      c.fillRect(x, 12, 96, h - 24);
      // dancers silhouetted in the windows
      c.fillStyle = 'rgba(10,4,16,0.85)';
      for (let k = 0; k < 2; k++) {
        const px = x + 22 + k * 44 + (i * 13) % 10;
        c.beginPath();
        c.arc(px, 46, 11, 0, Math.PI * 2);
        c.fill();
        c.fillRect(px - 12, 58, 24, 70);
        c.fillRect(px + (k ? 8 : -16), 20, 7, 36);
      }
    }
  });
  const win = new THREE.MeshBasicMaterial({ map: windowsTex, color: new THREE.Color(1.6, 1.6, 1.6) });
  for (const z of [-1.51, 1.51]) {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(9, 1.15), win);
    panel.position.set(0, 3.2, z);
    if (z < 0) panel.rotation.y = Math.PI;
    g.add(panel);
  }
  // destination sign
  const signTex = canvasTexture(512, 96, (c, w, h) => {
    c.fillStyle = '#0a0406';
    c.fillRect(0, 0, w, h);
    c.font = '56px Bungee, Impact, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillStyle = '#ffb347';
    c.fillText('DISCO 2 NOWHERE', w / 2, h / 2 + 3);
  });
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 0.52), new THREE.MeshBasicMaterial({ map: signTex, color: new THREE.Color(1.8, 1.8, 1.8) }));
  sign.position.set(5.01, 4.0, 0);
  sign.rotation.y = Math.PI / 2;
  g.add(sign);
  const trimMat = chaseMat(u, 0xff3df0, 0xffe0ff, { axis: [1, 0, 0], freq: 0.25, speed: 0.7, base: 1.2 });
  const trims: THREE.BufferGeometry[] = [];
  for (const y of [0.95, 4.3]) for (const z of [-1.53, 1.53]) trims.push(new THREE.BoxGeometry(10, 0.08, 0.06).translate(0, y, z));
  g.add(new THREE.Mesh(merge(trims), trimMat));
  // roof deck railing
  const rails: THREE.BufferGeometry[] = [];
  for (const z of [-1.4, 1.4]) {
    rails.push(new THREE.BoxGeometry(9.6, 0.06, 0.06).translate(0, 5.3, z));
    for (let k = 0; k < 8; k++) rails.push(new THREE.BoxGeometry(0.05, 1, 0.05).translate(-4.6 + k * 1.3, 4.8, z));
  }
  g.add(new THREE.Mesh(merge(rails), M.darkChrome()));
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.2, 6), M.darkChrome());
  pole.position.set(0, 5.4, 0);
  g.add(pole);
  const spinner = new THREE.Group();
  spinner.position.set(0, 7.2, 0);
  const ball = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.25, 3),
    new THREE.ShaderMaterial({
      uniforms: { uTime: u.uTime, uBeat: u.uBeat },
      vertexShader: /* glsl */ `varying vec3 vObj; varying vec3 vN; varying vec3 vW;
        void main() { vObj = position; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: BALL_FRAG,
    }),
  );
  spinner.add(ball);
  // the ball throws a crown of thin beams across the playa
  const thin = beamGeometry(0.035);
  const beamMats: THREE.ShaderMaterial[] = [];
  for (let i = 0; i < 8; i++) {
    const m = makeBeamMaterial(i % 2 ? 0xffc0f0 : 0xc0f0ff, 0.3);
    beamMats.push(m);
    const b = new THREE.Mesh(thin, m);
    b.scale.set(1, 16, 1);
    const holder = new THREE.Object3D();
    holder.rotation.set(Math.PI * 0.62, (i / 8) * Math.PI * 2, 0, 'YXZ');
    holder.add(b);
    spinner.add(holder);
  }
  g.add(spinner);
  return { group: g, lane: 65.6, speed: 0.041, phase: 2.6, glow: 0.9, mats: [trimMat, ...beamMats], spinner };
}

/** A steel octopus with neon suckers and a flame cannon on its crown (it fires on the DROP). */
export function buildOctopusCar(u: SharedUniforms): ArtCar {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(wheels(4.6, 3, 2), M.rubber()));
  g.add(underglow(6.5, 3.4, 0xffb347));
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.6, 0.6, 20), M.blackPlastic());
  deck.position.y = 1.3;
  g.add(deck);
  const copper = new THREE.MeshStandardMaterial({ color: 0x8a4a2a, metalness: 0.85, roughness: 0.32 });
  const head = new THREE.Mesh(new THREE.SphereGeometry(1.9, 24, 18), copper);
  head.scale.set(1.05, 1.35, 1);
  head.position.set(-0.3, 4.6, 0);
  g.add(head);
  for (const z of [-0.95, 0.95]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.4, 14, 10), neon(0xffc24d, 3));
    eye.position.set(1.35, 4.2, z);
    g.add(eye);
  }
  const tentMat = chaseMat(u, 0xff6a2a, 0xffd080, { freq: 3, speed: 0.8, base: 1.0 });
  const tents: THREE.BufferGeometry[] = [];
  const suckers: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + 0.2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const pts = [
      new THREE.Vector3(c * 1.0 - 0.3, 3.3, s * 1.0),
      new THREE.Vector3(c * 2.0 - 0.3, 2.2, s * 2.0),
      new THREE.Vector3(c * 3.0 - 0.3, 1.5, s * 3.0),
      new THREE.Vector3(c * 3.5 - 0.3, 2.3 + (k % 2) * 0.6, s * 3.5),
      new THREE.Vector3(c * 3.1 - 0.3, 3.0 + (k % 2) * 0.6, s * 3.1),
    ];
    const curve = new THREE.CatmullRomCurve3(pts);
    const tube = new THREE.TubeGeometry(curve, 40, 0.24, 7);
    // taper toward the tip
    const p = tube.getAttribute('position') as THREE.BufferAttribute;
    const uvs = tube.getAttribute('uv') as THREE.BufferAttribute;
    const tmp = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      const t = uvs.getX(i);
      const ctr = curve.getPointAt(Math.min(1, t));
      tmp.fromBufferAttribute(p, i).sub(ctr).multiplyScalar(1 - t * 0.7).add(ctr);
      p.setXYZ(i, tmp.x, tmp.y, tmp.z);
    }
    tents.push(tube);
    for (let j = 1; j < 6; j++) {
      const q = curve.getPointAt(j / 6);
      suckers.push(new THREE.SphereGeometry(0.1, 6, 5).translate(q.x, q.y + 0.2 * (1 - j / 6), q.z));
    }
  }
  g.add(new THREE.Mesh(merge(tents, true), copper));
  g.add(new THREE.Mesh(merge(suckers), tentMat));
  // neon seam round the mantle
  const seam = new THREE.Mesh(new THREE.TorusGeometry(1.95, 0.06, 6, 48), tentMat);
  seam.rotation.x = Math.PI / 2;
  seam.position.set(-0.3, 4.2, 0);
  g.add(seam);
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.8, 10), M.darkChrome());
  nozzle.position.set(-0.3, 7.1, 0);
  g.add(nozzle);
  const flameMat = makeFlameMaterial(0xff5a1a);
  flameMat.uniforms.uPower!.value = 0;
  const sprites: THREE.Mesh[] = [];
  for (let k = 0; k < 2; k++) {
    const geo = new THREE.PlaneGeometry(2.4 - k * 0.8, 6 - k * 1.6, 1, 6);
    geo.translate(0, (6 - k * 1.6) / 2, 0);
    const f = new THREE.Mesh(geo, flameMat);
    f.position.set(-0.3, 7.4, 0);
    f.visible = false;
    g.add(f);
    sprites.push(f);
  }
  return { group: g, lane: 61.8, speed: 0.052, phase: 0.4 + Math.PI, glow: 0.8, mats: [tentMat], flames: { mat: flameMat, sprites } };
}

/* ───────────────────────────── the effigy ───────────────────────────── */

export interface Effigy {
  group: THREE.Group;
  arms: THREE.Group[];
  neonMat: THREE.MeshBasicMaterial;
  baseMat: THREE.MeshBasicMaterial;
  flameMat: THREE.ShaderMaterial;
  flames: THREE.Mesh[];
}

/** The tall wooden figure on the horizon, drawn in neon; at the finale it burns. */
export function buildEffigy(): Effigy {
  const group = new THREE.Group();
  // (a little warm emissive: the torches round the base uplight the timber)
  const wood = new THREE.MeshStandardMaterial({ color: 0x3a2618, roughness: 0.9, emissive: 0x2a1206, fog: false });
  const neonMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x2ee6ff).multiplyScalar(2.6), fog: false });
  const baseMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff3df0).multiplyScalar(2.2), fog: false });
  // stepped pyramid base with neon edges on each tier
  const tiers: THREE.BufferGeometry[] = [];
  const tierEdges: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 3; k++) {
    const s = 18 - k * 5;
    const y = k * 3;
    tiers.push(new THREE.BoxGeometry(s, 3, s).translate(0, y + 1.5, 0));
    const h = s / 2 + 0.05;
    for (const [a, b] of [
      [new THREE.Vector3(-h, y + 3, -h), new THREE.Vector3(h, y + 3, -h)],
      [new THREE.Vector3(h, y + 3, -h), new THREE.Vector3(h, y + 3, h)],
      [new THREE.Vector3(h, y + 3, h), new THREE.Vector3(-h, y + 3, h)],
      [new THREE.Vector3(-h, y + 3, h), new THREE.Vector3(-h, y + 3, -h)],
    ] as const)
      tierEdges.push(strut(a, b, 0.22, 5));
  }
  group.add(new THREE.Mesh(merge(tiers), new THREE.MeshStandardMaterial({ color: 0x241a16, roughness: 0.95, fog: false })));
  group.add(new THREE.Mesh(merge(tierEdges), baseMat));
  // the figure: timber beams with neon laid along each one
  const beam = (a: THREE.Vector3, b: THREE.Vector3, beams: THREE.BufferGeometry[], lines: THREE.BufferGeometry[], r = 0.45): void => {
    beams.push(strut(a, b, r, 6));
    const off = new THREE.Vector3(0, 0, r + 0.1);
    lines.push(strut(a.clone().add(off), b.clone().add(off), 0.22, 5));
  };
  const beams: THREE.BufferGeometry[] = [];
  const lines: THREE.BufferGeometry[] = [];
  const V = (x: number, y: number): THREE.Vector3 => new THREE.Vector3(x, y, 0);
  beam(V(-2.6, 9), V(-1.3, 20), beams, lines);
  beam(V(2.6, 9), V(1.3, 20), beams, lines);
  beam(V(-1.3, 20), V(-2.3, 28), beams, lines);
  beam(V(1.3, 20), V(2.3, 28), beams, lines);
  beam(V(-1.3, 20), V(1.3, 20), beams, lines);
  beam(V(-2.3, 28), V(2.3, 28), beams, lines);
  beam(V(-1.8, 24), V(1.8, 24), beams, lines, 0.3);
  // lattice bracing in the legs and chest
  for (const s of [-1, 1]) {
    beam(V(s * 2.5, 10), V(s * 1.5, 15), beams, lines, 0.18);
    beam(V(s * 1.5, 15), V(s * 2.0, 19), beams, lines, 0.18);
  }
  beam(V(-1.3, 20.2), V(1.9, 27.8), beams, lines, 0.16);
  beam(V(1.3, 20.2), V(-1.9, 27.8), beams, lines, 0.16);
  beam(V(0, 28), V(0, 29.5), beams, lines, 0.35);
  // head: a lantern-like diamond
  beam(V(0, 29.5), V(-1.7, 31.8), beams, lines, 0.3);
  beam(V(-1.7, 31.8), V(0, 34.4), beams, lines, 0.3);
  beam(V(0, 34.4), V(1.7, 31.8), beams, lines, 0.3);
  beam(V(1.7, 31.8), V(0, 29.5), beams, lines, 0.3);
  group.add(new THREE.Mesh(merge(beams), wood));
  group.add(new THREE.Mesh(merge(lines), neonMat));
  // arms pivot at the shoulders (they rise when it burns)
  const arms: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(s * 2.3, 28, 0);
    const ab: THREE.BufferGeometry[] = [];
    const al: THREE.BufferGeometry[] = [];
    beam(V(0, 0), V(s * 1.8, -8.5), ab, al, 0.35);
    arm.add(new THREE.Mesh(merge(ab), wood), new THREE.Mesh(merge(al), neonMat));
    group.add(arm);
    arms.push(arm);
  }
  const flameMat = makeFlameMaterial(0xff6a1a);
  flameMat.fog = false;
  flameMat.uniforms.uPower!.value = 0;
  const flames: THREE.Mesh[] = [];
  for (let k = 0; k < 7; k++) {
    const hgt = 16 + (k % 3) * 8;
    const geo = new THREE.PlaneGeometry(9 - (k % 3) * 2, hgt, 1, 8);
    geo.translate(0, hgt / 2, 0);
    const f = new THREE.Mesh(geo, flameMat);
    f.position.set((k - 3) * 2.2, 6 + (k % 2) * 8, 1);
    f.visible = false;
    group.add(f);
    flames.push(f);
  }
  return { group, arms, neonMat, baseMat, flameMat, flames };
}

/* ───────────────────────────── camp dressing ───────────────────────────── */

/** A person, arm up, glow stick in hand; aGlow marks the stick. */
export function personGeometry(): THREE.BufferGeometry {
  const body = new THREE.CapsuleGeometry(0.3, 0.9, 3, 6).translate(0, 0.78, 0);
  const head = new THREE.SphereGeometry(0.24, 8, 6).translate(0, 1.72, 0);
  const arm = new THREE.CapsuleGeometry(0.08, 0.75, 2, 4).rotateZ(0.4).translate(0.33, 2.0, 0);
  const stick = new THREE.CapsuleGeometry(0.05, 0.4, 2, 4).rotateZ(-0.3).translate(0.5, 2.62, 0);
  return merge([body, head, arm, stick], false, { aGlow: [0, 0, 0, 1] });
}

/** A parked bike: frame lines and EL-wire wheels (vertex colour 1 = glowing). */
export function bikeGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const glow: number[] = [];
  for (const x of [-0.52, 0.52]) {
    parts.push(new THREE.TorusGeometry(0.34, 0.03, 4, 18).translate(x, 0.34, 0));
    glow.push(1);
  }
  const P = (x: number, y: number): THREE.Vector3 => new THREE.Vector3(x, y, 0);
  for (const [a, b] of [
    [P(-0.52, 0.34), P(-0.05, 0.36)],
    [P(-0.05, 0.36), P(0.36, 0.78)],
    [P(-0.52, 0.34), P(-0.18, 0.8)],
    [P(-0.18, 0.8), P(0.36, 0.78)],
    [P(-0.05, 0.36), P(-0.2, 0.86)],
    [P(0.36, 0.78), P(0.52, 0.34)],
    [P(0.36, 0.78), P(0.3, 1.0)],
  ] as const) {
    parts.push(strut(a, b, 0.03, 4));
    glow.push(0.12);
  }
  parts.push(new THREE.BoxGeometry(0.22, 0.05, 0.1).translate(-0.2, 0.9, 0));
  glow.push(0.06);
  parts.push(new THREE.BoxGeometry(0.04, 0.04, 0.5).translate(0.3, 1.0, 0));
  glow.push(0.12);
  const g = merge(parts, false, { aGlow: glow });
  const a = g.getAttribute('aGlow') as THREE.BufferAttribute;
  const col = new Float32Array(a.count * 3);
  for (let i = 0; i < a.count; i++) col.fill(a.getX(i), i * 3, i * 3 + 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('aGlow');
  return g;
}

/** Shade structure: four poles and a sagging canopy. */
export function shadeGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const x of [-2.2, 2.2]) for (const z of [-2.2, 2.2]) parts.push(new THREE.CylinderGeometry(0.06, 0.06, 3, 5).translate(x, 1.5, z));
  const canopy = new THREE.PlaneGeometry(5, 5, 4, 4);
  canopy.rotateX(-Math.PI / 2);
  const p = canopy.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) p.setY(i, 3 - 0.35 * (1 - (p.getX(i) / 2.5) ** 2) * (1 - (p.getZ(i) / 2.5) ** 2));
  canopy.computeVertexNormals();
  parts.push(canopy);
  return merge(parts);
}

/** Searchlight: a tall additive shaft rising from the ground. */
export function searchlight(color: number): { pivot: THREE.Object3D; mat: THREE.ShaderMaterial } {
  const pivot = new THREE.Object3D();
  const mat = makeBeamMaterial(color, 0.35);
  // apex (uv.y = 1) at the lamp, widening as it climbs
  const geo = new THREE.CylinderGeometry(0.35, 2.6, 1, 16, 1, true);
  geo.translate(0, -0.5, 0);
  const cone = new THREE.Mesh(geo, mat);
  cone.rotation.x = Math.PI;
  cone.scale.set(1, 170, 1);
  cone.frustumCulled = false;
  pivot.add(cone);
  return { pivot, mat };
}

/* ───────────────────────────── dust devils ───────────────────────────── */

const DEVIL_VERT = /* glsl */ `
uniform float uTime;
uniform float uSeed;
varying vec2 vUv;
varying float vEdge;
void main() {
  vUv = uv;
  vec3 p = position;
  float y = uv.y;
  // the funnel leans and snakes as it spins
  p.x += sin(y * 2.6 + uTime * 1.3 + uSeed) * (0.4 + y * 1.6);
  p.z += cos(y * 2.1 + uTime * 1.1 + uSeed * 2.0) * (0.3 + y * 1.2);
  vec4 wp = modelMatrix * vec4(p, 1.0);
  vec3 n = normalize(mat3(modelMatrix) * normal);
  vEdge = 1.0 - abs(dot(n, normalize(cameraPosition - wp.xyz)));
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const DEVIL_FRAG = /* glsl */ `
uniform float uTime;
uniform float uSeed;
uniform float uAlpha;
uniform vec3 uColor;
varying vec2 vUv;
varying float vEdge;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), u.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), u.x), u.y); }
void main() {
  // spiralling streaks of sand racing round and up the funnel
  float s = n(vec2(vUv.x * 10.0 + vUv.y * 5.0 - uTime * 3.0 + uSeed, vUv.y * 7.0 - uTime * 1.2));
  s = s * 0.7 + 0.3 * n(vec2(vUv.x * 24.0 - uTime * 5.0, vUv.y * 16.0));
  float a = smoothstep(0.3, 0.85, s) * (0.35 + vEdge * 0.9);
  a *= smoothstep(0.0, 0.12, vUv.y) * smoothstep(1.0, 0.45, vUv.y) * uAlpha;
  gl_FragColor = vec4(uColor * a, a);
}`;

export interface DustDevil {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  seed: number;
}

/** A spinning funnel of sand that wanders across the playa (faint: it never hides the fight). */
export function buildDustDevil(u: SharedUniforms, seed: number): DustDevil {
  const geo = new THREE.CylinderGeometry(3.2, 0.5, 13, 28, 14, true);
  geo.translate(0, 6.5, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: u.uTime,
      uSeed: { value: seed },
      uAlpha: { value: 0.3 },
      uColor: { value: new THREE.Color(0.75, 0.6, 0.5) },
    },
    vertexShader: DEVIL_VERT,
    fragmentShader: DEVIL_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 3;
  return { mesh, mat, seed };
}

/* ───────────────────────────── motel sign ───────────────────────────── */

export interface MotelSign {
  group: THREE.Group;
  text: THREE.MeshBasicMaterial;
  arrow: THREE.MeshBasicMaterial[];
}

/** A roadside neon sign on a tall pole: the festival's name, chaser bulbs and a saguaro. */
export function buildMotelSign(u: SharedUniforms): MotelSign {
  const group = new THREE.Group();
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 16, 12), M.darkChrome());
  pole.position.y = 8;
  group.add(pole);
  const board = new THREE.Mesh(new THREE.BoxGeometry(17, 5.2, 0.6), new THREE.MeshStandardMaterial({ color: 0x1a1024, roughness: 0.5, metalness: 0.3 }));
  board.position.set(0, 13.4, 0);
  group.add(board);
  const tex = canvasTexture(1024, 320, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    const line = (text: string, y: number, size: number, color: string): void => {
      g.font = `${size}px Bungee, Impact, sans-serif`;
      g.shadowColor = color;
      for (const blur of [40, 18]) {
        g.shadowBlur = blur;
        g.strokeStyle = color;
        g.lineWidth = 9;
        g.strokeText(text, w / 2, y);
      }
      g.shadowBlur = 0;
      g.strokeStyle = '#ffffff';
      g.lineWidth = 3.5;
      g.strokeText(text, w / 2, y);
    };
    line('NEON DESERT', h * 0.42, 150, '#ff3df0');
    line('NO VACANCY · NO SILENCE', h * 0.82, 48, '#2ee6ff');
  });
  const text = new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: new THREE.Color(1.6, 1.6, 1.6) });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(16.4, 5.1), text);
  face.position.set(0, 13.4, 0.32);
  group.add(face);
  // chaser bulbs round the board
  const bulbs: THREE.BufferGeometry[] = [];
  const per = 2 * (17 + 5.2);
  for (let k = 0; k < 44; k++) {
    let d = (k / 44) * per;
    let x: number;
    let y: number;
    if (d < 17) {
      x = -8.5 + d;
      y = 2.6;
    } else if ((d -= 17) < 5.2) {
      x = 8.5;
      y = 2.6 - d;
    } else if ((d -= 5.2) < 17) {
      x = 8.5 - d;
      y = -2.6;
    } else {
      d -= 17;
      x = -8.5;
      y = -2.6 + d;
    }
    bulbs.push(new THREE.SphereGeometry(0.16, 8, 6).translate(x, 13.4 + y, 0.35));
  }
  group.add(new THREE.Mesh(merge(bulbs), chaseMat(u, 0xffc24d, 0xffffff, { axis: [1, 0.3, 0], freq: 0.5, speed: 1.2, base: 0.8 })));
  // the saguaro, perched on top of the board
  const cactus = chaseMat(u, 0x7dff4d, 0xe8ffc0, { freq: 1.5, speed: 0.4, base: 1.3 });
  const saguaro: [number, number][][] = [
    [
      [0, 0],
      [0, 7],
    ],
    [
      [0, 2.6],
      [-1.6, 2.6],
      [-1.6, 4.8],
    ],
    [
      [0, 3.6],
      [1.5, 3.6],
      [1.5, 5.8],
    ],
  ];
  for (const path of saguaro) {
    const pts = path.map(([x, y]) => new THREE.Vector3(x + 5.5, 16 + y, 0.2));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.05);
    group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.2, 8), cactus));
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), cactus);
    cap.position.copy(pts[pts.length - 1]!);
    group.add(cap);
  }
  // a flashing arrow pointing down at the dance floor
  const arrow: THREE.MeshBasicMaterial[] = [];
  for (let k = 0; k < 3; k++) {
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb347).multiplyScalar(2.4) });
    arrow.push(m);
    // a two-segment half torus is a chevron; flip it to point down
    const chev = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.12, 6, 2, Math.PI), m);
    chev.rotation.z = Math.PI;
    chev.position.set(-6.5, 9.6 - k * 1.3, 0.3);
    group.add(chev);
  }
  return { group, text, arrow };
}
