<template>
  <section class="codex-chat-theme chat-html-block">
    <header class="chat-html-block__header">
      <span class="chat-html-block__title">{{ title || t('chat.html.title') }}</span>
      <span v-if="!complete" class="chat-html-block__status">{{ t('chat.html.streaming') }}</span>
      <div class="chat-html-block__actions">
        <ChatIconButton :label="t(showSource ? 'chat.html.preview' : 'chat.html.source')" @click="showSource = !showSource">
          <EyeIcon v-if="showSource" /><CodeIcon v-else />
        </ChatIconButton>
        <ChatCopyButton :action="copy" :label="t('chat.code.copy')" :copied-label="t('chat.code.copied')" />
        <ChatIconButton :label="t('chat.html.download')" @click="download"><Download /></ChatIconButton>
      </div>
    </header>
    <div class="chat-html-block__viewport">
      <iframe
        v-show="!showSource"
        :key="revision"
        ref="frame"
        :srcdoc="htmlPreviewDocument"
        :title="title || t('chat.html.title')"
        sandbox="allow-scripts"
        referrerpolicy="no-referrer"
      />
      <pre v-if="showSource"><code>{{ source }}</code></pre>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { CodeIcon, Download, EyeIcon } from '../icons/app-icons'
import { useCodexHostCapabilities } from '../native-capabilities'
import ChatIconButton from './ChatIconButton.vue'
import ChatCopyButton from './ChatCopyButton.vue'
import { useCodexChatTranslate } from './chat-i18n'
import { copyTextToClipboard } from './message-actions'
import { htmlPreviewDocument } from './html-preview-document'

const props = defineProps<{ source: string; title?: string; complete: boolean }>()
const t = useCodexChatTranslate()
const host = useCodexHostCapabilities()
const frame = ref<HTMLIFrameElement>()
const showSource = ref(false)
const revision = ref(0)
let channel: MessageChannel | undefined
let ready = false
let sent = ''
let closed = false
const downloads = new Map<string, ReturnType<typeof setTimeout>>()

function disconnect() {
  channel?.port1.close()
  channel?.port2.close()
  channel = undefined
  ready = false
}

function flush() {
  if (!props.source.startsWith(sent) || (closed && props.source !== sent)) {
    disconnect()
    sent = ''
    closed = false
    revision.value += 1
    return
  }
  if (!ready || closed) return
  channel!.port1.postMessage({ chunk: props.source.slice(sent.length), complete: props.complete })
  sent = props.source
  closed = props.complete
}

function connect(event: MessageEvent) {
  if (event.source !== frame.value?.contentWindow || event.data !== 'codex-html-ready' || channel) return
  channel = new MessageChannel()
  // A transferred port ties subsequent chunks to this document. If generated
  // code navigates its frame, we never send the remaining source to that URL.
  frame.value!.contentWindow!.postMessage('codex-html-connect', { targetOrigin: '*', transfer: [channel.port2] })
  // MessagePort queues packets until the child installs its handler.
  ready = true
  flush()
}

function copy() { return copyTextToClipboard(props.source, host) }

function download() {
  const url = URL.createObjectURL(new Blob([props.source], { type: 'text/html' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'preview.html'
  link.click()
  downloads.set(url, setTimeout(() => { URL.revokeObjectURL(url); downloads.delete(url) }, 1_000))
}

watch(() => [props.source, props.complete], flush)
onMounted(() => window.addEventListener('message', connect))
onBeforeUnmount(() => {
  window.removeEventListener('message', connect)
  disconnect()
  for (const [url, timer] of downloads) { clearTimeout(timer); URL.revokeObjectURL(url) }
})
</script>

<style scoped>
.chat-html-block {
  overflow: hidden;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}
.chat-html-block__header {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-3) var(--space-6);
  border-bottom: 1px solid var(--color-border);
}
.chat-html-block__title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--font-size-14);
  font-weight: var(--font-weight-medium);
}
.chat-html-block__status { color: var(--color-text-muted); font-size: var(--font-size-12); }
.chat-html-block__actions { display: flex; gap: var(--space-2); margin-left: auto; }
.chat-html-block__viewport { height: 360px; min-height: 160px; resize: vertical; overflow: auto; }
iframe { display: block; width: 100%; height: 100%; border: 0; background: white; }
pre { box-sizing: border-box; margin: 0; height: 100%; padding: var(--space-6); overflow: auto; font-size: var(--font-size-13); }
</style>
