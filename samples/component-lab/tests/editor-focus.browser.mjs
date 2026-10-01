import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const editorPath = path.join(root, 'packages/vue/src/chat/ChatRichTextEditor.vue');
const fixtureId = '\0editor-focus-fixture';
const fixturePlugin = {
  name: 'editor-focus-fixture',
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      if (request.url !== '/editor-focus') return next();
      response.setHeader('Content-Type', 'text/html');
      response.end('<main id="app"></main><script type="module" src="/src/editor-focus.js"></script>');
    });
  },
  resolveId(id) {
    if (id === '/src/editor-focus.js') return fixtureId;
  },
  load(id) {
    if (id !== fixtureId) return;
    return `
      import { createApp, h, ref } from 'vue';
      import ChatRichTextEditor from ${JSON.stringify(editorPath)};

      const showBackground = ref(false);
      const skills = ref([]);
      window.editorFocusFixture = {
        mountBackground() { showBackground.value = true; },
        refreshBackground() {
          skills.value = [{ name: 'Commit-Push (cp)', path: '/skills/commit-push/SKILL.md', enabled: true }];
        },
      };
      createApp({
        setup() {
          return () => h('section', [
            h(ChatRichTextEditor, { ariaLabel: 'Primary editor', modelValue: 'primary' }),
            showBackground.value
              ? h(ChatRichTextEditor, {
                  ariaLabel: 'Background editor',
                  modelValue: '$cp',
                  skills: skills.value,
                })
              : null,
          ]);
        },
      }).mount('#app');
    `;
  },
};

const server = await createServer({
  configFile: false,
  plugins: [vue(), fixturePlugin],
  root,
  server: { port: 0 },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(new URL('editor-focus', server.resolvedUrls.local[0]).href);
  const primary = page.getByRole('textbox', { name: 'Primary editor' });

  async function focusPrimary() {
    await primary.focus();
    await primary.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
  }

  async function primaryKeepsFocusAndSelection() {
    return await primary.evaluate((element) => {
      const selection = window.getSelection();
      return document.activeElement === element
        && selection?.rangeCount === 1
        && element.contains(selection.getRangeAt(0).startContainer);
    });
  }

  await focusPrimary();
  await page.evaluate(() => window.editorFocusFixture.mountBackground());
  await page.getByRole('textbox', { name: 'Background editor' }).waitFor();
  const preservedAfterMount = await primaryKeepsFocusAndSelection();

  await focusPrimary();
  await page.evaluate(() => window.editorFocusFixture.refreshBackground());
  await page.locator('[data-skill-name="cp"]').waitFor();
  const preservedAfterRefresh = await primaryKeepsFocusAndSelection();

  assert.deepEqual(
    { preservedAfterMount, preservedAfterRefresh },
    { preservedAfterMount: true, preservedAfterRefresh: true },
    'Background editor updates must preserve the active editor selection',
  );
  console.log('Background editor updates preserve the active editor focus and selection in Chromium.');
} finally {
  await browser?.close();
  await server.close();
}
