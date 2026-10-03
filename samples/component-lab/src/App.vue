<template>
  <main class="lab" :data-codex-theme="theme">
    <aside class="lab__sidebar">
      <div>
        <p class="lab__eyebrow">Codex App SDK</p>
        <h1>Component lab</h1>
        <p class="lab__intro">Conversation fixtures and an opt-in live chat lab.</p>
      </div>

      <nav aria-label="Scenarios">
        <button
          v-for="item in scenarios"
          :key="item.id"
          type="button"
          :class="{ 'lab__scenario--active': item.id === selectedId }"
          @click="selectedId = item.id"
        >
          <strong>{{ item.name }}</strong>
          <span>{{ item.summary }}</span>
        </button>
      </nav>

      <label class="lab__theme">
        Theme
        <select v-model="theme">
          <option value="light">Light</option>
          <option value="dark">Dark</option>
          <option value="system">System</option>
        </select>
      </label>
    </aside>

    <section class="lab__stage" :class="{ 'lab__stage--requests': selected.id === 'requests' }">
      <header class="lab__header">
        <div>
          <p class="lab__eyebrow">{{ selected.name }}</p>
          <h2>{{ selected.title }}</h2>
          <p>{{ selected.description }}</p>
        </div>
        <div class="lab__header-actions">
          <button
            type="button"
            class="lab__reset"
            :class="{ 'lab__reset--confirmed': resetConfirmed }"
            aria-live="polite"
            @click="resetScenario()"
          >
            {{ resetConfirmed ? 'Reset complete' : 'Reset scenario' }}
          </button>
        </div>
      </header>

      <div v-if="selected.id === 'requests'" class="lab__request-controls">
        <div>
          <span>Approval</span>
          <button type="button" @click="requestCommandApproval">Native approval</button>
          <button type="button" @click="requestApproval">Tool confirmation</button>
        </div>
        <div>
          <span>Question</span>
          <select v-model="questionFormat" aria-label="Question format">
            <option value="choices">Choices + Other</option>
            <option value="text">Free text</option>
          </select>
          <select v-model="questionSteps" aria-label="Question steps">
            <option value="single">Single question</option>
            <option value="multiple">Multi-step</option>
          </select>
          <select v-model="questionDelivery" aria-label="Question delivery">
            <option value="tool">Blocking</option>
            <option value="async">Async</option>
          </select>
          <button type="button" @click="requestQuestion">Ask question</button>
          <button v-if="hasActiveAsyncQuestion" type="button" @click="completeAsyncQuestionTurn">Complete turn</button>
        </div>
      </div>

      <div class="lab__frame">
        <LiveChatLab v-if="selected.id === 'live-chat'" :key="resetRevision" />
        <CodexConversationPane
          v-else
          :key="`${selected.id}:${resetRevision}`"
          v-model="draft"
          :active-turn-id="mockActiveTurnId"
          :answered-client-request-ids="answeredClientRequestIds"
          :approvals="approvals"
          :busy="mockBusy"
          :client-requests="clientRequests"
          :context-usage="selected.contextUsage"
          :conversation-key="selected.id"
          :empty-description="selected.description"
          :empty-title="selected.title"
          :error="selected.error"
          :files="files"
          :ingest-attachments="ingestMockAttachments"
          :has-composer-context="selectedMessageContexts.length > 0"
          :message-text-selection="selected.id === 'message-selection'"
          :messages="messages"
          :models="models"
          :plan-mode="false"
          :plugins="plugins"
          :queued-prompts="selected.queuedPrompts"
          :selected-model-id="models[0].id"
          selected-reasoning-effort="medium"
          :skills="skills"
          :turn-git-diff="selected.turnGitDiff"
          :turns="mockTurns"
          :transcribe-audio="transcribeAudio"
          @interrupt="activity = 'Interrupt requested'"
          @client-response="respondToClientRequest"
          @resolve-approval="resolveApproval"
          @continue-interrupted-turn="continueInterruptedTurn"
          @message-text-selection-change="selectedMessageText = $event"
          @submit="submitPrompt"
        >
          <template #message-header="{ message }">
            <span v-if="messageHeaderFor(message)">
              {{ messageHeaderFor(message) }}
            </span>
          </template>
          <template #composer-context="{ disabled }">
            <div v-if="selectedMessageContexts.length > 0" class="lab__composer-context">
              <div v-for="context in selectedMessageContexts" :key="`${context.messageIndex}:${context.text}`" class="lab__composer-context-card">
                <span>{{ context.text }}</span>
                <button type="button" :disabled="disabled" aria-label="Remove selected context" @click="removeSelectedContext(context)">×</button>
              </div>
            </div>
          </template>
        </CodexConversationPane>
        <button
          v-if="selected.id === 'message-selection' && selectedMessageText"
          type="button"
          class="lab__selection-action"
          :style="selectionActionStyle"
          @pointerdown.prevent
          @click="addSelectedContext"
        >
          Add selected context
        </button>
      </div>

      <footer class="lab__footer">
        <span><kbd>Enter</kbd> send</span>
        <span><kbd>Shift</kbd> + <kbd>Enter</kbd> newline</span>
        <span><kbd>$</kbd> skills</span>
        <span><kbd>@</kbd> plugins and files</span>
        <output aria-live="polite">{{ activity }}</output>
      </footer>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, onBeforeUnmount, ref, watch } from 'vue';
