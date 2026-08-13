import type { CodexAppServerClient, v2 } from '../codex/index';
import type {
  CodexConversationSummary,
  CodexSurfaceSnapshot,
  SendCodexMessageOptions,
  StartCodexReviewOptions,
  SurfaceMessage,
  UpdateCodexConversationSettings,
} from '@codex-app-sdk/core/surface';
import {
  attachmentInput,
  surfaceAttachmentPart,
  validateAttachments,
  validatedSendOptions,
} from './codex-surface-data';
import type { SurfaceEventInput } from './codex-surface-events';
import { createMessageId, createQueuedPromptId, timestampToIso } from './codex-surface-events';
import { ensureAssistantTurnMessage } from './codex-surface-message-state';
import {
  errorMessage,
  mergeSkillInputs,
  parseGoalSlashCommand,
  parsePlanSlashCommand,
  parseReviewSlashCommand,
  promptSkillInputsFromText,
  validateSkillInputs,
} from './codex-surface-prompts';
import { turnSettings } from './codex-surface-settings';
import type { ThreadRuntimePatch, ThreadRuntimeState } from './codex-surface-runtime';

export type CodexSurfaceMessagesHost = {
  clearGoalForThread(threadId: string): Promise<void>;
  compactForThread(threadId: string): Promise<void>;
  createConversation(): Promise<void>;
  emitConversationActivity(threadId: string, origin: 'action'): void;
  emitEvent(origin: 'action', input: SurfaceEventInput): void;
  ensureConnected(): Promise<void>;
  ensureThreadReady(threadId: string): Promise<ThreadRuntimeState>;
  getSnapshot(): CodexSurfaceSnapshot;
  getState(): CodexSurfaceSnapshot;
  patchConversationStatus(
    threadId: string,
    status: CodexConversationSummary['status'],
    origin: 'action',
  ): void;
  patchConversationTurnCount(threadId: string, turnCount: number, origin: 'action'): void;
  patchRuntime(threadId: string, patch: ThreadRuntimePatch): void;
  requireRuntime(threadId: string): ThreadRuntimeState;
  setGoal(objective: string): Promise<CodexSurfaceSnapshot>;
  setGoalForThread(threadId: string, objective: string): Promise<void>;
  snapshotForRuntime(runtime: ThreadRuntimeState): CodexSurfaceSnapshot;
  startReview(options: StartCodexReviewOptions): Promise<CodexSurfaceSnapshot>;
  startReviewForThread(threadId: string, options: StartCodexReviewOptions): Promise<void>;
  updateSettings(settings: UpdateCodexConversationSettings): Promise<CodexSurfaceSnapshot>;
  updateSettingsForThread(threadId: string, settings: UpdateCodexConversationSettings): Promise<void>;
};

export class CodexSurfaceMessagesController {
  constructor(
    private readonly client: CodexAppServerClient,
    private readonly host: CodexSurfaceMessagesHost,
  ) {}

  async send(prompt: string, options: SendCodexMessageOptions = {}): Promise<CodexSurfaceSnapshot> {
    await this.host.ensureConnected();
    let text = prompt.trim();
    if (!text) throw new Error('Cannot send an empty message');
    if (!this.host.getState().activeConversationId) {
      const planCommand = parsePlanSlashCommand(text);
      if (planCommand) {
        await this.host.createConversation();
        await this.host.updateSettings({ planMode: true });
        if (!planCommand.prompt) return this.host.getSnapshot();
        text = planCommand.prompt;
        options = { ...options, planMode: true };
      }
      const goalCommand = parseGoalSlashCommand(text);
      if (goalCommand) {
        if (goalCommand.action === 'clear' || goalCommand.action === 'show' || goalCommand.action === 'edit') {
          return this.host.getSnapshot();
        }
        if (goalCommand.action === 'set') return this.host.setGoal(goalCommand.objective);
        throw new Error('Pausing and resuming goals is not supported by Codex app-server');
      }
      if (text === '/compact') return this.host.getSnapshot();
      const reviewCommand = parseReviewSlashCommand(text);
      if (reviewCommand) {
        await this.host.createConversation();
        return this.host.startReview({ target: reviewCommand });
      }
      await this.host.createConversation();
    }
    const threadId = this.host.getState().activeConversationId;
    if (!threadId) throw new Error('Codex did not create a conversation');
    await this.sendToThread(threadId, text, options);
    return this.host.getSnapshot();
  }

