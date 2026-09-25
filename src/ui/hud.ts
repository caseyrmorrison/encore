import { formatInt, formatTime } from '../core/math';
import { GROOVES } from '../seq/grooves';
import { INSTRUMENTS } from '../seq/instruments';
import { STEPS } from '../seq/pattern';
import type { Run } from '../game/run';
import { clear, h, show } from './dom';

const VU_SEGMENTS = 22;

/** In-game heads-up display. Updates are diffed so it costs almost nothing per frame. */
export class Hud {
  readonly el: HTMLElement;
  private readonly vu: HTMLElement[] = [];
  private readonly hpText: HTMLElement;
  private readonly hypeFill: HTMLElement;
  private readonly hypeLabel: HTMLElement;
  private readonly hypeWrap: HTMLElement;
  private readonly venueName: HTMLElement;
  private readonly setFill: HTMLElement;
  private readonly setTime: HTMLElement;
  private readonly kills: HTMLElement;
  private readonly tips: HTMLElement;
  private readonly level: HTMLElement;
  private readonly xpFill: HTMLElement;
  private readonly mini: HTMLElement;
  private miniCells: HTMLElement[][] = [];
  private miniVersion = -1;
  private miniStep = -1;
  private readonly chips: HTMLElement;
  private chipKey = '';
  private readonly streak: HTMLElement;
  private readonly streakNum: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly bannerTitle: HTMLElement;
  private readonly bannerSub: HTMLElement;
  private bannerT = 0;
  private readonly bossBar: HTMLElement;
  private readonly bossFill: HTMLElement;
  private readonly bossName: HTMLElement;
  private readonly toasts: HTMLElement;
  private readonly muffled: HTMLElement;
  private readonly dash: HTMLElement[] = [];
  private readonly beatDot: HTMLElement;
  private readonly perfect: HTMLElement;
  private perfectT = 0;
  private last: Record<string, string | number> = {};

  constructor(root: HTMLElement) {
    for (let i = 0; i < VU_SEGMENTS; i++) this.vu.push(h('i', { class: 'vu-seg' }));
    this.hpText = h('span', { class: 'hp-text' });
    this.hypeFill = h('div', { class: 'hype-fill' });
    this.hypeLabel = h('div', { class: 'hype-label' });
    this.hypeWrap = h('div', { class: 'hype' }, [
      h('span', { class: 'vu-label', text: 'HYPE' }),
      h('div', { class: 'hype-track' }, [this.hypeFill]),
      this.hypeLabel,
    ]);
    for (let i = 0; i < 3; i++) this.dash.push(h('i', { class: 'dash-pip' }));
    this.beatDot = h('i', { class: 'beat-dot' });

    this.venueName = h('div', { class: 'venue-name' });
    this.setFill = h('div', { class: 'set-fill' });
    this.setTime = h('div', { class: 'set-time' });
    this.kills = h('div', { class: 'stat-val' });
    this.tips = h('div', { class: 'stat-val' });
    this.level = h('div', { class: 'lvl-badge' });
    this.xpFill = h('div', { class: 'xp-fill' });
    this.mini = h('div', { class: 'mini-seq' });
    this.chips = h('div', { class: 'groove-chips' });
    this.streakNum = h('div', { class: 'streak-num' });
    this.streak = h('div', { class: 'streak hidden' }, [this.streakNum, h('div', { class: 'streak-label', text: 'STREAK' })]);
    this.bannerTitle = h('div', { class: 'banner-title' });
    this.bannerSub = h('div', { class: 'banner-sub' });
    this.banner = h('div', { class: 'banner hidden' }, [this.bannerTitle, this.bannerSub]);
    this.bossFill = h('div', { class: 'boss-fill' });
    this.bossName = h('div', { class: 'boss-name' });
    this.bossBar = h('div', { class: 'boss-bar hidden' }, [this.bossName, h('div', { class: 'boss-track' }, [this.bossFill])]);
    this.toasts = h('div', { class: 'toasts' });
    this.muffled = h('div', { class: 'muffled hidden', text: 'MUFFLED — GET OUT OF THE SILENCE' });
    this.perfect = h('div', { class: 'perfect hidden', text: 'PERFECT' });

    this.el = h('div', { class: 'hud hidden' }, [
      h('div', { class: 'hud-tl' }, [
        h('div', { class: 'vu' }, [h('span', { class: 'vu-label', text: 'VU' }), h('div', { class: 'vu-bar' }, this.vu), this.hpText]),
        this.hypeWrap,
        h('div', { class: 'dash-row' }, [h('span', { class: 'dash-label', text: 'DASH' }), ...this.dash, this.beatDot]),
      ]),
      h('div', { class: 'hud-tc' }, [
        this.venueName,
        h('div', { class: 'set-bar' }, [this.setFill, h('i', { class: 'set-boss', text: '☠' })]),
        this.setTime,
      ]),
      h('div', { class: 'hud-tr' }, [
        h('div', { class: 'stat' }, [h('div', { class: 'stat-label', text: 'SILENCED' }), this.kills]),
        h('div', { class: 'stat' }, [h('div', { class: 'stat-label', text: 'TIPS' }), this.tips]),
        this.level,
      ]),
      this.bossBar,
      this.streak,
      this.banner,
      this.toasts,
      this.muffled,
      this.perfect,
      h('div', { class: 'hud-bottom' }, [this.chips, this.mini]),
      h('div', { class: 'xp-bar' }, [this.xpFill]),
    ]);
    root.append(this.el);
  }

