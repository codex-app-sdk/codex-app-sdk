// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { languageForFilePath, renderCodeBlock } from '../../src/chat/syntax-highlighting';

describe('syntax highlighting', () => {
  it.each([
    ['styles.css', 'css'],
    ['changes.diff', 'diff'],
    ['changes.patch', 'diff'],
    ['container.dockerfile', 'docker'],
    ['Dockerfile', 'docker'],
    ['main.go', 'go'],
    ['index.htm', 'html'],
    ['index.html', 'html'],
    ['app.js', 'javascript'],
    ['app.mjs', 'javascript'],
    ['app.cjs', 'javascript'],
    ['data.json', 'json'],
    ['data.jsonc', 'json'],
    ['view.jsx', 'jsx'],
    ['README.md', 'markdown'],
    ['README.markdown', 'markdown'],
    ['README.mdown', 'markdown'],
    ['README.mkdn', 'markdown'],
    ['script.py', 'python'],
    ['main.rs', 'rust'],
    ['run.sh', 'sh'],
    ['run.bash', 'sh'],
    ['run.zsh', 'sh'],
    ['schema.sql', 'sql'],
    ['config.toml', 'toml'],
    ['app.ts', 'typescript'],
    ['app.mts', 'typescript'],
    ['app.cts', 'typescript'],
    ['app.tsx', 'tsx'],
    ['App.vue', 'vue'],
    ['document.xml', 'xml'],
    ['icon.svg', 'xml'],
    ['config.yaml', 'yaml'],
    ['config.yml', 'yaml'],
    ['archive.custom', 'custom'],
    ['archive.ts.bak', 'bak'],
    ['containers/app/Dockerfile', 'docker'],
    ['  SRC/App.TS  ', 'typescript'],
    ['', undefined],
    [undefined, undefined],
  ])('maps %s to %s', (filePath, language) => {
    expect(languageForFilePath(filePath)).toBe(language);
  });

  it('renders escaped plain code with normalized language names', () => {
    expect(renderCodeBlock('<tag>\n\n  next', ' Unknown-Lang extra ')).toBe(
      [
        '<pre><code class="language-unknown-lang"><span class="line">&lt;tag&gt;</span>',
        '<span class="line"></span>',
        '<span class="line">  next</span></code></pre>',
      ].join('\n'),
    );
    expect(renderCodeBlock('&', undefined)).toBe('<pre><code><span class="line">&amp;</span></code></pre>');
  });

  it('renders known languages with both packaged themes', () => {
    const html = renderCodeBlock('const answer = 42', ' typescript extra ');

    expect(html).toMatch(/--(?:shiki|hls)-light/);
    expect(html).toMatch(/--(?:shiki|hls)-dark/);
    expect(html).toContain('const');
    expect(html).toContain('answer');
  });
  it('highlights code with line-preserving escaped output after initialization', async () => {
    const input = '<script>\nconst answer = 42 & 7';
    await vi.waitFor(() => {
      const container = document.createElement('div');
      container.innerHTML = renderCodeBlock(input, 'typescript');
      expect(container.querySelector('pre.highlights')).not.toBeNull();
      const lines = [...container.querySelectorAll('pre > code > .line')];
      expect(lines.map((line) => line.textContent).join('\n')).toBe(input);
      expect(container.querySelector('script')).toBeNull();
      expect(container.innerHTML).toContain('--hls-light');
      expect(container.innerHTML).toContain('--hls-dark');
    });
  });

});
