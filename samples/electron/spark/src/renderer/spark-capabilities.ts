import type { CodexCapabilities } from '@codex-app-sdk/vue';

export const sparkCapabilities: CodexCapabilities = {
  models: false,
  skills: false,
  reasoningEffort: false,
  planMode: false,
  goals: false,
  steerPrompt: false,
  interrupt: true,
  history: true,
  deleteTurn: false,
  editTurn: false,
  retryTurn: false,
  approvals: false,
  approvalPresets: [],
};
