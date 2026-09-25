import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { InstrumentId } from '../seq/instruments';
import { INSTRUMENTS } from '../seq/instruments';
import { canvasTexture, M } from './materials';

/**
 * Procedural instrument models. Used three ways: card art (rendered to images), the
 * floating "band" that orbits the player, and some projectiles (records, bells, notes).
 * Every model is built around the origin and roughly fits a radius-1.2 sphere.
 */

const mesh = (g: THREE.BufferGeometry, m: THREE.Material): THREE.Mesh => new THREE.Mesh(g, m);

function cyl(r: number, h: number, seg = 32, rb = r): THREE.CylinderGeometry {
  return new THREE.CylinderGeometry(r, rb, h, seg);
}

/** Cymbal: lathe profile with a bell, slightly domed bow. */
function cymbalGeometry(radius: number): THREE.LatheGeometry {
  const pts: THREE.Vector2[] = [];
  pts.push(new THREE.Vector2(0.001, 0.13 * radius));
  pts.push(new THREE.Vector2(0.14 * radius, 0.12 * radius));
  pts.push(new THREE.Vector2(0.2 * radius, 0.07 * radius));
  pts.push(new THREE.Vector2(0.26 * radius, 0.045 * radius));
  pts.push(new THREE.Vector2(radius, -0.02 * radius));
  pts.push(new THREE.Vector2(radius * 0.995, -0.035 * radius));
  pts.push(new THREE.Vector2(0.26 * radius, 0.03 * radius));
  pts.push(new THREE.Vector2(0.001, 0.11 * radius));
  return new THREE.LatheGeometry(pts, 48);
}

function lugs(group: THREE.Group, r: number, h: number, count: number, axis: 'y' | 'z'): void {
  const g = new THREE.BoxGeometry(0.07, h * 0.55, 0.1);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const l = mesh(g, M.chrome());
    if (axis === 'y') {
      l.position.set(Math.cos(a) * (r + 0.03), 0, Math.sin(a) * (r + 0.03));
      l.rotation.y = -a;
    } else {
      l.position.set(Math.cos(a) * (r + 0.03), Math.sin(a) * (r + 0.03), 0);
      l.rotation.z = a + Math.PI / 2;
      l.rotation.x = Math.PI / 2;
    }
    group.add(l);
  }
}

function drumstick(): THREE.Group {
  const g = new THREE.Group();
  const shaft = mesh(cyl(0.035, 1.5, 12, 0.045), M.wood());
  g.add(shaft);
  const tip = mesh(new THREE.SphereGeometry(0.05, 12, 8), M.wood());
  tip.position.y = 0.76;
  tip.scale.y = 1.4;
  g.add(tip);
  return g;
}

let logoTex: THREE.Texture | null = null;
function kickLogo(): THREE.Texture {
  if (logoTex) return logoTex;
  logoTex = canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = '#0d0c12';
    g.fillRect(0, 0, w, h);
    const grd = g.createRadialGradient(w / 2, h / 2, 40, w / 2, h / 2, 256);
    grd.addColorStop(0, '#2a1020');
    grd.addColorStop(1, '#0d0c12');
    g.fillStyle = grd;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#ff3b5c';
    g.lineWidth = 14;
    g.beginPath();
    g.arc(w / 2, h / 2, 190, 0, Math.PI * 2);
    g.stroke();
    g.lineWidth = 4;
    g.beginPath();
    g.arc(w / 2, h / 2, 165, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#ffe9ee';
    g.font = '900 86px Bungee, Impact, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('ENCORE', w / 2, h / 2 + 4);
  });
  return logoTex;
}

function buildKick(color: number): THREE.Group {
  const g = new THREE.Group();
  const r = 1;
  const depth = 0.8;
  const shell = mesh(cyl(r, depth, 48), M.shell(color));
  shell.rotation.x = Math.PI / 2;
  g.add(shell);
  const logo = new THREE.MeshStandardMaterial({
    map: kickLogo(),
    emissive: 0xffffff,
    emissiveMap: kickLogo(),
    emissiveIntensity: 0.55,
    roughness: 0.6,
  });
  const front = mesh(new THREE.CircleGeometry(r * 0.97, 48), logo);
  front.position.z = depth / 2 + 0.005;
  g.add(front);
  const back = mesh(new THREE.CircleGeometry(r * 0.97, 48), M.head());
  back.position.z = -depth / 2 - 0.005;
  back.rotation.y = Math.PI;
  g.add(back);
  for (const z of [-depth / 2, depth / 2]) {
    const hoop = mesh(new THREE.TorusGeometry(r * 1.0, 0.06, 12, 48), M.shell(0x16161b));
    hoop.position.z = z;
    g.add(hoop);
    const rim = mesh(new THREE.TorusGeometry(r * 1.02, 0.025, 8, 48), M.chrome());
    rim.position.z = z + (z > 0 ? 0.02 : -0.02);
    g.add(rim);
  }
  lugs(g, r, depth, 10, 'z');
  // spurs
  for (const s of [-1, 1]) {
    const spur = mesh(cyl(0.035, 0.9, 8), M.chrome());
    spur.position.set(s * 0.8, -0.85, 0.1);
    spur.rotation.z = s * 0.5;
    g.add(spur);
  }
  g.rotation.set(-0.25, 0.35, 0);
  return g;
}

function buildSnare(color: number): THREE.Group {
  const g = new THREE.Group();
  const r = 0.95;
  const h = 0.42;
  const shell = mesh(cyl(r, h, 48), M.shell(color));
  g.add(shell);
  const top = mesh(new THREE.CircleGeometry(r * 0.98, 48), M.head());
  top.rotation.x = -Math.PI / 2;
  top.position.y = h / 2 + 0.006;
  g.add(top);
  for (const y of [-h / 2, h / 2]) {
    const rim = mesh(new THREE.TorusGeometry(r, 0.04, 10, 48), M.chrome());
    rim.rotation.x = Math.PI / 2;
    rim.position.y = y;
    g.add(rim);
  }
  lugs(g, r, h, 10, 'y');
  const s1 = drumstick();
  s1.position.set(-0.2, h / 2 + 0.25, 0.1);
  s1.rotation.set(0.2, 0, -1.25);
  g.add(s1);
  const s2 = drumstick();
  s2.position.set(0.2, h / 2 + 0.3, -0.1);
  s2.rotation.set(-0.3, 0.2, 1.2);
  g.add(s2);
  g.rotation.set(0.55, 0, 0);
  return g;
}

function buildHat(color: number): THREE.Group {
  const g = new THREE.Group();
  const pole = mesh(cyl(0.035, 2.4, 12), M.chrome());
  pole.position.y = -0.6;
  g.add(pole);
  const bottom = mesh(cymbalGeometry(0.95), M.bronze());
  bottom.rotation.x = Math.PI;
  bottom.position.y = 0.35;
  g.add(bottom);
  const topC = mesh(cymbalGeometry(0.95), M.bronze());
  topC.position.y = 0.48;
  topC.rotation.z = 0.06;
  g.add(topC);
  const clutch = mesh(cyl(0.07, 0.18, 16), M.shell(color));
  clutch.position.y = 0.66;
  g.add(clutch);
  // tripod legs
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const leg = mesh(cyl(0.03, 1.1, 8), M.darkChrome());
    leg.position.set(Math.cos(a) * 0.3, -1.55, Math.sin(a) * 0.3);
    leg.rotation.set(Math.sin(a) * 0.55, 0, -Math.cos(a) * 0.55);
    g.add(leg);
  }
  g.rotation.set(0.5, 0, 0);
  g.scale.setScalar(0.95);
  return g;
}

function buildGloveHand(): THREE.Group {
  const hand = new THREE.Group();
  const palm = mesh(new THREE.CapsuleGeometry(0.34, 0.3, 6, 16), M.glove());
  palm.scale.set(1, 1, 0.55);
  hand.add(palm);
  for (let i = 0; i < 4; i++) {
    const f = mesh(new THREE.CapsuleGeometry(0.09, 0.36 - Math.abs(i - 1.5) * 0.05, 4, 10), M.glove());
    f.position.set(-0.24 + i * 0.16, 0.55, 0);
    f.rotation.z = (1.5 - i) * 0.08;
    hand.add(f);
  }
  const thumb = mesh(new THREE.CapsuleGeometry(0.1, 0.25, 4, 10), M.glove());
  thumb.position.set(0.38, 0.05, 0.05);
  thumb.rotation.z = -0.9;
  hand.add(thumb);
  const cuff = mesh(new THREE.TorusGeometry(0.3, 0.1, 10, 24), M.glove());
  cuff.rotation.x = Math.PI / 2;
  cuff.position.y = -0.42;
  cuff.scale.set(1, 0.6, 1);
  hand.add(cuff);
  // cartoon glove stitching lines
  for (const x of [-0.12, 0.0, 0.12]) {
    const line = mesh(new THREE.BoxGeometry(0.025, 0.28, 0.02), M.blackPlastic());
    line.position.set(x, 0.08, -0.19);
    hand.add(line);
  }
  return hand;
}

