import type { ApprovalPreset } from './contracts';

export const defaultApprovalPreset: ApprovalPreset = 'full-access';

export type ApprovalPresetOption = {
  id: ApprovalPreset;
  label: string;
  description: string;
};

export const approvalPresetOptions: readonly ApprovalPresetOption[] = [
  {
    id: 'ask-for-approval',
    label: 'Ask for approval',
    description: 'Pause before tool calls that need user approval.',
  },
  {
    id: 'approve-for-me',
    label: 'Approve for me',
    description: 'Let Codex approve safe tool calls for the active session.',
  },
  {
    id: 'full-access',
    label: 'Full access',
    description: 'Run trusted workspace tools without extra prompts.',
  },
] as const;

export function isApprovalPreset(value: unknown): value is ApprovalPreset {
  return value === 'ask-for-approval' || value === 'approve-for-me' || value === 'full-access';
}
