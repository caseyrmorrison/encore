import * as THREE from 'three';

/**
 * GPU-instanced VFX primitives. All CPU state lives in typed arrays; each frame the live
 * instances are compacted into the attribute buffers and uploaded once.
 */

export const enum Shape {
  Dot = 0,
  Ring = 1,
  Spark = 2,
  Square = 3,
  Note = 4,
  Streak = 5,
}

const PARTICLE_VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec4 iColor;
attribute vec4 iParams; // size, shape, rotation, stretch
varying vec2 vUv;
varying vec4 vColor;
varying float vShape;
void main() {
  vUv = uv;
  vColor = iColor;
  vShape = iParams.y;
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  vec2 p = position.xy;
  p.x *= iParams.w;
  float c = cos(iParams.z), s = sin(iParams.z);
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  mv.xy += p * iParams.x;
  gl_Position = projectionMatrix * mv;
}`;

const PARTICLE_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec4 vColor;
varying float vShape;
uniform float uIntensity;
void main() {
  vec2 q = vUv - 0.5;
  float r = length(q);
  float a;
  if (vShape < 0.5) {
    a = pow(max(0.0, 1.0 - r * 2.0), 1.6);
  } else if (vShape < 1.5) {
    a = smoothstep(0.07, 0.0, abs(r - 0.38)) + 0.15 * smoothstep(0.5, 0.0, r);
  } else if (vShape < 2.5) {
    float cross = max(1.0 - abs(q.x) * 14.0, 0.0) * max(1.0 - abs(q.y) * 2.1, 0.0)
                + max(1.0 - abs(q.y) * 14.0, 0.0) * max(1.0 - abs(q.x) * 2.1, 0.0);
    a = cross + pow(max(0.0, 1.0 - r * 2.0), 3.0);
  } else if (vShape < 3.5) {
    a = step(max(abs(q.x), abs(q.y)), 0.42);
  } else if (vShape < 4.5) {
    // eighth note glyph: head + stem + flag
    vec2 h = (q - vec2(-0.1, -0.22)) * vec2(1.0, 1.35);
    float head = smoothstep(0.17, 0.13, length(h));
    float stem = step(abs(q.x - 0.05), 0.035) * step(-0.2, q.y) * step(q.y, 0.38);
    float flag = step(abs(q.y - 0.3 + (q.x - 0.05) * 0.9), 0.06) * step(0.05, q.x) * step(q.x, 0.25);
    a = max(max(head, stem), flag);
  } else {
    a = pow(max(0.0, 1.0 - abs(q.y) * 2.0), 2.0) * smoothstep(0.5, 0.2, abs(q.x));
  }
  a *= vColor.a;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor.rgb * uIntensity * a, a);
}`;

export interface EmitOpts {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  life: number;
  size: number;
  sizeEnd?: number;
  color: THREE.Color | number;
  alpha?: number;
  shape?: Shape;
  drag?: number;
  gravity?: number;
  spin?: number;
  rot?: number;
  stretch?: number;
}

const tmpColor = new THREE.Color();

export class ParticleSystem {
  readonly mesh: THREE.Mesh;
  private readonly cap: number;
  private n = 0;
  // simulation state
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly size: Float32Array;
  private readonly col: Float32Array;
  private readonly misc: Float32Array; // shape, rot, spin, drag, gravity, stretch, sizeEnd
  // gpu buffers
  private readonly aPos: THREE.InstancedBufferAttribute;
  private readonly aColor: THREE.InstancedBufferAttribute;
  private readonly aParams: THREE.InstancedBufferAttribute;
  private readonly geo: THREE.InstancedBufferGeometry;

