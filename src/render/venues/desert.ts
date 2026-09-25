import * as THREE from 'three';
import type { Rng } from '../../core/rng';
import { damp } from '../../core/math';
import { M } from '../materials';
import {
  bikeGeometry,
  buildDiscoBus,
  buildDome,
  buildDustDevil,
  buildEffigy,
  buildFishCar,
  buildFlowers,
  buildHand,
  buildMotelSign,
  buildOctopusCar,
  buildSpiral,
  buildTotems,
  chaseMat,
  merge,
  neon,
  personGeometry,
  searchlight,
  shadeGeometry,
  strut,
  type ArtCar,
  type Dome,
  type DustDevil,
  type Effigy,
  type Flowers,
  type Hand,
  type MotelSign,
  type SharedUniforms,
  type Spiral,
  type Totems,
} from './desertProps';
import {
  GLSL_COMMON,
  makeFlameMaterial,
  RippleBank,
  ringSpawn,
  type Bounds,
  type FrameInfo,
  type Venue,
  type VenuePalette,
} from './venue';

/**
 * NEON DESERT — a regional night festival out on a dry lake bed. No walls: a ring of paper
 * lanterns marks the dance floor, art installations stand in the dust as obstacles, art cars
 * crawl round a road outside the ring and the effigy waits on the horizon for the finale.
 */
const R = 50;
const LANTERN_R = 51.4;
const LANTERNS = 96;
const ROAD_R = 63.7;
const SUNDIAL_R = 8;
const BARRELS = 8;
const BARREL_R = 57.5;
const BARREL_A0 = 0.2;
const FAR = 400;

const DOME = { x: -24, z: -16, r: 5.4 };
const HAND = { x: 23, z: -22, r: 2.4 };
const SPIRAL = { x: 21, z: 19, r: 2.8 };
const FLOWERS = { x: -27, z: 21, r: 2.6 };
const TOTEM_SPOTS = [
  { x: -5, z: -32 },
  { x: 10, z: -40 },
  { x: -40, z: -2 },
  { x: 39, z: 2 },
  { x: -9, z: 34 },
  { x: 7, z: 42 },
];

const PAL = [0xff3df0, 0x2ee6ff, 0xffb347, 0x9a4dff];
const SIGN = { x: -30, z: -75 };

/** Deterministic scatter so the playa is laid out the same every night. */
function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The palette ramp the floor shader uses too (magenta → cyan → UV → amber). */
function palette(t: number, out: THREE.Color): THREE.Color {
  const cols = [PAL[0]!, PAL[1]!, PAL[3]!, PAL[2]!];
  const x = (((t % 1) + 1) % 1) * 4;
  const i = Math.floor(x);
  const a = new THREE.Color(cols[i % 4]!);
  const b = new THREE.Color(cols[(i + 1) % 4]!);
  return out.copy(a).lerp(b, x - i);
}

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
uniform float uBar;
uniform float uEnergy;
uniform float uDrop;
uniform float uBuild;
uniform float uKick;
uniform float uSnare;
uniform float uStep;
uniform float uFinale;
uniform vec2 uPlayer;
uniform float uR;
uniform vec3 uCols[4];
uniform vec4 uPools[6];
uniform vec3 uPoolCols[6];
uniform vec4 uCars[3];
uniform vec3 uCarCols[3];
uniform vec3 uFogCol;
uniform float uFogDensity;
varying vec3 vWorld;

const float TAU = 6.2831853;
const float LANTERN_R = ${LANTERN_R.toFixed(2)};
const float LANTERNS = ${LANTERNS.toFixed(1)};
const float ROAD_R = ${ROAD_R.toFixed(2)};
const float SUNDIAL_R = ${SUNDIAL_R.toFixed(1)};
const float BARRELS = ${BARRELS.toFixed(1)};
const float BARREL_R = ${BARREL_R.toFixed(1)};
const float BARREL_A0 = ${BARREL_A0.toFixed(4)};

vec3 pal(float t) {
  t = fract(t) * 4.0;
  if (t < 1.0) return mix(uCols[0], uCols[1], t);
  if (t < 2.0) return mix(uCols[1], uCols[3], t - 1.0);
  if (t < 3.0) return mix(uCols[3], uCols[2], t - 2.0);
  return mix(uCols[2], uCols[0], t - 3.0);
}

// Jittered triangular lattice -> irregular hexagonal mud plates.
// Returns (distance to the nearest crack, plate hash, plate centre).
vec4 plates(vec2 p) {
  vec2 q = vec2(p.x - p.y * 0.5773503, p.y * 1.1547005);
  vec2 b = floor(q);
  vec2 cs[9];
  vec2 best = vec2(0.0);
  float bd = 1e9;
  float bh = 0.0;
  for (int j = 0; j < 3; j++) {
    for (int i = 0; i < 3; i++) {
      vec2 id = b + vec2(float(i - 1), float(j - 1));
      float h = hash21(id);
      vec2 l = id + 0.5 + (vec2(h, hash21(id + 31.7)) - 0.5) * 0.62;
      vec2 c = vec2(l.x + l.y * 0.5, l.y * 0.8660254);
      cs[j * 3 + i] = c;
      vec2 dv = c - p;
      float d = dot(dv, dv);
      if (d < bd) { bd = d; best = c; bh = h; }
    }
  }
  float e = 1e9;
  for (int k = 0; k < 9; k++) {
    vec2 dv = cs[k] - best;
    float l2 = dot(dv, dv);
    if (l2 < 1e-6) continue;
    e = min(e, dot(0.5 * (best + cs[k]) - p, dv) * inversesqrt(l2));
  }
  return vec4(e, bh, best);
}

// a pair of tyre ruts either side of a path: s = offset from it, a = distance along it
float tyres(float s, float a, float gauge) {
  float d = abs(abs(s) - gauge);
  float rut = smoothstep(0.26, 0.15, d);
  float tread = step(0.45, fract(a * 2.4 + d * 5.0));
  return rut * (0.7 + 0.3 * tread);
}

// a meandering line of bare footprints
float prints(vec2 w, vec2 o, vec2 dir, float seed, float len) {
  vec2 dv = w - o;
  float u = dot(dv, dir);
  if (abs(u) > len) return 0.0;
  float v = dot(dv, vec2(-dir.y, dir.x)) - 1.7 * sin(u * 0.11 + seed);
  if (abs(v) > 0.6) return 0.0;
  float k = floor(u / 0.78);
  float side = mod(k, 2.0) < 0.5 ? -0.17 : 0.17;
  vec2 f = vec2((fract(u / 0.78) - 0.5) * 0.78, v - side);
  float ell = length(f / vec2(0.15, 0.065));
  float keep = step(hash21(vec2(k, seed)), 0.86) * smoothstep(len, len * 0.7, abs(u));
  return (smoothstep(1.0, 0.7, ell) - 0.5 * smoothstep(1.4, 1.0, ell) * step(1.0, ell)) * keep;
}

