// Scripted screenshot + perf capture using the locally installed Chrome (no browser download).
// Usage: node tools/shots.mjs [scenario ...] [--url=http://localhost:5310] [--out=shots]
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (k, d) => (args.find((a) => a.startsWith(`--${k}=`)) ?? `--${k}=${d}`).split('=').slice(1).join('=');
const url = opt('url', 'http://localhost:5310/');
const out = resolve(opt('out', 'shots'));
const w = Number(opt('w', '1440'));
const hgt = Number(opt('h', '900'));
const scenarios = args.filter((a) => !a.startsWith('--'));
mkdirSync(out, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const mobile = args.includes('--mobile');
const page = await browser.newPage(
  mobile
    ? { viewport: { width: w, height: hgt }, deviceScaleFactor: 2, hasTouch: true, isMobile: true }
    : { viewport: { width: w, height: hgt }, deviceScaleFactor: 1 },
);
const logs = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__encore && window.__encore.state() === 'title', null, { timeout: 30000 });
await sleep(600);

const E = (fn, arg) => page.evaluate(fn, arg);
const shot = async (name) => {
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log('saved', `${out}/${name}.png`);
};
const fps = async (ms = 2000) =>
  E(
    (ms) =>
      new Promise((r) => {
        let n = 0;
        const t0 = performance.now();
        const worst = [];
        let last = t0;
        const f = () => {
          const now = performance.now();
          worst.push(now - last);
          last = now;
          n++;
          if (now - t0 < ms) requestAnimationFrame(f);
          else r({ fps: +(n / (ms / 1000)).toFixed(1), worstMs: +Math.max(...worst.slice(2)).toFixed(1) });
        };
        requestAnimationFrame(f);
      }),
    ms,
  );

/** Move the player in a circle-ish pattern with keys for `ms`, dashing on the beat now and then. */
const dance = async (ms) => {
  const keys = ['KeyW', 'KeyD', 'KeyS', 'KeyA'];
  const t0 = Date.now();
  let i = 0;
  while (Date.now() - t0 < ms) {
    const k = keys[i++ % 4];
    await page.keyboard.down(k);
    await sleep(380);
    if (i % 3 === 0) await page.keyboard.press('Space');
    await page.keyboard.up(k);
  }
};

const start = async () => {
  await page.mouse.click(w / 2, hgt / 2);
  await sleep(300);
  await E(() => window.__encore.ready?.());
  await E(() => window.__encore.game.startRun('standard'));
  await sleep(500);
  await page.mouse.move(w / 2 + 200, hgt / 2 - 100);
};

