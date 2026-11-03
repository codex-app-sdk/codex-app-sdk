import assert from 'node:assert/strict';
import { chromium, webkit } from 'playwright';
import { createServer } from 'vite';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const baseline = process.argv.find(arg => arg.startsWith('--baseline='))?.slice('--baseline='.length);
let baselineRoot = process.argv.find(arg => arg.startsWith('--source-root='))?.slice('--source-root='.length);
const archivedBaseline = Boolean(baseline);
if (baseline) {
  baselineRoot = mkdtempSync(join(tmpdir(), 'sdk-streaming-baseline-'));
  execFileSync('tar', ['-x', '-C', baselineRoot], {
    input: execFileSync('git', ['archive', baseline, 'packages/vue/src']),
  });
  // Resolve the archived sources' dependencies without creating a branch/worktree.
  symlinkSync(new URL('../../../node_modules', import.meta.url).pathname, join(baselineRoot, 'node_modules'));
}

const server = await createServer({
  configFile: new URL('../vite.config.ts', import.meta.url).pathname,
  root: new URL('..', import.meta.url).pathname,
  plugins: baselineRoot ? [{ name: 'streaming-baseline', enforce: 'pre', resolveId(id) {
    for (const component of ['CodexMessageList.vue', 'CodexConversationPane.vue']) {
      if (id.endsWith(`packages/vue/src/components/${component}`)) return join(baselineRoot, 'packages/vue/src/components', component);
    }
  } }] : [],
  server: { port: 0, strictPort: false },
});
let browser;
try {
  await server.listen();
  for (const engine of [chromium, webkit]) {
    browser = await engine.launch();
    const page = await browser.newPage();
    await page.goto(server.resolvedUrls.local[0]);
    // Warm imports, syntax initialization and JIT; measurements exclude mount/import time.
    await page.evaluate(async () => (await import('/tests/fixtures/streaming.ts')).mountStream(0, false, true));
    await page.locator('pre.highlights').waitFor();
    await page.evaluate(async () => (await import('/tests/fixtures/streaming.ts')).clearWarmStream());
    const results = [];
    for (const [historySize, lazy, sameTurn = false, pane = false] of [[0, false], [500, true], [500, false], [50, false, true], [500, true, false, true], [500, false, false, true]]) {
      const result = await page.evaluate(async ({ historySize, lazy, sameTurn, pane }) => {
        const { mountStream } = await import('/tests/fixtures/streaming.ts');
        return mountStream(historySize, lazy, false, sameTurn, pane);
      }, { historySize, lazy, sameTurn, pane });
      results.push(result);
      if (!process.argv.includes('--measure-only')) {
        assert.equal(result.hiddenActionSvgs, 0, 'Hidden action glyphs must not create SVG DOM');
        if (historySize > 0) assert.deepEqual(result.actionVisibility, { hovered: true, focused: true, blurred: true, touched: true }, 'Actions must remain visible for pointer, keyboard focus and touch');
        assert(result.sameParagraph && result.sameCode, 'Finished Markdown DOM must survive streamed tokens');
        assert(result.selectionPreserved, 'Streaming must preserve selection in finished Markdown');
        assert.equal(result.messageUpdates, 80, 'Only the streamed message should update');
        assert(result.actionUpdates <= 80, 'Settled message actions should not render for sibling tokens');
      }
    }
    console.log(JSON.stringify({ engine: engine.name(), results }));
    await browser.close();
    browser = undefined;
  }
} finally {
  await browser?.close();
  await server.close();
  if (archivedBaseline) rmSync(baselineRoot, { recursive: true, force: true });
}
