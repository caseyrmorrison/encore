import * as THREE from 'three';
import { canvasTexture, M } from './materials';

/**
 * MIC — the last live microphone. A chrome grille ball with a light inside, a gold band,
 * an audio-reactive EQ halo and a glowing cable that trails behind like a comet tail.
 */
export class PlayerModel {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  private readonly core: THREE.Mesh;
  private readonly coreMat: THREE.MeshStandardMaterial;
  private readonly grille: THREE.Mesh;
  private readonly halo: THREE.InstancedMesh;
  private readonly haloMat: THREE.MeshBasicMaterial;
  private readonly beatRing: THREE.Mesh;
  private readonly beatRingMat: THREE.MeshBasicMaterial;
  private readonly glowPool: THREE.Mesh;
  private readonly cable: THREE.Mesh;
  private readonly cableGeo: THREE.BufferGeometry;
  private readonly cablePts: THREE.Vector3[] = [];
  private readonly cableLen = 34;
  private readonly bars = 36;
  private readonly m4 = new THREE.Matrix4();
  private readonly tmpColor = new THREE.Color();
  private hurtFlash = 0;
  coreColor = new THREE.Color(0xffd9a0);
  /** lift the whole rig (e.g. standing on the title stage) */
  baseY = 0;
  /** gameplay-only floor helpers (beat ring, light pool) */
  set showFloorFx(on: boolean) {
    this.beatRing.visible = on;
    this.glowPool.visible = on;
  }
  private readonly light: THREE.PointLight;

  constructor() {
    this.root.add(this.body);
    this.body.position.y = 1.15;
    this.body.scale.setScalar(1.35);
    this.light = new THREE.PointLight(0xffd9a0, 40, 14, 1.8);
    this.light.position.y = 2.2;
    this.root.add(this.light);

    this.coreMat = new THREE.MeshStandardMaterial({
      color: 0x000000,
      emissive: this.coreColor,
      emissiveIntensity: 3,
    });
    this.core = new THREE.Mesh(new THREE.SphereGeometry(0.56, 28, 20), this.coreMat);
    this.body.add(this.core);

    const grilleTex = canvasTexture(
      512,
      256,
      (g, w, h) => {
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, w, h);
        g.fillStyle = '#000000';
        // woven mesh: big round holes on an offset grid
        const step = 14;
        for (let y = 0; y < h + step; y += step / 2) {
          const off = (y / (step / 2)) % 2 === 0 ? 0 : step / 2;
          for (let x = -step; x < w + step; x += step) {
            g.beginPath();
            g.arc(x + off, y, 4.6, 0, Math.PI * 2);
            g.fill();
          }
        }
      },
      false,
    );
    grilleTex.wrapS = THREE.RepeatWrapping;
    grilleTex.wrapT = THREE.RepeatWrapping;
    grilleTex.repeat.set(2, 2);
    const grilleMat = new THREE.MeshStandardMaterial({
      color: 0xe8ecf4,
      metalness: 1,
      roughness: 0.2,
      alphaMap: grilleTex,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
    });
    this.grille = new THREE.Mesh(new THREE.SphereGeometry(0.72, 40, 28), grilleMat);
    this.body.add(this.grille);

