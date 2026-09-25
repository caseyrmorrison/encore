import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
await page.addInitScript(() => {
  document.addEventListener('securitypolicyviolation', (e) =>
    console.error(`CSP VIOLATION ${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}`),
  );
});
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto('http://localhost:5311/', { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await page.mouse.click(720, 450);
await page.waitForTimeout(1500);
await page.keyboard.press('Enter');
await page.waitForTimeout(5000);
await page.screenshot({ path: process.argv[2] });
// exercise the level-up draft + results/poster paths under the production CSP
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
await page.getByText('QUIT RUN').click();
await page.waitForTimeout(1200);
const dl = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
await page.getByText('SAVE POSTER').click();
console.log('poster download:', (await dl) ? 'ok' : 'none');
console.log(logs.filter((l) => !l.includes('toNonIndexed')).join('\n') || 'no console output');
await browser.close();
