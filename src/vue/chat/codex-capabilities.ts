import type { CodexCapabilities } from './contracts';

export const codexCapabilities: CodexCapabilities = {
  models: true,
  skills: true,
  reasoningEffort: true,
  planMode: true,
  goals: true,
  steerPrompt: true,
  interrupt: true,
  history: true,
  rollback: true,
  editMessage: true,
  retryMessage: true,
  approvals: true,
  approvalPresets: ['ask-for-approval', 'approve-for-me', 'full-access'],
} as const;
