import { formatInt, formatTime } from '../core/math';
import type { SaveData, Settings } from '../core/save';
import { GROOVES, GROOVE_IDS } from '../seq/grooves';
import { INSTRUMENTS, INSTRUMENT_IDS, RARITY_COLOR, type InstrumentId } from '../seq/instruments';
import type { IconFactory } from '../render/icons';
import { clear, h, show } from './dom';

function overlay(cls: string, label: string): HTMLElement {
  return h('div', { class: `overlay ${cls} hidden`, role: 'dialog', aria: { label } });
}

function button(text: string, cls: string, onClick: () => void, hotkey?: string): HTMLButtonElement {
  const b = h('button', { class: `btn ${cls}`, type: 'button', on: { click: onClick } }, [text]);
  if (hotkey) b.append(h('span', { class: 'hotkey', text: hotkey }));
  return b;
}

/* ─────────────────────────── title ─────────────────────────── */

export interface TitleActions {
  play(): void;
  daily(): void;
  merch(): void;
  howto(): void;
  settings(): void;
}

export class TitleScreen {
  readonly el: HTMLElement;
  private readonly dailyInfo: HTMLElement;
  private readonly fans: HTMLElement;
  private readonly press: HTMLElement;
  private readonly menu: HTMLElement;
  private started = false;

  constructor(root: HTMLElement, a: TitleActions) {
    this.el = overlay('title', 'Main menu');
    this.dailyInfo = h('span', { class: 'btn-sub' });
    this.fans = h('span', { class: 'btn-sub' });
    this.press = h('div', { class: 'press-start', text: 'CLICK OR PRESS ANY KEY' });
    const dailyBtn = button('DAILY SETLIST', 'wide', a.daily);
    dailyBtn.append(this.dailyInfo);
    const merchBtn = button('MERCH TABLE', 'wide', a.merch);
    merchBtn.append(this.fans);
    this.menu = h('nav', { class: 'title-menu hidden' }, [
      button('PLAY', 'wide primary big', a.play, 'ENTER'),
      dailyBtn,
      merchBtn,
      button('HOW TO PLAY', 'wide', a.howto),
      button('SETTINGS', 'wide', a.settings),
    ]);
    this.el.append(
      h('div', { class: 'title-spacer' }),
      this.press,
      this.menu,
      h('footer', { class: 'title-foot' }, [
        h('span', { text: 'Every sound is synthesized live. Every model is built in three.js. Headphones recommended.' }),
      ]),
    );
    root.append(this.el);
  }

  /** First interaction unlocks audio — then the menu slides in. */
  reveal(): void {
    if (this.started) return;
    this.started = true;
    show(this.press, false);
    show(this.menu, true);
    this.menu.classList.add('enter');
  }

  get revealed(): boolean {
    return this.started;
  }

  update(save: SaveData, dailyKey: string): void {
    const best = save.dailyBest[dailyKey];
    this.dailyInfo.textContent = best ? `${dailyKey} · best ${formatInt(best)}` : `${dailyKey} · same run for everyone`;
    this.fans.textContent = `${formatInt(save.fans)} fans`;
  }

  setVisible(on: boolean): void {
    show(this.el, on);
  }
}

/* ─────────────────────────── pause ─────────────────────────── */

export class PauseScreen {
  readonly el: HTMLElement;
  constructor(root: HTMLElement, a: { resume(): void; settings(): void; howto(): void; quit(): void }) {
    this.el = overlay('pause', 'Paused');
    this.el.append(
      h('div', { class: 'panel narrow' }, [
        h('div', { class: 'panel-title big', text: 'PAUSED' }),
        h('div', { class: 'panel-sub', text: 'The band is on a smoke break.' }),
        h('div', { class: 'stack' }, [
          button('RESUME', 'wide primary', a.resume, 'ESC'),
          button('HOW TO PLAY', 'wide', a.howto),
          button('SETTINGS', 'wide', a.settings),
          button('QUIT RUN', 'wide danger', a.quit),
        ]),
      ]),
    );
    root.append(this.el);
  }
  setVisible(on: boolean): void {
    show(this.el, on);
  }
}

/* ─────────────────────────── settings ─────────────────────────── */

export class SettingsScreen {
  readonly el: HTMLElement;
  private readonly body: HTMLElement;
  constructor(
    root: HTMLElement,
    private readonly a: { change(s: Settings): void; close(): void },
  ) {
    this.el = overlay('settings', 'Settings');
    this.body = h('div', { class: 'settings-body' });
    this.el.append(
      h('div', { class: 'panel narrow' }, [
        h('div', { class: 'panel-title big', text: 'SETTINGS' }),
        this.body,
        button('DONE', 'wide primary', a.close, 'ESC'),
      ]),
    );
    root.append(this.el);
  }

