import * as THREE from 'three';
import type { Rng } from '../../core/rng';
import { buildInstrument } from '../instrumentModels';
import { canvasTexture, M } from '../materials';
import {
  beamGeometry,
  GLSL_COMMON,
  makeBeamMaterial,
  RippleBank,
  type Bounds,
  type FrameInfo,
  type Venue,
  type VenuePalette,
} from './venue';

const HX = 30;
const HZ = 20;

const FLOOR_FRAG = /* glsl */ `
${GLSL_COMMON}
uniform float uBeat;
uniform float uBar;
uniform float uEnergy;
uniform float uDrop;
uniform float uBuild;
uniform vec2 uPlayer;
uniform vec2 uHalf;
uniform vec3 uCols[4];
uniform vec4 uSpots[6];
uniform vec3 uSpotCols[6];
uniform vec2 uBall;
uniform float uStep;
uniform float uSnare;
uniform float uHat;
varying vec3 vWorld;

vec3 pick(float i) {
  int ci = int(mod(i, 4.0));
  if (ci == 1) return uCols[1];
  if (ci == 2) return uCols[2];
  if (ci == 3) return uCols[3];
  return uCols[0];
}

void main() {
  vec2 w = vWorld.xz;
  float tile = 2.0;
  vec2 cell = floor(w / tile);
  vec2 f = fract(w / tile) - 0.5;
  float inside = step(abs(w.x), uHalf.x) * step(abs(w.y), uHalf.y);
  float edgeDist = max(abs(f.x), abs(f.y));
  float grout = smoothstep(0.492, 0.46, edgeDist);
  float h = hash21(cell);
  float beatPulse = pow(1.0 - uBeat, 3.0);
  float bar = floor(uBar);
  float beatIdx = floor(uBar * 4.0);
  float mode = mod(floor(bar / 2.0), 4.0);
  vec2 cc = cell * tile + tile * 0.5;

  // which tiles are lit — sparse, so the light means something
  float lit = 0.0;
  float density = 0.18 + uEnergy * 0.3;
  if (mode < 0.5) {
    // checker that flips every beat, only a band of it
    lit = mod(cell.x + cell.y + beatIdx, 2.0) * step(h, density * 1.4) * beatPulse;
  } else if (mode < 1.5) {
    float d = length(cc - uPlayer);
    lit = smoothstep(0.82, 1.0, sin(d * 0.36 - uTime * 5.0)) * (0.35 + 0.65 * beatPulse);
  } else if (mode < 2.5) {
    lit = smoothstep(0.9, 1.0, sin((cell.x - cell.y) * 0.42 - uTime * 3.2)) * (0.45 + 0.55 * beatPulse);
  } else {
    lit = step(1.0 - density, hash21(cell + beatIdx * 1.7)) * (0.3 + 0.7 * beatPulse);
  }
  // DROP: rings of light race outward from the performer, strobing on every 16th
  float dd = length(cc - uPlayer);
  float wave = smoothstep(0.55, 1.0, sin(dd * 0.55 - uTime * 16.0));
  float strobe = step(0.5, fract(uBar * 16.0)) * 0.6 + 0.4;
  lit = max(lit, uDrop * wave * strobe);
  // idle patterns sit back; the music drives the light
  lit *= mix(0.42, 0.72, uDrop);
  vec3 tc = pick(h * 4.0 + bar + floor(cell.x * 0.25));

  // THE FLOOR IS THE SEQUENCER: the playhead sweeps a column of tiles across the room
  float colIdx = floor((cc.x + uHalf.x) / (uHalf.x * 2.0) * 16.0);
  float head = floor(uStep);
  // one tile wide: the tile column at the centre of the playhead's band
  float bandCentre = (floor(uStep) + 0.5) / 16.0 * uHalf.x * 2.0 - uHalf.x;
  float ph = step(abs(cc.x - bandCentre), 1.01) * (1.0 - fract(uStep) * 0.5);
  float sweep = ph * 0.5;
  // snares/claps flash the performer's row, hats sparkle
  // the flash races outward along the row as it fades
  float along = abs(cc.x - uPlayer.x);
  float reach = (1.0 - uSnare) * 26.0 + 4.0;
  float rowHit = step(abs(cc.y - uPlayer.y), 1.5) * smoothstep(reach, reach - 6.0, along) * uSnare * 0.75;
  float sparkle = step(0.93, hash21(cell + floor(uTime * 16.0))) * uHat;
  vec3 seqCol = uCols[0] * sweep + uCols[1] * rowHit * 0.9 + uCols[3] * sparkle * 0.9;
  lit = max(lit, max(sweep, max(rowHit * 0.9, sparkle * 0.9)));

  // frosted glass lit from beneath: hot centre, soft falloff, bright rim when lit
  float inner = clamp(1.0 - length(f) * 1.5, 0.0, 1.0);
  vec3 col = vec3(0.008, 0.006, 0.012);
  vec3 lightCol = mix(tc, seqCol / max(0.001, max(max(seqCol.r, seqCol.g), seqCol.b)), step(0.01, length(seqCol)) * 0.85);
  // in combat the floor sits back (dimmer, less saturated) so shots stay readable; the DROP lets it loose
  float grey = dot(lightCol, vec3(0.3, 0.55, 0.15));
  lightCol = mix(mix(vec3(grey), lightCol, 0.7), lightCol, uDrop);
  float floorGain = mix(0.55, 1.0, uDrop);
  col += lightCol * lit * floorGain * (0.2 + inner * inner * 2.4 + smoothstep(0.38, 0.47, edgeDist) * 0.8) * 1.4;
  // unlit glass still catches a whisper of colour + fine scratches
  col += tc * 0.012 * (0.4 + inner);
  col += vec3(0.006) * smoothstep(0.7, 0.74, fbm(w * 3.0 + h * 10.0));

  // mirror-ball specks sweeping the floor
  vec2 q = w - uBall;
  float ang = uTime * 0.12;
  q = mat2(cos(ang), -sin(ang), sin(ang), cos(ang)) * q;
  vec2 g = q * 0.32;
  float speck = smoothstep(0.24, 0.02, length(fract(g) - 0.5)) * step(0.72, hash21(floor(g)));
  vec3 speckTint = mix(vec3(1.0, 0.75, 0.9), vec3(0.7, 0.9, 1.0), hash21(floor(g) + 3.1));
  col += speckTint * speck * 0.16 * smoothstep(40.0, 8.0, length(q));

  // moving-head spots
  for (int i = 0; i < 6; i++) {
    float d = length(w - uSpots[i].xy);
    // real follow-spot pools: hard rim, soft interior
    float pool = smoothstep(uSpots[i].z, uSpots[i].z * 0.9, d);
    float rimEdge = smoothstep(uSpots[i].z * 0.8, uSpots[i].z * 0.97, d) * pool;
    col += uSpotCols[i] * (pool * 0.55 + rimEdge * 0.9) * uSpots[i].w;
  }
  col *= mix(0.12, 1.0, grout);

  // warm pool around the player keeps the hero readable
  float pd = length(w - uPlayer);
  col += vec3(1.0, 0.72, 0.45) * 0.09 * smoothstep(8.0, 0.0, pd);
  col += ripples(w);

  // outside the dance floor: dark worn concrete
  vec3 outside = vec3(0.022, 0.019, 0.021) * (0.5 + fbm(w * 0.35) * 0.9);
  float edge = min(uHalf.x - abs(w.x), uHalf.y - abs(w.y));
  col = mix(outside, col, inside * smoothstep(0.0, 0.4, edge));
  // hazard edge: amber LED strip around the floor
  float rim = smoothstep(0.35, 0.0, abs(edge + 0.15));
  col += vec3(1.0, 0.35, 0.12) * rim * (0.9 + 0.8 * beatPulse);
  col *= 1.0 - uBuild * 0.7;
  gl_FragColor = vec4(col, 1.0);
}`;

