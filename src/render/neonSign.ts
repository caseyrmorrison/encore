import * as THREE from 'three';
import { buildRecord } from './instrumentModels';
import { M } from './materials';

/**
 * Hand-bent neon: every letter is a set of strokes swept into glass tubes, mounted on a
 * dark backing board. Letters flicker on one by one like a real sign warming up.
 */
type Stroke = [number, number][];

function arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n = 24): Stroke {
  const pts: Stroke = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return pts;
}

const D = Math.PI / 180;

const LETTERS: Record<string, { w: number; strokes: Stroke[] }> = {
  E: {
    w: 1,
    strokes: [
      [
        [0.92, 1.4],
        [0.12, 1.4],
        [0.12, 0],
        [0.92, 0],
      ],
      [
        [0.12, 0.72],
        [0.74, 0.72],
      ],
    ],
  },
  N: {
    w: 1.08,
    strokes: [
      [
        [0.12, 0],
        [0.12, 1.4],
        [0.96, 0],
        [0.96, 1.4],
      ],
    ],
  },
  C: { w: 1.05, strokes: [arc(0.6, 0.7, 0.5, 0.7, 48 * D, 312 * D, 40)] },
  O: { w: 1.25, strokes: [arc(0.62, 0.7, 0.54, 0.7, 0, Math.PI * 2, 48)] },
  R: {
    w: 1.02,
    strokes: [
      [[0.12, 0], [0.12, 1.4], [0.55, 1.4], ...arc(0.55, 1.06, 0.36, 0.34, 90 * D, -90 * D, 16).slice(1), [0.12, 0.72]],
      [
        [0.46, 0.72],
        [0.96, 0],
      ],
    ],
  },
};

export class NeonSign {
  readonly group = new THREE.Group();
  private readonly letters: { mats: THREE.MeshBasicMaterial[]; on: number; target: number; base: THREE.Color }[] = [];
  private readonly record: THREE.Group;
  private readonly glowPlate: THREE.Mesh;
  private t = 0;
  lit = false;

  constructor(text = 'ENCORE', colors = [0xff2d78, 0xff2d78, 0xff2d78, 0x3dd9ff, 0xff2d78, 0xff2d78]) {
    const tubeR = 0.065;
    let x = 0;
    const spacing = 0.28;
    const widths = [...text].map((c) => LETTERS[c]?.w ?? 1);
    const total = widths.reduce((a, b) => a + b, 0) + spacing * (text.length - 1);
    x = -total / 2;
    [...text].forEach((ch, i) => {
      const L = LETTERS[ch];
      if (!L) return;
      const base = new THREE.Color(colors[i % colors.length]!);
      const coreMat = new THREE.MeshBasicMaterial({ color: base.clone().multiplyScalar(0.08), toneMapped: false });
      const haloMat = new THREE.MeshBasicMaterial({
        color: base.clone().multiplyScalar(0.02),
        transparent: true,
        opacity: 0.22,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      for (const s of L.strokes) {
        const pts = s.map(([px, py]) => new THREE.Vector3(x + px, py, 0));
        const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.02);
        const segs = Math.max(24, pts.length * 6);
        const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, segs, tubeR, 10, false), coreMat);
        this.group.add(tube);
        const halo = new THREE.Mesh(new THREE.TubeGeometry(curve, segs, tubeR * 2.4, 8, false), haloMat);
        this.group.add(halo);
        // glass end caps / electrodes
        for (const end of [pts[0]!, pts[pts.length - 1]!]) {
          const cap = new THREE.Mesh(new THREE.CylinderGeometry(tubeR * 1.2, tubeR * 1.2, 0.16, 10), M.darkChrome());
          cap.position.copy(end).add(new THREE.Vector3(0, 0, -0.08));
          cap.rotation.x = Math.PI / 2;
          this.group.add(cap);
        }
      }
      // the O hides a spinning record
      if (ch === 'O') {
        const rec = buildRecord(0x3dd9ff);
        rec.rotation.x = Math.PI / 2;
        rec.scale.setScalar(0.46);
        rec.position.set(x + 0.62, 0.7, -0.05);
        this.group.add(rec);
      }
      this.letters.push({ mats: [coreMat, haloMat], on: 0, target: 0, base });
      x += L.w + spacing;
    });
    this.record = this.group.children.find((c) => c instanceof THREE.Group) as THREE.Group;

    // backing board + standoffs + glow wash on the wall
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(total + 1.2, 2.3, 0.08),
      new THREE.MeshStandardMaterial({ color: 0x0b0a10, roughness: 0.4, metalness: 0.3 }),
    );
    board.position.set(0, 0.7, -0.22);
    this.group.add(board);
    const washTex = (() => {
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 128;
      const g = c.getContext('2d')!;
      const grd = g.createRadialGradient(128, 64, 4, 128, 64, 128);
      grd.addColorStop(0, 'rgba(255,255,255,0.9)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, 256, 128);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    this.glowPlate = new THREE.Mesh(
      new THREE.PlaneGeometry(total + 5, 5),
      new THREE.MeshBasicMaterial({
        map: washTex,
        color: 0xff2d78,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.glowPlate.position.set(0, 0.7, -0.3);
    this.group.add(this.glowPlate);
  }

  /** Flicker the letters on, one at a time. */
  ignite(): void {
    this.lit = true;
    this.letters.forEach((l, i) => (l.target = 1 + i * 0.001));
    this.t = 0;
  }

  update(dt: number, beatPulse: number): void {
    this.t += dt;
    let sum = 0;
    this.letters.forEach((l, i) => {
      const start = i * 0.16;
      let v = 0;
      if (this.lit && this.t > start) {
        const k = this.t - start;
        // warm-up stutter, then steady with a faint mains hum
        v = k < 0.35 ? (Math.sin(k * 90 + i) > 0.2 ? 1 : 0.15) : 1;
        if (Math.random() < 0.002) v = 0.4;
      }
      l.on += (v - l.on) * Math.min(1, dt * 30);
      const pulse = 1 + beatPulse * 0.35;
      const [core, halo] = l.mats;
      // hot saturated tube with just a hint of white at the core; halo carries the colour
      core!.color.copy(l.base).multiplyScalar(0.06 + l.on * 2.6 * pulse);
      core!.color.r += l.on * 0.35;
      core!.color.g += l.on * 0.35;
      core!.color.b += l.on * 0.35;
      halo!.color.copy(l.base).multiplyScalar(0.02 + l.on * 1.6 * pulse);
      sum += l.on;
    });
    (this.glowPlate.material as THREE.MeshBasicMaterial).opacity = (sum / this.letters.length) * 0.55 * (1 + beatPulse * 0.3);
    if (this.record) this.record.rotation.y += dt * 3.5;
  }
}