  setVisible(on: boolean): void {
    show(this.el, on);
  }

  private set(key: string, v: string | number, fn: () => void): void {
    if (this.last[key] === v) return;
    this.last[key] = v;
    fn();
  }

  update(
    run: Run,
    dt: number,
    venueName: string,
    setTime: number,
    setLength: number,
    step: number,
    dashCharges: number,
    dashMax: number,
    beatPhase: number,
    streak: number,
    dropState: 'idle' | 'ready' | 'queued' | 'active',
  ): void {
    const hpFrac = Math.max(0, run.hp / run.stats.maxHp);
    const lit = Math.ceil(hpFrac * VU_SEGMENTS);
    this.set('hp', lit, () => {
      this.vu.forEach((s, i) => s.classList.toggle('on', i < lit));
      this.el.classList.toggle('low-hp', hpFrac < 0.3);
    });
    this.set('hpt', Math.ceil(run.hp), () => (this.hpText.textContent = `${Math.ceil(run.hp)}`));
    this.set('hype', Math.round(run.hype * 200), () => (this.hypeFill.style.transform = `scaleX(${run.hype})`));
    this.set('drop', dropState, () => {
      this.hypeWrap.dataset.state = dropState;
      this.hypeLabel.textContent =
        dropState === 'ready' ? 'Q  DROP!' : dropState === 'queued' ? 'BUILDING…' : dropState === 'active' ? 'DROPPING' : '';
    });
    this.set('dash', dashCharges * 10 + dashMax, () =>
      this.dash.forEach((d, i) => {
        d.classList.toggle('on', i < dashCharges);
        d.classList.toggle('hidden', i >= dashMax);
      }),
    );
    this.beatDot.style.transform = `scale(${1 + Math.pow(1 - beatPhase, 4) * 0.9})`;
    this.beatDot.style.opacity = String(0.3 + Math.pow(1 - beatPhase, 3) * 0.7);

    this.set('venue', venueName, () => (this.venueName.textContent = venueName));
    this.set('setf', Math.round((setTime / setLength) * 300), () => {
      this.setFill.style.transform = `scaleX(${Math.min(1, setTime / setLength)})`;
    });
    const remain = Math.max(0, setLength - setTime);
    this.set('sett', Math.floor(remain), () => (this.setTime.textContent = remain > 0 ? formatTime(remain) : 'HEADLINER'));
    this.set('kills', run.kills, () => (this.kills.textContent = formatInt(run.kills)));
    this.set('tips', run.tips, () => (this.tips.textContent = formatInt(run.tips)));
    this.set('lvl', run.level, () => (this.level.textContent = `LV ${run.level}`));
    this.set('xp', Math.round((run.xp / run.xpToNext) * 400), () => {
      this.xpFill.style.transform = `scaleX(${Math.min(1, run.xp / run.xpToNext)})`;
    });

    // streak
    this.set('streak', streak, () => {
      show(this.streak, streak >= 10);
      this.streakNum.textContent = `×${formatInt(streak)}`;
      this.streak.style.setProperty('--s', String(Math.min(1.8, 1 + streak / 400)));
      this.streak.classList.remove('bump');
      void this.streak.offsetWidth;
      this.streak.classList.add('bump');
    });

    // grooves
    const key = [...run.grooves.active].sort().join(',');
    if (key !== this.chipKey) {
      this.chipKey = key;
      clear(this.chips);
      for (const g of run.grooves.active) {
        const d = GROOVES[g];
        const chip = h('span', { class: 'chip', text: d.genre });
        chip.style.setProperty('--g', d.color);
        this.chips.append(chip);
      }
    }

    this.updateMini(run, step);

    if (this.bannerT > 0) {
      this.bannerT -= dt;
      if (this.bannerT <= 0) show(this.banner, false);
    }
    if (this.perfectT > 0) {
      this.perfectT -= dt;
      if (this.perfectT <= 0) show(this.perfect, false);
    }
  }

