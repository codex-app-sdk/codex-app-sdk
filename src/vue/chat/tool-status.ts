import type { CodexConversationFileAction, CodexConversationLink } from './contracts';
import { codexConversationLinkFromHref } from './conversation-links';
import { getMessageToolCallName, type MessageToolCall, type ToolStatusDescriptor } from './types';

type Translate = (key: string, params?: Record<string, unknown>) => string;

export type ToolLineDiff = {
  addedLines: number;
  removedLines: number;
};

export type CodexToolTitlePresenterContext = {
  descriptor: ToolStatusDescriptor | undefined;
  toolCall: MessageToolCall;
  translate: Translate;
};

export type CodexToolTitlePresenter = (
  context: CodexToolTitlePresenterContext,
) => string | undefined;

export type CodexToolDisplayTargetPart = {
  label: string;
  link?: CodexConversationLink;
  separator?: string;
};

const toolTitlePresenters = new Set<CodexToolTitlePresenter>();

export function registerCodexToolTitlePresenter(presenter: CodexToolTitlePresenter): () => void {
  toolTitlePresenters.add(presenter);
  return () => toolTitlePresenters.delete(presenter);
}

export function parseToolStatusDescriptor(value: unknown): ToolStatusDescriptor | undefined {
  if (typeof value !== 'string' || !value.trim().startsWith('{')) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(value) as Partial<ToolStatusDescriptor>;
    if (
      typeof parsed.source !== 'string' ||
      typeof parsed.action !== 'string' ||
      typeof parsed.phase !== 'string'
    ) {
      return undefined;
    }
    return {
      action: parsed.action,
      phase: parsed.phase,
      params: parsed.params && typeof parsed.params === 'object' && !Array.isArray(parsed.params) ? parsed.params : undefined,
      source: parsed.source,
    };
  } catch {
    return undefined;
  }
}

export function getToolLineDiff(descriptor: ToolStatusDescriptor | undefined): ToolLineDiff | undefined {
  const params = descriptor?.params;
  const addedLines = typeof params?.addedLines === 'number' ? params.addedLines : 0;
  const removedLines = typeof params?.removedLines === 'number' ? params.removedLines : 0;
  return addedLines || removedLines ? { addedLines, removedLines } : undefined;
}

export function getToolGroupLineDiff(toolCalls: readonly MessageToolCall[]): ToolLineDiff | undefined {
  let addedLines = 0;
  let removedLines = 0;
  for (const toolCall of toolCalls) {
    const lineDiff = getToolLineDiff(parseToolStatusDescriptor(toolCall.status));
    addedLines += lineDiff?.addedLines ?? 0;
    removedLines += lineDiff?.removedLines ?? 0;
  }
  return addedLines || removedLines ? { addedLines, removedLines } : undefined;
}

export function getToolDisplayTitle(
  toolCall: MessageToolCall,
  descriptor: ToolStatusDescriptor | undefined,
  t: Translate = defaultToolTranslate,
) {
  for (const presenter of toolTitlePresenters) {
    const title = presenter({ descriptor, toolCall, translate: t });
    if (title) return title;
  }

  if (descriptor?.source === 'codex' && isCodexToolAction(descriptor.action)) {
    const phase = commandPhase(descriptor.phase);
    if (descriptor.action === 'plan') {
      const operation = descriptor.params?.operation === 'update' ? 'update' : 'write';
      return t(`chat.tool.command.plan.${operation}.${phase}`);
    }

    const target = displayFileTarget(toolCall, descriptor, commandTarget(descriptor, getMessageToolCallName(toolCall)));
    return t(`chat.tool.command.${descriptor.action}.${phase}`, target ? { target } : undefined);
  }

  if (descriptor) {
    return `${descriptor.phase} ${getMessageToolCallName(toolCall)}`;
  }

  return getToolFallbackTitle(toolCall, t);
}

export function getToolDisplayTitleParts(
  toolCall: MessageToolCall,
  descriptor: ToolStatusDescriptor | undefined,
  t: Translate = defaultToolTranslate,
): { prefix?: string; target?: string; title: string } {
  const title = getToolDisplayTitle(toolCall, descriptor, t);
  if (
    descriptor?.source !== 'codex'
    || !['create', 'delete', 'edit', 'read'].includes(descriptor.action)
  ) {
    return { title };
  }

  const target = displayFileTarget(toolCall, descriptor, commandTarget(descriptor, getMessageToolCallName(toolCall)));
  const prefix = title.endsWith(target) ? title.slice(0, -target.length).trimEnd() : undefined;
  return prefix ? { prefix, target, title } : { title };
}

