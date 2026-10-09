import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';

// Real capture/worklet and composer, fed a controlled Web Audio signal; recognizer
// responses are controlled at the host boundary. No physical microphone claim.
const root = new URL('../../../', import.meta.url).pathname;
const server = await createServer({
  configFile: new URL('../vite.config.ts', import.meta.url).pathname,
  root: new URL('..', import.meta.url).pathname,
  server: { port: 0 },
});
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(server.resolvedUrls.local[0]);
  await page.evaluate(async ({ root, packaged }) => {
    const { createApp, h } = await import('/node_modules/.vite/deps/vue.js');
    if (packaged) await import('/@fs/' + root + 'packages/vue/dist/styles.css');
    const Composer = packaged
      ? (await import('/@fs/' + root + 'packages/vue/dist/index.js')).CodexComposer
      : (await import('/@fs/' + root + 'packages/vue/src/components/CodexComposer.vue')).default;
    window.speechProbe = { chunks: 0, bytes: 0, sent: [], stops: 0, cancelled: [], listeners: new Set() };
    const probe = window.speechProbe;
    const audio = new AudioContext();
    const tone = audio.createOscillator();
    const gain = audio.createGain();
    gain.gain.value = 0;
    tone.connect(gain);
    tone.start();
    probe.volume = gain.gain;
    navigator.mediaDevices.getUserMedia = async () => {
      const destination = audio.createMediaStreamDestination();
      gain.connect(destination);
      await audio.resume();
      return destination.stream;
    };
    window.codexAppSdkNative = {
      capabilities: { transcription: true },
      streamingTranscription: {
        start: async ({ sessionId }) => { probe.id = sessionId; await new Promise((resolve) => { probe.startReady = resolve; }); },
        append: async (_id, data) => { probe.chunks++; probe.bytes += data.byteLength; },
        stop: async () => { probe.stops++; return new Promise((resolve) => { probe.finish = resolve; }); },
        cancel: async (id) => { probe.cancelled.push(id); },
        onEvent: (fn) => { probe.listeners.add(fn); return () => probe.listeners.delete(fn); },
      },
    };
    const target = document.createElement('div');
    target.id = 'speech-fixture';
    target.style.cssText = 'position:fixed;inset:40px;background:white;z-index:9999;padding:30px';
    target.style.setProperty('--codex-primary-color', 'rgb(24, 88, 196)');
    document.body.append(target);
    createApp({ render: () => h(Composer, {
      disabled: false, isSending: false, placeholder: 'Dictate',
      models: [{ id: 'test-model', model: 'test-model', displayName: 'Test model', supportedReasoningEfforts: [] }],
      modelId: 'test-model', modelCatalogStatus: 'loaded',
      onSend: (text, options) => probe.sent.push({ text, options }),
    }) }).mount(target);
  }, { root, packaged: process.env.SDK_SPEECH_PACKAGE === '1' });
  const fixture = page.locator('#speech-fixture');
  const modelPicker = fixture.getByRole('button', { name: 'Model and reasoning', exact: true });
  assert.equal(await modelPicker.locator('span').isVisible(), true, 'Desktop keeps the model label');
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture.evaluate((el) => { el.style.inset = '12px'; el.style.padding = '12px'; });
  assert.equal(await modelPicker.isVisible(), true, 'Phone keeps the model picker accessible');
  assert.equal(await modelPicker.locator('span').isVisible(), false, 'Phone uses an icon instead of the model label');
  assert.equal(await modelPicker.locator('svg:visible').count(), 1, 'Phone shows one model icon');
  for (const control of [modelPicker, fixture.locator('.chat-composer__voice'), fixture.locator('.chat-composer__send')]) {
    const bounds = await control.boundingBox();
    assert.ok(bounds && bounds.width > 0 && bounds.x >= 0 && bounds.x + bounds.width <= 390,
      'Model, mic, and send must fit inside the phone viewport');
  }
  await modelPicker.click();
  await page.getByRole('menuitemradio', { name: 'Test model', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  const editor = fixture.locator('.chat-rich-text-editor');
  await editor.fill('Before ending');
  await editor.press('Home');
  for (let i = 0; i < 7; i++) await editor.press('ArrowRight');
  const initialHeight = (await fixture.locator('form').boundingBox()).height;
  await fixture.locator('.chat-composer__voice').click();
  await page.waitForFunction(() => typeof window.speechProbe.startReady === 'function');
  assert.equal((await fixture.locator('form').boundingBox()).height, initialHeight, 'Starting recording must preserve composer height');
  await page.evaluate(() => { window.speechProbe.startReady(); window.speechProbe.startReady = undefined; });
  await page.waitForFunction(() => window.speechProbe.chunks > 1);
  assert.equal((await fixture.locator('form').boundingBox()).height, initialHeight, 'Listening must preserve composer height');
  const listening = fixture.getByRole('status', { name: 'Listening', exact: true });
  assert.equal(await listening.count(), 1);
  const dot = listening.locator('span');
  assert.deepEqual(await dot.evaluate((el) => {
    const style = getComputedStyle(el);
    return { width: style.width, height: style.height, animation: style.animationName };
  }), { width: '8px', height: '8px', animation: 'none' });
  const quiet = await dot.evaluate((el) => Number(getComputedStyle(el).opacity));
  await page.evaluate(() => { window.speechProbe.volume.value = 0.1; });
  await page.waitForFunction((quiet) => Number(getComputedStyle(document.querySelector('#speech-fixture .chat-composer__listening span')).opacity) > quiet + 0.1, quiet);
  assert.equal((await fixture.locator('form').boundingBox()).height, initialHeight, 'Audio response must not change layout');
  await page.evaluate(() => { window.speechProbe.volume.value = 0; });
  await page.waitForFunction((quiet) => Number(getComputedStyle(document.querySelector('#speech-fixture .chat-composer__listening span')).opacity) <= quiet + 0.01, quiet);
  const microphone = fixture.getByRole('button', { name: 'Stop recording', exact: true });
  await microphone.hover();
  assert.deepEqual(await microphone.evaluate((el) => {
    const style = getComputedStyle(el);
    return { background: style.backgroundColor, color: style.color,
      circle: style.width === style.height && parseFloat(style.borderRadius) >= parseFloat(style.width) / 2 };
  }), { background: 'rgb(24, 88, 196)', color: 'rgb(255, 255, 255)', circle: true });
  async function transcript(finalText, partialText) {
    await page.evaluate(({ finalText, partialText }) => {
      const p = window.speechProbe;
      for (const fn of p.listeners) fn({ type: 'transcript', sessionId: p.id, finalText, partialText });
    }, { finalText, partialText });
  }
  await transcript('', 'a cat');
  await transcript('A cap.', ' is blue');
  assert.equal(await fixture.locator('.chat-composer__audio-partial').innerText(), ' is blue');
  assert.match(await fixture.locator('.chat-composer__audio-text').innerText(), /^Before A cap\. is blue ending$/);
  assert.equal(await fixture.locator('.chat-composer__audio-partial').evaluate((el) => getComputedStyle(el).opacity), '0.5');
  if (process.env.SPEECH_SCREENSHOT) await fixture.screenshot({ path: process.env.SPEECH_SCREENSHOT });
  await fixture.locator('.chat-composer__send').click();
  await page.waitForFunction(() => window.speechProbe.stops === 1);
  assert.equal(await listening.count(), 0);
  assert.equal(await fixture.locator('.chat-composer__send').isDisabled(), true);
  await fixture.locator('form').evaluate((form) => form.requestSubmit());
  assert.equal(await page.evaluate(() => window.speechProbe.sent.length), 0, 'Submit while finalizing must not send the old draft');
  await page.evaluate(() => window.speechProbe.finish({ text: 'A cap is blue.' }));
  await page.waitForFunction(() => window.speechProbe.sent.length === 1);
  assert.deepEqual(await page.evaluate(() => window.speechProbe.sent), [{ text: 'Before A cap is blue. ending', options: { inputMethod: 'dictated' } }]);
  await editor.fill('Keep this draft');
  const previousChunks = await page.evaluate(() => window.speechProbe.chunks);
  await fixture.locator('.chat-composer__voice').click();
  await page.waitForFunction(() => typeof window.speechProbe.startReady === 'function');
  await page.evaluate(() => window.speechProbe.startReady());
  await page.waitForFunction((count) => window.speechProbe.chunks > count + 1, previousChunks);
  await transcript('', 'Discard these words');
  const cancelledId = await page.evaluate(() => window.speechProbe.id);
  await microphone.press('Escape');
  assert.equal(await editor.innerText(), 'Keep this draft');
  assert.ok(await page.evaluate((id) => window.speechProbe.cancelled.includes(id), cancelledId));
  assert.equal(await page.evaluate(() => window.speechProbe.listeners.size), 0);
  const bytes = await page.evaluate(() => window.speechProbe.bytes);
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => window.speechProbe.bytes), bytes, 'Cancelled capture must stop sending PCM');
  assert.deepEqual(errors, []);
  console.log('Live composer: real AudioWorklet capture, corrected partials, caret insertion, finalize/send, draft restoration, and active-capture cancellation passed.');
} finally {
  await browser?.close();
  await server.close();
}
