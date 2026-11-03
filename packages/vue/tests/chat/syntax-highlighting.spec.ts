// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import CodexMessage from '../../src/components/CodexMessage.vue';
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

  it('upgrades finished code after initialization without replacing the surrounding paragraph', async () => {
    const input = '<script>\nconst answer = 42 & 7';
    const content = `Finished paragraph.\n\n\`\`\`typescript\n${input}\n\`\`\`\n\nTail`;
    const wrapper = mount(CodexMessage, { props: { message: { role: 'assistant', content, streaming: true } } });
    const paragraph = wrapper.get('p').element;
    expect(wrapper.html()).toContain('--shiki-light');
    await wrapper.setProps({ message: { role: 'assistant', content: content + ' grows', streaming: true } });
    await vi.waitFor(() => {
      expect(wrapper.find('pre.highlights').exists()).toBe(true);
      const lines = wrapper.findAll('pre > code > .line');
      expect(lines.map(line => line.text()).join('\n')).toBe(input);
      expect(wrapper.find('script').exists()).toBe(false);
      expect(wrapper.html()).toContain('--hls-light');
      expect(wrapper.html()).toContain('--hls-dark');
      expect(wrapper.get('p').element).toBe(paragraph);
    });
    wrapper.unmount();
  });
});
