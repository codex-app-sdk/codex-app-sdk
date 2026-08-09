import { Marked, Renderer } from 'marked'
import katex from 'katex'
import markedKatex from 'marked-katex-extension'
import { escapeAttribute, escapeHtml } from './html-escape'
import { renderCodeBlock } from './syntax-highlighting'
import { parseCodexEditorFileReference } from './conversation-links'

const renderer = new Renderer()

renderer.html = ({ text }) => escapeHtml(text)

renderer.code = ({ text, lang }) => renderCodeBlock(text, lang)

renderer.link = ({ href, title, tokens }) => {
  const text = renderInlineTokens(tokens)
  const safeHref = safeMarkdownHref(href)
  if (!safeHref) {
    return `<span class="chat-message-link chat-message-link--blocked">${text}</span>`
  }
  const safeTitle = title ? ` title="${escapeAttribute(title)}"` : ''
  const icon = renderLinkIcon(safeHref)
  const target = isAbsoluteHttpUrl(safeHref) ? ' target="_blank" rel="noopener noreferrer"' : ''
  return `<a class="chat-message-link" href="${escapeAttribute(safeHref)}"${safeTitle}${target}>${icon}<span class="chat-message-link__label">${text}</span></a>`
}

renderer.image = ({ href, title, text }) => {
  const safeSrc = safeMarkdownImageSrc(href)
  const alt = escapeAttribute(text)
  if (!safeSrc) {
    return `<span class="chat-message-image chat-message-image--blocked">${escapeHtml(text)}</span>`
  }
  const safeTitle = title ? ` title="${escapeAttribute(title)}"` : ''
  return `<img class="chat-message-image" src="${escapeAttribute(safeSrc)}" alt="${alt}"${safeTitle} loading="lazy" decoding="async" referrerpolicy="no-referrer">`
}

const markdown = new Marked({
  async: false,
  breaks: true,
  gfm: true,
  renderer,
})

markdown.use(markedKatex({
  maxExpand: 1_000,
  maxSize: 20,
  nonStandard: false,
  output: 'htmlAndMathml',
  strict: 'ignore',
  throwOnError: false,
  trust: false,
}))

markdown.use({
  extensions: [
    {
      name: 'codexBlockKatex',
      level: 'block',
      tokenizer(src) {
        const match = /^\\\[[ \t]*(?:\n([\s\S]+?)\n|([^\n]*?))[ \t]*\\\](?:\n|$)/.exec(src)
        if (!match) return undefined
        return {
          type: 'codexBlockKatex',
          raw: match[0],
          text: (match[1] ?? match[2] ?? '').trim(),
        }
      },
      renderer(token) {
        return `${renderLatex((token as unknown as { text: string }).text, true)}\n`
      },
    },
    {
      name: 'codexInlineKatex',
      level: 'inline',
      start(src) {
        const index = src.indexOf('\\(')
        return index === -1 ? undefined : index
      },
      tokenizer(src) {
        const match = /^\\\((.+?)\\\)/.exec(src)
        if (!match) return undefined
        return {
          type: 'codexInlineKatex',
          raw: match[0],
          text: match[1]!.trim(),
        }
      },
      renderer(token) {
        return renderLatex((token as unknown as { text: string }).text, false)
      },
    },
    {
      name: 'taskList',
      renderer(token) {
        const taskList = token as unknown as { items?: unknown }
        const items: unknown[] = Array.isArray(taskList.items)
          ? taskList.items
          : []
        return `<ul>${items.map((item) => renderTaskItem(item)).join('')}</ul>`
      },
    },
    {
      name: 'taskItem',
      renderer: renderTaskItem,
    },
  ],
})

export function renderMarkdown(
  content: string,
  options: { codeCopyLabel?: string } = {},
) {
  const html = markdown.parse(content) as string
  return options.codeCopyLabel ? addCodeCopyControls(html, options.codeCopyLabel) : html
}

export function renderUserText(content: string) {
  return `<p>${escapeHtml(content)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>')}</p>`
}

function addCodeCopyControls(html: string, label: string): string {
  const button = [
    `<button class="chat-code-block__copy" type="button" data-chat-code-copy aria-label="${escapeAttribute(label)}" title="${escapeAttribute(label)}">`,
    '<svg class="chat-code-block__copy-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8m-2 0a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z"/><path d="M16 6V4a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h2"/></svg>',
    '<svg class="chat-code-block__check-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 5 5L20 7"/></svg>',
    '</button>',
  ].join('')
  return html.replace(/(<pre\b[\s\S]*?<\/pre>)/g, `<div class="chat-code-block">${button}$1</div>`)
}

function isAbsoluteHttpUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function isMailtoUrl(value: string) {
  try {
    return new URL(value).protocol === 'mailto:'
  } catch {
    return false
  }
}

function renderLatex(source: string, displayMode: boolean): string {
  const rendered = katex.renderToString(source, {
    displayMode,
    maxExpand: 1_000,
    maxSize: 20,
    output: 'htmlAndMathml',
    strict: 'ignore',
    throwOnError: false,
    trust: false,
  })
  return displayMode ? `<span class="katex-display">${rendered}</span>` : rendered
}

const allowedAbsoluteProtocols = new Set(['file:', 'http:', 'https:', 'mailto:', 'tel:'])

/**
 * Returns a browser-safe Markdown href or null when the link uses an executable
 * or otherwise unsupported scheme. Relative paths and in-document fragments
 * deliberately remain relative so the host can resolve them against its own
 * workspace policy.
 */
export function safeMarkdownHref(value: string): string | null {
  const href = value.trim()
  if (!href || /[\u0000-\u001f\u007f]/.test(href)) {
    return null
  }

  if (href.startsWith('#') || href.startsWith('?')) {
    return href
  }

  if (/^[a-z]:[\\/]/i.test(href)) {
    return href
  }

  if (parseCodexEditorFileReference(href)) {
    return href
  }

  // Network-path references inherit the renderer scheme and are therefore not
  // a stable or safe relative-file contract.
  if (href.startsWith('\\') || href.startsWith('//')) {
    return null
  }

  const scheme = /^([a-z][a-z\d+.-]*):/i.exec(href)?.[1]
  if (!scheme) {
    return href
  }

  const protocol = `${scheme.toLowerCase()}:`
  if (!allowedAbsoluteProtocols.has(protocol)) {
    return null
  }

  try {
    const url = new URL(href)
    return url.protocol.toLowerCase() === protocol ? href : null
  } catch {
    return null
  }
}

function safeMarkdownImageSrc(value: string): string | null {
  const src = safeMarkdownHref(value)
  if (!src || src.startsWith('#') || src.startsWith('?')) return null
  try {
    const protocol = new URL(src).protocol
    return protocol === 'mailto:' || protocol === 'tel:' ? null : src
  } catch {
    return src
  }
}

function renderLinkIcon(href: string) {
  if (isAbsoluteHttpUrl(href)) {
    return '<svg class="chat-message-link__icon chat-message-link__icon--external" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"></path><path d="m10 14 11-11"></path><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path></svg>'
  }

  if (isMailtoUrl(href)) {
    return '<svg class="chat-message-link__icon chat-message-link__icon--mail" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"></rect><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"></path></svg>'
  }

  return '<svg class="chat-message-link__icon chat-message-link__icon--file" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path><path d="M14 2v4a2 2 0 0 0 2 2h4"></path></svg>'
}

function renderInlineTokens(tokens: unknown[]) {
  return tokens.map(renderInlineToken).join('')
}

export function renderInlineToken(token: unknown): string {
  if (!token || typeof token !== 'object') {
    return ''
  }

  const inlineToken = token as {
    raw?: unknown
    text?: unknown
    tokens?: unknown[]
    type?: unknown
  }

  if (Array.isArray(inlineToken.tokens)) {
    const content = renderInlineTokens(inlineToken.tokens)
    if (inlineToken.type === 'strong') {
      return `<strong>${content}</strong>`
    }
    if (inlineToken.type === 'em') {
      return `<em>${content}</em>`
    }
    return content
  }

  if (inlineToken.type === 'codespan' && typeof inlineToken.text === 'string') {
    return `<code>${escapeHtml(inlineToken.text)}</code>`
  }

  if (typeof inlineToken.text === 'string') {
    return escapeHtml(inlineToken.text)
  }

  if (typeof inlineToken.raw === 'string') {
    return escapeHtml(inlineToken.raw)
  }

  return ''
}

export function renderTaskItem(token: unknown) {
  const task = token && typeof token === 'object' ? token as Record<string, unknown> : {}
  const checked = task.checked === true
  const tokens: Array<{ raw?: string; text?: string }> = Array.isArray(task.tokens)
    ? task.tokens as Array<{ raw?: string; text?: string }>
    : []
  const text = tokens.length > 0
    ? markdown.parseInline(tokens.map((item) => item.raw ?? item.text ?? '').join('')) as string
    : escapeHtml(String(task.mainContent ?? task.text ?? ''))
  const nested = Array.isArray(task.nestedTokens) && task.nestedTokens.length > 0
    ? (markdown.parser as unknown as (tokens: unknown[]) => string)(task.nestedTokens)
    : ''

  return `<li><input${checked ? ' checked=""' : ''} disabled="" type="checkbox"> ${text}${nested}</li>`
}