  constructor(capacity: number, blending: THREE.Blending = THREE.AdditiveBlending, intensity = 1.6) {
    this.cap = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.size = new Float32Array(capacity);
    this.col = new Float32Array(capacity * 4);
    this.misc = new Float32Array(capacity * 7);

    const base = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = base.index;
    this.geo.setAttribute('position', base.getAttribute('position'));
    this.geo.setAttribute('uv', base.getAttribute('uv'));
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(
      THREE.DynamicDrawUsage,
    );
    this.aParams = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(
      THREE.DynamicDrawUsage,
    );
    this.geo.setAttribute('iPos', this.aPos);
    this.geo.setAttribute('iColor', this.aColor);
    this.geo.setAttribute('iParams', this.aParams);
    this.geo.instanceCount = 0;

    const mat = new THREE.ShaderMaterial({
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      uniforms: { uIntensity: { value: intensity } },
      transparent: true,
      depthWrite: false,
      blending,
    });
    if (blending === THREE.NormalBlending) {
      mat.blending = THREE.CustomBlending;
      mat.blendSrc = THREE.OneFactor;
      mat.blendDst = THREE.OneMinusSrcAlphaFactor;
    }
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
  }

  get count(): number {
    return this.n;
  }

  emit(o: EmitOpts): void {
    let i = this.n;
    if (i >= this.cap) {
      // recycle a random old particle rather than dropping the new (newer = more relevant)
      i = Math.floor(Math.random() * this.cap);
    } else {
      this.n++;
    }
    const p3 = i * 3;
    this.pos[p3] = o.x;
    this.pos[p3 + 1] = o.y;
    this.pos[p3 + 2] = o.z;
    this.vel[p3] = o.vx ?? 0;
    this.vel[p3 + 1] = o.vy ?? 0;
    this.vel[p3 + 2] = o.vz ?? 0;
    this.life[i] = o.life;
    this.maxLife[i] = o.life;
    this.size[i] = o.size;
    const c = typeof o.color === 'number' ? tmpColor.setHex(o.color) : o.color;
    const c4 = i * 4;
    this.col[c4] = c.r;
    this.col[c4 + 1] = c.g;
    this.col[c4 + 2] = c.b;
    this.col[c4 + 3] = o.alpha ?? 1;
    const m = i * 7;
    this.misc[m] = o.shape ?? Shape.Dot;
    this.misc[m + 1] = o.rot ?? Math.random() * Math.PI * 2;
    this.misc[m + 2] = o.spin ?? 0;
    this.misc[m + 3] = o.drag ?? 1.5;
    this.misc[m + 4] = o.gravity ?? 0;
    this.misc[m + 5] = o.stretch ?? 1;
    this.misc[m + 6] = o.sizeEnd ?? 0;
  }

