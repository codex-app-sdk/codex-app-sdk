// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import {
  renderInlineToken,
  renderMarkdown,
  renderTaskItem,
  renderUserText,
  safeMarkdownHref,
} from '../../src/chat/message-markdown';

describe('message markdown rendering', () => {
  it('renders task lists in chat messages', () => {
    const html = renderMarkdown('- [ ] Todo\n- [x] Done');

    expect(html).toContain('type="checkbox"');
    expect(html).toContain('Todo');
    expect(html).toContain('Done');
  });

  it('renders autolinked email addresses without recursing', () => {
    const html = renderMarkdown('1. **nbonamy@gmail.com**');

    expect(html).toContain('nbonamy@gmail.com');
    expect(html).toContain('<strong>');
  });

  it('escapes raw html but renders markdown structures', () => {
    const html = renderMarkdown('<script>bad</script>\n\n- one\n- two\n\n`code`');

    expect(html).toContain('&lt;script&gt;bad&lt;/script&gt;');
    expect(html).toContain('<li>one</li>');
    expect(html).toContain('<code>code</code>');
  });

  it('renders Codex bracket-delimited display and inline LaTeX with KaTeX', () => {
    const html = renderMarkdown([
      'I read your drawing as:',
      '',
      '\\[',
      'y=x^2-4+x',
      '\\]',
      '',
      'Vertex: \\(\\left(-\\frac12,-\\frac{17}{4}\\right)\\)',
    ].join('\n'));

    expect(html).toContain('class="katex-display"');
    expect(html).toContain('class="katex"');
    expect(html).toContain('class="katex-html"');
    expect(html).toContain('class="katex-mathml"');
    expect(html).toContain('<math');
    expect(html).toContain('frac');
  });

  it('renders standard dollar-delimited inline and display LaTeX without interpreting currency', () => {
    const html = renderMarkdown('Inline $x^2$ and\n\n$$\n\\boxed{x^2 + x - 4}\n$$\n\nBudget is $5 and $10.');

    expect(html).toContain('display="block"');
    expect(html).toContain('class="katex"');
    expect(html).toContain('Budget is $5 and $10.');
  });

  it('keeps incomplete, inline-code, and fenced LaTeX source as code or text', () => {
    const html = renderMarkdown([
      'Incomplete \\(x + 1',
      '',
      '`\\(x^2\\)`',
      '',
      '```tex',
      '\\[ x^2 \\]',
      '```',
    ].join('\n'));

    expect(html).not.toContain('class="katex-display"');
    expect(html).toContain('<code>\\(x^2\\)</code>');
    expect(html).toContain('language-tex');
  });

  it('renders unsupported LaTeX as safe visible math rather than failing the message', () => {
    const html = renderMarkdown('\\[\\notARealCommand{x}\\]');

    expect(html).toContain('class="katex-display"');
    expect(html).toContain('notARealCommand');
    expect(html).not.toContain('<script>');
  });

  it('syntax-highlights fenced code blocks with a known language', () => {
    const html = renderMarkdown('```ts\nconst ok = true\n```');

    expect(html).toContain('class="shiki shiki-themes');
    expect(html).toContain('light-plus');
    expect(html).toContain('dark-plus');
    expect(html).toContain('--shiki-light');
    expect(html).toContain('--shiki-dark');
    expect(html).toContain('const');
  });

  it('escapes fenced code blocks when the language is not supported', () => {
    const html = renderMarkdown('```unknown-lang\n<script>bad</script>\n```');

    expect(html).toContain('class="language-unknown-lang"');
    expect(html).toContain('&lt;script&gt;bad&lt;/script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('renders safe link icons for web, mail, and file-style links', () => {
    const html = renderMarkdown([
      '[web](https://example.com/a)',
      '[mail](mailto:test@example.com)',
      '[file](README.md)',
    ].join('\n'));

    expect(html).toContain('chat-message-link__icon--external');
    expect(html).toContain('chat-message-link__icon--mail');
    expect(html).toContain('chat-message-link__icon--file');
    expect(html).toContain('target="_blank" rel="noopener noreferrer"');
  });

  it('adds safe link attributes to markdown links', () => {
    const html = renderMarkdown('[OpenAI](https://openai.com)');

    expect(html).toContain('class="chat-message-link"');
    expect(html).toContain('href="https://openai.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('chat-message-link__icon--external');
    expect(html).not.toContain('googleusercontent.com');
    expect(html).toContain('<span class="chat-message-link__label">OpenAI</span>');
  });

  it('renders external links without disclosing their origin to an icon service', () => {
    const html = renderMarkdown('[Vue docs](https://vuejs.org/guide/introduction.html?from=id8)');

    expect(html).toContain('chat-message-link__icon--external');
    expect(html).not.toContain('googleusercontent.com');
  });

  it('renders relative links with a file icon', () => {
    const html = renderMarkdown('[Open file](src/index.html)');

    expect(html).toContain('href="src/index.html"');
    expect(html).toContain('chat-message-link__icon--file');
    expect(html).not.toContain('target="_blank"');
    expect(html).not.toContain('googleusercontent.com');
  });

  it('renders titled links, nested strong tokens, and task lists', () => {
    const html = renderMarkdown('[**docs**](https://example.com "Docs")\n\n- [x] done\n- [ ] todo');

    expect(html).toContain('title="Docs"');
    expect(html).toContain('<strong>docs</strong>');
    expect(html).toContain('checked=""');
    expect(html).toContain('type="checkbox"');
  });

  it('renders inline formatting inside links without losing escaping', () => {
    const html = renderMarkdown('[**Docs** and `code`](https://example.com "`title`")');

    expect(html).toContain('<strong>Docs</strong>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('title="&#96;title&#96;"');
  });

  it('renders emphasized and escaped inline link text', () => {
    const html = renderMarkdown('[*A&B*](https://example.com)');

    expect(html).toContain('<em>A&amp;B</em>');
  });

  it('renders mail links with a mail icon', () => {
    const html = renderMarkdown('[Mail](mailto:nicolas@example.com)');

    expect(html).toContain('href="mailto:nicolas@example.com"');
    expect(html).toContain('chat-message-link__icon--mail');
    expect(html).not.toContain('chat-message-link__icon--file');
    expect(html).not.toContain('target="_blank"');
  });

  it('does not treat other non-http absolute URLs as external links', () => {
    const html = renderMarkdown('[Call](tel:+15551234567)');

    expect(html).toContain('href="tel:+15551234567"');
    expect(html).toContain('chat-message-link__icon--file');
    expect(html).not.toContain('target="_blank"');
  });

  it('removes hrefs from malformed absolute-looking links', () => {
    const html = renderMarkdown('[Broken](https://%)');

    expect(html).toContain('chat-message-link--blocked');
    expect(html).not.toContain('href=');
  });

  it('renders plain autolinks with escaped labels', () => {
    const html = renderMarkdown('<https://example.com/search?q=a&b=c>');

    expect(html).toContain('href="https://example.com/search?q=a&amp;b=c"');
    expect(html).toContain('q=a&amp;b=c');
  });

  it('sanitizes Markdown image sources and protects external image requests', () => {
    const safe = renderMarkdown('![diagram](https://example.com/diagram.png "Architecture")');
    const unsafe = renderMarkdown('![payload](data:text/html,<script>alert(1)</script>)');

    expect(safe).toContain('src="https://example.com/diagram.png"');
    expect(safe).toContain('alt="diagram"');
    expect(safe).toContain('title="Architecture"');
    expect(safe).toContain('loading="lazy"');
    expect(safe).toContain('referrerpolicy="no-referrer"');
    expect(unsafe).not.toContain('<img');
    expect(unsafe).not.toContain('src=');
    expect(unsafe).not.toContain('<script>');
  });

  it('escapes backticks in relative link hrefs', () => {
    const html = renderMarkdown('[Open](docs/`draft`.md)');

    expect(html).toContain('href="docs/&#96;draft&#96;.md"');
  });

  it('falls back to escaped task text when marked has no tokens', () => {
    const html = renderMarkdown('- [ ] <b>raw</b>');

    expect(html).toContain('&lt;b&gt;raw&lt;/b&gt;');
    expect(html).not.toContain('<b>raw</b>');
  });

  it('renders nested task content', () => {
    const html = renderMarkdown('- [x] Parent\n  - Child');

    expect(html).toContain('checked=""');
    expect(html).toContain('Parent');
    expect(html).toContain('Child');
  });

  it('renders user text as escaped preformatted text with inline code', () => {
    expect(renderUserText('hello `code`\n<script>')).toBe('<p>hello <code>code</code><br>&lt;script&gt;</p>');
  });

  it('escapes user text while preserving backticks and line breaks', () => {
    expect(renderUserText('Use `<tag>`\nthen stop')).toBe('<p>Use <code>&lt;tag&gt;</code><br>then stop</p>');
  });

  it('escapes all user text html-sensitive characters', () => {
    expect(renderUserText('&<>"\'')).toBe('<p>&amp;&lt;&gt;&quot;&#39;</p>');
  });

  it('covers defensive inline token and task item rendering branches', () => {
    expect(renderInlineToken(null)).toBe('');
    expect(renderInlineToken({ tokens: [{ text: 'loud' }], type: 'strong' })).toBe('<strong>loud</strong>');
    expect(renderInlineToken({ tokens: [{ text: 'quiet' }], type: 'em' })).toBe('<em>quiet</em>');
    expect(renderInlineToken({ tokens: [{ text: 'plain' }], type: 'span' })).toBe('plain');
    expect(renderInlineToken({ raw: '<raw>' })).toBe('&lt;raw&gt;');
    expect(renderInlineToken({})).toBe('');

    expect(renderTaskItem(null)).toContain('<input disabled="" type="checkbox">');
    expect(renderTaskItem({ checked: true, text: 'fallback' })).toContain('checked=""');
    expect(renderTaskItem({ mainContent: 'main' })).toContain('main');
  });

  it('allows only non-executable absolute schemes and safe relative links', () => {
    expect(safeMarkdownHref('https://example.com/path')).toBe('https://example.com/path');
    expect(safeMarkdownHref('HTTP://example.com')).toBe('HTTP://example.com');
    expect(safeMarkdownHref('mailto:test@example.com')).toBe('mailto:test@example.com');
    expect(safeMarkdownHref('tel:+15551234567')).toBe('tel:+15551234567');
    expect(safeMarkdownHref('file:///tmp/readme.md#L1')).toBe('file:///tmp/readme.md#L1');
    expect(safeMarkdownHref('../README.md#usage')).toBe('../README.md#usage');
    expect(safeMarkdownHref('/tmp/README.md')).toBe('/tmp/README.md');
    expect(safeMarkdownHref('C:\\work\\README.md')).toBe('C:\\work\\README.md');
    expect(safeMarkdownHref('D:/work/README.md')).toBe('D:/work/README.md');
    expect(safeMarkdownHref('#section')).toBe('#section');
    expect(safeMarkdownHref('?line=12')).toBe('?line=12');
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'blob:https://example.com/unsafe',
    '//example.com/inherited-scheme',
    '\\\\example.com\\share',
    'java\nscript:alert(1)',
    'https://%',
  ])('blocks unsafe Markdown href %s', (href) => {
    expect(safeMarkdownHref(href)).toBeNull();
    const html = renderMarkdown(`[unsafe](${href})`);
    expect(html).not.toContain('href=');
    expect(html).not.toContain('<script>');
  });
});
