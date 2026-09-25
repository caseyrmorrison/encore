import '@fontsource/bungee/400.css';
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/jetbrains-mono/500.css';
import './ui/style.css';
import { Game } from './game/game';

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

async function boot(): Promise<void> {
  const bootEl = document.getElementById('boot');
  const canvas = document.getElementById('stage') as HTMLCanvasElement | null;
  const ui = document.getElementById('ui');
  if (!canvas || !ui) return;
  if (!webglAvailable()) {
    bootEl?.querySelector('.boot-sub')?.replaceChildren('Your browser has WebGL disabled — ENCORE needs it to play.');
    return;
  }
  // canvas-rendered text (damage numbers, neon signs) needs the fonts first
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load('62px Bungee'),
        document.fonts.load('600 18px "Space Grotesk"'),
        document.fonts.load('500 14px "JetBrains Mono"'),
      ]),
      new Promise((r) => setTimeout(r, 2500)),
    ]);
  } catch {
    /* fall back to system fonts */
  }
  // let the loading bar paint before the heavy synchronous setup
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  const game = new Game(canvas, ui);
  game.start();
  bootEl?.classList.add('done');
  setTimeout(() => bootEl?.remove(), 900);
}

void boot();