void main() {
  vec2 w = vWorld.xz;
  float r = length(w);
  float ang = atan(w.y, w.x);
  float beat = pow(1.0 - uBeat, 2.5);
  float camD = length(vWorld - cameraPosition);
  float detail = smoothstep(120.0, 50.0, camD);
  float inside = smoothstep(uR + 0.4, uR - 0.4, r);

  // wind-blown dust: soft drifts streaked along the wind, sand snaking across the crust
  vec2 wind = vec2(0.9363, 0.3511);
  vec2 wr = vec2(dot(w, wind), dot(w, vec2(-wind.y, wind.x)));
  vec2 dq = wr * vec2(0.03, 0.1) + 3.7;
  float drift = 0.57 * vnoise(dq) + 0.29 * vnoise(dq * 2.03 + 17.1) + 0.14 * vnoise(dq * 4.1 + 5.3);
  float dust = smoothstep(0.44, 0.7, drift);
  float snake = smoothstep(0.64, 0.86, vnoise(vec2(wr.x * 0.3 - uTime * 1.3, wr.y * 2.0))) * detail;

  // tyre tracks: the art-car road outside the ring, and old ruts crossing the playa
  float road = smoothstep(4.8, 3.2, abs(r - ROAD_R));
  float rut = 0.0;
  if (abs(r - ROAD_R) < 6.0) {
    float a = ang * ROAD_R;
    rut = max(tyres(r - ROAD_R + 1.9, a, 1.1), tyres(r - ROAD_R - 1.9, a + 3.0, 1.1));
    rut = max(rut, 0.55 * tyres(r - ROAD_R - 0.4, a * 1.01, 1.25));
  }
  vec2 c1 = w - vec2(-78.0, 40.0);
  float s1 = length(c1) - 70.0;
  if (abs(s1) < 2.0) rut = max(rut, tyres(s1, atan(c1.y, c1.x) * 70.0, 0.95) * smoothstep(0.35, 0.55, vnoise(w * 0.05)));
  vec2 c2 = w - vec2(70.0, -60.0);
  float s2 = length(c2) - 80.0;
  if (abs(s2) < 2.0) rut = max(rut, tyres(s2, atan(c2.y, c2.x) * 80.0, 0.95) * smoothstep(0.3, 0.5, vnoise(w * 0.06 + 9.0)));
  rut *= detail;

  // the crust: big curled plates split by deep fissures, each plate crazed with finer cracks
  // (secondary cracks stop at the fissures, like real mud)
  vec2 warp = vec2(vnoise(w * 0.09), vnoise(w * 0.09 + 17.0)) - 0.5;
  const float SB = 7.5;
  vec4 big = plates(w / SB + warp * 0.55);
  float eB = big.x * SB;
  const float S = 2.5;
  vec2 pq = w / S + warp * 0.3 + big.y * 13.0;
  // (the fine crazing is sub-pixel from far cameras: skip it there)
  vec4 pl = detail > 0.0 ? plates(pq) : vec4(1.0, 0.5, pq);
  float e = pl.x * S;
  float ph = pl.y;
  float fwB = fwidth(eB) + 0.002;
  float fw = fwidth(e) + 0.002;
  float detailB = smoothstep(200.0, 70.0, camD);
  float heal = (1.0 - dust * 0.8) * (1.0 - road * 0.75) * (1.0 - rut * 0.85);
  float n35 = vnoise(w * 0.35);
  float n7 = vnoise(w * 0.7);
  float widthB = (0.05 + 0.065 * n7) * heal;
  float width = (0.016 + 0.026 * n7) * heal;
  float fissure = (1.0 - smoothstep(widthB - fwB, widthB + fwB, eB)) * detailB;
  float fine = (1.0 - smoothstep(width - fw, width + fw, e)) * detail * (1.0 - 0.65 * n35);
  float lipB = smoothstep(0.9, 0.1, eB) * detailB;
  float lip = smoothstep(0.35, 0.04, e) * detail;
  float tilt = dot(pq - pl.zw, vec2(cos(ph * TAU), sin(ph * TAU)));

  vec3 clay = mix(vec3(0.036, 0.028, 0.029), vec3(0.047, 0.036, 0.034), ph * 0.35 + big.y * 0.3 + 0.15);
  clay *= 0.88 + 0.22 * n35 + tilt * 0.12 * detail;
  // curled plate edges catch the moonlight
  clay += vec3(0.012, 0.012, 0.02) * (lipB + lip * 0.5) * (1.0 - dust);
  vec3 dustCol = vec3(0.078, 0.06, 0.048);
  vec3 col = mix(clay, dustCol, dust * 0.85);
  col = mix(col, dustCol * 0.92, road * 0.65);
  col *= 1.0 - rut * 0.32;
  col *= 1.0 - fissure * 0.8;
  col *= 1.0 - fine * 0.45;
  col += vec3(0.014, 0.012, 0.01) * snake;
  // broad damp and dusty zones so the lake bed isn't one flat value
  col *= 0.8 + 0.4 * vnoise(w * 0.022 + 40.0);
  // sand grain
  col *= 1.0 + (hash21(floor(w * 14.0)) - 0.5) * 0.14 * detail;
  // bare footprints wandering between the art
  float fp = prints(w, vec2(-6.0, 8.0), vec2(0.8, -0.6), 1.0, 26.0)
           + prints(w, vec2(14.0, -6.0), vec2(0.28, 0.96), 4.0, 22.0)
           + prints(w, vec2(-18.0, -30.0), vec2(0.96, 0.28), 7.0, 18.0);
  col *= 1.0 - fp * 0.34 * detail;

  // UV light seeps up through the fissures in meandering veins: breathing on the beat, a
  // wave every two bars, a ring racing out from the performer on every kick, and rainbow
  // floods through every crack in a DROP
  float vein = smoothstep(0.45, 0.8, vnoise(w * 0.06 + vec2(uTime * 0.02, -uTime * 0.013)));
  float halo = (1.0 - smoothstep(widthB, widthB + 0.3, eB)) * detailB;
  float pd = length(w - uPlayer);
  float kr = (1.0 - uKick) * 26.0;
  float kickRing = smoothstep(3.0, 0.0, abs(pd - kr)) * uKick;
  float barWave = smoothstep(4.0, 0.0, abs(r - fract(uBar * 0.5) * 80.0));
  float glow = (0.015 + vein * 0.17) * (1.0 + beat * 0.8 + uEnergy * 0.5) + barWave * 0.2 + kickRing * 1.1;
  vec3 gc = uCols[3];
  vec3 wave = pal(r * 0.018 - uTime * 0.7);
  gc = mix(gc, wave, uDrop);
  // (distinct bands of light rolling outward rather than one flat glare)
  float flood = uDrop * (0.2 + 1.3 * pow(0.5 + 0.5 * sin(r * 0.3 - uTime * 9.0), 3.0)) + uFinale * (0.4 + 0.6 * pow(0.5 + 0.5 * sin(r * 0.25 - uTime * 5.0), 2.0));
  glow += flood;
  gc = mix(gc, vec3(1.0, 0.55, 0.18), uFinale);
  float fineGlow = fine * (kickRing * 0.5 + flood * 0.5);
  col += gc * ((fissure * 1.1 + halo * 0.14) * glow + fineGlow) * (1.0 - dust * 0.6);

  // light pools under the installations
  for (int i = 0; i < 6; i++) {
    float d = length(w - uPools[i].xy) / uPools[i].z;
    float pool = max(0.0, 1.0 - d);
    col += uPoolCols[i] * pool * pool * uPools[i].w;
  }
  // the sundial: sixteen solar stakes round the centre keep time with your pattern
  if (r < 11.0) {
    float sa = fract((ang + TAU * 0.25) / TAU) * 16.0;
    float k = floor(sa + 0.5);
    float a = k / 16.0 * TAU - TAU * 0.25;
    float d = length(w - SUNDIAL_R * vec2(cos(a), sin(a)));
    float hot = 1.0 - step(0.5, abs(mod(k, 16.0) - uStep));
    float quarter = 1.0 - step(0.5, mod(k, 4.0));
    vec3 sc = mix(uCols[1], vec3(1.0, 0.92, 0.8), hot);
    col += mix(sc, vec3(1.0, 0.6, 0.2), uFinale) * exp(-d * d * 1.4) * (0.14 + quarter * 0.08 + hot * 0.6);
    // a faint chalk ring joins them
    col += vec3(0.02, 0.02, 0.03) * smoothstep(0.06, 0.0, abs(r - SUNDIAL_R)) * detail;
  }
  // burn barrels just outside the lanterns throw flickering warm light
  if (r > uR) {
    float bd = TAU / BARRELS;
    float k = floor((ang - BARREL_A0) / bd + 0.5);
    float a = k * bd + BARREL_A0;
    float d = length(w - BARREL_R * vec2(cos(a), sin(a)));
    float flick = 0.8 + 0.2 * sin(uTime * 13.0 + k * 7.0) * sin(uTime * 7.3 + k);
    col += vec3(1.0, 0.45, 0.14) * exp(-d * d * 0.06) * 0.22 * flick;
  }
  col += vec3(1.0, 0.8, 0.6) * 0.1 * smoothstep(7.0, 0.0, pd);
  col += ripples(w);
  col = paintOver(col, w);

  // beyond the ring the playa is darker; the lanterns and the art cars light it
  col = mix(col * 0.6, col, inside);
  if (r > uR - 6.0 && r < LANTERN_R + 8.0) {
    float da = TAU / LANTERNS;
    float k0 = floor(ang / da);
    vec3 lc = vec3(0.0);
    for (int n = -1; n <= 1; n++) {
      float k = k0 + float(n);
      float a = (k + 0.5) * da;
      float d = length(w - LANTERN_R * vec2(cos(a), sin(a)));
      float st = floor(fract((a + TAU * 0.25) / TAU) * 16.0);
      // the ring is a step sequencer: the lanterns on the current 16th burn white-hot
      float hot = 1.0 - step(0.5, abs(st - uStep));
      vec3 c = mix(pal(mod(k, LANTERNS) / 12.0), vec3(1.0, 0.9, 0.75), hot * 0.7);
      c = mix(c, vec3(1.0, 0.65, 0.25), uFinale);
      lc += c * exp(-d * d * 0.3) * (0.3 + hot * 0.8 + beat * 0.15 + uSnare * 0.6);
    }
    col += lc * 0.3;
    // EL-wire rope strung along the edge of the dance floor
    float rope = smoothstep(0.1, 0.0, abs(r - (uR + 0.55)));
    float dash = smoothstep(0.2, 0.3, fract(ang * 90.0 / TAU - uTime * 0.6));
    col += mix(uCols[1], vec3(1.0, 0.7, 0.3), uFinale) * rope * dash * (0.7 + beat * 0.8 + uDrop);
  }
  if (r > uR) {
    for (int i = 0; i < 3; i++) {
      vec2 lp = w - uCars[i].xy;
      vec2 fwd = uCars[i].zw;
      float al = dot(lp, fwd);
      float sd = dot(lp, vec2(-fwd.y, fwd.x));
      float under = exp(-(al * al) / 16.0 - (sd * sd) / 3.5);
      col += uCarCols[i] * under * 0.4;
      float cone = smoothstep(0.42 * al + 0.8, 0.22 * al, abs(sd)) * smoothstep(3.5, 5.5, al) * smoothstep(24.0, 6.0, al);
      col += vec3(1.0, 0.9, 0.72) * cone * 0.1;
    }
  }
  col *= 1.0 - uBuild * 0.7;
  col = mix(col, uFogCol, 1.0 - exp(-uFogDensity * uFogDensity * camD * camD));
  gl_FragColor = vec4(col, 1.0);
}`;

/** Noise helpers only (no ripple/paint uniforms) for the sky. */
const NOISE = GLSL_COMMON.replace(/uniform vec4 uRipples[\s\S]*$/, '');

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  // a backdrop at infinity: rotate with the camera, never translate, pin to the far plane
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = p.xyww;
}`;

