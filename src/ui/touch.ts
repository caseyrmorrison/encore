import type { Input } from '../core/input';
import { h, show } from './dom';

/**
 * Phone / tablet controls: a floating stick wherever the left thumb lands, big DASH and
 * DROP buttons under the right thumb, and a pause button. Weapons auto-aim on touch, so
 * two thumbs are enough to play the whole game.
 */
export class TouchControls {
  readonly el: HTMLElement;
  private readonly zone: HTMLElement;
  private readonly base: HTMLElement;
  private readonly knob: HTMLElement;
  private readonly dropBtn: HTMLButtonElement;
  private pointer = -1;
  private ox = 0;
  private oy = 0;
  private readonly radius = 56;

  /** A touch-first device: coarse primary pointer, or touch with no fine pointer at all. */
  static wanted(): boolean {
    const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
    const fine = window.matchMedia?.('(any-pointer: fine)').matches ?? true;
    return coarse || (navigator.maxTouchPoints > 0 && !fine);
  }

  constructor(
    root: HTMLElement,
    private readonly input: Input,
    onPause: () => void,
  ) {
    this.base = h('div', { class: 'tstick hidden' });
    this.knob = h('div', { class: 'tknob' });
    this.base.append(this.knob);
    this.zone = h('div', { class: 'tzone' });
    const dash = h('button', { class: 'tbtn tdash', type: 'button', aria: { label: 'Dash' } }, [h('span', { text: 'DASH' })]);
    this.dropBtn = h('button', { class: 'tbtn tdrop', type: 'button', aria: { label: 'Drop' } }, [h('span', { text: 'DROP' })]);
    const pause = h('button', { class: 'tbtn tpause', type: 'button', aria: { label: 'Pause' } }, [h('span', { text: 'II' })]);
    // pointerdown, not click: a dash has to land on the beat, and click fires on release
    const press = (b: HTMLElement, fn: () => void): void => {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        b.classList.remove('hit');
        void b.offsetWidth;
        b.classList.add('hit');
        fn();
      });
    };
    press(dash, () => this.input.latch('dash'));
    press(this.dropBtn, () => this.input.latch('drop'));
    press(pause, onPause);

    this.zone.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove, { passive: true });
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);

    this.el = h('div', { class: 'touch hidden' }, [this.zone, this.base, dash, this.dropBtn, pause]);
    root.append(this.el);
  }

  setActive(on: boolean): void {
    if (!on) this.release();
    show(this.el, on);
  }

  setDropReady(ready: boolean): void {
    this.dropBtn.classList.toggle('ready', ready);
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (this.pointer !== -1) return;
    e.preventDefault();
    this.pointer = e.pointerId;
    this.ox = e.clientX;
    this.oy = e.clientY;
    this.base.style.setProperty('--x', `${e.clientX}px`);
    this.base.style.setProperty('--y', `${e.clientY}px`);
    this.knob.style.transform = 'translate(-50%, -50%)';
    show(this.base, true);
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointer) return;
    let dx = e.clientX - this.ox;
    let dy = e.clientY - this.oy;
    const d = Math.hypot(dx, dy);
    if (d > this.radius) {
      // the stick follows a thumb that drifts past the rim instead of pinning at the edge
      this.ox += (dx / d) * (d - this.radius);
      this.oy += (dy / d) * (d - this.radius);
      this.base.style.setProperty('--x', `${this.ox}px`);
      this.base.style.setProperty('--y', `${this.oy}px`);
      dx = (dx / d) * this.radius;
      dy = (dy / d) * this.radius;
    }
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    const k = Math.min(1, Math.hypot(dx, dy) / this.radius);
    const dead = k < 0.12 ? 0 : 1;
    const l = Math.hypot(dx, dy) || 1;
    this.input.external.x = (dx / l) * k * dead;
    this.input.external.y = (dy / l) * k * dead;
  };

  private readonly onUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointer) return;
    this.release();
  };

  private release(): void {
    this.pointer = -1;
    this.input.external.x = 0;
    this.input.external.y = 0;
    show(this.base, false);
  }
}
