import * as THREE from 'three';
import type { SkinDef } from '../seq/badges';
import { canvasTexture, M } from './materials';

/**
 * MIC — the last live microphone. A classic handheld stage mic: chrome ball grille with a
 * warm light inside, a gold band, a black tapered handle trailing into a glowing cable.
 * Tilted head-forward so the silhouette reads as "microphone" from the top-down camera.
 */
export class PlayerModel {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  private readonly mic = new THREE.Group();
  private readonly core: THREE.Mesh;
  private readonly coreMat: THREE.MeshStandardMaterial;
  private readonly grille: THREE.Mesh;
  private readonly halo: THREE.InstancedMesh;
  private readonly haloMat: THREE.MeshBasicMaterial;
  private grilleMat!: THREE.MeshPhysicalMaterial;
  private bandMat!: THREE.MeshStandardMaterial;
  private handleMat!: THREE.MeshStandardMaterial;
  private badgeMat!: THREE.MeshStandardMaterial;
  private readonly beatRing: THREE.Mesh;
  private readonly beatRingMat: THREE.MeshBasicMaterial;
  /** drawn over everything: you can always find yourself inside a horde */
  private readonly locator: THREE.Mesh;
  private readonly locatorMat: THREE.MeshBasicMaterial;
  private readonly glowPool: THREE.Mesh;
  private readonly poolMat: THREE.MeshBasicMaterial;
  private readonly cable: THREE.Mesh;
  private readonly cableGeo: THREE.BufferGeometry;
  private readonly cablePts: THREE.Vector3[] = [];
  private readonly cableLen = 34;
  private readonly bars = 36;
  private readonly m4 = new THREE.Matrix4();
  private readonly tmpColor = new THREE.Color();
  private readonly light: THREE.PointLight;
  private hurtFlash = 0;
  coreColor = new THREE.Color(0xffd9a0);
  /** lift the whole rig (e.g. standing on the title stage) */
  baseY = 0;
  private readonly tail = new THREE.Vector3();

  /** gameplay-only floor helpers (beat ring, light pool) */
  /** Dress the mic in a skin (unlocked by tour badges). */
  setSkin(k: SkinDef): void {
    this.grilleMat.color.setHex(k.grille);
    this.grilleMat.emissive.setHex(k.glow);
    this.grilleMat.emissiveIntensity = k.glow ? 0.9 : 0;
    this.grilleMat.iridescence = k.iridescent ? 1 : 0;
    this.bandMat.color.setHex(k.band);
    this.handleMat.color.setHex(k.handle);
    this.handleMat.metalness = k.id === 'classic' ? 0.25 : 0.6;
    this.handleMat.roughness = k.id === 'classic' ? 0.55 : 0.28;
    this.badgeMat.color.setHex(0);
    this.badgeMat.emissive.setHex(k.badge);
  }

  set showFloorFx(on: boolean) {
    this.beatRing.visible = on;
    this.glowPool.visible = on;
    this.halo.visible = on;
    this.locator.visible = on;
  }