const SKY_FRAG = /* glsl */ `
${NOISE}
uniform vec3 uTop;
uniform vec3 uMid;
uniform vec3 uHaze;
uniform vec3 uGlow;
uniform vec3 uMoon;
uniform float uFar;
uniform float uTime;
uniform float uDrop;
uniform float uFinale;
varying vec3 vDir;
float h3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
void main() {
  vec3 d = normalize(vDir);
  // the far plane cuts the playa off below the true horizon for a high camera: start the
  // sky where the ground ends so the haze line always meets the desert
  float h0 = -cameraPosition.y / uFar;
  float el = d.y - h0;
  float az = atan(d.x, -d.z);
  vec3 col = mix(uHaze, uMid, smoothstep(0.0, 0.12, el));
  col = mix(col, uTop, smoothstep(0.1, 0.65, el));
  // the milky way: a dusty band of faint stars across the sky
  vec3 bandN = normalize(vec3(0.45, 0.35, 0.82));
  float band = exp(-pow(dot(d, bandN) * 5.0, 2.0));
  float neb = fbm(vec2(az * 3.0, d.y * 6.0) + 11.0);
  col += vec3(0.05, 0.035, 0.08) * band * smoothstep(0.35, 0.8, neb) * smoothstep(0.02, 0.2, el);
  // stars
  vec3 sp = d * 150.0;
  vec3 id = floor(sp);
  float hs = h3(id);
  vec3 so = fract(sp) - 0.5 - (vec3(h3(id + 1.3), h3(id + 2.7), h3(id + 4.1)) - 0.5) * 0.6;
  float dens = mix(0.972, 0.94, band);
  float star = smoothstep(0.22, 0.0, length(so)) * step(dens, hs);
  float tw = 0.6 + 0.4 * sin(uTime * (1.5 + hs * 6.0) + hs * 50.0);
  col += mix(vec3(0.7, 0.8, 1.0), vec3(1.0, 0.85, 0.7), fract(hs * 13.0)) * star * tw * smoothstep(0.015, 0.12, el) * 1.4;
  // the festival lights the haze from below
  vec3 glow = mix(uGlow, vec3(1.0, 0.4, 0.1), uFinale);
  col += glow * exp(-max(el, 0.0) * 28.0) * (0.3 + uDrop * 0.15 + uFinale * 0.9);
  // a huge moon rising behind the mountains
  vec3 md = normalize(vec3(uMoon.x, uMoon.y + h0, uMoon.z));
  vec3 mr = normalize(cross(md, vec3(0.0, 1.0, 0.0)));
  vec3 mu = cross(mr, md);
  float MR = 0.07;
  vec2 mp = vec2(dot(d, mr), dot(d, mu)) / MR;
  float front = step(0.0, dot(d, md));
  float ml = length(mp);
  float disc = smoothstep(1.0, 0.985, ml) * front;
  float maria = smoothstep(0.45, 0.75, fbm(mp * 1.6 + 4.0));
  float craters = smoothstep(0.62, 0.7, vnoise(mp * 7.0)) * 0.25;
  vec3 moon = vec3(1.0, 0.93, 0.82) * (1.0 - maria * 0.35 - craters) * (0.55 + 0.45 * sqrt(max(0.0, 1.0 - ml * ml)));
  col = mix(col, moon * 1.5, disc);
  col += vec3(0.5, 0.45, 0.6) * exp(-max(ml - 1.0, 0.0) * 2.2) * (1.0 - disc) * front * 0.14;
  // mountains ringing the playa
  // (a far range pale in the haze, a nearer jagged one in silhouette)
  float mf = 0.02 + 0.035 * vnoise(vec2(az * 2.0, 3.0)) + 0.008 * vnoise(vec2(az * 14.0, 7.0));
  col = mix(col, mix(uHaze, uMid, 0.35) * 1.15, smoothstep(mf + 0.002, mf, el));
  float m = 0.008 + 0.028 * vnoise(vec2(az * 3.0, 1.0)) + 0.016 * vnoise(vec2(az * 9.0, 5.0)) + 0.005 * vnoise(vec2(az * 40.0, 9.0));
  float mount = smoothstep(m + 0.002, m, el);
  vec3 mcol = mix(uHaze * 0.75, uHaze * 0.5, smoothstep(0.0, m, el));
  mcol += vec3(0.05, 0.05, 0.09) * smoothstep(m - 0.012, m, el) * 0.3;
  col = mix(col, mcol, mount);
  col = mix(col, uHaze, smoothstep(0.004, -0.004, el));
  gl_FragColor = vec4(col, 1.0);
}`;

const LANTERN_VERT = /* glsl */ `
attribute float aStep;
varying float vStep;
varying vec3 vCol;
varying float vY;
void main() {
  vStep = aStep;
  vCol = instanceColor;
  vY = position.y;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
}`;

const LANTERN_FRAG = /* glsl */ `
uniform float uStep;
uniform float uBeat;
uniform float uSnare;
uniform float uDrop;
uniform float uFinale;
uniform float uTime;
varying float vStep;
varying vec3 vCol;
varying float vY;
void main() {
  float hot = 1.0 - step(0.5, abs(vStep - uStep));
  // paper glows hottest round the belly, the ribs and the caps stay darker
  float ribs = (0.7 + 0.3 * abs(sin(vY * 34.0))) * (0.55 + 0.6 * (1.0 - abs(vY) / 0.36));
  vec3 c = mix(vCol, vec3(1.0, 0.92, 0.8), hot * 0.75);
  float k = 1.0 + uBeat * 0.4 + uSnare * 1.3 + hot * 1.8 + uDrop * step(0.5, fract(uTime * 4.0 + vStep * 0.25));
  c = mix(c, vec3(1.0, 0.68, 0.3), uFinale * 0.85);
  gl_FragColor = vec4(c * k * ribs * 1.25, 1.0);
}`;

const HALO_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vCol;
varying float vPh;
void main() {
  vUv = uv;
  vec3 ip = instanceMatrix[3].xyz;
  vPh = fract(sin(dot(ip.xz, vec2(12.9898, 78.233))) * 43758.5453);
  vCol = instanceColor;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
}`;

const HALO_FRAG = /* glsl */ `
uniform float uTime;
uniform float uHat;
uniform float uDrop;
varying vec2 vUv;
varying vec3 vCol;
varying float vPh;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = pow(max(0.0, 1.0 - d), 2.2);
  // hats make a random handful of the glow sticks spark
  float spark = uHat * step(0.6, fract(vPh * 7.0 + floor(uTime * 12.0) * 0.37));
  float tw = 0.5 + 0.2 * sin(uTime * (1.0 + vPh * 2.0) + vPh * 30.0) + spark * 1.4 + uDrop * 0.4;
  gl_FragColor = vec4(vCol * a * tw * 0.3, 1.0);
}`;

const DUST_VERT = /* glsl */ `
attribute vec4 aSeed;
uniform float uTime;
uniform vec2 uCenter;
uniform vec3 uBox;
varying float vA;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 p = aSeed.xyz * uBox;
  float sp = 0.6 + aSeed.w * 0.8;
  p.xz += vec2(3.4, 1.3) * uTime * sp;
  p.y += sin(uTime * 0.7 + aSeed.x * 40.0) * 0.4;
  p.xz = mod(p.xz - uCenter + uBox.xz * 0.5, uBox.xz) + uCenter - uBox.xz * 0.5;
  float big = step(0.93, aSeed.w);
  float size = mix(0.06 + aSeed.w * 0.11, 3.0 + aSeed.y * 3.0, big);
  p.y = mix(p.y, 0.6 + aSeed.y, big);
  vA = mix(0.55, 0.045, big);
  vec2 e = abs(p.xz - uCenter) / (uBox.xz * 0.5);
  vA *= smoothstep(1.0, 0.75, max(e.x, e.y));
  vec4 mv = viewMatrix * vec4(p, 1.0);
  mv.xy += position.xy * size;
  gl_Position = projectionMatrix * mv;
}`;

const DUST_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vA;
varying vec2 vUv;
void main() {
  float a = smoothstep(0.5, 0.0, length(vUv - 0.5)) * vA;
  gl_FragColor = vec4(uColor * a, a);
}`;

const CROWD_VERT = /* glsl */ `
attribute float aGlow;
uniform float uBounce;
uniform float uTime;
varying float vGlow;
varying vec3 vCol;
varying float vY;
void main() {
  vec3 ip = instanceMatrix[3].xyz;
  float h = fract(sin(dot(ip.xz, vec2(12.9898, 78.233))) * 43758.5453);
  vec3 p = position;
  // the raised arm waves its glow stick
  float arm = smoothstep(1.8, 2.8, p.y);
  p.x += sin(uTime * 2.6 + h * 20.0) * 0.35 * arm;
  vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
  wp.y += uBounce * (0.3 + h * 0.8) * step(0.2, h);
  vGlow = aGlow;
  vCol = instanceColor;
  vY = position.y;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const CROWD_FRAG = /* glsl */ `
