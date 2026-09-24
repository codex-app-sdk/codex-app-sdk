import type { SurfaceMessage } from '@codex-app-sdk/core/surface'
import { computeMessageBlocks } from './message-blocks'
import { chatMessageFromInput } from './renderer-message-adapter'
import type { Message, MessageToolCall } from './types'

/** Return false to hide a tool call from the rendered transcript only. */
export type CodexToolVisibility = (toolCall: MessageToolCall) => boolean

export function filterVisibleMessageTools(
  message: Message | SurfaceMessage,
  visibility: CodexToolVisibility | undefined,
): Message | SurfaceMessage | null {
  if (!visibility) return message

  const adapted = chatMessageFromInput(message)
  const decisions = new Map<string, boolean>()
  const isVisible = (toolCall: MessageToolCall) => {
    if (!decisions.has(toolCall.id)) decisions.set(toolCall.id, visibility(toolCall))
    return decisions.get(toolCall.id)!
  }
  const toolCalls = adapted.toolCalls?.filter(isVisible)
  const parts = adapted.parts?.filter((part) => part.type !== 'tool' || isVisible(part.toolCall))
  if (toolCalls?.length === adapted.toolCalls?.length && parts?.length === adapted.parts?.length) {
    return message
  }

  const filtered = { ...adapted, parts, toolCalls }
  return computeMessageBlocks(filtered).length > 0 ? filtered : null
}
