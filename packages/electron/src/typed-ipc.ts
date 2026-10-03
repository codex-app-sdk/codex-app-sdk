import type { TypedEventBus } from '@codex-app-sdk/core/events';

export type IpcRequest<Arguments extends unknown[] = unknown[], Result = unknown> = {
  args: Arguments;
  result: Result;
};

export type IpcRequestArguments<Request> = Request extends IpcRequest<infer Arguments, unknown>
  ? Arguments
  : never;

export type IpcRequestResult<Request> = Request extends IpcRequest<unknown[], infer Result>
  ? Result
  : never;

export type IpcRendererPort = {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  on(channel: string, listener: (event: unknown, payload: unknown) => void): void;
  off(channel: string, listener: (event: unknown, payload: unknown) => void): void;
};

export type IpcMainPort = {
  handle(channel: string, handler: (event: unknown, ...args: unknown[]) => unknown): void;
  removeHandler(channel: string): void;
};

export type IpcEventSender = {
  send(channel: string, payload: unknown): void;
};

type RequestName<Requests> = keyof Requests & string;
type EventName<Events> = keyof Events & string;

export class TypedIpcRenderer<Requests extends object, Events extends object> {
  constructor(private readonly port: IpcRendererPort) {}

  invoke<Name extends RequestName<Requests>>(
    channel: Name,
    ...args: IpcRequestArguments<Requests[Name]>
  ): Promise<IpcRequestResult<Requests[Name]>> {
    return this.port.invoke(channel, ...args) as Promise<IpcRequestResult<Requests[Name]>>;
  }

  on<Name extends EventName<Events>>(channel: Name, listener: (payload: Events[Name]) => void): () => void {
    const handler = (_event: unknown, payload: unknown) => listener(payload as Events[Name]);
    this.port.on(channel, handler);
    return () => this.port.off(channel, handler);
  }
}

export type IpcMainHandlers<Requests extends object> = {
  [Name in keyof Requests]: (
    event: unknown,
    ...args: IpcRequestArguments<Requests[Name]>
  ) => IpcRequestResult<Requests[Name]> | Promise<IpcRequestResult<Requests[Name]>>;
};

export class TypedIpcMain<Requests extends object> {
  private readonly registeredChannels = new Set<RequestName<Requests>>();

  constructor(private readonly port: IpcMainPort) {}

  handle<Name extends RequestName<Requests>>(
    channel: Name,
    handler: IpcMainHandlers<Pick<Requests, Name>>[Name],
  ): void {
    this.port.handle(channel, (event, ...args) => handler(
      event,
      ...args as IpcRequestArguments<Requests[Name]>,
    ));
    this.registeredChannels.add(channel);
  }

  removeHandler<Name extends RequestName<Requests>>(channel: Name): void {
    this.port.removeHandler(channel);
    this.registeredChannels.delete(channel);
  }

  dispose(): void {
    for (const channel of this.registeredChannels) {
      this.port.removeHandler(channel);
    }
    this.registeredChannels.clear();
  }
}

export type IpcSenderPolicy = {
  /** Rejects an invocation before its handler runs when this returns false. */
  isTrustedSender?: (event: unknown) => boolean;
};

export function registerIpcMainHandlers<Requests extends object>(
  port: IpcMainPort,
  handlers: IpcMainHandlers<Requests>,
  policy: IpcSenderPolicy = {},
): () => void {
  const main = new TypedIpcMain<Requests>(port);
  const channels = Object.keys(handlers) as Array<RequestName<Requests>>;
  const { isTrustedSender } = policy;
  for (const channel of channels) {
    const handler = handlers[channel];
    main.handle(channel, isTrustedSender
      ? (event, ...args) => {
        if (!isTrustedSender(event)) throw new Error(`Rejected ${channel} from an untrusted sender`);
        return handler(event, ...args);
      }
      : handler);
  }
  return () => main.dispose();
}

export function sendIpcEvent<Events extends object, Name extends EventName<Events>>(
  sender: IpcEventSender,
  channel: Name,
  payload: Events[Name],
): void {
  sender.send(channel, payload);
}

export function connectIpcEventsToBus<Events extends object>(
  renderer: Pick<TypedIpcRenderer<object, Events>, 'on'>,
  bus: TypedEventBus<Events>,
  channels: ReadonlyArray<EventName<Events>>,
): () => void {
  const unsubscribers = channels.map((channel) => renderer.on(channel, (payload) => bus.emit(channel, payload)));
  return () => {
    for (const unsubscribe of unsubscribers) {
      unsubscribe();
    }
  };
}
