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
const page = await browser.newPage({ viewport: { width: w, height: hgt }, deviceScaleFactor: 1 });
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
  await E(() => window.__encore.game.startRun('standard'));
  await sleep(500);
  await page.mouse.move(w / 2 + 200, hgt / 2 - 100);
};

const S = {
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
  async draft() {
    await start();
    await sleep(1200);
    await E(() => window.__encore.levelUp(1));
    await sleep(1500);
    await shot('draft');
    await page.keyboard.press('Digit1');
    await sleep(900);
    await shot('draft-picked');
  },
  async build() {
    await start();
    await E(() => {
      const d = window.__encore;
      d.god();
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
    await sleep(2600);
    await shot('drop-build');
    await sleep(500);
    await shot('drop');
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
    await E(() => window.__encore.spawn('mote', 40));
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
  async merch() {
    await page.mouse.click(w / 2, hgt / 2);
    await E(() => window.__encore.fans(800));
    await sleep(300);
    await E(() => window.__encore.game.openMerch());
    await sleep(700);
    await shot('merch');
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
