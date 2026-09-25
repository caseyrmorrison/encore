import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * The Hush — creatures of silence. Matte black velvet with a coloured sheen, glowing
 * eyes computed in the shader, and a squash-and-stretch dance driven by the beat.
 * One instanced draw call per enemy type.
 */

export type HushKind = 'mote' | 'mute' | 'static' | 'damper' | 'shusher' | 'bouncer' | 'wisp';

export interface HushLook {
  geometry: THREE.BufferGeometry;
  eyeY: number;
  eyeSep: number;
  eyeSize: number;
  /** 0 two eyes, 1 visor band, 2 cyclops, 3 slits */
  eyeStyle: number;
  squash: number;
  glitch: number;
}

const VERT = /* glsl */ `
#ifdef USE_INSTANCING
attribute vec4 aState; // flash, seed, freeze, elite
attribute float aBeat;
#else
uniform vec4 uState;
uniform float uBeatU;
#endif
uniform float uTime;
uniform float uSquash;
uniform float uGlitch;
varying vec3 vN;
varying vec3 vObj;
varying vec3 vView;
varying vec4 vState;
varying float vWorldY;
void main() {
#ifdef USE_INSTANCING
  vState = aState;
  float pulse = aBeat;
  mat4 im = instanceMatrix;
#else
  vState = uState;
  float pulse = uBeatU;
  mat4 im = mat4(1.0);
#endif
  vec3 p = position;
  p.y *= 1.0 + pulse * uSquash;
  p.xz *= 1.0 - pulse * uSquash * 0.45;
  if (uGlitch > 0.0) {
    float g = step(0.86, fract(uTime * 3.1 + vState.y * 17.0));
    p.x += g * sin(p.y * 40.0 + uTime * 90.0) * 0.12 * uGlitch;
    p.z += g * cos(p.y * 31.0 + uTime * 70.0) * 0.08 * uGlitch;
  }
  vObj = position;
  vec4 wp = modelMatrix * im * vec4(p, 1.0);
  vN = normalize(mat3(modelMatrix) * mat3(im) * normal);
  vView = normalize(cameraPosition - wp.xyz);
  vWorldY = wp.y;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = /* glsl */ `
uniform vec3 uRim;
uniform vec3 uFloor;
uniform vec3 uEye;
uniform vec4 uEyeParams; // y, sep, size, style
uniform float uTime;
varying vec3 vN;
varying vec3 vObj;
varying vec3 vView;
varying vec4 vState;
varying float vWorldY;

float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }

