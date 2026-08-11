import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CodexNativeRendererApi } from '@codex-app-sdk/electron';
import App from '../src/renderer/App.vue';
import { fakeRelayOperationsApi, relayOperationsSnapshot, fakeSurfaceApi, surfaceSnapshot } from './fakes';

describe('Relay App', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'codexAppSdkNative');
    Reflect.deleteProperty(window, 'codexSurface');
    Reflect.deleteProperty(window, 'relayOperations');
  });

  it('composes the KPI header and operations rail beside one uncustomized conversation pane', async () => {
    const api = fakeSurfaceApi();
    window.codexSurface = api;
    window.codexAppSdkNative = fakeNativeApi();
    window.relayOperations = fakeRelayOperationsApi();

    const wrapper = mount(App);
    await flushPromises();

    expect(api.connect).toHaveBeenCalledOnce();
    expect(wrapper.text()).toContain('Relay');
    expect(wrapper.text()).toContain('SHP-4827');
    const shellChildren = Array.from(wrapper.get('.relay-shell').element.children);
    expect(shellChildren).toStrictEqual([
      wrapper.get('.operations-board__header').element,
      wrapper.get('.operations-board__workspace').element,
      wrapper.get('.relay-conversation').element,
    ]);
    const pane = wrapper.getComponent({ name: 'CodexConversationPane' });
    expect(pane.classes()).toContain('relay-chat');
    expect(pane.props('presentation')).toBeUndefined();
    expect(pane.props('capabilities')).toBeUndefined();
    expect(wrapper.find('.conversation-sidebar').exists()).toBe(false);
  });

  it('turns an exact business-view click into a visible context-rich conversation prompt', async () => {
    const api = fakeSurfaceApi();
    window.codexSurface = api;
    window.codexAppSdkNative = fakeNativeApi();
    window.relayOperations = fakeRelayOperationsApi();
    const wrapper = mount(App);
    await flushPromises();

    const compareButton = wrapper.findAll('.shipment-actions button')
      .find((button) => button.text() === 'Compare recovery')!;
    await compareButton.trigger('click');
    await flushPromises();

    expect(api.createConversation).not.toHaveBeenCalled();
    expect(api.sendMessage).toHaveBeenCalledOnce();
    const prompt = api.sendMessage.mock.calls[0]![0];
    expect(prompt).toContain('I clicked “Compare recovery” for SHP-4827');
    expect(prompt).toContain('Cargo value: $84,000');
    expect(prompt).toContain('Use the Relay MCP tools');
    expect(prompt).toContain('explicitly approve it');
  });

  it('creates exactly one conversation when the isolated Relay home is empty', async () => {
    const empty = surfaceSnapshot({ conversations: [], activeConversationId: null });
    const api = fakeSurfaceApi(empty);
    window.codexSurface = api;
    window.codexAppSdkNative = fakeNativeApi();
    window.relayOperations = fakeRelayOperationsApi();

    mount(App);
    await flushPromises();

    expect(api.createConversation).toHaveBeenCalledOnce();
  });

  it('refreshes the business view after the stock SDK reports a completed MCP tool', async () => {
    const api = fakeSurfaceApi();
    const before = relayOperationsSnapshot();
    const after = {
      ...before,
      revision: 2,
      shipments: before.shipments.map((shipment) => (
        shipment.id === 'SHP-4827'
          ? { ...shipment, status: 'on-track' as const, etaDeltaMinutes: 0 }
          : shipment
      )),
    };
    const getSnapshot = vi.fn()
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(after);
    window.codexSurface = api;
    window.codexAppSdkNative = fakeNativeApi();
    window.relayOperations = { ...fakeRelayOperationsApi(), getSnapshot };
    const wrapper = mount(App);
    await flushPromises();

    api.pushEvent({
      seq: 1,
      occurredAt: '2026-07-18T10:16:00.000Z',
      origin: 'notification',
      type: 'tool.completed',
      conversationId: 'thread-relay',
      turnId: 'turn-1',
      payload: {
        messageId: 'message-1',
        toolPart: {
          type: 'tool',
          id: 'tool-1',
          kind: 'mcp',
          title: 'relay/rebook_shipment',
          status: 'completed',
        },
      },
    });
    await flushPromises();

    expect(getSnapshot).toHaveBeenCalledTimes(2);
    expect(wrapper.get('.shipment-badge--delay').text()).toBe('On time');
  });

  it('uses the SDK managed login flow before exposing operations', async () => {
    const signedOut = surfaceSnapshot({
      authentication: {
        status: 'loaded',
        account: null,
        requiresOpenaiAuth: true,
        error: null,
        login: { status: 'idle', loginId: null, authUrl: null, error: null },
      },
      conversations: [],
      activeConversationId: null,
    });
    const api = fakeSurfaceApi(signedOut);
    const native = fakeNativeApi();
    window.codexSurface = api;
    window.codexAppSdkNative = native;
    window.relayOperations = fakeRelayOperationsApi();
    const wrapper = mount(App);
    await flushPromises();

    expect(wrapper.text()).toContain('Run the shift with Relay');
    expect(wrapper.findComponent({ name: 'CodexConversationPane' }).exists()).toBe(false);
    await wrapper.get('.relay-sign-in__card > button').trigger('click');
    await flushPromises();

    expect(api.startChatGptLogin).toHaveBeenCalledOnce();
    expect(native.openExternal).toHaveBeenCalledWith('https://auth.example.test/relay');
  });

  it('replaces updated shipment state with the seeded demo snapshot', async () => {
    const api = fakeSurfaceApi();
    const updated = relayOperationsSnapshot();
    updated.revision = 2;
    updated.shipments[0] = {
      ...updated.shipments[0]!,
      status: 'on-track',
      etaDeltaMinutes: 0,
      selectedRecoveryOptionId: 'expedited-air',
    };
    const relayOperations = fakeRelayOperationsApi();
    relayOperations.getSnapshot.mockResolvedValueOnce(updated);
    window.codexSurface = api;
    window.codexAppSdkNative = fakeNativeApi();
    window.relayOperations = relayOperations;
    const wrapper = mount(App);
    await flushPromises();

    expect(wrapper.get('.shipment-badge--delay').text()).toBe('On time');
    await wrapper.get('.relay-reset').trigger('click');
    await flushPromises();

    expect(relayOperations.resetDemo).toHaveBeenCalledOnce();
    expect(wrapper.get('.shipment-badge--delay').text()).toBe('ETA +6h');
    expect(wrapper.get('.exception-queue__heading').text()).toContain('revision 1');
  });
});

function fakeNativeApi(): CodexNativeRendererApi {
  return {
    capabilities: { attachments: true, clipboard: true, externalLinks: true, transcription: false },
    copyToClipboard: vi.fn(async () => undefined),
    ingestAttachments: vi.fn(async () => []),
    openExternal: vi.fn(async () => undefined),
    pickAttachments: vi.fn(async () => []),
    transcribeAudio: vi.fn(async () => ({ text: '' })),
  };
}