  private updateMini(run: Run, step: number): void {
    const p = run.pattern;
    if (p.version !== this.miniVersion) {
      this.miniVersion = p.version;
      clear(this.mini);
      this.miniCells = [];
      for (const t of p.tracks) {
        const row = h('div', { class: 'mini-row' }, [h('span', { class: 'mini-label', text: INSTRUMENTS[t.inst].short })]);
        row.style.setProperty('--c', INSTRUMENTS[t.inst].css);
        const cells: HTMLElement[] = [];
        for (let s = 0; s < STEPS; s++) {
          const c = h('i', { class: `mini-cell${t.notes[s] ? ' on' : ''}${s % 4 === 0 ? ' beat' : ''}` });
          cells.push(c);
          row.append(c);
        }
        this.miniCells.push(cells);
        this.mini.append(row);
      }
      this.miniStep = -1;
    }
    if (step !== this.miniStep) {
      if (this.miniStep >= 0) for (const r of this.miniCells) r[this.miniStep]?.classList.remove('play');
      for (const r of this.miniCells) r[step]?.classList.add('play');
      this.miniStep = step;
    }
  }

  announce(title: string, sub = '', color = '#fff', seconds = 2.4): void {
    this.bannerTitle.textContent = title;
    this.bannerSub.textContent = sub;
    this.banner.style.setProperty('--bc', color);
    show(this.banner, true);
    this.banner.classList.remove('pop');
    void this.banner.offsetWidth;
    this.banner.classList.add('pop');
    this.bannerT = seconds;
  }

  toast(text: string, color = '#fff'): void {
    const t = h('div', { class: 'toast', text });
    t.style.setProperty('--tc', color);
    this.toasts.append(t);
    while (this.toasts.children.length > 5) this.toasts.firstChild?.remove();
    setTimeout(() => t.remove(), 2600);
  }

  streakCallout(word: string): void {
    const c = h('div', { class: 'streak-callout', text: word });
    this.streak.append(c);
    setTimeout(() => c.remove(), 1400);
  }

  flashPerfect(): void {
    show(this.perfect, true);
    this.perfect.classList.remove('pop');
    void this.perfect.offsetWidth;
    this.perfect.classList.add('pop');
    this.perfectT = 0.6;
  }

  setMuffled(on: boolean): void {
    this.set('muff', on ? 1 : 0, () => show(this.muffled, on));
  }

  boss(name: string | null, frac = 0, shielded = false): void {
    this.set('bossOn', name ?? '', () => {
      show(this.bossBar, !!name);
      if (name) this.bossName.textContent = name;
    });
    if (name) {
      this.set('bossHp', Math.round(frac * 1000), () => (this.bossFill.style.transform = `scaleX(${frac})`));
      this.set('bossShield', shielded ? 1 : 0, () => this.bossBar.classList.toggle('shielded', shielded));
    }
  }
}
