import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({
  configFile: new URL('../vite.config.ts', import.meta.url).pathname,
  root: new URL('..', import.meta.url).pathname,
  server: { port: 0 },
});
let browser;
try {
  await server.listen();
  for (const engine of [chromium, webkit]) {
    browser = await engine.launch();
    const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
    await page.goto(server.resolvedUrls.local[0]);
    await page.getByRole('button', { name: 'Long history', exact: false }).click();
    const viewport = page.locator('.message-list');
    // Offscreen messages must not move the text being read as their layout becomes visible.
    await viewport.evaluate((element) => { element.scrollTop = 3000; });
    await page.waitForTimeout(100);
    const bounds = await viewport.boundingBox();
    const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    await page.mouse.move(point.x, point.y);
    let checked = 0;
    for (let step = 0; step < 20; step++) {
      const before = await page.evaluate(({ x, y }) => {
        window.readingAnchor = document.elementFromPoint(x, y)?.closest('.chat-message');
        const scroll = document.querySelector('.message-list');
        return { y: window.readingAnchor?.getBoundingClientRect().top, top: scroll.scrollTop };
      }, point);
      await page.mouse.wheel(0, -80);
      await page.waitForTimeout(160);
      const after = await page.evaluate(() => ({
        y: window.readingAnchor?.getBoundingClientRect().top,
        top: document.querySelector('.message-list').scrollTop,
      }));
      if (before.y === undefined || after.y === undefined) continue;
      checked++;
      assert(Math.abs(after.y - before.y + after.top - before.top) < 4,
        `Reading position shifted beyond the requested scroll: ${JSON.stringify({ before, after, step })}`);
    }
    assert(checked >= 10, 'Measure visible messages during sustained scrolling');
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
    console.log(`${engine.name()}: reading position stays stable; submission and streaming follow the bottom.`);
    await browser.close();
    browser = undefined;
  }
} finally {
  await browser?.close();
  await server.close();
}