varying float vGlow;
varying vec3 vCol;
varying float vY;
void main() {
  vec3 body = vec3(0.022, 0.018, 0.034) * (0.6 + vY * 0.35);
  gl_FragColor = vec4(mix(body, vCol * 2.6, vGlow), 1.0);
}`;

export class Desert implements Venue {
  readonly id = 'desert' as const;
  readonly name = 'NEON DESERT';
  readonly tagline = 'No walls, no curfew, one enormous sky.';
  readonly bpm = 140;
  readonly progression = 'desert' as const;
  readonly bounds: Bounds = { kind: 'circle', r: R };
  readonly palette: VenuePalette = {
    // hot pink edge: grey-brown playa needs a loud rim to read the horde
    rim: new THREE.Color(0xff5ad8),
    floor: new THREE.Color(0x2ee6ff),
    accents: [PAL[0]!, PAL[1]!, PAL[2]!, PAL[3]!],
    fog: 0x120b24,
    fogDensity: 0.0042,
    background: 0x05030c,
    core: 0xfff4ea,
  };
  readonly group = new THREE.Group();
  readonly obstacles: { x: number; z: number; r: number }[] = [
    { x: DOME.x, z: DOME.z, r: DOME.r },
    { x: HAND.x, z: HAND.z, r: HAND.r },
    { x: SPIRAL.x, z: SPIRAL.z, r: SPIRAL.r },
    { x: FLOWERS.x, z: FLOWERS.z, r: FLOWERS.r },
    ...TOTEM_SPOTS.map((t) => ({ x: t.x, z: t.z, r: 0.7 })),
  ];
  private readonly floorMat: THREE.ShaderMaterial;
  private readonly skyMat: THREE.ShaderMaterial;
  private readonly rip = new RippleBank();
  private readonly U: SharedUniforms;
  private readonly pools = Array.from({ length: 6 }, () => new THREE.Vector4());
  private readonly poolCols = Array.from({ length: 6 }, () => new THREE.Color());
  private readonly carVecs = Array.from({ length: 3 }, () => new THREE.Vector4());
  /** light pools on the dust under the art: x, z, radius (strength is set per frame) */
  private static readonly POOLS: readonly [number, number, number, number][] = [
    [DOME.x, DOME.z, 9, PAL[3]!],
    [HAND.x, HAND.z + 3, 8, PAL[0]!],
    [SPIRAL.x, SPIRAL.z, 7, PAL[2]!],
    [FLOWERS.x, FLOWERS.z + 1, 7, 0xff5ab0],
    [TOTEM_SPOTS[0]!.x, TOTEM_SPOTS[0]!.z, 5, PAL[1]!],
    [TOTEM_SPOTS[4]!.x, TOTEM_SPOTS[4]!.z, 5, PAL[0]!],
  ];
  private readonly carCols = [new THREE.Color(0x2ee6ff), new THREE.Color(0xff3df0), new THREE.Color(0xffb347)];
  private readonly dome: Dome;
  private readonly hand: Hand;
  private readonly spiral: Spiral;
  private readonly flowers: Flowers;
  private readonly totems: Totems;
  private readonly cars: ArtCar[];
  private readonly effigy: Effigy;
  private readonly sign: MotelSign;
  private readonly devils: DustDevil[];
  private readonly lanternMat: THREE.ShaderMaterial;
  private readonly haloMat: THREE.ShaderMaterial;
  private readonly dustMat: THREE.ShaderMaterial;
  private readonly crowdMat: THREE.ShaderMaterial;
  private readonly beams: { pivot: THREE.Object3D; mat: THREE.ShaderMaterial; phase: number }[] = [];
  private readonly archMats: THREE.ShaderMaterial[] = [];
  private readonly effigyBeams: THREE.ShaderMaterial[] = [];
  private readonly barrelFlame = makeFlameMaterial(0xff6a1a);
  private readonly barrelSprites: THREE.Mesh[] = [];
  private readonly lights: THREE.PointLight[] = [];
  private kick = 0;
  private snare = 0;
  private hat = 0;
  private bass = 0;
  private lead = 0;
  private level = 0;
  private blink = 0;
  private flameT = 0;
  private dropOn = false;
  private finaleOn = false;
  private finaleT = 0;
  private readonly tmpQ = new THREE.Quaternion();

  constructor() {
    const cols = PAL.map((c) => new THREE.Color(c));
    Desert.POOLS.forEach(([x, z, rr, c], i) => {
      this.pools[i]!.set(x, z, rr, 0);
      this.poolCols[i]!.setHex(c);
    });
    this.U = {
      uTime: { value: 0 },
      uBeat: { value: 0 },
      uDrop: { value: 0 },
      uFinale: { value: 0 },
      uStrobe: { value: 0 },
      uEnergy: { value: 0 },
      uCols: { value: cols },
    };
    const U = this.U;
    this.floorMat = new THREE.ShaderMaterial({
      vertexShader: FLOOR_VERT,
      fragmentShader: FLOOR_FRAG,
      uniforms: {
        uTime: U.uTime,
        uBeat: { value: 0 },
        uBar: { value: 0 },
        uEnergy: U.uEnergy,
        uDrop: U.uDrop,
        uBuild: { value: 0 },
        uKick: { value: 0 },
        uSnare: { value: 0 },
        uStep: { value: 0 },
        uFinale: U.uFinale,
        uPlayer: { value: new THREE.Vector2() },
        uR: { value: R },
        uCols: U.uCols,
        uPools: { value: this.pools },
        uPoolCols: { value: this.poolCols },
        uCars: { value: this.carVecs },
        uCarCols: { value: this.carCols },
        uFogCol: { value: new THREE.Color(this.palette.fog) },
        uFogDensity: { value: this.palette.fogDensity },
        ...this.rip.uniforms(),
      },
    });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(FAR + 30, 128), this.floorMat);
    floor.rotation.x = -Math.PI / 2;
    this.group.add(floor);

    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: {
        uTop: { value: new THREE.Color(0x02020a) },
        uMid: { value: new THREE.Color(0x0a0820) },
        uHaze: { value: new THREE.Color(this.palette.fog) },
        uGlow: { value: new THREE.Color(0x6a1a5a) },
        uMoon: { value: new THREE.Vector3(0.32, 0.085, -1) },
        uFar: { value: FAR },
        uTime: U.uTime,
        uDrop: U.uDrop,
        uFinale: U.uFinale,
      },
      side: THREE.BackSide,
      depthWrite: false,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), this.skyMat);
    sky.frustumCulled = false;
    // after the opaque props: the far-plane depth lets the floor early-out most of its pixels
    sky.renderOrder = 1;
    this.group.add(sky);

    // the art
    this.dome = buildDome(U, DOME.r);
    this.dome.group.position.set(DOME.x, 0, DOME.z);
    this.group.add(this.dome.group);
    this.hand = buildHand(U);
    this.hand.group.position.set(HAND.x, 0, HAND.z);
    this.hand.group.rotation.set(-0.42, -0.25, 0);
    this.group.add(this.hand.group);
    this.hand.group.updateMatrixWorld(true);
    this.hand.eyeWorld.set(0, 3, 0.5).applyMatrix4(this.hand.group.matrixWorld);
    this.spiral = buildSpiral(U);
    this.spiral.group.position.set(SPIRAL.x, 0, SPIRAL.z);
    this.group.add(this.spiral.group);
    this.flowers = buildFlowers(U);
    this.flowers.group.position.set(FLOWERS.x, 0, FLOWERS.z);
    this.group.add(this.flowers.group);
    this.totems = buildTotems(U, TOTEM_SPOTS);
    this.group.add(this.totems.group);

    // art cars on the road round the ring
    this.cars = [buildFishCar(U), buildDiscoBus(U), buildOctopusCar(U)];
    for (const c of this.cars) this.group.add(c.group);

    // a roadside neon sign past the art-car road, and dust devils wandering the playa
    this.sign = buildMotelSign(U);
    this.sign.group.position.set(SIGN.x, 0, SIGN.z);
    this.sign.group.rotation.y = Math.atan2(-SIGN.x, -SIGN.z);
    this.group.add(this.sign.group);
    this.devils = [buildDustDevil(U, 0), buildDustDevil(U, 3.7)];
    for (const d of this.devils) this.group.add(d.mesh);

    // the effigy on the horizon
    this.effigy = buildEffigy();
    this.effigy.group.position.set(10, 0, -150);
    this.group.add(this.effigy.group);
    // four searchlights cross over the figure; a ring of torches round its base
    const head = new THREE.Vector3(10, 30, -150);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      const sl = searchlight(k % 2 ? 0x2ee6ff : 0xff3df0);
      sl.pivot.position.set(10 + Math.cos(a) * 16, 0.5, -150 + Math.sin(a) * 16);
      const dir = head.clone().sub(sl.pivot.position).add(new THREE.Vector3(-Math.cos(a) * 20, 40, -Math.sin(a) * 20)).normalize();
      sl.pivot.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      sl.mat.uniforms.uOpacity!.value = 0.4;
      this.group.add(sl.pivot);
      this.effigyBeams.push(sl.mat);
    }
    const torches = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffa040).multiplyScalar(3), fog: false }), 20);
    const tm = new THREE.Matrix4();
    for (let k = 0; k < 20; k++) {
      const a = (k / 20) * Math.PI * 2;
      torches.setMatrixAt(k, tm.makeTranslation(10 + Math.cos(a) * 13, 1.4, -150 + Math.sin(a) * 13));
    }
    this.group.add(torches);

    this.lanternMat = this.buildLanterns();
    this.haloMat = this.buildGlowSticks();
    this.crowdMat = new THREE.ShaderMaterial({
      uniforms: { uBounce: { value: 0 }, uTime: U.uTime },
      vertexShader: CROWD_VERT,
      fragmentShader: CROWD_FRAG,
    });
    this.buildSundial();
    this.buildBarrels();
    this.buildCamps();
    this.buildFarLights();
    this.dustMat = this.buildDust();

    // lights for the lit props: moonlight from behind the effigy, a violet sky bounce,
    // and three neon washes on the installations
    const hemi = new THREE.HemisphereLight(0x5a4ab8, 0x2a1a16, 1.1);
    this.group.add(hemi);
    const moon = new THREE.DirectionalLight(0xb8c4ff, 1.4);
    moon.position.set(12, 30, -40);
    this.group.add(moon);
    for (const [x, y, z, c, i] of [
      [DOME.x, 3.5, DOME.z, 0x9a4dff, 60],
      [HAND.x, 5, HAND.z + 5, 0xff3df0, 70],
      [SPIRAL.x, 5, SPIRAL.z, 0xffb347, 50],
    ] as const) {
      const l = new THREE.PointLight(c, i, 20, 1.6);
      l.position.set(x, y, z);
      this.group.add(l);
      this.lights.push(l);
    }
  }

  /** 96 paper lanterns hung from shepherd's hooks: the edge of the dance floor, and a 16-step clock. */
  private buildLanterns(): THREE.ShaderMaterial {
    // hook: a post, an arm reaching in over the floor and a short cord (local +x points inward)
    const hookGeo = merge([
      new THREE.CylinderGeometry(0.045, 0.065, 2.9, 5).translate(0, 1.45, 0),
      strut(new THREE.Vector3(0, 2.86, 0), new THREE.Vector3(0.55, 2.86, 0), 0.03, 4),
      strut(new THREE.Vector3(0, 2.4, 0), new THREE.Vector3(0.3, 2.86, 0), 0.02, 4),
      new THREE.CylinderGeometry(0.008, 0.008, 0.3, 3).translate(0.55, 2.72, 0),
    ]);
    const poles = new THREE.InstancedMesh(hookGeo, M.darkWood(), LANTERNS);
    // a round, ribbed paper lantern
    const prof: THREE.Vector2[] = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      prof.push(new THREE.Vector2(0.12 + Math.sin(t * Math.PI) * 0.26, -0.36 + t * 0.72));
    }
    const bodyGeo = new THREE.LatheGeometry(prof, 14);
    const capGeo = merge([new THREE.CylinderGeometry(0.11, 0.14, 0.08, 10).translate(0, 0.39, 0), new THREE.CylinderGeometry(0.14, 0.11, 0.07, 10).translate(0, -0.39, 0)]);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uStep: { value: 0 },
        uBeat: this.U.uBeat,
        uSnare: { value: 0 },
        uDrop: this.U.uDrop,
        uFinale: this.U.uFinale,
        uTime: this.U.uTime,
      },
      vertexShader: LANTERN_VERT,
      fragmentShader: LANTERN_FRAG,
    });
    const bodies = new THREE.InstancedMesh(bodyGeo, mat, LANTERNS);
    const caps = new THREE.InstancedMesh(capGeo, M.blackPlastic(), LANTERNS);
    const steps = new Float32Array(LANTERNS);
    const m4 = new THREE.Matrix4();
    const c = new THREE.Color();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const at = new THREE.Vector3();
    for (let k = 0; k < LANTERNS; k++) {
      const a = ((k + 0.5) / LANTERNS) * Math.PI * 2;
      const x = Math.cos(a) * LANTERN_R;
      const z = Math.sin(a) * LANTERN_R;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(Math.sin(a), -Math.cos(a)));
      poles.setMatrixAt(k, m4.compose(at.set(x + Math.cos(a) * 0.55, 0, z + Math.sin(a) * 0.55), q, one));
      m4.makeTranslation(x, 2.2, z);
      bodies.setMatrixAt(k, m4);
      caps.setMatrixAt(k, m4);
      bodies.setColorAt(k, palette(k / 12, c));
      const sa = ((a + Math.PI / 2) / (Math.PI * 2)) % 1;
      steps[k] = Math.floor(sa * 16);
    }
    bodyGeo.setAttribute('aStep', new THREE.InstancedBufferAttribute(steps, 1));
    this.group.add(poles, bodies, caps);
    return mat;
  }

  /** Sixteen solar stakes round the centre of the playa: a sundial that keeps your time. */
  private buildSundial(): void {
    const postGeo = new THREE.CylinderGeometry(0.04, 0.05, 0.9, 5);
    postGeo.translate(0, 0.45, 0);
    const posts = new THREE.InstancedMesh(postGeo, M.darkChrome(), 16);
    // small warm lamps (cyan orbs round the player read as pickups, and cyan is the LEAD track)
    const capGeo = new THREE.SphereGeometry(0.11, 10, 8);
    const caps = new THREE.InstancedMesh(capGeo, this.lanternMat, 16);
    const steps = new Float32Array(16);
    const m4 = new THREE.Matrix4();
    const c = new THREE.Color();
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(a) * SUNDIAL_R;
      const z = Math.sin(a) * SUNDIAL_R;
      posts.setMatrixAt(k, m4.makeTranslation(x, 0, z));
      caps.setMatrixAt(k, m4.makeTranslation(x, 0.98, z));
      caps.setColorAt(k, c.setHex(k % 4 === 0 ? 0xfff1d0 : 0xffa050));
      steps[k] = k;
    }
    capGeo.setAttribute('aStep', new THREE.InstancedBufferAttribute(steps, 1));
    this.group.add(posts, caps);
  }

  /** Burn barrels outside the lanterns, each with a knot of people warming their hands. */
  private buildBarrels(): void {
    const drum = new THREE.CylinderGeometry(0.45, 0.42, 0.95, 16, 1, true);
    drum.translate(0, 0.475, 0);
    const hoops = merge([0.12, 0.83].map((y) => new THREE.TorusGeometry(0.46, 0.03, 4, 20).rotateX(Math.PI / 2).translate(0, y, 0)));
    const rust = new THREE.MeshStandardMaterial({ color: 0x5a3322, metalness: 0.5, roughness: 0.75, side: THREE.DoubleSide });
    const drums = new THREE.InstancedMesh(merge([drum, hoops]), rust, BARRELS);
    const coals = new THREE.InstancedMesh(new THREE.CircleGeometry(0.42, 14).rotateX(-Math.PI / 2), neon(0xff6a1a, 3), BARRELS);
    const m4 = new THREE.Matrix4();
    for (let k = 0; k < BARRELS; k++) {
      const a = (k / BARRELS) * Math.PI * 2 + BARREL_A0;
      const x = Math.cos(a) * BARREL_R;
      const z = Math.sin(a) * BARREL_R;
      drums.setMatrixAt(k, m4.makeTranslation(x, 0, z));
      coals.setMatrixAt(k, m4.makeTranslation(x, 0.8, z));
      // billboarded flame sheets (a cone would read as a traffic cone from above)
      for (let j = 0; j < 2; j++) {
        const geo = new THREE.PlaneGeometry(1.3 - j * 0.4, 2.2 - j * 0.6, 1, 4);
        geo.translate(0, (2.2 - j * 0.6) / 2, 0);
        const f = new THREE.Mesh(geo, this.barrelFlame);
        f.position.set(x, 0.85, z);
        this.group.add(f);
        this.barrelSprites.push(f);
      }
    }
    this.group.add(drums, coals);
  }

  /** The rest of the city: clusters of camp lights sprawling out across the playa. */
  private buildFarLights(): void {
    const rnd = prng(99);
    const n = 720;
    const mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.4, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }), n);
    const m4 = new THREE.Matrix4();
    const c = new THREE.Color();
    const cols = [0xffc98a, 0xff8ad8, 0x8ae8ff, 0xffe9b0, 0xb08aff, 0xffb070];
    let i = 0;
    while (i < n) {
      const a = -Math.PI / 2 + (rnd() - 0.5) * Math.PI * (rnd() < 0.75 ? 1.5 : 2);
      const rr = 122 + rnd() * 200;
      const cx = Math.cos(a) * rr;
      const cz = Math.sin(a) * rr;
      if (Math.hypot(cx - 10, cz + 150) < 34) continue;
      const count = 6 + Math.floor(rnd() * 16);
      const col = cols[Math.floor(rnd() * cols.length)]!;
      const dim = 1.8 * (1 - (rr - 122) / 330);
      for (let k = 0; k < count && i < n; k++, i++) {
        mesh.setMatrixAt(i, m4.makeTranslation(cx + (rnd() - 0.5) * 14, 0.6 + rnd() * 2.6, cz + (rnd() - 0.5) * 9));
        mesh.setColorAt(i, c.setHex(col).multiplyScalar(dim * (0.6 + rnd() * 0.8)));
      }
    }
    this.group.add(mesh);
  }

  /** Glow sticks and LED hoops dropped all over the playa, each with a soft pool of light. */
  private buildGlowSticks(): THREE.ShaderMaterial {
    const rnd = prng(7);
    const colors = [0x7dff4d, 0xff3df0, 0x2ee6ff, 0x9a4dff, 0xffb347, 0xff5a8a];
    const n = 80;
    const stickGeo = new THREE.CapsuleGeometry(0.035, 0.34, 2, 6);
    stickGeo.rotateZ(Math.PI / 2);
    const sticks = new THREE.InstancedMesh(stickGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), n);
    const haloGeo = new THREE.PlaneGeometry(1.8, 1.8);
    haloGeo.rotateX(-Math.PI / 2);
    const haloMat = new THREE.ShaderMaterial({
      uniforms: { uTime: this.U.uTime, uHat: { value: 0 }, uDrop: this.U.uDrop },
      vertexShader: HALO_VERT,
      fragmentShader: HALO_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const nh = 10;
    const halos = new THREE.InstancedMesh(haloGeo, haloMat, n + nh);
    const hoopGeo = new THREE.TorusGeometry(0.5, 0.028, 4, 36);
    hoopGeo.rotateX(Math.PI / 2);
    const hoops = new THREE.InstancedMesh(hoopGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), nh);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    const c = new THREE.Color();
    const place = (): THREE.Vector3 => {
      for (;;) {
        const a = rnd() * Math.PI * 2;
        const rr = Math.sqrt(rnd()) * (R - 1);
        p.set(Math.cos(a) * rr, 0.04, Math.sin(a) * rr);
        if (!this.obstacles.some((o) => Math.hypot(p.x - o.x, p.z - o.z) < o.r + 0.8)) return p;
      }
    };
    for (let i = 0; i < n; i++) {
      place();
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI);
      m4.compose(p, q, s);
      sticks.setMatrixAt(i, m4);
      c.setHex(colors[Math.floor(rnd() * colors.length)]!);
      sticks.setColorAt(i, c.clone().multiplyScalar(2.6));
      m4.makeTranslation(p.x, 0.03, p.z);
      halos.setMatrixAt(i, m4);
      halos.setColorAt(i, c);
    }
    for (let i = 0; i < nh; i++) {
      place();
      m4.makeTranslation(p.x, 0.05, p.z);
      hoops.setMatrixAt(i, m4);
      c.setHex(colors[i % colors.length]!);
      hoops.setColorAt(i, c.clone().multiplyScalar(2.2));
      m4.makeScale(1.3, 1, 1.3).setPosition(p.x, 0.03, p.z);
      halos.setMatrixAt(n + i, m4);
      halos.setColorAt(n + i, c);
    }
    halos.renderOrder = 2;
    this.group.add(sticks, hoops, halos);
    return haloMat;
  }

  /** Camps beyond the road: shade structures, RVs, string lights, bikes, two sound camps. */
  private buildCamps(): void {
    const rnd = prng(21);
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    const p = new THREE.Vector3();
    const c = new THREE.Color();
    const yAxis = new THREE.Vector3(0, 1, 0);
    const sound = [
      { x: -74, z: -56, face: 0 },
      { x: 80, z: -44, face: 0 },
    ];
    const clear = (x: number, z: number, rr: number): boolean =>
      sound.every((s) => Math.hypot(x - s.x, z - s.z) > 16 + rr) && Math.hypot(x - 10, z + 150) > 20 && Math.hypot(x - SIGN.x, z - SIGN.z) > 10 + rr;

    // shade structures and RVs, denser to the north where the camera looks
    const shades: THREE.Matrix4[] = [];
    const rvs: THREE.Matrix4[] = [];
    const bulbs: { m: THREE.Matrix4; c: number }[] = [];
    const bulbCols = [0xffd08a, 0xff8ad8, 0x8ae8ff, 0xffe9b0, 0xb08aff];
    const shadeCols: number[] = [];
    const fabric = [0x6a2a3a, 0x2a3a6a, 0x4a2a6a, 0x6a4a2a, 0x2a5a5a, 0x5a5a62];
    for (let i = 0; i < 70; i++) {
      const a = -Math.PI / 2 + (rnd() - 0.5) * Math.PI * (rnd() < 0.7 ? 1.3 : 2);
      const rr = 74 + rnd() * 40;
      const x = Math.cos(a) * rr;
      const z = Math.sin(a) * rr;
      if (!clear(x, z, 4)) continue;
      const yaw = a + Math.PI / 2 + (rnd() - 0.5) * 0.5;
      q.setFromAxisAngle(yAxis, yaw);
      if (rnd() < 0.55) {
        const sc = 0.9 + rnd() * 0.5;
        shades.push(new THREE.Matrix4().compose(p.set(x, 0, z), q, new THREE.Vector3(sc, 1, sc)));
        shadeCols.push(fabric[Math.floor(rnd() * fabric.length)]!);
        // fairy lights along the canopy edge
        const col = bulbCols[Math.floor(rnd() * bulbCols.length)]!;
        for (let k = 0; k < 12; k++) {
          const t = k / 12;
          const side = Math.floor(t * 4);
          const f = (t * 4) % 1;
          const lx = [-2.3 + f * 4.6, 2.3, 2.3 - f * 4.6, -2.3][side]! * sc;
          const lz = [-2.3, -2.3 + f * 4.6, 2.3, 2.3 - f * 4.6][side]! * sc;
          const v = new THREE.Vector3(lx, 2.85 - Math.sin(f * Math.PI) * 0.25, lz).applyQuaternion(q);
          bulbs.push({ m: new THREE.Matrix4().makeTranslation(x + v.x, v.y, z + v.z), c: col });
        }
      } else {
        rvs.push(new THREE.Matrix4().compose(p.set(x, 1.5, z), q, one));
        // a string of bulbs under the awning
        const col = bulbCols[Math.floor(rnd() * bulbCols.length)]!;
        for (let k = 0; k < 9; k++) {
          const v = new THREE.Vector3(-3.2 + k * 0.8, 2.3 - Math.sin((k / 8) * Math.PI) * 0.3, 2.6).applyQuaternion(q);
          bulbs.push({ m: new THREE.Matrix4().makeTranslation(x + v.x, v.y, z + v.z), c: col });
        }
      }
    }
    const shadeMesh = new THREE.InstancedMesh(shadeGeometry(), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, side: THREE.DoubleSide }), shades.length);
    shades.forEach((mm, i) => {
      shadeMesh.setMatrixAt(i, mm);
      shadeMesh.setColorAt(i, c.setHex(shadeCols[i]!));
    });
    const rvGeo = merge([new THREE.BoxGeometry(7, 2.6, 2.5), new THREE.BoxGeometry(1.6, 1.4, 2.4).translate(3.9, -0.5, 0)]);
    const rvMesh = new THREE.InstancedMesh(rvGeo, new THREE.MeshStandardMaterial({ color: 0x34303a, roughness: 0.5, metalness: 0.3 }), rvs.length);
    rvs.forEach((mm, i) => rvMesh.setMatrixAt(i, mm));
    const winGeo = new THREE.PlaneGeometry(1.4, 0.6);
    const rvWins = new THREE.InstancedMesh(winGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc080).multiplyScalar(1.6), side: THREE.DoubleSide }), rvs.length * 2);
    rvs.forEach((mm, i) => {
      for (const s of [-1, 1]) {
        m4.makeTranslation(-1 + s * 1.6, 0.4, 1.27);
        rvWins.setMatrixAt(i * 2 + (s > 0 ? 1 : 0), m4.premultiply(mm));
      }
    });
    const bulbMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.13, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffffff }), bulbs.length);
    bulbs.forEach((b, i) => {
      bulbMesh.setMatrixAt(i, b.m);
      bulbMesh.setColorAt(i, c.setHex(b.c).multiplyScalar(2.4));
    });
    this.group.add(shadeMesh, rvMesh, rvWins, bulbMesh);

    // bikes racked outside the lanterns, EL wire on their wheels
    const bikeSpots: THREE.Matrix4[] = [];
    const bikeCols: number[] = [];
    const elCols = [0x2ee6ff, 0xff3df0, 0x7dff4d, 0xffb347, 0x9a4dff];
    for (let r = 0; r < 14; r++) {
      const a = (r / 14) * Math.PI * 2 + rnd() * 0.2;
      const n = 3 + Math.floor(rnd() * 4);
      for (let k = 0; k < n; k++) {
        const aa = a + (k - n / 2) * 0.017;
        const rr = 54.5 + rnd() * 0.6;
        q.setFromAxisAngle(yAxis, -aa + (rnd() - 0.5) * 0.2);
        bikeSpots.push(new THREE.Matrix4().compose(p.set(Math.cos(aa) * rr, 0, Math.sin(aa) * rr), q, one));
        bikeCols.push(elCols[Math.floor(rnd() * elCols.length)]!);
      }
    }
    const bikes = new THREE.InstancedMesh(bikeGeometry(), new THREE.MeshBasicMaterial({ vertexColors: true }), bikeSpots.length);
    bikeSpots.forEach((mm, i) => {
      bikes.setMatrixAt(i, mm);
      bikes.setColorAt(i, c.setHex(bikeCols[i]!).multiplyScalar(2.2));
    });
    this.group.add(bikes);

    // the crowd: dancers at the sound camps, small knots of spectators at the lanterns
    const people: { x: number; z: number; yaw: number }[] = [];
    for (const s of sound) {
      for (let i = 0; i < 110; i++) {
        const a = Math.PI * 0.5 + (rnd() - 0.5) * Math.PI * 0.9;
        const rr = 4 + Math.sqrt(rnd()) * 11;
        people.push({ x: s.x + Math.cos(a) * rr, z: s.z + Math.sin(a) * rr, yaw: Math.atan2(-Math.cos(a), -Math.sin(a)) });
      }
    }
    // knots of spectators: round the burn barrels, and a few more along the lanterns
    for (let k = 0; k < BARRELS; k++) {
      const a = (k / BARRELS) * Math.PI * 2 + BARREL_A0;
      const bx = Math.cos(a) * BARREL_R;
      const bz = Math.sin(a) * BARREL_R;
      const n = 5 + Math.floor(rnd() * 4);
      for (let i = 0; i < n; i++) {
        const t = (i / n) * Math.PI * 2 + rnd() * 0.4;
        const rr = 1.7 + rnd() * 0.7;
        const x = bx + Math.cos(t) * rr;
        const z = bz + Math.sin(t) * rr;
        people.push({ x, z, yaw: Math.atan2(bx - x, bz - z) });
      }
    }
    for (let k = 0; k < 10; k++) {
      const a = ((k + 0.5) / 10) * Math.PI * 2 + rnd() * 0.2;
      const n = 3 + Math.floor(rnd() * 5);
      for (let i = 0; i < n; i++) {
        const aa = a + (rnd() - 0.5) * 0.06;
        const rr = 55.8 + rnd() * 1.8;
        const x = Math.cos(aa) * rr;
        const z = Math.sin(aa) * rr;
        people.push({ x, z, yaw: Math.atan2(-x, -z) + (rnd() - 0.5) });
      }
    }
    const crowd = new THREE.InstancedMesh(personGeometry(), this.crowdMat, people.length);
    const stickCols = [0x7dff4d, 0xff3df0, 0x2ee6ff, 0xffb347, 0xffffff];
    people.forEach((pp, i) => {
      q.setFromAxisAngle(yAxis, pp.yaw);
      crowd.setMatrixAt(i, m4.compose(p.set(pp.x, 0, pp.z), q, one));
      crowd.setColorAt(i, c.setHex(stickCols[Math.floor(rnd() * stickCols.length)]!));
    });
    this.group.add(crowd);

    // sound camps: a deck, stacks, an LED arch and searchlights stabbing the sky
    const beamCols = [0x2ee6ff, 0xff3df0, 0x9a4dff, 0xffffff];
    sound.forEach((s, si) => {
      const g = new THREE.Group();
      g.position.set(s.x, 0, s.z);
      const deck = new THREE.Mesh(new THREE.BoxGeometry(12, 1.2, 6), M.blackPlastic());
      deck.position.y = 0.6;
      g.add(deck);
      const lip = new THREE.Mesh(new THREE.BoxGeometry(12, 0.1, 0.1), neon(si ? 0xff3df0 : 0x2ee6ff, 2.6));
      lip.position.set(0, 1.22, 3);
      g.add(lip);
      const stacks: THREE.BufferGeometry[] = [];
      for (const x of [-7.5, 7.5]) for (let k = 0; k < 3; k++) stacks.push(new THREE.BoxGeometry(2.4, 1.9, 2).translate(x, 0.95 + k * 1.95, 0));
      g.add(new THREE.Mesh(merge(stacks), M.blackPlastic()));
      const cones: THREE.BufferGeometry[] = [];
      for (const x of [-7.5, 7.5]) for (let k = 0; k < 3; k++) cones.push(new THREE.CircleGeometry(0.7, 16).translate(x, 0.95 + k * 1.95, 1.01));
      g.add(new THREE.Mesh(merge(cones), M.rubber()));
      const archMat = chaseMat(this.U, si ? 0xff3df0 : 0x2ee6ff, 0xffffff, { freq: 3, speed: 1.2, base: 1.1 });
      this.archMats.push(archMat);
      for (const rr of [6, 7.2]) {
        const arch = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.16, 6, 48, Math.PI), archMat);
        arch.position.set(0, 1.2, -0.5 - (rr - 6));
        g.add(arch);
      }
      for (let k = 0; k < 3; k++) {
        const sl = searchlight(beamCols[(k + si) % beamCols.length]!);
        sl.pivot.position.set(s.x + (k - 1) * 6, 0.5, s.z - 3);
        this.group.add(sl.pivot);
        this.beams.push({ pivot: sl.pivot, mat: sl.mat, phase: k * 1.7 + si * 2.3 });
      }
      this.group.add(g);
    });
  }

  private buildDust(): THREE.ShaderMaterial {
    const n = 900;
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('uv', base.getAttribute('uv'));
    const rnd = prng(3);
    const seeds = new Float32Array(n * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = rnd();
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    geo.instanceCount = n;
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: this.U.uTime,
        uCenter: { value: new THREE.Vector2() },
        uBox: { value: new THREE.Vector3(84, 6, 64) },
        uColor: { value: new THREE.Color(0.8, 0.66, 0.56) },
      },
      vertexShader: DUST_VERT,
      fragmentShader: DUST_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 3;
    this.group.add(mesh);
    return mat;
  }

  ripple(x: number, z: number, color: THREE.Color | number, strength = 1): void {
    this.rip.add(x, z, this.U.uTime.value, color, strength);
  }

  onStep(step: number, bar: number): void {
    this.U.uStrobe.value = step % 2 === 0 ? 1 : 0;
    // the eye in the palm blinks now and then
    if (step === 0 && bar % 4 === 3) this.blink = 1;
    // the octopus fires on the downbeat (and the backbeat when the room goes off)
    if ((this.dropOn || this.finaleOn) && step % 8 === 0) this.flameT = 0.45;
    else if (step === 0 && bar % 8 === 7) this.flameT = 0.3;
  }

  onNote(inst: string, strength: number): void {
    switch (inst) {
      case 'kick':
        this.kick = Math.max(this.kick, strength);
        break;
      case 'snare':
      case 'clap':
        this.snare = Math.min(1, this.snare + strength);
        break;
      case 'bass':
      case 'organ':
      case 'pad':
        this.bass = Math.min(1, this.bass + strength * 0.7);
        break;
      case 'lead':
        this.lead = Math.min(1, this.lead + strength * 0.8);
        break;
      case 'crash':
      case 'gong':
        this.snare = 1;
        this.kick = 1;
        break;
      default:
        this.hat = Math.min(1, this.hat + strength * 0.8);
    }
  }

  finale(): void {
    this.finaleOn = true;
  }

  setBar(b: number): void {
    const u = this.floorMat.uniforms;
    u.uBar!.value = b;
    const step = Math.floor((b - Math.floor(b)) * 16);
    u.uStep!.value = step;
    this.lanternMat.uniforms.uStep!.value = step;
  }

  occlude(px: number, pz: number): void {
    // tall pieces hide the floor just "north" of them on screen: ghost them when you're there
    const behind = (o: { x: number; z: number }, w: number, depth: number): boolean => Math.abs(px - o.x) < w && pz < o.z + 1 && pz > o.z - depth;
    this.hand.fader.update(behind(HAND, 4.2, 8) ? 0.25 : 1);
    this.spiral.fader.update(behind(SPIRAL, 3.4, 8) ? 0.3 : 1);
    this.flowers.fader.update(behind(FLOWERS, 3.6, 6.5) ? 0.3 : 1);
    this.dome.fader.update(behind(DOME, DOME.r, DOME.r + 3.5) ? 0.35 : 1);
  }

  update(f: FrameInfo): void {
    const U = this.U;
    const dt = f.dt;
    const u = this.floorMat.uniforms;
    this.dropOn = f.drop;
    if (this.finaleOn) this.finaleT += dt;
    const hot = f.drop || this.finaleOn;
    const beat = Math.pow(1 - f.beatPhase, 3);
    U.uTime.value = f.time;
    U.uBeat.value = beat;
    U.uDrop.value = hot ? 1 : 0;
    U.uFinale.value = Math.min(1, this.finaleT * 0.8);
    U.uEnergy.value = f.energy;
    u.uBeat!.value = f.beatPhase;
    u.uBuild!.value = f.build;
    (u.uPlayer!.value as THREE.Vector2).set(f.playerX, f.playerZ);

    this.kick *= Math.exp(-dt * 2.6);
    this.snare *= Math.exp(-dt * 7);
    this.hat *= Math.exp(-dt * 9);
    this.bass *= Math.exp(-dt * 3);
    this.lead *= Math.exp(-dt * 4);
    u.uKick!.value = this.kick;
    u.uSnare!.value = this.snare;
    this.lanternMat.uniforms.uSnare!.value = this.snare;
    this.haloMat.uniforms.uHat!.value = this.hat;
    let low = 0;
    for (let i = 0; i < 4; i++) low += f.spectrum[i] ?? 0;
    this.level = damp(this.level, Math.min(1, low * 0.3 + this.bass * 0.4), 12, dt);
    this.totems.sleeves.uniforms.uLevel!.value = this.level;

    // installations
    this.dome.struts.uniforms.uBoost!.value = beat * 0.5 + this.kick * 0.8;
    this.dome.orb.scale.setScalar(1 + this.kick * 0.5 + beat * 0.1);
    this.dome.orbMat.color.setHex(this.finaleOn ? 0xffb347 : 0xb07aff).multiplyScalar(1.8 + this.kick * 3);
    this.dome.panels.opacity = (0.16 + beat * 0.08 + (hot ? 0.12 : 0)) * this.dome.fader.opacity;
    this.spiral.spin.rotation.y += dt * (hot ? 1.2 : 0.25);
    for (const m of this.spiral.mats) m.uniforms.uBoost!.value = beat * 0.4 + this.snare * 0.6;
    this.flowers.heads.forEach((h, i) => {
      const open = 1 + this.bass * 0.35 + beat * 0.06;
      h.scale.set(open, 1, open);
      h.rotation.y += dt * (0.2 + i * 0.05);
    });
    for (const m of this.flowers.petalMats) m.uniforms.uBoost!.value = this.bass * 1.2;
    this.totems.toppers.forEach((t, i) => {
      t.rotation.y += dt * (1 + (i % 3) * 0.4) * (hot ? 3 : 1);
      t.position.y = 9.8 + Math.sin(f.time * 2 + i) * 0.15 + beat * 0.2;
    });
    this.hand.outline.uniforms.uBoost!.value = beat * 0.4 + this.lead * 1.2;
    this.eyeFollow(f, dt);
    for (const m of this.archMats) m.uniforms.uBoost!.value = beat * 0.8;

    // light pools on the dust under the art
    const boost = hot ? 1.8 : 1;
    const pw = this.pools;
    pw[0]!.w = (0.07 + this.kick * 0.1 + beat * 0.03) * boost;
    pw[1]!.w = (0.07 + this.lead * 0.08) * boost;
    pw[2]!.w = (0.07 + this.snare * 0.06) * boost;
    pw[3]!.w = (0.06 + this.bass * 0.1) * boost;
    pw[4]!.w = pw[5]!.w = (0.05 + beat * 0.04) * boost;
    this.poolCols[0]!.setHex(this.finaleOn ? 0xffb347 : PAL[3]!);
    this.lights[0]!.intensity = 40 + this.kick * 60;
    this.lights[1]!.intensity = 50 + this.lead * 50;

    // art cars crawl round the road
    this.cars.forEach((c, i) => {
      const th = c.phase + f.time * c.speed;
      const x = Math.cos(th) * c.lane;
      const z = Math.sin(th) * c.lane;
      c.group.position.set(x, 0, z);
      c.group.rotation.y = -th - Math.PI / 2;
      this.carVecs[i]!.set(x, z, -Math.sin(th), Math.cos(th));
      for (const m of c.mats) {
        if (m.uniforms.uBoost) m.uniforms.uBoost.value = beat * 0.6;
        else if (m.uniforms.uOpacity) m.uniforms.uOpacity.value = 0.1 + beat * 0.15 + (hot ? 0.15 : 0);
      }
      if (c.spinner) c.spinner.rotation.y += dt * (hot ? 2.2 : 0.7);
      if (c.flames) {
        this.flameT = Math.max(0, this.flameT - dt);
        const fire = this.finaleOn ? 0.8 + beat * 0.4 : Math.min(1, this.flameT * 3);
        c.flames.mat.uniforms.uTime!.value = f.time;
        c.flames.mat.uniforms.uPower!.value = fire;
        for (const s of c.flames.sprites) {
          s.visible = fire > 0.02;
          if (f.camQuat) s.quaternion.copy(this.tmpQ.copy(c.group.quaternion).invert()).multiply(f.camQuat);
          s.scale.set(1, 0.4 + fire * 0.8, 1);
        }
      }
    });

    // searchlights sway, then cross and scissor in a DROP
    for (const b of this.beams) {
      const t = f.time * (hot ? 1.1 : 0.25) + b.phase;
      b.pivot.rotation.set(Math.sin(t) * 0.22, 0, Math.cos(t * 0.8) * 0.28);
      b.mat.uniforms.uTime!.value = f.time;
      b.mat.uniforms.uOpacity!.value = 0.5 + f.energy * 0.12 + beat * 0.1 + (hot ? 0.25 : 0);
    }

    // dust devils drift across the playa, fade in and out, and thin out near the performer
    this.devils.forEach((d, i) => {
      const t = f.time + d.seed * 40;
      const x = Math.sin(t * 0.031 + i * 2.1) * 30 + Math.sin(t * 0.07 + i) * 8;
      const z = Math.cos(t * 0.027 + i * 1.3) * 28;
      d.mesh.position.set(x, 0, z);
      d.mesh.rotation.y = -t * 2.2;
      d.mesh.scale.setScalar(1 - i * 0.2);
      const life = THREE.MathUtils.smoothstep(Math.sin(t * 0.045 + i * 3), -0.2, 0.6);
      const near = THREE.MathUtils.smoothstep(Math.hypot(x - f.playerX, z - f.playerZ), 3, 10);
      d.mat.uniforms.uAlpha!.value = 0.28 * life * (0.35 + 0.65 * near) * (hot ? 1.3 : 1);
    });
    // the sign: bulbs chase, the arrow flashes down the beat, the name flickers now and then
    this.sign.arrow.forEach((m, i) => m.color.setHex(0xffb347).multiplyScalar(i === Math.floor(f.time * 4) % 3 ? 3 : 0.5));
    this.sign.text.opacity = Math.random() < 0.006 ? 0.35 : 1;
    this.barrelFlame.uniforms.uTime!.value = f.time;
    this.barrelFlame.uniforms.uPower!.value = 0.75 + beat * 0.25 + (this.finaleOn ? 0.3 : 0);
    if (f.camQuat) for (const b of this.barrelSprites) b.quaternion.copy(f.camQuat);
    for (const m of this.effigyBeams) {
      m.uniforms.uTime!.value = f.time;
      m.uniforms.uOpacity!.value = 0.8 + beat * 0.2;
    }
    // the effigy: neon breathes with the music; at the finale it raises its arms and burns
    const ef = this.effigy;
    ef.neonMat.color.setHex(this.finaleOn ? 0xffc24d : 0x2ee6ff).multiplyScalar(2 + beat * 1.2);
    ef.baseMat.color.setHex(this.finaleOn ? 0xff6a1a : 0xff3df0).multiplyScalar(1.8 + beat);
    const raise = Math.min(1, this.finaleT * 0.5);
    ef.arms.forEach((a, i) => (a.rotation.z = (i ? 1 : -1) * raise * 2.3));
    const burn = Math.min(1, Math.max(0, this.finaleT - 1.5) * 0.4);
    ef.flameMat.uniforms.uTime!.value = f.time;
    ef.flameMat.uniforms.uPower!.value = burn * (0.9 + beat * 0.3);
    for (const fl of ef.flames) {
      fl.visible = burn > 0.01;
      if (f.camQuat) fl.quaternion.copy(f.camQuat);
      fl.scale.setScalar(0.6 + burn * 0.8);
    }

    this.crowdMat.uniforms.uBounce!.value = beat * (0.25 + f.energy * 0.4 + (hot ? 0.35 : 0));
    (this.dustMat.uniforms.uCenter!.value as THREE.Vector2).set(f.playerX * 0.8, f.playerZ * 0.8 - 4);
  }

  /** The eye in the hamsa's palm tracks the performer (and blinks). */
  private eyeFollow(f: FrameInfo, dt: number): void {
    const eu = this.hand.eye.uniforms;
    const dx = f.playerX - this.hand.eyeWorld.x;
    const dz = f.playerZ - this.hand.eyeWorld.z;
    const iris = eu.uIris!.value as THREE.Vector2;
    // the hand is turned a little: rotate the offset into its frame
    const yaw = this.hand.group.rotation.y;
    const lx = dx * Math.cos(yaw) - dz * Math.sin(yaw);
    const near = Math.hypot(dx, dz);
    iris.x = damp(iris.x, THREE.MathUtils.clamp(lx * 0.05, -0.62, 0.62), 6, dt);
    iris.y = damp(iris.y, THREE.MathUtils.clamp(-0.28 + Math.max(0, near - 8) * 0.012, -0.28, 0.18), 6, dt);
    this.blink = Math.max(0, this.blink - dt * 5);
    eu.uLid!.value = 1 - Math.sin(this.blink * Math.PI) * 0.95;
    eu.uGlow!.value = this.lead + Math.pow(1 - f.beatPhase, 3) * 0.3;
  }

  spawnPoint(rng: Rng, px: number, pz: number, out: { x: number; z: number }): void {
    ringSpawn(this.bounds, this.obstacles, rng, px, pz, out);
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (m instanceof THREE.ShaderMaterial) m.dispose();
          const map = (m as THREE.MeshBasicMaterial).map;
          if (map) map.dispose();
        }
      }
    });
  }
}
