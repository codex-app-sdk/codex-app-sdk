import type { ComputedRef, InjectionKey, Ref } from 'vue'
import type { CodexSurfaceTurnStatus } from '@codex-app-sdk/core/surface'
import type { ClientRequestResponse } from './contracts'

export const questionResponsesKey: InjectionKey<Map<string, ClientRequestResponse['payload']>> = Symbol('codex-app-sdk-question-responses')

export type AssistantWorkTurnContext = {
  active: ComputedRef<boolean>
  completedWithoutFinal: ComputedRef<boolean>
  enabled: ComputedRef<boolean>
  expanded: Ref<boolean>
  finalStarted: ComputedRef<boolean>
  headerMessageIndex: ComputedRef<number | undefined>
  latestStreamingAssistantIndex: ComputedRef<number | undefined>
  phased: ComputedRef<boolean>
  status: ComputedRef<CodexSurfaceTurnStatus | undefined>
  turnId: ComputedRef<string | undefined>
  toggle: () => void
}

export const assistantWorkTurnKey: InjectionKey<AssistantWorkTurnContext> = Symbol('codex-app-sdk-assistant-work-turn')
export const assistantWorkMessageIndexKey: InjectionKey<ComputedRef<number>> = Symbol('codex-app-sdk-assistant-work-message-index')