import LiveChatLab from './LiveChatLab.vue';
import {
  CodexConversationPane,
  provideCodexToolPresentation,
  type CodexChatMessage,
  type CodexChatTranscription,
  type CodexContextUsage,
  type ClientRequestResponse,
  type CodexModelOption,
  type CodexMessageTextSelection,
  type CodexNativeAttachment,
  type CodexNativeAttachmentInput,
  type CodexQueuedPromptData,
  type CodexSkillSummary,
  type CodexRendererSendMessageOptions,
  type SurfaceMessage,
  type SurfaceMessagePart,
  type TurnGitDiff,
} from '@codex-app-sdk/vue';
import type { CodexSurfaceApproval, CodexSurfaceApprovalDecision, CodexSurfaceAskUserQuestion, CodexSurfaceClientRequest, CodexSurfacePlugin, CodexSurfaceTurn } from '@codex-app-sdk/core/surface';

type Scenario = {
  id: string;
  name: string;
  summary: string;
  title: string;
  description: string;
  messages: SurfaceMessage[];
  activeTurnId?: string | null;
  turns?: readonly CodexSurfaceTurn[];
  busy?: boolean;
  error?: string;
  queuedPrompts?: CodexQueuedPromptData[];
  contextUsage?: CodexContextUsage;
  turnGitDiff?: TurnGitDiff;
};

const plugins: CodexSurfacePlugin[] = [
  { id: 'gmail@remote', name: 'gmail', displayName: 'Gmail', shortDescription: 'Read and manage Gmail', brandColor: '#EA4335', enabled: true },
  { id: 'google-drive@remote', name: 'google-drive', displayName: 'Google Drive', shortDescription: 'Search files and documents', brandColor: '#0F9D58', enabled: true },
];
const skills: CodexSkillSummary[] = [
  { name: 'Commit-Push (cp)', displayName: 'Commit-Push', shortDescription: 'Commit and publish completed work', brandColor: '#6D5BD0', path: '/mock/skills/commit-push/SKILL.md', enabled: true },
  { name: 'review', displayName: 'Code Review', shortDescription: 'Review local changes', brandColor: '#D97708', path: '/mock/skills/review/SKILL.md', enabled: true },
];
const files = [
  { name: 'README.md', path: 'README.md' },
  { name: 'ChatRichTextEditor.vue', path: 'src/vue/chat/ChatRichTextEditor.vue' },
  { name: 'CodexComposer.vue', path: 'src/vue/components/CodexComposer.vue' },
];
const models: [CodexModelOption, ...CodexModelOption[]] = [{
  id: 'gpt-5.6-sol',
  model: 'gpt-5.6-sol',
  displayName: '5.6-Sol',
  description: 'Mock model for component testing',
  supportedReasoningEfforts: [
    { reasoningEffort: 'low', description: 'Fast' },
    { reasoningEffort: 'medium', description: 'Balanced' },
    { reasoningEffort: 'high', description: 'Deep' },
  ],
  defaultReasoningEffort: 'medium',
  serviceTiers: [{ id: 'priority', name: 'Priority', description: 'Faster responses when available' }],
  defaultServiceTier: null,
  isDefault: true,
}];

const transcribeAudio: CodexChatTranscription = async () => ({ text: 'Mock voice prompt' });

const messageHeaders: Readonly<Record<string, string>> = {
  'conversation-steer': 'Message from codex-claw',
};

function messageHeaderFor(message: CodexChatMessage): string | undefined {
  return message.id ? messageHeaders[message.id] : undefined;
}

const InAppBrowserIcon = defineComponent({
  name: 'InAppBrowserIcon',
  setup: () => () => h('svg', {
    'aria-hidden': 'true',
    class: 'lab-browser-tool-icon',
    fill: 'none',
    stroke: 'currentColor',
    viewBox: '0 0 24 24',
  }, [
    h('rect', { x: 3, y: 4, width: 18, height: 16, rx: 2 }),
    h('path', { d: 'M3 9h18M7 6.5h.01M10 6.5h.01' }),
  ]),
});

provideCodexToolPresentation(({ kind, metadata }) => (
  kind === 'mcp' && metadata?.server === 'codex_claw' && metadata.tool === 'browser_open'
    ? { icon: InAppBrowserIcon, title: 'Opened in-app browser' }
    : undefined
));

