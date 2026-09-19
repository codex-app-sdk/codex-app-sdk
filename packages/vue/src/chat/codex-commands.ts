import type { CodexCommandSummary } from './contracts';

export const codexCommands: readonly CodexCommandSummary[] = [
  {
    id: 'codex.compact',
    name: 'compact',
    displayName: 'Compact',
    description: 'Compact the current Codex context.',
    slashName: 'compact',
    submitOnSelect: true,
  },
  {
    id: 'codex.review',
    name: 'review',
    displayName: 'Review',
    description: 'Review current Codex changes and find issues.',
    slashName: 'review',
    submitOnSelect: true,
  },
  {
    id: 'codex.plan',
    name: 'plan',
    displayName: 'Plan',
    description: 'Switch to Codex Plan mode.',
    slashName: 'plan',
    submitOnSelect: true,
  },
  {
    id: 'codex.goal',
    name: 'goal',
    displayName: 'Goal',
    description: 'Set or view the Codex thread goal.',
    slashName: 'goal',
    composerMode: {
      label: 'Goal',
      placeholder: 'Describe the goal',
    },
  },
] as const;
