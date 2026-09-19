<template>
  <ChatIconButton :disabled="disabled" :label="copied ? copiedLabel : label" @click="copy">
    <CheckIcon v-if="copied" />
    <CopyIcon v-else />
  </ChatIconButton>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { CheckIcon, CopyIcon } from '../icons/app-icons'
import ChatIconButton from './ChatIconButton.vue'

const props = defineProps<{
  action: () => Promise<void> | void
  copiedLabel: string
  disabled?: boolean
  label: string
}>()

const copied = ref(false)
let resetTimeout: ReturnType<typeof setTimeout> | null = null

async function copy() {
  await props.action()
  copied.value = true

  if (resetTimeout) clearTimeout(resetTimeout)
  resetTimeout = setTimeout(() => {
    copied.value = false
    resetTimeout = null
  }, 1_500)
}

onBeforeUnmount(() => {
  if (resetTimeout) clearTimeout(resetTimeout)
})
</script>