  async sendToThread(
    threadId: string,
    prompt: string,
    options: SendCodexMessageOptions = {},
  ): Promise<void> {
    const runtime = await this.host.ensureThreadReady(threadId);
    let text = prompt.trim();
    if (!text) throw new Error('Cannot send an empty message');
    const planCommand = parsePlanSlashCommand(text);
    if (planCommand) {
      await this.host.updateSettingsForThread(threadId, { planMode: true });
      if (!planCommand.prompt) return;
      text = planCommand.prompt;
      options = { ...options, planMode: true };
    }
    const goalCommand = parseGoalSlashCommand(text);
    if (goalCommand) {
      if (goalCommand.action === 'clear') return this.host.clearGoalForThread(threadId);
      if (goalCommand.action === 'set') return this.host.setGoalForThread(threadId, goalCommand.objective);
      if (goalCommand.action === 'unsupported') {
        throw new Error('Pausing and resuming goals is not supported by Codex app-server');
      }
      return;
    }
    if (text === '/compact') return this.host.compactForThread(threadId);
    const reviewCommand = parseReviewSlashCommand(text);
    if (reviewCommand) return this.host.startReviewForThread(threadId, { target: reviewCommand });
    options = {
      ...validatedSendOptions(this.host.snapshotForRuntime(runtime), options),
      ...(options.skills ? { skills: validateSkillInputs(options.skills, runtime.skills) } : {}),
    };
    await this.sendPromptToThread(threadId, text, options);
  }

  async sendPromptToThread(
    threadId: string,
    text: string,
    options: SendCodexMessageOptions = {},
  ): Promise<void> {
    const runtime = this.host.requireRuntime(threadId);
    const normalizedOptions = validatedSendOptions(this.host.snapshotForRuntime(runtime), options);
    const skillInputs = mergeSkillInputs(
      promptSkillInputsFromText(text, runtime.skills),
      validateSkillInputs(normalizedOptions.skills ?? [], runtime.skills),
    );
    const attachments = validateAttachments(normalizedOptions.attachments ?? []);
    if (runtime.busy) {
      this.host.patchRuntime(threadId, {
        queuedPrompts: [
          ...runtime.queuedPrompts,
          {
            id: createQueuedPromptId(),
            text,
            ...(Object.keys(normalizedOptions).length > 0 ? { options: normalizedOptions } : {}),
          },
        ],
      });
      return;
    }

    const messageId = createMessageId();
    const optimisticMessage: SurfaceMessage = {
      id: messageId,
      role: 'user',
      status: 'complete',
      parts: [{ type: 'text', text }, ...attachments.map(surfaceAttachmentPart)],
      createdAt: new Date().toISOString(),
      metadata: {
        conversationId: threadId,
        ...(attachments.length > 0 ? { attachments } : {}),
      },
    };
    this.host.patchRuntime(threadId, {
      busy: true, turnStartPending: true, error: null,
      messages: [...runtime.messages, optimisticMessage],
    });
    this.host.patchConversationStatus(threadId, 'active', 'action');
    this.host.emitEvent('action', {
      type: 'message.appended', conversationId: threadId,
      payload: { message: structuredClone(optimisticMessage) },
    });
    this.host.emitConversationActivity(threadId, 'action');

    try {
      const response = await this.client.request('turn/start', {
        threadId,
        clientUserMessageId: messageId,
        input: [
          { type: 'text', text, text_elements: [] },
          ...attachments.map(attachmentInput),
          ...skillInputs.map((skill) => ({ type: 'skill' as const, name: skill.name, path: skill.path })),
        ],
        ...turnSettings(this.host.snapshotForRuntime(runtime), normalizedOptions),
        ...(normalizedOptions.outputSchema === undefined
          ? {}
          : { outputSchema: normalizedOptions.outputSchema as v2.TurnStartParams['outputSchema'] }),
      });
      const wasKnownTurn = runtime.turnIds.includes(response.turn.id);
      runtime.activeTurnId = response.turn.status === 'inProgress' ? response.turn.id : null;
      if (!runtime.turnIds.includes(response.turn.id)) runtime.turnIds.push(response.turn.id);
      this.host.patchConversationTurnCount(threadId, runtime.turnIds.length, 'action');
      const busy = response.turn.status === 'inProgress';
      const messages = runtime.messages.map((message) => message.id === messageId
        ? { ...message, turnId: response.turn.id, metadata: { ...message.metadata, turnId: response.turn.id } }
        : message);
      this.host.patchRuntime(threadId, {
        busy,
        turnStartPending: false,
        messages: busy ? ensureAssistantTurnMessage(messages, threadId, response.turn.id) : messages,
      });
      this.host.patchConversationStatus(threadId, busy ? 'active' : 'idle', 'action');
      if (busy && !wasKnownTurn) {
        this.host.emitEvent('action', {
          type: 'turn.started', conversationId: threadId, turnId: response.turn.id,
          payload: { startedAt: timestampToIso(response.turn.startedAt) },
        });
      }
      this.host.emitConversationActivity(threadId, 'action');
    } catch (error) {
      this.host.patchRuntime(threadId, {
        busy: false, turnStartPending: false, error: errorMessage(error),
      });
      this.host.patchConversationStatus(threadId, 'error', 'action');
      this.host.emitConversationActivity(threadId, 'action');
      throw error;
    }
  }