const scenarios: [Scenario, ...Scenario[]] = [
  {
    id: 'conversation',
    name: 'Conversation',
    summary: 'Mentions, attachments, tools, and steering',
    title: 'Multi-turn conversation',
    description: 'A compact fixture for the message combinations that most often regress.',
    messages: [
      {
        id: 'conversation-user', role: 'user', status: 'complete', createdAt: '2026-08-01T12:00:00Z', parts: [
          { type: 'text', text: 'Use $cp after checking @gmail and compare these artifacts.' },
          { type: 'attachment', attachment: { kind: 'image', name: 'composer-broken.png', path: '/mock/composer-broken.png', url: '/attachment-preview.svg', mimeType: 'image/png' } },
          { type: 'attachment', attachment: { kind: 'file', name: 'layout-notes.md', path: '/mock/layout-notes.md', mimeType: 'text/markdown' } },
        ],
      },
      {
        id: 'conversation-assistant', role: 'assistant', status: 'complete', createdAt: '2026-08-01T12:00:01Z', parts: [
          { type: 'tool', id: 'tool-explore', title: 'Explored source', kind: 'command', status: 'completed', statusText: JSON.stringify({ source: 'codex', action: 'explore', phase: 'completed', params: { target: 'src/vue', actions: ['listFiles', 'search'] } }) },
          { type: 'tool', id: 'tool-edit-one', title: 'Edited attachment renderer', kind: 'command', status: 'completed', input: { changes: [{ path: '/mock/frontend.md' }, { path: '/mock/AppShell.vue' }, { path: '/mock/ChatComposer.vue' }, { path: '/mock/tool-status.ts' }] }, statusText: JSON.stringify({ source: 'codex', action: 'edit', phase: 'completed', params: { target: '4 files', addedLines: 31, removedLines: 26 } }) },
          { type: 'tool', id: 'tool-edit-two', title: 'Edited composer', kind: 'command', status: 'completed', statusText: JSON.stringify({ source: 'codex', action: 'edit', phase: 'completed', params: { target: 'ChatRichTextEditor.vue', addedLines: 97, removedLines: 70 } }) },
          { type: 'tool', id: 'tool-failed', title: 'Captured preview', kind: 'browser', status: 'failed', statusText: 'Browser was not open' },
          { type: 'text', text: 'I checked the screenshot and the relevant files.' },
        ],
      },
      { id: 'conversation-steer', kind: 'steer', role: 'user', status: 'complete', parts: [{ type: 'text', text: 'Focus on the attachment renderer first.' }] },
    ],
  },
  {
    id: 'completed-turns',
    name: 'Completed turns',
    summary: 'With and without a final answer',
    title: 'Completed turn comparison',
    description: 'Compare a collapsed turn with a final answer against work that remains direct when no summary exists.',
    messages: [
      { id: 'completed-turn-work', role: 'assistant', status: 'complete', turnId: 'completed-turn', parts: [
        { type: 'tool', id: 'completed-turn-tool', title: 'npm test', kind: 'command', status: 'completed', statusText: JSON.stringify({ source: 'codex', action: 'run', phase: 'completed', params: { target: 'npm test' } }) },
        { type: 'text', text: 'Started the verification.', phase: 'commentary' },
        { type: 'media', itemId: 'completed-turn-preview', media: { url: '/attachment-preview.svg', title: 'Generated turn preview', mimeType: 'image/svg+xml' } },
      ] },
      { id: 'completed-turn-steer-one', kind: 'steer', role: 'user', status: 'complete', turnId: 'completed-turn', parts: [
        { type: 'text', text: 'Check the shared disclosure too.' },
      ] },
      { id: 'completed-turn-work-two', role: 'assistant', status: 'complete', turnId: 'completed-turn', parts: [
        { type: 'text', text: 'Verified the disclosure behavior.', phase: 'commentary' },
      ] },
      { id: 'completed-turn-steer-two', kind: 'steer', role: 'user', status: 'complete', turnId: 'completed-turn', parts: [
        { type: 'text', text: 'Remove empty rows when done.' },
      ] },
      { id: 'completed-turn-answer', role: 'assistant', status: 'complete', turnId: 'completed-turn', parts: [
        { type: 'text', text: 'Checked the final layout.', phase: 'commentary' },
        { type: 'text', text: 'The completed turn is compact.', phase: 'final_answer' },
      ] },
      { id: 'no-summary-work', role: 'assistant', status: 'complete', turnId: 'no-summary-turn', parts: [
        { type: 'tool', id: 'no-summary-tool', title: 'npm test', kind: 'command', status: 'completed', statusText: JSON.stringify({ source: 'codex', action: 'run', phase: 'completed', params: { target: 'npm test' } }) },
        { type: 'text', text: 'Finished the verification.', phase: 'commentary' },
      ] },
      { id: 'no-summary-steer', kind: 'steer', role: 'user', status: 'complete', turnId: 'no-summary-turn', parts: [
        { type: 'text', text: 'Also check the docs.' },
      ] },
      { id: 'no-summary-work-two', role: 'assistant', status: 'complete', turnId: 'no-summary-turn', parts: [
        { type: 'text', text: 'The docs are current.', phase: 'commentary' },
      ] },
    ],
  },
  {
    id: 'long-history',
    name: 'Long history',
    summary: 'Submit and stream from a deep transcript',
    title: 'Long conversation',
    description: 'Scroll away from the tail, submit a prompt, and verify that the streamed response stays visible.',
    messages: Array.from({ length: 48 }, (_, index): SurfaceMessage[] => [
      {
        id: `history-user-${index}`, role: 'user', status: 'complete',
        parts: [{ type: 'text', text: `Earlier question ${index + 1}: explain the current state and next step.` }],
      },
      {
        id: `history-answer-${index}`, role: 'assistant', status: 'complete',
        parts: [{ type: 'text', phase: 'final_answer', text: `Earlier answer ${index + 1}: the work is progressing. This response gives the transcript enough height to exercise real scrolling.` }],
      },
    ]).flat(),
  },
  {
    id: 'message-selection',
    name: 'Message selection',
    summary: 'Opt-in selected text and host composer context',
    title: 'Select text from a message',
    description: 'Highlight text in the assistant response, add it as host-owned context, remove it, or submit it without typing.',
    messages: [
      {
        id: 'selection-user', role: 'user', status: 'complete', turnId: 'selection-turn',
        parts: [{ type: 'text', text: 'Review the proposed product direction.' }],
      },
      {
        id: 'selection-assistant', role: 'assistant', status: 'complete', turnId: 'selection-turn',
        parts: [{ type: 'text', text: 'The strongest part is the clear separation between reusable SDK mechanics and product-owned annotation behavior.', phase: 'final_answer' }],
      },
    ],
  },
  {
    id: 'goal-composer',
    name: 'Goal composer',
    summary: 'Pending command chip and required objective',
    title: 'Set a conversation goal',
    description: 'Choose Goal mode from + or type /goal, then enter an objective and submit the canonical command.',
    messages: [],
  },
  {
    id: 'requests',
    name: 'Approvals & questions',
    summary: 'Decisions, answers, and draft restoration',
    title: 'Approvals and questions',
    description: 'Choose a request below. Start with a draft and attachment to check restoration; complete an async turn to try its pending-question chip.',
    messages: Array.from({ length: 30 }, (_, index) => ({
      id: `request-history-${index}`, role: 'assistant' as const, status: 'complete' as const,
      parts: [{ type: 'text' as const, text: `Earlier result ${index + 1}. Requests stay in the composer area even when reading old messages.` }],
    })),
  },
  {
    id: 'tool-icons',
    name: 'Tool icon gallery',
    summary: 'Codex actions, a host override, and the generic fallback',
    title: 'Tool call icons and descriptions',
    description: 'Expand the tool group to compare every supported action icon and its completed label.',
    messages: [
      {
        id: 'tool-icons-user', role: 'user', status: 'complete', createdAt: '2026-08-01T12:05:00Z', parts: [
          { type: 'text', text: 'Exercise every tool call presentation.' },
        ],
      },
      {
        id: 'tool-icons-assistant', role: 'assistant', status: 'complete', createdAt: '2026-08-01T12:05:01Z', parts: [
          { type: 'tool', id: 'tool-create', title: 'create file', kind: 'command', status: 'completed', statusText: JSON.stringify({ source: 'codex', action: 'create', phase: 'completed', params: { target: 'src/vue/chat/ToolGallery.vue' } }) },
          { type: 'tool', id: 'tool-delete', title: 'delete file', kind: 'command', status: 'completed', statusText: JSON.stringify({ source: 'codex', action: 'delete', phase: 'completed', params: { target: 'src/vue/chat/LegacyTool.vue' } }) },
          { type: 'tool', id: 'tool-edit', title: 'edit file', kind: 'command', status: 'completed', statusText: JSON.stringify({ source: 'codex', action: 'edit', phase: 'completed', params: { target: 'src/vue/chat/ChatToolCall.vue', addedLines: 12, removedLines: 3 } }) },
          { type: 'tool', id: 'tool-explore-gallery', title: 'explore files', kind: 'command', status: 'completed', statusText: JSON.stringify({ source: 'codex', action: 'explore', phase: 'completed', params: { target: 'src/vue/chat' } }) },
          { type: 'tool', id: 'tool-list', title: 'list files', kind: 'command', status: 'completed', statusText: JSON.stringify({ source: 'codex', action: 'list', phase: 'completed', params: { target: 'src/vue/chat' } }) },
          { type: 'tool', id: 'tool-plan', title: 'update plan', kind: 'plan', status: 'completed', statusText: JSON.stringify({ source: 'codex', action: 'plan', phase: 'completed', params: { operation: 'update' } }) },
          { type: 'tool', id: 'tool-read', title: 'read file', kind: 'command', status: 'completed', statusText: JSON.stringify({ source: 'codex', action: 'read', phase: 'completed', params: { target: 'README.md' } }) },
          { type: 'tool', id: 'tool-run', title: 'run command', kind: 'command', status: 'completed', statusText: JSON.stringify({ source: 'codex', action: 'run', phase: 'completed', params: { target: '/bin/bash -lc "npm test && npm run typecheck && npm run build"' } }) },
          { type: 'tool', id: 'tool-search', title: 'search source', kind: 'search', status: 'completed', statusText: JSON.stringify({ source: 'codex', action: 'search', phase: 'completed', params: { target: 'registerCodexToolTitlePresenter' } }) },
          { type: 'tool', id: 'tool-browser', title: 'codex_claw.browser_open', kind: 'mcp', status: 'completed', statusText: 'completed', metadata: { server: 'codex_claw', tool: 'browser_open' } },
          { type: 'tool', id: 'tool-generic', title: 'Claw status sync', kind: 'generic', status: 'completed', statusText: 'Claw synchronization complete' },
          { type: 'text', text: 'Known Codex actions use SDK icons, the app-owned browser tool uses a provided icon, and unknown tools use the generic tool icon.' },
        ],
      },
    ],
  },
  {
    id: 'reasoning-activity',
    name: 'Reasoning activity',
    summary: 'Live reasoning titles become plain action counts',
    title: 'Reasoning-aware tool group',
    description: 'The latest app-server reasoning summary titles the active tool group, then disappears when commentary resumes.',
    activeTurnId: 'reasoning-activity-turn',
    turns: [{
      id: 'reasoning-activity-turn', status: 'inProgress', error: null, willRetry: false,
      startedAt: '2026-08-01T12:04:00Z', completedAt: null, durationMs: null,
    }],
    busy: true,
    messages: [{
      id: 'reasoning-activity-assistant',
      role: 'assistant',
      status: 'streaming',
      turnId: 'reasoning-activity-turn',
      parts: reasoningActivityParts('planning'),
    }],
  },
  {
    id: 'busy',
    name: 'Busy and queued',
    summary: 'Working state, queue, context, and diff shelf',
    title: 'Codex is working',
    description: 'A single active turn with generated media and two steers. Work stays expanded while the turn is active.',
    activeTurnId: 'turn-lab',
    turns: [{
      id: 'turn-lab', status: 'inProgress', error: null, willRetry: false,
      startedAt: '2026-08-01T12:00:00Z', completedAt: null, durationMs: null,
    }],
    busy: true,
    contextUsage: { totalTokens: 64_000, inputTokens: 48_000, cachedInputTokens: 8_000, outputTokens: 12_000, reasoningOutputTokens: 4_000, lastTotalTokens: 8_000, modelContextWindow: 200_000, usedPercent: 32 },
    queuedPrompts: [{ id: 'queued-1', text: 'Run the visual checks next' }],
    turnGitDiff: { turnId: 'turn-lab', addedLines: 42, removedLines: 7, updatedAt: '2026-08-01T12:00:00Z' },
    messages: [
      { id: 'busy-assistant', role: 'assistant', status: 'streaming', turnId: 'turn-lab', parts: [
        { type: 'tool', id: 'busy-completed-test', title: 'npm test', kind: 'command', status: 'completed', statusText: JSON.stringify({ source: 'codex', action: 'run', phase: 'completed', params: { target: 'npm test' } }) },
        { type: 'tool', id: 'busy-completed-read', title: 'README.md', kind: 'command', status: 'completed', statusText: JSON.stringify({ source: 'codex', action: 'read', phase: 'completed', params: { target: 'README.md' } }) },
        { type: 'tool', id: 'busy-running-search', title: 'Searching source files', kind: 'search', status: 'running', statusText: 'Finding composer code' },
        { type: 'tool', id: 'busy-running-build', title: 'npm run build', kind: 'command', status: 'running', statusText: JSON.stringify({ source: 'codex', action: 'run', phase: 'running', params: { target: 'npm run build' } }) },
        { type: 'text', text: 'Updating the composer and checking every interaction…', phase: 'commentary' },
        { type: 'media', itemId: 'busy-generated-preview', media: { url: '/attachment-preview.svg', title: 'Generated preview', mimeType: 'image/svg+xml' } },
        { type: 'text', text: 'Checking the generated preview before continuing…', phase: 'commentary' },
      ] },
      { id: 'busy-steer-one', kind: 'steer', role: 'user', status: 'complete', turnId: 'turn-lab', parts: [
        { type: 'text', text: 'Check the message-list boundary too.' },
      ] },
      { id: 'busy-assistant-two', role: 'assistant', status: 'streaming', turnId: 'turn-lab', parts: [
        { type: 'text', text: 'Keeping the same turn open while I inspect it.', phase: 'commentary' },
      ] },
      { id: 'busy-steer-two', kind: 'steer', role: 'user', status: 'complete', turnId: 'turn-lab', parts: [
        { type: 'text', text: 'Keep both steers in this turn.' },
      ] },
      { id: 'busy-assistant-three', role: 'assistant', status: 'streaming', turnId: 'turn-lab', parts: [
        { type: 'reasoning', itemId: 'busy-reasoning', summaryIndex: 0, summary: 'Verifying that one turn owns one shared disclosure.' },
      ] },
    ],
  },
  {
    id: 'interrupted-turn',
    name: 'Interrupted turn',
    summary: 'Stopped work that can continue after restart',
    title: 'Turn interrupted',
    description: 'The restored interrupted turn stays stopped until an empty submission starts a new provider turn.',
    activeTurnId: null,
    turns: [{
      id: 'interrupted-turn-old', status: 'interrupted', error: null, willRetry: false,
      startedAt: '2026-08-01T12:03:00Z', completedAt: '2026-08-01T12:03:05Z', durationMs: 5_000,
    }],
    messages: [{
      id: 'interrupted-turn-work',
      role: 'assistant',
      status: 'complete',
      turnId: 'interrupted-turn-old',
      parts: [{ type: 'text', text: 'Work completed before the app was stopped.', phase: 'commentary' }],
    }],
  },
  {
    id: 'empty',
    name: 'Empty and error',
    summary: 'Hero copy and recoverable error banner',
    title: 'Start a mocked conversation',
    description: 'This state verifies empty layouts and error placement.',
    error: 'Mock connection lost. The composer remains available for recovery testing.',
    messages: [],
  },
  {
    id: 'live-chat',
    name: 'Live chat',
    summary: 'Real microphone and Codex realtime V3',
    title: 'Bidirectional voice',
    description: 'WebRTC audio, live transcripts, and the normal conversation in one lab.',
    messages: [],
  },
];

