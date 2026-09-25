import * as THREE from 'three';
import type { Rng } from '../../core/rng';
import { GLSL_COMMON, RippleBank, ringSpawn, type Bounds, type FrameInfo, type Venue, type VenuePalette } from './venue';

/**
 * MEGAFEST — the biggest festival on Earth.
 * (Placeholder stage: floor, bounds and lighting only; the set dressing comes next.)
 */
const HX = 66;
const HZ = 42;

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

export class Megafest implements Venue {
  readonly id = 'megafest' as const;
  readonly name = 'MEGAFEST';
  readonly tagline = 'A hundred thousand people. Three stages. The whole world listening.';
  readonly bpm = 150;
  readonly progression = 'megafest' as const;
  readonly bounds: Bounds = { kind: 'rect', hx: HX, hz: HZ };
  readonly palette: VenuePalette = {
    rim: new THREE.Color(0x9fb8ff),
    floor: new THREE.Color(0xffffff),
    accents: [0x2ee6ff, 0xff2d78, 0xffd36b, 0x8c5aff],
    fog: 0x04030a,
    fogDensity: 0.004,
    background: 0x020108,
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
        uBase: { value: new THREE.Color(0x0c0c12) },
        uLine: { value: new THREE.Color(0x8c5aff) },
        ...this.rip.uniforms(),
      },
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(HX * 2 + 80, HZ * 2 + 80), this.floorMat);
    floor.rotation.x = -Math.PI / 2;
    this.group.add(floor);
    const hemi = new THREE.HemisphereLight(0x8090ff, 0x100418, 1.2);
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
