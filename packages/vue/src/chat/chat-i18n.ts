import { inject, provide, type InjectionKey } from 'vue';
import { defaultToolTranslate } from './tool-status';

export type CodexChatTranslate = (key: string, params?: Record<string, unknown>) => string;

const translateKey: InjectionKey<CodexChatTranslate> = Symbol('codex-app-sdk-chat-translate');

const templates: Record<string, string> = {
  'chat.actions.cancel': 'Cancel',
  'chat.actions.copied': 'Copied',
  'chat.actions.copy': 'Copy',
  'chat.actions.delete': 'Delete',
  'chat.actions.edit': 'Edit',
  'chat.actions.editPrompt': 'Edit prompt',
  'chat.actions.fork': 'Fork',
  'chat.actions.label': 'Message actions',
  'chat.actions.quote': 'Quote',
  'chat.actions.resubmit': 'Resubmit',
  'chat.actions.retry': 'Retry',
  'chat.compaction.completed': 'Context compacted',
  'chat.compaction.running': 'Compacting context',
  'chat.contextUsage.ariaLabel': 'Context usage',
  'chat.contextUsage.title': 'Context window:',
  'chat.contextUsage.usedAndLeft': '{used}% used ({left}% left)',
  'chat.contextUsage.tokensUsed': '{used} / {window} tokens used',
  'chat.commands.title': 'Commands',
  'chat.files.empty': 'No matching files',
  'chat.files.hint': 'Start typing to search files in this project.',
  'chat.files.title': 'Files',
  'chat.message.emptyResponse': 'Empty response',
  'chat.skills.empty': 'No matching skills',
  'chat.skills.title': 'Skills',
};

export function provideCodexChatTranslate(translate: CodexChatTranslate): void {
  provide(translateKey, translate);
}

/** Reads the nearest chat translation function for the current Vue tree. */
export function useCodexChatTranslate(): CodexChatTranslate {
  return inject(translateKey, defaultCodexChatTranslate);
}

export function defaultCodexChatTranslate(
  key: string,
  params: Record<string, unknown> = {},
): string {
  const template = templates[key];
  if (!template) {
    return defaultToolTranslate(key, params);
  }

  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? ''));
}