const selectedId = ref('conversation');
const theme = ref<'light' | 'dark' | 'system'>('light');
const draft = ref('');
const activity = ref('Ready');
const messages = ref<SurfaceMessage[]>([]);
const mockBusy = ref(false);
const mockActiveTurnId = ref<string | null>(null);
const mockTurns = ref<readonly CodexSurfaceTurn[]>([]);
const clientRequests = ref<CodexSurfaceClientRequest[]>([]);
const approvals = ref<CodexSurfaceApproval[]>([]);
const questionFormat = ref<'choices' | 'text'>('choices');
const questionSteps = ref<'single' | 'multiple'>('single');
const questionDelivery = ref<'tool' | 'async'>('async');
const hasActiveAsyncQuestion = computed(() => messages.value.some((message) =>
  message.turnId === mockActiveTurnId.value && message.parts.some((part) =>
    part.type === 'question' && !answeredClientRequestIds.value.has(part.request.id))));
let requestSequence = 0;
const answeredClientRequestIds = ref<ReadonlySet<string>>(new Set());
const selectedMessageText = ref<CodexMessageTextSelection | null>(null);
const selectedMessageContexts = ref<CodexMessageTextSelection[]>([]);
const resetConfirmed = ref(false);
const resetRevision = ref(0);
const selected = computed<Scenario>(() => scenarios.find((scenario) => scenario.id === selectedId.value) ?? scenarios[0]);
const selectionActionStyle = computed(() => selectedMessageText.value ? {
  left: `${selectedMessageText.value.anchor.x}px`,
  top: `${selectedMessageText.value.anchor.y + selectedMessageText.value.anchor.height + 8}px`,
} : undefined);
const streamTimers = new Set<number>();
const mockAttachments = new Map<string, CodexNativeAttachment>();
let resetFeedbackTimer: number | undefined;

