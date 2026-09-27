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
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  await page.goto(server.resolvedUrls.local[0]);
  await page.getByRole('button', { name: 'Long history', exact: false }).click();
  const viewport = page.locator('.message-list');
  await viewport.evaluate((element) => { element.scrollTop = 0; });
  await page.getByRole('button', { name: 'Scroll to bottom', exact: true }).waitFor();
  const before = await viewport.evaluate((element) => element.scrollHeight);
  const editor = page.locator('.chat-rich-text-editor');
  await editor.fill('Continue the work');
  await editor.press('Enter');
  await page.getByText('Mock stream completed', { exact: true }).waitFor();
  await page.waitForFunction(() => {
    const element = document.querySelector('.message-list');
    return element && element.scrollHeight - element.scrollTop - element.clientHeight <= 24;
  }, undefined, { timeout: 3000 });
  assert(await viewport.evaluate((element) => element.scrollHeight) > before,
    'The stream must grow the transcript');
  assert.equal(await page.getByRole('button', { name: 'Scroll to bottom', exact: true }).count(), 0);
  console.log('Composer submission and streaming follow the bottom in Chromium.');
} finally {
  await browser?.close();
  await server.close();
}
