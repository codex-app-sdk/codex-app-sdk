// @vitest-environment jsdom

import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import { CodexApprovalPrompt } from '../../src/vue';

const approval = {
  id: 'approval-1',
  kind: 'command' as const,
  conversationId: 'thread-1',
  turnId: 'turn-1',
  itemId: 'item-1',
  title: 'Run command',
  description: 'Tests need to run',
  command: 'npm test',
  cwd: '/tmp/project',
};

describe('CodexApprovalPrompt', () => {
  it('renders app-owned approval details and emits each supported decision', async () => {
    const wrapper = mount(CodexApprovalPrompt, { props: { approval } });
    expect(wrapper.text()).toContain('npm test');
    expect(wrapper.text()).toContain('/tmp/project');

    const buttons = wrapper.findAll('button');
    await buttons[0]!.trigger('click');
    await buttons[1]!.trigger('click');
    await buttons[2]!.trigger('click');
    expect(wrapper.emitted('resolve')).toStrictEqual([
      ['deny', 'once'],
      ['approve', 'session'],
      ['approve', 'once'],
    ]);
  });

  it('disables all decisions while the host is processing', () => {
    const wrapper = mount(CodexApprovalPrompt, { props: { approval, disabled: true } });
    expect(wrapper.findAll('button').every((button) => button.attributes('disabled') !== undefined)).toBe(true);
  });

  it('omits optional details for minimal approval requests', () => {
    const wrapper = mount(CodexApprovalPrompt, {
      props: {
        approval: {
          id: 'approval-2', kind: 'file-change', conversationId: 'thread-1', itemId: 'item-2',
          title: 'Apply file changes',
        },
      },
    });
    expect(wrapper.find('p').exists()).toBe(false);
    expect(wrapper.find('code').exists()).toBe(false);
    expect(wrapper.find('small').exists()).toBe(false);
  });

  it('shows exact requested access and only offers server-supported decisions', async () => {
    const wrapper = mount(CodexApprovalPrompt, {
      props: {
        approval: {
          ...approval,
          requestedPermissions: [
            { kind: 'network', enabled: true, host: 'registry.npmjs.org', protocol: 'https' },
            { kind: 'filesystem', access: 'write', path: '/tmp/results/**' },
          ],
          allowedScopes: ['once'],
          canDeny: false,
        },
      },
    });

    expect(wrapper.get('[aria-label="Requested permissions"]').text()).toContain(
      'Network access to https://registry.npmjs.org: enabled',
    );
    expect(wrapper.text()).toContain('Write access: /tmp/results/**');
    expect(wrapper.text()).not.toContain('Deny');
    expect(wrapper.text()).not.toContain('Allow for session');
    await wrapper.get('button').trigger('click');
    expect(wrapper.emitted('resolve')).toStrictEqual([['approve', 'once']]);
  });

  it('describes disabled and protocol-free network access', () => {
    const wrapper = mount(CodexApprovalPrompt, {
      props: {
        approval: {
          ...approval,
          requestedPermissions: [
            { kind: 'network', enabled: false },
            { kind: 'network', enabled: true, host: 'internal.example' },
          ],
        },
      },
    });
    expect(wrapper.text()).toContain('Network access: disabled');
    expect(wrapper.text()).toContain('Network access to internal.example: enabled');
  });
});
