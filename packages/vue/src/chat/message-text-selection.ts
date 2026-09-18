import type { Message } from './types';

export type CodexMessageTextSelectionAnchor = {
  height: number;
  width: number;
  x: number;
  y: number;
};

export type CodexMessageTextSelection = {
  anchor: CodexMessageTextSelectionAnchor;
  messageId?: string;
  messageIndex: number;
  role: Message['role'];
  text: string;
  turnId?: string;
};
