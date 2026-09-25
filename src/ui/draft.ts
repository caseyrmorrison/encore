import type { Card } from '../seq/cards';
import { RARITY_COLOR } from '../seq/instruments';
import type { CardView } from './cardInfo';
import { clear, h, show } from './dom';

export interface DraftOptions {
  title: string;
  sub: string;
  gold: boolean;
  offers: { card: Card; view: CardView }[];
  rerolls: number;
  /** Returns true if the draft may close immediately; false if placement is required. */
  pick(index: number): void;
  reroll(): void;
  done(): void;
  hover(index: number): void;
}

/**
 * Level-up screen: three cards on top, the drum machine below. The music keeps playing
 * (slightly muffled) so you hear your edits land on the next bar.
 */
export class DraftScreen {
  readonly el: HTMLElement;
  private readonly title: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly cards: HTMLElement;
  private readonly rerollBtn: HTMLButtonElement;
  private readonly doneBtn: HTMLButtonElement;
  private readonly editorSlot: HTMLElement;
  private opts: DraftOptions | null = null;
  private readonly hint: HTMLElement;
  private picked = false;
  private cardEls: HTMLElement[] = [];

  constructor(root: HTMLElement) {
    this.title = h('div', { class: 'draft-title' });
    this.sub = h('div', { class: 'draft-sub' });
    this.cards = h('div', { class: 'cards' });
    this.rerollBtn = h('button', {
      class: 'btn ghost',
      type: 'button',
      on: { click: () => this.opts?.reroll() },
    });
    this.doneBtn = h('button', {
      class: 'btn primary',
      type: 'button',
      text: 'BACK TO THE SHOW ▸',
      on: { click: () => this.finish() },
    });
    this.editorSlot = h('div', { class: 'editor-slot' });
    this.hint = h('div', { class: 'draft-hint' }, [
      h('span', { class: 'for-keys' }, ['PRESS ', h('b', { text: '1' }), h('b', { text: '2' }), h('b', { text: '3' }), ' OR CLICK A CARD']),
      h('span', { class: 'for-touch', text: 'TAP A CARD' }),
    ]);
    this.el = h('div', { class: 'overlay draft hidden', role: 'dialog', aria: { modal: 'true', label: 'Level up' } }, [
      h('div', { class: 'draft-head' }, [this.title, this.sub]),
      this.cards,
      h('div', { class: 'draft-actions' }, [this.rerollBtn, h('div', { class: 'spacer' }), this.hint, this.doneBtn]),
      this.editorSlot,
    ]);
    root.append(this.el);
  }

  attachEditor(el: HTMLElement): void {
    clear(this.editorSlot);
    this.editorSlot.append(el);
  }

  get isOpen(): boolean {
    return !this.el.classList.contains('hidden');
  }

  get hasPicked(): boolean {
    return this.picked;
  }

  open(o: DraftOptions): void {
    this.opts = o;
    this.picked = false;
    this.title.textContent = o.title;
    this.sub.textContent = o.sub;
    this.el.classList.toggle('gold', o.gold);
    this.renderCards();
    this.setDoneState(false, 'PICK A CARD');
    show(this.el, true);
  }

  refreshOffers(offers: DraftOptions['offers'], rerolls: number): void {
    if (!this.opts) return;
    this.opts.offers = offers;
    this.opts.rerolls = rerolls;
    this.renderCards();
  }

  private renderCards(): void {
    const o = this.opts!;
    clear(this.cards);
    this.cardEls = o.offers.map(({ view }, i) => {
      const card = h(
        'button',
        {
          class: `card rarity-${view.rarity}`,
          type: 'button',
          aria: { label: `${view.title}: ${view.body}` },
          on: {
            click: () => this.pick(i),
            mouseenter: () => o.hover(i),
          },
        },
        [
          h('div', { class: 'card-key', text: String(i + 1) }),
          h('div', { class: 'card-rarity', text: view.rarity }),
          h('div', { class: 'card-kicker', text: view.kicker }),
          h('div', { class: 'card-art' }, [h('img', { src: view.icon, alt: '' })]),
          h('div', { class: 'card-title', text: view.title }),
          h('div', { class: 'card-body', text: view.body }),
          h('div', { class: 'card-tag', text: view.tag }),
        ],
      );
      card.style.setProperty('--accent', view.accent);
      card.style.setProperty('--rarity', RARITY_COLOR[view.rarity]);
      card.style.setProperty('--i', String(i));
      return card;
    });
    this.cards.append(...this.cardEls);
    this.rerollBtn.textContent = `↻ REROLL (${o.rerolls})`;
    this.rerollBtn.append(h('span', { class: 'hotkey', text: 'R' }));
    this.rerollBtn.disabled = o.rerolls <= 0 || this.picked;
  }

  pick(i: number): void {
    if (this.picked || !this.opts || !this.opts.offers[i]) return;
    this.picked = true;
    this.cardEls.forEach((c, k) => {
      c.classList.toggle('chosen', k === i);
      c.classList.toggle('discarded', k !== i);
      (c as HTMLButtonElement).disabled = true;
    });
    this.rerollBtn.disabled = true;
    this.opts.pick(i);
  }

  /** The rendered art of an offered card (the pick flies from here into the machine). */
  artOf(i: number): HTMLImageElement | null {
    return this.cardEls[i]?.querySelector('.card-art img') ?? null;
  }

  /** The game tells us whether placement is still pending. */
  setDoneState(ready: boolean, label?: string): void {
    this.doneBtn.disabled = !ready;
    this.doneBtn.textContent = label ?? 'BACK TO THE SHOW ▸';
    // before a pick there is no button, just the instruction
    show(this.doneBtn, ready);
    show(this.hint, !ready);
  }

  finish(): void {
    if (!this.picked || this.doneBtn.disabled) return;
    this.opts?.done();
  }

  close(): void {
    show(this.el, false);
    this.opts = null;
  }
}