  async steer(
    prompt: string,
    options: SendCodexMessageOptions = {},
  ): Promise<CodexSurfaceSnapshot> {
    const threadId = this.requiredActiveConversation();
    await this.steerForThread(threadId, prompt, options);
    return this.host.getSnapshot();
  }

  async steerForThread(
    threadId: string,
    prompt: string,
    options: SendCodexMessageOptions = {},
  ): Promise<void> {
    const runtime = await this.host.ensureThreadReady(threadId);
    const text = prompt.trim();
    if (!text) throw new Error('Cannot steer with an empty message');
    if (!runtime.activeTurnId) throw new Error('There is no active turn to steer');
    const attachments = validateAttachments(options.attachments ?? []);
    const messageId = createMessageId();
    const optimisticSteer: SurfaceMessage = {
      id: messageId, kind: 'steer', role: 'user', status: 'complete',
      parts: [{ type: 'text', text }, ...attachments.map(surfaceAttachmentPart)],
      createdAt: new Date().toISOString(),
      turnId: runtime.activeTurnId,
      metadata: {
        conversationId: threadId,
        turnId: runtime.activeTurnId,
        ...(attachments.length > 0 ? { attachments } : {}),
      },
    };
    this.host.patchRuntime(threadId, {
      error: null,
      messages: ensureAssistantTurnMessage(
        [...runtime.messages, optimisticSteer], threadId, runtime.activeTurnId, { forceSegment: true },
      ),
    });
    this.host.emitEvent('action', {
      type: 'message.appended', conversationId: threadId, turnId: runtime.activeTurnId,
      payload: { message: structuredClone(optimisticSteer) },
    });
    try {
      const response = await this.client.request('turn/steer', {
        threadId,
        expectedTurnId: runtime.activeTurnId,
        clientUserMessageId: messageId,
        input: [
          { type: 'text', text, text_elements: [] },
          ...attachments.map(attachmentInput),
        ],
      });
      const wasKnownTurn = runtime.turnIds.includes(response.turnId);
      runtime.activeTurnId = response.turnId;
      if (!runtime.turnIds.includes(response.turnId)) runtime.turnIds.push(response.turnId);
      this.host.patchConversationTurnCount(threadId, runtime.turnIds.length, 'action');
      const steeredMessages = runtime.messages.map((message) => message.id === messageId
        ? { ...message, turnId: response.turnId, metadata: { ...message.metadata, turnId: response.turnId } }
        : message);
      this.host.patchRuntime(threadId, {
        messages: ensureAssistantTurnMessage(steeredMessages, threadId, response.turnId),
      });
      if (!wasKnownTurn) {
        this.host.emitEvent('action', {
          type: 'turn.started', conversationId: threadId, turnId: response.turnId,
          payload: { startedAt: new Date().toISOString() },
        });
      }
    } catch (error) {
      this.host.patchRuntime(threadId, { error: errorMessage(error) });
      throw error;
    }
  }