  open(s: Settings): void {
    const cur = { ...s };
    clear(this.body);
    const slider = (label: string, key: 'master' | 'music' | 'sfx' | 'shake'): HTMLElement => {
      const input = document.createElement('input');
      input.type = 'range';
      input.min = '0';
      input.max = '100';
      input.value = String(Math.round(cur[key] * 100));
      const val = h('span', { class: 'set-val', text: `${input.value}%` });
      input.addEventListener('input', () => {
        cur[key] = Number(input.value) / 100;
        val.textContent = `${input.value}%`;
        this.a.change({ ...cur });
      });
      return h('label', { class: 'set-row' }, [h('span', { text: label }), input, val]);
    };
    const toggle = (label: string, key: 'autoAim' | 'flashes', help: string): HTMLElement => {
      const b = h('button', { class: 'toggle', type: 'button' });
      const sync = (): void => {
        b.textContent = cur[key] ? 'ON' : 'OFF';
        b.classList.toggle('on', cur[key]);
      };
      sync();
      b.addEventListener('click', () => {
        cur[key] = !cur[key];
        sync();
        this.a.change({ ...cur });
      });
      return h('div', { class: 'set-row' }, [h('span', { text: label, title: help }), b, h('span', { class: 'set-help', text: help })]);
    };
    const quality = h('div', { class: 'seg' });
    for (const q of ['low', 'medium', 'high'] as const) {
      const b = h('button', { class: `seg-btn${cur.quality === q ? ' on' : ''}`, type: 'button', text: q.toUpperCase() });
      b.addEventListener('click', () => {
        cur.quality = q;
        for (const c of Array.from(quality.children)) c.classList.remove('on');
        b.classList.add('on');
        this.a.change({ ...cur });
      });
      quality.append(b);
    }
    this.body.append(
      slider('Master volume', 'master'),
      slider('Music & instruments', 'music'),
      slider('Effects', 'sfx'),
      slider('Screen shake', 'shake'),
      toggle('Auto-aim', 'autoAim', 'Weapons target the nearest enemy instead of your cursor'),
      toggle('Strobes & flashes', 'flashes', 'Turn off to reduce flashing lights'),
      h('div', { class: 'set-row' }, [h('span', { text: 'Graphics' }), quality]),
    );
    show(this.el, true);
  }

  close(): void {
    show(this.el, false);
  }

  get isOpen(): boolean {
    return !this.el.classList.contains('hidden');
  }
}

/* ─────────────────────────── how to play ─────────────────────────── */

export class HowToScreen {
  readonly el: HTMLElement;
  constructor(root: HTMLElement, close: () => void, icons: IconFactory) {
    this.el = overlay('howto', 'How to play');
    const step = (n: string, title: string, body: string, img?: string): HTMLElement =>
      h('div', { class: 'how-step' }, [
        img ? h('img', { class: 'how-img', src: img, alt: '' }) : h('div', { class: 'how-num', text: n }),
        h('div', {}, [h('div', { class: 'how-title', text: title }), h('div', { class: 'how-body', text: body })]),
      ]);
    this.el.append(
      h('div', { class: 'panel' }, [
        h('div', { class: 'panel-title big', text: 'HOW TO PLAY' }),
        h('div', { class: 'how-grid' }, [
          step('1', 'Move & aim', 'WASD to move. Your mouse aims (or turn on auto-aim). Your instruments fire on their own — on the beat.', icons.instrument('kick')),
          step('2', 'Your weapons are a drum machine', 'Each instrument is a track on a 16-step grid. Every lit step fires that weapon when the playhead passes it. More notes = more attacks.', icons.instrument('snare')),
          step('3', 'Compose to break the game', 'Tracks on the same step form CHORDS (+damage). Certain rhythms unlock GROOVES — genre bonuses. Accent, Ratchet and Echo multiply steps.', icons.fx('ratchet')),
          step('4', 'Dash on the beat', 'SPACE dashes. Dash right on the beat for a PERFECT: shockwave, longer invulnerability, and hype.', icons.pedal('metronome')),
          step('5', 'Drop it', 'Fill HYPE by silencing The Hush, then press Q. The game builds to the next downbeat and DROPS: everything doubles.', icons.fx('accent')),
          step('6', 'Headline three venues', 'Survive the set, beat the headliner, spend tips backstage. Win, and the crowd demands an ENCORE — endless and faster.', icons.goldRecord()),
        ]),
        h('div', { class: 'how-keys' }, [
          h('span', { text: 'WASD move' }),
          h('span', { text: 'MOUSE aim' }),
          h('span', { text: 'SPACE dash' }),
          h('span', { text: 'Q / RMB drop' }),
          h('span', { text: '1-3 pick' }),
          h('span', { text: 'R reroll' }),
          h('span', { text: 'ESC pause' }),
          h('span', { text: 'M mute' }),
        ]),
        button('GOT IT', 'wide primary', close, 'ESC'),
      ]),
    );
    root.append(this.el);
  }
  setVisible(on: boolean): void {
    show(this.el, on);
  }
  get isOpen(): boolean {
    return !this.el.classList.contains('hidden');
  }
}

