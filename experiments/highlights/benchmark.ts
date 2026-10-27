import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { strict as assert } from 'node:assert';
import { JSDOM } from 'jsdom';
import { codeToHtml, codeToTokens, isSupportedLanguage } from '@pierre/highlights';
import { darkPlus, lightPlus } from '@pierre/highlights/themes';
import { renderCodeBlock } from '../../packages/vue/src/chat/syntax-highlighting';

const options = { themes: { dark: darkPlus, light: lightPlus }, defaultColor: false as const };
const decoder = new TextDecoder();
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Prototype preserves the SDK's per-line DOM contract for copying message text.
function renderHighlights(code: string, language: string): string {
  if (!isSupportedLanguage(language)) return renderCodeBlock(code, language);
  const result = codeToTokens(code, { ...options, lang: language });
  const lines = result.tokens.map((line) => `<span class="line">${line.map((token) => {
    const style = Object.entries(token.htmlStyle ?? {}).map(([key, value]) => `${key}:${value}`).join(';');
    return `<span style="${escape(style)}">${escape(token.content)}</span>`;
  }).join('')}</span>`).join('\n');
  return `<pre class="highlights" style="${escape(result.rootStyle || '')}"><code>${lines}</code></pre>`;
}

function measure(fn: () => unknown, iterations: number): number {
  for (let i = 0; i < Math.min(iterations, 10); i++) fn();
  const samples: number[] = [];
  for (let run = 0; run < 7; run++) {
    const start = performance.now();
    for (let i = 0; i < iterations; i++) fn();
    samples.push((performance.now() - start) / iterations);
  }
  return samples.sort((a, b) => a - b)[3]!;
}

const source = readFileSync(new URL('../../packages/vue/src/chat/message-markdown.ts', import.meta.url), 'utf8');
const lines = source.split('\n');
const cases = [
  ['short', lines.slice(0, 25).join('\n'), 100],
  ['medium', lines.slice(0, 150).join('\n'), 30],
  ['full', source, 15],
] as const;
console.log(`Node ${process.version}; ${process.platform} ${process.arch}; median of 7 warmed batches; milliseconds per operation`);
console.log('case\tbytes\tShiki JS\tHighlights tokens+lines\tHighlights HTML');
for (const [name, code, count] of cases) {
  const shiki = measure(() => renderCodeBlock(code, 'typescript'), count);
  const tokens = measure(() => renderHighlights(code, 'typescript'), count);
  const html = measure(() => decoder.decode(codeToHtml(code, { ...options, lang: 'typescript' })), count);
  console.log(`${name}\t${Buffer.byteLength(code)}\t${shiki.toFixed(3)}\t${tokens.toFixed(3)}\t${html.toFixed(3)}`);
}
const stream = lines.slice(0, 150).join('\n');
const steps = Array.from({ length: 40 }, (_, i) => stream.slice(0, Math.ceil(stream.length * (i + 1) / 40)));
const shikiStream = measure(() => steps.forEach((s) => renderCodeBlock(s, 'typescript')), 3);
const highlightsStream = measure(() => steps.forEach((s) => renderHighlights(s, 'typescript')), 3);
console.log(`stream (40 full re-renders, ${Buffer.byteLength(stream)} bytes): Shiki ${shikiStream.toFixed(2)} ms; Highlights ${highlightsStream.toFixed(2)} ms`);
const input = '<tag>\nconst x = 1 & 2';
const sample = renderHighlights(input, 'typescript');
const document = new JSDOM(sample).window.document;
const code = document.querySelector('pre > code')!;
assert.equal([...code.querySelectorAll(':scope > .line')].map((line) => line.textContent).join('\n'), input);
assert.equal(code.querySelector('tag'), null);
assert.ok(sample.includes('--hls-light') && sample.includes('--hls-dark'));
console.log('Prototype checks passed: line text, HTML escaping, and both theme variables.');
