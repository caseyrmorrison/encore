// Proves the production CSP is enforced (not merely present): inline script injection must fail.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
await page.goto(process.argv[2] ?? 'http://localhost:5311/', { waitUntil: 'networkidle' });
const result = await page.evaluate(() => {
  const out = {};
  try {
    const s = document.createElement('script');
    s.textContent = 'window.__pwned = 1';
    document.body.append(s);
    out.inlineScript = window.__pwned === 1 ? 'EXECUTED' : 'blocked';
  } catch (e) {
    out.inlineScript = `blocked (${e.name})`;
  }
  try {
    document.body.insertAdjacentHTML('beforeend', '<img src=x onerror="window.__pwned2=1">');
    out.htmlSink = 'allowed';
  } catch (e) {
    out.htmlSink = `blocked (${e.name})`;
  }
  return out;
});
await page.waitForTimeout(300);
result.onerror = (await page.evaluate(() => window.__pwned2)) === 1 ? 'EXECUTED' : 'blocked';
console.log(JSON.stringify(result));
await browser.close();
