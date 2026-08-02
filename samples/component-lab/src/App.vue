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
        <button type="button" @click="resetScenario">Reset scenario</button>
      </header>

      <div class="lab__frame">
        <CodexConversationPane
          v-model="draft"
          :busy="selected.busy"
          :context-usage="selected.contextUsage"
          :conversation-key="selected.id"
          :empty-description="selected.description"
          :empty-title="selected.title"
          :error="selected.error"
          :files="files"
          :ingest-attachments="ingestMockAttachments"
          :messages="messages"
          :models="models"
          :plan-mode="false"
          :plugins="plugins"
          :queued-prompts="selected.queuedPrompts"
          :selected-model-id="models[0].id"
          selected-reasoning-effort="medium"
          :skills="skills"
          :turn-git-diff="selected.turnGitDiff"
          @interrupt="activity = 'Interrupt requested'"
          @submit="submitPrompt"
        />
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
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import {
  CodexConversationPane,
  type CodexContextUsage,
  type CodexModelOption,
  type CodexNativeAttachment,
  type CodexNativeAttachmentInput,
  type CodexQueuedPromptData,
  type CodexSkillSummary,
  type SendCodexMessageOptions,
  type SurfaceMessage,
  type SurfaceMessagePart,
  type TurnGitDiff,
} from 'codex-app-sdk/vue';
import type { CodexSurfacePlugin } from 'codex-app-sdk/surface';

type Scenario = {
  id: string;
  name: string;
  summary: string;
  title: string;
  description: string;
  messages: SurfaceMessage[];
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
  isDefault: true,
}];

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
          { type: 'tool', id: 'tool-edit-one', title: 'Edited attachment renderer', kind: 'command', status: 'completed', statusText: JSON.stringify({ source: 'codex', action: 'edit', phase: 'completed', params: { target: '2 files', addedLines: 31, removedLines: 26 } }) },
          { type: 'tool', id: 'tool-edit-two', title: 'Edited composer', kind: 'command', status: 'completed', statusText: JSON.stringify({ source: 'codex', action: 'edit', phase: 'completed', params: { target: 'ChatRichTextEditor.vue', addedLines: 97, removedLines: 70 } }) },
          { type: 'tool', id: 'tool-failed', title: 'Captured preview', kind: 'browser', status: 'failed', statusText: 'Browser was not open' },
          { type: 'text', text: 'I checked the screenshot and the relevant files.' },
        ],
      },
      { id: 'conversation-steer', kind: 'steer', role: 'user', status: 'complete', parts: [{ type: 'text', text: 'Focus on the attachment renderer first.' }] },
    ],
  },
  {
    id: 'busy',
    name: 'Busy and queued',
    summary: 'Working state, queue, context, and diff shelf',
    title: 'Codex is working',
    description: 'Type a follow-up to exercise queue submission and the interrupt button.',
    busy: true,
    contextUsage: { totalTokens: 64_000, inputTokens: 48_000, cachedInputTokens: 8_000, outputTokens: 12_000, reasoningOutputTokens: 4_000, lastTotalTokens: 8_000, modelContextWindow: 200_000, usedPercent: 32 },
    queuedPrompts: [{ id: 'queued-1', text: 'Run the visual checks next' }],
    turnGitDiff: { turnId: 'turn-lab', addedLines: 42, removedLines: 7, updatedAt: '2026-08-01T12:00:00Z' },
    messages: [{ id: 'busy-assistant', role: 'assistant', status: 'streaming', parts: [
      { type: 'tool', id: 'tool-running', title: 'Searching source files', kind: 'search', status: 'running', statusText: 'Finding composer code' },
      { type: 'text', text: 'Updating the composer and checking every interaction…', phase: 'commentary' },
    ] }],
  },
  {
    id: 'tool-icons',
    name: 'Tool icon gallery',
    summary: 'Every Codex action and the generic fallback',
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
          { type: 'tool', id: 'tool-run', title: 'run command', kind: 'command', status: 'completed', statusText: JSON.stringify({ source: 'codex', action: 'run', phase: 'completed', params: { target: 'npm test' } }) },
          { type: 'tool', id: 'tool-search', title: 'search source', kind: 'search', status: 'completed', statusText: JSON.stringify({ source: 'codex', action: 'search', phase: 'completed', params: { target: 'registerCodexToolTitlePresenter' } }) },
          { type: 'tool', id: 'tool-generic', title: 'Claw status sync', kind: 'generic', status: 'completed', statusText: 'Claw synchronization complete' },
          { type: 'text', text: 'Every known Codex action uses a distinct icon; app-specific and unknown tools use the generic tool icon.' },
        ],
      },
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
const selected = computed<Scenario>(() => scenarios.find((scenario) => scenario.id === selectedId.value) ?? scenarios[0]);
const streamTimers = new Set<number>();

watch(selected, resetScenario, { immediate: true });

function resetScenario(): void {
  clearMockStream();
  draft.value = '';
  messages.value = selected.value.messages.map((message) => ({ ...message, parts: [...message.parts] }));
  activity.value = 'Scenario reset';
}

function submitPrompt(prompt: string, options?: SendCodexMessageOptions): void {
  const attachmentParts: SurfaceMessagePart[] = (options?.attachments ?? []).map((attachment) => ({
    type: 'attachment',
    attachment: {
      kind: attachment.type,
      name: attachment.name ?? attachment.path.split('/').at(-1) ?? 'attachment',
      path: attachment.path,
      ...(attachment.mimeType ? { mimeType: attachment.mimeType } : {}),
      ...(attachment.type === 'image' && attachment.previewUrl ? { url: attachment.previewUrl } : {}),
    },
  }));
  messages.value.push({
    id: `mock-user-${messages.value.length}`,
    role: 'user',
    status: 'complete',
    createdAt: new Date().toISOString(),
    parts: [{ type: 'text', text: prompt }, ...attachmentParts],
  });
  activity.value = `Submitted ${prompt.split('\n').length}-line prompt with ${attachmentParts.length} attachment(s)`;
  draft.value = '';
  startMockStream();
}

async function ingestMockAttachments(inputs: readonly CodexNativeAttachmentInput[]): Promise<CodexNativeAttachment[]> {
  return inputs.map((input, index) => ({
    id: `mock-attachment-${index}-${input.name}`,
    type: input.mimeType?.startsWith('image/') ? 'image' : 'file',
    path: `/mock/clipboard/${input.name}`,
    name: input.name,
    mimeType: input.mimeType ?? 'application/octet-stream',
    size: input.data.byteLength,
    ...(input.mimeType?.startsWith('image/')
      ? { previewUrl: `data:${input.mimeType};base64,${arrayBufferToBase64(input.data)}` }
      : {}),
  }));
}

function arrayBufferToBase64(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function startMockStream(): void {
  clearMockStream();
  const id = `mock-assistant-${messages.value.length}`;
  messages.value.push({
    id,
    role: 'assistant',
    status: 'streaming',
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
      activity.value = index === chunks.length - 1 ? 'Mock stream completed' : 'Streaming mock response…';
    }, 300 * (index + 1));
    streamTimers.add(timer);
  });
}

function clearMockStream(): void {
  for (const timer of streamTimers) window.clearTimeout(timer);
  streamTimers.clear();
}

onBeforeUnmount(clearMockStream);
</script>
