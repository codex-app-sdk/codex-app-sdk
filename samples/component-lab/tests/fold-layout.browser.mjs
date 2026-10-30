import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, webkit } from 'playwright';
import { createServer } from 'vite';

const fixtureId = '\0fold-layout-fixture';
const fixture = {
  name: 'fold-layout-fixture',
  configureServer(server) {
    server.middlewares.use(async (request, response, next) => {
      if (request.url !== '/fold-layout') return next();
      response.setHeader('Content-Type', 'text/html');
      response.end(await server.transformIndexHtml(request.url, `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body><div id="app"></div><script type="module" src="/fold-layout.js"></script>
        <style>body { margin: 0; } #app { height: 100vh; display: flex; flex-direction: column; }
        .fixture-layout { flex: 1; min-height: 0; display: grid; }
        .fixture-conversation { min-width: 0; display: flex; } aside { overflow: hidden; }</style></body></html>`));
    });
  },
  resolveId(id) {
    if (id === '/fold-layout.js') return fixtureId;
  },
  load(id) {
    if (id !== fixtureId) return;
    return `
      import { createApp, h, ref, reactive } from 'vue';
      import { CodexConversationPane, createCodexConversationPaneController } from '@codex-app-sdk/vue';
      import '@codex-app-sdk/vue/styles.css';
      const canvas = document.createElement('canvas');
      canvas.width = 180; canvas.height = 120;
      const context = canvas.getContext('2d');
      context.fillStyle = '#edf2ff'; context.fillRect(0, 0, 180, 120);
      context.fillStyle = '#24345c'; context.font = '16px sans-serif'; context.fillText('Screenshot fixture', 12, 65);
      const image = canvas.toDataURL('image/png');
      const questions = [{ id: 'branch', header: 'Branch',
        question: 'Where should the tool read the delivery branch from?', isOther: true, isSecret: false,
        options: [{ label: 'Input only', description: 'Read the caller branch input.' },
          { label: 'Keep both', description: 'Validate both settings.' }] }];
      // Both tools must share an assistant message: separating them bypasses the fold.
      const messages = [{ id: 'assistant', role: 'assistant', status: 'streaming', turnId: 'turn', parts: [
        { type: 'tool', id: 'original', kind: 'generic', title: 'AskUserQuestion', status: 'running', input: {} },
        { type: 'tool', id: 'question', kind: 'generic', title: 'ask_user_question', status: 'running',
          input: questions, statusText: JSON.stringify({ source: 'codex', action: 'ask_user_question',
            phase: 'running', params: { requestId: 'request', questions } }), metadata: { requestId: 'request' } },
      ] }];
      const state = reactive({
        identity: { conversationKey: 'fold-layout', messages, busy: true, activeTurnId: 'turn' },
        thread: { queuedPrompts: [{ id: 'long', text: 'Standardize the host selectors. '.repeat(20) + '/repository/'.repeat(30) }] },
      });
      window.detailReads = 0;
      const controller = createCodexConversationPaneController({ state, actions: {
        async loadTurnHistory(turnId) {
          window.detailReads++;
          state.identity.turns.find(turn => turn.id === turnId).detailsLoading = true;
          await new Promise(resolve => setTimeout(resolve, 100));
          state.identity.messages = state.identity.messages.map(message => message.turnId === turnId && message.role === 'assistant'
            ? { ...message, parts: [{ type: 'text', text: 'Investigated the work. '.repeat(400), phase: 'commentary' },
              ...Array.from({ length: 3 }, (_, i) => ({ type: 'media', phase: 'commentary', media: { url: image, title: 'Tool screenshot '+i, width: 100, height: 100 } })), ...message.parts] } : message);
          Object.assign(state.identity.turns.find(turn => turn.id === turnId), { itemsView: 'full', detailsLoading: false });
        },
      } });
      createApp({ setup() {
        const sidebarOpen = ref(true);
        const sidebarWidth = ref(180);
        return () => [
          h('header', [
            h('button', { onClick: () => { state.identity = {
              conversationKey: 'summary-browser', busy: false, activeTurnId: null,
              turns: Array.from({ length: 20 }, (_, i) => ({ id: 'summary-'+i, status: 'completed', itemsView: 'summary', durationMs: 109000 })),
              messages: Array.from({ length: 20 }, (_, i) => [
                { id: 'user-'+i, role: 'user', status: 'complete', turnId: 'summary-'+i, parts: [{ type: 'text', text: 'Request '+i }] },
                { id: 'answer-'+i, role: 'assistant', status: 'complete', turnId: 'summary-'+i, parts: [{ type: 'text', text: 'Final answer '+i+'\\n\\n![Phone]('+image+')\\n\\n![Desktop]('+image+')', phase: 'final_answer' }] },
              ]).flat(),
            }; } }, 'Summary history'),
            h('button', { onClick: () => { sidebarOpen.value = !sidebarOpen.value; } }, 'Toggle sidebar'),
            h('input', { type: 'range', min: 100, max: 300, step: 40, value: sidebarWidth.value,
              'aria-label': 'Sidebar width', onInput: event => { sidebarWidth.value = Number(event.target.value); } }),
          ]),
          h('main', { class: 'fixture-layout', style: {
            gridTemplateColumns: (sidebarOpen.value ? sidebarWidth.value : 0) + 'px minmax(0, 1fr)',
          } }, [h('aside', 'Sidebar'), h('section', { class: 'fixture-conversation' }, h(CodexConversationPane, { controller }))]),
        ];
      } }).mount('#app');
    `;
  },
};
const server = await createServer({
  configFile: new URL('../vite.config.ts', import.meta.url).pathname,
  root: new URL('..', import.meta.url).pathname,
  plugins: [fixture],
  server: { port: 0 },
});
const artifacts = process.env.FOLD_LAYOUT_ARTIFACTS;
if (artifacts) await mkdir(artifacts, { recursive: true });
let browser;
try {
  await server.listen();
  for (const engine of [chromium, webkit]) {
    browser = await engine.launch();
    const page = await browser.newPage({ viewport: { width: 760, height: 838 } });
    page.setDefaultTimeout(10_000);
    await page.goto(new URL('/fold-layout', server.resolvedUrls.local[0]).href);
    const card = page.locator('.chat-tool-user-input');
    await card.waitFor();
    const widths = [];
    const measure = async (state) => {
      const bounds = await card.evaluate(element => ({
        card: element.getBoundingClientRect().width,
        content: element.closest('.chat-message__stack').getBoundingClientRect().width,
        contained: [...element.closest('.codex-conversation-pane').querySelectorAll('.chat-composer, .chat-queued-prompt__actions')].every(child => {
          const pane = element.closest('.codex-conversation-pane').getBoundingClientRect();
          const rect = child.getBoundingClientRect();
          return rect.left >= pane.left && rect.right <= pane.right;
        }),
      }));
      assert(Math.abs(bounds.card - bounds.content) <= 1,
        `${engine.name()} ${state}: the folded question must fill the conversation (${JSON.stringify(bounds)})`);
      assert(bounds.contained, `${engine.name()} ${state}: long queued prompts must not push the composer or queue actions outside the pane`);
      widths.push(bounds.card);
    };
    await measure('initial');
    await page.getByRole('button', { name: 'Toggle sidebar' }).click();
    await measure('sidebar closed');
    await page.getByRole('button', { name: 'Toggle sidebar' }).click();
    await measure('sidebar reopened');
    await page.getByRole('slider', { name: 'Sidebar width' }).focus();
    await page.keyboard.press('ArrowRight');
    await measure('sidebar resized');
    await page.setViewportSize({ width: 640, height: 838 });
    await measure('viewport narrowed');
    await page.setViewportSize({ width: 420, height: 838 });
    await measure('compact viewport');
    await page.setViewportSize({ width: 900, height: 838 });
    await measure('viewport widened');
    assert(Math.max(...widths) - Math.min(...widths) > 100,
      'The question must track substantial host and viewport width changes');
    console.log(`${engine.name()}: queue stays contained and folded question follows host resizing: ${widths.join(', ')}px.`);
    await page.getByRole('button', { name: 'Summary history', exact: true }).click();
    const header = page.locator('.chat-work-group__header').last();
    await header.waitFor();
    assert.equal(await header.textContent().then(text => text.trim()), 'Done · 1m 49s · View details');
    assert.equal(await page.evaluate(() => window.detailReads), 0, 'summaries must not request Working content');
    await header.scrollIntoViewIfNeeded();
    await page.waitForTimeout(150);
    const before = await header.boundingBox();
    await header.click();
    await page.getByRole('status').filter({ hasText: 'Loading details' }).waitFor();
    await page.waitForFunction(() => document.querySelector('.chat-work-group__body') && document.body.textContent.includes('Investigated the work.'));
    await page.waitForTimeout(250);
    const after = await header.boundingBox();
    assert(Math.abs(after.y - before.y) < 2, `${engine.name()}: expansion must preserve the clicked summary header position: ${JSON.stringify({before,after})}`);
    const turn = header.locator('xpath=ancestor::*[contains(@class, "chat-message--assistant")][1]');
    assert.equal(await turn.locator('.chat-work-group__body .chat-media-block').count(), 3);
    assert.equal(await turn.locator('.chat-media-block').count(), 5);
    await page.waitForFunction(() => document.querySelectorAll('.chat-work-group__body .chat-media-block img').length === 3);
    if (artifacts) await turn.screenshot({ path: join(artifacts, engine.name() + '-expanded.png') });
    await header.click();
    await page.waitForTimeout(250);
    assert.equal(await turn.locator('.chat-work-group__body').evaluateAll(nodes => nodes.reduce((sum, node) => sum + (node.closest('.chat-fold')?.getBoundingClientRect().height ?? node.getBoundingClientRect().height), 0)), 0, 'collapsed tool screenshots must occupy no transcript space');
    assert.equal(await turn.locator('.chat-media-block').evaluateAll(nodes => nodes.filter(node => !node.closest('.chat-work-group__body')).length), 2, 'only the final-answer screenshots remain outside Working');
    if (artifacts) {
      await turn.screenshot({ path: join(artifacts, engine.name() + '-collapsed.png') });
      await writeFile(join(artifacts, engine.name() + '.json'), JSON.stringify({ expandedImages: 5, foldedImages: 3, finalAnswerImages: 2, detailReads: await page.evaluate(() => window.detailReads), anchorShiftPx: after.y - before.y }, null, 2));
    }
    await header.click();
    assert.equal(await page.evaluate(() => window.detailReads), 1, 'reopening loaded Working content must use the cached turn');
    console.log(`${engine.name()}: summary expansion loads once and preserves its scroll anchor.`);
    await browser.close();
    browser = undefined;
  }
} finally {
  await browser?.close();
  await server.close();
}