export function getToolDisplayTargetLink(
  toolCall: MessageToolCall,
  descriptor: ToolStatusDescriptor | undefined,
  target?: string,
): CodexConversationLink | undefined {
  return getToolDisplayTargetParts(toolCall, descriptor, target)?.find((part) => part.link)?.link;
}

export function getToolDisplayTargetParts(
  toolCall: MessageToolCall,
  descriptor: ToolStatusDescriptor | undefined,
  target?: string,
): CodexToolDisplayTargetPart[] | undefined {
  if (
    descriptor?.source !== 'codex'
    || !['create', 'edit', 'read'].includes(descriptor.action)
  ) {
    return undefined;
  }

  const displayTarget = displayFileTarget(
    toolCall,
    descriptor,
    target?.trim() || commandTarget(descriptor, getMessageToolCallName(toolCall)),
  );
  const targetTokens = splitFileTargetDisplay(displayTarget);
  const filePaths = toolFilePaths(toolCall);
  if (!targetTokens.length || !filePaths.length) return undefined;

  const action = descriptor.action as CodexConversationFileAction;
  const parts = targetTokens.map((token, index) => {
    const filePath = filePaths.find((candidate) => (
      candidate === token || fileName(candidate) === fileName(token)
    ));
    const link = filePath ? codexConversationLinkFromHref(filePath) : undefined;
    return {
      label: token,
      ...(link?.kind === 'file' ? {
        link: {
          ...link,
          filepath: link.path,
          action,
        },
      } : {}),
      separator: index === 0 ? '' : ', ',
    } satisfies CodexToolDisplayTargetPart;
  });

  const truncatedCount = fileTargetTruncationCount(displayTarget);
  if (truncatedCount > 0) {
    parts.push({ label: `and ${truncatedCount} more`, separator: ' ' });
  }
  return parts;
}

export function getToolFallbackTitle(toolCall: MessageToolCall, t: Translate = defaultToolTranslate) {
  const isRunning = !toolCall.done && toolCall.state !== 'completed';
  return t(`chat.tool.fallback.${isRunning ? 'running' : 'completed'}`, {
    name: getMessageToolCallName(toolCall),
  });
}

function commandTarget(descriptor: ToolStatusDescriptor, fallback: string) {
  const target = descriptor.params?.target;
  if (typeof target === 'string' && target.trim()) return target;

  for (const key of ['names', 'targets', 'actions']) {
    const values = descriptor.params?.[key];
    if (Array.isArray(values)) {
      const summary = values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0).join(', ');
      if (summary) return summary;
    }
  }

  return fallback;
}

function displayFileTarget(
  toolCall: MessageToolCall,
  descriptor: ToolStatusDescriptor,
  target: string,
): string {
  if (!['create', 'edit', 'read'].includes(descriptor.action)) return target;
  const values = fileTargetValues(toolCall);
  if (values.length === 0) return target;
  if (values.length <= 3) return values.join(', ');
  return `${values.slice(0, 3).join(', ')} and ${values.length - 3} more`;
}

function fileTargetValues(toolCall: MessageToolCall): string[] {
  const args = isRecord(toolCall.args) ? toolCall.args : {};
  const values = [
    ...rawFileTargetValues(args.commandActions),
    ...rawFileTargetValues(args.changes),
    ...rawFileTargetValues(toolCall.metadata?.changes),
    ...(typeof args.path === 'string' ? [args.path] : []),
    ...(typeof args.name === 'string' ? [args.name] : []),
  ];
  return [...new Set(values.map(fileName).filter(Boolean))];
}

function rawFileTargetValues(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).flatMap((entry) => (
    typeof entry.path === 'string' ? [entry.path] : typeof entry.name === 'string' ? [entry.name] : []
  ));
}

