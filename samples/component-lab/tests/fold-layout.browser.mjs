import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, webkit } from 'playwright';
import { createServer } from 'vite';

const fixtureId = '\0fold-layout-fixture';
const fullCommand = "python3 - <<'PY'\nfrom pathlib import Path\n" + "print(Path('/repository/packages/vue/src/chat/ChatToolCallTitle.vue').read_text())\n".repeat(4) + 'PY';
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
        thread: { queuedPrompts: [{ id: 'long', text: '<context>Code annotations: /private/source.ts</context>Use [$Review](/skills/review/SKILL.md) with [@main](mention://agents/main?value=agent%3Amain) and [@GitHub](plugin://github). ' + 'Standardize the host selectors. '.repeat(20) + '/repository/'.repeat(30) }] },
      });
      window.detailReads = 0;
      window.showCommandRows = command => { state.identity = { conversationKey:'commands', busy:false, messages:[{
        id:'command-rows',role:'assistant',status:'complete',parts:[
          ...[command,'pwd'].map((text,index)=>({type:'tool',id:'command-'+index,kind:'command',title:text,status:'completed',input:{command:text},statusText:JSON.stringify({source:'codex',action:'run',phase:'completed',params:{target:text}})})),
          {type:'tool',id:'file-edit',kind:'fileChange',title:'short.ts',status:'completed',input:{changes:[{path:'/repo/short.ts',kind:{type:'update'},diff:'patch',diffContent:{sessionId:'thread',contentId:'a'.repeat(64),byteLength:5,changeKind:'update'}}]},statusText:JSON.stringify({source:'codex',action:'edit',phase:'completed',params:{target:'short.ts',addedLines:5,removedLines:2}})},
        ]
      }] }; };
      window.runFirstCommand = () => { const message=state.identity.messages[0],tool=message.parts[0];state.identity.messages=[{...message,status:'streaming',parts:[{...tool,status:'running',statusText:JSON.stringify({source:'codex',action:'run',phase:'running',params:{target:tool.title}})},...message.parts.slice(1)]}]; };
      const controller = createCodexConversationPaneController({ state, actions: {
        async loadTurnHistory(turnId) {
          window.detailReads++;
          state.identity.turns.find(turn => turn.id === turnId).detailsLoading = true;
          await new Promise(resolve => { window.finishDetailRead = resolve; });
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
              turns: Array.from({ length: 20 }, (_, i) => ({ id: 'summary-'+i, status: i === 0 ? 'interrupted' : 'completed', itemsView: 'summary', durationMs: 109000 })),
              messages: Array.from({ length: 20 }, (_, i) => [
                { id: 'user-'+i, role: 'user', status: 'complete', turnId: 'summary-'+i, parts: [{ type: 'text', text: 'Request '+i }] },
                { id: 'answer-'+i, role: 'assistant', status: 'complete', turnId: 'summary-'+i, parts: i === 0 ? [] : [{ type: 'text', text: 'Final answer '+i+'\\n\\n![Phone]('+image+')\\n\\n![Desktop]('+image+')', phase: 'final_answer' }] },
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
  server: { port: 0, strictPort: false },
});
const artifacts = process.env.FOLD_LAYOUT_ARTIFACTS;
if (artifacts) await mkdir(artifacts, { recursive: true });
let browser;
try {
  await server.listen();
  for (const engine of [chromium, webkit]) {
    browser = await engine.launch();
    const page = await browser.newPage({ viewport: { width: 760, height: 838 } });
    await page.addInitScript(() => { Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.copiedToolText=text;}}}); });
    page.setDefaultTimeout(10_000);
    await page.goto(new URL('/fold-layout', server.resolvedUrls.local[0]).href);
    const card = page.locator('.chat-tool-user-input');
    await card.waitFor();
    const preview = page.locator('.chat-queued-prompt__text');
    assert.equal(await preview.textContent(), 'Use Review with main and GitHub. ' + 'Standardize the host selectors. '.repeat(20) + '/repository/'.repeat(30),
      'Queued previews hide attached context and show mention names without changing ordinary text');
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
    if (artifacts) await page.screenshot({ path: join(artifacts, engine.name() + '-queue-compact.png') });
    await page.setViewportSize({ width: 900, height: 838 });
    await measure('viewport widened');
    if (artifacts) await page.screenshot({ path: join(artifacts, engine.name() + '-queue-wide.png') });
    assert(Math.max(...widths) - Math.min(...widths) > 100,
      'The question must track substantial host and viewport width changes');
    console.log(`${engine.name()}: queue stays contained and folded question follows host resizing: ${widths.join(', ')}px.`);
    await page.evaluate(command=>window.showCommandRows(command),fullCommand);
    await page.locator('.chat-tool-group__header').click();
    const commandTitle=page.locator('.chat-tool-call__title').filter({hasText:'from pathlib import Path'});
    const text=commandTitle.locator('.chat-tool-call__title-content');
    const expand=commandTitle.getByRole('button',{name:'Expand full text',exact:true});
    await expand.waitFor({state:'attached'});
    await page.mouse.move(0,0);
    assert.equal(await expand.evaluate(el=>getComputedStyle(el).opacity),'0','the chevron is hidden until row hover or focus');
    const commandRow=commandTitle.locator('..');
    assert.equal(await commandRow.evaluate(el=>getComputedStyle(el.closest('.chat-tool-call')).userSelect),'none','tool rows do not start text selection');
    const rowBounds=await commandRow.boundingBox();
    await page.mouse.move(rowBounds.x+rowBounds.width-8,rowBounds.y+10);
    assert.equal(await expand.evaluate(el=>getComputedStyle(el).opacity),'1');
    const chrome=await expand.evaluate(el=>({background:getComputedStyle(el).backgroundColor,border:getComputedStyle(el).borderWidth}));
    assert.deepEqual(chrome,{background:'rgba(0, 0, 0, 0)',border:'0px'},'the disclosure is a bare chevron');
    const icon=commandTitle.locator('.chat-tool-call__copy-icon');
    const offset=async()=>icon.evaluate(el=>{const parent=el.closest('.chat-tool-call__title');const range=document.createRange();range.selectNodeContents(parent.querySelector('.chat-tool-call__title-content'));return el.getBoundingClientRect().y+el.getBoundingClientRect().height/2-range.getClientRects()[0].y-range.getClientRects()[0].height/2;});
    const iconOffsetBefore=await offset();
    const titleTopBefore=(await commandTitle.boundingBox()).y;
    const iconTopBefore=(await icon.boundingBox()).y;
    await text.click();
    assert.equal(await commandTitle.getAttribute('class').then(value=>value.includes('chat-tool-call__title--expanded')),true);
    assert.ok((await text.textContent()).includes(fullCommand),'expansion preserves the complete command and line breaks');
    assert.equal(await text.evaluate(el=>getComputedStyle(el).lineHeight),'24px','expanded lines have comfortable spacing');
    assert.ok(Math.abs(await offset()-iconOffsetBefore)<1,'the tool icon keeps its first-line alignment');
    assert.equal((await commandTitle.boundingBox()).y,titleTopBefore,'expansion must not change the gap above the row');
    assert.equal((await icon.boundingBox()).y,iconTopBefore,'expansion must not move the tool icon');
    await icon.hover();
    assert.equal(await icon.evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(0, 0, 0, 0)','the copy affordance has no button chrome');
    await icon.locator('.tabler-icon-copy').waitFor();
    await icon.click();
    await page.waitForFunction(()=>window.copiedToolText?.includes('from pathlib import Path'));
    assert.equal(await page.evaluate(()=>window.copiedToolText),fullCommand,'shell copies use the structured command, without its display prefix');
    await commandTitle.getByRole('button',{name:'Copied',exact:true}).locator('.tabler-icon-check').waitFor();
    assert.equal(await commandTitle.getByRole('button',{name:'Collapse full text'}).count(),1,'copying must not collapse the row');
    await page.mouse.move(0,0);
    assert.equal(await commandTitle.getByRole('button',{name:'Collapse full text'}).evaluate(el=>getComputedStyle(el).opacity),'0',
      'pointer focus after Copy must not pin the chevron on screen');
    if(artifacts) await page.screenshot({path:join(artifacts,engine.name()+'-command-expanded.png')});
    const diff=page.locator('.chat-tool-call').filter({hasText:'Edited short.ts'});
    const link=await diff.getByRole('link',{name:'short.ts',exact:true}).boundingBox();
    const stats=await diff.locator('.chat-tool-call__diff').boundingBox();
    assert.ok(stats.x-link.x-link.width<24,'diff stats stay beside the filename');
    assert.equal(await page.locator('.chat-tool-call__files').count(),0,'file panels are removed');
    assert.equal(await page.locator('button button').count(),0,'copy and disclosure controls must not be nested buttons');
    const short=page.locator('.chat-tool-call__title').filter({hasText:'Ran pwd'});
    assert.equal(await short.getByRole('button',{name:'Expand full text'}).count(),0,'fitting rows have no chevron');
    await icon.focus();
    assert.equal(await icon.evaluate(el=>document.activeElement===el),true,
      'copy icon should receive focus: '+JSON.stringify(await icon.evaluate(el=>({label:document.activeElement?.getAttribute('aria-label'),inert:!!el.closest('[inert]'),disabled:el.disabled,visibility:getComputedStyle(el).visibility,tabIndex:el.tabIndex,next:el.closest('.chat-tool-call__title').querySelector('.chat-tool-call__title-toggle')?.outerHTML}))));
    // Safari's default macOS navigation uses Option+Tab for non-form controls.
    await page.keyboard.press(engine.name()==='webkit' && process.platform==='darwin' ? 'Alt+Tab' : 'Tab');
    assert.equal(await commandTitle.getByRole('button',{name:'Collapse full text'}).evaluate(el=>getComputedStyle(el).opacity),'1',
      'keyboard focus reveals the chevron without hovering: '+JSON.stringify(await page.evaluate(()=>({label:document.activeElement?.getAttribute('aria-label'),visible:document.activeElement?.matches(':focus-visible')}))));
    await page.keyboard.press('Enter');
    assert.equal(await commandTitle.getByRole('button',{name:'Expand full text'}).count(),1);
    if(artifacts) await page.screenshot({path:join(artifacts,engine.name()+'-command-rows.png')});
    const touchPage=await browser.newPage({viewport:{width:390,height:700},hasTouch:true,isMobile:true});
    await touchPage.goto(new URL('/fold-layout',server.resolvedUrls.local[0]).href);
    await touchPage.evaluate(command=>window.showCommandRows(command),fullCommand);
    await touchPage.evaluate(()=>window.runFirstCommand());
    await touchPage.locator('.chat-tool-group__header').tap();
    const touchTitle=touchPage.locator('.chat-tool-call__title').filter({hasText:'from pathlib import Path'});
    const touchExpand=touchTitle.getByRole('button',{name:'Expand full text',exact:true});
    await touchExpand.waitFor();
    assert.equal(await touchExpand.evaluate(el=>getComputedStyle(el).opacity),'1','touch devices expose the chevron without hovering');
    await touchTitle.locator('.chat-tool-call__title-content').tap();
    assert.equal(await touchTitle.getByRole('button',{name:'Collapse full text'}).count(),1);
    assert.ok(await touchTitle.evaluate(el=>el.getBoundingClientRect().right<=innerWidth),'expanded commands stay within the phone viewport');
    assert.ok(await touchTitle.evaluate(el=>el.closest('.chat-tool-group__running-item').getBoundingClientRect().height>=el.getBoundingClientRect().height),
      'running tool wrappers must not clip expanded commands');
    if(artifacts) await touchPage.screenshot({path:join(artifacts,engine.name()+'-command-touch.png')});
    await touchPage.close();
    await page.getByRole('button', { name: 'Summary history', exact: true }).click();
    const header = page.locator('.chat-work-group__header').last();
    await header.waitFor();
    assert.equal(await header.textContent().then(text => text.trim()), 'Done · 1m 49s · View details');
    assert.equal(await page.evaluate(() => window.detailReads), 0, 'summaries must not request Working content');
    assert.equal((await page.locator('.chat-work-group__header').first().textContent()).trim(), 'Stopped · 1m 49s · View details');
    assert.equal(await page.getByRole('status', { name: 'Loading details…' }).count(), 0, 'stopped summaries must stay idle until explicitly expanded');
    await header.scrollIntoViewIfNeeded();
    const before = await header.boundingBox();
    await header.click();
    await header.getByRole('status', { name: 'Loading details…' }).waitFor();
    assert.equal(await header.getAttribute('aria-expanded'), 'false');
    assert.equal(await header.isDisabled(), true);
    assert.equal(await header.locator('svg').count(), 1, 'the spinner replaces the chevron');
    assert.equal(await page.locator('.chat-fold--open').count(), 0, 'pending history must stay folded');
    if (artifacts) await page.screenshot({ path: join(artifacts, engine.name() + '-loading.png') });
    await page.evaluate(() => window.finishDetailRead());
    await page.waitForFunction(() => document.querySelector('.chat-work-group__body') && document.body.textContent.includes('Investigated the work.'));
    const turn = header.locator('xpath=ancestor::*[contains(@class, "chat-message--assistant")][1]');
    await turn.evaluate(element => Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished)));
    const after = await header.boundingBox();
    assert(Math.abs(after.y - before.y) < 2, `${engine.name()}: expansion must preserve the clicked summary header position: ${JSON.stringify({before,after})}`);
    assert.equal(await turn.locator('.chat-work-group__body .chat-media-block').count(), 3);
    assert.equal(await turn.locator('.chat-media-block').count(), 5);
    await page.waitForFunction(() => document.querySelectorAll('.chat-work-group__body .chat-media-block img').length === 3);
    if (artifacts) await turn.screenshot({ path: join(artifacts, engine.name() + '-expanded.png') });
    await header.click();
    await turn.evaluate(element => Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished)));
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
