import { getMessageToolCallArgs, getMessageToolCallName, type Message, type MessageAttachment, type MessageMedia, type MessagePhase, type MessageToolCall, type MessagePart } from './types'

type PhasedMessageBlock = {
  phase?: MessagePhase
}

export type MessageBlock =
  | { type: 'attachment'; attachment: MessageAttachment }
  | Extract<MessagePart, { type: 'question' }>
  | ({ type: 'text'; content: string } & PhasedMessageBlock)
  | { type: 'user-text'; content: string }
  | ({ type: 'reasoning'; content: string } & PhasedMessageBlock)
  | ({ type: 'mermaid'; code: string } & PhasedMessageBlock)
  | ({ type: 'visualization'; path?: string; title: string } & PhasedMessageBlock)
  | ({ type: 'media'; media: MessageMedia; toolCall?: MessageToolCall } & PhasedMessageBlock)
  | { type: 'tool'; toolCall: MessageToolCall }
  | { type: 'tool-group'; toolCalls: MessageToolCall[] }
  | ({ type: 'follow-ups'; prompts: string[] } & PhasedMessageBlock)

export type RenderedMessageBlock = MessageBlock | {
  type: 'work-group'
  active: boolean
  blocks: MessageBlock[]
  continuation?: boolean
  finalStarted: boolean
}

type CodeBlockRange = {
  start: number
  end: number
}

const toolTagRegex = /<tool\s+(id|index)="([^"]*)"><\/tool>/g
const markdownImageRegex = /(?<!\[)!\[([^\]]*)\]\(([^)\s]+)(?:\s+["']([^"']*)["'])?\)/g
const contextTagRegex = /<context>[\s\S]*?<\/context>\s*/g
const inAppBrowserContextTagRegex = /<in-app-browser-context(?:\s+[^>]*)?>[\s\S]*?<\/in-app-browser-context>\s*/g
const ambientRequestHeadingRegex = /^[ \t]*## My request for Codex:[ \t]*(?:\r?\n|$)/m
const followUpTagRegex = /<follow-up>([\s\S]*?)<\/follow-up>/g
const visualizationAnnotationRegex = /\uE200visualize\uE202([\s\S]*?)\uE201/g
const ungroupedToolNames = new Set([
  'ask_user_question',
])

export function computeMessageBlocks(message: Message): MessageBlock[] {
  if (message.role !== 'assistant') {
    if ((message.parts?.length ?? 0) > 0) {
      return message.parts!.flatMap((part): MessageBlock[] => {
        if (part.type === 'attachment') {
          return [{ type: 'attachment', attachment: part.attachment }]
        }
        if (part.type === 'media') {
          return [{ type: 'media', media: part.media }]
        }
        if (part.type === 'text') {
          const content = stripMessageContext(part.content)
          return content ? [{ type: 'user-text', content }] : []
        }
        return []
      })
    }

    const content = stripMessageContext(message.content)
    return content ? [{ type: 'user-text', content }] : []
  }

  const toolCalls = message.toolCalls ?? []
  const parts = message.parts ?? []
  if (parts.length > 0) {
    return computeMessageBlocksFromParts(parts, toolCalls)
  }

  const anchoredToolCallIds = new Set<string>()
  const { blocks, prompts } = parseTextBlocks(message.content, toolCalls, anchoredToolCallIds)

  appendUnanchoredTools(blocks, toolCalls, anchoredToolCallIds)
  return finalizeAssistantBlocks(blocks, prompts)
}

export function groupAssistantWorkBlocks(
  message: Message,
  blocks: MessageBlock[],
  workActive = message.streaming === true,
  groupWork = hasExplicitAssistantWorkPhases(message),
  answeredClientRequestIds?: ReadonlySet<string>,
): RenderedMessageBlock[] {
  if (message.role !== 'assistant' || !groupWork) return blocks

  const finalStarted = message.parts?.some((part) => (
    part.type === 'text' && part.phase === 'final_answer' && part.content.trim().length > 0
  )) ?? false
  const rendered: RenderedMessageBlock[] = []
  let workBlocks: MessageBlock[] = []
  let workGroupCount = 0
  const flushWork = () => {
    if (workBlocks.length === 0) return
    rendered.push({
      type: 'work-group',
      active: workActive && !finalStarted,
      blocks: workBlocks,
      ...(workGroupCount > 0 ? { continuation: true } : {}),
      finalStarted,
    })
    workBlocks = []
    workGroupCount += 1
  }

  for (const block of blocks) {
    if (isAssistantWorkBlock(block, answeredClientRequestIds)) {
      workBlocks.push(block)
      continue
    }
    flushWork()
    rendered.push(block)
  }
  flushWork()
  return workGroupCount > 0 ? rendered : blocks
}

