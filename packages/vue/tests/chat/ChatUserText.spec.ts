// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { h } from 'vue';
import { describe, expect, it } from 'vitest';
import ChatUserText from '../../src/chat/ChatUserText.vue';
import { humanizeMentionName, parseCodexUserText } from '../../src/chat/user-text';
import { SparklesIcon } from '../../src/icons/app-icons';
import type { CodexSurfacePlugin, CodexSurfaceSkill } from '@codex-app-sdk/core/surface';

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
    expect(skill.findComponent(SparklesIcon).exists()).toBe(true);
    expect(wrapper.find('a').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('plugin://');
    expect(wrapper.text()).not.toContain('/Users/nbonamy');
  });

  it('renders plain skill and plugin prompts as compact inline chips', () => {
    const wrapper = mount(ChatUserText, {
      props: {
        content: 'Use $update-bank-balance-sheet and @gmail',
        plugins: [gmail],
        skills: [bankSkill],
      },
    });

    const mentions = wrapper.findAll('.chat-user-text__mention');
    expect(mentions).toHaveLength(2);
    expect(mentions[0]?.text()).toBe('Update Bank Balance Sheet');
    expect(mentions[1]?.text()).toBe('Gmail');
    expect(wrapper.text()).not.toContain('$update-bank-balance-sheet');
    expect(wrapper.text()).not.toContain('@gmail');
  });

  it('renders host mentions with app-owned message content', () => {
    const wrapper = mount(ChatUserText, {
      props: {
        content: 'Ask @thread:019abc',
        mentionGroups: [{
          id: 'threads',
          label: 'Threads',
          items: [{ id: 'thread-1', value: 'thread:019abc', label: 'codex-claw' }],
        }],
      },
      slots: {
        mention: ({ item }: { item: { label: string } }) => h('span', { class: 'host-thread-message' }, `🤖 ${item.label}`),
      },
    });

    expect(wrapper.get('.host-thread-message').text()).toBe('🤖 codex-claw');
    expect(wrapper.text()).not.toContain('@thread:019abc');
  });

  it('uses a plugin namespace instead of an opaque app id for contributed skills', () => {
    const dropbox: CodexSurfacePlugin = {
      id: 'app-69b31dc2110c8191b8b47dc98fe5a052@openai-curated-remote',
      name: 'app-69b31dc2110c8191b8b47dc98fe5a052',
      displayName: 'Dropbox',
      enabled: true,
    };
    const cleanup: CodexSurfaceSkill = {
      name: 'app-69b31dc2110c8191b8b47dc98fe5a052:clean-up-dropbox-content',
      path: '/plugins/dropbox/skills/clean-up-dropbox-content/SKILL.md',
      enabled: true,
    };
    const wrapper = mount(ChatUserText, {
      props: {
        content: 'Use $clean-up-dropbox-content',
        plugins: [dropbox],
        skills: [cleanup],
      },
    });

    expect(wrapper.get('.chat-user-text__mention--skill').text())
      .toBe('dropbox:clean-up-dropbox-content');
    expect(wrapper.text()).not.toContain(dropbox.name);
  });

  it('matches display names and parenthesized skill aliases case-insensitively', () => {
    const commitPush: CodexSurfaceSkill = {
      name: 'Commit-Push (cp)',
      path: '/Users/nbonamy/.codex/skills/commit-push/SKILL.md',
      enabled: true,
    };
    const wrapper = mount(ChatUserText, {
      props: {
        content: 'Use $Commit-Push (cp) or $cp',
        skills: [commitPush],
      },
    });

    const mentions = wrapper.findAll('.chat-user-text__mention--skill');
    expect(mentions).toHaveLength(2);
    expect(mentions.every((mention) => mention.text() === 'Commit-Push (cp)')).toBe(true);
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

    const icons = wrapper.findAll('.chat-user-text__mention--skill img');
    expect(icons).toHaveLength(1);
    expect(icons[0]!.classes()).toContain('chat-user-text__mention-image--light');
    expect(icons[0]!.attributes('src')).toBe(iconSmall);
  });

  it('renders distinct light and dark plugin icons without duplicating identical icons', async () => {
    const wrapper = mount(ChatUserText, {
      props: {
        content: '@gmail',
        plugins: [{
          ...gmail,
          iconUrl: 'https://files.openai.com/gmail-light.png',
          iconUrlDark: 'https://files.openai.com/gmail-dark.png',
        }],
      },
    });

    expect(wrapper.findAll('img').map((image) => [image.classes(), image.attributes('src')]))
      .toStrictEqual([
        [['chat-user-text__mention-image', 'chat-user-text__mention-image--light'], 'https://files.openai.com/gmail-light.png'],
        [['chat-user-text__mention-image', 'chat-user-text__mention-image--dark'], 'https://files.openai.com/gmail-dark.png'],
      ]);

    await wrapper.setProps({ plugins: [{ ...gmail, iconUrlDark: gmail.iconUrl }] });
    expect(wrapper.findAll('img')).toHaveLength(1);
    expect(wrapper.get('img').attributes('src')).toBe(gmail.iconUrl);
  });

  it.each([
    ['blob:https://example.test/icon', true],
    ['https://example.test/icon.png', true],
    ['data:image/avif;base64,YQ==', true],
    ['data:image/bmp;base64,YQ==', true],
    ['data:image/gif;base64,YQ==', true],
    ['data:image/jpeg;base64,YQ==', true],
    ['data:image/png;base64,YQ==', true],
    ['data:image/svg+xml;base64,YQ==', true],
    ['data:image/webp;base64,YQ==', true],
    ['data:image/x-icon;base64,YQ==', true],
    ['http://example.test/icon.png', false],
    ['javascript:alert(1)', false],
    ['prefix-blob:https://example.test/icon', false],
    ['prefix-data:image/png;base64,YQ==', false],
    ['data:image/heic;base64,YQ==', false],
  ])('accepts only a bounded mention icon URL %s: %s', (iconUrl, accepted) => {
    const wrapper = mount(ChatUserText, {
      props: { content: '@gmail', plugins: [{ ...gmail, iconUrl }] },
    });

    expect(wrapper.find('img').exists()).toBe(accepted);
    if (accepted) expect(wrapper.get('img').attributes('src')).toBe(iconUrl);
  });

  it.each([
    ['#abc', true],
    ['#ABCDEF12', true],
    ['#ab', false],
    ['#abcdefghi', false],
    ['x#abcdef', false],
    ['#abcdefx', false],
    ['red', false],
    ['', false],
  ])('accepts only an anchored mention color %s: %s', (brandColor, accepted) => {
    const wrapper = mount(ChatUserText, {
      props: { content: '@gmail', plugins: [{ ...gmail, brandColor }] },
    });

    expect(wrapper.get('.chat-user-text__mention').attributes('style')?.includes(brandColor) ?? false)
      .toBe(accepted);
  });

  it('uses skill-owned color and title precedence independently from plugins', () => {
    const short = mount(ChatUserText, {
      props: {
        content: '$update-bank-balance-sheet',
        skills: [{ ...bankSkill, brandColor: '#123abc', shortDescription: 'Short skill summary' }],
      },
    });
    const description = mount(ChatUserText, {
      props: { content: '$update-bank-balance-sheet', skills: [bankSkill] },
    });
    const fallback = mount(ChatUserText, {
      props: {
        content: '$update-bank-balance-sheet',
        skills: [{ ...bankSkill, description: undefined, displayName: undefined }],
      },
    });

    expect(short.get('.chat-user-text__mention').attributes('style')).toContain('#123abc');
    expect(short.get('.chat-user-text__mention').attributes('title')).toBe('Short skill summary');
    expect(description.get('.chat-user-text__mention').attributes('title'))
      .toBe('Update balances in the workbook');
    expect(fallback.get('.chat-user-text__mention').attributes('title'))
      .toBe('update-bank-balance-sheet');
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

  it('returns exact text, code, and line-break tokens in source order', () => {
    expect(parseCodexUserText('before `code`\nafter')).toStrictEqual([
      { type: 'text', text: 'before ' },
      { type: 'code', text: 'code' },
      { type: 'line-break' },
      { type: 'text', text: 'after' },
    ]);
    expect(parseCodexUserText('')).toStrictEqual([]);
  });

  it('keeps unresolved bare mentions literal with every default catalog', () => {
    expect(parseCodexUserText('@missing')).toStrictEqual([{ type: 'text', text: '@missing' }]);
    expect(parseCodexUserText('$missing')).toStrictEqual([{ type: 'text', text: '$missing' }]);
    expect(parseCodexUserText('/missing')).toStrictEqual([{ type: 'text', text: '/missing' }]);
  });

  it('returns exact bare skill and plugin tokens', () => {
    expect(parseCodexUserText('$update-bank-balance-sheet', [gmail], [bankSkill]))
      .toStrictEqual([{
        type: 'skill-mention',
        displayName: 'Update Bank Balance Sheet',
        href: bankSkill.path,
        label: '$update-bank-balance-sheet',
        skill: bankSkill,
      }]);
    expect(parseCodexUserText('@gmail', [gmail], [bankSkill])).toStrictEqual([{
      type: 'plugin-mention',
      displayName: 'Gmail',
      href: 'plugin://gmail@openai-curated-remote',
      label: '@gmail',
      plugin: gmail,
    }]);
  });

  it('keeps the bare trigger authoritative when plugin and skill names collide', () => {
    const gmailSkill: CodexSurfaceSkill = {
      name: 'gmail',
      path: '/skills/gmail/SKILL.md',
      enabled: true,
    };

    expect(parseCodexUserText('@gmail /gmail', [gmail], [gmailSkill])).toStrictEqual([
      {
        type: 'plugin-mention',
        displayName: 'Gmail',
        href: 'plugin://gmail@openai-curated-remote',
        label: '@gmail',
        plugin: gmail,
      },
      { type: 'text', text: ' ' },
      { type: 'text', text: '/gmail' },
    ]);
  });

  it('resolves custom mentions before plugins and after them according to placement', () => {
    const before = {
      id: 'before',
      label: 'Before',
      items: [{ id: 'before-gmail', value: 'gmail', label: 'Leading Gmail' }],
    } as const;
    const after = {
      id: 'after',
      label: 'After',
      placement: 'after',
      items: [
        { id: 'after-gmail', value: 'gmail', label: 'Trailing Gmail' },
        { id: 'after-thread', value: 'thread:123', label: 'Trailing Thread' },
      ],
    } as const;

    expect(parseCodexUserText('@gmail', [gmail], [], [before, after])).toStrictEqual([{
      type: 'custom-mention',
      displayName: 'Leading Gmail',
      group: before,
      item: before.items[0],
      label: '@gmail',
    }]);
    expect(parseCodexUserText('@gmail', [gmail], [], [after])).toStrictEqual([{
      type: 'plugin-mention',
      displayName: 'Gmail',
      href: 'plugin://gmail@openai-curated-remote',
      label: '@gmail',
      plugin: gmail,
    }]);
    expect(parseCodexUserText('@thread:123', [gmail], [], [after])).toStrictEqual([{
      type: 'custom-mention',
      displayName: 'Trailing Thread',
      group: after,
      item: after.items[1],
      label: '@thread:123',
    }]);
  });

  it('recognizes only complete mention syntaxes and preserves ordinary Markdown', () => {
    expect(parseCodexUserText('[Docs](README.md) [@gmail](https://example.com)', [gmail]))
      .toStrictEqual([
        { type: 'text', text: '[Docs](README.md)' },
        { type: 'text', text: ' ' },
        { type: 'text', text: '[@gmail](https://example.com)' },
      ]);
    expect(parseCodexUserText('[@gmail](plugin://) [broken](destination'))
      .toStrictEqual([
        { type: 'text', text: '[@gmail](plugin://)' },
        { type: 'text', text: ' [broken](destination' },
      ]);
  });

  it('normalizes encoded and angle-wrapped plugin destinations without losing canonical text', () => {
    expect(parseCodexUserText(
      ' [ @ignored ](README.md) [@Mail]( <plugin://gmail%40openai-curated-remote> ) ',
      [gmail],
    )).toStrictEqual([
      { type: 'text', text: ' ' },
      { type: 'text', text: '[ @ignored ](README.md)' },
      { type: 'text', text: ' ' },
      {
        type: 'plugin-mention',
        displayName: 'Gmail',
        href: 'plugin://gmail%40openai-curated-remote',
        label: '@Mail',
        plugin: gmail,
      },
      { type: 'text', text: ' ' },
    ]);
  });

  it('trims mention labels and only unwraps destinations with both angle brackets', () => {
    expect(parseCodexUserText('[ @Mail ](< plugin://gmail%40openai-curated-remote >)', [gmail]))
      .toStrictEqual([{
        type: 'plugin-mention',
        displayName: 'Gmail',
        href: 'plugin://gmail%40openai-curated-remote',
        label: '@Mail',
        plugin: gmail,
      }]);
    expect(parseCodexUserText('[@Mail](plugin://gmail%40openai-curated-remote>)', [gmail]))
      .toStrictEqual([{
        type: 'plugin-mention',
        displayName: 'Mail',
        href: 'plugin://gmail%40openai-curated-remote>',
        label: '@Mail',
      }]);
    expect(parseCodexUserText('[@Mail](<plugin://gmail%40openai-curated-remote)', [gmail]))
      .toStrictEqual([{ type: 'text', text: '[@Mail](<plugin://gmail%40openai-curated-remote)' }]);
  });

  it('matches the exact plugin among multiple catalog entries', () => {
    const calendar = { ...gmail, id: 'calendar@remote', name: 'calendar', displayName: 'Calendar' };
    expect(parseCodexUserText('[@gmail](plugin://gmail%40openai-curated-remote)', [calendar, gmail]))
      .toStrictEqual([{
        type: 'plugin-mention',
        displayName: 'Gmail',
        href: 'plugin://gmail%40openai-curated-remote',
        label: '@gmail',
        plugin: gmail,
      }]);
  });

  it('uses stable plugin fallbacks and tolerates malformed percent escapes', () => {
    expect(parseCodexUserText('[@](plugin://calendar@remote)')).toStrictEqual([{
      type: 'plugin-mention',
      displayName: 'Calendar',
      href: 'plugin://calendar@remote',
      label: '@',
    }]);
    expect(parseCodexUserText('[@bad](plugin://bad%escape)')).toStrictEqual([{
      type: 'plugin-mention',
      displayName: 'Bad',
      href: 'plugin://bad%escape',
      label: '@bad',
    }]);
    expect(parseCodexUserText('[@](plugin://app-0123456789abcdef)')[0])
      .toMatchObject({ type: 'plugin-mention', displayName: 'App' });
    expect(parseCodexUserText('[@](plugin://@remote)')[0])
      .toMatchObject({ type: 'plugin-mention', displayName: 'App' });
  });

  it('normalizes skill destinations while retaining their authored href', () => {
    expect(parseCodexUserText(
      '[$bank]( </Users/nbonamy/.codex/skills/update-bank-balance-sheet/SKILL.md?source=chat#readme> )',
      [],
      [bankSkill],
    )).toStrictEqual([{
      type: 'skill-mention',
      displayName: 'Update Bank Balance Sheet',
      href: '/Users/nbonamy/.codex/skills/update-bank-balance-sheet/SKILL.md?source=chat#readme',
      label: '$bank',
      skill: bankSkill,
    }]);
    expect(parseCodexUserText('[$](relative/SKILL.md)')).toStrictEqual([{
      type: 'skill-mention',
      displayName: 'Skill',
      href: 'relative/SKILL.md',
      label: '$',
    }]);
    expect(parseCodexUserText('[$](SKILL.md)')).toStrictEqual([{
      type: 'skill-mention',
      displayName: 'Skill',
      href: 'SKILL.md',
      label: '$',
    }]);
    expect(parseCodexUserText('[Docs](/skills/docs/SKILL.md)'))
      .toStrictEqual([{ type: 'text', text: '[Docs](/skills/docs/SKILL.md)' }]);
    expect(parseCodexUserText('[$gmail](plugin://gmail@openai-curated-remote)', [gmail]))
      .toStrictEqual([{ type: 'text', text: '[$gmail](plugin://gmail@openai-curated-remote)' }]);
    expect(parseCodexUserText('[$bad](file://%)'))
      .toStrictEqual([{ type: 'text', text: '[$bad](file://%)' }]);
    expect(parseCodexUserText('[$bad](file://%/SKILL.md)'))
      .toStrictEqual([{ type: 'text', text: '[$bad](file://%/SKILL.md)' }]);
  });

  it('does not recognize bare mentions inside identifiers and preserves full aliases', () => {
    expect(parseCodexUserText(
      'mail@gmail.com foo/bar a.$update-bank-balance-sheet $Commit-Push  \t(cp)',
      [gmail],
      [{
        name: 'Commit-Push  \t(cp)',
        path: '/skills/commit/SKILL.md',
        enabled: true,
      }],
    )).toStrictEqual([
      { type: 'text', text: 'mail@gmail.com foo/bar a.$update-bank-balance-sheet ' },
      {
        type: 'skill-mention',
        displayName: 'Commit-Push  \t(cp)',
        href: '/skills/commit/SKILL.md',
        label: '$Commit-Push  \t(cp)',
        skill: {
          name: 'Commit-Push  \t(cp)',
          path: '/skills/commit/SKILL.md',
          enabled: true,
        },
      },
    ]);
  });

  it.each([
    ['', 'Fallback'],
    ['  @release_check  ', 'Release Check'],
    ['app-0123456789abcdef', 'Fallback'],
    ['app0123456789abcdef', 'Fallback'],
    ['xapp-0123456789abcdef', 'Xapp 0123456789abcdef'],
    ['app-0123456789abcdefx', 'App 0123456789abcdefx'],
    ['hello@world', 'Hello@world'],
    ['_hello__world_', 'Hello World'],
    ['API_client', 'API Client'],
    ['ABCD_client', 'ABCD Client'],
    ['api_client', 'Api Client'],
  ])('humanizes %j as %j', (value, expected) => {
    expect(humanizeMentionName(value, 'Fallback')).toBe(expected);
  });
});
