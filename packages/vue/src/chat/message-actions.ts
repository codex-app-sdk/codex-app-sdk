import { renderMarkdown } from './message-markdown'
import { stripMessageContext } from './message-blocks'
import type { CodexHostCapabilities } from '@codex-app-sdk/core/native'
import { getCodexGlobalHostCapabilities } from '../native-capabilities'

const toolTagRegex = /<tool\s+(id|index)="[^"]*"><\/tool>/g
const followUpTagRegex = /<follow-up>[\s\S]*?<\/follow-up>/g
const breakTagRegex = /<br\s*\/?>/gi

export function stripMessageMarkup(content: string) {
  return stripMessageContext(content)
    .replace(toolTagRegex, '')
    .replace(followUpTagRegex, '')
    .trim()
}

export function copyableMessageText(content: string) {
  return markdownToText(stripMessageMarkup(content))
}

export function copyableMessageHtml(content: string) {
  return renderMarkdown(stripMessageMarkup(content)).trim()
}

export async function copyMessageToClipboard(
  content: string,
  hostCapabilities: CodexHostCapabilities | undefined = getCodexGlobalHostCapabilities(),
) {
  const plainText = copyableMessageText(content)
  const html = copyableMessageHtml(content)
  if (hostCapabilities) {
    await hostCapabilities.copyToClipboard({
      text: plainText,
      ...(html ? { html } : {}),
    })
    return
  }
  const clipboard = navigator.clipboard
  const ClipboardItemConstructor = globalThis.ClipboardItem

  if (clipboard.write && ClipboardItemConstructor && html) {
    await clipboard.write([
      new ClipboardItemConstructor({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plainText], { type: 'text/plain' }),
      }),
    ])
    return
  }

  await clipboard.writeText(plainText)
}

export async function copyTextToClipboard(
  text: string,
  hostCapabilities: CodexHostCapabilities | undefined = getCodexGlobalHostCapabilities(),
) {
  if (hostCapabilities) {
    await hostCapabilities.copyToClipboard({ text })
    return
  }
  await navigator.clipboard.writeText(text)
}

function markdownToText(content: string) {
  const html = renderMarkdown(content).replace(breakTagRegex, '\n')
  const template = document.createElement('template')
  template.innerHTML = html
  const blocks: string[] = []
  template.content.childNodes.forEach((node) => collectTextBlocks(node, blocks))
  return blocks.join('\n')
}

function collectTextBlocks(node: Node, blocks: string[]) {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent!.trim()
    if (text) {
      blocks.push(normalizeText(text))
    }
    return
  }

  if (!(node instanceof HTMLElement)) {
    return
  }

  const tagName = node.tagName.toLowerCase()
  if (node.classList.contains('katex')) {
    const text = readableInlineText(node).trim()
    if (text) {
      blocks.push(normalizeText(text))
    }
    return
  }

  if (tagName === 'pre') {
    const highlightedLines = [...node.querySelectorAll(':scope > code > .line')]
    const text = highlightedLines.map((line) => line.textContent ?? '').join('\n').trim()
    if (text) {
      blocks.push(normalizeText(text))
    }
    return
  }

  if (tagName === 'li' || tagName === 'p' || /^h[1-6]$/.test(tagName)) {
    const text = readableInlineText(node).trim()
    if (text) {
      blocks.push(normalizeText(text))
    }
    return
  }

  node.childNodes.forEach((child) => collectTextBlocks(child, blocks))
}

function readableInlineText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent!
  }
  if (!(node instanceof HTMLElement)) {
    return ''
  }
  if (node.classList.contains('katex')) {
    return node.querySelector('annotation[encoding="application/x-tex"]')?.textContent ?? ''
  }
  return [...node.childNodes].map(readableInlineText).join('')
}

function normalizeText(text: string) {
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
}