  /** Radial burst on the XZ plane with some upward pop. */
  burst(
    x: number,
    y: number,
    z: number,
    count: number,
    color: THREE.Color | number,
    speed: number,
    opts: Partial<EmitOpts> = {},
  ): void {
    for (let k = 0; k < count; k++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.35 + Math.random() * 0.65);
      const up = (opts.vy ?? speed * 0.4) * Math.random();
      this.emit({
        x,
        y,
        z,
        vx: Math.cos(a) * s,
        vy: up,
        vz: Math.sin(a) * s,
        life: (opts.life ?? 0.6) * (0.6 + Math.random() * 0.6),
        size: (opts.size ?? 0.4) * (0.6 + Math.random() * 0.8),
        sizeEnd: opts.sizeEnd ?? 0,
        color,
        alpha: opts.alpha ?? 1,
        shape: opts.shape ?? Shape.Dot,
        drag: opts.drag ?? 3,
        gravity: opts.gravity ?? 0,
        spin: opts.spin ?? 0,
        stretch: opts.stretch ?? 1,
      });
    }
  }

  update(dt: number): void {
    let w = 0;
    const P = this.aPos.array as Float32Array;
    const C = this.aColor.array as Float32Array;
    const Q = this.aParams.array as Float32Array;
    for (let i = 0; i < this.n; i++) {
      const l = this.life[i]! - dt;
      if (l <= 0) continue;
      const p3 = i * 3;
      const m = i * 7;
      const drag = Math.exp(-this.misc[m + 3]! * dt);
      let vx = this.vel[p3]! * drag;
      let vy = this.vel[p3 + 1]! * drag - this.misc[m + 4]! * dt;
      let vz = this.vel[p3 + 2]! * drag;
      const px = this.pos[p3]! + vx * dt;
      let py = this.pos[p3 + 1]! + vy * dt;
      const pz = this.pos[p3 + 2]! + vz * dt;
      if (py < 0.02 && vy < 0) {
        // bounce off the floor so confetti skitters instead of sinking
        py = 0.02;
        vy = -vy * 0.35;
        vx *= 0.7;
        vz *= 0.7;
      }
      const rot = this.misc[m + 1]! + this.misc[m + 2]! * dt;
      const w3 = w * 3;
      const w4 = w * 4;
      const wm = w * 7;
      // compact live particles to the front so the draw range stays dense
      if (w !== i) {
        const i4 = i * 4;
        this.maxLife[w] = this.maxLife[i]!;
        this.size[w] = this.size[i]!;
        for (let k = 0; k < 4; k++) this.col[w4 + k] = this.col[i4 + k]!;
        for (let k = 0; k < 7; k++) this.misc[wm + k] = this.misc[m + k]!;
      }
      this.life[w] = l;
      this.pos[w3] = px;
      this.pos[w3 + 1] = py;
      this.pos[w3 + 2] = pz;
      this.vel[w3] = vx;
      this.vel[w3 + 1] = vy;
      this.vel[w3 + 2] = vz;
      this.misc[wm + 1] = rot;

      const max = this.maxLife[w]!;
      const t = 1 - l / max;
      const sz = this.size[w]! + (this.misc[wm + 6]! - this.size[w]!) * t;
      // fade in fast, fade out smoothly; single-frame "head" sprites never fade
      const fade = max < 0.06 ? 1 : Math.min(1, t * 12) * (1 - t * t);
      P[w3] = px;
      P[w3 + 1] = py;
      P[w3 + 2] = pz;
      C[w4] = this.col[w4]!;
      C[w4 + 1] = this.col[w4 + 1]!;
      C[w4 + 2] = this.col[w4 + 2]!;
      C[w4 + 3] = this.col[w4 + 3]! * fade;
      Q[w4] = Math.max(0, sz);
      Q[w4 + 1] = this.misc[wm]!;
      Q[w4 + 2] = rot;
      Q[w4 + 3] = this.misc[wm + 5]!;
      w++;
    }
    this.n = w;
    this.geo.instanceCount = w;
    this.aPos.needsUpdate = true;
    this.aColor.needsUpdate = true;
    this.aParams.needsUpdate = true;
    this.aPos.clearUpdateRanges();
    this.aPos.addUpdateRange(0, w * 3);
    this.aColor.clearUpdateRanges();
    this.aColor.addUpdateRange(0, w * 4);
    this.aParams.clearUpdateRanges();
    this.aParams.addUpdateRange(0, w * 4);
  }

  clear(): void {
    this.n = 0;
    this.geo.instanceCount = 0;
  }
}

/* ─────────────────────────── ground decals ─────────────────────────── */

export const enum GroundKind {
  Ring = 0,
  Disc = 1,
  Telegraph = 2,
  Shock = 3,
  Crack = 4,
  Wave = 5,
}