const S = {
  async botmid() {
    const mins = Number(opt('mins', '5'));
    const venue = Number(opt('venue', '1'));
    await start();
    await E((venue) => {
      const d = window.__encore;
      const g = d.game;
      for (const i of ['hat', 'bass', 'lead', 'clap']) d.give(i);
      const lv = { kick: 4, snare: 3, hat: 3, bass: 2, lead: 3, clap: 2 };
      for (const t of g.run.pattern.tracks) t.level = lv[t.inst] ?? 1;
      g.run.pattern.addSpare('kick', 2);
      g.run.pattern.addSpare('hat', 3);
      g.run.pattern.tracks.forEach((_, i) => g.run.pattern.autoPlace(i));
      g.run.pedals.overdrive = 2;
      g.run.pedals.roadie = 1;
      g.run.pedals.fuzz = 1;
      g.run.level = venue === 1 ? 15 : venue === 2 ? 26 : 33;
      if (venue >= 3) {
        // arriving at festival season: roughly what a Mainstage winner carries
        for (const i of ['tom', 'scratch']) d.give(i);
        g.run.pattern.addSpare('snare', 4);
        g.run.pattern.addSpare('hat', 4);
        g.run.pattern.tracks.forEach((_, i) => g.run.pattern.autoPlace(i));
        g.run.pedals.harmonizer = 2;
        g.run.pedals.hypeman = 1;
        g.run.pattern.fx[4].accent = true;
        g.run.pattern.fx[12].ratchet = 2;
      }
      if (venue >= 2) {
        for (const t of g.run.pattern.tracks) t.level = Math.min(5, t.level + 1);
        g.run.pedals.overdrive = 4;
        g.run.pattern.fx[0].accent = true;
        g.run.pattern.fx[8].ratchet = 2;
      }
      g.run.refresh(true);
      g.run.hp = g.run.stats.maxHp;
      d.venue(venue);
      d.bot(true);
    }, venue);
    const t0 = Date.now();
    let n = 0;
    while (Date.now() - t0 < mins * 60000) {
      await sleep(20000);
      n++;
      const info = await E(() => ({ st: window.__encore.state(), run: window.__encore.runInfo() }));
      console.log(`[${n * 20}s]`, JSON.stringify(info));
      if (info.st === 'results' || info.st === 'title') break;
    }
    console.log('fps', await fps());
  },
  async finale() {
    const fv = Number(opt('venue', '2'));
    await start();
    await E((fv) => {
      const d = window.__encore;
      d.god();
      d.give('hat');
      d.give('lead');
      d.venue(fv);
      d.skip(999);
    }, fv);
    await sleep(3500);
    await E(() => {
      const g = window.__encore.game;
      if (g.boss?.entry) g.boss.entry.hp = 1;
    });
    await sleep(2200);
    await shot('finale');
    await sleep(3000);
    await shot('finale-2');
    await sleep(6000);
    await shot('win-results');
    console.log('state', await E(() => window.__encore.state()));
  },
  /** Social preview: the victory lap wide shot (the LED wall spells the title). Use --w=1200 --h=630. */
  async ogfinale() {
    await start();
    await E(() => {
      const d = window.__encore;
      d.god();
      for (const i of ['hat', 'bass', 'lead', 'clap']) d.give(i);
      d.venue(2);
      const cols = [0xff3b5c, 0xff9a2e, 0xffe14d, 0x2ee6ff, 0x8cff5a, 0xff4df0, 0xb04dff];
      for (let i = 0; i < 160; i++) d.game.paint.splat((Math.random() - 0.5) * 50, (Math.random() - 0.5) * 36, 1 + Math.random(), cols[i % cols.length], 1);
      d.skip(999);
    });
    await sleep(3500);
    await E(() => {
      const g = window.__encore.game;
      if (g.boss?.entry) g.boss.entry.hp = 1;
    });
    await sleep(5200);
    await E(() => document.getElementById('ui').style.setProperty('visibility', 'hidden'));
    await shot('og');
  },
  async og() {
    await start();
    await E(() => {
      const d = window.__encore;
      const g = d.game;
      d.god();
      for (const i of ['hat', 'bass', 'lead', 'clap', 'scratch']) d.give(i);
      d.skip(100);
      d.spawn('mote', 90);
      d.spawn('mute', 12);
      d.spawn('bouncer', 1);
      d.hype();
      g.player.x = -4;
      g.player.z = 2;
      // a floor that's already been painted by the show so far
      const cols = [0xff3b5c, 0xff9a2e, 0xffe14d, 0x2ee6ff, 0x8cff5a, 0xff4df0, 0xb04dff];
      for (let i = 0; i < 260; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = 3 + Math.random() * 16;
        g.paint.splat(-4 + Math.cos(a) * r * 1.4, 2 + Math.sin(a) * r, 0.9 + Math.random() * 1.2, cols[i % cols.length], 1);
      }
    });
    await dance(2500);
    await page.keyboard.press('KeyQ');
    const t0 = Date.now();
    while (Date.now() - t0 < 8000 && (await E(() => window.__encore.game.dropState)) !== 'active') await sleep(40);
    await sleep(700);
    await E(() => document.getElementById('ui').style.setProperty('visibility', 'hidden'));
    await shot('og');
  },
  async density() {
    console.log('density', JSON.stringify(await E(() => window.__encore.density())));
  },
  async mix() {
    const rep = await E(() => window.__encore.mix());
    for (const [k, v] of Object.entries(rep)) console.log(k.padEnd(10), 'peak', String(v.peak).padStart(6), 'rms', String(v.rms).padStart(6));
  },
  async bot() {
    const mins = Number(opt('mins', '4'));
    await start();
    await E(() => window.__encore.bot(true));
    const t0 = Date.now();
    let n = 0;
    while (Date.now() - t0 < mins * 60000) {
      await sleep(20000);
      n++;
      const info = await E(() => ({ st: window.__encore.state(), run: window.__encore.runInfo() }));
      console.log(`[${n * 20}s]`, JSON.stringify(info));
      if (n % 3 === 0) await shot(`bot-${n * 20}s`);
      if (info.st === 'results' || info.st === 'title') break;
    }
    const log = await E(() => window.__encore.botLog());
    console.log('log', JSON.stringify(log.filter((_, i) => i % 10 === 0)));
    console.log('fps', await fps());
  },
  /** Phone play: run with --mobile --w=844 --h=390. Drives the touch stick with synthetic pointer events. */
  async touch() {
    await sleep(600);
    await shot('touch-title');
    await page.touchscreen.tap(w / 2, hgt / 2);
    await sleep(1800);
    await shot('touch-menu');
    await E(() => window.__encore.game.startRun('standard'));
    await sleep(2500);
    const finger = (type, x, y) =>
      E(
        ([type, x, y]) => {
          const target = type === 'pointerdown' ? document.querySelector('.tzone') : window;
          target.dispatchEvent(new PointerEvent(type, { pointerType: 'touch', pointerId: 7, clientX: x, clientY: y, bubbles: true }));
        },
        [type, x, y],
      );
    await finger('pointerdown', 150, hgt - 110);
    for (let k = 0; k < 20; k++) {
      await finger('pointermove', 150 + Math.cos(k * 0.4) * 50, hgt - 110 + Math.sin(k * 0.4) * 50);
      await sleep(120);
    }
    await shot('touch-play');
    const moved = await E(() => {
      const p = window.__encore.game.player;
      return { x: +p.x.toFixed(2), z: +p.z.toFixed(2) };
    });
    console.log('player after stick', JSON.stringify(moved));
    await finger('pointerup', 150, hgt - 110);
    await page.touchscreen.tap(w - 70, hgt - 70);
    await E(() => (window.__encore.game.run.hype = 1));
    await sleep(900);
    await shot('touch-drop-ready');
    await E(() => window.__encore.levelUp());
    await sleep(1500);
    await shot('touch-draft');
  },
  async title() {
    await sleep(800);
    await shot('title-press');
    await page.mouse.click(w / 2, hgt / 2);
    await sleep(2200);
    await shot('title-menu');
  },
  async play() {
    await start();
    await sleep(1500);
    await shot('play-start');
    await dance(9000);
    await shot('play-9s');
    console.log('fps early', await fps());
  },
  async busy() {
    await start();
    await E(() => {
      const d = window.__encore;
      d.god();
      d.bot(true);
      d.skip(110);
      d.spawn('mote', 60);
      d.spawn('static', 20);
      d.spawn('mute', 10);
      d.spawn('shusher', 8);
      d.spawn('damper', 2);
    });
    await dance(1500);
    await E(() => window.__encore.profReset());
    await dance(5000);
    await shot('busy');
    console.log('fps busy', await fps());
    console.log('prof', JSON.stringify(await E(() => window.__encore.prof())));
  },
  async evolved() {
    await start();
    await E(() => {
      const d = window.__encore;
      const g = d.game;
      d.god();
      for (const i of ['hat', 'bass', 'lead', 'clap', 'tom', 'scratch']) d.give(i);
      for (const t of g.run.pattern.tracks) {
        t.level = 5;
        t.evolved = true;
        t.notes = t.notes.map((_, k) => k % 2 === 0);
      }
      g.run.pattern.fx[0].accent = true;
      g.run.pattern.fx[4].ratchet = 3;
      g.run.pattern.fx[8].echo = true;
      g.run.pattern.version++;
      g.checkGroovesLive();
      d.skip(120);
      d.spawn('mote', 120);
      d.spawn('mute', 30);
      d.spawn('bouncer', 2);
    });
    await dance(4000);
    await shot('evolved');
    console.log('fps evolved', await fps());
    console.log('prof', JSON.stringify(await E(() => window.__encore.prof())));
    const info = await E(() => window.__encore.runInfo());
    console.log('info', JSON.stringify({ kills: info.kills, best: info.bestHit, dmg: Math.round(info.damage) }));
  },
  async icons() {
    await page.mouse.click(w / 2, hgt / 2);
    await sleep(300);
    await E(() => {
      const g = window.__encore.game;
      const ids = ['overdrive','fuzz','metronome','clicktrack','wah','looper','groupies','roadie','energy','stagedive','hypeman','ampstack','encore','goldchain','harmonizer','sustain'];
      const box = document.createElement('div');
      box.style.cssText = 'position:fixed;inset:0;z-index:99;background:#0d0918;display:grid;grid-template-columns:repeat(8,1fr);gap:8px;padding:20px;';
      for (const id of ids) {
        const cell = document.createElement('div');
        cell.style.cssText = 'display:grid;justify-items:center;color:#fff;font:12px monospace;background:#1c1430;border-radius:12px;padding:6px';
        const img = document.createElement('img');
        img.src = g.icons.pedal(id);
        img.style.width = '150px';
        cell.append(img, id);
        box.append(cell);
      }
      document.body.append(box);
    });
    await sleep(500);
    await shot('icons');
  },
  async groove() {
    await start();
    await sleep(800);
    await E(() => {
      const g = window.__encore.game;
      const k = g.run.pattern.track('kick');
      k.notes = new Array(16).fill(false);
      for (const i of [0, 4, 8, 12]) k.notes[i] = true;
      g.run.pattern.version++;
      g.checkGroovesLive();
    });
    await sleep(700);
    await shot('groove-stamp');
  },
  async draft() {
    await start();
    await sleep(1200);
    await E(() => window.__encore.levelUp(1));
    await sleep(1500);
    await shot('draft');
    await page.keyboard.press('Digit1');
    await sleep(220);
    await shot('draft-flying');
    await sleep(680);
    await shot('draft-picked');
  },
  async build() {
    await start();
    await E(() => {
      const d = window.__encore;
      d.god();
      d.bot(true);
      for (const i of ['hat', 'bass', 'lead', 'clap', 'tom', 'scratch', 'crash']) d.give(i);
      d.skip(90);
      d.spawn('mote', 80);
      d.spawn('mute', 16);
    });
    await dance(7000);
    await shot('build');
    console.log('fps build', await fps());
  },
  async drop() {
    await start();
    await E(() => {
      const d = window.__encore;
      d.god();
      d.give('hat');
      d.give('bass');
      d.spawn('mote', 70);
      d.hype();
    });
    await sleep(600);
    await page.keyboard.press('KeyQ');
    const until = async (fn, ms = 8000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        if (await E(fn)) return true;
        await sleep(30);
      }
      return false;
    };
    await until(() => window.__encore.game.buildT > 0.55);
    await shot('drop-build');
    await until(() => window.__encore.game.dropState === 'active');
    await sleep(120);
    await shot('drop');
    await sleep(1100);
    await shot('drop-mid');
  },
  async boss() {
    await start();
    await E(() => {
      const d = window.__encore;
      d.god();
      d.give('hat');
      d.give('bass');
      d.give('lead');
      d.skip(999);
    });
    await dance(5000);
    await shot('boss');
  },
  /** Milestone plaque: force the next record-hit threshold low so the first real hit trips it. */
  async plaque() {
    await start();
    await E(() => {
      window.__encore.god();
      window.__encore.game.run.hitMilestone = 10;
    });
    await page.waitForFunction(() => document.querySelector('.plaque'), null, { timeout: 20000 });
    await sleep(500);
    await shot('plaque');
  },
  /** The headliner's entrance: letterbox, spotlight, name card. */
  async intro() {
    await start();
    await E(() => {
      const d = window.__encore;
      d.god();
      d.venue(1);
      d.give('hat');
    });
    await sleep(1500);
    await E(() => window.__encore.skip(999));
    await page.waitForFunction(() => !!window.__encore.game.boss, null, { timeout: 15000 });
    await sleep(700);
    await shot('intro-1');
    await sleep(900);
    await shot('intro-2');
    await sleep(1600);
    await shot('intro-3');
  },
  async boss2() {
    await start();
    await E(() => {
      const d = window.__encore;
      d.god();
      d.venue(1);
      d.give('hat');
      d.give('bass');
      d.skip(999);
    });
    await dance(6000);
    await shot('boss2');
  },
  async boss3() {
    await start();
    await E(() => {
      const d = window.__encore;
      d.god();
      d.venue(2);
      d.give('hat');
      d.give('lead');
      d.skip(999);
    });
    await dance(6000);
    await shot('boss3');
    // push into the silence phase
    await E(() => {
      const g = window.__encore.game;
      if (g.boss?.entry) g.boss.entry.hp = g.boss.entry.maxHp * 0.6;
    });
    await dance(4000);
    await shot('boss3-silence');
  },
  /** Close-up of the enemy line-up (--venue=N dresses them for that stop). */
  async critters() {
    const v = Number(opt('venue', '0'));
    await start();
    await E((v) => {
      const d = window.__encore;
      d.god();
      if (v > 0) d.venue(v);
    }, v);
    await sleep(1200);
    await E(() => {
      const g = window.__encore.game;
      const kinds = ['mote', 'mote', 'mote', 'shusher', 'mute', 'static', 'damper', 'bouncer'];
      kinds.forEach((k, i) => {
        const e = g.enemies.spawn(k, g.player.x - 7 + i * 2, g.player.z - 5, 50, false);
        if (e) {
          e.speed = 0.4;
          e.spawnT = 1;
        }
      });
      window.__encore.cam(15, 0.62);
    });
    await sleep(1400);
    await shot(`critters${v}`);
    await E(() => window.__encore.cam(0));
  },
  /** Any headliner: --venue=N. Entrance, the fight, then phase two. */
  async bossat() {
    const v = Number(opt('venue', '3'));
    await start();
    await E((v) => {
      const d = window.__encore;
      d.god();
      for (const i of ['hat', 'bass', 'lead', 'clap']) d.give(i);
      d.venue(v);
    }, v);
    await sleep(1500);
    await E(() => window.__encore.skip(999));
    await page.waitForFunction(() => !!window.__encore.game.boss, null, { timeout: 15000 });
    await sleep(900);
    await shot(`boss${v}-intro`);
    await dance(4500);
    await shot(`boss${v}-a`);
    await E(() => {
      const g = window.__encore.game;
      if (g.boss?.entry) g.boss.entry.hp = g.boss.entry.maxHp * 0.45;
    });
    await dance(4500);
    await shot(`boss${v}-b`);
  },
  /** Inspect any tour stop: --venue=N (3 fields, 4 desert, 5 megafest). Play shot, wide shot, far vista. */
  async stage() {
    const v = Number(opt('venue', '3'));
    await start();
    await E((v) => {
      const d = window.__encore;
      d.god();
      for (const i of ['hat', 'bass', 'lead', 'clap']) d.give(i);
      d.venue(v);
    }, v);
    await sleep(1800);
    await E(() => window.__encore.spawn('mote', 50));
    await dance(5000);
    await shot(`stage${v}`);
    await E(() => document.getElementById('ui').style.setProperty('visibility', 'hidden'));
    await E(() => window.__encore.cam(95, 0.75));
    await sleep(1500);
    await shot(`stage${v}-wide`);
    await E(() => window.__encore.cam(170, 0.5));
    await sleep(1500);
    await shot(`stage${v}-vista`);
    await E(() => window.__encore.cam(0));
  },
  async cathedral() {
    await start();
    await E(() => {
      window.__encore.god();
      window.__encore.venue(1);
    });
    await sleep(800);
    await E(() => window.__encore.spawn('mote', 40));
    await dance(5000);
    await shot('cathedral');
  },
  async mainstage() {
    await start();
    await E(() => {
      window.__encore.god();
      window.__encore.venue(2);
    });
    await sleep(800);
    await E(() => {
      window.__encore.spawn('mote', 40);
      const g = window.__encore.game;
      g.player.x = 22;
      g.player.z = 8;
    });
    await dance(5000);
    await shot('mainstage');
    console.log('fps mainstage', await fps());
  },
  async backstage() {
    await start();
    await E(() => {
      window.__encore.tips(300);
      window.__encore.backstage();
    });
    await sleep(1400);
    await shot('backstage');
  },
  async results() {
    await start();
    await sleep(800);
    await E(() => window.__encore.results(false));
    await sleep(1200);
    await shot('results');
  },
  async poster() {
    await start();
    await E(() => {
      const d = window.__encore;
      for (const i of ['hat', 'bass', 'lead', 'clap', 'scratch']) d.give(i);
      d.game.run.kills = 4821;
      d.game.run.bestHit = 18342;
      d.game.run.level = 31;
      d.game.run.time = 842;
      d.game.run.venueIndex = 2;
      // a show's worth of paint on the floor (stands in for ~5,000 kills)
      const cols = [0xff3b5c, 0xff9a2e, 0xffe14d, 0x2ee6ff, 0x8cff5a, 0xff5ec8, 0xb04dff];
      for (let i = 0; i < 400; i++) d.game.paint.splat((Math.random() - 0.5) * 56, (Math.random() - 0.5) * 40, 1 + Math.random() * 1.5, cols[i % cols.length], 1);
    });
    await sleep(500);
    await E(() => window.__encore.results(true));
    await sleep(800);
    const dl = page.waitForEvent('download', { timeout: 15000 });
    await page.getByText('SAVE POSTER').click();
    const file = await dl;
    await file.saveAs(`${out}/poster.png`);
    console.log('saved poster', `${out}/poster.png`);
  },
  async merch() {
    await page.mouse.click(w / 2, hgt / 2);
    await E(() => window.__encore.fans(800));
    await sleep(300);
    await E(() => window.__encore.game.openMerch());
    await sleep(700);
    await shot('merch');
    await page.locator('.merch-tab', { hasText: 'UPGRADES' }).click();
    await sleep(500);
    await shot('merch-upgrades');
    // buy one to see levels fill
    await page.locator('.merch-item.upgrade .btn.primary').first().click();
    await sleep(500);
    await shot('merch-bought');
    await E(() => ['club', 'digger', 'opening', 'addict'].forEach((b) => window.__encore.badge(b)));
    await page.locator('.merch-tab', { hasText: 'BADGES' }).click();
    await sleep(600);
    await page.locator('.mic-skin', { hasText: 'GOLD RECORD' }).click();
    await sleep(600);
    await shot('merch-badges');
  },
  async settings() {
    await start();
    await E(() => {
      const d = window.__encore;
      d.god();
      for (const i of ['hat', 'bass', 'clap']) d.give(i);
    });
    await dance(5000);
    await page.keyboard.press('Escape');
    await sleep(900);
    await shot('pause');
    await page.locator('.pause button', { hasText: 'SETTINGS' }).click();
    await sleep(700);
    await shot('settings');
  },
  async howto() {
    await page.mouse.click(w / 2, hgt / 2);
    await sleep(300);
    await E(() => window.__encore.game.howto.setVisible(true));
    await sleep(600);
    await shot('howto');
  },
};

for (const name of scenarios.length ? scenarios : ['title', 'play']) {
  const fn = S[name];
  if (!fn) {
    console.log('unknown scenario', name);
    continue;
  }
  try {
    await fn();
  } catch (e) {
    console.log('scenario failed', name, e.message);
  }
  // fresh page state between scenarios
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__encore && window.__encore.state() === 'title', null, { timeout: 30000 });
  await sleep(400);
}
if (logs.length) console.log('console:\n' + [...new Set(logs)].slice(0, 30).join('\n'));
await browser.close();