function computeMessageBlocksFromParts(parts: MessagePart[], toolCalls: MessageToolCall[]): MessageBlock[] {
  const blocks: MessageBlock[] = []
  const prompts: string[] = []
  const anchoredToolCallIds = new Set<string>()

  for (const [index, part] of parts.entries()) {
    if (part.type === 'tool') {
      anchoredToolCallIds.add(part.toolCall.id)
      blocks.push({ type: 'tool', toolCall: part.toolCall })
      continue
    }

    if (part.type === 'attachment') {
      blocks.push({ type: 'attachment', attachment: part.attachment })
      continue
    }

    if (part.type === 'media') {
      blocks.push({ type: 'media', media: part.media })
      continue
    }

    if (part.type === 'reasoning') {
      if (part.summary.trim()) {
        blocks.push({ type: 'reasoning', content: part.summary, phase: 'commentary' })
      }
      continue
    }

    if (part.type === 'question') {
      blocks.push({ type: 'question', request: part.request })
      continue
    }

    const nextPart = parts[index + 1]
    if (nextPart?.type === 'question'
      && nextPart.request.payload.request.questions.some((question) => question.question.trim() === part.content.trim())) {
      continue
    }

    const parsed = parseTextBlocks(part.content, toolCalls, anchoredToolCallIds, part.phase)
    blocks.push(...parsed.blocks)
    prompts.push(...parsed.prompts)
  }

  appendUnanchoredTools(blocks, toolCalls, anchoredToolCallIds)
  return finalizeAssistantBlocks(blocks, prompts)
}

function parseTextBlocks(
  rawContent: string,
  toolCalls: MessageToolCall[],
  anchoredToolCallIds: Set<string>,
  phase?: MessagePhase,
) {
  const { content, prompts } = extractFollowUps(completeStreamingCustomTags(rawContent))
  const codeBlocks = findCodeBlocks(content)
  const blocks: MessageBlock[] = []
  let lastIndex = 0

  for (const item of findSpecialBlocks(content, codeBlocks)) {
    if (item.start > lastIndex) {
      pushTextBlock(blocks, content.slice(lastIndex, item.start), phase)
    }

    if (item.type === 'mermaid') {
      blocks.push({ type: 'mermaid', code: item.code, ...(phase ? { phase } : {}) })
    } else if (item.type === 'visualization') {
      blocks.push({
        type: 'visualization',
        title: item.title,
        ...(item.path ? { path: item.path } : {}),
        ...(phase ? { phase } : {}),
      })
    } else if (item.type === 'tool') {
      const toolCall = findToolCall(item.kind, item.value, toolCalls)
      if (toolCall) {
        anchoredToolCallIds.add(toolCall.id)
        blocks.push({ type: 'tool', toolCall })
      }
    } else {
      const toolCall = findMediaToolCall(item.media, toolCalls)
      if (toolCall) {
        anchoredToolCallIds.add(toolCall.id)
      }
      blocks.push({
        type: 'media',
        media: {
          ...item.media,
          prompt: item.media.prompt ?? getToolCallPrompt(toolCall),
        },
        toolCall,
        ...(phase ? { phase } : {}),
      })
    }

    lastIndex = item.end
  }

  if (lastIndex < content.length) {
    pushTextBlock(blocks, content.slice(lastIndex), phase)
  }

  return { blocks, prompts }
}

function appendUnanchoredTools(blocks: MessageBlock[], toolCalls: MessageToolCall[], anchoredToolCallIds: Set<string>) {
  for (const toolCall of toolCalls) {
    if (!anchoredToolCallIds.has(toolCall.id)) {
      blocks.push({ type: 'tool', toolCall })
    }
  }
}

function finalizeAssistantBlocks(blocks: MessageBlock[], prompts: string[]): MessageBlock[] {
  const grouped = groupToolBlocks(blocks)
  if (prompts.length > 0) {
    grouped.push({ type: 'follow-ups', prompts })
  }

  return grouped
}

export function stripMessageContext(content: string) {
  const withoutContext = content.replace(contextTagRegex, '')
  const withoutBrowserContext = withoutContext.replace(inAppBrowserContextTagRegex, '')
  return (withoutBrowserContext === withoutContext
    ? withoutBrowserContext
    : withoutBrowserContext.replace(ambientRequestHeadingRegex, ''))
    .trim()
}

export function groupToolBlocks(blocks: MessageBlock[]): MessageBlock[] {
  const result: MessageBlock[] = []
  let toolGroup: MessageToolCall[] = []

  const flushGroup = () => {
    if (toolGroup.length === 0) {
      return
    }

    result.push({ type: 'tool-group', toolCalls: [...toolGroup] })
    toolGroup = []
  }

  for (const block of blocks) {
    if (block.type === 'tool') {
      if (isUngroupedTool(block.toolCall)) {
        flushGroup()
        result.push(block)
        continue
      }

      toolGroup.push(block.toolCall)
      continue
    }

    flushGroup()
    result.push(block)
  }

  flushGroup()
  return result
}

