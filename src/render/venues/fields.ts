import * as THREE from 'three';
import type { Rng } from '../../core/rng';
import { GLSL_COMMON, RippleBank, ringSpawn, type Bounds, type FrameInfo, type Venue, type VenuePalette } from './venue';

/**
 * SUNSET FIELDS — a local open-air festival at golden hour.
 * (Placeholder stage: floor, bounds and lighting only; the set dressing comes next.)
 */
const HX = 48;
const HZ = 32;

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
uniform vec2 uHalf;
uniform vec3 uBase;
uniform vec3 uLine;
varying vec3 vWorld;
void main() {
  vec2 w = vWorld.xz;
  float beat = pow(1.0 - uBeat, 2.2);
  vec3 col = uBase * (0.8 + 0.4 * fbm(w * 0.08));
  vec2 g = abs(fract(w / 8.0) - 0.5) * 8.0;
  col += uLine * smoothstep(0.1, 0.0, min(g.x, g.y)) * (0.3 + beat * 0.4);
  col += ripples(w);
  col = paintOver(col, w);
  float inside = step(abs(w.x), uHalf.x) * step(abs(w.y), uHalf.y);
  col = mix(col * 0.25, col, inside);
  gl_FragColor = vec4(col, 1.0);
}`;

export class Fields implements Venue {
  readonly id = 'fields' as const;
  readonly name = 'SUNSET FIELDS';
  readonly tagline = 'Hay bales, fairy lights, a ferris wheel. The first real festival.';
  readonly bpm = 128;
  readonly progression = 'fields' as const;
  readonly bounds: Bounds = { kind: 'rect', hx: HX, hz: HZ };
  readonly palette: VenuePalette = {
    rim: new THREE.Color(0xffb070),
    floor: new THREE.Color(0x8ccf5a),
    accents: [0xffb13d, 0xff5e7a, 0xffe14d, 0x8cff5a],
    fog: 0x2a1420,
    fogDensity: 0.004,
    background: 0x2a1420,
    core: 0xffffff,
  };
  readonly group = new THREE.Group();
  readonly obstacles: { x: number; z: number; r: number }[] = [];
  private readonly floorMat: THREE.ShaderMaterial;
  private readonly rip = new RippleBank();

  constructor() {
    this.floorMat = new THREE.ShaderMaterial({
      vertexShader: FLOOR_VERT,
      fragmentShader: FLOOR_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uBeat: { value: 0 },
        uHalf: { value: new THREE.Vector2(HX, HZ) },
        uBase: { value: new THREE.Color(0x1b2a12) },
        uLine: { value: new THREE.Color(0xffc070) },
        ...this.rip.uniforms(),
      },
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(HX * 2 + 80, HZ * 2 + 80), this.floorMat);
    floor.rotation.x = -Math.PI / 2;
    this.group.add(floor);
    const hemi = new THREE.HemisphereLight(0xffc8a0, 0x100418, 1.2);
    this.group.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 1.3);
    key.position.set(10, 30, 12);
    this.group.add(key);
  }

  ripple(x: number, z: number, color: THREE.Color | number, strength = 1): void {
    this.rip.add(x, z, this.floorMat.uniforms.uTime!.value as number, color, strength);
  }

  onStep(_step: number, _bar: number): void {}

  update(f: FrameInfo): void {
    this.floorMat.uniforms.uTime!.value = f.time;
    this.floorMat.uniforms.uBeat!.value = f.beatPhase;
  }

  spawnPoint(rng: Rng, px: number, pz: number, out: { x: number; z: number }): void {
    ringSpawn(this.bounds, this.obstacles, rng, px, pz, out);
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
  }
}