watch(selected, () => resetScenario(false), { immediate: true });

function resetScenario(confirmReset = true): void {
  resetRevision.value += 1;
  clearMockStream();
  clearResetFeedback();
  draft.value = '';
  messages.value = selected.value.messages.map((message) => ({ ...message, parts: [...message.parts] }));
  mockBusy.value = selected.value.busy ?? false;
  mockActiveTurnId.value = selected.value.activeTurnId ?? null;
  mockTurns.value = [...(selected.value.turns ?? [])];
  clientRequests.value = [];
  approvals.value = [];
  answeredClientRequestIds.value = new Set();
  selectedMessageText.value = null;
  selectedMessageContexts.value = [];
  activity.value = confirmReset ? 'Scenario reset' : 'Scenario loaded';
  if (confirmReset) showResetFeedback();
  if (selected.value.id === 'busy') startBusyToolCompletion();
  if (selected.value.id === 'reasoning-activity') startReasoningActivityLifecycle();
}

function addSelectedContext(): void {
  const selection = selectedMessageText.value;
  if (!selection) return;
  selectedMessageContexts.value = [...selectedMessageContexts.value, selection];
  selectedMessageText.value = null;
  window.getSelection()?.removeAllRanges();
  activity.value = 'Selected message text added as host context';
}

