<template>
  <main class="lab" :data-codex-theme="theme">
    <aside class="lab__sidebar">
      <div>
        <p class="lab__eyebrow">Codex App SDK</p>
        <h1>Component lab</h1>
        <p class="lab__intro">Mocked conversation states for visual and interaction testing.</p>
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

    <section class="lab__stage">
      <header class="lab__header">
        <div>
          <p class="lab__eyebrow">{{ selected.name }}</p>
          <h2>{{ selected.title }}</h2>
          <p>{{ selected.description }}</p>
        </div>
        <div class="lab__header-actions">
          <button
            v-if="selected.id === 'async-questions' && mockActiveTurnId"
            type="button"
            @click="completeAsyncQuestionTurn"
          >Complete turn</button>
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

      <div class="lab__frame">
        <CodexConversationPane
          :key="`${selected.id}:${resetRevision}`"
          v-model="draft"
          :active-turn-id="mockActiveTurnId"
          :answered-client-request-ids="answeredClientRequestIds"
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
import type { CodexSurfaceClientRequest, CodexSurfacePlugin, CodexSurfaceTurn } from '@codex-app-sdk/core/surface';

type Scenario = {
  id: string;
  name: string;
  summary: string;
  title: string;
  description: string;
  messages: SurfaceMessage[];
  clientRequests?: CodexSurfaceClientRequest[];
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
          { type: 'tool', id: 'tool-edit-one', title: 'Edited attachment renderer', kind: 'command', status: 'completed', input: { changes: [{ path: '/mock/frontend.md' }, { path: '/mock/AppShell.vue' }] }, statusText: JSON.stringify({ source: 'codex', action: 'edit', phase: 'completed', params: { target: '2 files', addedLines: 31, removedLines: 26 } }) },
          { type: 'tool', id: 'tool-edit-two', title: 'Edited composer', kind: 'command', status: 'completed', statusText: JSON.stringify({ source: 'codex', action: 'edit', phase: 'completed', params: { target: 'ChatRichTextEditor.vue', addedLines: 97, removedLines: 70 } }) },
          { type: 'tool', id: 'tool-failed', title: 'Captured preview', kind: 'browser', status: 'failed', statusText: 'Browser was not open' },
          { type: 'text', text: 'I checked the screenshot and the relevant files.' },
        ],
      },
      { id: 'conversation-steer', kind: 'steer', role: 'user', status: 'complete', parts: [{ type: 'text', text: 'Focus on the attachment renderer first.' }] },
    ],
  },
  {
    id: 'goal-composer',
    name: 'Goal composer',
    summary: 'Pending command chip and required objective',
    title: 'Set a conversation goal',
    description: 'Type /goal, choose Goal, enter an objective, and submit the canonical command.',
    messages: [],
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
    id: 'blocking-question',
    name: 'Blocking question',
    summary: 'Tool question replaces the composer',
    title: 'Codex needs an answer',
    description: 'A blocking app-server tool request should never squeeze into the transcript.',
    activeTurnId: 'blocking-question-turn',
    busy: true,
    turns: [{
      id: 'blocking-question-turn', status: 'inProgress', error: null, willRetry: false,
      startedAt: '2026-08-01T12:00:00Z', completedAt: null, durationMs: null,
    }],
    clientRequests: [{
      id: 'lab-blocking-request', kind: 'ask_user', conversationId: 'blocking-question',
      turnId: 'blocking-question-turn', itemId: 'lab-blocking-tool',
      payload: { request: { itemId: 'lab-blocking-tool', delivery: 'tool', blocking: true,
        questions: [{ id: 'layout', header: 'UI check',
          question: 'Does this blocking question replace the composer?',
          isOther: false, isSecret: false,
          options: [
            { label: 'Yes', description: 'The question appears once in the full-width composer area.' },
            { label: 'No', description: 'An inline card or the normal prompt composer is still visible.' },
          ],
        }],
      } },
    }],
    messages: [{
      id: 'blocking-question-message', role: 'assistant', status: 'streaming',
      turnId: 'blocking-question-turn',
      parts: [
        { type: 'text', text: 'Please check the question layout before I continue.', phase: 'commentary' },
        { type: 'tool', id: 'lab-blocking-tool', kind: 'generic', title: 'ask_user_question',
          status: 'running', statusText: JSON.stringify({ source: 'codex', action: 'ask_user_question',
            phase: 'running', params: { requestId: 'lab-blocking-request', questions: [{
              id: 'layout', header: 'UI check', question: 'Does this blocking question replace the composer?',
              isOther: false, isSecret: false, options: [
                { label: 'Yes', description: 'The question appears once in the full-width composer area.' },
                { label: 'No', description: 'An inline card or the normal prompt composer is still visible.' },
              ],
            }] },
          }), metadata: { requestId: 'lab-blocking-request' },
        },
      ],
    }],
  },
  {
    id: 'async-questions',
    name: 'Async questions',
    summary: 'Suggested answers and direct free text',
    title: 'Codex needs user input',
    description: 'Compare non-blocking questions with suggested answers and an immediately focused text field.',
    activeTurnId: 'async-question-turn',
    busy: true,
    turns: [{
      id: 'async-question-turn', status: 'inProgress', error: null, willRetry: false,
      startedAt: '2026-08-01T12:00:00Z', completedAt: null, durationMs: null,
    }],
    messages: [
      {
        id: 'async-question-message',
        role: 'assistant',
        status: 'streaming',
        turnId: 'async-question-turn',
        parts: [
          { type: 'text', text: 'I can continue once you choose a framework.', phase: 'commentary' },
          {
            type: 'question',
            request: {
              id: 'async-question:lab-agent-question',
              kind: 'ask_user',
              conversationId: 'async-questions',
              turnId: 'async-question-turn',
              itemId: 'lab-agent-question',
              payload: {
                request: {
                  itemId: 'lab-agent-question',
                  delivery: 'async',
                  blocking: false,
                  questions: [
                    {
                      id: '["request_user_input_async","lab-agent-question",0]',
                      header: 'Framework',
                      question: 'Which framework should I use?',
                      isOther: true,
                      isSecret: false,
                      options: [
                        { label: 'Vue', description: 'Use the SDK component package' },
                        { label: 'React', description: 'Use a custom renderer' },
                      ],
                    },
                    {
                      id: '["request_user_input_async","lab-agent-question",1]',
                      header: 'Context',
                      question: 'What should I know before continuing?',
                      isOther: true,
                      isSecret: false,
                      options: null,
                    },
                  ],
                },
              },
            },
          },
        ],
      },
    ],
  },
  {
    id: 'single-text-question',
    name: 'Single text question',
    summary: 'Free text without a header or progress',
    title: 'Codex needs user input',
    description: 'A standalone text question uses the same card without the multi-question chrome.',
    activeTurnId: 'single-text-turn',
    busy: true,
    turns: [{
      id: 'single-text-turn', status: 'inProgress', error: null, willRetry: false,
      startedAt: '2026-08-01T12:00:00Z', completedAt: null, durationMs: null,
    }],
    messages: [{
      id: 'single-text-message', role: 'assistant', status: 'streaming', turnId: 'single-text-turn',
      parts: [{ type: 'question', request: {
        id: 'lab-single-text-request', kind: 'ask_user', conversationId: 'single-text-question',
        turnId: 'single-text-turn', itemId: 'lab-single-text-item',
        payload: { request: {
          itemId: 'lab-single-text-item', delivery: 'async', blocking: false,
          questions: [{
            id: 'lab-single-text-answer',
            header: 'What should I know before continuing?',
            question: 'What should I know before continuing?',
            isOther: false, isSecret: false, options: null,
          }],
        } },
      } }],
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
    id: 'empty',
    name: 'Empty and error',
    summary: 'Hero copy and recoverable error banner',
    title: 'Start a mocked conversation',
    description: 'This state verifies empty layouts and error placement.',
    error: 'Mock connection lost. The composer remains available for recovery testing.',
    messages: [],
  },
];

const selectedId = ref(scenarios[0].id);
const theme = ref<'light' | 'dark' | 'system'>('light');
const draft = ref('');
const activity = ref('Ready');
const messages = ref<SurfaceMessage[]>([]);
const mockBusy = ref(false);
const mockActiveTurnId = ref<string | null>(null);
const mockTurns = ref<readonly CodexSurfaceTurn[]>([]);
const clientRequests = ref<CodexSurfaceClientRequest[]>([]);
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
  clientRequests.value = [...(selected.value.clientRequests ?? [])];
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
  if (selected.value.id !== 'async-questions' || !turnId) return;
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

function respondToClientRequest(response: ClientRequestResponse): void {
  answeredClientRequestIds.value = new Set([...answeredClientRequestIds.value, response.id]);
  if (selected.value.id === 'blocking-question') {
    const answers = response.payload?.answers ?? {};
    clientRequests.value = clientRequests.value.filter((request) => request.id !== response.id);
    messages.value = messages.value.map((message) => ({ ...message, status: 'complete',
      parts: message.parts.map((part) => part.type === 'tool' && part.id === 'lab-blocking-tool'
        ? { ...part, status: 'completed', output: { answers } } as SurfaceMessagePart
        : part),
    }));
    mockTurns.value = mockTurns.value.map((turn) => ({ ...turn, status: 'completed',
      completedAt: new Date().toISOString(), durationMs: 1_000 }));
    mockActiveTurnId.value = null;
    mockBusy.value = false;
    activity.value = 'Blocking question answered';
    return;
  }
  const requestTurnId = messages.value.flatMap((message) => message.parts)
    .flatMap((part) => part.type === 'question' && part.request.id === response.id
      ? [part.request.turnId]
      : [])
    .at(0);
  const answers = response.payload?.answers ?? {};
  const answerText = Object.values(answers)
    .flatMap((answer) => answer.answers)
    .filter(Boolean)
    .join(', ');
  const answeringActiveTurn = Boolean(requestTurnId && mockActiveTurnId.value === requestTurnId);
  const answerTurnId = answeringActiveTurn && requestTurnId
    ? requestTurnId
    : `mock-answer-turn-${messages.value.length}`;
  if (answerText) {
    if (!answeringActiveTurn) {
      mockTurns.value = [...mockTurns.value, {
        id: answerTurnId, status: 'inProgress', error: null, willRetry: false,
        startedAt: new Date().toISOString(), completedAt: null, durationMs: null,
      }];
      mockActiveTurnId.value = answerTurnId;
    }
    messages.value.push({
      id: `mock-answer-${messages.value.length}`,
      kind: answeringActiveTurn ? 'steer' : undefined,
      role: 'user',
      status: 'complete',
      turnId: answerTurnId,
      createdAt: new Date().toISOString(),
      parts: [{ type: 'text', text: answerText }],
    });
  }
  activity.value = answerText ? `Answered: ${answerText}` : 'Question dismissed';
  if (answerText) startMockStream(answerTurnId);
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
      text += chunk;
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