  constructor() {
    this.root.add(this.body);
    this.body.position.y = 1.5;
    this.body.add(this.mic);
    // head leads, handle trails behind and down (≈45° so the grille faces the camera)
    this.mic.rotation.x = 0.78;

    this.coreMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: this.coreColor, emissiveIntensity: 1.6 });
    this.core = new THREE.Mesh(new THREE.SphereGeometry(0.62, 28, 20), this.coreMat);
    this.mic.add(this.core);

    const grilleTex = canvasTexture(
      512,
      256,
      (g, w, h) => {
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, w, h);
        g.fillStyle = '#000000';
        const step = 12;
        for (let y = 0; y < h + step; y += step / 2) {
          const off = (y / (step / 2)) % 2 === 0 ? 0 : step / 2;
          for (let x = -step; x < w + step; x += step) {
            g.beginPath();
            g.arc(x + off, y, 3.6, 0, Math.PI * 2);
            g.fill();
          }
        }
      },
      false,
    );
    grilleTex.wrapS = THREE.RepeatWrapping;
    grilleTex.wrapT = THREE.RepeatWrapping;
    grilleTex.repeat.set(2, 2);
    const grilleMat = new THREE.MeshPhysicalMaterial({
      color: 0xf2f4fa,
      metalness: 1,
      roughness: 0.18,
      alphaMap: grilleTex,
      alphaTest: 0.5,
      side: THREE.DoubleSide,
      iridescenceIOR: 1.6,
      iridescenceThicknessRange: [200, 900],
    });
    this.grilleMat = grilleMat;
    this.grille = new THREE.Mesh(new THREE.SphereGeometry(0.8, 40, 28, 0, Math.PI * 2, 0, Math.PI * 0.78), grilleMat);
    this.mic.add(this.grille);
    const seam = new THREE.Mesh(new THREE.TorusGeometry(0.8, 0.05, 10, 48), M.chrome());
    seam.rotation.x = Math.PI / 2;
    this.mic.add(seam);
    this.bandMat = M.gold().clone();
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.58, 0.28, 32), this.bandMat);
    band.position.y = -0.72;
    this.mic.add(band);
    const handleMat = new THREE.MeshStandardMaterial({ color: 0x17161b, roughness: 0.55, metalness: 0.25 });
    this.handleMat = handleMat;
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.56, 0.3, 2.3, 32), handleMat);
    handle.position.y = -2.0;
    this.mic.add(handle);
    this.badgeMat = M.glow(0xff2d78, 2).clone();
    const badge = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.49, 0.1, 32), this.badgeMat);
    badge.position.y = -1.35;
    this.mic.add(badge);
    const plug = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.26, 0.35, 20), M.chrome());
    plug.position.y = -3.3;
    this.mic.add(plug);
    // dark outline shell (inverted hull) so the mic never dissolves into bright effects
    const hull = new THREE.MeshBasicMaterial({ color: 0x050308, side: THREE.BackSide });
    const headHull = new THREE.Mesh(new THREE.SphereGeometry(0.9, 24, 16), hull);
    this.mic.add(headHull);
    const handleHull = new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.38, 2.9, 20), hull);
    handleHull.position.y = -2.0;
    this.mic.add(handleHull);

    this.light = new THREE.PointLight(0xffd9a0, 40, 14, 1.8);
    this.light.position.y = 2.4;
    this.root.add(this.light);

    // EQ halo: bars standing on the floor around the mic
    this.haloMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
    const barGeo = new THREE.BoxGeometry(0.14, 1, 0.14);
    barGeo.translate(0, 0.5, 0);
    this.halo = new THREE.InstancedMesh(barGeo, this.haloMat, this.bars);
    this.halo.frustumCulled = false;
    for (let i = 0; i < this.bars; i++) {
      this.tmpColor.setHSL(i / this.bars, 0.9, 0.6);
      this.halo.setColorAt(i, this.tmpColor);
    }
    this.root.add(this.halo);

    // beat approach ring — closes onto the halo exactly on each beat (dash when it lands)
    this.beatRingMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.beatRing = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 72), this.beatRingMat);
    this.beatRing.rotation.x = -Math.PI / 2;
    this.beatRing.position.y = 0.05;
    this.root.add(this.beatRing);

    this.locatorMat = new THREE.MeshBasicMaterial({
      color: 0x2ee6ff,
      transparent: true,
      opacity: 0.5,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const loc = new THREE.RingGeometry(1.75, 1.9, 64, 1, 0, Math.PI * 2);
    this.locator = new THREE.Mesh(loc, this.locatorMat);
    this.locator.rotation.x = -Math.PI / 2;
    this.locator.position.y = 0.08;
    this.locator.renderOrder = 20;
    this.root.add(this.locator);

    // hard-edged coloured follow-spot on the floor
    const poolTex = canvasTexture(256, 256, (g, w, h) => {
      const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      // signature hot-pink ring: dim interior, bright hard rim
      grd.addColorStop(0, 'rgba(255,255,255,0.12)');
      grd.addColorStop(0.7, 'rgba(255,255,255,0.16)');
      grd.addColorStop(0.78, 'rgba(255,255,255,1)');
      grd.addColorStop(0.84, 'rgba(255,255,255,0.0)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
    });
    this.poolMat = new THREE.MeshBasicMaterial({
      map: poolTex,
      color: 0xffd9a0,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.55,
    });
    this.glowPool = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 4.6), this.poolMat);
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
          // signal pulses travelling down the lead
          float pulse = smoothstep(0.85, 1.0, sin(vUv.x * 30.0 - uTime * 12.0));
          float core = smoothstep(0.35, 0.9, edge);
          vec3 col = mix(vec3(0.05, 0.04, 0.06), uColor * 2.2, pulse * 0.9 + 0.1);
          float a = smoothstep(0.0, 0.3, edge) * fade;
          gl_FragColor = vec4(col * (0.4 + core * 0.6) * a, a);
        }`,
      transparent: true,
      depthWrite: false,
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
    for (let i = 0; i < this.cableLen; i++) this.cablePts.push(new THREE.Vector3(x, 0.3, z));
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
    this.body.position.y = 1.5 + Math.sin(time * 3) * 0.08 + kick * 0.12;
    this.body.rotation.set(0, facing, 0);
    // lean into movement; the dash stretches the whole mic
    this.mic.rotation.x = 0.78 + tilt * 0.25 + (dashing ? 0.3 : 0);
    this.mic.rotation.z = Math.sin(time * 2.1) * 0.05;
    this.grille.rotation.y += dt * 0.4;
    const s = 0.95 * (1 + kick * 0.07);
    this.body.scale.set(s * (dashing ? 0.9 : 1), s, s * (dashing ? 1.25 : 1));

    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 4);
    const flicker = invuln ? (Math.sin(time * 50) > 0 ? 1 : 0.35) : 1;
    this.coreMat.emissive.copy(this.coreColor).lerp(new THREE.Color(1, 0.1, 0.15), this.hurtFlash);
    this.coreMat.emissiveIntensity = (0.75 + kick * 1.4 + spectrum[2]! * 0.9) * flicker;
    this.light.color.copy(this.coreMat.emissive);
    this.light.intensity = (26 + kick * 30) * flicker;
    this.poolMat.color.setHex(0xff2d78);

    for (let i = 0; i < this.bars; i++) {
      const a = (i / this.bars) * Math.PI * 2 + time * 0.25;
      const band = spectrum[Math.floor(Math.abs((i / this.bars) * 2 - 1) * 0.999 * spectrum.length)] ?? 0;
      const h = 0.06 + band * band * 2.2 + kick * 0.15;
      this.m4.makeRotationY(-a);
      this.m4.scale(new THREE.Vector3(1, h, 1));
      this.m4.setPosition(Math.cos(a) * 1.7, 0.02, Math.sin(a) * 1.7);
      this.halo.setMatrixAt(i, this.m4);
    }
    this.halo.instanceMatrix.needsUpdate = true;

    // approach ring: faint while travelling, bright as it lands on the beat
    this.beatRing.scale.setScalar(1.7 + (1 - beatPhase) * 2.6);
    this.locatorMat.opacity = 0.28 + kick * 0.4;
    this.beatRingMat.opacity = 0.04 + Math.pow(beatPhase, 3) * 0.3 + kick * 0.55;
    this.beatRingMat.color.copy(this.coreColor);

    this.glowPool.scale.setScalar(1 + kick * 0.12);

    // cable plugs into the handle, trailing behind
    this.tail.set(x - Math.sin(facing) * 2.4, 0.5, z - Math.cos(facing) * 2.4);
    if (this.cablePts.length === 0) this.resetCable(x, z);
    this.cablePts[0]!.copy(this.tail);
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
      p.y = 0.1 + 0.4 * Math.pow(1 - i / this.cablePts.length, 3);
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
      const w = 0.16 * (1 - (i / this.cablePts.length) * 0.5);
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
