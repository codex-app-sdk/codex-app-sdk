import type { ComputedRef, InjectionKey, Ref } from 'vue'

export type AssistantWorkTurnContext = {
  active: ComputedRef<boolean>
  completedWithoutFinal: ComputedRef<boolean>
  enabled: ComputedRef<boolean>
  expanded: Ref<boolean>
  finalStarted: ComputedRef<boolean>
  headerMessageIndex: ComputedRef<number | undefined>
  latestStreamingAssistantIndex: ComputedRef<number | undefined>
  phased: ComputedRef<boolean>
  turnId: ComputedRef<string | undefined>
  toggle: () => void
}

export const assistantWorkTurnKey: InjectionKey<AssistantWorkTurnContext> = Symbol('codex-assistant-work-turn')
export const assistantWorkMessageIndexKey: InjectionKey<ComputedRef<number>> = Symbol('codex-assistant-work-message-index')