function buildClap(color: number): THREE.Group {
  const g = new THREE.Group();
  const l = buildGloveHand();
  l.position.set(-0.36, -0.05, 0);
  l.rotation.set(0, 0.9, 0.35);
  g.add(l);
  const r = buildGloveHand();
  r.position.set(0.36, -0.05, 0);
  r.rotation.set(0, -0.9 + Math.PI, -0.35);
  r.scale.x = -1;
  g.add(r);
  // impact sparks
  const sparkGeo = new THREE.ConeGeometry(0.06, 0.45, 6);
  for (let i = 0; i < 7; i++) {
    const a = -0.3 + (i / 6) * (Math.PI + 0.6);
    const s = mesh(sparkGeo, M.glow(color, 3));
    s.position.set(Math.cos(a) * 0.95, Math.sin(a) * 0.95 + 0.25, 0);
    s.rotation.z = a - Math.PI / 2;
    g.add(s);
  }
  return g;
}

function bassBodyShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(0, -1.05);
  s.bezierCurveTo(0.75, -1.1, 0.95, -0.55, 0.72, -0.12);
  s.bezierCurveTo(0.6, 0.1, 0.75, 0.3, 0.85, 0.72);
  s.bezierCurveTo(0.9, 0.95, 0.62, 0.98, 0.5, 0.7);
  s.bezierCurveTo(0.35, 0.42, 0.2, 0.4, 0.1, 0.45);
  s.lineTo(-0.1, 0.45);
  s.bezierCurveTo(-0.25, 0.4, -0.4, 0.5, -0.5, 0.58);
  s.bezierCurveTo(-0.62, 0.66, -0.8, 0.55, -0.72, 0.3);
  s.bezierCurveTo(-0.62, 0.05, -0.62, -0.1, -0.72, -0.25);
  s.bezierCurveTo(-0.95, -0.62, -0.72, -1.1, 0, -1.05);
  return s;
}

function buildBass(color: number): THREE.Group {
  const g = new THREE.Group();
  const body = mesh(
    new THREE.ExtrudeGeometry(bassBodyShape(), {
      depth: 0.22,
      bevelEnabled: true,
      bevelThickness: 0.05,
      bevelSize: 0.05,
      bevelSegments: 4,
      curveSegments: 24,
    }),
    M.shell(color),
  );
  body.position.z = -0.11;
  g.add(body);
  const guard = mesh(
    new THREE.ExtrudeGeometry(bassBodyShape(), { depth: 0.02, bevelEnabled: false, curveSegments: 24 }),
    M.ivory(),
  );
  guard.scale.set(0.62, 0.62, 1);
  guard.position.set(0.05, 0.05, 0.17);
  g.add(guard);
  const neck = mesh(new THREE.BoxGeometry(0.2, 2.1, 0.12), M.darkWood());
  neck.position.set(0, 1.45, 0.1);
  g.add(neck);
  const board = mesh(new THREE.BoxGeometry(0.2, 2.0, 0.03), M.blackPlastic());
  board.position.set(0, 1.45, 0.17);
  g.add(board);
  for (let i = 0; i < 12; i++) {
    const fret = mesh(new THREE.BoxGeometry(0.21, 0.015, 0.02), M.chrome());
    fret.position.set(0, 0.55 + i * 0.16, 0.19);
    g.add(fret);
  }
  const head = mesh(new THREE.BoxGeometry(0.34, 0.55, 0.08), M.shell(color));
  head.position.set(0.04, 2.72, 0.08);
  head.rotation.z = -0.08;
  g.add(head);
  for (let i = 0; i < 4; i++) {
    const t = mesh(cyl(0.05, 0.14, 10), M.chrome());
    t.rotation.x = Math.PI / 2;
    t.position.set(i < 2 ? -0.2 : 0.26, 2.55 + (i % 2) * 0.28, 0.08);
    t.rotation.z = Math.PI / 2;
    g.add(t);
  }
  for (let i = 0; i < 4; i++) {
    const s = mesh(cyl(0.008, 3.1, 4), M.chrome());
    s.position.set(-0.06 + i * 0.04, 1.05, 0.21);
    g.add(s);
  }
  for (const y of [-0.35, 0.05]) {
    const pu = mesh(new THREE.BoxGeometry(0.34, 0.14, 0.06), M.blackPlastic());
    pu.position.set(0, y, 0.2);
    g.add(pu);
  }
  g.rotation.set(0.2, 0.25, -0.75);
  g.position.set(0.35, -0.6, 0);
  const wrap = new THREE.Group();
  wrap.add(g);
  wrap.scale.setScalar(0.78);
  return wrap;
}

function buildKeys(color: number): THREE.Group {
  const g = new THREE.Group();
  const body = mesh(new THREE.BoxGeometry(2.4, 0.22, 0.95), M.blackPlastic());
  g.add(body);
  const cheek = new THREE.BoxGeometry(0.12, 0.3, 0.97);
  for (const x of [-1.24, 1.24]) {
    const c = mesh(cheek, M.darkWood());
    c.position.set(x, 0.04, 0);
    g.add(c);
  }
  const whiteGeo = new THREE.BoxGeometry(0.14, 0.08, 0.5);
  const blackGeo = new THREE.BoxGeometry(0.085, 0.09, 0.3);
  const whites = 15;
  for (let i = 0; i < whites; i++) {
    const k = mesh(whiteGeo, M.ivory());
    k.position.set(-1.05 + i * 0.15, 0.13, 0.2);
    g.add(k);
    const n = i % 7;
    if (n !== 2 && n !== 6 && i < whites - 1) {
      const b = mesh(blackGeo, M.rubber());
      b.position.set(-1.05 + i * 0.15 + 0.075, 0.18, 0.1);
      g.add(b);
    }
  }
  const panel = mesh(new THREE.BoxGeometry(2.2, 0.04, 0.34), M.darkChrome());
  panel.position.set(0, 0.12, -0.28);
  g.add(panel);
  const screen = mesh(new THREE.BoxGeometry(0.55, 0.03, 0.18), M.glow(color, 2.2));
  screen.position.set(-0.7, 0.15, -0.28);
  g.add(screen);
  const knobGeo = cyl(0.055, 0.08, 16);
  for (let i = 0; i < 6; i++) {
    const k = mesh(knobGeo, i % 3 === 0 ? M.shell(color) : M.rubber());
    k.position.set(-0.2 + i * 0.2, 0.17, -0.28);
    g.add(k);
  }
  g.rotation.set(0.65, -0.3, 0.05);
  g.scale.setScalar(0.95);
  return g;
}

function buildPads(color: number): THREE.Group {
  const g = new THREE.Group();
  const base = mesh(new THREE.BoxGeometry(1.9, 0.26, 1.9), M.blackPlastic());
  g.add(base);
  const padGeo = new THREE.BoxGeometry(0.36, 0.1, 0.36);
  const lit = [0, 5, 6, 10, 15, 3];
  for (let i = 0; i < 16; i++) {
    const x = -0.63 + (i % 4) * 0.42;
    const z = -0.63 + Math.floor(i / 4) * 0.42;
    const p = mesh(padGeo, lit.includes(i) ? M.glow(color, 2.8) : M.rubber());
    p.position.set(x, 0.17, z);
    g.add(p);
  }
  g.rotation.set(0.8, 0.5, 0);
  return g;
}

function buildCrash(color: number): THREE.Group {
  const g = new THREE.Group();
  const c = mesh(cymbalGeometry(1.25), M.bronze());
  c.rotation.set(0.55, 0, 0.15);
  g.add(c);
  const felt = mesh(cyl(0.08, 0.1, 12), M.shell(color));
  felt.position.set(0, 0.2, 0.05);
  felt.rotation.x = 0.55;
  g.add(felt);
  const boom = mesh(cyl(0.035, 1.7, 10), M.chrome());
  boom.position.set(0.1, -0.8, -0.2);
  boom.rotation.z = -0.15;
  g.add(boom);
  return g;
}

function buildTom(color: number): THREE.Group {
  const g = new THREE.Group();
  const r = 0.8;
  const h = 0.75;
  const shell = mesh(cyl(r, h, 40), M.shell(color));
  g.add(shell);
  const top = mesh(new THREE.CircleGeometry(r * 0.98, 40), M.head());
  top.rotation.x = -Math.PI / 2;
  top.position.y = h / 2 + 0.006;
  g.add(top);
  for (const y of [-h / 2, h / 2]) {
    const rim = mesh(new THREE.TorusGeometry(r, 0.035, 10, 40), M.chrome());
    rim.rotation.x = Math.PI / 2;
    rim.position.y = y;
    g.add(rim);
  }
  lugs(g, r, h, 8, 'y');
  const st = drumstick();
  st.position.set(0.1, h / 2 + 0.35, 0.3);
  st.rotation.set(0.9, 0, -1.1);
  g.add(st);
  g.rotation.set(0.6, 0, 0.2);
  return g;
}