const GROUND_VERT = /* glsl */ `
attribute vec4 iA; // x, z, radius, kind
attribute vec4 iColor;
attribute vec4 iB; // progress, thickness, rotation, height
varying vec2 vUv;
varying vec4 vColor;
varying vec4 vA;
varying vec4 vB;
void main() {
  vUv = uv;
  vColor = iColor;
  vA = iA;
  vB = iB;
  vec3 p = position;
  float c = cos(iB.z), s = sin(iB.z);
  vec2 xz = vec2(c * p.x - s * p.y, s * p.x + c * p.y) * iA.z * 2.0;
  vec4 world = modelMatrix * vec4(iA.x + xz.x, iB.w, iA.y + xz.y, 1.0);
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const GROUND_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec4 vColor;
varying vec4 vA;
varying vec4 vB;
void main() {
  vec2 q = (vUv - 0.5) * 2.0;
  float r = length(q);
  float k = vA.w;
  float prog = vB.x;
  float th = vB.y;
  float a = 0.0;
  if (k < 0.5) {
    a = smoothstep(th, 0.0, abs(r - 0.94)) ;
  } else if (k < 1.5) {
    a = smoothstep(1.0, 0.0, r) * (0.6 + 0.4 * smoothstep(0.7, 1.0, r));
    a *= step(r, 1.0);
  } else if (k < 2.5) {
    // telegraph: faint fill, bright rim, filling core that shows time-to-impact
    float rim = smoothstep(0.05, 0.0, abs(r - 0.97));
    float fill = step(r, 1.0) * 0.16;
    float core = step(r, prog) * 0.32 * step(r, 1.0);
    float hatch = step(0.5, fract((q.x + q.y) * 6.0)) * 0.08 * step(r, 1.0);
    a = rim + fill + core + hatch;
  } else if (k < 3.5) {
    float edge = smoothstep(th, 0.0, abs(r - 0.94));
    float inner = smoothstep(0.94, 0.3, r) * 0.1 * step(r, 0.94);
    a = edge + inner;
  } else if (k > 4.5) {
    // sound wave: a wobbling ring with a bright leading edge
    float ang = atan(q.y, q.x + 1e-4);
    float wob = sin(ang * 26.0 + vB.x * 60.0) * 0.012 + sin(ang * 7.0 - vB.x * 20.0) * 0.008;
    float d = abs(r - 0.95 - wob);
    a = smoothstep(th, 0.0, d) * 1.4 + smoothstep(th * 5.0, 0.0, d) * 0.35;
  } else {
    // crack: jagged radial lines
    float ang = atan(q.y, q.x + 1e-4);
    float spokes = pow(abs(sin(ang * 7.0 + sin(ang * 23.0) * 0.6)), 40.0);
    a = spokes * smoothstep(1.0, 0.1, r) * step(r, 1.0);
  }
  a *= vColor.a;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor.rgb * a * 1.8, a);
}`;

interface GroundItem {
  x: number;
  z: number;
  r0: number;
  r1: number;
  kind: GroundKind;
  color: THREE.Color;
  alpha: number;
  life: number;
  max: number;
  thickness: number;
  rot: number;
  y: number;
  /** telegraphs report progress rather than expanding */
  fixed: boolean;
}

export class GroundFx {
  readonly mesh: THREE.Mesh;
  private readonly items: GroundItem[] = [];
  private readonly cap: number;
  private readonly aA: THREE.InstancedBufferAttribute;
  private readonly aB: THREE.InstancedBufferAttribute;
  private readonly aC: THREE.InstancedBufferAttribute;
  private readonly geo: THREE.InstancedBufferGeometry;