function isUngroupedTool(toolCall: MessageToolCall) {
  if (ungroupedToolNames.has(getMessageToolCallName(toolCall))) {
    return true
  }

  const status = parseToolStatus(toolCall.status)
  if (status?.source === 'codex' && status.action === 'plan') {
    return true
  }

  return (status?.source === 'mcp' || status?.source === 'home') &&
    typeof status.params?.requestId === 'string' &&
    toolCall.state === 'running'
}

function parseToolStatus(status: unknown) {
  if (typeof status !== 'string' || !status.startsWith('{')) {
    return undefined
  }

  try {
    return JSON.parse(status) as {
      action?: unknown
      params?: Record<string, unknown>
      source?: unknown
    }
  } catch {
    return undefined
  }
}

function pushTextBlock(blocks: MessageBlock[], content: string, phase?: MessagePhase) {
  if (content.trim()) {
    blocks.push({ type: 'text', content, ...(phase ? { phase } : {}) })
  }
}

export function hasExplicitAssistantWorkPhases(message: Message) {
  return message.parts?.some((part) => (
    part.type === 'reasoning' || (part.type === 'text' && part.phase !== undefined)
  )) ?? false
}

export function isAssistantWorkBlock(block: MessageBlock, answeredClientRequestIds?: ReadonlySet<string>) {
  if (block.type === 'question') return answeredClientRequestIds?.has(block.request.id) === true
  if (block.type === 'reasoning' || block.type === 'tool' || block.type === 'tool-group') return true
  if (block.type === 'media') return block.phase !== 'final_answer'
  return 'phase' in block && block.phase === 'commentary'
}

function extractFollowUps(content: string) {
  const prompts: string[] = []
  const stripped = content.replace(followUpTagRegex, (_match, prompt: string) => {
    const trimmed = prompt.trim()
    if (trimmed) {
      prompts.push(trimmed)
    }
    return ''
  })

  return { content: stripped, prompts }
}

function completeStreamingCustomTags(content: string) {
  return completeStreamingToolTag(completeStreamingPairedTag(content, 'follow-up'))
}

function completeStreamingPairedTag(content: string, tagName: string) {
  const openTag = `<${tagName}>`
  const closeTag = `</${tagName}>`
  const openIndex = content.lastIndexOf(openTag)
  const closeIndex = content.lastIndexOf(closeTag)
  if (openIndex <= closeIndex) {
    return content
  }

  const partialCloseIndex = content.lastIndexOf('</')
  if (partialCloseIndex > openIndex && closeTag.startsWith(content.slice(partialCloseIndex))) {
    return `${content.slice(0, partialCloseIndex)}${closeTag}`
  }

  return `${content}${closeTag}`
}

function completeStreamingToolTag(content: string) {
  const openIndex = content.lastIndexOf('<tool')
  const closeIndex = content.lastIndexOf('</tool>')
  if (openIndex <= closeIndex) {
    return content
  }

  const beforeTool = content.slice(0, openIndex)
  const toolText = content.slice(openIndex)
  const closeTag = '</tool>'
  const partialCloseIndex = toolText.lastIndexOf('</')
  const openingText = partialCloseIndex >= 0 ? toolText.slice(0, partialCloseIndex) : toolText
  const openingEnd = openingText.indexOf('>')

  if (openingEnd === -1) {
    const attributeMatch = openingText.match(/^<tool\s+(id|index)="([^"]*)"$/)
    return attributeMatch ? `${beforeTool}${openingText}>${closeTag}` : beforeTool
  }

  const completedOpening = openingText.slice(0, openingEnd + 1)
  const trailingText = openingText.slice(openingEnd + 1)
  return `${beforeTool}${completedOpening}${closeTag}${trailingText}`
}

function findToolCall(kind: string, value: string, toolCalls: MessageToolCall[]) {
  if (kind === 'id') {
    return toolCalls.find((toolCall) => toolCall.id === value)
  }

  return toolCalls[Number.parseInt(value, 10)]
}

function findMediaToolCall(media: MessageMedia, toolCalls: MessageToolCall[]) {
  return toolCalls.find((toolCall) => {
    if (getMessageToolCallName(toolCall) !== 'image_generation') {
      return false
    }

    const resultUrl = getToolCallResultString(toolCall, 'url')
    const resultExternalUrl = getToolCallResultString(toolCall, 'externalUrl')
    const resultPath = getToolCallResultString(toolCall, 'path')
    return media.url === resultUrl || media.url === resultExternalUrl || media.url === resultPath
  })
}

function getToolCallPrompt(toolCall?: MessageToolCall) {
  return getToolCallResultString(toolCall, 'prompt') ?? getToolCallParamString(toolCall, 'prompt')
}