function buildCowbell(): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.BoxGeometry(0.9, 1.4, 0.55, 1, 1, 1);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const k = y > 0 ? 0.62 : 1.0;
    pos.setX(i, pos.getX(i) * k);
    pos.setZ(i, pos.getZ(i) * k);
  }
  geo.computeVertexNormals();
  const bell = mesh(geo, M.darkChrome());
  g.add(bell);
  const mouth = mesh(new THREE.BoxGeometry(0.8, 0.02, 0.45), M.rubber());
  mouth.position.y = -0.71;
  g.add(mouth);
  const clamp = mesh(new THREE.BoxGeometry(0.3, 0.25, 0.3), M.chrome());
  clamp.position.y = 0.82;
  g.add(clamp);
  const st = drumstick();
  st.position.set(0.55, 0.3, 0.35);
  st.rotation.set(0.4, 0, 0.9);
  g.add(st);
  g.rotation.set(0.35, 0.5, -0.15);
  return g;
}

let recordTex: THREE.Texture | null = null;
function recordTexture(): THREE.Texture {
  if (recordTex) return recordTex;
  recordTex = canvasTexture(512, 512, (g, w, h) => {
    g.fillStyle = '#08080a';
    g.fillRect(0, 0, w, h);
    for (let r = 80; r < 250; r += 3) {
      g.strokeStyle = r % 2 === 0 ? '#16161c' : '#0b0b0f';
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(w / 2, h / 2, r, 0, Math.PI * 2);
      g.stroke();
    }
    const sheen = g.createLinearGradient(0, 0, w, h);
    sheen.addColorStop(0.35, 'rgba(255,255,255,0)');
    sheen.addColorStop(0.5, 'rgba(255,255,255,0.12)');
    sheen.addColorStop(0.65, 'rgba(255,255,255,0)');
    g.fillStyle = sheen;
    g.beginPath();
    g.arc(w / 2, h / 2, 250, 0, Math.PI * 2);
    g.fill();
  });
  return recordTex;
}

export function buildRecord(labelColor: number, gold = false): THREE.Group {
  const g = new THREE.Group();
  const disc = mesh(
    cyl(1, 0.04, 64),
    gold
      ? M.gold()
      : new THREE.MeshStandardMaterial({ map: recordTexture(), roughness: 0.3, metalness: 0.4, color: 0xffffff }),
  );
  g.add(disc);
  const label = mesh(cyl(0.34, 0.05, 40), M.glow(labelColor, 1.2));
  g.add(label);
  const hole = mesh(cyl(0.04, 0.06, 12), M.rubber());
  g.add(hole);
  return g;
}

function buildTurntable(color: number): THREE.Group {
  const g = new THREE.Group();
  const plinth = mesh(new THREE.BoxGeometry(2.3, 0.26, 1.8), M.darkChrome());
  g.add(plinth);
  const platter = mesh(cyl(0.8, 0.08, 48), M.chrome());
  platter.position.set(-0.3, 0.17, 0);
  g.add(platter);
  const rec = buildRecord(color);
  rec.scale.setScalar(0.76);
  rec.position.set(-0.3, 0.23, 0);
  g.add(rec);
  const armBase = mesh(cyl(0.14, 0.12, 20), M.chrome());
  armBase.position.set(0.75, 0.2, -0.55);
  g.add(armBase);
  const arm = mesh(cyl(0.025, 1.2, 8), M.chrome());
  arm.position.set(0.45, 0.3, -0.1);
  arm.rotation.set(Math.PI / 2, 0, 0.6);
  g.add(arm);
  const cart = mesh(new THREE.BoxGeometry(0.1, 0.06, 0.18), M.shell(color));
  cart.position.set(0.12, 0.29, 0.38);
  cart.rotation.y = 0.6;
  g.add(cart);
  const pitch = mesh(new THREE.BoxGeometry(0.08, 0.04, 0.6), M.glow(color, 2));
  pitch.position.set(0.9, 0.15, 0.4);
  g.add(pitch);
  g.rotation.set(0.7, -0.35, 0);
  g.scale.setScalar(0.92);
  return g;
}

function buildOrgan(color: number): THREE.Group {
  const g = new THREE.Group();
  const base = mesh(new THREE.BoxGeometry(2.3, 0.4, 0.7), M.darkWood());
  base.position.y = -0.95;
  g.add(base);
  const heights = [0.9, 1.25, 1.6, 2.0, 2.3, 2.0, 1.6, 1.25, 0.9];
  heights.forEach((h, i) => {
    const x = -1.0 + i * 0.25;
    const p = mesh(cyl(0.1, h, 20), i === 4 ? M.gold() : M.chrome());
    p.position.set(x, -0.75 + h / 2, 0);
    g.add(p);
    const mouth = mesh(new THREE.BoxGeometry(0.1, 0.12, 0.02), M.glow(color, 2.5));
    mouth.position.set(x, -0.6, 0.1);
    g.add(mouth);
    const cone = mesh(new THREE.ConeGeometry(0.1, 0.18, 20), i === 4 ? M.gold() : M.chrome());
    cone.position.set(x, -0.84, 0);
    cone.rotation.x = Math.PI;
    g.add(cone);
  });
  g.rotation.set(0.25, 0.2, 0);
  g.scale.setScalar(0.85);
  return g;
}

function buildGong(): THREE.Group {
  const g = new THREE.Group();
  const pts = [
    new THREE.Vector2(0.001, 0.08),
    new THREE.Vector2(0.3, 0.07),
    new THREE.Vector2(0.36, 0.02),
    new THREE.Vector2(0.95, 0.0),
    new THREE.Vector2(1.0, -0.12),
    new THREE.Vector2(0.97, -0.13),
    new THREE.Vector2(0.9, -0.02),
    new THREE.Vector2(0.001, 0.04),
  ];
  const disc = mesh(new THREE.LatheGeometry(pts, 56), M.gold());
  disc.rotation.x = Math.PI / 2;
  g.add(disc);
  const frameMat = M.darkWood();
  for (const x of [-1.2, 1.2]) {
    const post = mesh(new THREE.BoxGeometry(0.14, 2.6, 0.14), frameMat);
    post.position.set(x, -0.15, -0.1);
    g.add(post);
  }
  const bar = mesh(new THREE.BoxGeometry(2.7, 0.16, 0.16), frameMat);
  bar.position.set(0, 1.18, -0.1);
  g.add(bar);
  for (const x of [-0.4, 0.4]) {
    const rope = mesh(cyl(0.015, 0.25, 6), M.rubber());
    rope.position.set(x, 1.02, -0.05);
    g.add(rope);
  }
  g.rotation.set(-0.1, 0.3, 0);
  g.scale.setScalar(0.85);
  return g;
}

export function buildInstrument(id: InstrumentId): THREE.Group {
  const c = INSTRUMENTS[id].color;
  switch (id) {
    case 'kick':
      return buildKick(c);
    case 'snare':
      return buildSnare(c);
    case 'hat':
      return buildHat(c);
    case 'clap':
      return buildClap(c);
    case 'bass':
      return buildBass(c);
    case 'lead':
      return buildKeys(c);
    case 'pad':
      return buildPads(c);
    case 'crash':
      return buildCrash(c);
    case 'tom':
      return buildTom(c);
    case 'cowbell':
      return buildCowbell();
    case 'scratch':
      return buildTurntable(c);
    case 'organ':
      return buildOrgan(c);
    case 'gong':
      return buildGong();
  }
}

/* ───────────────────────── card-only props ───────────────────────── */

export function buildPedal(color: number): THREE.Group {
  const g = new THREE.Group();
  const shape = new THREE.Shape();
  const w = 0.75;
  const h = 1.15;
  const r = 0.14;
  shape.moveTo(-w + r, -h);
  shape.lineTo(w - r, -h);
  shape.quadraticCurveTo(w, -h, w, -h + r);
  shape.lineTo(w, h - r);
  shape.quadraticCurveTo(w, h, w - r, h);
  shape.lineTo(-w + r, h);
  shape.quadraticCurveTo(-w, h, -w, h - r);
  shape.lineTo(-w, -h + r);
  shape.quadraticCurveTo(-w, -h, -w + r, -h);
  const body = mesh(
    new THREE.ExtrudeGeometry(shape, {
      depth: 0.4,
      bevelEnabled: true,
      bevelSize: 0.05,
      bevelThickness: 0.05,
      bevelSegments: 3,
    }),
    M.shell(color),
  );
  body.position.z = -0.2;
  g.add(body);
  const knobGeo = cyl(0.14, 0.14, 24);
  const markGeo = new THREE.BoxGeometry(0.03, 0.02, 0.12);
  for (let i = 0; i < 3; i++) {
    const k = mesh(knobGeo, M.rubber());
    k.rotation.x = Math.PI / 2;
    k.position.set(-0.42 + i * 0.42, 0.68, 0.3);
    g.add(k);
    const mark = mesh(markGeo, M.ivory());
    mark.position.set(-0.42 + i * 0.42, 0.72, 0.38);
    mark.rotation.z = -0.6 + i * 0.6;
    g.add(mark);
  }
  const led = mesh(new THREE.SphereGeometry(0.06, 12, 8), M.glow(0xff2040, 4));
  led.position.set(0, 0.25, 0.26);
  g.add(led);
  const sw = mesh(cyl(0.2, 0.16, 24), M.chrome());
  sw.rotation.x = Math.PI / 2;
  sw.position.set(0, -0.55, 0.32);
  g.add(sw);
  const plate = mesh(new THREE.BoxGeometry(1.1, 0.02, 0.02), M.chrome());
  plate.position.set(0, -0.1, 0.26);
  g.add(plate);
  g.rotation.set(-0.55, 0.3, 0.05);
  return g;
}

