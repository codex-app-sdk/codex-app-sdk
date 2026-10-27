import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import { chromium, webkit } from 'playwright';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const source = name => JSON.stringify(path.join(root, 'packages/vue/src', name));
const cacheDir = await mkdtemp(path.join(tmpdir(), 'sdk-authored-content-'));
const fixtureId = '\0authored-content';
const server = await createServer({
  configFile: false, root, cacheDir, optimizeDeps: { noDiscovery: true, include: ['vue', '@tabler/icons-vue', 'fix-webm-duration'] },
  plugins: [vue(), {
    name: 'authored-content-fixture',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url !== '/authored-content') return next();
        response.setHeader('Content-Type', 'text/html');
        response.end('<div id="app"></div><script type="module" src="/authored-content.js"></script>');
      });
    },
    resolveId(id) { if (id === '/authored-content.js') return fixtureId; },
    load(id) {
      if (id !== fixtureId) return;
      return `
        import { createApp, h, ref } from 'vue';
        import Composer from ${source('components/CodexComposer.vue')};
        import UserText from ${source('chat/ChatUserText.vue')};
        import MessageEditor from ${source('chat/ChatMessageEditor.vue')};
        import ${source('styles.css')};
        const state = ref({text:'',selectionStart:0,selectionEnd:0});
        const submitted = ref(null);
        const catalogs = ref(true);
        const editing = ref(false);
        const skill = {name:'cp',displayName:'Commit-Push',path:'/skills/cp/SKILL.md',enabled:true};
        const groups = [{id:'agents',label:'Agents',items:[{id:'agent-1',value:'agent:1',label:'Alex'}]}];
        window.authoredFixture = {
          clearCatalogs() { catalogs.value = false; },
          edit() { editing.value=true; },
          reset() { editing.value=false; state.value={text:'',selectionStart:0,selectionEnd:0}; catalogs.value=true; },
          restore() { const {prompt,options}=submitted.value; state.value={text:prompt,content:options?.content,selectionStart:prompt.length,selectionEnd:prompt.length}; },
          read() { return {state:state.value,submitted:submitted.value}; },
        };
        createApp({setup:()=>()=>h('main',[
          h(Composer,{disabled:false,isSending:false,composerState:state.value,
            skills:catalogs.value?[skill]:[],mentionGroups:catalogs.value?groups:[],
            'onUpdate:composerState':value=>state.value=value,
            onSend:(prompt,options)=>submitted.value={prompt,options},
          }),
          submitted.value?h(UserText,{content:submitted.value.prompt,promptContent:submitted.value.options?.content,
            skills:catalogs.value?[skill]:[],mentionGroups:catalogs.value?groups:[]}):null,
          submitted.value?.options?.content?h('button',{onClick:()=>editing.value=true},'Edit saved prompt'):null,
          editing.value?h(MessageEditor,{key:submitted.value.prompt,content:submitted.value.prompt,
            promptContent:submitted.value.options.content,cancelLabel:'Cancel',inputLabel:'Edit submitted prompt',saveLabel:'Resubmit',
            onSave:(prompt,options)=>window.inlineSubmission={prompt,options}}):null,
        ])}).mount('#app');
      `;
    },
  }], server: { port: 0 },
});
let browser;
async function focusEnd(locator) {
  await locator.focus();
  await locator.evaluate(element => {
    const range = document.createRange(); range.selectNodeContents(element); range.collapse(false);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
  });
}
try {
  await server.listen();
  for (const engine of [chromium, webkit]) {
    browser = await engine.launch();
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    page.on('pageerror', error => console.error(error.message));
    await page.goto(new URL('authored-content', server.resolvedUrls.local[0]).href);
    const editor = page.locator('.chat-composer [role="textbox"]');
    await editor.pressSequentially('$cp');
    await page.locator('.chat-composer__send').click();
    assert.equal(await page.locator('.chat-user-text').innerText(), '$cp');
    assert.equal(await page.locator('.chat-user-text__mention').count(), 0);

    await editor.pressSequentially('$cp then $cp');
    assert.equal(await editor.locator('[data-skill-name]').count(), 0);
    await editor.press('Enter');
    await editor.locator('[data-skill-name="cp"]').waitFor();
    await page.locator('.chat-composer__send').click();
    const expected = [
      { type: 'text', text: '$cp then ' },
      { type: 'mention', kind: 'skill', id: '/skills/cp/SKILL.md', value: 'cp', label: 'Commit-Push' },
    ];
    assert.deepEqual(await page.evaluate(() => window.authoredFixture.read().submitted), {
      prompt: '$cp then Commit-Push', options: { content: expected },
    });
    await page.evaluate(() => window.authoredFixture.clearCatalogs());
    assert.equal(await page.locator('.chat-user-text__mention--skill').innerText(), 'Commit-Push');
    await page.evaluate(() => window.authoredFixture.restore());
    await editor.locator('[data-skill-name="cp"]').waitFor();
    await focusEnd(editor); await editor.pressSequentially(' done');
    assert.deepEqual((await page.evaluate(() => window.authoredFixture.read().state)).content,
      [...expected, { type: 'text', text: ' done' }]);

    assert.equal(await editor.locator('[data-skill-name]').count(), 1, 'Draft restore must not duplicate chips');
    await page.getByRole('button', { name: 'Edit saved prompt', exact: true }).click();
    const inline = page.getByRole('textbox', { name: 'Edit submitted prompt' });
    await focusEnd(inline);
    await inline.evaluate(element => {
      const clipboardData = new DataTransfer();
      clipboardData.setData('text/plain', ' pasted'); clipboardData.setData('text/html', '<b> pasted</b>');
      element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
    });
    assert.equal(await inline.textContent(), '$cp then Commit-Push pasted');
    assert.equal(await inline.locator('b').count(), 0);
    assert.equal(await editor.locator('[data-skill-name]').count(), 1, 'Inline paste must not alter another draft');
    await inline.press('ControlOrMeta+z');
    assert.equal(await inline.textContent(), '$cp then Commit-Push');
    assert.equal(await editor.locator('[data-skill-name]').count(), 1, 'Inline undo must not alter another draft');
    await inline.press('ControlOrMeta+Shift+z');
    assert.equal(await inline.textContent(), '$cp then Commit-Push pasted');
    assert.equal(await editor.locator('[data-skill-name]').count(), 1, 'Inline redo must not alter another draft');
    assert.equal(await editor.textContent(), '$cp then Commit-Push done', 'Inline editing must leave the other draft text unchanged');
    await page.getByRole('button', { name: 'Resubmit', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.inlineSubmission), {
      prompt: '$cp then Commit-Push pasted', options: { content: [...expected, { type: 'text', text: ' pasted' }] },
    });

    await page.screenshot({ path: `/tmp/sdk-authored-content-${engine.name()}.png` });
    await page.evaluate(() => window.authoredFixture.reset());
    await focusEnd(editor); await editor.pressSequentially('@Al');
    await page.locator('.chat-composer-at-menu__item').filter({ hasText: 'Alex' }).waitFor();
    await editor.press('Enter');
    await editor.locator('[data-mention-value="agent:1"]').waitFor();
    await page.locator('.chat-composer__send').click();
    assert.deepEqual((await page.evaluate(() => window.authoredFixture.read().submitted)).options.content, [
      { type: 'mention', kind: 'custom', id: 'agent-1', value: 'agent:1', label: 'Alex', groupId: 'agents' },
    ]);
    await page.evaluate(() => window.authoredFixture.clearCatalogs());
    assert.equal(await page.locator('.chat-user-text__mention--custom').innerText(), 'Alex');
    console.log(`${engine.name()}: literal triggers, explicit skill/agent chips, draft restoration and inline paste/undo/resubmit preserve authored content.`);
    await browser.close(); browser = undefined;
  }
} finally {
  await browser?.close(); await server.close(); await rm(cacheDir, { recursive: true, force: true });
}