    const band = new THREE.Mesh(new THREE.TorusGeometry(0.73, 0.075, 14, 48), M.gold());
    band.rotation.x = Math.PI / 2;
    this.body.add(band);
    const band2 = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.05, 12, 40), M.gold());
    band2.rotation.x = Math.PI / 2;
    band2.position.y = -0.38;
    this.body.add(band2);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.22, 0.55, 24), M.chrome());
    neck.position.y = -0.62;
    this.body.add(neck);
    const neckRing = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.04, 10, 32), M.glow(0xffd9a0, 2));
    neckRing.rotation.x = Math.PI / 2;
    neckRing.position.y = -0.85;
    this.body.add(neckRing);

    // EQ halo: bars standing on the floor around the mic
    this.haloMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const barGeo = new THREE.BoxGeometry(0.12, 1, 0.12);
    barGeo.translate(0, 0.5, 0);
    this.halo = new THREE.InstancedMesh(barGeo, this.haloMat, this.bars);
    this.halo.frustumCulled = false;
    for (let i = 0; i < this.bars; i++) {
      this.tmpColor.setHSL(i / this.bars, 0.9, 0.6);
      this.halo.setColorAt(i, this.tmpColor);
    }
    this.root.add(this.halo);

    // beat approach ring — shrinks onto the halo exactly on each beat
    this.beatRingMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.beatRing = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 64), this.beatRingMat);
    this.beatRing.rotation.x = -Math.PI / 2;
    this.beatRing.position.y = 0.05;
    this.root.add(this.beatRing);

    // warm pool of light on the floor, sells that the mic is a light source
    const poolTex = canvasTexture(128, 128, (g, w, h) => {
      const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      grd.addColorStop(0, 'rgba(255,220,170,0.9)');
      grd.addColorStop(0.4, 'rgba(255,190,120,0.35)');
      grd.addColorStop(1, 'rgba(255,160,90,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
    });
    this.glowPool = new THREE.Mesh(
      new THREE.PlaneGeometry(6, 6),
      new THREE.MeshBasicMaterial({
        map: poolTex,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0.55,
      }),
    );
    this.glowPool.rotation.x = -Math.PI / 2;
    this.glowPool.position.y = 0.03;
    this.root.add(this.glowPool);

    // cable: ribbon strip following recent positions (world space, not parented to root)
    this.cableGeo = new THREE.BufferGeometry();
    const n = this.cableLen;
    this.cableGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3));
    this.cableGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2 * 2), 2));
    const idx: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.cableGeo.setIndex(idx);
    const uv = this.cableGeo.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < n; i++) {
      uv.setXY(i * 2, i / (n - 1), 0);
      uv.setXY(i * 2 + 1, i / (n - 1), 1);
    }
    const cableMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0xffc070) }, uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uTime; varying vec2 vUv;
        void main(){
          float edge = 1.0 - abs(vUv.y - 0.5) * 2.0;
          float fade = pow(clamp(1.0 - vUv.x, 0.0, 1.0), 1.4);
          float pulse = 0.6 + 0.4 * sin(vUv.x * 40.0 - uTime * 14.0);
          float a = smoothstep(0.0, 0.5, edge) * fade;
          gl_FragColor = vec4(uColor * (1.2 + pulse) * a, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.cable = new THREE.Mesh(this.cableGeo, cableMat);
    this.cable.frustumCulled = false;
  }

  /** The cable lives in world space, so add it to the scene separately. */
  get cableMesh(): THREE.Mesh {
    return this.cable;
  }

  resetCable(x: number, z: number): void {
    this.cablePts.length = 0;
    for (let i = 0; i < this.cableLen; i++) this.cablePts.push(new THREE.Vector3(x, 0.45, z));
  }

  hurt(): void {
    this.hurtFlash = 1;
  }

  update(
    dt: number,
    time: number,
    x: number,
    z: number,
    facing: number,
    tilt: number,
    beatPhase: number,
    spectrum: Float32Array,
    dashing: boolean,
    invuln: boolean,
  ): void {
    this.root.position.set(x, this.baseY, z);
    const kick = Math.pow(1 - beatPhase, 6);
    this.body.position.y = 1.15 + Math.sin(time * 3) * 0.08 + kick * 0.1;
    this.body.rotation.set(tilt * 0.35, facing, 0);
    this.grille.rotation.y += dt * 0.6;
    const s = 1.35 * (1 + kick * 0.08 + (dashing ? 0.1 : 0));
    this.body.scale.set(s * (dashing ? 0.85 : 1), s * (dashing ? 1.2 : 1), s * (dashing ? 0.85 : 1));

    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 4);
    const flicker = invuln ? (Math.sin(time * 50) > 0 ? 1 : 0.35) : 1;
    this.coreMat.emissive.copy(this.coreColor).lerp(new THREE.Color(1, 0.1, 0.15), this.hurtFlash);
    this.coreMat.emissiveIntensity = (4 + kick * 5 + spectrum[2]! * 4) * flicker;
    this.light.color.copy(this.coreMat.emissive);
    this.light.intensity = (30 + kick * 40) * flicker;

    // halo bars
    for (let i = 0; i < this.bars; i++) {
      const a = (i / this.bars) * Math.PI * 2 + time * 0.25;
      const band = spectrum[Math.floor((Math.abs(((i / this.bars) * 2 - 1)) * 0.999) * spectrum.length)] ?? 0;
      const h = 0.08 + band * band * 2.4 + kick * 0.2;
      this.m4.makeRotationY(-a);
      this.m4.scale(new THREE.Vector3(1, h, 1));
      this.m4.setPosition(Math.cos(a) * 1.55, 0.02, Math.sin(a) * 1.55);
      this.halo.setMatrixAt(i, this.m4);
    }
    this.halo.instanceMatrix.needsUpdate = true;

    // approach ring: radius 4 → 1.55 across the beat
    this.beatRing.scale.setScalar(1.55 + (1 - beatPhase) * 2.6);
    this.beatRingMat.opacity = 0.08 + Math.pow(1 - beatPhase, 0.5) * 0.12 + kick * 0.5;

    this.glowPool.scale.setScalar(1 + kick * 0.25);

    // cable
    const head = new THREE.Vector3(x - Math.sin(facing) * 0.5, 0.5, z - Math.cos(facing) * 0.5);
    if (this.cablePts.length === 0) this.resetCable(x, z);
    this.cablePts[0]!.copy(head);
    for (let i = 1; i < this.cablePts.length; i++) {
      const prev = this.cablePts[i - 1]!;
      const p = this.cablePts[i]!;
      const dx = p.x - prev.x;
      const dz = p.z - prev.z;
      const d = Math.hypot(dx, dz);
      const seg = 0.32;
      if (d > seg) {
        p.x = prev.x + (dx / d) * seg;
        p.z = prev.z + (dz / d) * seg;
      }
      p.y = 0.12 + 0.35 * Math.pow(1 - i / this.cablePts.length, 2);
    }
    const pos = this.cableGeo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < this.cablePts.length; i++) {
      const p = this.cablePts[i]!;
      const q = this.cablePts[Math.min(i + 1, this.cablePts.length - 1)]!;
      const o = this.cablePts[Math.max(i - 1, 0)]!;
      let tx = q.x - o.x;
      let tz = q.z - o.z;
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl;
      tz /= tl;
      const w = 0.14 * (1 - (i / this.cablePts.length) * 0.6);
      pos.setXYZ(i * 2, p.x - tz * w, p.y, p.z + tx * w);
      pos.setXYZ(i * 2 + 1, p.x + tz * w, p.y, p.z - tx * w);
    }
    pos.needsUpdate = true;
    (this.cable.material as THREE.ShaderMaterial).uniforms.uTime!.value = time;
  }

  setHaloPalette(colors: number[]): void {
    for (let i = 0; i < this.bars; i++) {
      const t = (i / this.bars) * colors.length;
      const a = new THREE.Color(colors[Math.floor(t) % colors.length]!);
      const b = new THREE.Color(colors[(Math.floor(t) + 1) % colors.length]!);
      this.tmpColor.copy(a).lerp(b, t - Math.floor(t));
      this.halo.setColorAt(i, this.tmpColor);
    }
    if (this.halo.instanceColor) this.halo.instanceColor.needsUpdate = true;
  }
}
