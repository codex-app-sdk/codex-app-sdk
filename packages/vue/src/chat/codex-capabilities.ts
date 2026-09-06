import type { CodexCapabilities } from './contracts';

export const codexCapabilities: CodexCapabilities = {
  models: true,
  skills: true,
  reasoningEffort: true,
  serviceTier: true,
  planMode: true,
  goals: true,
  steerPrompt: true,
  interrupt: true,
  history: true,
  deleteTurn: true,
  editTurn: true,
  retryTurn: true,
  approvals: true,
  approvalPresets: ['ask-for-approval', 'approve-for-me', 'full-access'],
} as const;
