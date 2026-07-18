import type { CodexCapabilities } from 'codex-app-sdk/vue';

export const kidsCapabilities: CodexCapabilities = {
  models: false,
  skills: false,
  reasoningEffort: false,
  planMode: false,
  goals: false,
  steerPrompt: false,
  interrupt: true,
  history: true,
  rollback: false,
  editMessage: false,
  retryMessage: false,
  approvals: false,
  approvalPresets: [],
};
