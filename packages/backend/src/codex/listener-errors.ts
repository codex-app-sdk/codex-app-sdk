export type ListenerErrorHandler = (error: unknown) => void;

/**
 * Reports an exception thrown by a subscriber without letting it disturb the
 * code that notified it. The host's handler receives it; without one it
 * surfaces as a process warning, so it is neither swallowed nor fatal.
 */
export function reportListenerError(error: unknown, handler?: ListenerErrorHandler): void {
  if (handler) {
    try {
      handler(error);
    } catch {
      // A failing error handler must not escape into the notifier either.
    }
    return;
  }
  process.emitWarning(error instanceof Error ? error : new Error(String(error)));
}

/** Calls every listener, isolating each from the others' failures. */
export function notifyListeners<Value>(
  listeners: Iterable<(value: Value) => void>,
  value: Value,
  onError?: ListenerErrorHandler,
): void {
  for (const listener of listeners) {
    try {
      listener(value);
    } catch (error) {
      reportListenerError(error, onError);
    }
  }
}