function noteShape(): THREE.Shape {
  const s = new THREE.Shape();
  // eighth-note: oval head, stem, flag
  s.absellipse(-0.25, -0.65, 0.38, 0.27, 0, Math.PI * 2, false, -0.4);
  return s;
}

export function buildNote(color: number): THREE.Group {
  const g = new THREE.Group();
  const mat = M.shell(color);
  const head = mesh(
    new THREE.ExtrudeGeometry(noteShape(), { depth: 0.18, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04 }),
    mat,
  );
  g.add(head);
  const stem = mesh(new THREE.BoxGeometry(0.1, 1.45, 0.18), mat);
  stem.position.set(0.08, 0.05, 0.09);
  g.add(stem);
  const flagShape = new THREE.Shape();
  flagShape.moveTo(0.03, 0.78);
  flagShape.bezierCurveTo(0.2, 0.5, 0.7, 0.45, 0.5, -0.1);
  flagShape.bezierCurveTo(0.6, 0.3, 0.3, 0.45, 0.03, 0.45);
  const flag = mesh(
    new THREE.ExtrudeGeometry(flagShape, { depth: 0.18, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03 }),
    mat,
  );
  g.add(flag);
  const glow = mesh(new THREE.SphereGeometry(0.16, 12, 8), M.glow(color, 3));
  glow.position.set(-0.25, -0.65, 0.3);
  g.add(glow);
  g.rotation.set(-0.2, 0.35, 0.15);
  return g;
}

export function buildBolt(color: number): THREE.Group {
  const s = new THREE.Shape();
  s.moveTo(0.15, 1.1);
  s.lineTo(-0.55, -0.05);
  s.lineTo(-0.05, -0.05);
  s.lineTo(-0.25, -1.1);
  s.lineTo(0.55, 0.2);
  s.lineTo(0.05, 0.2);
  s.lineTo(0.15, 1.1);
  const g = new THREE.Group();
  g.add(
    mesh(
      new THREE.ExtrudeGeometry(s, { depth: 0.25, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.06 }),
      M.shell(color),
    ),
  );
  const core = mesh(new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: false }), M.glow(color, 3));
  core.scale.setScalar(0.6);
  core.position.z = 0.33;
  g.add(core);
  g.rotation.set(-0.2, 0.4, -0.1);
  return g;
}

export function buildChevrons(color: number): THREE.Group {
  const g = new THREE.Group();
  const s = new THREE.Shape();
  s.moveTo(-0.7, 0);
  s.lineTo(0, 0.45);
  s.lineTo(0.7, 0);
  s.lineTo(0.7, -0.25);
  s.lineTo(0, 0.2);
  s.lineTo(-0.7, -0.25);
  s.lineTo(-0.7, 0);
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.2, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04 });
  for (let i = 0; i < 3; i++) {
    const m = mesh(geo, i === 0 ? M.glow(color, 2.6) : M.shell(color));
    m.position.y = -0.55 + i * 0.5;
    g.add(m);
  }
  g.rotation.set(-0.35, 0.45, 0);
  return g;
}

/** Echo: one solid note and its repeats trailing off behind it, each fainter and smaller. */
export function buildRings(color: number): THREE.Group {
  const g = new THREE.Group();
  const lead = buildNote(color);
  g.add(lead);
  for (let i = 1; i <= 3; i++) {
    const ghost = buildNote(color);
    const fade = 0.62 - i * 0.16;
    ghost.traverse((o) => {
      if (o instanceof THREE.Mesh)
        o.material = new THREE.MeshBasicMaterial({
          color: new THREE.Color(color).multiplyScalar(1.6),
          transparent: true,
          opacity: fade,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        });
    });
    ghost.scale.setScalar(1 - i * 0.16);
    ghost.position.set(i * 0.62, i * 0.2, -i * 0.5);
    g.add(ghost);
  }
  // the sound itself: a ring rippling out from the first note
  const ring = mesh(new THREE.TorusGeometry(1.05, 0.045, 10, 56), M.glow(color, 2.6));
  ring.position.set(0.1, 0.1, -0.2);
  g.add(ring);
  g.rotation.set(-0.15, -0.35, 0.08);
  return g;
}

export function buildHeart(color: number): THREE.Group {
  const s = new THREE.Shape();
  s.moveTo(0, -0.9);
  s.bezierCurveTo(0.2, -0.6, 1.0, -0.2, 1.0, 0.3);
  s.bezierCurveTo(1.0, 0.8, 0.35, 1.0, 0, 0.55);
  s.bezierCurveTo(-0.35, 1.0, -1.0, 0.8, -1.0, 0.3);
  s.bezierCurveTo(-1.0, -0.2, -0.2, -0.6, 0, -0.9);
  const g = new THREE.Group();
  g.add(
    mesh(
      new THREE.ExtrudeGeometry(s, { depth: 0.3, bevelEnabled: true, bevelSize: 0.12, bevelThickness: 0.14, bevelSegments: 6 }),
      M.shell(color),
    ),
  );
  g.rotation.set(-0.15, 0.35, 0);
  return g;
}

export function pickShape(): THREE.Shape {
  const s = new THREE.Shape();
  s.moveTo(0, -1);
  s.bezierCurveTo(0.35, -0.6, 0.95, 0.1, 0.9, 0.55);
  s.bezierCurveTo(0.85, 0.95, -0.85, 0.95, -0.9, 0.55);
  s.bezierCurveTo(-0.95, 0.1, -0.35, -0.6, 0, -1);
  return s;
}

export function buildPicks(): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.ExtrudeGeometry(pickShape(), {
    depth: 0.08,
    bevelEnabled: true,
    bevelSize: 0.05,
    bevelThickness: 0.04,
    bevelSegments: 3,
  });
  for (let i = 0; i < 3; i++) {
    const p = mesh(geo, M.gold());
    p.position.set(-0.25 + i * 0.25, -0.1 + i * 0.12, i * 0.12);
    p.rotation.z = -0.4 + i * 0.35;
    p.scale.setScalar(0.75);
    g.add(p);
  }
  g.rotation.set(-0.4, 0.2, 0);
  return g;
}

/** Pickup meshes are merged into single geometries for instancing. */
export function pickGeometry(): THREE.BufferGeometry {
  const geo = new THREE.ExtrudeGeometry(pickShape(), {
    depth: 0.1,
    bevelEnabled: true,
    bevelSize: 0.06,
    bevelThickness: 0.05,
    bevelSegments: 2,
  });
  geo.center();
  return geo;
}

export function noteGeometry(): THREE.BufferGeometry {
  const head = new THREE.ExtrudeGeometry(noteShape(), { depth: 0.16, bevelEnabled: false });
  const stem = new THREE.BoxGeometry(0.1, 1.45, 0.16);
  stem.translate(0.08, 0.05, 0.08);
  const flagShape = new THREE.Shape();
  flagShape.moveTo(0.03, 0.78);
  flagShape.bezierCurveTo(0.2, 0.5, 0.7, 0.45, 0.5, -0.1);
  flagShape.bezierCurveTo(0.6, 0.3, 0.3, 0.45, 0.03, 0.45);
  const flag = new THREE.ExtrudeGeometry(flagShape, { depth: 0.16, bevelEnabled: false });
  // extrusions come non-indexed already; only the box needs flattening before the merge
  const flat = (g: THREE.BufferGeometry): THREE.BufferGeometry => (g.index ? g.toNonIndexed() : g);
  const merged = mergeGeometries([flat(head), flat(stem), flat(flag)])!;
  merged.center();
  merged.computeVertexNormals();
  return merged;
}

/** Touring PA stack: flight-case base, tolex cabinets with woofers + horn, metal corners. */
export function buildSpeakerStack(cabs = 3, accent = 0x2ee6ff): THREE.Group {
  const g = new THREE.Group();
  const tolex = new THREE.MeshStandardMaterial({ color: 0x151318, roughness: 0.7, metalness: 0.05 });
  const grille = new THREE.MeshStandardMaterial({ color: 0x0b0a0d, roughness: 0.95 });
  const corner = M.darkChrome();
  const caseMat = new THREE.MeshStandardMaterial({ color: 0x2b2a30, roughness: 0.45, metalness: 0.4 });
  const base = mesh(new THREE.BoxGeometry(2.6, 0.5, 1.9), caseMat);
  base.position.y = 0.25;
  g.add(base);
  for (const x of [-1.1, 1.1]) {
    const wheel = mesh(cyl(0.16, 0.12, 12), M.rubber());
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(x, 0.12, 0.8);
    g.add(wheel);
  }
  const coneGeo = new THREE.CircleGeometry(0.42, 24);
  const capGeo = new THREE.CircleGeometry(0.13, 16);
  const ringGeo = new THREE.TorusGeometry(0.44, 0.035, 6, 28);
  for (let c = 0; c < cabs; c++) {
    const y = 0.5 + 0.8 + c * 1.62;
    const cab = mesh(new THREE.BoxGeometry(2.4, 1.56, 1.7), tolex);
    cab.position.y = y;
    g.add(cab);
    const face = mesh(new THREE.PlaneGeometry(2.2, 1.38), grille);
    face.position.set(0, y, 0.851);
    g.add(face);
    for (const x of [-0.55, 0.55]) {
      const cone = mesh(coneGeo, M.rubber());
      cone.position.set(x, y - 0.12, 0.856);
      g.add(cone);
      const cap = mesh(capGeo, M.darkChrome());
      cap.position.set(x, y - 0.12, 0.858);
      g.add(cap);
      const ring = mesh(ringGeo, M.glow(accent, 1.8));
      ring.position.set(x, y - 0.12, 0.86);
      g.add(ring);
    }
    const horn = mesh(new THREE.BoxGeometry(0.9, 0.22, 0.05), M.darkChrome());
    horn.position.set(0, y + 0.52, 0.86);
    g.add(horn);
    for (const sx of [-1.18, 1.18])
      for (const sy of [-0.76, 0.76]) {
        const k = mesh(new THREE.BoxGeometry(0.14, 0.14, 1.74), corner);
        k.position.set(sx, y + sy, 0);
        g.add(k);
      }
  }
  return g;
}

