// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import {
  renderInlineToken,
  renderMarkdown,
  renderUserText,
  safeMarkdownHref,
} from '../../src/chat/message-markdown';

describe('message markdown rendering', () => {
  it('renders task lists in chat messages', () => {
    const html = renderMarkdown('- [ ] Todo\n- [x] Done');

    expect(html).toBe([
      '<ul>',
      '<li><input disabled="" type="checkbox"> Todo</li>',
      '<li><input checked="" disabled="" type="checkbox"> Done</li>',
      '</ul>',
      '',
    ].join('\n'));
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

  it('escapes raw HTML exactly and converts soft line breaks', () => {
    expect(renderMarkdown('<b title="x">raw & unsafe</b>'))
      .toBe('<p>&lt;b title=&quot;x&quot;&gt;raw &amp; unsafe&lt;/b&gt;</p>\n');
    expect(renderMarkdown('first\nsecond')).toBe('<p>first<br>second</p>\n');
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

  it('trims bracket-delimited LaTeX source before rendering', () => {
    const html = renderMarkdown('\\[\n  x + 1  \n\\]\n\nInline \\(  y + 2  \\)');

    expect(html).toContain('<annotation encoding="application/x-tex">x + 1</annotation>');
    expect(html).toContain('<annotation encoding="application/x-tex">y + 2</annotation>');
  });

  it('keeps inline LaTeX inline and refuses trusted HTML-producing commands', () => {
    const inline = renderMarkdown('Inline \\(x + 1\\) only');
    const untrusted = renderMarkdown('\\(\\href{javascript:alert(1)}{unsafe}\\)');

    expect(inline).toContain('class="katex"');
    expect(inline).not.toContain('class="katex-display"');
    expect(inline).not.toContain('display="block"');
    expect(untrusted).not.toContain('href="javascript:');
    expect(untrusted).not.toContain('<a ');
  });

  it('renders standard dollar-delimited inline and display LaTeX without interpreting currency', () => {
    const html = renderMarkdown('Inline $x^2$ and\n\n$$\n\\boxed{x^2 + x - 4}\n$$\n\nBudget is $5 and $10.');

    expect(html).toContain('display="block"');
    expect(html).toContain('class="katex"');
    expect(html).toContain('Budget is $5 and $10.');
  });

  it('keeps dollar-delimited LaTeX conservative, non-throwing, and untrusted', () => {
    const adjacent = renderMarkdown('prefix$x=x^2$suffix');
    const invalid = renderMarkdown('$\\notARealCommand{x}$');
    const untrusted = renderMarkdown('$\\href{javascript:alert(1)}{unsafe}$');

    expect(adjacent).toBe('<p>prefix$x=x^2$suffix</p>\n');
    expect(invalid).toContain('class="katex"');
    expect(invalid).toContain('notARealCommand');
    expect(untrusted).not.toContain('href="javascript:');
    expect(untrusted).not.toContain('<a ');
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

  it('adds escaped copy controls to every code block only when requested', () => {
    const html = renderMarkdown([
      '```text',
      'first',
      '```',
      '',
      '```text',
      'second',
      '```',
    ].join('\n'), { codeCopyLabel: 'Copy "code"' });

    expect(html.match(/data-chat-code-copy/g)).toHaveLength(2);
    expect(html.match(/class="chat-code-block"/g)).toHaveLength(2);
    expect(html.match(/chat-code-block__copy-icon/g)).toHaveLength(2);
    expect(html.match(/chat-code-block__check-icon/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Copy &quot;code&quot;"');
    expect(html).toContain('title="Copy &quot;code&quot;"');
    expect(html).toContain('</svg></button><pre');
    expect(html).not.toContain('Stryker was here!');
    expect(renderMarkdown('plain text', { codeCopyLabel: 'Copy' }))
      .not.toContain('data-chat-code-copy');
    expect(renderMarkdown('```text\ncode\n```')).not.toContain('data-chat-code-copy');
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
    expect(renderMarkdown('[http](http://example.com)'))
      .toContain('chat-message-link__icon--external');
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
    const container = document.createElement('div');
    container.innerHTML = html;
    const anchor = container.querySelector('a');

    expect(html).toContain('href="src/index.html"');
    expect(html).toContain('chat-message-link__icon--file');
    expect(html).not.toContain('target="_blank"');
    expect(html).not.toContain('googleusercontent.com');
    expect(anchor?.getAttributeNames()).toEqual(['class', 'href']);
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

  it('allows relative images while blocking navigation-only and contact image sources', () => {
    const relative = renderMarkdown('![local](images/diagram.png)');
    const container = document.createElement('div');
    container.innerHTML = relative;
    const image = container.querySelector('img');
    const blocked = [
      '#section',
      '?download=1',
      'mailto:test@example.com',
      'tel:+15551234567',
    ].map((href) => renderMarkdown(`![blocked](${href})`));

    expect(relative).toContain('<img class="chat-message-image" src="images/diagram.png"');
    expect(image?.getAttributeNames()).toEqual([
      'class',
      'src',
      'alt',
      'loading',
      'decoding',
      'referrerpolicy',
    ]);
    for (const html of blocked) {
      expect(html).toContain('chat-message-image--blocked');
      expect(html).not.toContain('<img');
      expect(html).not.toContain('src=');
    }
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

  it('covers defensive inline token rendering branches', () => {
    expect(renderInlineToken(null)).toBe('');
    expect(renderInlineToken({ tokens: [{ text: 'loud' }], type: 'strong' })).toBe('<strong>loud</strong>');
    expect(renderInlineToken({ tokens: [{ text: 'quiet' }], type: 'em' })).toBe('<em>quiet</em>');
    expect(renderInlineToken({ tokens: [{ text: 'plain' }], type: 'span' })).toBe('plain');
    expect(renderInlineToken({ raw: '<raw>' })).toBe('&lt;raw&gt;');
    expect(renderInlineToken({})).toBe('');

  });

  it('renders exact inline-token precedence and multi-token ordering', () => {
    expect(renderInlineToken({
      raw: 'ignored',
      text: 'ignored',
      tokens: [{ text: 'A&' }, { raw: '<B>' }],
      type: 'strong',
    })).toBe('<strong>A&amp;&lt;B&gt;</strong>');
    expect(renderInlineToken({
      raw: 'ignored',
      text: '<code>',
      type: 'codespan',
    })).toBe('<code>&lt;code&gt;</code>');
    expect(renderInlineToken({ raw: '<raw>', text: '<text>' })).toBe('&lt;text&gt;');
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
    expect(safeMarkdownHref('  https://example.com/trimmed  ')).toBe('https://example.com/trimmed');
    expect(safeMarkdownHref('README.md:12')).toBe('README.md:12');
    expect(safeMarkdownHref('docs/http:notes.md')).toBe('docs/http:notes.md');
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'java1script:alert(1)',
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
