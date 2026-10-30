import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, webkit } from 'playwright';
import { createServer } from 'vite';

// Real SDK DOM/scroll/decode workflow: a desktop pane with its own scroll root,
// crowded visible previews, and navigation away during an in-flight host read.
const fixture = {
  name: 'image-viewport-fixture',
  configureServer(server) {
    server.middlewares.use(async (request, response, next) => {
      if (request.url !== '/image-viewport') return next();
      response.setHeader('Content-Type', 'text/html');
      response.end(await server.transformIndexHtml(request.url, '<!doctype html><html><body><div id="app"></div><script type="module" src="/image-viewport.js"></script></body></html>'));
    });
  },
  resolveId(id) { if (id === '/image-viewport.js') return '\0image-viewport'; },
  load(id) {
    if (id !== '\0image-viewport') return;
    return `
      import { createApp, h, ref } from 'vue';
      import { CodexMessage, provideCodexHostCapabilities } from '@codex-app-sdk/vue';
      import '@codex-app-sdk/vue/styles.css';
      window.reads = []; window.urls = new Set(); window.active = 0; window.peak = 0;
      const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = blob => { const url = create(blob); window.urls.add(url); return url; };
      URL.revokeObjectURL = url => { window.urls.delete(url); revoke(url); };
      const items = ref(Array.from({length:12}, (_,i) => ({ id: 'photo-'+i, role:'assistant', content:'', parts:[{type:'media',media:{url:'/photo-'+i+'.png',title:'Photo '+i,width:1024,height:512}}] })));
      window.replaceImages = value => { items.value = value; };
      const app = createApp({setup() {
        provideCodexHostCapabilities({readImagePreview: async reference => {
          window.reads.push(reference); window.peak = Math.max(window.peak, ++window.active);
          await new Promise(resolve => setTimeout(resolve, reference.includes('slow') ? 250 : 30));
          window.active--;
          const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 512;
          return canvas.toDataURL('image/png');
        }}, {imagePreviewBudgetBytes: 5 * 1024 * 1024, viewportImageLoading: true});
        return () => h('section', {id:'scroll',style:'height:600px;overflow-y:auto;width:700px;margin:80px auto'},
          items.value.map(message => h('article',{key:message.id,style:message.id === 'crowded' ? '' : 'padding-bottom:900px'},h(CodexMessage,{message}))));
      }});
      app.mount('#app'); window.closeImages = () => app.unmount();
    `;
  },
};
const server = await createServer({ configFile: new URL('../vite.config.ts', import.meta.url).pathname,
  root: new URL('..', import.meta.url).pathname, plugins:[fixture], server:{port:0} });
let browser;
const evidence = [];
try {
  await server.listen();
  for (const engine of [chromium, webkit]) {
    browser = await engine.launch();
    const page = await browser.newPage({viewport:{width:1200,height:900}});
    page.setDefaultTimeout(5000);
    await page.goto(new URL('/image-viewport',server.resolvedUrls.local[0]).href);
    const shot = i => page.getByRole('button',{name:'Open Photo '+i,exact:true});
    await page.waitForFunction(() => document.querySelector('img')?.naturalWidth === 1024);
    assert.equal(await page.evaluate(() => window.reads.length),1,'only the image near the desktop pane should load');
    for (const i of [1,2,3,0]) {
      await shot(i).evaluate(el=>el.scrollIntoView({block:'center'}));
      const before = await shot(i).boundingBox();
      assert.ok(Math.abs(before.width / before.height - 2) < 0.01, 'placeholder must use the actual 2:1 image ratio');
      await page.waitForFunction(i=>document.querySelector('[aria-label="Open Photo '+i+'"] img')?.naturalWidth === 1024,i);
      assert.deepEqual(await shot(i).boundingBox(),before,'decoding and eviction preserve geometry');
    }
    assert.equal(await page.evaluate(()=>window.reads.filter(r=>r==='/photo-0.png').length),2,'returning reloads the evicted image');
    // More simultaneously visible images than the budget permits: no eviction/refetch loop.
    await page.evaluate(()=>window.replaceImages([{id:'crowded',role:'user',content:'',parts:Array.from({length:8},(_,i)=>({type:'attachment',attachment:{kind:'image',name:'Crowded '+i,path:'/crowded-'+i+'.png'}}))}]));
    await page.waitForFunction(()=>window.reads.some(r=>r.includes('crowded')) && window.active===0 && !document.body.textContent.includes('Loading image…'));
    const settled = await page.evaluate(()=>({reads:window.reads.length,urls:window.urls.size}));
    await page.waitForTimeout(350);
    assert.equal(await page.evaluate(()=>window.reads.length),settled.reads,'crowded previews do not continuously refetch');
    assert.ok(settled.urls<=2,'decoded pixels stay within budget');
    await page.evaluate(()=>window.replaceImages([{id:'slow',role:'assistant',content:'',parts:[{type:'media',media:{url:'/slow.png',title:'Slow'}}]}]));
    await page.getByRole('button',{name:'Open Slow',exact:true}).evaluate(el=>el.scrollIntoView());
    await page.waitForFunction(()=>window.reads.includes('/slow.png'));
    await page.evaluate(()=>window.closeImages());
    await page.waitForFunction(()=>window.active===0);
    assert.equal(await page.evaluate(()=>window.urls.size),0,'late replies cannot retain resources after the pane closes');
    evidence.push({engine:engine.name(),peak:await page.evaluate(()=>window.peak),...settled,stableGeometry:true,reloaded:true,released:true});
    assert.ok(evidence.at(-1).peak<=2);
    await browser.close(); browser=undefined;
  }
  const artifacts = process.env.IMAGE_VIEWPORT_ARTIFACTS || join(tmpdir(), 'codex-app-sdk-image-viewport');
  await mkdir(artifacts,{recursive:true});
  await writeFile(join(artifacts, 'measurements.json'),JSON.stringify(evidence,null,2));
  console.log(JSON.stringify(evidence));
} finally { await browser?.close(); await server.close(); }
