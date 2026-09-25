/**
 * Keyboard + mouse + gamepad input. Edge-triggered actions are latched until consumed so
 * a quick tap between frames is never lost (important for on-beat dashes).
 */
export type Action = 'dash' | 'drop' | 'pause' | 'confirm' | 'pick1' | 'pick2' | 'pick3' | 'reroll' | 'mute';

const KEY_ACTIONS: Record<string, Action> = {
  Space: 'dash',
  ShiftLeft: 'dash',
  ShiftRight: 'dash',
  KeyQ: 'drop',
  KeyE: 'drop',
  Escape: 'pause',
  KeyP: 'pause',
  Enter: 'confirm',
  Digit1: 'pick1',
  Digit2: 'pick2',
  Digit3: 'pick3',
  KeyR: 'reroll',
  KeyM: 'mute',
};

export class Input {
  private readonly down = new Set<string>();
  private readonly latched = new Map<Action, number>();
  mouseX = window.innerWidth / 2;
  mouseY = window.innerHeight / 2;
  mouseDown = false;
  /** true once the mouse has moved — before that we auto-aim */
  mouseActive = false;
  private lastMouseMove = 0;
  gamepadAim: { x: number; z: number } | null = null;
  private padPrev: boolean[] = [];
  /** performance.now() timestamp of the most recent dash press — used for beat judging. */
  dashPressedAt = 0;

  constructor(target: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => this.down.clear());
    target.addEventListener('pointermove', this.onMove);
    target.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', () => (this.mouseDown = false));
    target.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    this.down.add(e.code);
    const a = KEY_ACTIONS[e.code];
    if (a) {
      this.latch(a);
      if (e.code === 'Space') e.preventDefault();
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.down.delete(e.code);
  };

  private onMove = (e: PointerEvent): void => {
    this.mouseX = e.clientX;
    this.mouseY = e.clientY;
    this.mouseActive = true;
    this.lastMouseMove = performance.now();
  };

  private onPointerDown = (e: PointerEvent): void => {
    this.mouseX = e.clientX;
    this.mouseY = e.clientY;
    if (e.button === 0) this.mouseDown = true;
    if (e.button === 2) this.latch('drop');
  };

  latch(a: Action): void {
    this.latched.set(a, performance.now());
    if (a === 'dash') this.dashPressedAt = performance.now();
  }

  /** Consume an edge-triggered action. */
  take(a: Action): boolean {
    if (!this.latched.has(a)) return false;
    this.latched.delete(a);
    return true;
  }

  clearLatched(): void {
    this.latched.clear();
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  /** Movement vector in screen space (x right, y down), normalised. */
  move(): { x: number; y: number } {
    let x = 0;
    let y = 0;
    if (this.down.has('KeyW') || this.down.has('ArrowUp')) y -= 1;
    if (this.down.has('KeyS') || this.down.has('ArrowDown')) y += 1;
    if (this.down.has('KeyA') || this.down.has('ArrowLeft')) x -= 1;
    if (this.down.has('KeyD') || this.down.has('ArrowRight')) x += 1;
    const pad = this.pollPad();
    if (pad) {
      x += pad.lx;
      y += pad.ly;
    }
    const l = Math.hypot(x, y);
    if (l > 1) {
      x /= l;
      y /= l;
    }
    return { x, y };
  }

  private pollPad(): { lx: number; ly: number } | null {
    const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
    const p = pads && pads[0];
    if (!p) return null;
    const dz = (v: number): number => (Math.abs(v) < 0.18 ? 0 : v);
    const lx = dz(p.axes[0] ?? 0);
    const ly = dz(p.axes[1] ?? 0);
    const rx = dz(p.axes[2] ?? 0);
    const ry = dz(p.axes[3] ?? 0);
    this.gamepadAim = Math.hypot(rx, ry) > 0.3 ? { x: rx, z: ry } : null;
    const map: [number, Action][] = [
      [0, 'dash'],
      [5, 'dash'],
      [1, 'drop'],
      [4, 'drop'],
      [9, 'pause'],
      [2, 'reroll'],
    ];
    for (const [i, a] of map) {
      const pressed = !!p.buttons[i]?.pressed;
      if (pressed && !this.padPrev[i]) this.latch(a);
      this.padPrev[i] = pressed;
    }
    return { lx, ly };
  }

  get mouseRecentlyMoved(): boolean {
    return performance.now() - this.lastMouseMove < 4000;
  }
}
