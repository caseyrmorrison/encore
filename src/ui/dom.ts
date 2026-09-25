/**
 * Tiny DOM builder. Text is only ever set through textContent — the lint config forbids
 * innerHTML entirely — so nothing from saves or URLs can become markup.
 */
type Attrs = {
  class?: string;
  id?: string;
  style?: Partial<CSSStyleDeclaration>;
  title?: string;
  text?: string;
  src?: string;
  alt?: string;
  type?: string;
  role?: string;
  tabIndex?: number;
  aria?: Record<string, string>;
  data?: Record<string, string>;
  on?: Partial<Record<keyof HTMLElementEventMap, (e: Event) => void>>;
};

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: (Node | string | null | undefined | false)[] = [],
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs.class) el.className = attrs.class;
  if (attrs.id) el.id = attrs.id;
  if (attrs.title) el.title = attrs.title;
  if (attrs.text !== undefined) el.textContent = attrs.text;
  if (attrs.role) el.setAttribute('role', attrs.role);
  if (attrs.tabIndex !== undefined) el.tabIndex = attrs.tabIndex;
  if (attrs.style) Object.assign(el.style, attrs.style);
  if (attrs.src && el instanceof HTMLImageElement && isSafeImageSrc(attrs.src)) el.src = attrs.src;
  if (attrs.alt !== undefined && el instanceof HTMLImageElement) el.alt = attrs.alt;
  if (attrs.type && el instanceof HTMLButtonElement) el.type = attrs.type as 'button';
  if (attrs.aria) for (const [k, v] of Object.entries(attrs.aria)) el.setAttribute(`aria-${k}`, v);
  if (attrs.data) for (const [k, v] of Object.entries(attrs.data)) el.dataset[k] = v;
  if (attrs.on) for (const [k, fn] of Object.entries(attrs.on)) if (fn) el.addEventListener(k, fn);
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function show(el: HTMLElement, on: boolean): void {
  el.classList.toggle('hidden', !on);
}

/** Only our own rendered PNG data URLs and same-origin relative paths (never protocol-relative). */
export function isSafeImageSrc(src: string): boolean {
  return /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(src) || /^\.?\/(?!\/)[\w./-]+$/.test(src);
}

/**
 * The tour at a glance: six stops, the clubs then the festivals, with the ones already
 * headlined ticked and the current one pulsing.
 */
export function tourStrip(names: readonly string[], festivalFrom: number, current: number, done: number): HTMLElement {
  const el = h('div', { class: 'tour-strip' });
  names.forEach((n, i) => {
    if (i === festivalFrom) el.append(h('span', { class: 'tour-gap', text: 'FESTIVAL SEASON' }));
    const state = i < done ? ' done' : i === current ? ' now' : '';
    el.append(h('span', { class: `tour-stop${i >= festivalFrom ? ' fest' : ''}${state}`, text: (i < done ? '✓ ' : '') + n }));
  });
  return el;
}
