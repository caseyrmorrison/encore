import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * The Hush — creatures of silence. Matte black velvet with a coloured sheen, glowing
 * eyes computed in the shader, and a squash-and-stretch dance driven by the beat.
 * One instanced draw call per enemy type.
 */

export type HushKind = 'mote' | 'mute' | 'static' | 'damper' | 'shusher' | 'bouncer' | 'wisp';

export interface HushLook {
  geometry: THREE.BufferGeometry;
  eyeY: number;
  eyeSep: number;
  eyeSize: number;
  /** 0 two eyes, 1 visor band, 2 cyclops, 3 slits */
  eyeStyle: number;
  squash: number;
  glitch: number;
  /** eye colour: danger reads at a glance (white fodder, amber dampers, red bouncers…) */
  eye?: number;
  /** 0..1 how much the little legs/arms walk and the body waddles */
  walk?: number;
  /** a pursed "shh" mouth under the eyes */
  mouth?: boolean;
}

/**
 * Body-part ids baked into a per-vertex attribute so the shader can animate limbs:
 * the whole horde walks with a single draw call per type.
 */
export const PART = { body: 0, footL: 1, footR: 2, armL: 3, armR: 4, glow: 6 } as const;

/** Tag every vertex of a geometry with a body-part id. */
export function tagPart<T extends THREE.BufferGeometry>(g: T, part: number): T {
  const n = g.getAttribute('position').count;
  g.setAttribute('part', new THREE.BufferAttribute(new Float32Array(n).fill(part), 1));
  return g;
}

const VERT = /* glsl */ `
#ifdef USE_INSTANCING
attribute vec4 aState; // flash, seed, freeze, elite
attribute float aBeat;
attribute vec2 aLook;  // direction to the player in the eye plane
#else
uniform vec4 uState;
uniform float uBeatU;
#endif
attribute float part;
uniform float uTime;
uniform float uSquash;
uniform float uGlitch;
uniform float uWalk;
varying vec3 vN;
varying vec3 vObj;
varying vec3 vView;
varying vec4 vState;
varying float vWorldY;
varying float vPart;
varying vec2 vLook;
varying float vBeat;
void main() {
#ifdef USE_INSTANCING
  vState = aState;
  float pulse = aBeat;
  mat4 im = instanceMatrix;
  vLook = aLook;
#else
  vState = uState;
  float pulse = uBeatU;
  mat4 im = mat4(1.0);
  vLook = vec2(0.0);
#endif
  vPart = part;
  vBeat = pulse;
  vec3 p = position;
  // a waddling walk: feet step, arms swing, the body rolls — frozen or stunned Hush stand still
  float walk = uWalk * (1.0 - vState.z);
  float ph = uTime * 9.0 + vState.y * 40.0;
  float sw = sin(ph);
  if (part > 0.5 && part < 2.5) {
    float sg = part < 1.5 ? 1.0 : -1.0;
    p.z += sw * sg * 0.16 * walk;
    p.y += max(0.0, sw * sg) * 0.14 * walk;
  } else if (part > 2.5 && part < 4.5) {
    float sg = part < 3.5 ? -1.0 : 1.0;
    p.z += sw * sg * 0.12 * walk;
    p.y += abs(sw) * 0.04 * walk;
  }
  float roll = sw * 0.08 * walk;
  p.xy = vec2(p.x * cos(roll) - p.y * sin(roll), p.x * sin(roll) + p.y * cos(roll));
  p.y += abs(sw) * 0.05 * walk;
  p.y *= 1.0 + pulse * uSquash;
  p.xz *= 1.0 - pulse * uSquash * 0.45;
  // a hit squashes them flat for a frame or two (vState.x is the hit flash)
  p.y *= 1.0 - vState.x * 0.22;
  p.xz *= 1.0 + vState.x * 0.16;
  if (uGlitch > 0.0) {
    float g = step(0.86, fract(uTime * 3.1 + vState.y * 17.0));
    p.x += g * sin(p.y * 40.0 + uTime * 90.0) * 0.12 * uGlitch;
    p.z += g * cos(p.y * 31.0 + uTime * 70.0) * 0.08 * uGlitch;
  }
  vObj = position;
  vec4 wp = modelMatrix * im * vec4(p, 1.0);
  vN = normalize(mat3(modelMatrix) * mat3(im) * normal);
  vView = normalize(cameraPosition - wp.xyz);
  vWorldY = wp.y;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = /* glsl */ `