void main() {
  vec3 n = normalize(vN);
  float ndv = max(dot(n, vView), 0.0);
  float fres = pow(1.0 - ndv, 4.5);
  float top = max(n.y, 0.0);
  float bottom = max(-n.y, 0.0);
  // velvet: near-black albedo, a thin coloured sheen at the silhouette, fibre noise
  float fibre = hash(floor(vObj * 70.0)) * 0.012;
  vec3 col = vec3(0.006, 0.004, 0.012) + fibre;
  col += uRim * fres * 0.6;
  col += vec3(0.035, 0.03, 0.06) * pow(top, 4.0);
  col += uFloor * bottom * 0.3 * smoothstep(1.0, 0.0, vWorldY);

  // eyes live on the +Z face in object space
  float y = uEyeParams.x;
  float sep = uEyeParams.y;
  float sz = uEyeParams.z;
  float style = uEyeParams.w;
  float front = smoothstep(0.0, 0.12, vObj.z);
  float blink = step(0.965, fract(uTime * 0.23 + vState.y * 7.3));
  vec2 e = vObj.xy - vec2(0.0, y);
  float eye = 0.0;
  if (style < 0.5) {
    float squint = mix(1.0, 7.0, blink);
    float d1 = length((e - vec2(sep, 0.0)) * vec2(1.0, squint * 0.85));
    float d2 = length((e + vec2(sep, 0.0)) * vec2(1.0, squint * 0.85));
    eye = smoothstep(sz, sz * 0.55, min(d1, d2));
  } else if (style < 1.5) {
    float band = smoothstep(sz, sz * 0.6, abs(e.y)) * step(abs(e.x), sep);
    float glint = smoothstep(0.04, 0.0, abs(e.x - sep * 0.4 + sin(uTime * 2.0 + vState.y * 9.0) * sep * 0.5));
    eye = band * (0.55 + glint * 1.5);
  } else if (style < 2.5) {
    float d = length(e * vec2(1.0, mix(1.0, 8.0, blink)));
    float iris = smoothstep(sz, sz * 0.8, d) - smoothstep(sz * 0.45, sz * 0.3, d) * 0.7;
    eye = iris;
  } else {
    float s1 = smoothstep(sz, sz * 0.4, abs(e.y)) * smoothstep(sep + 0.09, sep, abs(abs(e.x) - sep * 0.2) + sep * 0.8);
    eye = s1 * step(0.03, abs(e.x));
  }
  eye *= front;
  vec3 eyeCol = mix(uEye, vec3(1.0, 0.25, 0.3), vState.w);
  // glowing eyes with a soft halo so they read from the high camera
  col = mix(col, eyeCol * 2.4, clamp(eye, 0.0, 1.0));

  // frozen: icy crust
  col = mix(col, vec3(0.45, 0.8, 1.3) * (0.5 + fres), vState.z * 0.75);
  // elite: molten gold sheen
  col += vec3(1.4, 0.8, 0.2) * pow(1.0 - ndv, 5.0) * vState.w * 1.3;
  // hit flash
  // hit flash: a hot rim + brief body lift, not a solid white blob
  col = mix(col, vec3(2.2, 2.0, 1.9), vState.x * 0.55);
  col += vec3(3.0) * fres * vState.x;
  gl_FragColor = vec4(col, 1.0);
}`;

export function makeHushMaterial(look: HushLook, rim: THREE.Color, floor: THREE.Color): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTime: { value: 0 },
      uSquash: { value: look.squash },
      uGlitch: { value: look.glitch },
      uRim: { value: rim.clone() },
      uFloor: { value: floor.clone() },
      uEye: { value: new THREE.Color(0xf4f1ff) },
      uEyeParams: { value: new THREE.Vector4(look.eyeY, look.eyeSep, look.eyeSize, look.eyeStyle) },
      uState: { value: new THREE.Vector4(0, 0.5, 0, 0) },
      uBeatU: { value: 0 },
    },
  });
}

function lathe(points: [number, number][], seg = 28): THREE.LatheGeometry {
  return new THREE.LatheGeometry(
    points.map(([r, y]) => new THREE.Vector2(r, y)),
    seg,
  );
}

function prep(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  // keep only attributes every part shares so merges line up
  for (const name of Object.keys(ng.attributes)) if (name !== 'position' && name !== 'normal') ng.deleteAttribute(name);
  return ng;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const m = mergeGeometries(parts.map(prep))!;
  m.computeBoundingSphere();
  return m;
}

export function hushLooks(): Record<HushKind, HushLook> {
  // Mote: round little shusher with a curled tuft
  const moteBody = new THREE.SphereGeometry(0.5, 24, 18);
  moteBody.scale(1, 0.92, 1);
  moteBody.translate(0, 0.5, 0);
  const tuft = new THREE.ConeGeometry(0.12, 0.35, 10);
  tuft.rotateZ(-0.5);
  tuft.translate(0.08, 1.02, 0);

  // Mute: hooded robe on a lathe, a cowl pulled forward
  const robe = lathe([
    [0.001, 0],
    [0.62, 0.02],
    [0.66, 0.12],
    [0.5, 0.7],
    [0.36, 1.2],
    [0.4, 1.45],
    [0.38, 1.75],
    [0.22, 2.02],
    [0.001, 2.08],
  ]);
  const shoulders = new THREE.SphereGeometry(0.46, 20, 14);
  shoulders.scale(1.15, 0.5, 0.9);
  shoulders.translate(0, 1.18, 0);

  // Static: jagged crystal cluster
  const shards: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const b = new THREE.OctahedronGeometry(0.42 - i * 0.05, 0);
    b.scale(0.8, 1.5, 0.8);
    b.rotateY(i * 1.3);
    b.rotateZ((i - 1.5) * 0.35);
    b.translate((i - 1.5) * 0.18, 0.85 + (i % 2) * 0.12, (i % 2 ? 0.1 : -0.1));
    shards.push(b);
  }

  // Damper: a heavy muffler disc with baffles
  const damperBody = new THREE.CylinderGeometry(0.85, 0.95, 0.55, 28);
  damperBody.translate(0, 0.4, 0);
  const baffle1 = new THREE.TorusGeometry(0.72, 0.08, 10, 28);
  baffle1.rotateX(Math.PI / 2);
  baffle1.translate(0, 0.72, 0);
  const baffle2 = new THREE.TorusGeometry(0.46, 0.07, 10, 24);
  baffle2.rotateX(Math.PI / 2);
  baffle2.translate(0, 0.85, 0);
  const dome = new THREE.SphereGeometry(0.34, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.translate(0, 0.72, 0);

  // Shusher: gangly, big head, finger raised to the lips
  const sBody = new THREE.CapsuleGeometry(0.28, 0.9, 6, 14);
  sBody.translate(0, 0.75, 0);
  const sHead = new THREE.SphereGeometry(0.42, 22, 16);
  sHead.translate(0, 1.62, 0);
  const finger = new THREE.CapsuleGeometry(0.06, 0.34, 4, 8);
  finger.translate(0, 1.5, 0.42);
  const arm = new THREE.CapsuleGeometry(0.08, 0.5, 4, 8);
  arm.rotateX(-1.1);
  arm.translate(0.05, 1.18, 0.3);

  // Bouncer: wide slab of a creature. Arms crossed. Sunglasses (visor eyes).
  const torso = new THREE.BoxGeometry(1.5, 1.35, 1.0, 2, 2, 2);
  torso.translate(0, 0.95, 0);
  const head = new THREE.BoxGeometry(0.8, 0.62, 0.72);
  head.translate(0, 1.95, 0.05);
  const armsX = new THREE.CapsuleGeometry(0.2, 1.1, 4, 10);
  armsX.rotateZ(Math.PI / 2);
  armsX.translate(0, 1.05, 0.55);
  const legs = new THREE.BoxGeometry(1.1, 0.35, 0.8);
  legs.translate(0, 0.18, 0);

  // Wisp: a tiny darting spark of silence (boss adds)
  const wisp = new THREE.IcosahedronGeometry(0.35, 1);
  wisp.translate(0, 0.6, 0);

  return {
    mote: { geometry: merge([moteBody, tuft]), eyeY: 0.66, eyeSep: 0.19, eyeSize: 0.15, eyeStyle: 0, squash: 0.16, glitch: 0 },
    mute: { geometry: merge([robe, shoulders]), eyeY: 1.66, eyeSep: 0.18, eyeSize: 0.075, eyeStyle: 3, squash: 0.08, glitch: 0 },
    static: { geometry: merge(shards), eyeY: 1.0, eyeSep: 0, eyeSize: 0.22, eyeStyle: 2, squash: 0.05, glitch: 1 },
    damper: {
      geometry: merge([damperBody, baffle1, baffle2, dome]),
      eyeY: 0.45,
      eyeSep: 0.32,
      eyeSize: 0.13,
      eyeStyle: 0,
      squash: 0.1,
      glitch: 0,
    },
    shusher: {
      geometry: merge([sBody, sHead, finger, arm]),
      eyeY: 1.74,
      eyeSep: 0.17,
      eyeSize: 0.13,
      eyeStyle: 0,
      squash: 0.1,
      glitch: 0,
    },
    bouncer: {
      geometry: merge([torso, head, armsX, legs]),
      eyeY: 2.0,
      eyeSep: 0.34,
      eyeSize: 0.1,
      eyeStyle: 1,
      squash: 0.06,
      glitch: 0,
    },
    wisp: { geometry: merge([wisp]), eyeY: 0.66, eyeSep: 0.13, eyeSize: 0.1, eyeStyle: 0, squash: 0.25, glitch: 0.4 },
  };
}

/** Instanced renderer for one enemy type. */
export class HushBatch {
  readonly mesh: THREE.InstancedMesh;
  readonly material: THREE.ShaderMaterial;
  private readonly state: THREE.InstancedBufferAttribute;
  private readonly beat: THREE.InstancedBufferAttribute;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly p = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private n = 0;

  constructor(look: HushLook, capacity: number, rim: THREE.Color, floor: THREE.Color) {
    this.material = makeHushMaterial(look, rim, floor);
    const geo = look.geometry.clone();
    this.state = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(
      THREE.DynamicDrawUsage,
    );
    this.beat = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aState', this.state);
    geo.setAttribute('aBeat', this.beat);
    this.mesh = new THREE.InstancedMesh(geo, this.material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  begin(): void {
    this.n = 0;
  }

  push(
    x: number,
    y: number,
    z: number,
    yaw: number,
    scale: number,
    flash: number,
    seed: number,
    freeze: number,
    elite: number,
    beat: number,
  ): void {
    if (this.n >= this.mesh.instanceMatrix.count) return;
    this.q.setFromAxisAngle(this.up, yaw);
    this.s.setScalar(scale);
    this.p.set(x, y, z);
    this.m.compose(this.p, this.q, this.s);
    this.mesh.setMatrixAt(this.n, this.m);
    const o = this.n * 4;
    const a = this.state.array as Float32Array;
    a[o] = flash;
    a[o + 1] = seed;
    a[o + 2] = freeze;
    a[o + 3] = elite;
    (this.beat.array as Float32Array)[this.n] = beat;
    this.n++;
  }

  end(time: number): void {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.state.needsUpdate = true;
    this.beat.needsUpdate = true;
    this.material.uniforms.uTime!.value = time;
  }

  setColors(rim: THREE.Color, floor: THREE.Color): void {
    (this.material.uniforms.uRim!.value as THREE.Color).copy(rim);
    (this.material.uniforms.uFloor!.value as THREE.Color).copy(floor);
  }
}
