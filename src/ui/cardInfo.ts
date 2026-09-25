import { cardRarity, FX_INFO, PEDALS, type Card } from '../seq/cards';
import { INSTRUMENTS, MAX_LEVEL, type Rarity } from '../seq/instruments';
import type { Pattern } from '../seq/pattern';
import type { IconFactory } from '../render/icons';

export interface CardView {
  kicker: string;
  title: string;
  body: string;
  tag: string;
  icon: string;
  rarity: Rarity;
  accent: string;
}

export function describeCard(c: Card, pattern: Pattern, icons: IconFactory, pedals: Record<string, number>): CardView {
  const rarity = cardRarity(c);
  switch (c.kind) {
    case 'instrument': {
      const d = INSTRUMENTS[c.inst];
      return {
        kicker: 'NEW TRACK',
        title: d.name.toUpperCase(),
        body: `${d.weapon}. ${d.blurb}`,
        tag: `${d.defaultNotes.length} note${d.defaultNotes.length > 1 ? 's' : ''} · ${d.short}`,
        icon: icons.instrument(c.inst),
        rarity,
        accent: d.css,
      };
    }
    case 'notes': {
      const d = INSTRUMENTS[c.inst];
      return {
        kicker: 'MORE NOTES',
        title: `+${c.n} ${d.name.toUpperCase()}`,
        body: `Place ${c.n} more ${d.name} notes anywhere on the grid. More notes, more ${d.weapon.toLowerCase()}.`,
        tag: `${pattern.track(c.inst) ? pattern.noteCount(pattern.track(c.inst)!) : 0} → ${
          (pattern.track(c.inst) ? pattern.noteCount(pattern.track(c.inst)!) : 0) + c.n
        } notes`,
        icon: icons.note(d.color),
        rarity,
        accent: d.css,
      };
    }
    case 'level': {
      const d = INSTRUMENTS[c.inst];
      const t = pattern.track(c.inst);
      const lvl = t?.level ?? 1;
      return {
        kicker: 'UPGRADE',
        title: `${d.name.toUpperCase()} LV ${lvl + 1}`,
        body: `${d.levels[lvl - 1] ?? 'Stronger.'}${lvl + 1 >= MAX_LEVEL ? `  ★ Evolution: ${d.evolution.hint}` : ''}`,
        tag: `LV ${lvl} → ${lvl + 1}`,
        icon: icons.instrument(c.inst),
        rarity,
        accent: d.css,
      };
    }
    case 'fx': {
      const f = FX_INFO[c.fx];
      return {
        kicker: 'STEP FX',
        title: f.name.toUpperCase(),
        body: f.blurb,
        tag: 'place on a step',
        icon: icons.fx(c.fx),
        rarity,
        accent: f.color,
      };
    }
    case 'pedal': {
      const p = PEDALS[c.pedal];
      const have = pedals[c.pedal] ?? 0;
      return {
        kicker: 'PEDAL',
        title: p.name.toUpperCase(),
        body: p.blurb,
        tag: have > 0 ? `owned ×${have}` : 'new pedal',
        icon: icons.pedal(c.pedal),
        rarity,
        accent: `#${p.color.toString(16).padStart(6, '0')}`,
      };
    }
    case 'evolve': {
      const d = INSTRUMENTS[c.inst];
      return {
        kicker: '★ EVOLUTION ★',
        title: d.evolution.name,
        body: d.evolution.blurb,
        tag: `${d.name} transforms`,
        icon: icons.instrument(c.inst),
        rarity,
        accent: '#ffd36b',
      };
    }
    case 'heal':
      return {
        kicker: 'HYDRATE',
        title: 'WATER BREAK',
        body: 'Heal 50% of your max health.',
        tag: 'utility',
        icon: icons.heart(),
        rarity,
        accent: '#ff3b5c',
      };
    case 'tips':
      return {
        kicker: 'CASH',
        title: `+${c.amount} TIPS`,
        body: 'Spend tips backstage between venues.',
        tag: 'utility',
        icon: icons.picks(),
        rarity,
        accent: '#ffc53d',
      };
  }
}