  /** `dark` decals subtract light (premultiplied over) — used for silence auras. */
  constructor(capacity = 600, dark = false) {
    this.cap = capacity;
    const base = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = base.index;
    this.geo.setAttribute('position', base.getAttribute('position'));
    this.geo.setAttribute('uv', base.getAttribute('uv'));
    const mk = (n: number): THREE.InstancedBufferAttribute =>
      new THREE.InstancedBufferAttribute(new Float32Array(capacity * n), n).setUsage(THREE.DynamicDrawUsage);
    this.aA = mk(4);
    this.aB = mk(4);
    this.aC = mk(4);
    this.geo.setAttribute('iA', this.aA);
    this.geo.setAttribute('iB', this.aB);
    this.geo.setAttribute('iColor', this.aC);
    this.geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      vertexShader: GROUND_VERT,
      fragmentShader: GROUND_FRAG,
      transparent: true,
      depthWrite: false,
      blending: dark ? THREE.CustomBlending : THREE.AdditiveBlending,
    });
    if (dark) {
      mat.blendSrc = THREE.OneFactor;
      mat.blendDst = THREE.OneMinusSrcAlphaFactor;
    }
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  add(
    kind: GroundKind,
    x: number,
    z: number,
    r0: number,
    r1: number,
    life: number,
    color: number | THREE.Color,
    opts: { alpha?: number; thickness?: number; rot?: number; y?: number; fixed?: boolean } = {},
  ): GroundItem {
    if (this.items.length >= this.cap) this.items.shift();
    const it: GroundItem = {
      x,
      z,
      r0,
      r1,
      kind,
      color: typeof color === 'number' ? new THREE.Color(color) : color.clone(),
      alpha: opts.alpha ?? 1,
      life,
      max: life,
      thickness: opts.thickness ?? 0.08,
      rot: opts.rot ?? Math.random() * 6.28,
      y: opts.y ?? 0.06,
      fixed: opts.fixed ?? false,
    };
    this.items.push(it);
    return it;
  }

  update(dt: number): void {
    const A = this.aA.array as Float32Array;
    const B = this.aB.array as Float32Array;
    const C = this.aC.array as Float32Array;
    let w = 0;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i]!;
      it.life -= dt;
      if (it.life <= 0) continue;
      this.items[w] = it;
      const t = 1 - it.life / it.max;
      const ease = 1 - Math.pow(1 - t, 3);
      const r = it.fixed ? it.r1 : it.r0 + (it.r1 - it.r0) * ease;
      const fade = it.fixed ? Math.min(1, t * 6) : 1 - t;
      const o = w * 4;
      A[o] = it.x;
      A[o + 1] = it.z;
      A[o + 2] = Math.max(0.01, r);
      A[o + 3] = it.kind;
      B[o] = it.fixed ? t : ease;
      // thickness is relative to radius, but never fatter than ~0.4 world units
      B[o + 1] = Math.min(it.thickness, 0.4 / Math.max(0.5, r));
      B[o + 2] = it.rot;
      B[o + 3] = it.y;
      C[o] = it.color.r;
      C[o + 1] = it.color.g;
      C[o + 2] = it.color.b;
      C[o + 3] = it.alpha * fade;
      w++;
    }
    this.items.length = w;
    this.geo.instanceCount = w;
    this.aA.needsUpdate = true;
    this.aB.needsUpdate = true;
    this.aC.needsUpdate = true;
  }

  clear(): void {
    this.items.length = 0;
    this.geo.instanceCount = 0;
  }
}

/* ─────────────────────────── beams & bolts ─────────────────────────── */

const BEAM_VERT = /* glsl */ `
attribute vec3 iA;
attribute vec3 iB;
attribute vec4 iColor;
attribute vec2 iW; // width, style
varying vec2 vUv;
varying vec4 vColor;
varying float vStyle;
void main() {
  vUv = uv;
  vColor = iColor;
  vStyle = iW.y;
  vec3 a = (modelMatrix * vec4(iA, 1.0)).xyz;
  vec3 b = (modelMatrix * vec4(iB, 1.0)).xyz;
  vec3 dir = normalize(b - a + vec3(1e-5));
  vec3 mid = mix(a, b, position.x + 0.5);
  vec3 toCam = normalize(cameraPosition - mid);
  vec3 side = normalize(cross(dir, toCam));
  vec3 p = mid + side * position.y * iW.x;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const BEAM_FRAG = /* glsl */ `
