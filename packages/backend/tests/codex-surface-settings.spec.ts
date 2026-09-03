import { describe, expect, it } from 'vitest';
import type { v2 } from '../src/codex';
import type { CodexSurfaceModel, CodexSurfaceSnapshot } from '@codex-app-sdk/core/surface';
import {
  approvalPresetFromSettings,
  approvalPresetsForProfiles,
  approvalPresetStartParams,
  approvalPresetUpdateParams,
  collaborationMode,
  defaultReasoningEffort,
  nextSelection,
  requireCatalogModel,
  selectedModel,
  sessionSelection,
  threadSettingsSelection,
  turnSettings,
  validateReasoningEffort,
  validateServiceTier,
} from '../src/node/codex-surface-settings';

const models: CodexSurfaceModel[] = [
  {
    id: 'fast-id',
    model: 'fast-model',
    displayName: 'Fast',
    supportedReasoningEfforts: [
      { reasoningEffort: 'low', description: 'Low' },
      { reasoningEffort: 'medium', description: 'Medium' },
    ],
    defaultReasoningEffort: 'medium',
    serviceTiers: [{ id: 'priority', name: 'Priority', description: 'Fast mode' }],
    defaultServiceTier: null,
  },
  {
    id: 'default-id',
    model: 'default-model',
    displayName: 'Default',
    supportedReasoningEfforts: [{ reasoningEffort: 'high', description: 'High' }],
    isDefault: true,
  },
];

