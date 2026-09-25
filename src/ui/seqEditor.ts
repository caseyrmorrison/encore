import { GROOVES, GROOVE_IDS, type GrooveId, type GrooveState } from '../seq/grooves';
import { INSTRUMENTS } from '../seq/instruments';
import { STEPS, type FxKind, type Pattern } from '../seq/pattern';
import type { IconFactory } from '../render/icons';
import { clear, h } from './dom';

export type EditMode = { kind: 'free' } | { kind: 'fx'; fx: FxKind };

const FX_GLYPH: Record<FxKind, string> = { accent: '⚡', ratchet: '×2', echo: '◎' };

/** "Tap" on touch screens, "Click" everywhere else. */
const verb = (): string => (document.documentElement.classList.contains('touch') ? 'Tap' : 'Click');

export interface EditorEvents {
  placed(trackIndex: number, step: number): void;
  lifted(trackIndex: number, step: number): void;
  denied(): void;
  fxPlaced(step: number, fx: FxKind): void;
}

/**
 * The drum machine. A TR-style grid you edit live while the music keeps playing, so every
 * change is heard on the next bar.
 */
export class SeqEditor {
  readonly el: HTMLElement;
  private readonly grid: HTMLElement;
  private readonly grooveList: HTMLElement;
  private grooveCount!: HTMLElement;
  private readonly hint: HTMLElement;
  private cells: HTMLElement[][] = [];
  private heads: HTMLElement[] = [];
  private rows: HTMLElement[] = [];
  private spareEls: HTMLElement[] = [];
  private mode: EditMode = { kind: 'free' };
  private lastPlayhead = -1;
  private lastVersion = -1;
  focusTrack = -1;

  constructor(
    private readonly pattern: Pattern,
    private readonly icons: IconFactory,
    private readonly events: EditorEvents,
    private readonly getGrooves: () => GrooveState,
    private readonly discovered: () => ReadonlySet<GrooveId>,
  ) {
    this.hint = h('div', { class: 'seq-hint' });
    this.grid = h('div', { class: 'seq-grid' });
    this.grooveList = h('div', { class: 'groove-list' });
    this.el = h('div', { class: 'seq' }, [
      h('div', { class: 'seq-machine' }, [
        h('div', { class: 'seq-brand' }, [
          h('span', { class: 'seq-logo', text: 'ENCORE' }),
          h('span', { class: 'seq-model', text: 'TR-∞ RHYTHM COMPOSER' }),
          this.hint,
        ]),
        this.grid,
      ]),
      h('div', { class: 'groove-panel' }, [
        h('div', { class: 'panel-title' }, ['GROOVES ', (this.grooveCount = h('span', { class: 'groove-count' }))]),
        this.grooveList,
      ]),
    ]);
    this.rebuild();
  }

  setMode(m: EditMode): void {
    this.mode = m;
    this.el.classList.toggle('fx-mode', m.kind === 'fx');
    this.refresh();
  }

