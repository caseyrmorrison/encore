import * as THREE from 'three';
import type { ProgressionId } from '../../audio/theory';
import type { Rng } from '../../core/rng';

export type VenueId = 'basement' | 'cathedral' | 'mainstage';

export type Bounds = { kind: 'rect'; hx: number; hz: number } | { kind: 'circle'; r: number };

export interface VenuePalette {
  rim: THREE.Color;
  floor: THREE.Color;
  accents: number[];
  fog: number;
  fogDensity: number;
  background: number;
  core: number;
}

export interface FrameInfo {
  dt: number;
  time: number;
  beatPhase: number;
  barPhase: number;
  /** 0..1 how intense the fight is (enemy count, drop) */
  energy: number;
  drop: boolean;
  spectrum: Float32Array;
  playerX: number;
  playerZ: number;
  bossActive: boolean;
  /** 0..1 progress of a DROP build-up (the room darkens toward the downbeat) */
  build: number;
  /** camera orientation, for billboards */
  camQuat?: THREE.Quaternion;
}

export interface Venue {
  readonly id: VenueId;
  readonly name: string;
  readonly tagline: string;
  readonly bpm: number;
  readonly progression: ProgressionId;
  readonly bounds: Bounds;
  readonly palette: VenuePalette;
  readonly group: THREE.Group;
  /** Circular obstacles (pillars) the player & enemies collide with. */
  readonly obstacles: readonly { x: number; z: number; r: number }[];
  update(f: FrameInfo): void;
  /** Called on each 16th step (for strobe patterns etc.). */
  onStep(step: number, bar: number): void;
  /** A player instrument sounded: venues can make the room react (floor-as-sequencer). */
  onNote?(inst: string, strength: number): void;
  /** Fade props that stand between the camera and the action. */
  occlude?(px: number, pz: number): void;
  /** The headliner fell: the room goes all-out until the run ends. */
  finale?(): void;
  ripple(x: number, z: number, color: THREE.Color | number, strength?: number): void;
  spawnPoint(rng: Rng, px: number, pz: number, out: { x: number; z: number }): void;
  dispose(): void;
}

export function clampToBounds(b: Bounds, x: number, z: number, r: number, out: { x: number; z: number }): boolean {
  if (b.kind === 'rect') {
    const cx = Math.max(-b.hx + r, Math.min(b.hx - r, x));
    const cz = Math.max(-b.hz + r, Math.min(b.hz - r, z));
    out.x = cx;
    out.z = cz;
    return cx !== x || cz !== z;
  }
  const d = Math.hypot(x, z);
  const max = b.r - r;
  if (d > max) {
    out.x = (x / d) * max;
    out.z = (z / d) * max;
    return true;
  }
  out.x = x;
  out.z = z;
  return false;
}

export function pushOutOfObstacles(
  obstacles: readonly { x: number; z: number; r: number }[],
  x: number,
  z: number,
  r: number,
  out: { x: number; z: number },
): void {
  out.x = x;
  out.z = z;
  for (const o of obstacles) {
    const dx = out.x - o.x;
    const dz = out.z - o.z;
    const d = Math.hypot(dx, dz);
    const min = o.r + r;
    if (d < min && d > 1e-4) {
      out.x = o.x + (dx / d) * min;
      out.z = o.z + (dz / d) * min;
    }
  }
}

/** Shared GLSL helpers for the floor shaders. */
export const GLSL_COMMON = /* glsl */ `
float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float a = hash21(i), b = hash21(i + vec2(1.0, 0.0)), c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return s;
}
uniform vec4 uRipples[8];
uniform vec3 uRippleColors[8];
uniform float uTime;
vec3 ripples(vec2 w) {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 8; i++) {
    vec4 r = uRipples[i];
    float age = uTime - r.z;
    if (age < 0.0 || age > 1.0) continue;
    float rad = age * 30.0;
    float d = abs(length(w - r.xy) - rad);
    float ring = smoothstep(0.45, 0.0, d) * pow(1.0 - age, 2.5);
    acc += uRippleColors[i] * ring * r.w;
  }
  return acc;
}
`;

export class RippleBank {
  readonly ripples: THREE.Vector4[] = Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, -99, 0));
  readonly colors: THREE.Color[] = Array.from({ length: 8 }, () => new THREE.Color());
  private next = 0;

  add(x: number, z: number, time: number, color: THREE.Color | number, strength = 1): void {
    const i = this.next++ % 8;
    this.ripples[i]!.set(x, z, time, strength);
    if (typeof color === 'number') this.colors[i]!.setHex(color);
    else this.colors[i]!.copy(color);
  }

  uniforms(): Record<string, THREE.IUniform> {
    return {
      uRipples: { value: this.ripples },
      uRippleColors: { value: this.colors },
    };
  }
}

/** Soft additive light cone (moving head / god ray). */
export function makeBeamMaterial(color: number, opacity = 0.35, side: THREE.Side = THREE.DoubleSide): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vView = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        float edge = pow(abs(dot(normalize(vN), vView)), 1.6);
        float along = pow(clamp(vUv.y, 0.0, 1.0), 1.3);          // uv.y = 1 at the lamp, 0 at the far end
        float dust = 0.85 + 0.15 * sin(vUv.y * 30.0 + uTime * 1.3 + vUv.x * 12.0);
        float a = edge * along * uOpacity * dust;
        gl_FragColor = vec4(uColor * a, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side,
  });
}

/** An open cone whose apex is at the origin pointing down -Y, length 1 (scale to fit). */
export function beamGeometry(spread = 0.22): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.03, spread, 1, 32, 1, true);
  g.translate(0, -0.5, 0);
  return g;
}

/** Animated additive flame (braziers, pyro, candles). Cone apex up, base at y=0. */
export function makeFlameMaterial(color: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(color) }, uPower: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      uniform float uTime;
      void main() {
        vUv = uv;
        vec3 p = position;
        float sway = sin(uTime * 7.0 + p.y * 3.0) * 0.08 * p.y;
        p.x += sway;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uPower;
      float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), u.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), u.x), u.y); }
      void main() {
        float y = clamp(vUv.y, 0.0, 1.0);
        float tongues = n(vec2(vUv.x * 8.0, y * 3.0 - uTime * 4.0)) * 0.7 + n(vec2(vUv.x * 17.0, y * 6.0 - uTime * 7.0)) * 0.3;
        float a = smoothstep(1.0, 0.1, y + tongues * 0.55) * uPower;
        vec3 col = mix(uColor, vec3(1.0, 0.85, 0.45), smoothstep(0.35, 0.0, y) * 0.5);
        gl_FragColor = vec4(col * a * 2.2, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}