const FLOOR_VERT = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

/** Mirror ball: flat facets, each one flashing when it catches a light. */
const BALL_VERT = /* glsl */ `
varying vec3 vObj;
varying vec3 vWorld;
varying vec3 vNrm;
void main() {
  vObj = position;
  vNrm = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const BALL_FRAG = /* glsl */ `
uniform float uTime;
uniform float uBeat;
uniform vec3 uA;
uniform vec3 uB;
varying vec3 vObj;
varying vec3 vWorld;
varying vec3 vNrm;
float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
void main() {
  // quantised normal = flat mirror tiles, without screen-space derivatives
  vec3 n = normalize(floor(normalize(vNrm) * 9.0) + 0.5);
  vec3 v = normalize(cameraPosition - vWorld);
  vec3 cell = floor(normalize(vObj) * 14.0);
  float h = hash(cell);
  float ndv = max(dot(n, v), 0.0);
  vec3 base = mix(vec3(0.12, 0.12, 0.16), mix(uA, uB, h), 0.35) * (0.4 + ndv);
  float flash = step(0.9, fract(h * 7.3 + uTime * 0.9)) * (0.6 + uBeat * 1.4);
  vec3 col = base + vec3(1.0, 0.96, 0.9) * flash * 3.0;
  // grout between tiles
  vec3 f = fract(normalize(vObj) * 14.0);
  float grout = step(0.08, min(min(f.x, f.y), f.z));
  gl_FragColor = vec4(col * mix(0.25, 1.0, grout), 1.0);
}`;

function concreteTexture(tint: string, streaks = false): THREE.CanvasTexture {
  const t = canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = tint;
    g.fillRect(0, 0, w, h);
    const img = g.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 18;
      img.data[i] = Math.max(0, img.data[i]! + n);
      img.data[i + 1] = Math.max(0, img.data[i + 1]! + n);
      img.data[i + 2] = Math.max(0, img.data[i + 2]! + n);
    }
    g.putImageData(img, 0, 0);
    // soft mottling
    for (let i = 0; i < 60; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const r = 20 + Math.random() * 60;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, `rgba(0,0,0,${0.05 + Math.random() * 0.08})`);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    if (streaks) {
      for (let i = 0; i < 10; i++) {
        const x = Math.random() * w;
        const grd = g.createLinearGradient(x, 0, x, h);
        grd.addColorStop(0, 'rgba(0,0,0,0.18)');
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grd;
        g.fillRect(x, 0, 3 + Math.random() * 10, h * (0.2 + Math.random() * 0.4));
      }
    }
  });
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

function brickTexture(): THREE.CanvasTexture {
  const t = canvasTexture(1024, 512, (g, w, h) => {
    g.fillStyle = '#1a1214';
    g.fillRect(0, 0, w, h);
    const bw = 64;
    const bh = 26;
    for (let row = 0; row * bh < h; row++) {
      const off = row % 2 ? bw / 2 : 0;
      for (let x = -bw; x < w + bw; x += bw) {
        const r = 70 + Math.random() * 40;
        const gg = 30 + Math.random() * 18;
        const b = 30 + Math.random() * 16;
        const dark = Math.random() < 0.15 ? 0.6 : 1;
        g.fillStyle = `rgb(${r * dark},${gg * dark},${b * dark})`;
        g.fillRect(x + off + 2, row * bh + 2, bw - 4, bh - 4);
        // chipped edges / texture
        g.fillStyle = 'rgba(0,0,0,0.18)';
        g.fillRect(x + off + 2, row * bh + bh - 7, bw - 4, 5);
        g.fillStyle = 'rgba(255,255,255,0.05)';
        g.fillRect(x + off + 2, row * bh + 2, bw - 4, 3);
      }
    }
    // grime gradient from the floor up, soot from above
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, 'rgba(0,0,0,0.55)');
    grd.addColorStop(0.35, 'rgba(0,0,0,0.1)');
    grd.addColorStop(0.8, 'rgba(0,0,0,0.2)');
    grd.addColorStop(1, 'rgba(0,0,0,0.6)');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
  });
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  return t;
}

function neonSign(text: string, color: string, w = 1024, h = 256, font = 150): THREE.CanvasTexture {
  return canvasTexture(w, h, (g) => {
    g.clearRect(0, 0, w, h);
    g.font = `${font}px Bungee, Impact, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    g.shadowColor = color;
    for (const blur of [60, 30, 12]) {
      g.shadowBlur = blur;
      g.strokeStyle = color;
      g.lineWidth = 10;
      g.strokeText(text, w / 2, h / 2);
    }
    g.shadowBlur = 0;
    g.strokeStyle = '#ffffff';
    g.lineWidth = 4;
    g.strokeText(text, w / 2, h / 2);
  });
}

