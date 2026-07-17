import { describe, expect, it, vi } from 'vitest';
import { TypedEventBus } from '../src/events';
import {
  connectIpcEventsToBus,
  registerIpcMainHandlers,
  sendIpcEvent,
  TypedIpcRenderer,
  type IpcMainPort,
  type IpcRendererPort,
  type IpcRequest,
} from '../src/electron';

type Requests = {
  'conversation:load': IpcRequest<[conversationId: string], { title: string }>;
  'prompt:send': IpcRequest<[agentId: string, prompt: string], void>;
};

type Events = {
  'message:delta': { messageId: string; delta: string };
  'turn:completed': { turnId: string };
};

class FakeRendererPort implements IpcRendererPort {
  readonly invoke = vi.fn(async () => ({ title: 'Conversation' }));
  readonly listeners = new Map<string, Set<(event: unknown, payload: unknown) => void>>();

  on(channel: string, listener: (event: unknown, payload: unknown) => void): void {
    const listeners = this.listeners.get(channel) ?? new Set();
    listeners.add(listener);
    this.listeners.set(channel, listeners);
  }

  off(channel: string, listener: (event: unknown, payload: unknown) => void): void {
    this.listeners.get(channel)?.delete(listener);
  }

  emit(channel: string, payload: unknown): void {
    for (const listener of this.listeners.get(channel) ?? []) {
      listener({}, payload);
    }
  }
}

class FakeMainPort implements IpcMainPort {
  readonly handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

  handle(channel: string, handler: (event: unknown, ...args: unknown[]) => unknown): void {
    this.handlers.set(channel, handler);
  }

  removeHandler(channel: string): void {
    this.handlers.delete(channel);
  }
}

describe('typed Electron IPC', () => {
  it('invokes requests and unsubscribes renderer events', async () => {
    const port = new FakeRendererPort();
    const renderer = new TypedIpcRenderer<Requests, Events>(port);
    const listener = vi.fn();
    const unsubscribe = renderer.on('message:delta', listener);

    await expect(renderer.invoke('conversation:load', 'conversation-1')).resolves.toStrictEqual({ title: 'Conversation' });
    port.emit('message:delta', { messageId: 'message-1', delta: 'Hi' });
    unsubscribe();
    port.emit('message:delta', { messageId: 'message-1', delta: ' ignored' });

    expect(port.invoke).toHaveBeenCalledWith('conversation:load', 'conversation-1');
    expect(listener).toHaveBeenCalledOnce();
  });

  it('registers typed main handlers and removes them as a group', async () => {
    const port = new FakeMainPort();
    const sendPrompt = vi.fn();
    const unregister = registerIpcMainHandlers<Requests>(port, {
      'conversation:load': async (_event, conversationId) => ({ title: `Conversation ${conversationId}` }),
      'prompt:send': (_event, agentId, prompt) => {
        sendPrompt(agentId, prompt);
      },
    });

    await expect(port.handlers.get('conversation:load')?.({}, '42')).resolves.toStrictEqual({ title: 'Conversation 42' });
    port.handlers.get('prompt:send')?.({}, 'agent-1', 'Hello');
    expect(sendPrompt).toHaveBeenCalledWith('agent-1', 'Hello');
    unregister();
    expect(port.handlers.size).toBe(0);
  });

  it('sends typed events and relays renderer events into a bus', () => {
    const sender = { send: vi.fn() };
    sendIpcEvent<Events, 'turn:completed'>(sender, 'turn:completed', { turnId: 'turn-1' });
    expect(sender.send).toHaveBeenCalledWith('turn:completed', { turnId: 'turn-1' });

    const port = new FakeRendererPort();
    const renderer = new TypedIpcRenderer<Requests, Events>(port);
    const bus = new TypedEventBus<Events>();
    const listener = vi.fn();
    bus.on('message:delta', listener);
    const disconnect = connectIpcEventsToBus(renderer, bus, ['message:delta', 'turn:completed']);

    port.emit('message:delta', { messageId: 'message-1', delta: 'Hello' });
    disconnect();
    port.emit('message:delta', { messageId: 'message-1', delta: ' ignored' });

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({ messageId: 'message-1', delta: 'Hello' });
  });
});

