import { GROOVES, GROOVE_IDS, type GrooveId, type GrooveState } from '../seq/grooves';
import { INSTRUMENTS } from '../seq/instruments';
import { STEPS, type FxKind, type Pattern } from '../seq/pattern';
import type { IconFactory } from '../render/icons';
import { clear, h } from './dom';

export type EditMode = { kind: 'free' } | { kind: 'fx'; fx: FxKind };

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
      h('div', { class: 'groove-panel' }, [h('div', { class: 'panel-title', text: 'GROOVES' }), this.grooveList]),
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
      if (f.accent) parts.push('⚡');
      if (f.ratchet > 1) parts.push(`×${f.ratchet}`);
      if (f.echo) parts.push('◎');
      fxEl.textContent = parts.join(' ');
      head.classList.toggle('has-fx', parts.length > 0);
      head.classList.toggle('chord', p.tracksOnStep(s) >= 2);
      const can = this.mode.kind === 'fx' && p.canApplyFx(s, this.mode.fx);
      head.classList.toggle('targetable', can);
      for (const row of this.cells) row[s]!.classList.toggle('fx-target', can);
    }
    const spareTotal = p.tracks.reduce((a, t) => a + t.spare, 0);
    if (this.mode.kind === 'fx') {
      this.hint.textContent = `▶ Click a step to add ${this.mode.fx.toUpperCase()}`;
    } else if (spareTotal > 0) {
      this.hint.textContent = `▶ ${spareTotal} note${spareTotal > 1 ? 's' : ''} to place — click empty steps`;
    } else {
      this.hint.textContent = 'Click a lit step to lift it, then place it elsewhere';
    }
    this.el.classList.toggle('placing', spareTotal > 0);
    this.renderGrooves(grooves);
  }

  private renderGrooves(g: GrooveState): void {
    clear(this.grooveList);
    const disc = this.discovered();
    for (const id of GROOVE_IDS) {
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