uniform vec3 uRim;
uniform vec3 uFloor;
uniform vec3 uEye;
uniform vec4 uEyeParams; // y, sep, size, style
uniform float uTime;
uniform vec2 uRimShape; // power, strength
uniform vec3 uCamDir;   // world direction toward the camera
uniform float uVoid;
uniform float uKick;    // 0..1, peaks on each beat
uniform float uMouth;
uniform vec3 uAcc;      // glowing accessory colour (per venue)
varying vec3 vN;
varying vec3 vObj;
varying vec3 vView;
varying vec4 vState;
varying float vWorldY;
varying float vPart;
varying vec2 vLook;
varying float vBeat;

float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }

void main() {
  vec3 n = normalize(vN);
  float ndv = max(dot(n, vView), 0.0);
  float fres = pow(1.0 - ndv, uRimShape.x);
  float top = max(n.y, 0.0);
  float bottom = max(-n.y, 0.0);
  // velvet: near-black albedo, fibres that catch the light as the body breathes, and a
  // sheen that drifts in hue around the silhouette (a little oil-slick on black silk)
  float fibre = hash(floor(vObj * 70.0)) * 0.012;
  float nap = pow(hash(floor(vObj * 140.0 + floor(uTime * 2.0))), 18.0) * 0.08 * fres;
  vec3 col = vec3(0.006, 0.004, 0.012) + fibre + nap;
  float hueShift = dot(n, vec3(0.6, 0.2, -0.7)) * 0.5 + 0.5;
  vec3 sheen = mix(uRim, uRim.gbr * 1.1, hueShift * 0.35);
  col += sheen * fres * uRimShape.y;
  col += vec3(0.012, 0.01, 0.02) * pow(top, 6.0);
  col += uFloor * bottom * 0.3 * smoothstep(1.0, 0.0, vWorldY);
  // a cold white-violet edge that thumps on the beat: the horde stays legible on black floors
  col += vec3(0.55, 0.5, 0.95) * pow(1.0 - ndv, 3.2) * (0.1 + uKick * 0.22);
  // a void (the Hush itself) swallows even its own fibres: only the rim and eyes survive
  col *= 1.0 - uVoid;
  col += uRim * fres * uRimShape.y * uVoid;

  // eyes are painted on whichever side of the head faces the camera (sprite-style), so the
  // high top-down camera always sees a face; masked to the head band in object space
  float y = uEyeParams.x;
  float sep = uEyeParams.y;
  float sz = uEyeParams.z;
  float style = uEyeParams.w;
  vec3 f = normalize(uCamDir);
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), f));
  vec3 upv = cross(f, right);
  vec2 e = vec2(dot(n, right), dot(n, upv) - 0.08);
  float headBand = smoothstep(0.45, 0.2, abs(vObj.y - y));
  float front = smoothstep(0.2, 0.55, dot(n, f)) * headBand;
  float blink = step(0.965, fract(uTime * 0.23 + vState.y * 7.3));
  float eye = 0.0;
  float pupil = 0.0;
  float mouth = 0.0;
  float esep = sep * 1.7;
  float esz = 0.22;
  if (style < 0.5) {
    // slanted, narrowed eyes: menace instead of cute
    float squint = mix(1.7, 7.0, blink);
    vec2 a1 = e - vec2(esep, 0.0);
    vec2 a2 = e + vec2(esep, 0.0);
    float cs = cos(0.42), sn = sin(0.42);
    a1 = vec2(cs * a1.x - sn * a1.y, sn * a1.x + cs * a1.y);
    a2 = vec2(cs * a2.x + sn * a2.y, -sn * a2.x + cs * a2.y);
    float d1 = length(a1 * vec2(1.0, squint));
    float d2 = length(a2 * vec2(1.0, squint));
    eye = smoothstep(esz, esz * 0.6, min(d1, d2));
    // pupils that follow the performer across the floor (the whole horde is watching you)
    vec2 lk = vLook * 0.1;
    float p1 = length(e - vec2(-esep, 0.0) - lk);
    float p2 = length(e - vec2(esep, 0.0) - lk);
    pupil = smoothstep(0.085, 0.06, min(p1, p2)) * (1.0 - blink);
    // a little round "shh" under the eyes that swells on the beat
    if (uMouth > 0.5) {
      float m = length((e - vec2(0.0, -0.26)) * vec2(1.0, 1.25));
      float r = 0.07 + vBeat * 0.035;
      mouth = smoothstep(r + 0.02, r, m) - smoothstep(r - 0.018, r - 0.04, m);
    }
  } else if (style < 1.5) {
    float band = smoothstep(0.1, 0.05, abs(e.y)) * step(abs(e.x), 0.55);
    float glint = smoothstep(0.06, 0.0, abs(e.x - 0.2 + sin(uTime * 2.0 + vState.y * 9.0) * 0.3));
    eye = band * (0.55 + glint * 1.5);
  } else if (style < 2.5) {
    float d = length(e * vec2(1.0, mix(1.0, 8.0, blink)));
    eye = smoothstep(0.24, 0.19, d);
    pupil = smoothstep(0.1, 0.07, length(e - vLook * 0.1)) * (1.0 - blink);
  } else if (style < 3.5) {
    // narrow slits
    float slit = smoothstep(0.05, 0.02, abs(e.y)) * smoothstep(0.1, 0.06, abs(abs(e.x) - esep));
    eye = slit;
  } else if (style < 4.5) {
    // slits + a round, open, singing mouth
    float slit = smoothstep(0.045, 0.02, abs(e.y - 0.08)) * smoothstep(0.09, 0.05, abs(abs(e.x) - esep));
    float m = length((e - vec2(0.0, -0.2)) * vec2(1.0, 0.8));
    float mouth = smoothstep(0.13, 0.1, m) - smoothstep(0.07, 0.05, m) * 0.6;
    eye = max(slit, mouth * (0.7 + 0.3 * sin(uTime * 9.0)));
  } else {
    // thin crescents, like a smile that isn't one
    vec2 c1 = e - vec2(esep, 0.0);
    vec2 c2 = e + vec2(esep, 0.0);
    float r1 = length(c1 * vec2(1.0, 1.5));
    float r2 = length(c2 * vec2(1.0, 1.5));
    float cr1 = smoothstep(esz, esz * 0.8, r1) * (1.0 - smoothstep(esz * 0.8, esz * 0.6, length((c1 - vec2(0.0, 0.05)) * vec2(1.0, 1.5))));
    float cr2 = smoothstep(esz, esz * 0.8, r2) * (1.0 - smoothstep(esz * 0.8, esz * 0.6, length((c2 - vec2(0.0, 0.05)) * vec2(1.0, 1.5))));
    eye = max(cr1, cr2);
  }
  eye *= front;
  pupil *= front * eye;
  mouth *= front;
  vec3 eyeCol = mix(uEye, vec3(1.0, 0.25, 0.3), vState.w);
  // the eyes are the only bright pixels on a Hush; a hit makes them blaze
  col = mix(col, eyeCol * (1.9 + vState.x * 3.0), clamp(eye, 0.0, 1.0));
  // dark pupil with a pin of light in it
  col = mix(col, vec3(0.02, 0.01, 0.04), clamp(pupil, 0.0, 1.0) * 0.92);
  col += vec3(1.2) * pupil * smoothstep(0.024, 0.0, length(e - vLook * 0.1 - vec2(-0.025, 0.025) - vec2(sign(e.x) * esep, 0.0)));
  col = mix(col, eyeCol * 1.2, clamp(mouth, 0.0, 1.0) * 0.85);
  // glowing accessories (headphone cups, goggles, glowsticks…) in the venue's colour
  float acc = step(5.5, vPart);
  col = mix(col, uAcc * (1.4 + uKick * 1.2), acc * (1.0 - uVoid));

  // frozen: icy crust
  col = mix(col, vec3(0.45, 0.8, 1.3) * (0.5 + fres), vState.z * 0.75);
  // elite: molten gold sheen
  col += vec3(1.4, 0.8, 0.2) * pow(1.0 - ndv, 9.0) * vState.w * 1.6;
  // hit flash
  // hit flash: the velvet edge catches fire, the body barely lifts
  col += vec3(2.6, 2.4, 2.6) * pow(1.0 - ndv, 2.5) * vState.x;
  col += vec3(0.08) * vState.x;
  gl_FragColor = vec4(col, 1.0);
}`;

export function makeHushMaterial(look: HushLook, rim: THREE.Color, floor: THREE.Color): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTime: { value: 0 },
      uSquash: { value: look.squash },
      uGlitch: { value: look.glitch },
      uRim: { value: rim.clone() },
      uFloor: { value: floor.clone() },
      uEye: { value: new THREE.Color(look.eye ?? 0xf4f1ff) },
      uKick: { value: 0 },
      uWalk: { value: look.walk ?? 0 },
      uMouth: { value: look.mouth ? 1 : 0 },
      uAcc: { value: new THREE.Color(0xff2dd4) },
      uEyeParams: { value: new THREE.Vector4(look.eyeY, look.eyeSep, look.eyeSize, look.eyeStyle) },
      uState: { value: new THREE.Vector4(0, 0.5, 0, 0) },
      uRimShape: { value: new THREE.Vector2(4.5, 0.6) },
      uCamDir: { value: new THREE.Vector3(0, 0.83, 0.56) },
      uBeatU: { value: 0 },
      uVoid: { value: 0 },
    },
  });
}

function lathe(points: [number, number][], seg = 28): THREE.LatheGeometry {
  return new THREE.LatheGeometry(
    points.map(([r, y]) => new THREE.Vector2(r, y)),
    seg,
  );
}

function prep(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  if (!ng.getAttribute('part')) tagPart(ng, PART.body);
  // keep only attributes every part shares so merges line up
  for (const name of Object.keys(ng.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'part') ng.deleteAttribute(name);
  return ng;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const m = mergeGeometries(parts.map(prep))!;
  m.computeBoundingSphere();
  return m;
}

export function hushLooks(): Record<HushKind, HushLook> {
  // Mote: a round little shusher — soft squashed ball with a curled tuft (reads best from above)

  // Mute: hooded robe on a lathe, a cowl pulled forward
  const robe = lathe([
    [0.001, 0],
    [0.62, 0.02],
    [0.66, 0.12],
    [0.5, 0.7],
    [0.36, 1.2],
    [0.4, 1.45],
    [0.38, 1.75],
    [0.22, 2.02],
    [0.001, 2.08],
  ]);
  const shoulders = new THREE.SphereGeometry(0.46, 20, 14);
  shoulders.scale(1.15, 0.5, 0.9);
  shoulders.translate(0, 1.18, 0);

  // Static: jagged crystal cluster
  const shards: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 4; i++) {
    const b = new THREE.OctahedronGeometry(0.42 - i * 0.05, 0);
    b.scale(0.8, 1.5, 0.8);
    b.rotateY(i * 1.3);
    b.rotateZ((i - 1.5) * 0.35);
    b.translate((i - 1.5) * 0.18, 0.85 + (i % 2) * 0.12, (i % 2 ? 0.1 : -0.1));
    shards.push(b);
  }

  // Damper: a heavy muffler disc with baffles
  const damperBody = new THREE.CylinderGeometry(0.85, 0.95, 0.55, 28);
  damperBody.translate(0, 0.4, 0);
  const baffle1 = new THREE.TorusGeometry(0.72, 0.08, 10, 28);
  baffle1.rotateX(Math.PI / 2);
  baffle1.translate(0, 0.72, 0);
  const baffle2 = new THREE.TorusGeometry(0.46, 0.07, 10, 24);
  baffle2.rotateX(Math.PI / 2);
  baffle2.translate(0, 0.85, 0);
  const dome = new THREE.SphereGeometry(0.34, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.translate(0, 0.72, 0);

  // Shusher: gangly, big head, finger raised to the lips
  const sBody = new THREE.CapsuleGeometry(0.28, 0.9, 6, 14);
  sBody.translate(0, 0.75, 0);
  const sFeet = ([-0.14, 0.14] as const).map((x) => {
    const f = new THREE.SphereGeometry(0.12, 10, 8);
    f.scale(1, 0.55, 1.5);
    f.translate(x, 0.07, 0.05);
    return tagPart(f, x < 0 ? PART.footL : PART.footR);
  });
  const sHead = new THREE.SphereGeometry(0.42, 22, 16);
  sHead.translate(0, 1.62, 0);
  const finger = new THREE.CapsuleGeometry(0.06, 0.34, 4, 8);
  finger.translate(0, 1.5, 0.42);
  const arm = new THREE.CapsuleGeometry(0.08, 0.5, 4, 8);
  arm.rotateX(-1.1);
  arm.translate(0.05, 1.18, 0.3);

  // Bouncer: a barrel-chested doorman with a tiny head, arms folded across the chest.
  // All rounded forms: boxes read as unfinished geometry under the velvet shader.
  const torso = new THREE.SphereGeometry(0.82, 26, 18);
  torso.scale(1.05, 1.0, 0.72);
  torso.translate(0, 1.12, 0);
  const traps = new THREE.CapsuleGeometry(0.3, 1.0, 6, 14);
  traps.rotateZ(Math.PI / 2);
  traps.translate(0, 1.7, -0.05);
  const head = new THREE.SphereGeometry(0.34, 20, 14);
  head.scale(1, 1.05, 1);
  head.translate(0, 2.08, 0.04);
  const armL = new THREE.CapsuleGeometry(0.2, 0.95, 5, 12);
  armL.rotateZ(Math.PI / 2 - 0.32);
  armL.translate(0, 1.18, 0.56);
  const armR = new THREE.CapsuleGeometry(0.19, 0.95, 5, 12);
  armR.rotateZ(Math.PI / 2 + 0.32);
  armR.translate(0, 1.26, 0.6);
  const legs: THREE.BufferGeometry[] = [];
  for (const x of [-0.34, 0.34]) {
    const leg = new THREE.CapsuleGeometry(0.22, 0.34, 4, 10);
    leg.translate(x, 0.4, 0);
    legs.push(tagPart(leg, x < 0 ? PART.footL : PART.footR));
  }

  // Wisp: a tiny darting spark of silence (boss adds)
  const wisp = new THREE.IcosahedronGeometry(0.35, 1);
  wisp.translate(0, 0.6, 0);

  return {
    mote: { geometry: moteVariant('basement'), eyeY: 0.64, eyeSep: 0.17, eyeSize: 0.13, eyeStyle: 0, squash: 0.16, glitch: 0, eye: 0xf4f1ff, walk: 1, mouth: true },
    mute: { geometry: merge([robe, shoulders]), eyeY: 1.66, eyeSep: 0.18, eyeSize: 0.075, eyeStyle: 3, squash: 0.08, glitch: 0, eye: 0xc9a8ff, walk: 0.35 },
    static: { geometry: merge(shards), eyeY: 1.0, eyeSep: 0, eyeSize: 0.22, eyeStyle: 2, squash: 0.05, glitch: 1, eye: 0x7ff4ff },
    damper: {
      geometry: merge([damperBody, baffle1, baffle2, dome]),
      eyeY: 0.45,
      eyeSep: 0.32,
      eyeSize: 0.13,
      eyeStyle: 0,
      squash: 0.1,
      glitch: 0,
      eye: 0xffb13d,
    },
    shusher: {
      geometry: merge([sBody, sHead, finger, arm, ...sFeet]),
      eyeY: 1.74,
      eyeSep: 0.17,
      eyeSize: 0.13,
      eyeStyle: 0,
      squash: 0.1,
      glitch: 0,
      eye: 0xff7ad0,
      walk: 0.8,
      mouth: true,
    },
    bouncer: {
      geometry: merge([torso, traps, head, armL, armR, ...legs]),
      eyeY: 2.1,
      eyeSep: 0.16,
      eyeSize: 0.09,
      eyeStyle: 1,
      squash: 0.06,
      glitch: 0,
      eye: 0xff4a4a,
      walk: 0.6,
    },
    wisp: { geometry: merge([wisp]), eyeY: 0.66, eyeSep: 0.13, eyeSize: 0.1, eyeStyle: 0, squash: 0.25, glitch: 0.4, eye: 0xffffff },
  };
}

/**
 * The fodder dresses for the room: tufted blobs in the Basement, little hooded choristers in
 * the Cathedral, headphone-wearing ravers on the Mainstage. Silhouettes only (the velvet stays
 * black), and all readable from the high camera.
 */
export function moteVariant(venue: string): THREE.BufferGeometry {
  const body = new THREE.SphereGeometry(0.5, 28, 20);
  body.scale(1, 0.9, 1);
  body.translate(0, 0.52, 0);
  // stubby feet and little arms: the whole horde waddles in time
  const limbs: THREE.BufferGeometry[] = [];
  ([
    [-0.2, PART.footL],
    [0.2, PART.footR],
  ] as const).forEach(([x, part]) => {
    const foot = new THREE.SphereGeometry(0.15, 12, 8);
    foot.scale(1, 0.55, 1.35);
    foot.translate(x, 0.07, 0.04);
    limbs.push(tagPart(foot, part));
  });
  ([
    [-0.5, PART.armL],
    [0.5, PART.armR],
  ] as const).forEach(([x, part]) => {
    const arm = new THREE.CapsuleGeometry(0.07, 0.2, 4, 8);
    arm.rotateZ(x < 0 ? 0.5 : -0.5);
    arm.translate(x, 0.45, 0.05);
    limbs.push(tagPart(arm, part));
  });
  const parts: THREE.BufferGeometry[] = [body, ...limbs];
  switch (venue) {
    case 'cathedral': {
      const hood = new THREE.ConeGeometry(0.34, 0.62, 18);
      hood.rotateX(-0.25);
      hood.translate(0, 1.06, -0.08);
      const hem = new THREE.CylinderGeometry(0.46, 0.62, 0.22, 24, 1, true);
      hem.translate(0, 0.16, 0);
      parts.push(hood, hem);
      break;
    }
    case 'mainstage': {
      const band = new THREE.TorusGeometry(0.5, 0.055, 8, 20, Math.PI);
      band.translate(0, 0.56, 0);
      parts.push(band);
      for (const x of [-0.5, 0.5]) {
        const cup = new THREE.CylinderGeometry(0.17, 0.17, 0.14, 16);
        cup.rotateZ(Math.PI / 2);
        cup.translate(x, 0.59, 0);
        parts.push(tagPart(cup, PART.glow));
      }
      break;
    }
    case 'fields': {
      // a crown of glowing wildflowers
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        const f = new THREE.SphereGeometry(0.075, 8, 6);
        f.translate(Math.cos(a) * 0.36, 0.92, Math.sin(a) * 0.36);
        parts.push(tagPart(f, PART.glow));
      }
      const ring = new THREE.TorusGeometry(0.36, 0.035, 6, 20);
      ring.rotateX(Math.PI / 2);
      ring.translate(0, 0.9, 0);
      parts.push(ring);
      break;
    }
    case 'desert': {
      // dust goggles pushed up on the forehead, lenses glowing
      const strap = new THREE.TorusGeometry(0.47, 0.04, 6, 24);
      strap.rotateX(Math.PI / 2 - 0.35);
      strap.translate(0, 0.78, 0);
      parts.push(strap);
      for (const x of [-0.16, 0.16]) {
        const lens = new THREE.CylinderGeometry(0.12, 0.12, 0.08, 14);
        lens.rotateX(Math.PI / 2 - 0.5);
        lens.translate(x, 0.86, 0.36);
        parts.push(tagPart(lens, PART.glow));
      }
      break;
    }
    case 'megafest': {
      // a glowstick held high, swinging with the arm
      const stick = new THREE.CapsuleGeometry(0.045, 0.42, 4, 8);
      stick.translate(0.56, 0.78, 0.05);
      parts.push(tagPart(stick, PART.glow));
      const visor = new THREE.TorusGeometry(0.49, 0.045, 6, 24, Math.PI);
      visor.rotateX(Math.PI / 2);
      visor.rotateY(Math.PI);
      visor.translate(0, 0.66, 0.02);
      parts.push(tagPart(visor, PART.glow));
      break;
    }
    default: {
      const tuft = new THREE.ConeGeometry(0.11, 0.34, 10);
      tuft.rotateZ(-0.6);
      tuft.translate(0.1, 1.02, 0);
      parts.push(tuft);
    }
  }
  return merge(parts);
}

/** Glowing accessory colour per venue (headphones, flowers, goggles, glowsticks). */
export const ACCESSORY_COLOR: Record<string, number> = {
  basement: 0xff2d78,
  cathedral: 0xffd36b,
  mainstage: 0xff2dd4,
  fields: 0xffe14d,
  desert: 0x2ee6ff,
  megafest: 0x8cff5a,
};

/** Instanced renderer for one enemy type. */
export class HushBatch {
  readonly mesh: THREE.InstancedMesh;
  readonly material: THREE.ShaderMaterial;
  private readonly state: THREE.InstancedBufferAttribute;
  private readonly beat: THREE.InstancedBufferAttribute;
  private readonly look: THREE.InstancedBufferAttribute;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly p = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private n = 0;

  constructor(look: HushLook, capacity: number, rim: THREE.Color, floor: THREE.Color) {
    this.material = makeHushMaterial(look, rim, floor);
    const geo = look.geometry.clone();
    this.state = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(
      THREE.DynamicDrawUsage,
    );
    this.beat = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage);
    this.look = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 2), 2).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aState', this.state);
    geo.setAttribute('aBeat', this.beat);
    geo.setAttribute('aLook', this.look);
    this.mesh = new THREE.InstancedMesh(geo, this.material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  /** Swap the silhouette (per venue); the instanced state buffers carry over. */
  setGeometry(g: THREE.BufferGeometry): void {
    const geo = g.clone();
    geo.setAttribute('aState', this.state);
    geo.setAttribute('aBeat', this.beat);
    geo.setAttribute('aLook', this.look);
    const old = this.mesh.geometry;
    this.mesh.geometry = geo;
    old.dispose();
  }

  begin(): void {
    this.n = 0;
  }

  push(
    x: number,
    y: number,
    z: number,
    yaw: number,
    scale: number,
    flash: number,
    seed: number,
    freeze: number,
    elite: number,
    beat: number,
    lookX = 0,
    lookY = 0,
  ): void {
    if (this.n >= this.mesh.instanceMatrix.count) return;
    this.q.setFromAxisAngle(this.up, yaw);
    this.s.setScalar(scale);
    this.p.set(x, y, z);
    this.m.compose(this.p, this.q, this.s);
    this.mesh.setMatrixAt(this.n, this.m);
    const o = this.n * 4;
    const a = this.state.array as Float32Array;
    a[o] = flash;
    a[o + 1] = seed;
    a[o + 2] = freeze;
    a[o + 3] = elite;
    (this.beat.array as Float32Array)[this.n] = beat;
    const l = this.look.array as Float32Array;
    l[this.n * 2] = lookX;
    l[this.n * 2 + 1] = lookY;
    this.n++;
  }

  end(time: number, kick = 0): void {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.state.needsUpdate = true;
    this.beat.needsUpdate = true;
    this.look.needsUpdate = true;
    this.material.uniforms.uTime!.value = time;
    this.material.uniforms.uKick!.value = kick;
  }

  setAccessory(color: number): void {
    (this.material.uniforms.uAcc!.value as THREE.Color).setHex(color);
  }

  setColors(rim: THREE.Color, floor: THREE.Color): void {
    (this.material.uniforms.uRim!.value as THREE.Color).copy(rim);
    (this.material.uniforms.uFloor!.value as THREE.Color).copy(floor);
  }
}
