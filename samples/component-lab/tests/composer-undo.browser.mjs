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
  await page.goto(server.resolvedUrls.local[0]);
  const editor = page.locator('.chat-rich-text-editor');
  await editor.fill('');
  await editor.pressSequentially('Before ');
  // Deliver both clipboard flavors through the real composer's paste handler.
  await editor.evaluate(element => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', 'pasted text');
    clipboardData.setData('text/html', '<b>pasted text</b>');
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  });
  assert.equal(await editor.innerText(), 'Before pasted text');
  assert.equal(await editor.locator('b').count(), 0);
  await editor.press('ControlOrMeta+z');
  assert.equal(await editor.innerText(), 'Before ', 'Undo must remove the paste, preserving prior typing');
  await editor.press('ControlOrMeta+Shift+z');
  assert.equal(await editor.innerText(), 'Before pasted text', 'Redo must restore the paste');
  await editor.press('ControlOrMeta+a');
  await editor.evaluate(element => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', 'First line\n\nLast line\n');
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  });
  assert.equal((await editor.innerText()).trimEnd(), 'First line\n\nLast line');
  await editor.press('ControlOrMeta+z');
  assert.equal(await editor.innerText(), 'Before pasted text', 'Undo must restore a replaced selection');
  await editor.press('ControlOrMeta+Shift+z');
  assert.equal((await editor.innerText()).trimEnd(), 'First line\n\nLast line');
  await editor.press('Enter');
  const submitted = page.locator('.chat-user-text').filter({ hasText: 'First line' });
  await submitted.waitFor();
  await submitted.scrollIntoViewIfNeeded();
  assert.equal(await submitted.innerText(), 'First line\n\nLast line', 'Submission must preserve the pasted line breaks');

  await editor.pressSequentially('Shift');
  await editor.press('Shift+Enter');
  await editor.pressSequentially('Enter');
  assert.equal(await editor.innerText(), 'Shift\nEnter');
  await editor.press('ControlOrMeta+a');
  await editor.evaluate(element => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', '<img src=x onerror=alert(1)> & text');
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  });
  assert.equal(await editor.innerText(), '<img src=x onerror=alert(1)> & text');
  assert.equal(await editor.locator('img').count(), 0, 'Plain text must not become HTML');
  await editor.press('ControlOrMeta+z');
  assert.equal(await editor.innerText(), 'Shift\nEnter');

  await page.getByRole('button', { name: 'Reset scenario', exact: true }).click();
  await editor.click();
  await editor.pressSequentially('$cp');
  await page.getByRole('option').filter({ hasText: 'Commit-Push' }).click();
  assert.equal(await editor.locator('[data-skill-name="cp"]').count(), 1);
  await editor.press('Shift+Enter');
  await editor.evaluate(element => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', 'after chip');
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  });
  assert.match(await editor.innerText(), /\nafter chip$/);
  await editor.press('ControlOrMeta+z');
  assert.equal(await editor.locator('[data-skill-name="cp"]').count(), 1, 'Undo must preserve existing mention chips');
  assert.doesNotMatch(await editor.innerText(), /after chip/);
  await editor.press('ControlOrMeta+Shift+z');
  assert.match(await editor.innerText(), /\nafter chip$/);
  console.log('Composer text paste participates in native undo and redo.');
} finally {
  await browser?.close();
  await server.close();
}
