// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineComponent, h } from 'vue';
import type { CodexNativeAttachment, CodexNativeRendererApi } from '../../src/native/types';
import {
  getCodexNativeRendererApi,
  ingestCodexAttachments,
  pickCodexAttachments,
  provideCodexHostCapabilities,
  useCodexHostCapabilities,
} from '../../packages/vue/src/native-capabilities';

describe('native renderer capabilities', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'codexAppSdkNative');
  });

  it('discovers the native renderer bridge when present', () => {
    expect(getCodexNativeRendererApi()).toBeUndefined();
    const bridge = { pickAttachments: vi.fn() } as unknown as CodexNativeRendererApi;
    Object.defineProperty(window, 'codexAppSdkNative', { configurable: true, value: bridge });
    expect(getCodexNativeRendererApi()).toBe(bridge);
  });

  it('scopes host capabilities to the current Vue tree', () => {
    const globalBridge = { capabilities: { attachments: false } } as unknown as CodexNativeRendererApi;
    const scopedBridge = { capabilities: { attachments: true } } as unknown as CodexNativeRendererApi;
    Object.defineProperty(window, 'codexAppSdkNative', { configurable: true, value: globalBridge });
    let resolved: CodexNativeRendererApi | undefined;
    const Child = defineComponent({
      setup() {
        resolved = useCodexHostCapabilities();
        return () => h('span');
      },
    });
    const Parent = defineComponent({
      setup() {
        provideCodexHostCapabilities(scopedBridge);
        return () => h(Child);
      },
    });

    mount(Parent);

    expect(resolved).toBe(scopedBridge);
  });

  it('picks attachments through an override, native bridge, or empty fallback', async () => {
    const picked = [nativeAttachment('one.txt')];
    const override = vi.fn(async () => picked);
    await expect(pickCodexAttachments(override)).resolves.toBe(picked);

    const nativePick = vi.fn(async () => picked);
    Object.defineProperty(window, 'codexAppSdkNative', {
      configurable: true,
      value: { pickAttachments: nativePick } as unknown as CodexNativeRendererApi,
    });
    await expect(pickCodexAttachments()).resolves.toBe(picked);
    Reflect.deleteProperty(window, 'codexAppSdkNative');
    await expect(pickCodexAttachments()).resolves.toStrictEqual([]);
  });

  it('short-circuits empty ingestion and missing native support', async () => {
    const override = vi.fn();
    await expect(ingestCodexAttachments([], override)).resolves.toStrictEqual([]);
    expect(override).not.toHaveBeenCalled();
    await expect(ingestCodexAttachments([file('one.txt', '', new Uint8Array([1]))])).resolves.toStrictEqual([]);
  });

  it('serializes browser files for override ingestion', async () => {
    const ingested = [nativeAttachment('one.txt')];
    const override = vi.fn(async () => ingested);
    const bytes = new Uint8Array([1, 2, 3]);
    await expect(ingestCodexAttachments([
      file('one.txt', 'text/plain', bytes),
      file('unknown.bin', '', new Uint8Array([4])),
    ], override)).resolves.toBe(ingested);
    expect(override).toHaveBeenCalledWith([
      { name: 'one.txt', mimeType: 'text/plain', data: bytes.buffer },
      { name: 'unknown.bin', data: new Uint8Array([4]).buffer },
    ]);
  });

  it('uses the native ingestion bridge by default', async () => {
    const ingestAttachments = vi.fn(async () => []);
    Object.defineProperty(window, 'codexAppSdkNative', {
      configurable: true,
      value: { ingestAttachments } as unknown as CodexNativeRendererApi,
    });
    await ingestCodexAttachments([file('one.txt', 'text/plain', new Uint8Array([1]))]);
    expect(ingestAttachments).toHaveBeenCalledOnce();
  });
});

function file(name: string, type: string, data: Uint8Array): File {
  const buffer = Uint8Array.from(data).buffer;
  const value = new File([buffer], name, { type });
  Object.defineProperty(value, 'arrayBuffer', {
    configurable: true,
    value: async () => buffer,
  });
  return value;
}

function nativeAttachment(name: string): CodexNativeAttachment {
  return {
    id: `attachment-${name}`,
    type: 'file',
    reference: `attachment:${name}`,
    name,
    mimeType: 'text/plain',
    size: 3,
  };
}