  async deleteQueuedPrompt(promptId: string): Promise<CodexSurfaceSnapshot> {
    const threadId = this.requiredActiveConversation();
    await this.deleteQueuedPromptForThread(threadId, promptId);
    return this.host.getSnapshot();
  }

  async deleteQueuedPromptForThread(threadId: string, promptId: string): Promise<void> {
    const runtime = await this.host.ensureThreadReady(threadId);
    const queuedPrompts = runtime.queuedPrompts.filter((prompt) => prompt.id !== promptId);
    if (queuedPrompts.length === runtime.queuedPrompts.length) {
      throw new Error(`Unknown queued prompt '${promptId}'`);
    }
    this.host.patchRuntime(runtime.threadId, { queuedPrompts });
  }

  async updateQueuedPrompt(promptId: string, prompt: string): Promise<CodexSurfaceSnapshot> {
    const threadId = this.requiredActiveConversation();
    await this.updateQueuedPromptForThread(threadId, promptId, prompt);
    return this.host.getSnapshot();
  }

  async updateQueuedPromptForThread(threadId: string, promptId: string, prompt: string): Promise<void> {
    const runtime = await this.host.ensureThreadReady(threadId);
    const text = prompt.trim();
    if (!text) throw new Error('Cannot update a queued prompt with empty content');
    let found = false;
    const queuedPrompts = runtime.queuedPrompts.map((candidate) => {
      if (candidate.id !== promptId) return candidate;
      found = true;
      return { ...candidate, text };
    });
    if (!found) throw new Error(`Unknown queued prompt '${promptId}'`);
    this.host.patchRuntime(runtime.threadId, { queuedPrompts });
  }

  async steerQueuedPrompt(promptId: string, prompt?: string): Promise<CodexSurfaceSnapshot> {
    const threadId = this.requiredActiveConversation();
    await this.steerQueuedPromptForThread(threadId, promptId, prompt);
    return this.host.getSnapshot();
  }

  async steerQueuedPromptForThread(threadId: string, promptId: string, replacement?: string): Promise<void> {
    const runtime = await this.host.ensureThreadReady(threadId);
    const prompt = runtime.queuedPrompts.find((candidate) => candidate.id === promptId);
    if (!prompt) throw new Error(`Unknown queued prompt '${promptId}'`);
    this.host.patchRuntime(runtime.threadId, {
      queuedPrompts: runtime.queuedPrompts.filter((candidate) => candidate.id !== promptId),
    });
    const text = replacement ?? prompt.text;
    if (runtime.busy) await this.steerForThread(threadId, text, prompt.options);
    else await this.sendToThread(threadId, text, prompt.options);
  }

  async sendNextQueuedPrompt(threadId: string): Promise<void> {
    const runtime = this.host.requireRuntime(threadId);
    if (runtime.busy || runtime.queuedPrompts.length === 0) return;
    const [next, ...queuedPrompts] = runtime.queuedPrompts;
    if (!next) return;
    this.host.patchRuntime(threadId, { queuedPrompts });
    try {
      await this.sendPromptToThread(threadId, next.text, next.options);
    } catch (error) {
      this.host.patchRuntime(threadId, {
        error: errorMessage(error), queuedPrompts: [next, ...runtime.queuedPrompts],
      });
    }
  }

  private requiredActiveConversation(): string {
    const threadId = this.host.getState().activeConversationId;
    if (!threadId) throw new Error('There is no active conversation');
    return threadId;
  }
}
