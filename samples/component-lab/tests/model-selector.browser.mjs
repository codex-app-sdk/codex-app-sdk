import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const cacheDir = await mkdtemp(path.join(tmpdir(), 'sdk-model-menu-'));
const server = await createServer({ configFile: false, root, cacheDir, resolve: { dedupe: ['vue'] }, plugins: [vue(), {
  name: 'model-menu-fixture',
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      if (!request.url?.startsWith('/model-menu')) return next();
      response.setHeader('Content-Type', 'text/html');
      response.end('<div id="app"></div><script type="module" src="/src/model-menu-fixture.js"></script>');
    });
  },
  resolveId(id) { if (id === '/src/model-menu-fixture.js') return '\0model-menu-fixture'; },
  load(id) {
    if (id !== '\0model-menu-fixture') return;
    return `
      import { createApp, h, reactive } from 'vue';
      import '/packages/vue/src/styles.css';
      import Selector from '/packages/vue/src/chat/ChatModelReasoningSelector.vue';
      const selected = reactive({ model: 'model-0', effort: 'medium' });
      window.modelMenuSelection = selected;
      window.hostActionIds = [];
      const menuItems = new URLSearchParams(location.search).has('favorites') ? [
        { id: 'add-favorite', type: 'action', label: 'Add current to favorites', closeOnSelect: false },
        { id: 'favorite', type: 'submenu', label: 'Favorite model', selectAction: { id: 'favorite', type: 'action', label: 'Favorite model' }, items: [{ id: 'favorite-high', type: 'radio', label: 'High', checked: true }] },
      ] : [];
      const models = Array.from({ length: 40 }, (_, index) => ({ id: 'model-' + index, model: 'model-' + index,
        displayName: 'Model ' + String(index).padStart(2, '0'), supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'].map(reasoningEffort => ({ reasoningEffort, description: reasoningEffort })) }));
      createApp({ render: () => h('div', { id: 'selector-position', style: 'position:fixed;bottom:24px;left:360px' }, [h(Selector, {
        models, menuItems, onMenuSelect: item => { window.hostActionIds.push(item.id); }, modelId: selected.model, reasoningEffort: selected.effort,
        'onUpdate:modelId': model => { selected.model = model; },
        'onUpdate:reasoningEffort': effort => { selected.effort = effort; },
      })]) }).mount('#app');
    `;
  },
}], server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });

async function withinViewport(locator, viewport) {
  const bounds = await locator.boundingBox();
  assert.ok(bounds && bounds.x >= 8 && bounds.y >= 8
    && bounds.x + bounds.width <= viewport.width - 8
    && bounds.y + bounds.height <= viewport.height - 8, `Menu must fit viewport: ${JSON.stringify(bounds)}`);
}
async function hittable(locator) {
  assert.equal(await locator.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
  }), true, 'Effort option must receive pointer input, outside the scrollable model list');
}

try {
  await server.listen();
  for (const [engine, browserType] of [['chromium', chromium], ['webkit', webkit]]) {
    const browser = await browserType.launch();
    try {
      for (const favorites of [false, true]) for (const viewport of [{ width: 1024, height: 720 }, { width: 400, height: 360 }]) {
        const page = await browser.newPage({ viewport });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        try {
          await page.goto(server.resolvedUrls.local[0] + 'model-menu' + (favorites ? '?favorites' : ''));
          if (viewport.width < 720) await page.locator('#selector-position').evaluate(element => { element.style.left = 'auto'; element.style.right = '24px'; });
          const trigger = page.getByRole('button', { name: 'Model and reasoning', exact: true });
          await trigger.click();
          const menu = page.locator('.chat-model-selector__menu');
          await withinViewport(menu, viewport);
          assert.ok((await menu.boundingBox()).height < viewport.height - 32, 'Model menu must be shorter than the window');
          const scrollable = await menu.evaluate(element => [element, ...element.querySelectorAll('*')].some(part =>
            part.clientHeight > 0 && part.scrollHeight > part.clientHeight && ['auto', 'scroll'].includes(getComputedStyle(part).overflowY)));
          assert.equal(scrollable, true, 'Long model list must have a scrolling viewport');
          if (favorites) assert.ok((await menu.getByRole('separator').boundingBox()).height >= 1, 'Favorites divider must not collapse');
          const first = menu.getByRole('menuitem', { name: /^Model 00/ });
          await first.hover();
          const firstEfforts = page.getByRole('menu', { name: 'Model 00', exact: true });
          await firstEfforts.waitFor();
          await withinViewport(firstEfforts, viewport);
          const low = firstEfforts.getByRole('menuitemradio', { name: 'Low', exact: true });
          await hittable(low);
          await low.click();
          assert.deepEqual(await page.evaluate(() => ({ ...window.modelMenuSelection })), { model: 'model-0', effort: 'low' });
          await trigger.click();
          await first.hover();
          const favorite = menu.getByRole('menuitem', { name: 'Favorite model', exact: true });
          const favoriteBounds = favorites ? await favorite.boundingBox() : null;
          await page.mouse.wheel(0, 2000);
          await firstEfforts.waitFor({ state: 'hidden' });
          const last = menu.getByRole('menuitem', { name: /^Model 39/ });
          await last.scrollIntoViewIfNeeded();
          if (favorites) {
            const afterScroll = await favorite.boundingBox();
            assert.ok(Math.abs(afterScroll.y - favoriteBounds.y) <= 1, 'Favorites must stay fixed while models scroll');
            await hittable(favorite);
            assert.ok((await menu.getByRole('separator').boundingBox()).height >= 1, 'Divider stays visible after scrolling');
          }
          await last.focus();
          await last.press('ArrowRight');
          const lastEfforts = page.getByRole('menu', { name: 'Model 39', exact: true });
          await lastEfforts.waitFor();
          await withinViewport(lastEfforts, viewport);
          const high = lastEfforts.getByRole('menuitemradio', { name: 'High', exact: true });
          await hittable(high);
          await high.click();
          assert.deepEqual(await page.evaluate(() => ({ ...window.modelMenuSelection })), { model: 'model-39', effort: 'high' });
          await trigger.click();
          await page.keyboard.press('End');
          await page.waitForFunction(() => document.activeElement?.textContent?.includes('Model 39'));
          assert.ok(await menu.evaluate(element => [element, ...element.querySelectorAll('*')].some(part => part.scrollTop > 0)), 'Keyboard navigation must scroll the last model into view');
          if (favorites) {
            await favorite.hover();
            const favoriteEfforts = page.getByRole('menu', { name: 'Favorite model', exact: true });
            await favoriteEfforts.waitFor();
            await withinViewport(favoriteEfforts, viewport);
            await hittable(favoriteEfforts.getByRole('menuitemradio', { name: 'High', exact: true }));
            await favorite.click();
            assert.deepEqual(await page.evaluate(() => window.hostActionIds), ['favorite']);
            await trigger.click();
            await page.getByRole('menuitem', { name: 'Add current to favorites', exact: true }).click();
            assert.deepEqual(await page.evaluate(() => window.hostActionIds), ['favorite', 'add-favorite']);
          }
          await page.keyboard.press('Escape');
          await menu.waitFor({ state: 'hidden' });
          assert.deepEqual(errors, []);
          console.log(`${engine} ${viewport.width}x${viewport.height} favorites=${favorites}: bounded model scrolling, reachable effort flyouts, pointer and keyboard selection`);
        } finally { await page.close(); }
      }
    } finally { await browser.close(); }
  }
} finally { await server.close(); await rm(cacheDir, { recursive: true, force: true }); }