/* ─────────────────────────── results ─────────────────────────── */

export interface ResultStats {
  won: boolean;
  venueName: string;
  venuesCleared: number;
  kills: number;
  level: number;
  bestHit: number;
  perfects: number;
  drops: number;
  time: number;
  fans: number;
  newGrooves: number;
  grooves: { genre: string; color: string }[];
  pattern: string;
  tracks: { short: string; css: string; notes: boolean[] }[];
  seedCode: string;
  daily: boolean;
  bestStreak: number;
  loop: number;
}

export class ResultsScreen {
  readonly el: HTMLElement;
  private readonly body: HTMLElement;
  private readonly title: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly shareBtn: HTMLButtonElement;
  private shareText = '';

  constructor(root: HTMLElement, a: { again(): void; menu(): void; merch(): void }) {
    this.el = overlay('results', 'Results');
    this.title = h('div', { class: 'results-title' });
    this.sub = h('div', { class: 'results-sub' });
    this.body = h('div', { class: 'results-grid' });
    this.shareBtn = button('COPY RESULT', 'ghost', () => {
      void navigator.clipboard?.writeText(this.shareText).then(
        () => (this.shareBtn.firstChild!.textContent = 'COPIED ✓'),
        () => (this.shareBtn.firstChild!.textContent = 'COPY FAILED'),
      );
    });
    this.el.append(
      h('div', { class: 'panel results-panel' }, [
        this.title,
        this.sub,
        this.body,
        h('div', { class: 'row' }, [
          button('ENCORE', 'primary big', a.again, 'ENTER'),
          button('MERCH TABLE', '', a.merch),
          this.shareBtn,
          button('MENU', 'ghost', a.menu),
        ]),
      ]),
    );
    root.append(this.el);
  }

  open(r: ResultStats): void {
    this.title.textContent = r.won ? (r.loop > 0 ? `ENCORE ×${r.loop}` : 'ENCORE!') : "SHOW'S OVER";
    this.title.classList.toggle('won', r.won);
    this.sub.textContent = r.won
      ? 'The crowd will not stop screaming.'
      : `The Hush took ${r.venueName}. The crowd wants more.`;
    clear(this.body);
    const stat = (label: string, value: string, hot = false): HTMLElement =>
      h('div', { class: `rstat${hot ? ' hot' : ''}` }, [h('div', { class: 'rstat-v', text: value }), h('div', { class: 'rstat-l', text: label })]);
    this.body.append(
      stat('venues headlined', String(r.venuesCleared)),
      stat('silenced', formatInt(r.kills), true),
      stat('biggest hit', formatInt(r.bestHit), true),
      stat('level', String(r.level)),
      stat('best streak', formatInt(r.bestStreak)),
      stat('perfect dashes', formatInt(r.perfects)),
      stat('drops', formatInt(r.drops)),
      stat('time', formatTime(r.time)),
      stat('fans earned', `+${formatInt(r.fans)}`, true),
    );
    if (r.grooves.length) {
      this.body.append(
        h(
          'div',
          { class: 'rgrooves' },
          r.grooves.map((g) => {
            const c = h('span', { class: 'chip', text: g.genre });
            c.style.setProperty('--g', g.color);
            return c;
          }),
        ),
      );
    }
    // the machine you ended with
    const machine = h('div', { class: 'results-machine' });
    for (const t of r.tracks) {
      const row = h('div', { class: 'mini-row' }, [h('span', { class: 'mini-label', text: t.short })]);
      row.style.setProperty('--c', t.css);
      t.notes.forEach((on, i) => row.append(h('i', { class: `mini-cell${on ? ' on' : ''}${i % 4 === 0 ? ' beat' : ''}` })));
      machine.append(row);
    }
    this.body.append(h('div', { class: 'rgrooves' }, [machine]));
    this.shareText = [
      `ENCORE ${r.daily ? '· Daily Setlist ' : ''}· seed ${r.seedCode}`,
      `${r.won ? '🏆 headlined everything' : `💀 fell at ${r.venueName}`} · ${formatInt(r.kills)} silenced · biggest hit ${formatInt(r.bestHit)}`,
      `grooves: ${r.grooves.map((g) => g.genre).join(', ') || 'none'}`,
    ].join('\n');
    this.shareBtn.firstChild!.textContent = 'COPY RESULT';
    show(this.el, true);
  }