varying vec2 vUv;
varying vec4 vColor;
varying float vStyle;
void main() {
  float y = abs(vUv.y - 0.5) * 2.0;
  float core = smoothstep(0.35, 0.0, y);
  float glow = pow(max(0.0, 1.0 - y), 2.2);
  float ends = smoothstep(0.0, 0.04, vUv.x) * smoothstep(1.0, 0.96, vUv.x);
  float a = (core * 1.6 + glow * 0.8) * ends * vColor.a;
  vec3 col = mix(vColor.rgb, vec3(1.0), core * 0.65);
  if (a < 0.003) discard;
  gl_FragColor = vec4(col * a * 1.7, a);
}`;

interface BeamItem {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  w: number;
  color: THREE.Color;
  life: number;
  max: number;
  alpha: number;
}

export class BeamFx {
  readonly mesh: THREE.Mesh;
  private readonly items: BeamItem[] = [];
  private readonly cap: number;
  private readonly aA: THREE.InstancedBufferAttribute;
  private readonly aB: THREE.InstancedBufferAttribute;
  private readonly aC: THREE.InstancedBufferAttribute;
  private readonly aW: THREE.InstancedBufferAttribute;
  private readonly geo: THREE.InstancedBufferGeometry;

  constructor(capacity = 800) {
    this.cap = capacity;
    const base = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = base.index;
    this.geo.setAttribute('position', base.getAttribute('position'));
    this.geo.setAttribute('uv', base.getAttribute('uv'));
    const mk = (n: number): THREE.InstancedBufferAttribute =>
      new THREE.InstancedBufferAttribute(new Float32Array(capacity * n), n).setUsage(THREE.DynamicDrawUsage);
    this.aA = mk(3);
    this.aB = mk(3);
    this.aC = mk(4);
    this.aW = mk(2);
    this.geo.setAttribute('iA', this.aA);
    this.geo.setAttribute('iB', this.aB);
    this.geo.setAttribute('iColor', this.aC);
    this.geo.setAttribute('iW', this.aW);
    this.geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      vertexShader: BEAM_VERT,
      fragmentShader: BEAM_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 11;
  }

  add(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    width: number,
    color: number | THREE.Color,
    life: number,
    alpha = 1,
  ): void {
    if (this.items.length >= this.cap) this.items.shift();
    this.items.push({
      ax,
      ay,
      az,
      bx,
      by,
      bz,
      w: width,
      color: typeof color === 'number' ? new THREE.Color(color) : color.clone(),
      life,
      max: life,
      alpha,
    });
  }

  /** Jagged lightning between two points. */
  bolt(ax: number, az: number, bx: number, bz: number, color: number | THREE.Color, width = 0.25, life = 0.18): void {
    const segs = 6;
    let px = ax;
    let pz = az;
    const len = Math.hypot(bx - ax, bz - az);
    const nx = -(bz - az) / (len || 1);
    const nz = (bx - ax) / (len || 1);
    for (let i = 1; i <= segs; i++) {
      const t = i / segs;
      const j = i === segs ? 0 : (Math.random() - 0.5) * len * 0.28;
      const qx = ax + (bx - ax) * t + nx * j;
      const qz = az + (bz - az) * t + nz * j;
      this.add(px, 1, pz, qx, 1, qz, width, color, life);
      px = qx;
      pz = qz;
    }
  }

  update(dt: number): void {
    const A = this.aA.array as Float32Array;
    const B = this.aB.array as Float32Array;
    const C = this.aC.array as Float32Array;
    const W = this.aW.array as Float32Array;
    let w = 0;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i]!;
      it.life -= dt;
      if (it.life <= 0) continue;
      this.items[w] = it;
      const t = 1 - it.life / it.max;
      const o3 = w * 3;
      A[o3] = it.ax;
      A[o3 + 1] = it.ay;
      A[o3 + 2] = it.az;
      B[o3] = it.bx;
      B[o3 + 1] = it.by;
      B[o3 + 2] = it.bz;
      const o4 = w * 4;
      C[o4] = it.color.r;
      C[o4 + 1] = it.color.g;
      C[o4 + 2] = it.color.b;
      C[o4 + 3] = it.alpha * (1 - t * t);
      W[w * 2] = it.w * (1 - t * 0.5);
      W[w * 2 + 1] = 0;
      w++;
    }
    this.items.length = w;
    this.geo.instanceCount = w;
    this.aA.needsUpdate = true;
    this.aB.needsUpdate = true;
    this.aC.needsUpdate = true;
    this.aW.needsUpdate = true;
  }

  clear(): void {
    this.items.length = 0;
    this.geo.instanceCount = 0;
  }
}
