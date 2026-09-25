import * as THREE from 'three';

/** Shared materials so hundreds of meshes don't each compile their own program. */
const cache = new Map<string, THREE.Material>();

function cached<T extends THREE.Material>(key: string, make: () => T): T {
  let m = cache.get(key);
  if (!m) {
    m = make();
    cache.set(key, m);
  }
  return m as T;
}

export const M = {
  chrome: (): THREE.MeshStandardMaterial =>
    cached('chrome', () => new THREE.MeshStandardMaterial({ color: 0xe6e8ee, metalness: 1, roughness: 0.16 })),
  darkChrome: (): THREE.MeshStandardMaterial =>
    cached('darkChrome', () => new THREE.MeshStandardMaterial({ color: 0x6a6e78, metalness: 1, roughness: 0.28 })),
  gold: (): THREE.MeshStandardMaterial =>
    cached('gold', () => new THREE.MeshStandardMaterial({ color: 0xffc85a, metalness: 1, roughness: 0.22 })),
  bronze: (): THREE.MeshStandardMaterial =>
    cached('bronze', () => new THREE.MeshStandardMaterial({ color: 0xd9a441, metalness: 1, roughness: 0.3 })),
  head: (): THREE.MeshStandardMaterial =>
    cached('head', () => new THREE.MeshStandardMaterial({ color: 0xf1ede2, metalness: 0, roughness: 0.75 })),
  blackPlastic: (): THREE.MeshStandardMaterial =>
    cached('blackPlastic', () => new THREE.MeshStandardMaterial({ color: 0x16161b, metalness: 0.1, roughness: 0.45 })),
  rubber: (): THREE.MeshStandardMaterial =>
    cached('rubber', () => new THREE.MeshStandardMaterial({ color: 0x0c0c0f, metalness: 0, roughness: 0.9 })),
  wood: (): THREE.MeshStandardMaterial =>
    cached('wood', () => new THREE.MeshStandardMaterial({ color: 0xc88a4a, metalness: 0, roughness: 0.55 })),
  darkWood: (): THREE.MeshStandardMaterial =>
    cached('darkWood', () => new THREE.MeshStandardMaterial({ color: 0x4a2a17, metalness: 0, roughness: 0.5 })),
  ivory: (): THREE.MeshStandardMaterial =>
    cached('ivory', () => new THREE.MeshStandardMaterial({ color: 0xf6f3ea, metalness: 0, roughness: 0.35 })),
  glove: (): THREE.MeshStandardMaterial =>
    cached('glove', () => new THREE.MeshStandardMaterial({ color: 0xfbfbf7, metalness: 0, roughness: 0.6 })),
  /** Glossy lacquered drum shell in a given colour. */
  shell: (color: number): THREE.MeshPhysicalMaterial =>
    cached(
      `shell${color}`,
      () =>
        new THREE.MeshPhysicalMaterial({
          color,
          metalness: 0.35,
          roughness: 0.32,
          clearcoat: 1,
          clearcoatRoughness: 0.08,
        }),
    ),
  glow: (color: number, intensity = 2.5): THREE.MeshStandardMaterial =>
    cached(
      `glow${color}_${intensity}`,
      () =>
        new THREE.MeshStandardMaterial({
          color: 0x000000,
          emissive: color,
          emissiveIntensity: intensity,
          metalness: 0,
          roughness: 1,
        }),
    ),
  basic: (color: number): THREE.MeshBasicMaterial =>
    cached(`basic${color}`, () => new THREE.MeshBasicMaterial({ color })),
};

/**
 * A dark club "room" rendered into a PMREM env map: chrome and lacquer pick up coloured
 * light panels instead of a flat grey studio.
 */
export function makeClubEnvironment(renderer: THREE.WebGLRenderer, colors: number[]): THREE.Texture {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07060c);
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(20, 10, 20),
    new THREE.MeshBasicMaterial({ color: 0x0b0a12, side: THREE.BackSide }),
  );
  scene.add(box);
  const panel = new THREE.PlaneGeometry(1, 1);
  colors.forEach((c, i) => {
    const a = (i / colors.length) * Math.PI * 2;
    const m = new THREE.Mesh(panel, new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
    m.scale.set(4, 2.2, 1);
    m.position.set(Math.cos(a) * 9, 2 + (i % 2) * 2, Math.sin(a) * 9);
    m.lookAt(0, 0, 0);
    scene.add(m);
  });
  // big soft key light overhead
  const top = new THREE.Mesh(panel, new THREE.MeshBasicMaterial({ color: 0xfff4e6, side: THREE.DoubleSide }));
  top.scale.set(8, 8, 1);
  top.position.set(0, 4.9, 0);
  top.rotation.x = Math.PI / 2;
  scene.add(top);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0.02);
  pmrem.dispose();
  return rt.texture;
}

/** Canvas texture helper with sane defaults for crisp UI-ish decals. */
export function canvasTexture(
  w: number,
  h: number,
  draw: (g: CanvasRenderingContext2D, w: number, h: number) => void,
  srgb = true,
): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
