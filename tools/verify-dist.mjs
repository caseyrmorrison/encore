// Post-build gate: fail CI if the shipped bundle is missing its CSP or leaks dev-only code.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'dist';
const fail = (msg) => {
  console.error(`verify-dist: ${msg}`);
  process.exitCode = 1;
};
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const head = html.slice(html.indexOf('<head>'), html.indexOf('<head>') + 400);
if (!/http-equiv="Content-Security-Policy"/.test(head)) fail('CSP meta is not the first tag in <head>');
if (/unsafe-inline|unsafe-eval/.test(html)) fail('CSP allows unsafe-*');
if (/<script(?![^>]*\bsrc=)[^>]*>/.test(html)) fail('inline <script> present');

const assets = readdirSync(join(dist, 'assets'));
for (const f of assets) {
  if (f.endsWith('.map')) fail(`sourcemap shipped: ${f}`);
  if (/^mix-/.test(f)) fail(`dev chunk shipped: ${f}`);
  if (f.endsWith('.js')) {
    const js = readFileSync(join(dist, 'assets', f), 'utf8');
    for (const needle of ['__encore', 'profReset', 'botLog', 'densityReport']) {
      if (js.includes(needle)) fail(`dev-only symbol "${needle}" in ${f}`);
    }
    if (/\binnerHTML\s*=|insertAdjacentHTML|document\.write\(/.test(js) && !/three|postprocessing/.test(f)) {
      fail(`HTML sink in ${f}`);
    }
  }
}
if (!process.exitCode) console.log(`verify-dist: ok (${assets.length} assets)`);
