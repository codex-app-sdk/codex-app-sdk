import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({
  configFile: new URL('../vite.config.ts', import.meta.url).pathname,
  root: new URL('..', import.meta.url).pathname,
  server: { port: 0 },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch();
  const page = await browser.newPage();
  page.setDefaultTimeout(10_000);
  await page.goto(server.resolvedUrls.local[0]);
  await page.getByRole('button', { name: 'Inline HTML Interactive, sandboxed streaming previews' }).click();
  const next = page.getByRole('button', { name: 'Next HTML chunk', exact: true });
  await next.click();
  const iframe = page.locator('.chat-html-block iframe');
  await iframe.waitFor({ timeout: 5_000 });
  const preview = await (await iframe.elementHandle()).contentFrame();
  await preview.getByRole('textbox', { name: 'Destination' }).fill('Geneva');
  await preview.getByRole('button', { name: '0 visits' }).click();
  await preview.evaluate(() => { window.originalInput = document.querySelector('input'); });
  const initialHeight = (await iframe.boundingBox()).height;

  for (let index = 0; index < 5; index++) {
    await next.click();
    assert.equal(await preview.getByRole('textbox').inputValue(), 'Geneva', 'Streaming must not replace existing form controls');
    assert.equal((await iframe.boundingBox()).height, initialHeight, 'Streaming must not collapse or resize the preview');
  }
  await preview.waitForFunction(() => document.readyState === 'complete' && document.body.dataset.finished === 'yes');
  assert.deepEqual(await preview.evaluate(() => ({
    sameNode: document.querySelector('input') === window.originalInput,
    runs: window.runs,
    counter: document.querySelector('#counter').textContent,
    cards: document.querySelectorAll('article').length,
  })), { sameNode: true, runs: 1, counter: '1 visits', cards: 2 });

  await page.getByRole('button', { name: 'Show HTML source', exact: true }).click();
  assert.match(await page.locator('.chat-html-block pre').innerText(), /<!doctype html>/);
  await page.getByRole('button', { name: 'Show HTML preview', exact: true }).click();
  assert.equal(await preview.getByRole('textbox').inputValue(), 'Geneva', 'Source toggle must preserve the live preview');
  await preview.getByRole('button', { name: '1 visits' }).click();
  assert.equal(await preview.getByRole('button').innerText(), '2 visits');

  // Exercise browser enforcement, rather than merely checking sandbox/CSP strings.
  // Without CSP this route succeeds, so a CORS/network failure cannot produce
  // a false positive for the network-isolation assertion.
  await page.route('https://example.com/preview-network-probe', route => route.fulfill({
    body: 'reachable without CSP', headers: { 'access-control-allow-origin': '*' },
  }));
  const isolation = await preview.evaluate(async () => {
    let parentBlocked = false;
    let storageBlocked = false;
    let fetchBlocked = false;
    try { void parent.document.body; } catch { parentBlocked = true; }
    try { localStorage.setItem('html-preview-test', 'bad'); } catch { storageBlocked = true; }
    try { await fetch('https://example.com/preview-network-probe'); } catch { fetchBlocked = true; }
    return { parentBlocked, storageBlocked, fetchBlocked };
  });
  assert.deepEqual(isolation, { parentBlocked: true, storageBlocked: true, fetchBlocked: true });
  await page.route('**/preview-library.js', route => route.fulfill({
    contentType: 'text/javascript', body: 'window.previewLibraryLoaded = true;',
  }));
  const httpsScriptLoaded = await preview.evaluate(() => new Promise(resolve => {
    const script = document.createElement('script');
    script.src = 'https://example.com/preview-library.js';
    script.onload = () => resolve(window.previewLibraryLoaded === true);
    script.onerror = () => resolve(false);
    document.body.append(script);
  }));
  assert.equal(httpsScriptLoaded, true, 'HTTPS libraries must execute inside the isolated preview');
  const httpScriptBlocked = await preview.evaluate(() => new Promise(resolve => {
    const script = document.createElement('script');
    script.src = 'http://example.com/preview-library.js';
    script.onload = () => resolve(false);
    script.onerror = () => resolve(true);
    document.body.append(script);
  }));
  assert.equal(httpScriptBlocked, true, 'Plain HTTP scripts must remain blocked');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download HTML', exact: true }).click();
  const download = await downloadEvent;
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  const downloaded = Buffer.concat(chunks).toString();
  assert.match(downloaded, /^<!doctype html>/);
  assert.doesNotMatch(downloaded, /<artifact|postMessage|Content-Security-Policy/);
  console.log('Inline HTML preserves DOM, input, script state and geometry through streaming and completion; sandbox isolation enforced.');
} finally {
  await browser?.close();
  await server.close();
}
