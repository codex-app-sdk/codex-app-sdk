import {
  inject,
  provide,
  type Component,
  type InjectionKey,
} from 'vue';
import type { MessageToolCall, ToolStatusDescriptor } from './types';

export type CodexToolPresentationContext = {
  descriptor?: ToolStatusDescriptor;
  kind?: string;
  metadata?: Readonly<Record<string, unknown>>;
  toolCall: MessageToolCall;
};

export type CodexToolPresentation = {
  /** Replaces the SDK icon. Use null to render no icon. */
  icon?: Component | null;
  /** Replaces the SDK title while leaving the rest of the tool row intact. */
  title?: string;
};

export type CodexToolPresentationResolver = (
  context: CodexToolPresentationContext,
) => CodexToolPresentation | undefined;

const defaultToolPresentationResolver: CodexToolPresentationResolver = () => undefined;
const toolPresentationKey: InjectionKey<CodexToolPresentationResolver> = Symbol(
  'codex-app-sdk-tool-presentation',
);

/** Configures tool icons and titles for the current Vue component tree. */
export function provideCodexToolPresentation(resolver: CodexToolPresentationResolver): void {
  provide(toolPresentationKey, resolver);
}

/** Reads the nearest tool-presentation resolver, falling back to SDK presentation. */
export function useCodexToolPresentation(): CodexToolPresentationResolver {
  return inject(toolPresentationKey, defaultToolPresentationResolver);
}
