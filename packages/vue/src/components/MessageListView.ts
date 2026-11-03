import { defineComponent, h, ref, type Component, type PropType, type Slots, type Slot } from 'vue'
import CodexMessageList from './CodexMessageList.vue'

const messageSlots: Record<string, string> = {
  message: 'message', actions: 'message-actions', attachment: 'message-attachment',
  block: 'message-block', header: 'message-header', mention: 'mention',
  status: 'message-status', text: 'message-text', thinking: 'message-thinking', tool: 'message-tool',
}

// Preserve the host's slot functions instead of creating a fresh forwarding
// closure per slot on every token. This component adds no DOM or public API.
export default defineComponent({
  inheritAttrs: false,
  props: { sourceSlots: { type: Object as PropType<Slots>, required: true } },
  setup(props, { attrs, expose }) {
    const list = ref<InstanceType<typeof CodexMessageList> | null>(null)
    expose({ scrollToBottom: () => list.value?.scrollToBottom() })
    let previous: Record<string, Slot> = {}
    return () => {
      const next: Record<string, Slot> = {}
      for (const [target, source] of Object.entries(messageSlots)) {
        const slot = props.sourceSlots[source]
        if (slot) next[target] = slot
      }
      const keys = Object.keys(next)
      if (keys.length !== Object.keys(previous).length || keys.some(key => next[key] !== previous[key])) previous = next
      return h(CodexMessageList as Component, { ...attrs, ref: list }, previous)
    }
  },
})
