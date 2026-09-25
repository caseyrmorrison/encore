import { formatInt } from '../core/math';
import { RARITY_COLOR } from '../seq/instruments';
import type { CardView } from './cardInfo';
import { clear, h, show } from './dom';

export interface ShopItem {
  view: CardView;
  price: number;
  sold: boolean;
}

export interface BackstageActions {
  buy(i: number): void;
  heal(): void;
  reroll(): void;
  next(): void;
}

/** Between venues: spend tips, rework the pattern in peace, then walk out to a bigger stage. */
export class BackstageScreen {
  readonly el: HTMLElement;
  private readonly title: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly tips: HTMLElement;
  private readonly shop: HTMLElement;
  private readonly healBtn: HTMLButtonElement;
  private readonly rerollBtn: HTMLButtonElement;
  private readonly nextBtn: HTMLButtonElement;
  private readonly editorSlot: HTMLElement;

  constructor(
    root: HTMLElement,
    private readonly a: BackstageActions,
  ) {
    this.title = h('div', { class: 'draft-title' });
    this.sub = h('div', { class: 'draft-sub' });
    this.tips = h('div', { class: 'tips-count' });
    this.shop = h('div', { class: 'cards shop' });
    this.healBtn = h('button', { class: 'btn', type: 'button', on: { click: () => a.heal() } });
    this.rerollBtn = h('button', { class: 'btn ghost', type: 'button', on: { click: () => a.reroll() } });
    this.nextBtn = h('button', { class: 'btn primary big', type: 'button', on: { click: () => a.next() } });
    this.editorSlot = h('div', { class: 'editor-slot' });
    this.el = h('div', { class: 'overlay backstage hidden', role: 'dialog', aria: { label: 'Backstage' } }, [
      h('div', { class: 'draft-head' }, [this.title, this.sub, this.tips]),
      this.shop,
      h('div', { class: 'draft-actions' }, [this.healBtn, this.rerollBtn, h('div', { class: 'spacer' }), this.nextBtn]),
      this.editorSlot,
    ]);
    root.append(this.el);
  }

  attachEditor(el: HTMLElement): void {
    clear(this.editorSlot);
    this.editorSlot.append(el);
  }

  open(title: string, sub: string, nextLabel: string): void {
    this.title.textContent = title;
    this.sub.textContent = sub;
    this.nextBtn.textContent = nextLabel;
    show(this.el, true);
  }

  render(items: ShopItem[], tips: number, healPrice: number, rerollPrice: number, hpFull: boolean, busy: boolean): void {
    this.tips.textContent = `${formatInt(tips)} TIPS`;
    clear(this.shop);
    items.forEach((it, i) => {
      const v = it.view;
      const afford = tips >= it.price && !it.sold && !busy;
      const card = h(
        'button',
        {
          class: `card rarity-${v.rarity}${it.sold ? ' sold' : ''}${afford ? '' : ' poor'}`,
          type: 'button',
          on: { click: () => afford && this.a.buy(i) },
        },
        [
          h('div', { class: 'card-kicker', text: v.kicker }),
          h('div', { class: 'card-art' }, [h('img', { src: v.icon, alt: '' })]),
          h('div', { class: 'card-title', text: v.title }),
          h('div', { class: 'card-body', text: v.body }),
          h('div', { class: 'card-price', text: it.sold ? 'SOLD' : `${it.price} TIPS` }),
        ],
      );
      card.style.setProperty('--accent', v.accent);
      card.style.setProperty('--rarity', RARITY_COLOR[v.rarity]);
      card.style.setProperty('--i', String(i));
      this.shop.append(card);
    });
    this.healBtn.textContent = hpFull ? 'HEALTH FULL' : `♥ WATER BREAK — ${healPrice} TIPS`;
    this.healBtn.disabled = hpFull || tips < healPrice || busy;
    this.rerollBtn.textContent = `↻ NEW STOCK — ${rerollPrice} TIPS`;
    this.rerollBtn.disabled = tips < rerollPrice || busy;
    this.nextBtn.disabled = busy;
  }

  close(): void {
    show(this.el, false);
  }

  get isOpen(): boolean {
    return !this.el.classList.contains('hidden');
  }
}
