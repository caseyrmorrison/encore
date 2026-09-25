import { formatInt, formatTime } from '../core/math';
import type { SaveData, Settings } from '../core/save';
import { GROOVES, GROOVE_IDS } from '../seq/grooves';
import { INSTRUMENTS, INSTRUMENT_IDS, RARITY_COLOR, type InstrumentId } from '../seq/instruments';
import { SETLISTS, type SetlistId } from '../seq/setlists';
import type { IconFactory } from '../render/icons';
import { clear, h, isSafeImageSrc, show } from './dom';

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
  cycleSetlist(dir: number): void;
}

export class TitleScreen {
  readonly el: HTMLElement;
  private readonly dailyInfo: HTMLElement;
  private readonly fans: HTMLElement;
  private readonly press: HTMLElement;
  private readonly menu: HTMLElement;
  private readonly playSub: HTMLElement;
  private readonly setName: HTMLElement;
  private readonly setBlurb: HTMLElement;
  private started = false;

  constructor(root: HTMLElement, a: TitleActions) {
    this.el = overlay('title', 'Main menu');
    this.dailyInfo = h('span', { class: 'btn-sub' });
    this.fans = h('span', { class: 'btn-sub' });
    this.press = h('div', { class: 'press-start' }, [
      h('span', { class: 'for-keys', text: 'CLICK OR PRESS ANY KEY' }),
      h('span', { class: 'for-touch', text: 'TAP TO START' }),
    ]);
    const dailyBtn = button('DAILY SETLIST', 'wide', a.daily);
    dailyBtn.append(this.dailyInfo);
    const merchBtn = button('MERCH TABLE', 'wide', a.merch);
    merchBtn.append(this.fans);
    const playBtn = button('PLAY', 'wide primary big', a.play);
    this.playSub = h('span', { class: 'hotkey', text: 'ENTER' });
    playBtn.append(this.playSub);
    this.setName = h('div', { class: 'setlist-name' });
    this.setBlurb = h('div', { class: 'setlist-blurb' });
    const setlist = h('div', { class: 'setlist' }, [
      h('button', { class: 'setlist-arrow', type: 'button', text: '◂', aria: { label: 'Previous setlist' }, on: { click: () => a.cycleSetlist(-1) } }),
      h('div', { class: 'setlist-mid' }, [h('div', { class: 'setlist-kicker', text: 'STARTING SETLIST' }), this.setName, this.setBlurb]),
      h('button', { class: 'setlist-arrow', type: 'button', text: '▸', aria: { label: 'Next setlist' }, on: { click: () => a.cycleSetlist(1) } }),
    ]);
    this.menu = h('nav', { class: 'title-menu hidden' }, [
      setlist,
      playBtn,
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

  pulse(beat: number): void {
    this.press.style.setProperty('--beat', beat.toFixed(3));
  }

  update(save: SaveData, dailyKey: string, sharedSeed: string | null = null): void {
    this.playSub.textContent = sharedSeed ? `shared seed ${sharedSeed}` : 'ENTER';
    const sl = SETLISTS[(save.setlist as SetlistId) in SETLISTS ? (save.setlist as SetlistId) : 'garage'];
    const open = sl.unlocked(save);
    this.setName.textContent = open ? sl.name : `🔒 ${sl.name}`;
    this.setBlurb.textContent = open ? sl.blurb : `Unlock: ${sl.unlockText}`;
    this.setName.parentElement?.parentElement?.classList.toggle('locked', !open);
    const best = save.dailyBest[dailyKey];
    this.dailyInfo.textContent = best ? `${dailyKey} · best ${formatInt(best)}` : `${dailyKey} · same run for everyone`;
    this.fans.textContent = `${formatInt(save.fans)} fans`;
  }

  setVisible(on: boolean): void {
    show(this.el, on);
  }
}

/* ─────────────────────────── pause ─────────────────────────── */

export interface PauseInfo {
  venue: string;
  time: number;
  level: number;
  kills: number;
  bestHit: number;
  hp: number;
  maxHp: number;
  grooves: { genre: string; color: string }[];
  tracks: { short: string; css: string; notes: boolean[] }[];
  pedals: string[];
  seedCode: string;
  daily: boolean;
}

/** A small read-only copy of the drum machine (results + pause). */
function machineView(tracks: PauseInfo['tracks']): HTMLElement {
  const machine = h('div', { class: 'results-machine' });
  for (const t of tracks) {
    const row = h('div', { class: 'mini-row' }, [h('span', { class: 'mini-label', text: t.short })]);
    row.style.setProperty('--c', t.css);
    t.notes.forEach((on, i) => row.append(h('i', { class: `mini-cell${on ? ' on' : ''}${i % 4 === 0 ? ' beat' : ''}` })));
    machine.append(row);
  }
  return machine;
}

function keycaps(): HTMLElement {
  const k = (keys: string[], what: string): HTMLElement =>
    h('div', { class: 'keyhint' }, [...keys.map((c) => h('kbd', { text: c })), h('span', { text: what })]);
  return h('div', { class: 'keyhints' }, [
    k(['W', 'A', 'S', 'D'], 'move'),
    k(['SPACE'], 'dash — on the beat for PERFECT'),
    k(['Q'], 'DROP when hype is full'),
    k(['M'], 'mute'),
  ]);
}

export class PauseScreen {
  readonly el: HTMLElement;
  private readonly side: HTMLElement;
  constructor(root: HTMLElement, a: { resume(): void; settings(): void; howto(): void; quit(): void }) {
    this.el = overlay('pause', 'Paused');
    this.side = h('div', { class: 'pause-side' });
    this.el.append(
      h('div', { class: 'panel pause-panel' }, [
        h('div', { class: 'pause-cols' }, [
          h('div', { class: 'pause-main' }, [
            h('div', { class: 'panel-title big', text: 'PAUSED' }),
            h('div', { class: 'panel-sub', text: 'The band is on a smoke break.' }),
            h('div', { class: 'stack' }, [
              button('RESUME', 'wide primary', a.resume, 'ESC'),
              button('HOW TO PLAY', 'wide', a.howto),
              button('SETTINGS', 'wide', a.settings),
              button('QUIT RUN', 'wide danger', a.quit),
            ]),
          ]),
          this.side,
        ]),
        keycaps(),
      ]),
    );
    root.append(this.el);
  }

  open(p: PauseInfo): void {
    clear(this.side);
    const stat = (label: string, value: string): HTMLElement =>
      h('div', { class: 'pstat' }, [h('div', { class: 'pstat-v', text: value }), h('div', { class: 'pstat-l', text: label })]);
    this.side.append(
      h('div', { class: 'pause-venue' }, [
        h('span', { text: p.venue }),
        h('span', { class: 'pause-seed', text: p.daily ? 'DAILY SETLIST' : `SEED ${p.seedCode}` }),
      ]),
      h('div', { class: 'pstats' }, [
        stat('level', String(p.level)),
        stat('silenced', formatInt(p.kills)),
        stat('biggest hit', formatInt(p.bestHit)),
        stat('set time', formatTime(p.time)),
        stat('health', `${Math.max(0, Math.round(p.hp))}/${p.maxHp}`),
      ]),
      machineView(p.tracks),
      p.grooves.length
        ? h(
            'div',
            { class: 'rgrooves' },
            p.grooves.map((g) => {
              const c = h('span', { class: 'chip', text: g.genre });
              c.style.setProperty('--g', g.color);
              return c;
            }),
          )
        : h('div', { class: 'pause-empty', text: 'No grooves yet — line your notes up into a pattern.' }),
    );
    if (p.pedals.length) this.side.append(h('div', { class: 'pause-pedals', text: p.pedals.join(' · ') }));
    show(this.el, true);
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
      h('div', { class: 'panel narrow settings-panel' }, [
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
      return h('div', { class: 'set-row toggle-row' }, [h('span', { text: label, title: help }), b, h('span', { class: 'set-help', text: help })]);
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
    const section = (t: string): HTMLElement => h('div', { class: 'set-section', text: t });
    this.body.append(
      section('SOUND'),
      slider('Master volume', 'master'),
      slider('Music & instruments', 'music'),
      slider('Effects', 'sfx'),
      section('FEEL'),
      slider('Screen shake', 'shake'),
      toggle('Auto-aim', 'autoAim', 'Weapons target the nearest enemy instead of your cursor'),
      toggle('Strobes & flashes', 'flashes', 'Turn off to reduce flashing lights'),
      section('PICTURE'),
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
    const step = (n: string, title: string, body: string, img?: string, touchBody?: string): HTMLElement =>
      h('div', { class: 'how-step' }, [
        img ? h('img', { class: 'how-img', src: img, alt: '' }) : h('div', { class: 'how-num', text: n }),
        h('div', {}, [
          h('div', { class: 'how-title', text: title }),
          h('div', { class: 'how-body' }, [
            h('span', { class: touchBody ? 'for-keys' : '', text: body }),
            touchBody ? h('span', { class: 'for-touch', text: touchBody }) : null,
          ]),
        ]),
      ]);
    this.el.append(
      h('div', { class: 'panel' }, [
        h('div', { class: 'panel-title big', text: 'HOW TO PLAY' }),
        h('div', { class: 'how-grid' }, [
          step(
            '1',
            'Move & aim',
            'WASD to move. Your mouse aims (or turn on auto-aim). You are the last live microphone.',
            icons.mic(),
            'Drag anywhere on the left to move. Your band aims for you. You are the last live microphone.',
          ),
          step('2', 'Your weapons are a drum machine', 'Each instrument is a track on a 16-step grid. Every lit step fires that weapon when the playhead passes it. More notes = more attacks.', icons.machine()),
          step('3', 'Compose to break the game', 'Tracks on the same step form CHORDS (+damage). Real rhythms unlock secret GROOVES. Accent, Ratchet and Echo multiply steps.', icons.fx('ratchet')),
          step(
            '4',
            'Dash on the beat',
            'SPACE dashes. Dash as the ring lands on the beat for a PERFECT: shockwave, longer invulnerability, and hype.',
            icons.pedal('metronome'),
            'Tap DASH. Dash as the ring lands on the beat for a PERFECT: shockwave, longer invulnerability, and hype.',
          ),
          step(
            '5',
            'Drop it',
            'Fill HYPE by silencing enemies, then press Q. The room builds to the next downbeat — then everything doubles.',
            icons.pedal('hypeman'),
            'Fill HYPE by silencing enemies, then tap DROP. The room builds to the next downbeat — then everything doubles.',
          ),
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
  newBestKills: boolean;
  newBestHit: boolean;
  /** rendered gold record, shown either side of the title on a win */
  trophy?: string;
  /** the cheapest instrument still locked at the merch table */
  nextUnlock?: { name: string; cost: number; have: number; icon: string };
  /** riddle for a groove nobody has found yet */
  rumour?: string;
}

export class ResultsScreen {
  readonly el: HTMLElement;
  private readonly body: HTMLElement;
  private readonly title: HTMLElement;
  private readonly sub: HTMLElement;
  private readonly shareBtn: HTMLButtonElement;
  private readonly hero: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly trophies: HTMLImageElement[];
  private again!: HTMLButtonElement;
  private posterBtn!: HTMLButtonElement;
  private shareText = '';

  constructor(root: HTMLElement, a: { again(): void; menu(): void; merch(): void; poster(): Promise<void> }) {
    this.el = overlay('results', 'Results');
    this.title = h('div', { class: 'results-title' });
    this.sub = h('div', { class: 'results-sub' });
    this.body = h('div', { class: 'results-grid' });
    this.hero = h('div', { class: 'rhero-v' });
    this.shareBtn = button('COPY RESULT', 'ghost', () => {
      void navigator.clipboard?.writeText(this.shareText).then(
        () => (this.shareBtn.firstChild!.textContent = 'COPIED ✓'),
        () => (this.shareBtn.firstChild!.textContent = 'COPY FAILED'),
      );
    });
    this.trophies = [h('img', { class: 'trophy', alt: '' }), h('img', { class: 'trophy r', alt: '' })];
    this.el.append(
      (this.panel = h('div', { class: 'panel results-panel' }, [
        h('div', { class: 'results-head' }, [this.trophies[0]!, this.title, this.trophies[1]!]),
        this.sub,
        h('div', { class: 'rhero' }, [this.hero, h('div', { class: 'rhero-l', text: 'FANS EARNED' })]),
        this.body,
        h('div', { class: 'row' }, [
          (this.again = button('PLAY AGAIN', 'primary big', a.again, 'ENTER')),
          button('MERCH TABLE', '', a.merch),
          (this.posterBtn = button('SAVE POSTER', '', () => {
            this.posterBtn.firstChild!.textContent = 'PRINTING…';
            void a.poster().finally(() => (this.posterBtn.firstChild!.textContent = 'SAVE POSTER'));
          })),
          this.shareBtn,
          button('MENU', 'ghost', a.menu),
        ]),
      ])),
    );
    root.append(this.el);
  }

  open(r: ResultStats): void {
    this.title.textContent = r.won ? (r.loop > 0 ? `ENCORE ×${r.loop + 1}` : 'ENCORE!') : "SHOW'S OVER";
    this.again.firstChild!.textContent = r.won ? 'ENCORE ▸ KEEP YOUR BUILD' : 'PLAY AGAIN';
    this.title.classList.toggle('won', r.won);
    this.panel.classList.toggle('won', r.won);
    for (const t of this.trophies) {
      if (r.trophy && isSafeImageSrc(r.trophy)) t.src = r.trophy;
      show(t, !!r.trophy);
    }
    this.sub.textContent = r.won
      ? 'The crowd will not stop screaming.'
      : `The Hush took ${r.venueName}. The crowd wants more.`;
    clear(this.body);
    this.hero.textContent = '+0';
    const target = r.fans;
    const t0 = performance.now();
    const tick = (): void => {
      const k = Math.min(1, (performance.now() - t0) / 1400);
      this.hero.textContent = `+${formatInt(Math.round(target * (1 - Math.pow(1 - k, 3))))}`;
      if (k < 1 && this.el.isConnected && !this.el.classList.contains('hidden')) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    const stat = (label: string, value: string, hot = false, best = false): HTMLElement =>
      h('div', { class: `rstat${hot ? ' hot' : ''}` }, [
        h('div', { class: 'rstat-v' }, [value, best ? h('span', { class: 'rbadge', text: 'NEW BEST' }) : null]),
        h('div', { class: 'rstat-l', text: label }),
      ]);
    // the headline numbers always show; the rest only when there's something to brag about
    const tiles: [string, string, boolean, boolean, number][] = [
      ['silenced', formatInt(r.kills), true, r.newBestKills, 1],
      ['biggest hit', formatInt(r.bestHit), true, r.newBestHit, 1],
      ['level', String(r.level), false, false, 1],
      ['time', formatTime(r.time), false, false, 1],
      ['venues headlined', String(r.venuesCleared), false, false, r.venuesCleared],
      ['best streak', formatInt(r.bestStreak), false, false, r.bestStreak],
      ['perfect dashes', formatInt(r.perfects), false, false, r.perfects],
      ['drops', formatInt(r.drops), false, false, r.drops],
      ['grooves found', String(r.grooves.length), false, false, r.grooves.length],
    ];
    for (const [label, value, hot, best, n] of tiles) if (n > 0) this.body.append(stat(label, value, hot, best));
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
    this.body.append(h('div', { class: 'rgrooves' }, [machineView(r.tracks)]));
    // …and the reasons to go again
    const hooks = h('div', { class: 'rhooks' });
    if (r.nextUnlock) {
      const u = r.nextUnlock;
      const k = Math.min(1, u.have / u.cost);
      const bar = h('div', { class: 'rnext-bar' }, [h('i')]);
      bar.style.setProperty('--k', k.toFixed(3));
      hooks.append(
        h('div', { class: `rnext${k >= 1 ? ' ready' : ''}` }, [
          h('img', { src: u.icon, alt: '' }),
          h('div', {}, [
            h('div', { class: 'rnext-t', text: k >= 1 ? `${u.name.toUpperCase()} IS READY AT THE MERCH TABLE` : `NEXT UNLOCK · ${u.name.toUpperCase()}` }),
            bar,
            h('div', { class: 'rnext-n', text: `${formatInt(u.have)} / ${formatInt(u.cost)} fans` }),
          ]),
        ]),
      );
    }
    if (r.rumour) hooks.append(h('div', { class: 'rrumour' }, [h('span', { text: 'GROOVE RUMOUR' }), `“${r.rumour}”`]));
    if (hooks.childElementCount) this.body.append(hooks);
    this.shareText = [
      `ENCORE ${r.daily ? '· Daily Setlist ' : ''}· seed ${r.seedCode}`,
      `${r.won ? '🏆 headlined everything' : `💀 fell at ${r.venueName}`} · ${formatInt(r.kills)} silenced · biggest hit ${formatInt(r.bestHit)}`,
      `grooves: ${r.grooves.map((g) => g.genre).join(', ') || 'none'}`,
      r.daily ? '' : `play this seed: ${location.origin}${location.pathname}?seed=${r.seedCode}`,
    ]
      .filter(Boolean)
      .join('\n');
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
      const item = h('div', { class: `merch-item${owned ? ' owned' : afford ? '' : ' locked'}` }, [
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
    this.body.append(grid, h('aside', { class: 'merch-side' }, [loud, gro, stats]));
    show(this.el, true);
  }

  close(): void {
    show(this.el, false);
  }

  get isOpen(): boolean {
    return !this.el.classList.contains('hidden');
  }
}
