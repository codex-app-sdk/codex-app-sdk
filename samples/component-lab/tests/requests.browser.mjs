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
  await page.getByRole('button', { name: 'Approvals & questions', exact: false }).click();
  const editor = page.locator('.chat-rich-text-editor');
  await editor.fill('/goal');
  await editor.press('Tab');
  await page.locator('[aria-label="Active composer modes"]').waitFor();
  await editor.fill('My unfinished prompt');
  await editor.evaluate((element) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File(['Draft context'], 'notes.txt', { type: 'text/plain' }));
    element.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer }));
  });
  await page.getByRole('button', { name: 'Remove notes.txt', exact: true }).waitFor();
  await page.getByRole('combobox', { name: 'Question format' }).selectOption('text');

  for (const [trigger, cancel] of [
    ['Request approval', false], ['Request approval', true],
    ['Command approval', false], ['Command approval', true],
    ['Ask blocking', false], ['Ask async', false], ['Ask async', true],
  ]) {
    // A real selection change must survive the editor's unmount/remount, not
    // merely remain in a parent prop while the caret jumps to the end.
    await editor.focus();
    await editor.press('Home');
    await editor.press('ArrowRight');
    await editor.press('ArrowRight');
    await editor.press('ArrowRight');
    if (trigger.startsWith('Ask')) {
      await page.getByRole('combobox', { name: 'Question delivery' }).selectOption(trigger === 'Ask blocking' ? 'tool' : 'async');
      await page.getByRole('button', { name: 'Ask question', exact: true }).click();
    } else {
      await page.getByRole('button', { name: trigger === 'Command approval' ? 'Native approval' : 'Tool confirmation', exact: true }).click();
    }
    assert.equal(await editor.count(), 0, `${trigger} must replace the composer`);
    const footer = page.locator('.codex-conversation-pane__footer');
    const bounds = await footer.boundingBox();
    assert(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 800,
      'The request must be visible in the composer area without scrolling');
    if (trigger === 'Command approval' || trigger === 'Request approval') {
      assert((await footer.innerText()).includes('Approve tool call'), 'All approval types use the same labeled card');
      await footer.locator('summary').click();
      assert((await footer.innerText()).includes(trigger === 'Command approval' ? 'npm test' : 'git status'));
      const labels = await footer.locator('button').allTextContents();
      assert.equal(labels[0].trim(), 'Allow', 'The primary decision is consistently first');
    }
    if (trigger === 'Command approval') {
      await footer.getByRole('button', { name: cancel ? 'Deny' : 'Allow', exact: true }).click();
    } else if (trigger === 'Request approval') {
      assert.equal(await page.locator('.codex-conversation-pane__messages .chat-tool-confirmation:not(.chat-tool-confirmation--resolved)').count(), 0);
      await footer.getByRole('button', { name: cancel ? 'Deny' : 'Allow', exact: true }).click();
    } else if (cancel) {
      await footer.getByRole('button', { name: 'Cancel question', exact: true }).click();
    } else {
      await footer.locator('textarea').fill('Use these details');
      await footer.locator('textarea').press('Enter');
    }
    await editor.waitFor();
    assert.equal((await page.locator('[aria-label="Active composer modes"]').innerText()).trim(), 'Goal');
    assert.equal(await editor.innerText(), 'My unfinished prompt');
    await page.getByRole('button', { name: 'Remove notes.txt', exact: true }).waitFor();
    // Typing at the restored caret is the observable selection contract.
    await page.keyboard.type('X');
    assert.equal(await editor.innerText(), 'My Xunfinished prompt', `${trigger} must restore the caret`);
    await editor.press('Backspace');
  }
  await page.getByRole('combobox', { name: 'Question format' }).selectOption('choices');
  await page.getByRole('combobox', { name: 'Question steps' }).selectOption('multiple');
  await page.getByRole('button', { name: 'Ask question', exact: true }).click();
  const otherInput = page.locator('.chat-tool-user-input__write textarea');
  assert(await otherInput.isVisible(), 'The written answer must be editable without first selecting anything');
  const inputBounds = await otherInput.boundingBox();
  assert(inputBounds && inputBounds.height <= 36, 'The written answer starts as a compact one-line field');
  const cardBounds = await page.locator('.codex-conversation-pane__question-composer').boundingBox();
  const dividerBounds = await page.locator('.chat-tool-user-input__footer--divided').boundingBox();
  const above = inputBounds.y - (dividerBounds.y + 1);
  const below = (cardBounds.y + cardBounds.height - 1) - (inputBounds.y + inputBounds.height);
  assert(Math.abs(above - below) <= 1, `The written answer is centered between the divider and the card edge (${above}px / ${below}px)`);
  const vue = page.getByRole('button', { name: 'Vue', exact: true });
  await page.locator('.codex-conversation-pane__question-composer').focus();
  await page.keyboard.press('1');
  assert.equal(await page.locator('.chat-tool-user-input__index').innerText(), '2 / 2', 'A number key answers a single choice and advances');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  assert.equal(await vue.getAttribute('aria-pressed'), 'true', 'The chosen option is kept when coming back');
  await otherInput.click();
  assert.equal(await vue.getAttribute('aria-pressed'), 'true', 'Focusing the field alone keeps the chosen option');
  await otherInput.pressSequentially('Svelte');
  assert.equal(await vue.getAttribute('aria-pressed'), 'false', 'Writing an answer replaces a single choice');
  await otherInput.press('Shift+Enter');
  await otherInput.pressSequentially('With TypeScript');
  assert((await otherInput.boundingBox()).height > inputBounds.height, 'Other expands for a multiline answer');
  await otherInput.press('Enter');
  await page.locator('.chat-tool-user-input__other-input--direct').fill('Keep it simple');
  await page.locator('.chat-tool-user-input__other-input--direct').press('Enter');
  assert.match(await page.locator('output[aria-live]').innerText(), /Answered: Svelte\s+With TypeScript, Keep it simple/);
  console.log('Requests preserve drafts; Other supports direct focus, inline entry, multiline growth and submission in Chromium.');
} finally {
  await browser?.close();
  await server.close();
}