function removeSelectedContext(context: CodexMessageTextSelection): void {
  selectedMessageContexts.value = selectedMessageContexts.value.filter((candidate) => candidate !== context);
  activity.value = 'Selected message context removed';
}

function continueInterruptedTurn(): void {
  const latestTurn = mockTurns.value.at(-1);
  if (mockBusy.value || latestTurn?.status !== 'interrupted') return;
  const turnId = `${latestTurn.id}-continuation`;
  mockTurns.value = [
    ...mockTurns.value,
    {
      id: turnId, status: 'inProgress', error: null, willRetry: false,
      startedAt: new Date().toISOString(), completedAt: null, durationMs: null,
    },
  ];
  mockActiveTurnId.value = turnId;
  mockBusy.value = true;
  messages.value.push({
    id: `${turnId}-assistant`,
    role: 'assistant',
    status: 'streaming',
    turnId,
    parts: [{ type: 'text', text: 'Continuation started without a new prompt.', phase: 'commentary' }],
  });
  activity.value = 'Interrupted turn continued';
}

function completeAsyncQuestionTurn(): void {
  const turnId = mockActiveTurnId.value;
  if (!turnId) return;
  mockTurns.value = mockTurns.value.map((turn) => turn.id === turnId
    ? { ...turn, status: 'completed', completedAt: new Date().toISOString(), durationMs: 1_000 }
    : turn);
  messages.value = messages.value.map((message) => message.turnId === turnId
    ? { ...message, status: 'complete' }
    : message);
  mockActiveTurnId.value = null;
  mockBusy.value = false;
  activity.value = 'Turn completed; question moved to the composer chip';
}

function showResetFeedback(): void {
  resetConfirmed.value = true;
  resetFeedbackTimer = window.setTimeout(clearResetFeedback, 2_500);
}

function clearResetFeedback(): void {
  if (resetFeedbackTimer !== undefined) window.clearTimeout(resetFeedbackTimer);
  resetFeedbackTimer = undefined;
  resetConfirmed.value = false;
}

function requestCommandApproval(): void {
  approvals.value.push({
    id: `lab-approval-${++requestSequence}`, kind: 'command', conversationId: selectedId.value,
    itemId: `lab-command-${requestSequence}`, title: 'Allow this command?', command: 'npm test',
    description: 'Run the project tests.',
  });
}

function requestApproval(): void {
  const id = `lab-confirmation-${++requestSequence}`;
  const confirmation = {
    summary: 'Check for concurrent repo changes', integrationId: 'shell', integrationName: 'Shell',
    toolName: 'run', argumentsPreview: JSON.stringify({
      command: 'git status --short && git log --oneline -3',
      description: 'Check for concurrent repo changes',
    }, null, 2),
  };
  clientRequests.value.push({ id, kind: 'confirm_tool', conversationId: selectedId.value,
    turnId: id, itemId: id, payload: { confirmation } });
  messages.value.push({ id, role: 'assistant', status: 'streaming', turnId: id,
    parts: [{ type: 'tool', id, kind: 'mcp', title: 'shell.run', status: 'running',
      statusText: JSON.stringify({ source: 'mcp', action: 'confirm_tool', phase: 'running',
        params: { requestId: id, confirmationSummary: confirmation.summary,
          argumentsPreview: confirmation.argumentsPreview } }),
    }],
  });
}

function resolveApproval(id: string, decision: CodexSurfaceApprovalDecision): void {
  approvals.value = approvals.value.filter((approval) => approval.id !== id);
  activity.value = `Approval ${decision}`;
}

