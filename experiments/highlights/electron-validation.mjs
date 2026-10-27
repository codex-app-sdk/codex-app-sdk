import { strict as assert } from 'node:assert';
import { createServer } from 'vite';
import { _electron } from 'playwright';
import electron from 'electron';
import { fileURLToPath } from 'node:url';

const fixture = fileURLToPath(new URL('./electron/', import.meta.url));
const server = await createServer({
  configFile: false,
  root: fixture,
  server: { port: 0, host: '127.0.0.1', fs: { allow: [fileURLToPath(new URL('../../', import.meta.url))] } },
  plugins: [{ name: 'test-csp', configureServer(vite) {
    vite.middlewares.use((req, res, next) => {
      if (req.url === '/allowed' || req.url === '/blocked') {
        const wasm = req.url === '/allowed' ? " 'wasm-unsafe-eval'" : '';
        res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'${wasm}; style-src 'self' 'unsafe-inline'; connect-src 'self' ws:`);
        req.url = '/index.html';
      }
      next();
    });
  } }],
});
let app;
try {
  await server.listen();
  const port = server.httpServer.address().port;
  const origin = `http://127.0.0.1:${port}`;
  app = await _electron.launch({ executablePath: electron, args: [fileURLToPath(new URL('./electron/main.cjs', import.meta.url))], env: { ...process.env, HIGHLIGHTS_TEST_URL: `${origin}/allowed` } });
  const page = await app.firstWindow();
  await page.waitForSelector('pre.highlights');
  const allowed = await page.locator('pre.highlights code > .line').allTextContents();
  assert.deepEqual(allowed, ['<tag>', 'const answer = 42']);
  assert.equal(await page.locator('pre.highlights code tag').count(), 0);
  const colors = await page.locator('pre.highlights code span span').evaluateAll((spans) => [...new Set(spans.map((span) => getComputedStyle(span).color))]);
  assert.ok(colors.length > 1, `expected distinct syntax colors: ${colors}`);
  await page.addInitScript(() => {
    window.addEventListener('securitypolicyviolation', (event) => {
      if (event.blockedURI === 'wasm-eval') window.wasmBlocked = true;
    });
  });
  await page.goto(`${origin}/blocked`);
  await page.waitForSelector('pre.shiki');
  await page.waitForFunction(() => window.wasmBlocked === true);
  assert.equal(await page.locator('pre.highlights').count(), 0);
  const fallback = await page.locator('pre.shiki code > .line').allTextContents();
  assert.deepEqual(fallback, allowed);
  console.log('Electron: Highlights loaded with Wasm allowed; blocked Wasm retained escaped, line-preserving Shiki output.');
} finally {
  await app?.close();
  await server.close();
}
