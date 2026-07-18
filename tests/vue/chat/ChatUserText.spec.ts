// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import ChatUserText from '../../../src/vue/chat/ChatUserText.vue';
import { parseCodexUserText } from '../../../src/vue/chat/user-text';
import type { CodexSurfacePlugin, CodexSurfaceSkill } from '../../../src/surface';

const gmail: CodexSurfacePlugin = {
  id: 'gmail@openai-curated-remote',
  name: 'gmail',
  displayName: 'Gmail',
  shortDescription: 'Read and manage Gmail',
  brandColor: '#EA4335',
  iconUrl: 'https://files.openai.com/gmail.png',
  enabled: true,
};

const bankSkill: CodexSurfaceSkill = {
  name: 'update-bank-balance-sheet',
  displayName: 'Update Bank Balance Sheet',
  description: 'Update balances in the workbook',
  path: '/Users/nbonamy/.codex/skills/update-bank-balance-sheet/SKILL.md',
  enabled: true,
};

describe('ChatUserText', () => {
  it('renders exact app-server plugin and skill metadata as inert rich mentions', () => {
    const wrapper = mount(ChatUserText, {
      props: {
        content: [
          'Use [@gmail](plugin://gmail@openai-curated-remote) then',
          '[$update-bank-balance-sheet](/Users/nbonamy/.codex/skills/update-bank-balance-sheet/SKILL.md).',
        ].join('\n'),
        plugins: [gmail],
        skills: [bankSkill],
      },
    });

    const plugin = wrapper.get('.chat-user-text__mention--plugin');
    expect(plugin.text()).toBe('Gmail');
    expect(plugin.attributes('title')).toBe('Read and manage Gmail');
    expect(plugin.attributes('style')).toContain('--codex-mention-color: #EA4335');
    expect(plugin.get('img').attributes('src')).toBe(gmail.iconUrl);

    const skill = wrapper.get('.chat-user-text__mention--skill');
    expect(skill.text()).toBe('Update Bank Balance Sheet');
    expect(skill.attributes('title')).toBe('Update balances in the workbook');
    expect(skill.find('svg').exists()).toBe(true);
    expect(wrapper.find('a').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('plugin://');
    expect(wrapper.text()).not.toContain('/Users/nbonamy');
  });

  it('falls back immediately and enriches reactively when catalogs arrive', async () => {
    const content = [
      'Open [@app-694546cd042881919bb746a8dc300f38]',
      '(plugin://app-694546cd042881919bb746a8dc300f38@openai-curated-remote)',
      'with [$release-check](/skills/release-check/SKILL.md).',
    ].join('');
    const wrapper = mount(ChatUserText, { props: { content } });

    expect(wrapper.get('.chat-user-text__mention--plugin').text()).toBe('App');
    expect(wrapper.get('.chat-user-text__mention--skill').text()).toBe('Release Check');

    await wrapper.setProps({
      plugins: [{
        id: 'app-694546cd042881919bb746a8dc300f38@openai-curated-remote',
        name: 'app-694546cd042881919bb746a8dc300f38',
        displayName: 'Skyscanner',
        iconUrl: 'https://files.openai.com/skyscanner.png',
        enabled: true,
      }],
      skills: [{
        name: 'release-check',
        displayName: 'Release Readiness',
        path: '/skills/release-check/SKILL.md',
        enabled: true,
      }],
    });

    expect(wrapper.get('.chat-user-text__mention--plugin').text()).toBe('Skyscanner');
    expect(wrapper.get('.chat-user-text__mention--skill').text()).toBe('Release Readiness');
  });

  it('uses a generic icon when a catalog icon cannot load', async () => {
    const wrapper = mount(ChatUserText, {
      props: {
        content: 'Use [@gmail](plugin://gmail@openai-curated-remote)',
        plugins: [gmail],
      },
    });

    await wrapper.get('img').trigger('error');
    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.get('.chat-user-text__mention--plugin svg').element.tagName).toBe('svg');
  });

  it('renders a bounded app-server skill icon data URL', () => {
    const iconSmall = 'data:image/svg+xml;base64,PHN2Zy8+';
    const wrapper = mount(ChatUserText, {
      props: {
        content: 'Use [$update-bank-balance-sheet](/Users/nbonamy/.codex/skills/update-bank-balance-sheet/SKILL.md)',
        skills: [{ ...bankSkill, iconSmall }],
      },
    });

    expect(wrapper.get('.chat-user-text__mention--skill img').attributes('src')).toBe(iconSmall);
  });

  it('keeps ordinary Markdown links literal and escapes all user-controlled text', () => {
    const wrapper = mount(ChatUserText, {
      props: { content: '<script>alert(1)</script> [Docs](README.md) `code`' },
    });

    expect(wrapper.find('script').exists()).toBe(false);
    expect(wrapper.text()).toContain('<script>alert(1)</script>');
    expect(wrapper.text()).toContain('[Docs](README.md)');
    expect(wrapper.get('code').text()).toBe('code');
  });

  it('matches skill file URLs by exact app-server path and rejects lookalike destinations', () => {
    expect(parseCodexUserText(
      '[$bank](file:///Users/nbonamy/.codex/skills/update-bank-balance-sheet/SKILL.md)',
      [],
      [bankSkill],
    )).toContainEqual(expect.objectContaining({
      type: 'skill-mention',
      displayName: 'Update Bank Balance Sheet',
      skill: bankSkill,
    }));

    expect(parseCodexUserText('[$bank](/tmp/SKILL.md.exe)', [], [bankSkill]))
      .toStrictEqual([{ type: 'text', text: '[$bank](/tmp/SKILL.md.exe)' }]);
    const mismatchedSkill = parseCodexUserText(
      '[$update-bank-balance-sheet](/another/workspace/update-bank-balance-sheet/SKILL.md)',
      [],
      [bankSkill],
    );
    expect(mismatchedSkill).toStrictEqual([expect.objectContaining({
      type: 'skill-mention',
      displayName: 'Update Bank Balance Sheet',
    })]);
    expect(mismatchedSkill[0]).not.toHaveProperty('skill');
    expect(parseCodexUserText('[@gmail](https://example.com)', [gmail], []))
      .toStrictEqual([{ type: 'text', text: '[@gmail](https://example.com)' }]);
  });
});