function poster(title: string, sub: string, bg: string, fg: string): THREE.CanvasTexture {
  return canvasTexture(256, 360, (g, w, h) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.fillStyle = fg;
    g.globalAlpha = 0.22;
    for (let i = 0; i < 9; i++) {
      g.beginPath();
      g.arc(w / 2, h * 0.42, 20 + i * 14, 0, Math.PI * 2);
      g.lineWidth = 6;
      g.strokeStyle = fg;
      g.stroke();
    }
    g.globalAlpha = 1;
    g.font = '44px Bungee, Impact, sans-serif';
    g.textAlign = 'center';
    g.fillText(title, w / 2, h * 0.82);
    g.font = '18px "Space Grotesk", sans-serif';
    g.fillText(sub, w / 2, h * 0.92);
    g.fillStyle = 'rgba(255,255,230,0.55)';
    g.fillRect(w / 2 - 30, -6, 60, 22);
  });
}

export class Basement implements Venue {
  readonly id = 'basement' as const;
  readonly name = 'THE BASEMENT';
  readonly tagline = 'Night one. Forty people and a fog machine.';
  readonly bpm = 112;
  readonly progression = 'basement' as const;
  readonly bounds: Bounds = { kind: 'rect', hx: HX, hz: HZ };
  readonly palette: VenuePalette = {
    rim: new THREE.Color(0x8a3aa0),
    floor: new THREE.Color(0xff2d6a),
    accents: [0xff1f5a, 0xff8a1f, 0xd43dff, 0x2ec8ff],
    fog: 0x0e0508,
    fogDensity: 0.011,
    background: 0x050206,
    core: 0xffd9a0,
  };
  readonly group = new THREE.Group();
  readonly obstacles = [
    { x: -14, z: -7, r: 1.2 },
    { x: 14, z: -7, r: 1.2 },
    { x: -14, z: 9, r: 1.2 },
    { x: 14, z: 9, r: 1.2 },
  ];
  private readonly floorMat: THREE.ShaderMaterial;
  private readonly ballMat: THREE.ShaderMaterial;
  private readonly rip = new RippleBank();
  private readonly beams: { pivot: THREE.Object3D; mat: THREE.ShaderMaterial; phase: number; spot: number }[] = [];
  private readonly ballBeams: THREE.Object3D;
  private readonly ballBeamMats: THREE.ShaderMaterial[] = [];
  private readonly spots = Array.from({ length: 6 }, () => new THREE.Vector4());
  private readonly spotCols = Array.from({ length: 6 }, () => new THREE.Color());
  private readonly ball: THREE.Mesh;
  private readonly neonMats: THREE.MeshBasicMaterial[] = [];
  private readonly parLenses: THREE.MeshStandardMaterial[] = [];
  private readonly pillarMats: THREE.MeshPhysicalMaterial[] = [];
  private readonly capMats: THREE.MeshStandardMaterial[] = [];
  private strobe = 0;
  private readonly tmpV = new THREE.Vector3();
  readonly stageCenter = new THREE.Vector3(0, 1.2, -HZ - 3.5);

