// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
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
    ['', undefined],
  ])('maps %s to %s', (filePath, language) => {
    expect(languageForFilePath(filePath)).toBe(language);
  });

  it('renders escaped plain code with normalized language names', () => {
    expect(renderCodeBlock('<tag>\nnext', ' Unknown-Lang extra ')).toBe(
      '<pre><code class="language-unknown-lang"><span class="line">&lt;tag&gt;</span><span class="line">next</span></code></pre>',
    );
    expect(renderCodeBlock('&', undefined)).toBe('<pre><code><span class="line">&amp;</span></code></pre>');
  });
});