function getToolCallResultString(toolCall: MessageToolCall | undefined, key: string) {
  const result = toolCall?.result
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return undefined
  }

  const value = (result as Record<string, unknown>)[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function getToolCallParamString(toolCall: MessageToolCall | undefined, key: string) {
  const params = toolCall ? getMessageToolCallArgs(toolCall) : undefined
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    return undefined
  }

  const value = (params as Record<string, unknown>)[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

type SpecialBlock =
  | { type: 'tool'; start: number; end: number; kind: string; value: string }
  | { type: 'mermaid'; start: number; end: number; code: string }
  | { type: 'visualization'; start: number; end: number; path?: string; title: string }
  | { type: 'media'; start: number; end: number; media: MessageMedia }

function findSpecialBlocks(content: string, codeBlocks: CodeBlockRange[]) {
  const blocks: SpecialBlock[] = []

  for (const block of findMermaidCodeBlocks(content)) {
    blocks.push(block)
  }

  for (const match of content.matchAll(visualizationAnnotationRegex)) {
    const start = match.index
    if (isInsideCodeBlock(start, codeBlocks)) continue
    const payload = visualizationPayload(match[1]!)
    blocks.push({
      end: start + match[0].length,
      start,
      title: payload?.title ?? 'Visualization',
      ...(payload?.path ? { path: payload.path } : {}),
      type: 'visualization',
    })
  }

  for (const match of content.matchAll(toolTagRegex)) {
    const start = match.index
    if (isInsideCodeBlock(start, codeBlocks)) {
      continue
    }

    const kind = match[1]
    const value = match[2]
    if (!kind || !value) {
      continue
    }

    blocks.push({
      end: start + match[0].length,
      kind,
      start,
      type: 'tool',
      value
    })
  }

  for (const match of content.matchAll(markdownImageRegex)) {
    const start = match.index
    if (isInsideCodeBlock(start, codeBlocks)) {
      continue
    }

    const alt = match[1]!.trim()
    const url = match[2]!
    const title = match[3]?.trim()
    blocks.push({
      end: start + match[0].length,
      media: {
        alt: alt || undefined,
        title: title || alt || undefined,
        url
      },
      start,
      type: 'media'
    })
  }

  return blocks.sort((first, second) => first.start - second.start)
}

function visualizationPayload(value: string): { path?: string; title: string } | null {
  try {
    const payload = JSON.parse(value) as { path?: unknown; title?: unknown }
    const title = typeof payload.title === 'string' && payload.title.trim()
      ? payload.title.trim()
      : 'Visualization'
    const path = typeof payload.path === 'string' && payload.path.trim()
      ? payload.path.trim()
      : undefined
    return { title, ...(path ? { path } : {}) }
  } catch {
    return null
  }
}

function findMermaidCodeBlocks(content: string): SpecialBlock[] {
  const blocks: SpecialBlock[] = []
  const fenceRegex = /(^|\n)(```|~~~)[ \t]*mermaid[^\n]*\n/gi
  let match: RegExpExecArray | null

  while ((match = fenceRegex.exec(content)) !== null) {
    const fence = match[2]!
    const prefix = match[1]!
    const start = match.index + prefix.length
    const codeStart = start + match[0].length - prefix.length
    const closeRegex = new RegExp(`(^|\\n)${escapeRegex(fence)}[ \\t]*(?=\\n|$)`, 'g')
    closeRegex.lastIndex = codeStart
    const close = closeRegex.exec(content)

    if (!close) {
      continue
    }

    const codeEnd = close.index
    const end = close.index + close[0].length
    const code = content.slice(codeStart, codeEnd).trim()
    if (code) {
      blocks.push({ code, end, start, type: 'mermaid' })
    }
    fenceRegex.lastIndex = end
  }

  return blocks
}

function findCodeBlocks(content: string): CodeBlockRange[] {
  const ranges: CodeBlockRange[] = []
  const fenceRegex = /(^|\n)(```|~~~)/g
  let match: RegExpExecArray | null

  while ((match = fenceRegex.exec(content)) !== null) {
    const fence = match[2]!
    const prefix = match[1]!
    const start = match.index + prefix.length
    const closeRegex = new RegExp(`(^|\\n)${escapeRegex(fence)}`, 'g')
    closeRegex.lastIndex = start + fence.length
    const close = closeRegex.exec(content)

    if (!close) {
      ranges.push({ start, end: content.length })
      break
    }

    const end = close.index + close[1]!.length + fence.length
    ranges.push({ start, end })
    fenceRegex.lastIndex = end
  }

  return ranges
}

function isInsideCodeBlock(index: number, ranges: CodeBlockRange[]) {
  return ranges.some((range) => index >= range.start && index <= range.end)
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