  rebuild(): void {
    clear(this.grid);
    this.cells = [];
    this.rows = [];
    this.spareEls = [];
    this.heads = [];
    const headRow = h('div', { class: 'seq-row seq-head' }, [h('div', { class: 'seq-label' })]);
    for (let s = 0; s < STEPS; s++) {
      const head = h('button', {
        class: `seq-step-head${s % 4 === 0 ? ' beat' : ''}`,
        type: 'button',
        aria: { label: `Step ${s + 1}` },
        on: { click: () => this.clickHead(s) },
      });
      head.append(h('span', { class: 'step-num', text: String(s + 1) }), h('span', { class: 'step-fx' }));
      this.heads.push(head);
      headRow.append(head);
    }
    this.grid.append(headRow);
    this.pattern.tracks.forEach((t, ti) => {
      const d = INSTRUMENTS[t.inst];
      const spare = h('span', { class: 'spare' });
      this.spareEls.push(spare);
      const label = h('div', { class: 'seq-label' }, [
        h('img', { class: 'seq-icon', src: this.icons.instrument(t.inst), alt: '' }),
        h('div', { class: 'seq-name' }, [
          h('span', { class: 'seq-short', text: d.short, style: { color: d.css } }),
          h('span', { class: 'seq-lv', text: t.evolved ? d.evolution.name : `LV ${t.level}` }),
        ]),
        spare,
      ]);
      const row = h('div', { class: 'seq-row' }, [label]);
      row.style.setProperty('--c', d.css);
      const rowCells: HTMLElement[] = [];
      for (let s = 0; s < STEPS; s++) {
        const cell = h('button', {
          class: `seq-cell${s % 4 === 0 ? ' beat' : ''}`,
          type: 'button',
          aria: { label: `${d.name} step ${s + 1}` },
          on: { click: () => this.clickCell(ti, s) },
        });
        rowCells.push(cell);
        row.append(cell);
      }
      this.cells.push(rowCells);
      this.rows.push(row);
      this.grid.append(row);
    });
    this.lastVersion = -1;
    this.el.classList.toggle('compact', this.pattern.tracks.length >= 5);
    this.el.classList.toggle('tiny', this.pattern.tracks.length >= 7);
    this.refresh();
  }

  private clickHead(step: number): void {
    if (this.mode.kind === 'fx') {
      if (this.pattern.applyFx(step, this.mode.fx)) this.events.fxPlaced(step, this.mode.fx);
      else this.events.denied();
    }
    this.refresh();
  }

  private clickCell(ti: number, step: number): void {
    if (this.mode.kind === 'fx') {
      this.clickHead(step);
      return;
    }
    const r = this.pattern.toggle(ti, step);
    if (r === 'placed') this.events.placed(ti, step);
    else if (r === 'lifted') this.events.lifted(ti, step);
    else this.events.denied();
    this.refresh();
  }

  refresh(): void {
    if (this.rows.length !== this.pattern.tracks.length) {
      this.rebuild();
      return;
    }
    const p = this.pattern;
    this.lastVersion = p.version;
    const grooves = this.getGrooves();
    p.tracks.forEach((t, ti) => {
      const row = this.rows[ti]!;
      row.classList.toggle('focus', ti === this.focusTrack || t.spare > 0);
      row.classList.toggle('clave', grooves.claveTracks.has(t.inst));
      row.classList.toggle('poly', grooves.polyTracks.has(t.inst));
      const spare = this.spareEls[ti]!;
      spare.textContent = t.spare > 0 ? `+${t.spare}` : '';
      spare.classList.toggle('has', t.spare > 0);
      for (let s = 0; s < STEPS; s++) {
        const c = this.cells[ti]![s]!;
        c.classList.toggle('on', t.notes[s]!);
        c.classList.toggle('placeable', !t.notes[s] && t.spare > 0);
      }
    });
    for (let s = 0; s < STEPS; s++) {
      const f = p.fx[s]!;
      const head = this.heads[s]!;
      const fxEl = head.querySelector('.step-fx')!;
      const parts: string[] = [];
      if (f.accent) parts.push(FX_GLYPH.accent);
      if (f.ratchet > 1) parts.push(`×${f.ratchet}`);
      if (f.echo) parts.push(FX_GLYPH.echo);
      fxEl.textContent = parts.join(' ');
      head.classList.toggle('has-fx', parts.length > 0);
      head.classList.toggle('chord', p.tracksOnStep(s) >= 2);
      const can = this.mode.kind === 'fx' && p.canApplyFx(s, this.mode.fx);
      head.classList.toggle('targetable', can);
      if (this.mode.kind === 'fx') fxEl.setAttribute('data-ghost', FX_GLYPH[this.mode.fx]);
      for (const row of this.cells) row[s]!.classList.toggle('fx-target', can);
    }
    const spareTotal = p.tracks.reduce((a, t) => a + t.spare, 0);
    if (this.mode.kind === 'fx') {
      this.hint.textContent = `▶ ${verb()} a step to add ${this.mode.fx.toUpperCase()}`;
    } else if (spareTotal > 0) {
      this.hint.textContent = `▶ ${spareTotal} note${spareTotal > 1 ? 's' : ''} to place — ${verb().toLowerCase()} empty steps`;
    } else {
      this.hint.textContent = `${verb()} a lit step to lift it, then place it elsewhere`;
    }
    this.el.classList.toggle('placing', spareTotal > 0);
    this.renderGrooves(grooves);
  }