function requestQuestion(): void {
  const delivery = questionDelivery.value;
  const id = `lab-question-${++requestSequence}`;
  const turnId = `lab-request-turn-${requestSequence}`;
  const textQuestion = { id: `${id}-context`, header: 'What should I know before continuing?',
    question: 'What should I know before continuing?', isOther: false, isSecret: false, options: null };
  const questions: CodexSurfaceAskUserQuestion[] = questionFormat.value === 'text' ? [textQuestion] : [{
    id: `${id}-framework`, header: 'Framework', question: 'Which framework should I use?',
    isOther: true, isSecret: false, options: [
      { label: 'Vue', description: 'Use the SDK component package' },
      { label: 'React', description: 'Use a custom renderer' },
    ],
  }];
  if (questionSteps.value === 'multiple') questions.push({
    ...textQuestion, id: `${id}-details`, header: 'Context',
    question: questionFormat.value === 'text' ? 'Anything else I should know?' : textQuestion.question,
  });
  const request: Extract<CodexSurfaceClientRequest, { kind: 'ask_user' }> = {
    id, kind: 'ask_user', conversationId: selectedId.value, turnId, itemId: id,
    payload: { request: { itemId: id, delivery, blocking: delivery === 'tool', questions } },
  };
  mockActiveTurnId.value = turnId;
  mockBusy.value = true;
  mockTurns.value = [...mockTurns.value, { id: turnId, status: 'inProgress', error: null,
    willRetry: false, startedAt: new Date().toISOString(), completedAt: null, durationMs: null }];
  if (delivery === 'tool') {
    clientRequests.value.push(request);
    messages.value.push({ id, turnId, role: 'assistant', status: 'streaming',
      parts: [{ type: 'tool', id, kind: 'generic', title: 'ask_user_question', status: 'running',
        statusText: JSON.stringify({ source: 'codex', action: 'ask_user_question', phase: 'running',
          params: { requestId: id, questions } }),
      }],
    });
  }
  else messages.value.push({ id, turnId, role: 'assistant', status: 'streaming',
    parts: [{ type: 'question', request }] });
}

function respondToClientRequest(response: ClientRequestResponse): void {
  const requestTurnId = clientRequests.value.find((request) => request.id === response.id)?.turnId
    ?? messages.value.find((message) => message.parts.some((part) =>
      part.type === 'question' && part.request.id === response.id))?.turnId;
  answeredClientRequestIds.value = new Set([...answeredClientRequestIds.value, response.id]);
  clientRequests.value = clientRequests.value.filter((request) => request.id !== response.id);
  messages.value = messages.value.map((message) => ({ ...message,
    parts: message.parts.map((part) => part.type === 'tool' && part.id === response.id
      ? { ...part, status: 'completed', output: response.payload } : part),
  }));
  const answerText = Object.values(response.payload?.answers ?? {})
    .flatMap((answer) => answer.answers).filter(Boolean).join(', ');
  if (answerText) messages.value.push({
    id: 'mock-answer-' + messages.value.length, role: 'user', status: 'complete',
    turnId: requestTurnId, parts: [{ type: 'text', text: answerText }],
  });
  if (requestTurnId === mockActiveTurnId.value) {
    mockTurns.value = mockTurns.value.map((turn) => turn.id === requestTurnId
      ? { ...turn, status: 'completed', completedAt: new Date().toISOString(), durationMs: 1_000 } : turn);
    mockActiveTurnId.value = null;
    mockBusy.value = false;
  }
  activity.value = answerText ? 'Answered: ' + answerText : 'Request resolved';
}

function startBusyToolCompletion(): void {
  const timer = window.setTimeout(() => {
    streamTimers.delete(timer);
    messages.value = messages.value.map((message) => message.id === 'busy-assistant'
      ? {
          ...message,
          parts: message.parts.map((part) => part.type === 'tool' && part.id === 'busy-running-search'
            ? {
                ...part,
                status: 'completed',
                statusText: JSON.stringify({
                  source: 'codex',
                  action: 'search',
                  phase: 'completed',
                  params: { target: 'composer code' },
                }),
              }
            : part),
        }
      : message);
    activity.value = 'Quick search completed';
  }, 600);
  streamTimers.add(timer);
}

function startReasoningActivityLifecycle(): void {
  const inspectTimer = window.setTimeout(() => {
    streamTimers.delete(inspectTimer);
    updateReasoningActivity(reasoningActivityParts('inspecting'));
    activity.value = 'Reasoning title updated';
  }, 5_000);
  const commentaryTimer = window.setTimeout(() => {
    streamTimers.delete(commentaryTimer);
    updateReasoningActivity(reasoningActivityParts('commentary'));
    activity.value = 'Reasoning title cleared';
  }, 10_000);
  streamTimers.add(inspectTimer);
  streamTimers.add(commentaryTimer);
}

function updateReasoningActivity(parts: SurfaceMessagePart[]): void {
  messages.value = messages.value.map((message) => message.id === 'reasoning-activity-assistant'
    ? { ...message, parts }
    : message);
}

