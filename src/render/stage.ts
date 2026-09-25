import * as THREE from 'three';
import {
  BloomEffect,
  BlendFunction,
  ChromaticAberrationEffect,
  EffectComposer,
  HueSaturationEffect,
  EffectPass,
  NoiseEffect,
  RenderPass,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';

export interface QualitySettings {
  pixelRatio: number;
  msaa: number;
  bloomScale: number;
}

export const QUALITY: Record<'high' | 'medium' | 'low', QualitySettings> = {
  high: { pixelRatio: 2, msaa: 4, bloomScale: 1 },
  medium: { pixelRatio: 1.5, msaa: 2, bloomScale: 0.75 },
  low: { pixelRatio: 1, msaa: 0, bloomScale: 0.5 },
};

/** Renderer + post stack. The "look" knobs (bloom, aberration) are driven by gameplay each frame. */
export class Stage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly composer: EffectComposer;
  readonly bloom: BloomEffect;
  readonly aberration: ChromaticAberrationEffect;
  readonly vignette: VignetteEffect;
  private readonly noise: NoiseEffect;
  readonly hueSat: HueSaturationEffect;
  /** world colour: pulled toward grey while the Hush holds its silence */
  baseSaturation = 0;
  /** 0..1 build-up tunnel vision; drop saturation surge */
  buildUp = 0;
  surge = 0;
  /** Extra aberration pulse; decays each frame. */
  aberrationKick = 0;
  bloomKick = 0;
  baseBloom = 1.15;

  constructor(canvas: HTMLCanvasElement, quality: QualitySettings) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      stencil: false,
      depth: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.pixelRatio));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = false;

    this.camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.5, 400);
    this.scene.background = new THREE.Color(0x05040a);

    this.composer = new EffectComposer(this.renderer, {
      frameBufferType: THREE.HalfFloatType,
      multisampling: quality.msaa,
    });
    this.composer.addPass(new RenderPass(this.scene, this.camera));

    this.bloom = new BloomEffect({
      mipmapBlur: true,
      luminanceThreshold: 0.55,
      luminanceSmoothing: 0.25,
      intensity: this.baseBloom,
      radius: 0.78,
      levels: 7,
    });
    this.bloom.resolution.scale = quality.bloomScale;
    this.vignette = new VignetteEffect({ offset: 0.28, darkness: 0.62 });
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    this.composer.addPass(new EffectPass(this.camera, this.bloom, tone, this.vignette));

    this.aberration = new ChromaticAberrationEffect({
      offset: new THREE.Vector2(0.0006, 0.0004),
      radialModulation: true,
      // the fringe lives at the edges: the middle of the screen (where you play) stays crisp
      modulationOffset: 0.45,
    });
    this.noise = new NoiseEffect({ blendFunction: BlendFunction.OVERLAY, premultiply: false });
    this.noise.blendMode.opacity.value = 0.09;
    this.hueSat = new HueSaturationEffect({ hue: 0, saturation: 0 });
    this.composer.addPass(new EffectPass(this.camera, this.aberration, this.noise, this.hueSat));

    window.addEventListener('resize', this.onResize);
  }

  setQuality(q: QualitySettings): void {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.pixelRatio));
    this.composer.multisampling = q.msaa;
    this.bloom.resolution.scale = q.bloomScale;
    this.onResize();
  }

  private onResize = (): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
  };

  render(dt: number): void {
    this.aberrationKick *= Math.exp(-dt * 7);
    this.bloomKick *= Math.exp(-dt * 5);
    const ab = 0.0005 + Math.min(1, this.aberrationKick) * 0.008;
    this.aberration.offset.set(ab, ab * 0.6);
    this.bloom.intensity = this.baseBloom + this.bloomKick;
    this.surge *= Math.exp(-dt * 0.9);
    this.vignette.darkness = 0.62 + this.buildUp * 0.33;
    this.vignette.offset = 0.28 - this.buildUp * 0.12;
    this.hueSat.saturation = this.baseSaturation + this.surge * 0.35 - this.buildUp * 0.35;
    this.composer.render(dt);
  }
}
