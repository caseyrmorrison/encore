import * as THREE from 'three';
import { INSTRUMENT_IDS, type InstrumentId } from '../seq/instruments';
import { PEDALS, PEDAL_IDS, type PedalId } from '../seq/cards';
import {
  buildBolt,
  buildGear,
  buildChevrons,
  buildHeart,
  buildInstrument,
  buildNote,
  buildPicks,
  buildRecord,
  buildRings,
} from './instrumentModels';

/**
 * Renders the procedural 3D props into PNG data URLs for the DOM UI (draft cards,
 * sequencer rows). The UI shows *real renders* of the same models used in-world.
 */
export class IconFactory {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  private readonly target: THREE.WebGLRenderTarget;
  private readonly size: number;
  private readonly cache = new Map<string, string>();
  private readonly pixels: Uint8Array;
  private readonly canvas: HTMLCanvasElement;
  private readonly small: HTMLCanvasElement;

  constructor(renderer: THREE.WebGLRenderer, env: THREE.Texture, size = 256) {
    this.renderer = renderer;
    this.size = size;
    const big = size * 2;
    this.target = new THREE.WebGLRenderTarget(big, big, { type: THREE.UnsignedByteType });
    this.target.texture.colorSpace = THREE.SRGBColorSpace;
    this.pixels = new Uint8Array(big * big * 4);
    this.canvas = document.createElement('canvas');
    this.canvas.width = big;
    this.canvas.height = big;
    this.small = document.createElement('canvas');
    this.small.width = size;
    this.small.height = size;
    this.scene.environment = env;
    this.scene.environmentIntensity = 1.1;
    const key = new THREE.DirectionalLight(0xfff0e0, 2.6);
    key.position.set(3, 5, 4);
    const rim = new THREE.DirectionalLight(0x8fb4ff, 2.2);
    rim.position.set(-4, 2, -3);
    const fill = new THREE.DirectionalLight(0xff7ad0, 0.8);
    fill.position.set(-3, -2, 4);
    this.scene.add(key, rim, fill, new THREE.AmbientLight(0x404050, 0.6));
    this.camera.position.set(0, 0, 7.2);
    this.camera.lookAt(0, 0, 0);
  }

  instrument(id: InstrumentId): string {
    return this.get(`i:${id}`, () => buildInstrument(id));
  }

  pedal(id: PedalId): string {
    return this.get(`p:${id}`, () => buildGear(id, PEDALS[id].color));
  }

  note(color: number): string {
    return this.get(`n:${color}`, () => buildNote(color));
  }

  fx(kind: 'accent' | 'ratchet' | 'echo'): string {
    return this.get(`fx:${kind}`, () =>
      kind === 'accent' ? buildBolt(0xff3b5c) : kind === 'ratchet' ? buildChevrons(0xffe14d) : buildRings(0x2ee6ff),
    );
  }

  heart(): string {
    return this.get('heart', () => buildHeart(0xff3b5c));
  }

  picks(): string {
    return this.get('picks', () => buildPicks());
  }

  goldRecord(): string {
    return this.get('gold', () => {
      const r = buildRecord(0xffe9a8, true);
      r.rotation.set(1.1, 0, 0.25);
      return r;
    });
  }

  /** Pre-render everything once at boot so opening a draft never hitches. */
  warm(): void {
    for (const id of INSTRUMENT_IDS) this.instrument(id);
    for (const id of PEDAL_IDS) this.pedal(id);
    this.fx('accent');
    this.fx('ratchet');
    this.fx('echo');
    this.heart();
    this.picks();
    this.goldRecord();
  }

  private get(key: string, build: () => THREE.Object3D): string {
    const hit = this.cache.get(key);
    if (hit) return hit;
    const url = this.render(build());
    this.cache.set(key, url);
    return url;
  }

  private render(obj: THREE.Object3D): string {
    // frame the object: fit its bounding sphere to the view
    const box = new THREE.Box3().setFromObject(obj);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    obj.position.sub(sphere.center);
    const holder = new THREE.Group();
    holder.add(obj);
    const fit = sphere.radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2));
    this.camera.position.set(0, 0, fit * 1.02);
    this.camera.near = fit * 0.2;
    this.camera.far = fit * 3;
    this.camera.updateProjectionMatrix();
    this.scene.add(holder);

    const prevTarget = this.renderer.getRenderTarget();
    const prevClear = this.renderer.getClearAlpha();
    const prevColor = this.renderer.getClearColor(new THREE.Color());
    this.renderer.setRenderTarget(this.target);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    const big = this.size * 2;
    this.renderer.readRenderTargetPixels(this.target, 0, 0, big, big, this.pixels);
    this.renderer.setRenderTarget(prevTarget);
    this.renderer.setClearColor(prevColor, prevClear);
    this.scene.remove(holder);

    const g = this.canvas.getContext('2d')!;
    const img = g.createImageData(big, big);
    // flip Y (GL origin is bottom-left) and un-premultiply is not needed for UnsignedByte targets
    for (let y = 0; y < big; y++) {
      const src = (big - 1 - y) * big * 4;
      img.data.set(this.pixels.subarray(src, src + big * 4), y * big * 4);
    }
    g.putImageData(img, 0, 0);
    const s = this.small.getContext('2d')!;
    s.clearRect(0, 0, this.size, this.size);
    s.imageSmoothingEnabled = true;
    s.imageSmoothingQuality = 'high';
    s.drawImage(this.canvas, 0, 0, this.size, this.size);
    return this.small.toDataURL('image/png');
  }
}