/* ───────────────────────── gear / pedal props (card art) ───────────────────────── */

function labelTex(lines: string[], bg: string, fg: string, w = 512, h = 320): THREE.CanvasTexture {
  return canvasTexture(w, h, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.fillStyle = fg;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    lines.forEach((l, i) => {
      g.font = i === 0 ? `${Math.round(h * 0.26)}px Bungee, Impact, sans-serif` : `600 ${Math.round(h * 0.11)}px "Space Grotesk", sans-serif`;
      g.fillText(l, w / 2, h * (lines.length === 1 ? 0.5 : 0.36 + i * 0.3));
    });
  });
}

/** One bold word filling most of the texture height (labelTex keeps its title line small). */
function wordTex(text: string, bg: string, fg: string, w: number, h: number): THREE.CanvasTexture {
  return canvasTexture(w, h, (g) => {
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.fillStyle = fg;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `${Math.round(h * 0.6)}px Bungee, Impact, sans-serif`;
    g.fillText(text, w / 2, h * 0.54, w * 0.88);
  });
}

/** Rounded-rect slab lying flat: w along x, d along z, bottom at y=0, top at y=h. */
function roundedSlab(w: number, d: number, h: number, r: number, bevel = 0.05): THREE.ExtrudeGeometry {
  const x = w / 2 - bevel;
  const y = d / 2 - bevel;
  const s = new THREE.Shape();
  s.moveTo(-x + r, -y);
  s.lineTo(x - r, -y);
  s.quadraticCurveTo(x, -y, x, -y + r);
  s.lineTo(x, y - r);
  s.quadraticCurveTo(x, y, x - r, y);
  s.lineTo(-x + r, y);
  s.quadraticCurveTo(-x, y, -x, y - r);
  s.lineTo(-x, -y + r);
  s.quadraticCurveTo(-x, -y, -x + r, -y);
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: h - bevel * 2,
    bevelEnabled: true,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 3,
    curveSegments: 6,
  });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, bevel, 0);
  return geo;
}

/** Chicken-head knob: skirted base + pointer fin with a white index line, pointing along -z. */
function chickenHead(): THREE.Group {
  const k = new THREE.Group();
  const skirt = mesh(cyl(0.22, 0.08, 24), M.blackPlastic());
  skirt.position.y = 0.04;
  k.add(skirt);
  const s = new THREE.Shape();
  s.moveTo(0, 0.36);
  s.quadraticCurveTo(0.13, 0.08, 0.13, -0.04);
  s.absarc(0, -0.04, 0.13, 0, Math.PI, true);
  s.quadraticCurveTo(-0.13, 0.08, 0, 0.36);
  const fin = mesh(
    new THREE.ExtrudeGeometry(s, { depth: 0.14, bevelEnabled: true, bevelSize: 0.025, bevelThickness: 0.025, bevelSegments: 2 }),
    M.blackPlastic(),
  );
  fin.rotation.x = -Math.PI / 2;
  fin.position.y = 0.105;
  k.add(fin);
  const line = mesh(new THREE.BoxGeometry(0.04, 0.02, 0.3), M.ivory());
  line.position.set(0, 0.27, -0.15);
  k.add(line);
  return k;
}

/** Jagged "fuzz" waveform band in the XY plane, centred on the origin. */
function zigzagShape(w: number, amp: number, teeth: number, t: number): THREE.Shape {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= teeth * 2; i++) pts.push(new THREE.Vector2(-w / 2 + (i / (teeth * 2)) * w, i % 2 ? amp : -amp));
  const s = new THREE.Shape();
  s.moveTo(pts[0]!.x, pts[0]!.y + t);
  for (const p of pts) s.lineTo(p.x, p.y + t);
  for (const p of [...pts].reverse()) s.lineTo(p.x, p.y - t);
  return s;
}

/** Five-point star outline centred on the origin. */
function starShape(ro: number, ri: number): THREE.Shape {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i / 10) * Math.PI * 2;
    const r = i % 2 ? ri : ro;
    if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else s.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  return s;
}

/** Piano pedal outline: narrow shank widening into a round-nosed foot paddle, running +z from the origin. */
function pianoPedalGeometry(): THREE.ExtrudeGeometry {
  // outline drawn with "forward" as -y so it points down +z once laid flat
  const s = new THREE.Shape();
  s.moveTo(-0.08, 0.3);
  s.lineTo(-0.08, -0.25);
  s.quadraticCurveTo(-0.08, -0.45, -0.19, -0.6);
  s.lineTo(-0.19, -0.9);
  s.absarc(0, -0.9, 0.19, Math.PI, 0, false);
  s.lineTo(0.19, -0.6);
  s.quadraticCurveTo(0.08, -0.45, 0.08, -0.25);
  s.lineTo(0.08, 0.3);
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.06, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 3 });
  geo.rotateX(-Math.PI / 2);
  return geo;
}

/** Weave texture for amp grille cloth: warm tan basket-weave that reads on dark cards. */
function grilleTex(): THREE.CanvasTexture {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#b39a70';
    g.fillRect(0, 0, w, h);
    for (let i = -h; i < w; i += 10) {
      g.strokeStyle = '#8a7350';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(i, 0);
      g.lineTo(i + h, h);
      g.stroke();
      g.strokeStyle = '#d9c69c';
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(i + h, 0);
      g.lineTo(i, h);
      g.stroke();
    }
  });
}

/** Chunky high-top sneaker in profile: toe along +x, sole on y=0, centred on z. */
function buildSneaker(color: number): THREE.Group {
  const s = new THREE.Group();
  const upper = new THREE.Shape();
  upper.moveTo(-0.8, 0.18);
  upper.quadraticCurveTo(-0.98, 0.5, -0.9, 1.3);
  upper.lineTo(-0.32, 1.36);
  upper.quadraticCurveTo(-0.2, 1.15, -0.1, 0.95);
  upper.quadraticCurveTo(0.2, 0.62, 0.62, 0.52);
  upper.quadraticCurveTo(1.06, 0.45, 1.04, 0.18);
  upper.lineTo(-0.8, 0.18);
  const up = mesh(
    new THREE.ExtrudeGeometry(upper, {
      depth: 0.46,
      bevelEnabled: true,
      bevelSize: 0.1,
      bevelThickness: 0.12,
      bevelSegments: 4,
      curveSegments: 10,
    }),
    M.shell(color),
  );
  up.position.z = -0.23;
  s.add(up);
  // white rubber sole with a thin black tread and a red foxing stripe
  const soleShape = new THREE.Shape();
  soleShape.moveTo(-0.95, 0);
  soleShape.lineTo(1.05, 0);
  soleShape.quadraticCurveTo(1.32, 0.02, 1.26, 0.26);
  soleShape.lineTo(-0.98, 0.26);
  soleShape.quadraticCurveTo(-1.12, 0.12, -0.95, 0);
  const sole = mesh(
    new THREE.ExtrudeGeometry(soleShape, { depth: 0.64, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03, bevelSegments: 2 }),
    M.glove(),
  );
  sole.position.z = -0.32;
  s.add(sole);
  const tread = mesh(new THREE.BoxGeometry(2.1, 0.06, 0.66), M.rubber());
  tread.position.set(0.12, -0.02, 0);
  s.add(tread);
  const stripe = mesh(new THREE.BoxGeometry(1.9, 0.045, 0.72), M.shell(0xff3b5c));
  stripe.position.set(0.1, 0.15, 0);
  s.add(stripe);
  const toe = mesh(new THREE.SphereGeometry(1, 24, 16), M.glove());
  toe.scale.set(0.36, 0.2, 0.37);
  toe.position.set(0.88, 0.27, 0);
  s.add(toe);
  // white laces stepping down the instep
  const instep = new THREE.QuadraticBezierCurve(new THREE.Vector2(-0.1, 0.95), new THREE.Vector2(0.2, 0.62), new THREE.Vector2(0.62, 0.52));
  const laceGeo = new THREE.BoxGeometry(0.08, 0.05, 0.5);
  for (const t of [0.05, 0.28, 0.51, 0.74]) {
    const p = instep.getPoint(t);
    const tan = instep.getTangent(t);
    const lace = mesh(laceGeo, M.glove());
    lace.position.set(p.x - tan.y * 0.12, p.y + tan.x * 0.12, 0);
    lace.rotation.z = Math.atan2(tan.y, tan.x);
    s.add(lace);
  }
  // padded collar around a dark opening
  const hole = mesh(new THREE.CircleGeometry(1, 24), M.rubber());
  hole.rotation.x = -Math.PI / 2;
  hole.scale.set(0.28, 0.2, 1);
  hole.position.set(-0.6, 1.47, 0);
  s.add(hole);
  const collar = mesh(new THREE.TorusGeometry(0.3, 0.07, 8, 24), M.glove());
  collar.rotation.x = Math.PI / 2;
  collar.scale.set(1, 0.72, 1);
  collar.position.set(-0.6, 1.46, 0);
  s.add(collar);
  // ankle patch with a star
  const patch = mesh(new THREE.CircleGeometry(0.22, 24), M.glove());
  patch.position.set(-0.55, 0.88, 0.352);
  s.add(patch);
  const star = mesh(new THREE.ExtrudeGeometry(starShape(0.16, 0.07), { depth: 0.02, bevelEnabled: false }), M.shell(0xff3b5c));
  star.position.set(-0.55, 0.88, 0.354);
  s.add(star);
  return s;
}