describe('Codex surface settings policy', () => {
  it('selects catalog models and validates reasoning effort', () => {
    expect(selectedModel(models, 'fast-id')).toBe(models[0]);
    expect(selectedModel(models, 'fast-model')).toBe(models[0]);
    expect(selectedModel(models, 'missing')).toBe(models[1]);
    expect(selectedModel([{ ...models[0]!, isDefault: false }], null)?.id).toBe('fast-id');
    expect(selectedModel([], null)).toBeNull();
    expect(requireCatalogModel(models, 'default-model')).toBe(models[1]);
    expect(() => requireCatalogModel(models, 'missing')).toThrow("Unknown model 'missing'");
    expect(() => validateReasoningEffort(null, undefined)).not.toThrow();
    expect(() => validateReasoningEffort(null, 'high')).toThrow("without a model");
    expect(() => validateReasoningEffort(models[0]!, 'high')).toThrow("not available for 'Fast'");
    expect(() => validateReasoningEffort(models[0]!, 'low')).not.toThrow();
    expect(() => validateServiceTier(models[0]!, 'priority')).not.toThrow();
    expect(() => validateServiceTier(models[0]!, 'default')).not.toThrow();
    expect(() => validateServiceTier({ ...models[0]!, defaultServiceTier: 'standard' }, 'standard')).not.toThrow();
    expect(() => validateServiceTier(models[0]!, 'unknown')).toThrow("not available for 'Fast'");
    expect(() => validateReasoningEffort({ id: 'open', model: 'open', displayName: 'Open' }, 'custom'))
      .not.toThrow();
    expect(defaultReasoningEffort(models[0]!)).toBe('medium');
    expect(defaultReasoningEffort(models[1]!)).toBe('high');
    expect(defaultReasoningEffort({ id: 'none', model: 'none', displayName: 'None' })).toBeNull();
  });

  it('derives allowed approval presets from profiles and managed requirements', () => {
    const profiles = [
      { id: ':workspace', description: null, allowed: true },
      { id: ':danger-full-access', description: null, allowed: true },
      { id: ':danger-no-sandbox', description: null, allowed: false },
    ];
    expect(approvalPresetsForProfiles(profiles, null)).toStrictEqual([
      'ask-for-approval', 'approve-for-me', 'full-access',
    ]);
    expect(approvalPresetsForProfiles(profiles, requirements({
      allowedApprovalPolicies: ['on-request'],
      allowedApprovalsReviewers: ['user'],
    }))).toStrictEqual(['ask-for-approval']);
    expect(approvalPresetsForProfiles([
      { id: ':danger-no-sandbox', description: null, allowed: true },
    ], requirements({
      allowedApprovalPolicies: [],
      allowedApprovalsReviewers: [],
    }))).toStrictEqual(['full-access']);
    expect(approvalPresetsForProfiles(profiles.map((profile) => ({ ...profile, allowed: false })), null))
      .toStrictEqual([]);
  });

  it('maps approval presets and authoritative settings in both directions', () => {
    expect(approvalPresetStartParams('full-access')).toStrictEqual({
      approvalPolicy: 'never', approvalsReviewer: 'user', permissions: ':danger-full-access',
    });
    expect(approvalPresetStartParams('approve-for-me')).toStrictEqual({
      approvalPolicy: 'on-request', approvalsReviewer: 'auto_review', permissions: ':workspace',
    });
    expect(approvalPresetUpdateParams('ask-for-approval')).toStrictEqual({
      approvalPolicy: 'on-request', approvalsReviewer: 'user', permissions: ':workspace',
    });
    expect(approvalPresetFromSettings('never', 'user', { type: 'dangerFullAccess' }, null)).toBe('full-access');
    expect(approvalPresetFromSettings('never', 'user', { type: 'readOnly', networkAccess: false }, { id: ':danger-full-access', extends: null }))
      .toBe('full-access');
    expect(approvalPresetFromSettings('never', 'user', { type: 'readOnly', networkAccess: false }, { id: ':danger-no-sandbox', extends: null }))
      .toBe('full-access');
    expect(approvalPresetFromSettings('on-request', 'auto_review', { type: 'readOnly', networkAccess: false }, null))
      .toBe('approve-for-me');
    expect(approvalPresetFromSettings('on-request', 'guardian_subagent', { type: 'readOnly', networkAccess: false }, null))
      .toBe('approve-for-me');
    expect(approvalPresetFromSettings('on-request', 'user', { type: 'readOnly', networkAccess: false }, null))
      .toBe('ask-for-approval');
    expect(approvalPresetFromSettings('untrusted', 'user', { type: 'readOnly', networkAccess: false }, null)).toBeNull();
  });

  it('computes local selection changes and rejects incompatible settings', () => {
    const current = snapshot({
      models,
      selectedModelId: 'fast-id',
      selectedReasoningEffort: 'low',
      selectedServiceTier: null,
      approvalPreset: 'ask-for-approval',
      planMode: false,
    });
    expect(nextSelection(current, {})).toStrictEqual({
      approvalPreset: 'ask-for-approval',
      planMode: false,
      selectedModelId: 'fast-id',
      selectedReasoningEffort: 'low',
      selectedServiceTier: null,
    });
    expect(nextSelection(current, {
      approvalPreset: 'full-access', modelId: 'default-id', planMode: true,
    })).toStrictEqual({
      approvalPreset: 'full-access',
      planMode: true,
      selectedModelId: 'default-id',
      selectedReasoningEffort: 'high',
      selectedServiceTier: null,
    });
    expect(nextSelection(current, { modelId: 'fast-id', reasoningEffort: 'medium' }).selectedReasoningEffort)
      .toBe('medium');
    expect(nextSelection({ ...current, selectedServiceTier: 'priority' }, { modelId: 'default-id' })
      .selectedServiceTier).toBeNull();
    expect(() => nextSelection(current, { modelId: 'missing' })).toThrow("Unknown model 'missing'");
    expect(() => nextSelection(current, { reasoningEffort: 'high' })).toThrow("not available for 'Fast'");
    expect(nextSelection(snapshot({ models: [], selectedModelId: null }), { planMode: true }))
      .toMatchObject({ selectedModelId: null, planMode: true });
  });

  it('projects app-server session and thread settings with safe fallbacks', () => {
    const current = snapshot({
      approvalPreset: 'ask-for-approval',
      models,
      planMode: true,
      selectedModelId: 'fast-id',
      selectedReasoningEffort: 'low',
    });
    const session = sessionSelection({
      model: 'fast-model',
      approvalPolicy: 'on-request',
      approvalsReviewer: 'auto_review',
      sandbox: { type: 'readOnly' },
      activePermissionProfile: null,
      reasoningEffort: null,
      serviceTier: null,
    } as v2.ThreadStartResponse, models, current);
    expect(session).toStrictEqual({
      approvalPreset: 'approve-for-me',
      planMode: true,
      selectedModelId: 'fast-id',
      selectedReasoningEffort: 'medium',
      selectedServiceTier: null,
    });

    const thread = threadSettingsSelection({
      model: 'missing',
      approvalPolicy: 'untrusted',
      approvalsReviewer: 'user',
      sandboxPolicy: { type: 'readOnly' },
      activePermissionProfile: null,
      effort: 'high',
      collaborationMode: { mode: 'plan', settings: { model: 'default-model', reasoning_effort: 'high', developer_instructions: null } },
    } as v2.ThreadSettings, models, current);
    expect(thread).toStrictEqual({
      approvalPreset: 'ask-for-approval',
      planMode: true,
      selectedModelId: 'default-id',
      selectedReasoningEffort: 'high',
      selectedServiceTier: null,
    });

    expect(sessionSelection({
      model: 'missing', approvalPolicy: 'untrusted', approvalsReviewer: 'user', sandbox: { type: 'readOnly' },
      activePermissionProfile: null, reasoningEffort: null,
    } as v2.ThreadStartResponse, [], current)).toMatchObject({
      approvalPreset: 'ask-for-approval', selectedModelId: 'fast-id', selectedReasoningEffort: null,
    });
  });

  it('builds turn settings only from available or explicit values', () => {
    expect(collaborationMode(true, 'fast-model', 'medium')).toStrictEqual({
      mode: 'plan',
      settings: { model: 'fast-model', reasoning_effort: 'medium', developer_instructions: null },
    });
    expect(collaborationMode(false, 'fast-model', null).mode).toBe('default');
    expect(turnSettings(snapshot({ models: [], selectedModelId: null }), {})).toStrictEqual({});
    expect(turnSettings(snapshot({
      models,
      selectedModelId: 'fast-id',
      selectedReasoningEffort: 'low',
      selectedServiceTier: null,
      planMode: false,
    }), { model: 'explicit', reasoningEffort: 'high', planMode: true, serviceTier: 'priority' })).toStrictEqual({
      model: 'explicit',
      effort: 'high',
      serviceTier: 'priority',
      collaborationMode: {
        mode: 'plan',
        settings: { model: 'explicit', reasoning_effort: 'high', developer_instructions: null },
      },
    });
  });
});

