import { formatInt, formatTime } from '../core/math';
import { isSafeImageSrc } from './dom';

export interface PosterData {
  won: boolean;
  venueName: string;
  kills: number;
  bestHit: number;
  level: number;
  time: number;
  fans: number;
  seedCode: string;
  daily: boolean;
  grooves: { genre: string; color: string }[];
  tracks: { short: string; css: string; notes: boolean[]; icon: string }[];
}

const W = 1080;
const H = 1350;

function loadImage(src: string): Promise<HTMLImageElement | null> {
  if (!isSafeImageSrc(src)) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function neon(g: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string): void {
  g.font = `${size}px Bungee, Impact, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = color;
  for (const blur of [60, 30, 12]) {
    g.shadowBlur = blur;
    g.fillStyle = color;
    g.fillText(text, x, y);
  }
  g.shadowBlur = 0;
  g.fillStyle = '#fff4f8';
  g.fillText(text, x, y);
}

/** A gig poster of the run, rendered to a PNG blob for saving/sharing. */
export async function renderPoster(d: PosterData): Promise<Blob | null> {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  if (!g) return null;

  // paper: deep night gradient + stage beams + grain
  const bg = g.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#12071f');
  bg.addColorStop(0.55, '#07040d');
  bg.addColorStop(1, '#1a0614');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, H);
  const beams: [number, string][] = [
    [0.18, 'rgba(255,45,120,0.16)'],
    [0.5, 'rgba(46,230,255,0.12)'],
    [0.82, 'rgba(255,197,61,0.13)'],
  ];
  for (const [bx, col] of beams) {
    const gr = g.createLinearGradient(0, 0, 0, H * 0.8);
    gr.addColorStop(0, col);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(W * bx - 20, 0);
    g.lineTo(W * bx + 20, 0);
    g.lineTo(W * bx + 260, H * 0.8);
    g.lineTo(W * bx - 260, H * 0.8);
    g.closePath();
    g.fill();
  }
  const img = g.getImageData(0, 0, W, H);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 14;
    img.data[i] = Math.max(0, img.data[i]! + n);
    img.data[i + 1] = Math.max(0, img.data[i + 1]! + n);
    img.data[i + 2] = Math.max(0, img.data[i + 2]! + n);
  }
  g.putImageData(img, 0, 0);

  // header
  g.fillStyle = 'rgba(255,255,255,0.75)';
  g.font = '600 26px "Space Grotesk", sans-serif';
  g.textAlign = 'center';
  g.fillText(d.won ? 'ONE NIGHT ONLY · SOLD OUT · HEADLINED' : 'LIVE — UNTIL THE HUSH TOOK THE STAGE', W / 2, 70);
  neon(g, 'ENCORE', W / 2, 190, 170, '#ff2d78');
  g.font = '44px Bungee, Impact, sans-serif';
  g.fillStyle = '#ffe9a8';
  g.fillText(d.won ? 'HEADLINED EVERYTHING' : `LIVE AT ${d.venueName}`, W / 2, 320);

  // the band
  const icons = await Promise.all(d.tracks.map((t) => loadImage(t.icon)));
  const n = Math.max(1, icons.length);
  const size = Math.min(130, 900 / n);
  icons.forEach((im, i) => {
    if (!im) return;
    const x = W / 2 - (n * size) / 2 + i * size;
    g.drawImage(im, x, 360, size, size);
  });

  // the machine
  const mx = 90;
  const my = 380 + size + 20;
  const mw = W - 180;
  const rowH = Math.min(34, 250 / Math.max(1, d.tracks.length));
  const mh = rowH * d.tracks.length + 70;
  const mg = g.createLinearGradient(0, my, 0, my + mh);
  mg.addColorStop(0, '#2c2a31');
  mg.addColorStop(1, '#1b1a1f');
  g.fillStyle = mg;
  roundRect(g, mx, my, mw, mh, 22);
  g.fill();
  g.fillStyle = '#ff6a1a';
  g.font = '28px Bungee, Impact, sans-serif';
  g.textAlign = 'left';
  g.fillText('ENCORE', mx + 26, my + 36);
  g.fillStyle = '#cfc8b8';
  g.font = '500 16px "JetBrains Mono", monospace';
  g.fillText('TR-∞ RHYTHM COMPOSER · FINAL SET', mx + 170, my + 36);
  const cellW = (mw - 150) / 16;
  d.tracks.forEach((t, r) => {
    const y = my + 60 + r * rowH;
    g.fillStyle = t.css;
    g.font = `${Math.min(20, rowH * 0.5)}px Bungee, Impact, sans-serif`;
    g.fillText(t.short, mx + 24, y + rowH * 0.62);
    t.notes.forEach((on, s) => {
      const x = mx + 120 + s * cellW;
      g.fillStyle = on ? t.css : '#18181d';
      if (on) {
        g.shadowColor = t.css;
        g.shadowBlur = 14;
      }
      roundRect(g, x + 3, y + 4, cellW - 6, rowH - 8, 5);
      g.fill();
      g.shadowBlur = 0;
    });
  });

  // grooves
  let gy = my + mh + 50;
  if (d.grooves.length) {
    g.font = '24px Bungee, Impact, sans-serif';
    let gx = 0;
    const widths = d.grooves.map((gr) => g.measureText(gr.genre).width + 40);
    const total = widths.reduce((a, b) => a + b + 14, -14);
    gx = W / 2 - total / 2;
    d.grooves.forEach((gr, i) => {
      g.fillStyle = gr.color;
      roundRect(g, gx, gy - 24, widths[i]!, 44, 22);
      g.fill();
      g.fillStyle = '#0b0710';
      g.textAlign = 'center';
      g.fillText(gr.genre, gx + widths[i]! / 2, gy + 6);
      gx += widths[i]! + 14;
    });
    gy += 62;
  }

  // stats
  const stats: [string, string][] = [
    ['SILENCED', formatInt(d.kills)],
    ['BIGGEST HIT', formatInt(d.bestHit)],
    ['LEVEL', String(d.level)],
    ['TIME', formatTime(d.time)],
  ];
  stats.forEach(([label, value], i) => {
    const x = 90 + (i + 0.5) * ((W - 180) / 4);
    g.textAlign = 'center';
    g.fillStyle = '#ffffff';
    g.font = '52px Bungee, Impact, sans-serif';
    g.fillText(value, x, gy + 16);
    g.fillStyle = '#a89fc2';
    g.font = '500 18px "JetBrains Mono", monospace';
    g.fillText(label, x, gy + 52);
  });

  // laid out bottom-up from the ticket stub so a tall machine can never collide with it
  const ty = H - 120;
  const fansY = ty - 66;
  const sy = Math.max(gy + 104, fansY - 118);
  g.textAlign = 'center';
  g.fillStyle = 'rgba(255,255,255,0.45)';
  g.font = '500 18px "JetBrains Mono", monospace';
  g.fillText('WITH VERY SPECIAL GUESTS', W / 2, sy);
  g.fillStyle = '#cbb8ff';
  g.font = '30px Bungee, Impact, sans-serif';
  g.fillText(d.won ? 'THE HUSH (SILENCED)' : 'THE HUSH', W / 2, sy + 38);

  // the headline number: fans won, in gold neon
  neon(g, `+${formatInt(d.fans)} FANS`, W / 2, fansY, 60, '#ffb52e');

  // ticket stub: perforation, ADMIT ONE, and the way back in
  g.strokeStyle = 'rgba(255,255,255,0.28)';
  g.setLineDash([10, 10]);
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(60, ty);
  g.lineTo(W - 60, ty);
  g.stroke();
  g.setLineDash([]);
  for (const x of [0, W]) {
    g.fillStyle = '#0b0710';
    g.beginPath();
    g.arc(x, ty, 26, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#ff2d78';
  g.font = '26px Bungee, Impact, sans-serif';
  g.textAlign = 'left';
  g.fillText('ADMIT ONE', 90, ty + 64);
  g.textAlign = 'right';
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.font = '500 20px "JetBrains Mono", monospace';
  const where = `${location.host}${location.pathname}`.replace(/\/$/, '');
  g.fillText(d.daily ? `DAILY SETLIST · ${where}` : `${where}?seed=${d.seedCode}`, W - 90, ty + 50);
  g.fillStyle = 'rgba(255,255,255,0.4)';
  g.fillText(d.daily ? 'same run for everyone today' : `SEED ${d.seedCode} · play the same show`, W - 90, ty + 80);

  return new Promise((resolve) => c.toBlob((b) => resolve(b), 'image/png'));
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