function toolFilePaths(toolCall: MessageToolCall): string[] {
  const args = isRecord(toolCall.args) ? toolCall.args : {};
  const cwd = absolutePath(typeof args.cwd === 'string' ? args.cwd : toolCall.metadata?.cwd);
  const candidates = [
    ...filePathsFromArray(args.commandActions),
    ...filePathsFromArray(args.changes),
    ...filePathsFromArray(toolCall.metadata?.changes),
    ...(typeof args.path === 'string' ? [args.path] : []),
    ...(typeof args.name === 'string' ? [args.name] : []),
  ];
  return [...new Set(candidates.map((candidate) => (
    absolutePath(candidate) ?? (cwd ? joinPath(cwd, candidate) : undefined)
  )).filter((candidate): candidate is string => Boolean(candidate)))];
}

function filePathsFromArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).flatMap((entry) => (
    typeof entry.path === 'string' ? [entry.path] : typeof entry.name === 'string' ? [entry.name] : []
  ));
}

function splitFileTargetDisplay(target: string): string[] {
  const withoutTruncation = target.replace(/\s+and\s+\d+\s+more$/u, '').trim();
  if (!withoutTruncation) return [];
  return withoutTruncation.split(/,\s*/u).map((value) => fileName(value.trim())).filter(Boolean);
}

function fileTargetTruncationCount(target: string): number {
  const match = target.match(/\s+and\s+(\d+)\s+more$/u);
  return match ? Number(match[1]) : 0;
}

function absolutePath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const path = value.trim();
  return /^(?:[a-z]:[\\/]|\/)/iu.test(path) ? path : undefined;
}

function joinPath(cwd: string, path: string): string {
  return `${cwd.replace(/[\\/]$/u, '')}/${path.replace(/^[\\/]+/u, '')}`;
}

function fileName(value: string): string {
  return value.split(/[\\/]/u).filter(Boolean).at(-1) ?? value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function commandPhase(phase: string) {
  if (phase === 'completed' || phase === 'failed' || phase === 'running') {
    return phase;
  }

  return 'running';
}

function isCodexToolAction(action: string): action is 'create' | 'delete' | 'edit' | 'explore' | 'list' | 'plan' | 'read' | 'run' | 'search' {
  return action === 'create' || action === 'delete' || action === 'edit' || action === 'explore' || action === 'list' || action === 'plan' || action === 'read' || action === 'run' || action === 'search';
}

export function defaultToolTranslate(key: string, params?: Record<string, unknown>) {
  const values = params ?? {};
  const templates: Record<string, string> = {
    'chat.tool.command.edit.completed': 'Edited {target}',
    'chat.tool.command.edit.failed': 'Failed editing {target}',
    'chat.tool.command.edit.running': 'Editing {target}',
    'chat.tool.command.create.completed': 'Created {target}',
    'chat.tool.command.create.failed': 'Failed creating {target}',
    'chat.tool.command.create.running': 'Creating {target}',
    'chat.tool.command.delete.completed': 'Deleted {target}',
    'chat.tool.command.delete.failed': 'Failed deleting {target}',
    'chat.tool.command.delete.running': 'Deleting {target}',
    'chat.tool.command.explore.completed': 'Explored {target}',
    'chat.tool.command.explore.failed': 'Failed exploring {target}',
    'chat.tool.command.explore.running': 'Exploring {target}',
    'chat.tool.command.list.completed': 'Listed {target}',
    'chat.tool.command.list.failed': 'Failed listing {target}',
    'chat.tool.command.list.running': 'Listing {target}',
    'chat.tool.command.plan.update.completed': 'Updated plan',
    'chat.tool.command.plan.update.failed': 'Failed updating plan',
    'chat.tool.command.plan.update.running': 'Updating plan',
    'chat.tool.command.plan.write.completed': 'Wrote plan',
    'chat.tool.command.plan.write.failed': 'Failed writing plan',
    'chat.tool.command.plan.write.running': 'Writing plan',
    'chat.tool.command.read.completed': 'Read {target}',
    'chat.tool.command.read.failed': 'Failed reading {target}',
    'chat.tool.command.read.running': 'Reading {target}',
    'chat.tool.command.run.completed': 'Ran {target}',
    'chat.tool.command.run.failed': 'Failed running {target}',
    'chat.tool.command.run.running': 'Running {target}',
    'chat.tool.command.search.completed': 'Searched {target}',
    'chat.tool.command.search.failed': 'Failed searching {target}',
    'chat.tool.command.search.running': 'Searching {target}',
    'chat.tool.fallback.completed': 'Ran {name}',
    'chat.tool.fallback.running': 'Running {name}',
  };

  return (templates[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ''));
}
