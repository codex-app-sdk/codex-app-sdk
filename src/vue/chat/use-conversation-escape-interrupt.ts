import {
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
  type Ref,
} from 'vue';

type ConversationEscapeInterruptOptions = {
  root: Readonly<Ref<HTMLElement | null>>;
  busy(): boolean;
  enabled(): boolean;
  onInterrupt(): void;
};

export function useConversationEscapeInterrupt(options: ConversationEscapeInterruptOptions): {
  armed: Ref<boolean>;
  clear(): void;
} {
  const armed = ref(false);
  let clearTimer: ReturnType<typeof setTimeout> | null = null;
  let listenerInstalled = false;

  watch([options.busy, options.enabled], ([busy, enabled]) => {
    if (!busy || !enabled) clear();
    syncListener();
  });

  onMounted(syncListener);
  onBeforeUnmount(() => {
    clear();
    removeListener();
  });

  function syncListener(): void {
    const shouldListen = options.busy() && options.enabled();
    if (shouldListen && !listenerInstalled) {
      document.addEventListener('keydown', handleKeydown);
      listenerInstalled = true;
    } else if (!shouldListen) {
      removeListener();
    }
  }

  function removeListener(): void {
    if (!listenerInstalled) return;
    document.removeEventListener('keydown', handleKeydown);
    listenerInstalled = false;
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (
      event.key !== 'Escape'
      || event.defaultPrevented
      || event.repeat
      || event.isComposing
      || event.altKey
      || event.ctrlKey
      || event.metaKey
      || event.shiftKey
      || !options.busy()
      || isInsideModalDialog(event)
    ) return;

    const root = options.root.value;
    const focusedInside = Boolean(root && document.activeElement && root.contains(document.activeElement));
    const generatingPanes = document.querySelectorAll('[data-codex-generating="true"]');
    if (!focusedInside && generatingPanes.length !== 1) return;

    event.preventDefault();
    if (!armed.value) {
      armed.value = true;
      if (clearTimer) clearTimeout(clearTimer);
      clearTimer = setTimeout(clear, 2_000);
      return;
    }

    clear();
    options.onInterrupt();
  }

  function isInsideModalDialog(event: KeyboardEvent): boolean {
    const target = event.target instanceof Element ? event.target : document.activeElement;
    return Boolean(target instanceof Element && target.closest('[role="dialog"][aria-modal="true"]'));
  }

  function clear(): void {
    armed.value = false;
    if (clearTimer) clearTimeout(clearTimer);
    clearTimer = null;
  }

  return { armed, clear };
}
