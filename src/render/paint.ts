import * as THREE from 'three';

/**
 * Silence is colourless; music paints it back. Every kill splats neon in the colour of the
 * instrument that landed it onto a canvas that the venue floors sample (additively, pulsing
 * on the beat), so each set leaves its own painted floor behind.
 *
 * The canvas maps the arena's bounding rectangle; uploads are throttled because many kills
 * land in the same frame late in a run.
 */
export const PAINT_UNIFORMS = {
  uPaint: { value: null as THREE.Texture | null },
  /** arena half extents in world units (x, z) */
  uPaintHalf: { value: new THREE.Vector2(30, 22) },
  /** 0..1 how hard the paint glows this frame (beat, drops) */
  uPaintGlow: { value: 0.6 },
};

/** GLSL for the floor shaders (appended to GLSL_COMMON). */
export const GLSL_PAINT = /* glsl */ `
uniform sampler2D uPaint;
uniform vec2 uPaintHalf;
uniform float uPaintGlow;
// tint first (so a bright floor keeps the paint's hue instead of going white), then glow
vec3 paintOver(vec3 col, vec2 w) {
  vec2 uv = w / (2.0 * uPaintHalf) + 0.5;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return col;
  vec4 p = texture2D(uPaint, uv);
  col = mix(col, col * 0.35 + p.rgb * 0.55, p.a * 0.65);
  return col + p.rgb * p.a * uPaintGlow * 0.55;
}
`;

const SIZE = 512;

export class PaintLayer {
  readonly texture: THREE.CanvasTexture;
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private hx = 30;
  private hz = 22;
  private dirty = false;
  private cool = 0;
  private readonly tmp = new THREE.Color();

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = SIZE;
    this.canvas.height = SIZE;
    this.g = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    // canvas row 0 = -z edge of the arena, matching the shader's uv without a flip
    this.texture.flipY = false;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;
    PAINT_UNIFORMS.uPaint.value = this.texture;
    this.clear();
  }

  /** A new venue: fresh floor, new mapping. */
  reset(hx: number, hz: number): void {
    this.hx = hx;
    this.hz = hz;
    PAINT_UNIFORMS.uPaintHalf.value.set(hx, hz);
    this.clear();
  }

  clear(): void {
    this.g.clearRect(0, 0, SIZE, SIZE);
    this.dirty = true;
  }

  /** A kill: a soft blob with a few droplets thrown outward, like paint off a speaker cone. */
  splat(x: number, z: number, radius: number, color: THREE.Color | number, strength = 1): void {
    const u = ((x + this.hx) / (2 * this.hx)) * SIZE;
    const v = ((z + this.hz) / (2 * this.hz)) * SIZE;
    const pxPerUnit = SIZE / (2 * Math.max(this.hx, this.hz));
    const r = radius * pxPerUnit;
    if (u < -r || v < -r || u > SIZE + r || v > SIZE + r) return;
    // getHex() is sRGB-encoded, which is what the canvas (an sRGB texture) expects
    const hex = this.tmp.set(color).getHex();
    const rgb = `${(hex >> 16) & 255},${(hex >> 8) & 255},${hex & 255}`;
    const g = this.g;
    const a = Math.min(1, 0.42 * strength);
    const grad = g.createRadialGradient(u, v, 0, u, v, r);
    // a crisp-edged puddle (soft gradients read as fog, not paint)
    grad.addColorStop(0, `rgba(${rgb},${a})`);
    grad.addColorStop(0.72, `rgba(${rgb},${a * 0.85})`);
    grad.addColorStop(0.86, `rgba(${rgb},${a * 0.45})`);
    grad.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = grad;
    g.beginPath();
    g.arc(u, v, r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = `rgba(${rgb},${Math.min(1, a * 1.6)})`;
    const drops = 3 + Math.floor(Math.random() * 4);
    for (let i = 0; i < drops; i++) {
      const ang = Math.random() * Math.PI * 2;
      const d = r * (0.8 + Math.random() * 0.9);
      g.beginPath();
      g.arc(u + Math.cos(ang) * d, v + Math.sin(ang) * d, Math.max(1, r * (0.08 + Math.random() * 0.12)), 0, Math.PI * 2);
      g.fill();
    }
    this.dirty = true;
  }

  update(dt: number): void {
    this.cool -= dt;
    if (!this.dirty || this.cool > 0) return;
    this.texture.needsUpdate = true;
    this.dirty = false;
    this.cool = 0.07;
  }

  /** The floor so far, for the poster. */
  snapshot(): HTMLCanvasElement {
    return this.canvas;
  }
}