  setVisible(on: boolean): void {
    show(this.el, on);
  }
}

/* ─────────────────────────── merch table (meta) ─────────────────────────── */

export const UNLOCK_COST: Partial<Record<InstrumentId, number>> = {
  pad: 120,
  tom: 120,
  crash: 220,
  cowbell: 260,
  scratch: 360,
  organ: 520,
  gong: 900,
};

export class MerchScreen {
  readonly el: HTMLElement;
  private readonly body: HTMLElement;
  private readonly fans: HTMLElement;

  constructor(
    root: HTMLElement,
    private readonly icons: IconFactory,
    private readonly a: { buy(id: InstrumentId): void; loudness(n: number): void; close(): void },
  ) {
    this.el = overlay('merch', 'Merch table');
    this.fans = h('div', { class: 'fans-count' });
    this.body = h('div', { class: 'merch-body' });
    this.el.append(
      h('div', { class: 'panel' }, [
        h('div', { class: 'merch-head' }, [h('div', { class: 'panel-title big', text: 'MERCH TABLE' }), this.fans]),
        h('div', { class: 'panel-sub', text: 'Fans follow you between runs. Spend them to add instruments to the draft pool.' }),
        this.body,
        button('BACK', 'wide primary', a.close, 'ESC'),
      ]),
    );
    root.append(this.el);
  }

  open(save: SaveData): void {
    this.fans.textContent = `${formatInt(save.fans)} FANS`;
    clear(this.body);
    const grid = h('div', { class: 'merch-grid' });
    for (const id of INSTRUMENT_IDS) {
      const d = INSTRUMENTS[id];
      const owned = save.unlocked.includes(id);
      const cost = UNLOCK_COST[id];
      const afford = cost !== undefined && save.fans >= cost;
      const item = h('div', { class: `merch-item${owned ? ' owned' : ''}` }, [
        h('img', { src: this.icons.instrument(id), alt: '' }),
        h('div', { class: 'merch-name', text: d.name.toUpperCase() }),
        h('div', { class: 'merch-desc', text: d.weapon }),
        owned
          ? h('div', { class: 'merch-owned', text: 'IN THE POOL' })
          : button(`${cost} FANS`, afford ? 'primary' : 'ghost', () => this.a.buy(id)),
      ]);
      item.style.setProperty('--accent', d.css);
      item.style.setProperty('--rarity', RARITY_COLOR[d.rarity]);
      grid.append(item);
    }
    const loud = h('div', { class: 'loud' }, [
      h('div', { class: 'loud-title', text: 'LOUDNESS' }),
      h('div', {
        class: 'loud-help',
        text: save.wins > 0 ? 'Harder crowds, less health, more fans. Unlock the next level by winning at the current one.' : 'Win a run to unlock louder shows.',
      }),
    ]);
    const seg = h('div', { class: 'seg' });
    for (let i = 0; i <= Math.min(10, save.wins); i++) {
      const b = h('button', { class: `seg-btn${save.loudness === i ? ' on' : ''}`, type: 'button', text: i === 0 ? 'NORMAL' : `+${i}` });
      b.addEventListener('click', () => this.a.loudness(i));
      seg.append(b);
    }
    loud.append(seg);
    const gro = h('div', { class: 'codex' }, [h('div', { class: 'loud-title', text: `GROOVES FOUND ${save.grooves.length}/${GROOVE_IDS.length}` })]);
    for (const id of GROOVE_IDS) {
      const g = GROOVES[id];
      const known = save.grooves.includes(id);
      const chip = h('span', { class: `chip${known ? '' : ' unknown'}`, text: known ? g.genre : '???', title: known ? g.recipe : g.riddle });
      chip.style.setProperty('--g', g.color);
      gro.append(chip);
    }
    const stats = h('div', { class: 'codex' }, [
      h('div', { class: 'loud-title', text: 'CAREER' }),
      h('div', { class: 'career', text: `${save.runs} shows · ${save.wins} headlined · best ${formatInt(save.bestKills)} silenced · biggest hit ${formatInt(save.bestHit)}` }),
    ]);
    this.body.append(grid, loud, gro, stats);
    show(this.el, true);
  }

  close(): void {
    show(this.el, false);
  }

  get isOpen(): boolean {
    return !this.el.classList.contains('hidden');
  }
}
