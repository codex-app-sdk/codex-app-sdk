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
  configFile: false, root, cacheDir, optimizeDeps: { noDiscovery: true, include: ['vue', '@tabler/icons-vue', 'fix-webm-duration', 'beautiful-mermaid'] },
  plugins: [vue(), {
    name: 'authored-content-fixture',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url !== '/authored-content') return next();
        response.setHeader('Content-Type', 'text/html');
        response.end('<!doctype html><div id="app"></div><script type="module" src="/authored-content.js"></script>');
      });
    },
    resolveId(id) { if (id === '/authored-content.js') return fixtureId; },
    load(id) {
      if (id !== fixtureId) return;
      return `
        import { createApp, h, ref } from 'vue';
        import Composer from ${source('components/CodexComposer.vue')};
        import Message from ${source('components/CodexMessage.vue')};
        import MessageEditor from ${source('chat/ChatMessageEditor.vue')};
        import { promptContentDispatchText } from ${JSON.stringify(path.join(root, 'packages/core/src/prompt-content.ts'))};
        import ${source('styles.css')};
        const state = ref({text:'',selectionStart:0,selectionEnd:0});
        const submitted = ref(null);
        const catalogs = ref(true);
        const editing = ref(false);
        const skill = {name:'cp',displayName:'Commit-Push',path:'/skills/cp/SKILL.md',enabled:true};
        const plugin = {id:'computer-use@openai-bundled',name:'computer-use',displayName:'Computer Use',brandColor:'#ff0000',enabled:true};
        const groups = [{id:'agents',label:'Agents',items:[{id:'agent-1',value:'agent:1',label:'Alex'}]}];
        window.authoredFixture = {
          clearCatalogs() { catalogs.value = false; },
          reload() { const {prompt,options}=submitted.value; submitted.value={prompt:promptContentDispatchText(options.content,prompt)}; },
          edit() { editing.value=true; },
          reset() { editing.value=false; state.value={text:'',selectionStart:0,selectionEnd:0}; catalogs.value=true; },
          restore() { const {prompt,options}=submitted.value; state.value={text:prompt,content:options?.content,selectionStart:prompt.length,selectionEnd:prompt.length}; },
          read() { return {state:state.value,submitted:submitted.value}; },
        };
        createApp({setup:()=>()=>h('main',[
          h(Composer,{disabled:false,isSending:false,composerState:state.value,
            skills:catalogs.value?[skill]:[],plugins:catalogs.value?[plugin]:[],mentionGroups:catalogs.value?groups:[],
            'onUpdate:composerState':value=>state.value=value,
            onSend:(prompt,options)=>submitted.value={prompt,options},
          }),
          submitted.value?h(Message,{message:{id:'submitted',role:'user',status:'complete',parts:[{type:'text',text:submitted.value.prompt}],metadata:{promptContent:submitted.value.options?.content}},
            skills:catalogs.value?[skill]:[],plugins:catalogs.value?[plugin]:[],mentionGroups:catalogs.value?groups:[]}):null,
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
const appearance = element => {
  const style = getComputedStyle(element);
  return Object.fromEntries(['backgroundColor', 'color', 'padding', 'borderRadius', 'fontSize', 'fontWeight', 'lineHeight', 'gap']
    .map(key => [key, style[key]]));
};
const iconAppearance = element => ({
  paths: [...element.querySelectorAll('path')].map(path => path.getAttribute('d')),
  width: getComputedStyle(element).width, height: getComputedStyle(element).height,
});
const textAlignment = element => {
  const anchor = element.closest('[data-prompt-mention]') ?? element;
  let previous = anchor.previousSibling;
  while (previous && (previous.nodeType === Node.COMMENT_NODE || !previous.textContent?.trim())) previous = previous.previousSibling;
  const range = document.createRange(); range.selectNodeContents(previous);
  const text = range.getBoundingClientRect();
  const pill = element.getBoundingClientRect();
  return pill.y + pill.height / 2 - text.y - text.height / 2;
};
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
    await page.getByRole('option', { name: 'Commit-Push', exact: true }).waitFor();
    await editor.press('Enter');
    await editor.locator('[data-skill-name="cp"]').waitFor();
    const skillPill = editor.locator('[data-skill-name="cp"] .chat-mention-chip');
    const skillStyle = await skillPill.evaluate(appearance);
    const skillIcon = await skillPill.locator('svg').evaluate(iconAppearance);
    const skillAlignment = await skillPill.evaluate(textAlignment);
    await page.locator('.chat-composer__send').click();
    const messageSkill = page.locator('.chat-user-text__mention--skill');
    assert.deepEqual(await messageSkill.evaluate(appearance), skillStyle, 'Skill pills must match composer styling');
    assert.deepEqual(await messageSkill.locator('svg').evaluate(iconAppearance), skillIcon, 'Skill fallback icons must match');
    const messageSkillAlignment = await messageSkill.evaluate(textAlignment);
    assert(Math.abs(messageSkillAlignment - skillAlignment) <= 0.5, `Skill alignment: composer ${skillAlignment}px, message ${messageSkillAlignment}px`);
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
    await page.evaluate(() => window.authoredFixture.reload());
    assert.equal(await page.locator('.chat-user-text__mention--custom').innerText(), 'Alex', 'Agent links restore pills without authored metadata or catalogs');
    await page.evaluate(() => window.authoredFixture.reset());
    await focusEnd(editor); await editor.pressSequentially('Use @computer-use');
    await page.locator('.chat-composer-at-menu__item').filter({ hasText: 'Computer Use' }).waitFor();
    await editor.press('Enter');
    const composerPill = editor.locator('[data-plugin-name] .chat-mention-chip');
    const composerStyle = await composerPill.evaluate(appearance);
    const composerIcon = await composerPill.locator('svg').evaluate(iconAppearance);
    const pluginAlignment = await composerPill.evaluate(textAlignment);
    await page.locator('.chat-composer__send').click();
    const messagePill = page.locator('.chat-user-text__mention--plugin');
    assert.deepEqual(await messagePill.evaluate(appearance), composerStyle, 'Message pills must use composer pill styling');
    assert.deepEqual(await messagePill.locator('svg').evaluate(iconAppearance), composerIcon, 'Plugin fallback icons must match');
    const messagePluginAlignment = await messagePill.evaluate(textAlignment);
    assert(Math.abs(messagePluginAlignment - pluginAlignment) <= 0.5, `Plugin alignment: composer ${pluginAlignment}px, message ${messagePluginAlignment}px`);
    await page.screenshot({ path: `/tmp/sdk-message-pills-${engine.name()}.png` });
    console.log(`${engine.name()}: literal triggers, explicit skill/agent chips, draft restoration and inline paste/undo/resubmit preserve authored content.`);
    await browser.close(); browser = undefined;
  }
} finally {
  await browser?.close(); await server.close(); await rm(cacheDir, { recursive: true, force: true });
}