  constructor() {
    const acc = this.palette.accents.map((c) => new THREE.Color(c).multiplyScalar(1.15));
    this.floorMat = new THREE.ShaderMaterial({
      vertexShader: FLOOR_VERT,
      fragmentShader: FLOOR_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uBeat: { value: 0 },
        uBar: { value: 0 },
        uEnergy: { value: 0 },
        uDrop: { value: 0 },
        uBuild: { value: 0 },
        uPlayer: { value: new THREE.Vector2() },
        uHalf: { value: new THREE.Vector2(HX, HZ) },
        uCols: { value: acc },
        uSpots: { value: this.spots },
        uSpotCols: { value: this.spotCols },
        uBall: { value: new THREE.Vector2(-12, -19) },
        uStep: { value: 0 },
        uSnare: { value: 0 },
        uHat: { value: 0 },
        ...this.rip.uniforms(),
      },
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(HX * 2 + 40, HZ * 2 + 40), this.floorMat);
    floor.rotation.x = -Math.PI / 2;
    this.group.add(floor);

    this.buildRoom();
    this.buildStage();

    // mirror ball with a crown of rotating light beams
    this.ballMat = new THREE.ShaderMaterial({
      vertexShader: BALL_VERT,
      fragmentShader: BALL_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uBeat: { value: 0 },
        uA: { value: new THREE.Color(0xff5ab0) },
        uB: { value: new THREE.Color(0x5ad0ff) },
      },
    });
    this.ball = new THREE.Mesh(new THREE.IcosahedronGeometry(1.5, 4), this.ballMat);
    this.ball.position.set(-12, 12.5, -19);
    this.group.add(this.ball);
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 8, 6), M.darkChrome());
    chain.position.set(-12, 17.5, -19);
    this.group.add(chain);
    this.ballBeams = new THREE.Object3D();
    this.ballBeams.position.copy(this.ball.position);
    const thin = beamGeometry(0.035);
    for (let i = 0; i < 14; i++) {
      const mat = makeBeamMaterial(i % 3 === 0 ? 0xffc0e8 : 0xffffff, 0.22);
      this.ballBeamMats.push(mat);
      const b = new THREE.Mesh(thin, mat);
      b.scale.set(1, 22, 1);
      const holder = new THREE.Object3D();
      holder.rotation.set(Math.PI * 0.35 + (i % 4) * 0.18, (i / 14) * Math.PI * 2, 0, 'YXZ');
      holder.add(b);
      this.ballBeams.add(holder);
    }
    this.group.add(this.ballBeams);

    // moving heads on the ceiling truss
    const beamGeo = beamGeometry(0.2);
    const positions: [number, number][] = [
      [-22, -18],
      [-8, -19],
      [8, -19],
      [22, -18],
      [-26, 4],
      [26, 4],
    ];
    positions.forEach(([x, z], i) => {
      const pivot = new THREE.Object3D();
      pivot.position.set(x, 16, z);
      const mat = makeBeamMaterial(this.palette.accents[i % 4]!, 0.3);
      const cone = new THREE.Mesh(beamGeo, mat);
      cone.scale.set(1, 26, 1);
      pivot.add(cone);
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 0.8, 16), M.blackPlastic());
      pivot.add(lamp);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.38, 16), M.glow(this.palette.accents[i % 4]!, 4));
      lens.rotation.x = Math.PI / 2;
      lens.position.y = -0.41;
      pivot.add(lens);
      this.group.add(pivot);
      this.beams.push({ pivot, mat, phase: i * 1.37, spot: i });
    });

    // obstacle pillars: round concrete columns with steel collars and neon rings
    const pillarTex = concreteTexture('#6b6668');
    pillarTex.repeat.set(2, 3);
    void pillarTex;
    this.obstacles.forEach((o, i) => {
      // glossy black lacquer: reflects the room's colour instead of reading as cork
      const pillarMat = new THREE.MeshPhysicalMaterial({
        color: 0x0c0a10,
        roughness: 0.18,
        metalness: 0.2,
        clearcoat: 1,
        clearcoatRoughness: 0.05,
        transparent: true,
      });
      this.pillarMats.push(pillarMat);
      const p = new THREE.Mesh(new THREE.CylinderGeometry(o.r, o.r * 1.06, 6.5, 28), pillarMat);
      p.position.set(o.x, 3.25, o.z);
      this.group.add(p);
      const neonMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(this.palette.accents[i % 4]!).multiplyScalar(2) });
      this.neonMats.push(neonMat);
      for (const y of [1.0, 1.35]) {
        const ring = new THREE.Mesh(new THREE.TorusGeometry(o.r * 1.04, 0.05, 8, 40), neonMat);
        ring.rotation.x = Math.PI / 2;
        ring.position.set(o.x, y, o.z);
        this.group.add(ring);
      }
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
        const strip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 5.2, 0.07), neonMat);
        strip.position.set(o.x + Math.cos(a) * o.r * 1.01, 3.4, o.z + Math.sin(a) * o.r * 1.01);
        this.group.add(strip);
      }
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(o.r * 1.12, o.r * 1.12, 0.35, 28), M.darkChrome());
      collar.position.set(o.x, 0.18, o.z);
      this.group.add(collar);
      // the top is what the camera sees most: a matte capital (gloss reads as a grey disc from
      // above) with a neon lip and an uplighter can so it looks rigged, not unfinished
      const capMat = new THREE.MeshStandardMaterial({ color: 0x16131c, roughness: 0.9, metalness: 0, transparent: true });
      this.capMats.push(capMat);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(o.r * 1.3, o.r * 1.05, 0.6, 28), capMat);
      cap.position.set(o.x, 6.7, o.z);
      this.group.add(cap);
      const lip = new THREE.Mesh(new THREE.TorusGeometry(o.r * 1.3, 0.06, 8, 44), neonMat);
      lip.rotation.x = Math.PI / 2;
      lip.position.set(o.x, 7.0, o.z);
      this.group.add(lip);
      const inner = new THREE.Mesh(new THREE.TorusGeometry(o.r * 0.9, 0.035, 6, 40), neonMat);
      inner.rotation.x = Math.PI / 2;
      inner.position.set(o.x, 7.01, o.z);
      this.group.add(inner);
      const can = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.3, 0.5, 18), capMat);
      can.position.set(o.x, 7.25, o.z);
      this.group.add(can);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.27, 18), M.glow(0xfff0d0, 3));
      lens.rotation.x = -Math.PI / 2;
      lens.position.set(o.x, 7.51, o.z);
      this.group.add(lens);
    });

    // haze near the floor
    const hazeMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(0xff5a7a) } },
      vertexShader: FLOOR_VERT,
      fragmentShader: /* glsl */ `
        ${GLSL_COMMON.replace(/uniform vec4 uRipples[\s\S]*$/, '')}
        uniform float uTime; uniform vec3 uColor; varying vec3 vWorld;
        void main() {
          vec2 w = vWorld.xz * 0.06 + vec2(uTime * 0.02, uTime * 0.012);
          float n = fbm(w + fbm(w * 2.0 + uTime * 0.03));
          float a = smoothstep(0.45, 0.9, n) * 0.07;
          gl_FragColor = vec4(uColor * a, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.hazeMat = hazeMat;
    const haze = new THREE.Mesh(new THREE.PlaneGeometry(HX * 2 + 20, HZ * 2 + 20), hazeMat);
    haze.rotation.x = -Math.PI / 2;
    haze.position.y = 0.6;
    haze.renderOrder = 4;
    this.group.add(haze);

    // lights for the lit (Standard) props
    const hemi = new THREE.HemisphereLight(0xff9a8a, 0x1a0710, 0.8);
    this.group.add(hemi);
    const key = new THREE.DirectionalLight(0xffd0b0, 1.1);
    key.position.set(6, 20, 12);
    this.group.add(key);
    const stageLight = new THREE.PointLight(0xff4a6a, 90, 30, 1.6);
    stageLight.position.set(0, 7, -21);
    this.group.add(stageLight);
    const wash = new THREE.SpotLight(0xffe0c0, 400, 40, 0.5, 0.6, 1.2);
    wash.position.set(0, 16, -12);
    wash.target.position.set(0, 1, -HZ - 4);
    this.group.add(wash, wash.target);
  }

  private readonly hazeMat: THREE.ShaderMaterial;

  private buildRoom(): void {
    const brick = brickTexture();
    brick.repeat.set(4, 1.5);
    const wallMat = new THREE.MeshStandardMaterial({ map: brick, roughness: 0.92, color: 0xffffff });
    const back = new THREE.Mesh(new THREE.BoxGeometry(HX * 2 + 16, 22, 1), wallMat);
    back.position.set(0, 11, -HZ - 8.5);
    this.group.add(back);
    const sideTex = brickTexture();
    sideTex.repeat.set(3, 1.2);
    const sideMat = new THREE.MeshStandardMaterial({ map: sideTex, roughness: 0.92, color: 0xcfc4c6 });
    for (const s of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(1, 14, HZ * 2 + 18), sideMat);
      side.position.set(s * (HX + 6), 7, -2);
      this.group.add(side);
    }
    // pipes & conduit along the back wall
    for (const [y, r, c] of [
      [18.5, 0.45, 0x5a5f66],
      [17.3, 0.22, 0x8a6a3a],
      [16.6, 0.16, 0x3a3f46],
    ] as const) {
      const pipe = new THREE.Mesh(
        new THREE.CylinderGeometry(r, r, HX * 2 + 14, 16),
        new THREE.MeshStandardMaterial({ color: c, metalness: 0.8, roughness: 0.4 }),
      );
      pipe.rotation.z = Math.PI / 2;
      pipe.position.set(0, y, -HZ - 7.6);
      this.group.add(pipe);
    }
    for (let i = -3; i <= 3; i++) {
      const clamp = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.4, 0.4), M.darkChrome());
      clamp.position.set(i * 9, 17.8, -HZ - 7.6);
      this.group.add(clamp);
    }
    // low front rail (south) so the camera can see in
    const rail = new THREE.Mesh(new THREE.BoxGeometry(HX * 2 + 12, 0.9, 0.5), M.darkChrome());
    rail.position.set(0, 0.45, HZ + 3.5);
    this.group.add(rail);

    const posters: [string, string, string, string][] = [
      ['THE HUSH', 'SOLD OUT — NO REFUNDS', '#1b0f2e', '#ff3df0'],
      ['LOUD!', 'EVERY FRIDAY — B2', '#2e1010', '#ffb13d'],
      ['808 NIGHT', 'KICK DRUMS ONLY', '#0f1d2e', '#3dd9ff'],
      ['NO SILENCE', 'LIVE TIL LATE', '#10261a', '#8cff5a'],
      ['ENCORE', 'ONE NIGHT ONLY', '#2e0f1d', '#ff2d55'],
    ];
    posters.forEach((p, i) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(2.6, 3.6),
        new THREE.MeshStandardMaterial({ map: poster(...p), roughness: 0.8 }),
      );
      const side = i % 2 === 0 ? -1 : 1;
      m.position.set(side * (HX + 5.45), 4.5, -14 + i * 6.5);
      m.rotation.y = (-side * Math.PI) / 2;
      m.rotation.z = (Math.random() - 0.5) * 0.08;
      this.group.add(m);
    });
    // posters on the back wall flanking the stage
    [-24, -17, 17, 24].forEach((x, i) => {
      const p = posters[(i + 1) % posters.length]!;
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(3, 4.2),
        new THREE.MeshStandardMaterial({ map: poster(...p), roughness: 0.8 }),
      );
      m.position.set(x, 5, -HZ - 7.95);
      m.rotation.z = (Math.random() - 0.5) * 0.1;
      this.group.add(m);
    });

    const exitTex = neonSign('EXIT', '#ff2020', 256, 96, 60);
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x2a2226, roughness: 0.6, metalness: 0.4 });
    for (const s of [-1, 1]) {
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.4, 5, 4), doorMat);
      door.position.set(s * (HX + 5.4), 2.5, 10);
      this.group.add(door);
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(2, 0.75),
        new THREE.MeshBasicMaterial({ map: exitTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      sign.position.set(s * (HX + 5.2), 5.8, 10);
      sign.rotation.y = (-s * Math.PI) / 2;
      this.group.add(sign);
    }

    // venue name: neon on the right wall, angled toward the room
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(12, 3),
      new THREE.MeshBasicMaterial({
        map: neonSign('THE BASEMENT', '#ff8a1f'),
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    sign.position.set(HX + 5.4, 9.5, -8);
    sign.rotation.y = -Math.PI / 2;
    this.group.add(sign);
    this.neonMats.push(sign.material as THREE.MeshBasicMaterial);
  }

  private buildStage(): void {
    const stageMat = new THREE.MeshStandardMaterial({ color: 0x141014, roughness: 0.6 });
    const stage = new THREE.Mesh(new THREE.BoxGeometry(28, 1.2, 7), stageMat);
    stage.position.set(0, 0.6, -HZ - 4.5);
    this.group.add(stage);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(28, 0.1, 0.1), M.glow(0xff2d55, 3));
    lip.position.set(0, 1.22, -HZ - 1.0);
    this.group.add(lip);
    // par cans along the stage lip
    for (let i = 0; i < 9; i++) {
      const x = -12 + i * 3;
      const can = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.6, 14), M.blackPlastic());
      can.position.set(x, 1.5, -HZ - 1.3);
      can.rotation.x = -0.9;
      this.group.add(can);
      const lensMat = new THREE.MeshStandardMaterial({
        color: 0,
        emissive: this.palette.accents[i % 4]!,
        emissiveIntensity: 2,
      });
      this.parLenses.push(lensMat);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.26, 14), lensMat);
      lens.position.set(x, 1.72, -HZ - 1.02);
      lens.rotation.x = -Math.PI / 2 + 0.66;
      this.group.add(lens);
    }

    // amp stacks
    const ampMat = new THREE.MeshStandardMaterial({ color: 0x141214, roughness: 0.55 });
    const grill = new THREE.MeshStandardMaterial({ color: 0x2b2427, roughness: 0.95 });
    for (const s of [-1, 1]) {
      for (let k = 0; k < 2; k++) {
        const cab = new THREE.Mesh(new THREE.BoxGeometry(3, 2.6, 1.6), ampMat);
        cab.position.set(s * 10.5, 2.5 + k * 2.65, -HZ - 6);
        this.group.add(cab);
        const front = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.2), grill);
        front.position.set(s * 10.5, 2.5 + k * 2.65, -HZ - 5.19);
        this.group.add(front);
        for (let c = 0; c < 4; c++) {
          const cone = new THREE.Mesh(new THREE.CircleGeometry(0.45, 20), M.rubber());
          cone.position.set(s * 10.5 + (c % 2 ? 0.62 : -0.62), 2.5 + k * 2.65 + (c < 2 ? 0.55 : -0.55), -HZ - 5.17);
          this.group.add(cone);
          const dust = new THREE.Mesh(new THREE.CircleGeometry(0.14, 14), M.darkChrome());
          dust.position.copy(cone.position).add(new THREE.Vector3(0, 0, 0.01));
          this.group.add(dust);
        }
      }
      const head = new THREE.Mesh(new THREE.BoxGeometry(3, 1, 1.5), ampMat);
      head.position.set(s * 10.5, 8.1, -HZ - 6);
      this.group.add(head);
      const plate = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.25, 0.05), M.gold());
      plate.position.set(s * 10.5, 8.3, -HZ - 5.24);
      this.group.add(plate);
      const pilot = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), M.glow(0xff2020, 5));
      pilot.position.set(s * 10.5 + 1.1, 7.9, -HZ - 5.22);
      this.group.add(pilot);
    }

    // the house drum kit, silent until you arrive
    const kit: [Parameters<typeof buildInstrument>[0], number, number, number, number][] = [
      ['kick', 5.2, 2.3, -HZ - 6, 1.1],
      ['snare', 3.2, 2.3, -HZ - 5.2, 0.8],
      ['hat', 1.9, 3.2, -HZ - 5.6, 0.8],
      ['crash', 7.8, 4.2, -HZ - 6.2, 0.9],
      ['tom', 6.6, 3.1, -HZ - 5.4, 0.65],
    ];
    for (const [id, x, y, z, s] of kit) {
      const m = buildInstrument(id);
      m.position.set(x, y, z);
      m.scale.multiplyScalar(s);
      this.group.add(m);
    }
    // mic stand, front and centre
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 3.2, 8), M.chrome());
    stand.position.set(0, 2.8, -HZ - 2.4);
    this.group.add(stand);
    const standBase = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.6, 0.12, 20), M.blackPlastic());
    standBase.position.set(0, 1.26, -HZ - 2.4);
    this.group.add(standBase);

    // follow-spot on the frontman
    const spotMat = makeBeamMaterial(0xffe6c8, 0.28);
    this.spotMat = spotMat;
    const spot = new THREE.Mesh(beamGeometry(0.28), spotMat);
    spot.scale.set(4.2, 17, 4.2);
    const spotPivot = new THREE.Object3D();
    spotPivot.position.set(0, 18, -HZ - 1);
    spotPivot.lookAt(0, 1.2, -HZ - 2.4);
    spotPivot.rotateX(-Math.PI / 2);
    spotPivot.add(spot);
    this.group.add(spotPivot);

    // spray-painted tags, once each
    const tag = (text: string, color: string, x: number, y: number, size: number, rot: number): void => {
      const tex = canvasTexture(1024, 256, (g, w, h) => {
        g.clearRect(0, 0, w, h);
        g.font = `${size}px Bungee, Impact, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillStyle = color;
        g.globalAlpha = 0.75;
        g.fillText(text, w / 2, h / 2);
        // overspray speckle
        for (let i = 0; i < 900; i++) {
          g.globalAlpha = Math.random() * 0.25;
          g.fillRect(w / 2 + (Math.random() - 0.5) * w * 0.8, h / 2 + (Math.random() - 0.5) * h * 0.7, 2, 2);
        }
      });
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(10, 2.5),
        new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.9, depthWrite: false }),
      );
      m.position.set(x, y, -HZ - 7.97);
      m.rotation.z = rot;
      this.group.add(m);
    };
    tag('NO SILENCE', '#ff2d78', -21, 12.4, 150, 0.06);
    tag('HUSH GO HOME', '#2ec8ff', 21, 8.2, 120, -0.05);
    // tagline stencilled under the sign
    const line = canvasTexture(2048, 128, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.font = '600 64px "Space Grotesk", sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#ffe9f0';
      g.shadowColor = '#ff2d78';
      g.shadowBlur = 24;
      g.fillText('A  RHYTHM  ROGUELITE  —  YOUR  WEAPONS  ARE  A  DRUM  MACHINE', w / 2, h / 2);
    });
    const tagline = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 1.25),
      new THREE.MeshBasicMaterial({ map: line, transparent: true, depthWrite: false, toneMapped: false }),
    );
    tagline.position.set(0, 9.4, -HZ - 7.9);
    this.group.add(tagline);
    this.taglineMesh = tagline;
  }

  private spotMat!: THREE.ShaderMaterial;
  taglineMesh!: THREE.Mesh;

  ripple(x: number, z: number, color: THREE.Color | number, strength = 1): void {
    this.rip.add(x, z, this.floorMat.uniforms.uTime!.value as number, color, strength);
  }

  onStep(step: number, _bar: number): void {
    if (step % 4 === 0) this.strobe = 1;
  }

  update(f: FrameInfo): void {
    const u = this.floorMat.uniforms;
    u.uTime!.value = f.time;
    u.uBeat!.value = f.beatPhase;
    u.uEnergy!.value = f.energy;
    u.uDrop!.value = f.drop ? 1 : 0;
    u.uBuild!.value = f.build;
    (u.uPlayer!.value as THREE.Vector2).set(f.playerX, f.playerZ);
    this.strobe *= Math.exp(-f.dt * 9);
    u.uSnare!.value = (u.uSnare!.value as number) * Math.exp(-f.dt * 7);
    u.uHat!.value = (u.uHat!.value as number) * Math.exp(-f.dt * 10);
    const beat = Math.pow(1 - f.beatPhase, 3);
    this.hazeMat.uniforms.uTime!.value = f.time;

    this.ball.rotation.y += f.dt * 0.5;
    this.ballMat.uniforms.uTime!.value = f.time;
    this.ballMat.uniforms.uBeat!.value = beat;
    this.ballBeams.rotation.y += f.dt * 0.5;
    for (const m of this.ballBeamMats) {
      m.uniforms.uTime!.value = f.time;
      m.uniforms.uOpacity!.value = 0.08 + beat * 0.12 + (f.drop ? 0.15 : 0);
    }

    this.beams.forEach((b, i) => {
      const sweep = f.drop ? 2.4 : 0.7;
      const t = f.time * sweep + b.phase;
      const rx = Math.sin(t) * 0.5 + (f.drop ? Math.sin(f.time * 9 + i) * 0.2 : 0);
      const rz = Math.cos(t * 0.8) * 0.45;
      b.pivot.rotation.set(rx, 0, rz);
      b.mat.uniforms.uTime!.value = f.time;
      b.mat.uniforms.uOpacity!.value = 0.1 + f.energy * 0.14 + this.strobe * 0.06 + (f.drop ? 0.18 : 0);
      this.tmpV.set(0, -1, 0).applyEuler(b.pivot.rotation);
      const k = b.pivot.position.y / Math.max(0.2, -this.tmpV.y);
      const sx = b.pivot.position.x + this.tmpV.x * k;
      const sz = b.pivot.position.z + this.tmpV.z * k;
      this.spots[b.spot]!.set(sx, sz, 3.4, 0.07 + f.energy * 0.08 + (f.drop ? 0.12 : 0));
      this.spotCols[b.spot]!.copy(b.mat.uniforms.uColor!.value as THREE.Color);
    });

    this.spotMat.uniforms.uTime!.value = f.time;
    this.spotMat.uniforms.uOpacity!.value = 0.12 + beat * 0.06;
    this.parLenses.forEach((m, i) => (m.emissiveIntensity = 1 + beat * 3 * ((i + Math.floor(f.time * 2)) % 2 ? 1 : 0.4)));

    for (const m of this.neonMats) {
      const flick = Math.random() < 0.004 ? 0.3 : 1;
      m.opacity = flick;
    }
  }

  setBar(barFloat: number): void {
    this.floorMat.uniforms.uBar!.value = barFloat;
    this.floorMat.uniforms.uStep!.value = (barFloat - Math.floor(barFloat)) * 16;
  }

  occlude(px: number, pz: number): void {
    // a pillar hides the floor just "north" of it on screen; ghost it if the player is there
    this.obstacles.forEach((o, i) => {
      const hidden = Math.abs(px - o.x) < o.r + 1.8 && pz < o.z + 1 && pz > o.z - 6.5;
      const m = this.pillarMats[i]!;
      m.opacity += ((hidden ? 0.22 : 1) - m.opacity) * 0.15;
      m.depthWrite = m.opacity > 0.9;
      const c = this.capMats[i]!;
      c.opacity = m.opacity;
      c.depthWrite = m.depthWrite;
    });
  }

  onNote(inst: string, strength: number): void {
    const u = this.floorMat.uniforms;
    if (inst === 'snare' || inst === 'clap') u.uSnare!.value = Math.min(1, (u.uSnare!.value as number) + strength);
    else if (inst === 'hat' || inst === 'tom' || inst === 'cowbell' || inst === 'scratch')
      u.uHat!.value = Math.min(1, (u.uHat!.value as number) + strength * 0.8);
  }

  spawnPoint(rng: Rng, px: number, pz: number, out: { x: number; z: number }): void {
    for (let tries = 0; tries < 12; tries++) {
      const r = rng.next();
      if (r < 0.2) {
        const s = rng.chance(0.5) ? -1 : 1;
        out.x = s * (HX - 1);
        out.z = 10 + rng.range(-2, 2);
      } else {
        const side = rng.int(0, 3);
        const t = rng.range(-1, 1);
        if (side === 0) {
          out.x = t * (HX - 1);
          out.z = -HZ + 1;
        } else if (side === 1) {
          out.x = t * (HX - 1);
          out.z = HZ - 1;
        } else if (side === 2) {
          out.x = -HX + 1;
          out.z = t * (HZ - 1);
        } else {
          out.x = HX - 1;
          out.z = t * (HZ - 1);
        }
      }
      if (Math.hypot(out.x - px, out.z - pz) > 16) return;
    }
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
  }
}