function requirements(overrides: Partial<v2.ConfigRequirements>): v2.ConfigRequirements {
  return {
    cliAuthCredentialsStore: null,
    chatgptBaseUrl: null,
    additionalDeveloperInstructions: null,
    allowedApprovalPolicies: null,
    allowedApprovalsReviewers: null,
    allowedSandboxModes: null,
    allowedWindowsSandboxImplementations: null,
    allowedPermissionProfiles: null,
    defaultPermissions: null,
    allowedWebSearchModes: null,
    allowManagedHooksOnly: null,
    allowBrowserAndComputerUse: null,
    allowAppshots: null,
    allowRemoteControl: null,
    computerUse: null,
    browserUse: null,
    inAppBrowser: null,
    featureRequirements: null,
    hooks: null,
    enforceResidency: null,
    network: null,
    autoReview: null,
    models: null,
    sqliteHome: null,
    logDir: null,
    modelCatalogJson: null,
    checkForUpdateOnStartup: null,
    allowLoginShell: null,
    feedback: null,
    windowsSandboxPrivateDesktop: null,
    ...overrides,
  };
}

function snapshot(overrides: Partial<CodexSurfaceSnapshot> = {}): CodexSurfaceSnapshot {
  return {
    status: 'ready',
    authentication: {
      status: 'loaded',
      account: null,
      requiresOpenaiAuth: null,
      error: null,
      login: { status: 'idle', loginId: null, authUrl: null, error: null },
    },
    conversations: [],
    activeConversationId: null,
    messages: [],
    clientRequests: [],
    answeredClientRequestIds: [],
    approvals: [],
    models: [],
    modelCatalogStatus: 'loaded',
    skills: [],
    skillCatalogStatus: 'loaded',
    plugins: [],
    pluginCatalogStatus: 'loaded',
    permissionProfiles: [],
    approvalPresets: [],
    approvalPreset: null,
    selectedModelId: null,
    selectedReasoningEffort: null,
    planMode: false,
    contextUsage: null,
    goal: null,
    turnGitDiff: null,
    threadStatus: null,
    rateLimits: null,
    queuedPrompts: [],
    busy: false,
    historyLoading: false,
    error: null,
    ...overrides,
  };
}