  private renderGrooves(g: GrooveState): void {
    clear(this.grooveList);
    const disc = this.discovered();
    // what's live and what you know float to the top; riddles sink (the panel scrolls)
    const rank = (id: GrooveId): number => (g.active.has(id) ? 0 : disc.has(id) ? 1 : 2);
    const ids = [...GROOVE_IDS].sort((a, b) => rank(a) - rank(b));
    this.grooveCount.textContent = `${disc.size}/${GROOVE_IDS.length}`;
    for (const id of ids) {
      const d = GROOVES[id];
      const known = disc.has(id);
      const on = g.active.has(id);
      const el = h('div', { class: `groove${on ? ' on' : ''}${known ? '' : ' unknown'}` }, [
        h('div', { class: 'groove-top' }, [
          h('span', { class: 'groove-genre', text: known ? d.genre : '???' }),
          h('span', { class: 'groove-name', text: known ? d.name : '' }),
        ]),
        h('div', { class: 'groove-body', text: known ? `${d.recipe} — ${d.bonus}` : `“${d.riddle}”` }),
      ]);
      el.style.setProperty('--g', d.color);
      this.grooveList.append(el);
    }
  }

  /**
   * A picked card lands: its art flies from the card into the machine (a row's icon, or the
   * logo for pedals and step FX) and that row flashes as it arrives.
   */
  land(from: HTMLImageElement, trackIndex: number, onLand: () => void): void {
    const row = trackIndex >= 0 ? this.rows[trackIndex] : undefined;
    const target = (row?.querySelector('.seq-icon') as HTMLElement | null) ?? (this.el.querySelector('.seq-logo') as HTMLElement | null);
    const src = from.currentSrc || from.src;
    if (!target || !src) return onLand();
    const a = from.getBoundingClientRect();
    const b = target.getBoundingClientRect();
    const fly = h('img', { class: 'fly-art', src, alt: '' });
    fly.style.left = `${a.left}px`;
    fly.style.top = `${a.top}px`;
    fly.style.width = `${a.width}px`;
    fly.style.height = `${a.height}px`;
    document.body.append(fly);
    const dx = b.left + b.width / 2 - (a.left + a.width / 2);
    const dy = b.top + b.height / 2 - (a.top + a.height / 2);
    const k = Math.max(0.2, b.width / Math.max(1, a.width));
    const anim = fly.animate(
      [
        { transform: 'translate(0, 0) scale(1) rotate(0deg)', opacity: 1 },
        { transform: `translate(${dx * 0.35}px, ${dy * 0.35 - 60}px) scale(1.15) rotate(-8deg)`, opacity: 1, offset: 0.35 },
        { transform: `translate(${dx}px, ${dy}px) scale(${k}) rotate(0deg)`, opacity: 0.9 },
      ],
      { duration: 520, easing: 'cubic-bezier(0.55, 0, 0.8, 0.3)' },
    );
    anim.onfinish = () => {
      fly.remove();
      const flash = row ?? (this.el.querySelector('.seq-machine') as HTMLElement | null);
      if (flash) {
        flash.classList.remove('landed');
        void flash.offsetWidth;
        flash.classList.add('landed');
      }
      onLand();
    };
  }

  /** Called every frame while visible: moves the running light. */
  tick(step: number): void {
    if (this.pattern.version !== this.lastVersion) this.refresh();
    if (step === this.lastPlayhead) return;
    if (this.lastPlayhead >= 0) {
      this.heads[this.lastPlayhead]?.classList.remove('play');
      for (const r of this.cells) r[this.lastPlayhead]?.classList.remove('play');
    }
    this.lastPlayhead = step;
    this.heads[step]?.classList.add('play');
    for (const r of this.cells) r[step]?.classList.add('play');
  }
}
