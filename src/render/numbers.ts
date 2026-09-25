import * as THREE from 'three';
import { formatInt } from '../core/math';

/**
 * Floating damage numbers as instanced glyph quads sampling a canvas-rendered atlas.
 * Hundreds on screen cost a single draw call.
 */
const GLYPHS = '0123456789.,KMBTQaixnoSpcdOND+-!×e';
const COLS = 8;
const CELL_W = 64;
const CELL_H = 84;

const VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec4 iColor;
attribute vec3 iGlyph; // glyph index, x offset (in glyph widths), scale
varying vec2 vUv;
varying vec4 vColor;
void main() {
  float gi = iGlyph.x;
  float col = mod(gi, ${COLS}.0);
  float row = floor(gi / ${COLS}.0);
  vec2 cell = vec2(1.0 / ${COLS}.0, 1.0 / ${Math.ceil(GLYPHS.length / COLS)}.0);
  vUv = vec2((col + uv.x) * cell.x, 1.0 - (row + 1.0 - uv.y) * cell.y);
  vColor = iColor;
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  vec2 p = position.xy * vec2(0.76, 1.0);
  p.x += iGlyph.y * 0.62;
  mv.xy += p * iGlyph.z;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
uniform sampler2D uAtlas;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  vec4 t = texture2D(uAtlas, vUv);
  // r = fill, g = outline
  float fill = t.r;
  float outline = t.g;
  vec3 col = mix(vec3(0.02, 0.0, 0.04), vColor.rgb, fill);
  float a = max(fill, outline) * vColor.a;
  if (a < 0.01) discard;
  gl_FragColor = vec4(col * a, a);
}`;

interface Num {
  x: number;
  y: number;
  z: number;
  text: string;
  color: THREE.Color;
  size: number;
  life: number;
  max: number;
  vx: number;
  vy: number;
}

export class DamageNumbers {
  readonly mesh: THREE.Mesh;
  private readonly nums: Num[] = [];
  private readonly cap: number;
  private readonly aPos: THREE.InstancedBufferAttribute;
  private readonly aColor: THREE.InstancedBufferAttribute;
  private readonly aGlyph: THREE.InstancedBufferAttribute;
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly glyphIndex = new Map<string, number>();

  constructor(capacity = 2400) {
    this.cap = capacity;
    for (let i = 0; i < GLYPHS.length; i++) this.glyphIndex.set(GLYPHS[i]!, i);
    const rows = Math.ceil(GLYPHS.length / COLS);
    const canvas = document.createElement('canvas');
    canvas.width = COLS * CELL_W;
    canvas.height = rows * CELL_H;
    const g = canvas.getContext('2d')!;
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '62px Bungee, Impact, sans-serif';
    g.lineJoin = 'round';
    for (let i = 0; i < GLYPHS.length; i++) {
      const cx = (i % COLS) * CELL_W + CELL_W / 2;
      const cy = Math.floor(i / COLS) * CELL_H + CELL_H / 2 + 4;
      g.strokeStyle = 'rgb(0,255,0)';
      g.lineWidth = 12;
      g.strokeText(GLYPHS[i]!, cx, cy);
    }
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < GLYPHS.length; i++) {
      const cx = (i % COLS) * CELL_W + CELL_W / 2;
      const cy = Math.floor(i / COLS) * CELL_H + CELL_H / 2 + 4;
      g.fillStyle = 'rgb(255,0,0)';
      g.fillText(GLYPHS[i]!, cx, cy);
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;

    const base = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = base.index;
    this.geo.setAttribute('position', base.getAttribute('position'));
    this.geo.setAttribute('uv', base.getAttribute('uv'));
    const mk = (n: number): THREE.InstancedBufferAttribute =>
      new THREE.InstancedBufferAttribute(new Float32Array(capacity * n), n).setUsage(THREE.DynamicDrawUsage);
    this.aPos = mk(3);
    this.aColor = mk(4);
    this.aGlyph = mk(3);
    this.geo.setAttribute('iPos', this.aPos);
    this.geo.setAttribute('iColor', this.aColor);
    this.geo.setAttribute('iGlyph', this.aGlyph);
    this.geo.instanceCount = 0;
    this.mesh = new THREE.Mesh(
      this.geo,
      new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: { uAtlas: { value: tex } },
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.CustomBlending,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneMinusSrcAlphaFactor,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 50;
  }

  spawn(x: number, y: number, z: number, value: number, color: THREE.Color | number, size = 0.8, prefix = ''): void {
    if (this.nums.length > 320) this.nums.shift();
    const text = prefix + formatInt(value);
    this.nums.push({
      // fan out so neighbouring hits don't stack into one unreadable blob
      x: x + (Math.random() - 0.5) * 1.4,
      y,
      z: z + (Math.random() - 0.5) * 0.8,
      text,
      color: typeof color === 'number' ? new THREE.Color(color) : color.clone(),
      size,
      life: 0.62 + size * 0.2,
      max: 0.62 + size * 0.2,
      vx: (Math.random() - 0.5) * 4,
      vy: 3.2 + size * 1.2,
    });
  }

  text(x: number, y: number, z: number, text: string, color: THREE.Color | number, size = 1): void {
    const filtered = [...text].filter((c) => this.glyphIndex.has(c)).join('');
    this.nums.push({
      x,
      y,
      z,
      text: filtered,
      color: typeof color === 'number' ? new THREE.Color(color) : color.clone(),
      size,
      life: 1.2,
      max: 1.2,
      vx: 0,
      vy: 2.5,
    });
  }

  update(dt: number): void {
    const P = this.aPos.array as Float32Array;
    const C = this.aColor.array as Float32Array;
    const G = this.aGlyph.array as Float32Array;
    let n = 0;
    let w = 0;
    for (let i = 0; i < this.nums.length; i++) {
      const it = this.nums[i]!;
      it.life -= dt;
      if (it.life <= 0) continue;
      this.nums[w++] = it;
      it.vy -= 9 * dt;
      it.x += it.vx * dt;
      it.y += Math.max(-1, it.vy) * dt;
      const t = 1 - it.life / it.max;
      // pop: overshoot then settle, fade at the end
      const pop = t < 0.12 ? 0.4 + (t / 0.12) * 1.1 : 1.5 - Math.min(0.5, (t - 0.12) * 3);
      const alpha = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
      const s = it.size * pop;
      const len = it.text.length;
      for (let k = 0; k < len && n < this.cap; k++) {
        const gi = this.glyphIndex.get(it.text[k]!);
        if (gi === undefined) continue;
        P[n * 3] = it.x;
        P[n * 3 + 1] = it.y;
        P[n * 3 + 2] = it.z;
        C[n * 4] = it.color.r;
        C[n * 4 + 1] = it.color.g;
        C[n * 4 + 2] = it.color.b;
        C[n * 4 + 3] = alpha;
        G[n * 3] = gi;
        G[n * 3 + 1] = k - (len - 1) / 2;
        G[n * 3 + 2] = s;
        n++;
      }
    }
    this.nums.length = w;
    this.geo.instanceCount = n;
    this.aPos.needsUpdate = true;
    this.aColor.needsUpdate = true;
    this.aGlyph.needsUpdate = true;
  }

  clear(): void {
    this.nums.length = 0;
    this.geo.instanceCount = 0;
  }
}
