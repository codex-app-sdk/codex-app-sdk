export type CodexComposerState = {
  text: string;
  selectionStart: number;
  selectionEnd: number;
};

export function normalizeCodexComposerState(state: CodexComposerState): CodexComposerState {
  const length = state.text.length;
  const selectionStart = Math.max(0, Math.min(state.selectionStart, length));
  const selectionEnd = Math.max(selectionStart, Math.min(state.selectionEnd, length));
  return { text: state.text, selectionStart, selectionEnd };
}