export function buildGear(id: string, color: number): THREE.Group {
  const g = new THREE.Group();
  switch (id) {
    case 'fuzz': {
      // fat enamel stompbox on the floor: three chicken-heads across the back, a jagged
      // waveform decal, big chrome stomp switch, red LED, FUZZ badge, jacks + plugs
      const W = 2.0;
      const D = 1.7;
      const H = 0.55;
      g.add(mesh(roundedSlab(W, D, H, 0.2, 0.07), M.shell(color)));
      const plate = mesh(roundedSlab(W - 0.06, D - 0.06, 0.08, 0.18, 0.02), M.darkChrome());
      plate.position.y = -0.06;
      g.add(plate);
      [-0.62, 0, 0.62].forEach((x, i) => {
        const k = chickenHead();
        k.position.set(x, H, -0.48);
        k.scale.setScalar(1.15);
        k.rotation.y = 0.9 - i * 0.75;
        g.add(k);
      });
      const zig = mesh(new THREE.ExtrudeGeometry(zigzagShape(1.6, 0.13, 6, 0.05), { depth: 0.03, bevelEnabled: false }), M.glow(0xffe14d, 2.2));
      zig.rotation.x = -Math.PI / 2;
      zig.position.set(0, H + 0.002, 0.02);
      g.add(zig);
      const nut = mesh(cyl(0.22, 0.08, 6), M.chrome());
      nut.position.set(0, H + 0.04, 0.56);
      const shaft = mesh(cyl(0.11, 0.1, 16), M.chrome());
      shaft.position.set(0, H + 0.13, 0.56);
      const cap = mesh(cyl(0.21, 0.12, 28, 0.24), M.chrome());
      cap.position.set(0, H + 0.24, 0.56);
      g.add(nut, shaft, cap);
      const badge = mesh(new THREE.PlaneGeometry(0.9, 0.3), new THREE.MeshStandardMaterial({ map: wordTex('FUZZ', '#f6f3ea', '#c8102e', 300, 100), roughness: 0.4 }));
      badge.position.set(0, H * 0.5, D / 2 + 0.003);
      g.add(badge);
      const led = mesh(new THREE.SphereGeometry(0.09, 16, 10), M.glow(0xff2040, 4));
      led.position.set(0.64, H + 0.03, 0.56);
      const bezel = mesh(new THREE.TorusGeometry(0.11, 0.03, 6, 20), M.chrome());
      bezel.rotation.x = Math.PI / 2;
      bezel.position.set(0.64, H + 0.01, 0.56);
      g.add(led, bezel);
      for (const s of [-1, 1]) {
        const jack = mesh(cyl(0.13, 0.06, 6), M.chrome());
        jack.rotation.z = Math.PI / 2;
        jack.position.set(s * (W / 2 + 0.02), H * 0.5, -0.2);
        const plug = mesh(cyl(0.085, 0.22, 16), M.chrome());
        plug.rotation.z = Math.PI / 2;
        plug.position.set(s * (W / 2 + 0.13), H * 0.5, -0.2);
        g.add(jack, plug);
      }
      g.rotation.set(0.64, -0.45, 0);
      return g;
    }
    case 'metronome': {
      const geo = new THREE.CylinderGeometry(0.25, 1.0, 2.2, 4, 1);
      geo.rotateY(Math.PI / 4);
      const body = mesh(geo, M.darkWood());
      g.add(body);
      const face = mesh(new THREE.PlaneGeometry(0.6, 1.4), M.ivory());
      face.position.set(0, -0.1, 0.52);
      face.rotation.x = -0.22;
      g.add(face);
      const rod = mesh(cyl(0.03, 1.9, 8), M.chrome());
      rod.position.set(0.2, 0.1, 0.62);
      rod.rotation.z = -0.35;
      g.add(rod);
      const weight = mesh(new THREE.BoxGeometry(0.22, 0.2, 0.12), M.gold());
      weight.position.set(0.38, 0.55, 0.64);
      weight.rotation.z = -0.35;
      g.add(weight);
      g.rotation.set(0.1, 0.35, 0);
      return g;
    }
    case 'clicktrack': {
      const band = mesh(new THREE.TorusGeometry(1.0, 0.1, 12, 40, Math.PI), M.rubber());
      g.add(band);
      for (const x of [-1, 1]) {
        const cup = mesh(cyl(0.42, 0.34, 32), M.shell(color));
        cup.rotation.z = Math.PI / 2;
        cup.position.set(x, -0.1, 0);
        g.add(cup);
        const pad = mesh(new THREE.TorusGeometry(0.34, 0.1, 10, 28), M.rubber());
        pad.rotation.y = Math.PI / 2;
        pad.position.set(x * 0.8, -0.1, 0);
        g.add(pad);
        const led = mesh(new THREE.CircleGeometry(0.18, 20), M.glow(color, 3));
        led.rotation.y = x * Math.PI / 2;
        led.position.set(x * 1.18, -0.1, 0);
        g.add(led);
      }
      g.rotation.set(0.25, -0.5, 0);
      return g;
    }
    case 'wah': {
      // long low wedge base; an enamel rocker treadle hinged at the heel with its toe
      // raised ~12°, black grip pad with raised ridges, chrome rails, and the toe switch
      // visible in the gap below
      const L = 2.7;
      const Wd = 1.3;
      const wedge = new THREE.Shape();
      wedge.moveTo(-L / 2 + 0.05, 0.05);
      wedge.lineTo(L / 2 - 0.05, 0.05);
      wedge.lineTo(L / 2 - 0.05, 0.5);
      wedge.lineTo(-L / 2 + 0.05, 0.3);
      wedge.lineTo(-L / 2 + 0.05, 0.05);
      const base = mesh(
        new THREE.ExtrudeGeometry(wedge, { depth: Wd - 0.1, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 3 }),
        M.shell(color),
      );
      base.position.z = -(Wd - 0.1) / 2;
      g.add(base);
      const hingeX = -L / 2 + 0.25;
      const axle = mesh(cyl(0.08, Wd + 0.12, 16), M.chrome());
      axle.rotation.x = Math.PI / 2;
      axle.position.set(hingeX, 0.4, 0);
      g.add(axle);
      const rocker = new THREE.Group();
      rocker.position.set(hingeX, 0.42, 0);
      rocker.rotation.z = 0.21;
      g.add(rocker);
      const TL = 2.5;
      const tread = mesh(roundedSlab(TL, Wd - 0.08, 0.14, 0.12, 0.04), M.shell(color));
      tread.position.x = TL / 2 - 0.25;
      rocker.add(tread);
      const pad = mesh(roundedSlab(TL - 0.34, Wd - 0.32, 0.04, 0.08, 0.015), M.rubber());
      pad.position.set(TL / 2 - 0.25, 0.13, 0);
      rocker.add(pad);
      for (const s of [-1, 1]) {
        const rail = mesh(new THREE.BoxGeometry(TL - 0.1, 0.18, 0.05), M.chrome());
        rail.position.set(TL / 2 - 0.25, 0.04, s * (Wd / 2 - 0.02));
        rocker.add(rail);
      }
      const toePlate = mesh(new THREE.BoxGeometry(0.06, 0.18, Wd - 0.2), M.chrome());
      toePlate.position.set(TL - 0.24, 0.07, 0);
      rocker.add(toePlate);
      const ridgeGeo = new THREE.BoxGeometry(0.08, 0.06, Wd - 0.4);
      const ridgeMat = new THREE.MeshStandardMaterial({ color: 0x4a4a56, roughness: 0.45 });
      for (let i = 0; i < 7; i++) {
        const r = mesh(ridgeGeo, ridgeMat);
        r.position.set(0.12 + i * 0.3, 0.19, 0);
        rocker.add(r);
      }
      const sw = mesh(cyl(0.1, 0.24, 16), M.chrome());
      sw.position.set(L / 2 - 0.4, 0.58, 0);
      const swCap = mesh(cyl(0.13, 0.07, 16), M.rubber());
      swCap.position.set(L / 2 - 0.4, 0.72, 0);
      g.add(sw, swCap);
      for (const s of [-1, 1]) {
        const jack = mesh(cyl(0.1, 0.06, 6), M.chrome());
        jack.rotation.x = Math.PI / 2;
        jack.position.set(0.7, 0.18, s * (Wd / 2 + 0.02));
        g.add(jack);
      }
      const led = mesh(new THREE.SphereGeometry(0.06, 12, 8), M.glow(0xff2040, 4));
      led.position.set(L / 2 - 0.02, 0.2, 0);
      g.add(led);
      g.rotation.set(0.42, -0.75, 0);
      return g;
    }
    case 'looper': {
      // a loop station: wide wedge, one giant glowing "loop" arrow, a little LED counter —
      // no knob pair (two knobs over a round switch read as a face)
      const deck = mesh(new THREE.BoxGeometry(2.4, 0.5, 1.8), M.shell(color));
      deck.position.y = 0.25;
      g.add(deck);
      const top = mesh(new THREE.BoxGeometry(2.3, 0.04, 1.7), M.darkChrome());
      top.position.y = 0.52;
      g.add(top);
      const arc = mesh(new THREE.TorusGeometry(0.55, 0.09, 12, 48, Math.PI * 1.55), M.glow(0x9fb8ff, 3.5));
      arc.rotation.set(-Math.PI / 2, 0, 0.4);
      arc.position.set(-0.2, 0.58, 0.05);
      g.add(arc);
      const head = mesh(new THREE.ConeGeometry(0.2, 0.34, 3), M.glow(0x9fb8ff, 3.5));
      head.rotation.set(-Math.PI / 2, 0, -1.2);
      head.position.set(-0.2 + Math.cos(0.4) * 0.55, 0.6, 0.05 - Math.sin(0.4) * 0.55);
      g.add(head);
      const btn = mesh(cyl(0.26, 0.12, 24), M.chrome());
      btn.position.set(-0.2, 0.6, 0.05);
      g.add(btn);
      const screen = mesh(new THREE.BoxGeometry(0.62, 0.05, 0.4), M.glow(0xff3b5c, 2.2));
      screen.position.set(0.72, 0.56, -0.45);
      g.add(screen);
      g.rotation.set(0.75, -0.35, 0);
      return g;
    }
    case 'groupies': {
      const card = mesh(new THREE.BoxGeometry(1.4, 2.0, 0.05), new THREE.MeshStandardMaterial({ map: labelTex(['ALL', 'ACCESS', '★ ENCORE ★'], '#ff2d78', '#ffffff', 320, 460), roughness: 0.4 }));
      g.add(card);
      const hole = mesh(new THREE.BoxGeometry(0.4, 0.08, 0.07), M.rubber());
      hole.position.y = 0.85;
      g.add(hole);
      const lanyard = mesh(new THREE.TorusGeometry(0.9, 0.05, 6, 32, Math.PI), M.shell(0x1a1a2a));
      lanyard.position.y = 0.9;
      g.add(lanyard);
      g.rotation.set(-0.1, 0.35, 0.12);
      return g;
    }
    case 'roadie': {
      // road case: slate laminate panels framed by bright aluminium edge rails and ball
      // corners, a lid seam with butterfly latches, gaffer-tape label, glowing hi-vis band
      const W = 2.3;
      const H = 1.45;
      const D = 1.35;
      g.add(mesh(new THREE.BoxGeometry(W, H, D), new THREE.MeshStandardMaterial({ color: 0x6c7892, roughness: 0.5, metalness: 0.2 })));
      const ex = 0.09;
      for (const a of [-1, 1])
        for (const b of [-1, 1]) {
          const ew = mesh(new THREE.BoxGeometry(W, ex, ex), M.chrome());
          ew.position.set(0, (a * H) / 2, (b * D) / 2);
          const eh = mesh(new THREE.BoxGeometry(ex, H, ex), M.chrome());
          eh.position.set((a * W) / 2, 0, (b * D) / 2);
          const ed = mesh(new THREE.BoxGeometry(ex, ex, D), M.chrome());
          ed.position.set((a * W) / 2, (b * H) / 2, 0);
          g.add(ew, eh, ed);
        }
      const ballGeo = new THREE.SphereGeometry(0.13, 16, 12);
      for (const x of [-W / 2, W / 2])
        for (const y of [-H / 2, H / 2])
          for (const z of [-D / 2, D / 2]) {
            const c = mesh(ballGeo, M.chrome());
            c.position.set(x, y, z);
            g.add(c);
          }
      const seamY = H / 2 - 0.38;
      const seam = mesh(new THREE.BoxGeometry(W + 0.02, 0.06, D + 0.02), M.chrome());
      seam.position.y = seamY;
      g.add(seam);
      for (const x of [-0.65, 0.65]) {
        const dish = mesh(new THREE.BoxGeometry(0.34, 0.3, 0.04), M.darkChrome());
        dish.position.set(x, seamY, D / 2 + 0.02);
        const wing = mesh(new THREE.BoxGeometry(0.22, 0.08, 0.06), M.chrome());
        wing.position.set(x, seamY, D / 2 + 0.05);
        g.add(dish, wing);
      }
      const handleDish = mesh(new THREE.BoxGeometry(0.8, 0.03, 0.42), M.darkChrome());
      handleDish.position.y = H / 2 + 0.015;
      const handle = mesh(new THREE.TorusGeometry(0.28, 0.05, 8, 20, Math.PI), M.chrome());
      handle.position.y = H / 2 + 0.02;
      g.add(handleDish, handle);
      const tape = mesh(
        new THREE.PlaneGeometry(1.4, 0.4),
        new THREE.MeshStandardMaterial({ map: wordTex('ROADIE', '#f1ede2', '#1a1a22', 350, 100), roughness: 0.8 }),
      );
      tape.position.set(-0.1, -0.18, D / 2 + 0.005);
      tape.rotation.z = 0.04;
      g.add(tape);
      const band = mesh(new THREE.BoxGeometry(W + 0.01, 0.07, D + 0.01), M.glow(0x2ee6ff, 1.8));
      band.position.y = -H / 2 + 0.25;
      g.add(band);
      g.rotation.set(0.4, 0.5, 0);
      return g;
    }
    case 'energy': {
      const can = mesh(cyl(0.55, 2.0, 40), new THREE.MeshStandardMaterial({ map: labelTex(['VOLT', 'SUGAR FREE · MAX HYPE'], '#12301f', '#3dffc5', 512, 256), metalness: 0.7, roughness: 0.3 }));
      g.add(can);
      const top = mesh(cyl(0.5, 0.06, 40), M.chrome());
      top.position.y = 1.02;
      g.add(top);
      const bolt = buildBolt(color);
      bolt.scale.setScalar(0.35);
      bolt.position.set(0, 0, 0.6);
      bolt.rotation.set(0, 0, 0);
      g.add(bolt);
      g.rotation.set(0.25, 0.4, -0.12);
      return g;
    }
    case 'stagedive': {
      // a high-top mid-dive, nose down, trailing speed streaks over a crowd of raised hands
      const shoe = buildSneaker(color);
      shoe.rotation.z = -0.45;
      shoe.position.set(0.1, 0.35, 0);
      g.add(shoe);
      for (const [y, len] of [
        [0.3, 0.9],
        [0.75, 1.4],
        [1.2, 1.0],
      ] as const) {
        const st = mesh(new THREE.CapsuleGeometry(0.045, len, 4, 8), M.glow(0xfff1b8, 2.2));
        st.rotation.z = Math.PI / 2;
        st.position.set(-1.25 - len / 2, y, 0);
        shoe.add(st);
      }
      // the crowd: open hands fanned up underneath, ready to catch the diver
      for (const [x, y, rz, s] of [
        [-0.6, -0.95, 0.4, 0.62],
        [0.2, -0.8, 0.0, 0.7],
        [0.95, -0.95, -0.4, 0.62],
      ] as const) {
        const h = buildGloveHand();
        h.scale.setScalar(s);
        h.position.set(x, y, 0.2);
        h.rotation.set(0.25, 0, rz);
        g.add(h);
      }
      g.rotation.set(0.15, -0.35, 0);
      return g;
    }
    case 'hypeman': {
      // megaphone: glossy horn with a white band + chrome rim, pale throat lit by a glowing
      // driver, white driver housing, pistol grip, and sound arcs blasting out of the bell
      const horn = mesh(new THREE.CylinderGeometry(0.95, 0.28, 1.7, 40, 1, true), M.shell(color));
      horn.rotation.z = -Math.PI / 2;
      g.add(horn);
      const throat = mesh(
        new THREE.CylinderGeometry(0.93, 0.26, 1.68, 40, 1, true),
        new THREE.MeshStandardMaterial({ color: 0xe8e2d6, roughness: 0.55, side: THREE.BackSide }),
      );
      throat.rotation.z = -Math.PI / 2;
      g.add(throat);
      const driver = mesh(new THREE.CircleGeometry(0.27, 24), M.glow(color, 2.2));
      driver.rotation.y = Math.PI / 2;
      driver.position.x = -0.83;
      g.add(driver);
      const band = mesh(new THREE.CylinderGeometry(0.925, 0.835, 0.22, 40, 1, true), M.glove());
      band.rotation.z = -Math.PI / 2;
      band.position.x = 0.62;
      g.add(band);
      const rim = mesh(new THREE.TorusGeometry(0.95, 0.06, 10, 48), M.chrome());
      rim.rotation.y = Math.PI / 2;
      rim.position.x = 0.85;
      g.add(rim);
      const body = mesh(cyl(0.34, 0.7, 32), M.ivory());
      body.rotation.z = Math.PI / 2;
      body.position.x = -1.2;
      const cap = mesh(cyl(0.3, 0.08, 32), M.chrome());
      cap.rotation.z = Math.PI / 2;
      cap.position.x = -1.58;
      g.add(body, cap);
      const grip = mesh(new THREE.CapsuleGeometry(0.12, 0.5, 4, 12), M.rubber());
      grip.position.set(-1.05, -0.62, 0);
      grip.rotation.z = -0.25;
      const trigger = mesh(new THREE.BoxGeometry(0.1, 0.22, 0.1), M.shell(color));
      trigger.position.set(-0.84, -0.46, 0);
      g.add(grip, trigger);
      for (const r of [1.1, 1.45, 1.8]) {
        const arc = mesh(new THREE.TorusGeometry(r, 0.05, 6, 32, 1.3), M.glow(color, 2.2));
        arc.rotation.z = -0.65;
        arc.position.x = 0.2;
        g.add(arc);
      }
      g.rotation.set(0.18, -0.45, 0.08);
      return g;
    }
    case 'ampstack': {
      // half stack: head on a 4x12. Lifted tolex, tan weave grilles with white piping,
      // gold control panel with cream knobs, glowing logo, pilot jewel and amber trim
      const tolex = new THREE.MeshStandardMaterial({ color: 0x3a3544, roughness: 0.5, metalness: 0.15 });
      const cloth = new THREE.MeshStandardMaterial({ map: grilleTex(), roughness: 0.9 });
      const W = 2.3;
      const cab = mesh(new THREE.BoxGeometry(W, 2.0, 1.1), tolex);
      cab.position.y = -0.6;
      g.add(cab);
      const grille = mesh(new THREE.PlaneGeometry(W - 0.34, 1.66), cloth);
      grille.position.set(0, -0.6, 0.551);
      g.add(grille);
      const pipeH = new THREE.CylinderGeometry(0.03, 0.03, W - 0.3, 8);
      const pipeV = new THREE.CylinderGeometry(0.03, 0.03, 1.7, 8);
      for (const s of [-1, 1]) {
        const ph = mesh(pipeH, M.glove());
        ph.rotation.z = Math.PI / 2;
        ph.position.set(0, -0.6 + s * 0.84, 0.56);
        const pv = mesh(pipeV, M.glove());
        pv.position.set((s * (W - 0.32)) / 2, -0.6, 0.56);
        g.add(ph, pv);
      }
      const logo = mesh(
        new THREE.PlaneGeometry(1.0, 0.28),
        new THREE.MeshStandardMaterial({
          map: wordTex('ENCORE', '#1c1822', '#ffc85a', 360, 100),
          emissive: 0xffffff,
          emissiveMap: wordTex('ENCORE', '#000000', '#ffc85a', 360, 100),
          emissiveIntensity: 1.6,
        }),
      );
      logo.position.set(-0.4, 0.0, 0.565);
      g.add(logo);
      const head = mesh(new THREE.BoxGeometry(W, 0.8, 1.0), tolex);
      head.position.y = 0.85;
      g.add(head);
      const headCloth = mesh(new THREE.PlaneGeometry(W - 0.24, 0.26), cloth);
      headCloth.position.set(0, 0.62, 0.501);
      g.add(headCloth);
      const panel = mesh(new THREE.BoxGeometry(W - 0.2, 0.34, 0.04), M.gold());
      panel.position.set(0, 0.99, 0.51);
      g.add(panel);
      for (let i = 0; i < 6; i++) {
        const k = mesh(cyl(0.08, 0.09, 16), M.ivory());
        k.rotation.x = Math.PI / 2;
        k.position.set(-0.85 + i * 0.3, 0.99, 0.56);
        g.add(k);
      }
      const pilot = mesh(new THREE.SphereGeometry(0.08, 12, 8), M.glow(0xff2020, 4));
      pilot.position.set(0.97, 0.99, 0.55);
      g.add(pilot);
      const trimGlow = mesh(new THREE.BoxGeometry(W - 0.2, 0.04, 0.03), M.glow(0xffb13d, 2));
      trimGlow.position.set(0, 0.8, 0.52);
      g.add(trimGlow);
      const handle = mesh(new THREE.TorusGeometry(0.35, 0.06, 8, 20, Math.PI), M.rubber());
      handle.position.y = 1.25;
      g.add(handle);
      const cornerGeo = new THREE.BoxGeometry(0.16, 0.16, 0.16);
      for (const [y0, hh, dd] of [
        [-0.6, 2.0, 1.1],
        [0.85, 0.8, 1.0],
      ] as const)
        for (const x of [-W / 2, W / 2])
          for (const y of [y0 - hh / 2, y0 + hh / 2]) {
            const c = mesh(cornerGeo, M.chrome());
            c.position.set(x, y, dd / 2);
            g.add(c);
          }
      g.rotation.set(0.2, 0.45, 0);
      return g;
    }
    case 'encore': {
      const t = mesh(new THREE.BoxGeometry(2.3, 1.1, 0.05), new THREE.MeshStandardMaterial({ map: labelTex(['ENCORE', 'ADMIT ONE · AGAIN'], '#ffc53d', '#3a1d00', 512, 256), metalness: 0.6, roughness: 0.3 }));
      g.add(t);
      const star = mesh(new THREE.OctahedronGeometry(0.3), M.glow(0xfff1b8, 3));
      star.position.set(0.95, 0.4, 0.1);
      g.add(star);
      g.rotation.set(-0.35, 0.4, 0.2);
      return g;
    }
    case 'goldchain': {
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        const link = mesh(new THREE.TorusGeometry(0.16, 0.05, 8, 16), M.gold());
        link.position.set(Math.cos(a) * 0.95, Math.sin(a) * 0.95, 0);
        link.rotation.set(i % 2 ? Math.PI / 2 : 0, 0, a);
        g.add(link);
      }
      const medal = mesh(cyl(0.38, 0.08, 32), M.gold());
      medal.rotation.x = Math.PI / 2;
      medal.position.set(0, -1.25, 0.05);
      g.add(medal);
      const note = buildNote(0xffc53d);
      note.scale.setScalar(0.25);
      note.position.set(0, -1.25, 0.12);
      g.add(note);
      g.rotation.set(-0.3, 0.3, 0);
      return g;
    }
    case 'harmonizer': {
      const stem = mesh(cyl(0.08, 1.2, 12), M.chrome());
      stem.position.y = -0.9;
      g.add(stem);
      const u = mesh(new THREE.TorusGeometry(0.32, 0.08, 10, 24, Math.PI), M.chrome());
      u.rotation.z = Math.PI;
      u.position.y = -0.2;
      g.add(u);
      for (const x of [-0.32, 0.32]) {
        const prong = mesh(cyl(0.08, 1.6, 12), M.chrome());
        prong.position.set(x, 0.6, 0);
        g.add(prong);
      }
      for (let i = 0; i < 3; i++) {
        const wave = mesh(new THREE.TorusGeometry(0.7 + i * 0.35, 0.025, 6, 40, Math.PI * 0.6), M.glow(color, 2.5));
        wave.rotation.z = Math.PI * 0.2;
        wave.position.y = 0.8;
        g.add(wave);
      }
      g.rotation.set(0, 0.2, -0.2);
      return g;
    }
    case 'sustain': {
      // grand-piano pedal box: polished wood with brass trim and three brass pedals;
      // the sustain (right) pedal is held down and notes ring up out of it
      const wood = new THREE.MeshPhysicalMaterial({ color: 0x7a3a1c, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.12 });
      const box = mesh(roundedSlab(2.4, 1.0, 0.6, 0.12, 0.05), wood);
      box.position.y = -0.3;
      g.add(box);
      const trim = mesh(new THREE.BoxGeometry(2.3, 0.05, 0.05), M.gold());
      trim.position.set(0, 0.27, 0.49);
      g.add(trim);
      const slot = mesh(new THREE.BoxGeometry(1.9, 0.2, 0.02), M.darkChrome());
      slot.position.set(0, -0.02, 0.5);
      g.add(slot);
      const pedalGeo = pianoPedalGeometry();
      [-0.62, 0, 0.62].forEach((x, i) => {
        const p = mesh(pedalGeo, M.gold());
        p.position.set(x, -0.02, 0.4);
        p.rotation.x = i === 2 ? 0.24 : 0.06;
        g.add(p);
      });
      for (const [x, y, z, s] of [
        [0.95, 0.4, 1.25, 0.44],
        [1.4, 1.0, 0.95, 0.36],
        [1.0, 1.55, 0.65, 0.28],
      ] as const) {
        const n = buildNote(color);
        n.scale.setScalar(s);
        n.position.set(x, y, z);
        n.rotation.set(0, -0.3, 0.2);
        g.add(n);
      }
      g.rotation.set(0.4, -0.5, 0);
      return g;
    }
    default:
      return buildPedal(color);
  }
}
