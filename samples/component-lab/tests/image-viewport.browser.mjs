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
      import { CodexMessage, CodexMessageList, provideCodexHostCapabilities } from '@codex-app-sdk/vue';
      import '@codex-app-sdk/vue/styles.css';
      window.reads = []; window.urls = new Set(); window.cachedBytes = new Map(); window.originals = new Map(); window.active = 0; window.peak = 0;
      const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = blob => { const url = create(blob); window.urls.add(url); window.cachedBytes.set(url,blob.size); return url; };
      URL.revokeObjectURL = url => { window.urls.delete(url); window.cachedBytes.delete(url); revoke(url); };
      const items = ref(Array.from({length:12}, (_,i) => ({ id: 'photo-'+i, role:'assistant', content:'', parts:[{type:'media',media:{url:'conversation-image:photo-'+i+':'+ 'a'.repeat(64),title:'Photo '+i,width:1024,height:512}}] })));
      window.replaceImages = value => { items.value = value; };
      const gallery = ref(false); window.showGallery = () => { gallery.value = true; };
      const crowdedReady = new Promise(resolve => { window.releaseCrowdedImages = resolve; });
      const smallReady = new Promise(resolve => { window.releaseSmallImages = resolve; });
      const app = createApp({setup() {
        provideCodexHostCapabilities({readImagePreview: async reference => {
          window.reads.push(reference); window.peak = Math.max(window.peak, ++window.active);
          if (reference.includes('crowded')) await crowdedReady;
          if (reference.includes('small')) await smallReady;
          if (reference === '/slow.png') await new Promise(resolve => { window.releaseSlowImage = resolve; });
          if (reference.includes('gallery-first')) await new Promise(resolve => { window.releaseFirstGalleryImage = resolve; });
          window.active--;
          const canvas = document.createElement('canvas'); canvas.width = reference.includes('small-wide') ? 96 : reference.includes('small') ? 64 : reference.includes('portrait') ? 1170 : reference.includes('large') ? 3072 : 1024; canvas.height = reference.includes('small-wide') ? 48 : reference.includes('small') ? 64 : reference.includes('portrait') ? 2532 : reference.includes('large') ? 2048 : 512;
          if (reference.includes('portrait')) {
            const ctx = canvas.getContext('2d'); ctx.fillStyle = 'white'; ctx.fillRect(0,0,canvas.width,canvas.height);
            ctx.fillStyle = 'black'; ctx.font = '32px sans-serif';
            for (let y=60;y<canvas.height;y+=60) ctx.fillText('Portrait screenshot — readable details 0123456789',24,y);
          }
          const original=canvas.toDataURL('image/png'); window.originals.set(reference,original); return original;
        }}, {imagePreviewBudgetBytes: window.previewBudgetBytes ?? 5 * 1024 * 1024, viewportImageLoading: true});
        return () => h('section', {id:'scroll',style:'height:600px;overflow-y:auto;width:min(700px,100%);margin:80px auto'},
          gallery.value ? h(CodexMessageList,{messages:items.value,style:'height:100%',openImage:()=>false}) : items.value.map(message => h('article',{key:message.id,style:message.id === 'crowded' ? '' : 'padding-bottom:900px'},h(CodexMessage,{message,openImage: image => { window.openedImage = image; return true; }}))));
      }});
      app.mount('#app'); window.closeImages = () => app.unmount();
    `;
  },
};
const server = await createServer({ configFile: new URL('../vite.config.ts', import.meta.url).pathname,
  root: new URL('..', import.meta.url).pathname, plugins:[fixture], server:{port:0} });
let browser;
const evidence = [];
const artifacts = process.env.IMAGE_VIEWPORT_ARTIFACTS || join(tmpdir(), 'codex-app-sdk-image-viewport');
await mkdir(artifacts,{recursive:true});
try {
  await server.listen();
  for (const engine of [chromium, webkit]) {
    browser = await engine.launch();
    const page = await browser.newPage({viewport:{width:1200,height:900}});
    page.setDefaultTimeout(5000);
    page.setDefaultNavigationTimeout(30000);
    await page.goto(new URL('/image-viewport',server.resolvedUrls.local[0]).href);
    const shot = i => page.getByRole('button',{name:'Open Photo '+i,exact:true});
    await page.waitForFunction(() => document.querySelector('img')?.naturalWidth > 0);
    assert.equal(await page.evaluate(() => window.reads.length),1,'only the image near the desktop pane should load');
    const firstThumbnail = await shot(0).locator('img').getAttribute('src');
    for (const i of [1,2,3,0]) {
      await shot(i).evaluate(el=>el.scrollIntoView({block:'center'}));
      const before = await shot(i).boundingBox();
      assert.ok(Math.abs(before.width / before.height - 2) < 0.01, 'placeholder must use the actual 2:1 image ratio');
      await page.waitForFunction(i=>document.querySelector('[aria-label="Open Photo '+i+'"] img')?.naturalWidth > 0,i);
      assert.deepEqual(await shot(i).boundingBox(),before,'decoding and eviction preserve geometry');
    }
    assert.equal(await shot(0).locator('img').getAttribute('src'),firstThumbnail,'scrolling back immediately reuses the same cached thumbnail');
    assert.equal(await page.evaluate(()=>window.reads.filter(r=>r.includes(':photo-0:')).length),1,'returning reuses downloaded bytes after the decoded preview is released');
    await page.evaluate(()=>window.replaceImages([{id:'other-thread',role:'assistant',content:'',parts:[{type:'media',media:{url:'conversation-image:other-thread:'+ 'a'.repeat(64),title:'Other thread',width:1024,height:512}}]}]));
    await page.waitForFunction(()=>document.querySelector('[aria-label="Open Other thread"] img')?.naturalWidth>0);
    const readsBeforeSwitchBack=await page.evaluate(()=>window.reads.length);
    await page.evaluate(()=>window.replaceImages([{id:'photo-0',role:'assistant',content:'',parts:[{type:'media',media:{url:'conversation-image:photo-0:'+ 'a'.repeat(64),title:'Photo 0',width:1024,height:512}}]}]));
    assert.equal(await shot(0).locator('img').getAttribute('src'),firstThumbnail,'returning to an unmounted conversation immediately reuses its ready preview');
    assert.equal(await page.evaluate(()=>window.reads.length),readsBeforeSwitchBack,'switching back needs no new host read or thumbnail encoding');
    // Crowded thumbnails must all render without repeated downloads.
    await page.evaluate(()=>window.replaceImages([
      {id:'photo-0',role:'assistant',content:'',parts:[{type:'media',media:{url:'conversation-image:photo-0:'+ 'a'.repeat(64),title:'Photo 0',width:1024,height:512}}]},
      {id:'crowded',role:'user',content:'',parts:Array.from({length:8},(_,i)=>({type:'attachment',attachment:{kind:'image',name:'Crowded '+i,path:'/crowded-'+i+'.png'}}))},
    ]));
    await page.getByRole('button',{name:'Open Crowded 0',exact:true}).evaluate(el=>el.scrollIntoView({block:'center'}));
    await page.waitForFunction(()=>window.active>=2);
    assert.equal(await page.evaluate(()=>window.reads.filter(reference=>reference.includes('crowded')).length),2,'the host read limit holds while replies are pending');
    await page.waitForFunction(()=>!document.querySelector('[aria-label="Open Photo 0"] img'));
    await shot(0).evaluate(el=>el.scrollIntoView({block:'center'}));
    await page.waitForFunction(()=>document.querySelector('[aria-label="Open Photo 0"] img')?.naturalWidth>0);
    assert.equal(await shot(0).locator('img').getAttribute('src'),firstThumbnail,'a cached preview bypasses unrelated unresolved image reads');
    assert.equal(await page.evaluate(()=>window.active),2,'the cache hit must paint before either cold read completes');
    assert.equal(await page.evaluate(()=>window.reads.filter(r=>r.includes(':photo-0:')).length),1,'the cache hit makes no additional host transfer');
    await page.evaluate(()=>window.releaseCrowdedImages());
    for (let i=0;i<8;i++) {
      await page.getByRole('button',{name:'Open Crowded '+i,exact:true}).evaluate(el=>el.scrollIntoView({block:'center'}));
      await page.waitForFunction(i=>document.querySelector('[aria-label="Open Crowded '+i+'"] img')?.naturalWidth>0,i);
    }
    await page.waitForFunction(()=>window.reads.some(r=>r.includes('crowded')) && window.active===0 && !document.body.textContent.includes('Loading image…'));
    const settled = await page.evaluate(()=>({reads:window.reads.length,urls:window.urls.size,retainedBytes:[...window.cachedBytes.values()].reduce((a,b)=>a+b,0)+[...document.querySelectorAll('img')].reduce((a,x)=>a+x.naturalWidth*x.naturalHeight*4,0)}));
    assert.ok(settled.retainedBytes<=5*1024*1024,'compressed originals and decoded thumbnails share the configured bound');
    await page.getByRole('button',{name:'Open Crowded 7',exact:true}).scrollIntoViewIfNeeded();
    await page.getByRole('button',{name:'Open Crowded 0',exact:true}).scrollIntoViewIfNeeded();
    await page.locator('[aria-label^="Open Crowded"] img').evaluateAll(images=>Promise.all(images.map(image=>image.decode())));
    assert.equal(await page.evaluate(()=>window.reads.length),settled.reads,'crowded previews do not continuously refetch');
    assert.equal(await page.locator('[aria-label^="Open Crowded"] img').count(),8,'all crowded previews render within the bounded cache');
    await page.evaluate(()=>window.replaceImages([{id:'large',role:'assistant',content:'',parts:[{type:'media',media:{url:'/large.png',title:'Large',width:3072,height:2048}}]}]));
    const large=page.getByRole('button',{name:'Open Large',exact:true});
    await large.evaluate(el=>el.scrollIntoView());
    await page.waitForFunction(()=>document.querySelector('[aria-label="Open Large"] img')?.naturalWidth>0);
    assert.ok(await large.locator('img').evaluate(el=>el.naturalWidth<3072),'large originals use a smaller inline preview');
    await large.click();
    const original=await page.evaluate(async()=>{const image=new Image(); image.src=window.openedImage.src; await image.decode(); const href=document.querySelector('[aria-label="Download media"]')?.getAttribute('href');return {width:image.naturalWidth,height:image.naturalHeight,downloadMatchesOriginal:href===window.openedImage.src,bytesMatch:await (await fetch(window.openedImage.src)).blob().then(blob=>new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(r.result===window.originals.get('/large.png'));r.readAsDataURL(blob);}))};});
    assert.deepEqual(original,{width:3072,height:2048,downloadMatchesOriginal:true,bytesMatch:true},'open and download retain the full original');
    const qualityPage = await browser.newPage({viewport:{width:1200,height:900},deviceScaleFactor:2});
    await qualityPage.addInitScript(()=>{ window.previewBudgetBytes=64*1024*1024; });
    await qualityPage.goto(new URL('/image-viewport',server.resolvedUrls.local[0]).href);
    await qualityPage.evaluate(()=>window.replaceImages([{id:'portrait',role:'assistant',content:'',parts:[{type:'media',media:{url:'/portrait.png',title:'Portrait',width:1170,height:2532}}]}]));
    const portrait=qualityPage.getByRole('button',{name:'Open Portrait',exact:true});
    await portrait.evaluate(el=>el.scrollIntoView({block:'start'}));
    await qualityPage.waitForFunction(()=>document.querySelector('[aria-label="Open Portrait"] img')?.naturalWidth>0);
    assert.ok((await portrait.boundingBox()).height <= 360, 'tall screenshots must not dominate the conversation');
    const portraitBounds = await portrait.boundingBox();
    assert.ok(Math.abs(portraitBounds.width / portraitBounds.height - 1170 / 2532) < 0.001, 'portrait containers shrink to the image without side gutters');
    const portraitSize=await portrait.locator('img').evaluate(image=>({
      width:image.naturalWidth,height:image.naturalHeight,
      requiredWidth:Math.min(1170,Math.round(image.getBoundingClientRect().width*devicePixelRatio)),
    }));
    await qualityPage.screenshot({path:join(artifacts,engine.name()+'-portrait.png')});
    assert.ok(portraitSize.width>=portraitSize.requiredWidth-1,'portrait thumbnails must retain enough pixels for their rendered width on a Retina display: '+JSON.stringify(portraitSize));
    assert.ok(Math.abs(portraitSize.width/portraitSize.height-1170/2532)<0.001,'portrait previews preserve the source aspect ratio');
    await qualityPage.setViewportSize({width:390,height:600});
    assert.ok((await portrait.boundingBox()).height <= 300, 'previews use at most half a small viewport');
    // Intrinsic sizing applies to both metadata-backed placeholders and images
    // whose original dimensions are learned during the lazy host read.
    await qualityPage.setViewportSize({width:1200,height:900});
    await qualityPage.evaluate(()=>window.replaceImages([{id:'small-wide',role:'assistant',content:'',parts:[{type:'media',media:{url:'/small-wide.png',title:'Small wide',width:96,height:48}}]}]));
    const smallWide=qualityPage.getByRole('button',{name:'Open Small wide',exact:true});
    await smallWide.scrollIntoViewIfNeeded();
    await qualityPage.waitForFunction(()=>window.reads.includes('/small-wide.png'));
    const smallPlaceholder=await smallWide.boundingBox();
    assert.ok(Math.abs(smallPlaceholder.width-96)<1 && Math.abs(smallPlaceholder.height-48)<1,
      'small-image placeholders must not upscale beyond original dimensions: '+JSON.stringify(smallPlaceholder));
    await qualityPage.evaluate(()=>window.releaseSmallImages());
    await qualityPage.waitForFunction(()=>document.querySelector('[aria-label="Open Small wide"] img')?.naturalWidth>0);
    assert.deepEqual(await smallWide.boundingBox(),smallPlaceholder,'decoding keeps the natural-size placeholder geometry');
    for (const viewportWidth of [1200,390]) {
      await qualityPage.setViewportSize({width:viewportWidth,height:600});
      const bounds=await smallWide.boundingBox();
      assert.ok(Math.abs(bounds.width-96)<1 && Math.abs(bounds.height-48)<1,'small landscape images stay natural size on desktop and phones');
    }
    await qualityPage.evaluate(()=>window.replaceImages([{id:'small-icon',role:'assistant',content:'',parts:[{type:'media',media:{url:'/small-icon.png',title:'Small icon'}}]}]));
    const smallIcon=qualityPage.getByRole('button',{name:'Open Small icon',exact:true});
    await smallIcon.scrollIntoViewIfNeeded();
    await qualityPage.waitForFunction(()=>document.querySelector('[aria-label="Open Small icon"] img')?.naturalWidth>0);
    for (const viewportWidth of [1200,390]) {
      await qualityPage.setViewportSize({width:viewportWidth,height:600});
      const bounds=await smallIcon.boundingBox();
      assert.ok(Math.abs(bounds.width-64)<1 && Math.abs(bounds.height-64)<1,'learned original dimensions prevent icon upscaling');
      await qualityPage.screenshot({path:join(artifacts,engine.name()+'-small-'+viewportWidth+'.png')});
    }
    // A large byte budget must not retain unbounded metadata for tiny images.
    let oldestTiny, newestTiny;
    for (let index=0;index<129;index++) {
      await qualityPage.evaluate(index=>window.replaceImages([{id:'tiny-'+index,role:'assistant',content:'',parts:[{type:'media',media:{url:'conversation-image:small-tiny-'+index+':'+ 'a'.repeat(64),title:'Tiny',width:64,height:64}}]}]),index);
      await qualityPage.waitForFunction(()=>document.querySelector('[aria-label="Open Tiny"] img')?.naturalWidth>0);
      newestTiny=await qualityPage.getByRole('button',{name:'Open Tiny',exact:true}).locator('img').getAttribute('src');
      if (index===0) oldestTiny=newestTiny;
    }
    const tinyReads=await qualityPage.evaluate(()=>window.reads.length);
    await qualityPage.evaluate(()=>window.replaceImages([]));
    assert.equal(await qualityPage.evaluate(url=>window.urls.has(url),oldestTiny),false,'oldest idle previews are evicted even when tiny images fit the byte budget');
    assert.ok(await qualityPage.evaluate(()=>window.urls.size<=128),'at most 128 idle image entries remain');
    await qualityPage.evaluate(()=>window.replaceImages([{id:'tiny-128',role:'assistant',content:'',parts:[{type:'media',media:{url:'conversation-image:small-tiny-128:'+ 'a'.repeat(64),title:'Tiny',width:64,height:64}}]}]));
    assert.equal(await qualityPage.getByRole('button',{name:'Open Tiny',exact:true}).locator('img').getAttribute('src'),newestTiny);
    assert.equal(await qualityPage.evaluate(()=>window.reads.length),tinyReads);
    await qualityPage.evaluate(()=>window.closeImages());
    assert.equal(await qualityPage.evaluate(()=>window.urls.size),0,'disposing the owner revokes the entire idle cache');
    await qualityPage.close();
    const galleryPage = await browser.newPage({viewport:{width:1200,height:900}});
    galleryPage.setDefaultTimeout(5000);
    galleryPage.setDefaultNavigationTimeout(30000);
    await galleryPage.goto(new URL('/image-viewport',server.resolvedUrls.local[0]).href);
    await galleryPage.evaluate(()=>{ window.showGallery(); window.replaceImages([
      {id:'gallery-first',role:'assistant',content:'',parts:[{type:'media',media:{url:'/portrait-gallery-first.png',title:'First',alt:'First screenshot',width:1170,height:2532}}]},
      {id:'gallery-second',role:'assistant',content:'',parts:[{type:'media',media:{url:'/slow-gallery.png',title:'Second',alt:'Second screenshot',width:1024,height:512}}]},
    ]); });
    await galleryPage.waitForFunction(()=>typeof window.releaseFirstGalleryImage==='function');
    await galleryPage.locator('[aria-label="Open fullscreen"]').first().click();
    await galleryPage.evaluate(()=>window.releaseFirstGalleryImage());
    const dialog = galleryPage.getByRole('dialog');
    const previous = dialog.getByRole('button',{name:'Previous image'}), next = dialog.getByRole('button',{name:'Next image'});
    assert.equal(await previous.isDisabled(),true);
    assert.ok(await dialog.evaluate(el=>Number(getComputedStyle(el).backgroundColor.match(/[\d.]+/g).at(-1))>=0.85),'fullscreen backdrop stays dark');
    await next.click();
    await dialog.getByAltText('Second screenshot').waitFor();
    await galleryPage.waitForFunction(()=>document.querySelector('[role="dialog"] img')?.naturalWidth===1024);
    assert.equal(await next.isDisabled(),true);
    await galleryPage.keyboard.press('ArrowLeft');
    await dialog.getByAltText('First screenshot').waitFor();
    await galleryPage.waitForFunction(()=>document.querySelector('[role="dialog"] img')?.naturalWidth===1170);
    const fullscreenBounds = await dialog.locator('img').boundingBox();
    assert.ok(Math.abs(fullscreenBounds.x+fullscreenBounds.width/2-600)<1,'fullscreen image stays centered');
    assert.ok(fullscreenBounds.y>=0 && fullscreenBounds.y+fullscreenBounds.height<=900,'portrait fits within fullscreen');
    await galleryPage.screenshot({path:join(artifacts,engine.name()+'-gallery.png')});
    await galleryPage.setViewportSize({width:390,height:600});
    const imageBounds = await dialog.locator('img').boundingBox(), arrowBounds = await next.boundingBox();
    assert.ok(imageBounds.x+imageBounds.width<=arrowBounds.x,'navigation does not cover the image on phones');
    await galleryPage.keyboard.press('Escape');
    assert.equal(await dialog.count(),0);
    await galleryPage.close();
    await page.evaluate(()=>window.replaceImages([{id:'slow',role:'assistant',content:'',parts:[{type:'media',media:{url:'/slow.png',title:'Slow'}}]}]));
    await page.getByRole('button',{name:'Open Slow',exact:true}).evaluate(el=>el.scrollIntoView());
    await page.waitForFunction(()=>window.reads.includes('/slow.png'));
    await page.evaluate(()=>window.closeImages());
    await page.evaluate(()=>window.releaseSlowImage());
    await page.waitForFunction(()=>window.active===0);
    assert.equal(await page.evaluate(()=>window.urls.size),0,'late replies cannot retain resources after the pane closes');
    evidence.push({engine:engine.name(),peak:await page.evaluate(()=>window.peak),...settled,portraitSize,stableGeometry:true,reloaded:true,released:true});
    assert.ok(evidence.at(-1).peak<=2);
    await browser.close(); browser=undefined;
  }
  await writeFile(join(artifacts, 'measurements.json'),JSON.stringify(evidence,null,2));
  console.log(JSON.stringify(evidence));
} finally { await browser?.close(); await server.close(); }