function reasoningActivityParts(stage: 'planning' | 'inspecting' | 'commentary'): SurfaceMessagePart[] {
  const parts: SurfaceMessagePart[] = [
    {
      type: 'reasoning',
      itemId: 'reasoning-activity-planning',
      summaryIndex: 0,
      summary: '**Planning targeted filename searches**',
    },
    {
      type: 'tool', id: 'reasoning-activity-read', title: 'Read settings view', kind: 'command', status: 'completed',
      statusText: JSON.stringify({ source: 'codex', action: 'read', phase: 'completed', params: { target: 'SettingsView.vue' } }),
    },
    {
      type: 'tool', id: 'reasoning-activity-search', title: 'Search source', kind: 'search', status: 'completed',
      statusText: JSON.stringify({ source: 'codex', action: 'search', phase: 'completed', params: { target: 'remote connection version' } }),
    },
    {
      type: 'tool', id: 'reasoning-activity-find', title: 'Find connection components', kind: 'search',
      status: stage === 'planning' ? 'running' : 'completed',
      statusText: JSON.stringify({
        source: 'codex', action: 'search', phase: stage === 'planning' ? 'running' : 'completed',
        params: { target: 'Remote Codex Claw agents' },
      }),
    },
  ];
  if (stage === 'planning') return parts;

  parts.push({
    type: 'reasoning',
    itemId: 'reasoning-activity-inspecting',
    summaryIndex: 0,
    summary: '**Inspecting component contract backend**',
  }, {
    type: 'tool', id: 'reasoning-activity-explore', title: 'Explore connection contracts', kind: 'command',
    status: stage === 'inspecting' ? 'running' : 'completed',
    statusText: JSON.stringify({
      source: 'codex', action: 'explore', phase: stage === 'inspecting' ? 'running' : 'completed',
      params: { target: 'core/src/contracts/connections.ts' },
    }),
  });
  if (stage === 'commentary') {
    parts.push({ type: 'text', text: 'The component contract is clear.', phase: 'commentary' });
  }
  return parts;
}

function submitPrompt(prompt: string, options?: CodexRendererSendMessageOptions): void {
  const contextText = selectedMessageContexts.value.length > 0
    ? `Selected message context:\n${selectedMessageContexts.value.map(({ text }) => `- ${text}`).join('\n')}`
    : '';
  const submittedPrompt = [prompt, contextText].filter(Boolean).join('\n\n');
  const attachmentParts: SurfaceMessagePart[] = (options?.attachments ?? []).map((attachment) => {
    const resolved = mockAttachments.get(attachment.reference);
    return {
      type: 'attachment',
      attachment: {
        kind: attachment.type,
        name: resolved?.name ?? attachment.reference.split(':').at(-1) ?? 'attachment',
        path: attachment.reference,
        ...(resolved?.mimeType ? { mimeType: resolved.mimeType } : {}),
        ...(attachment.type === 'image' && resolved?.previewUrl ? { url: resolved.previewUrl } : {}),
      },
    };
  });
  messages.value.push({
    id: `mock-user-${messages.value.length}`,
    role: 'user',
    status: 'complete',
    createdAt: new Date().toISOString(),
    parts: [{ type: 'text', text: submittedPrompt }, ...attachmentParts],
  });
  activity.value = `Submitted ${submittedPrompt.split('\n').length}-line prompt with ${attachmentParts.length} attachment(s)`;
  draft.value = '';
  selectedMessageContexts.value = [];
  startMockStream();
}

async function ingestMockAttachments(inputs: readonly CodexNativeAttachmentInput[]): Promise<CodexNativeAttachment[]> {
  return inputs.map((input, index) => {
    const attachment: CodexNativeAttachment = {
      id: `mock-attachment-${index}-${input.name}`,
      type: input.mimeType?.startsWith('image/') ? 'image' : 'file',
      reference: `mock-attachment:${index}:${input.name}`,
      name: input.name,
      mimeType: input.mimeType ?? 'application/octet-stream',
      size: input.data.byteLength,
      ...(input.mimeType?.startsWith('image/')
        ? { previewUrl: `data:${input.mimeType};base64,${arrayBufferToBase64(input.data)}` }
        : {}),
    };
    mockAttachments.set(attachment.reference, attachment);
    return attachment;
  });
}

function arrayBufferToBase64(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function startMockStream(turnId?: string): void {
  clearMockStream();
  mockBusy.value = true;
  const id = `mock-assistant-${messages.value.length}`;
  messages.value.push({
    id,
    role: 'assistant',
    status: 'streaming',
    turnId,
    parts: [{ type: 'text', text: '', phase: 'commentary' }],
  });
  const chunks = ['Mock response: ', 'the composer accepted the prompt ', 'and streamed this deterministic reply.'];
  let text = '';
  chunks.forEach((chunk, index) => {
    const timer = window.setTimeout(() => {
      streamTimers.delete(timer);
      text += selected.value.id === 'long-history' ? chunk.repeat(40) : chunk;
      const messageIndex = messages.value.findIndex((message) => message.id === id);
      if (messageIndex < 0) return;
      const currentMessage = messages.value[messageIndex];
      if (!currentMessage) return;
      messages.value[messageIndex] = {
        ...currentMessage,
        status: index === chunks.length - 1 ? 'complete' : 'streaming',
        parts: [{ type: 'text', text, phase: index === chunks.length - 1 ? 'final_answer' : 'commentary' }],
      };
      if (index === chunks.length - 1) {
        mockBusy.value = false;
        if (turnId) {
          mockActiveTurnId.value = null;
          mockTurns.value = mockTurns.value.map((turn) => turn.id === turnId
            ? { ...turn, status: 'completed', completedAt: new Date().toISOString(), durationMs: 1_000 }
            : turn);
        }
      }
      activity.value = index === chunks.length - 1 ? 'Mock stream completed' : 'Streaming mock response…';
    }, 300 * (index + 1));
    streamTimers.add(timer);
  });
}

function clearMockStream(): void {
  for (const timer of streamTimers) window.clearTimeout(timer);
  streamTimers.clear();
}

onBeforeUnmount(() => {
  clearMockStream();
  clearResetFeedback();
});
</script>
