import { shallowRef } from 'vue'
import { createHighlighterCoreSync } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import css from '@shikijs/langs/css'
import diff from '@shikijs/langs/diff'
import docker from '@shikijs/langs/docker'
import go from '@shikijs/langs/go'
import html from '@shikijs/langs/html'
import javascript from '@shikijs/langs/javascript'
import json from '@shikijs/langs/json'
import jsx from '@shikijs/langs/jsx'
import markdown from '@shikijs/langs/markdown'
import python from '@shikijs/langs/python'
import rust from '@shikijs/langs/rust'
import shell from '@shikijs/langs/sh'
import sql from '@shikijs/langs/sql'
import toml from '@shikijs/langs/toml'
import tsx from '@shikijs/langs/tsx'
import typescript from '@shikijs/langs/typescript'
import vue from '@shikijs/langs/vue'
import xml from '@shikijs/langs/xml'
import yaml from '@shikijs/langs/yaml'
import darkPlus from '@shikijs/themes/dark-plus'
import lightPlus from '@shikijs/themes/light-plus'
import { escapeAttribute, escapeHtml } from './html-escape'

const highlighter = createHighlighterCoreSync({
  engine: createJavaScriptRegexEngine(),
  langs: [
    css,
    diff,
    docker,
    go,
    html,
    javascript,
    json,
    jsx,
    markdown,
    python,
    rust,
    shell,
    sql,
    toml,
    tsx,
    typescript,
    vue,
    xml,
    yaml,
  ],
  themes: [lightPlus, darkPlus],
})

const loadedLanguages = new Set(highlighter.getLoadedLanguages())
const highlightsReady = shallowRef(false)
let highlights: typeof import('@pierre/highlights') | undefined
let lightTheme: typeof import('@pierre/highlights/themes/light-plus').default | undefined
let darkTheme: typeof import('@pierre/highlights/themes/dark-plus').default | undefined
let initialization: Promise<void> | undefined

function initializeHighlights() {
  initialization ??= Promise.all([
    import('@pierre/highlights'),
    import('@pierre/highlights/themes/light-plus'),
    import('@pierre/highlights/themes/dark-plus'),
  ]).then(([engine, light, dark]) => {
    highlights = engine
    lightTheme = light.default
    darkTheme = dark.default
    highlightsReady.value = true
  }).catch(() => {
    // Wasm may be blocked by the host CSP or unavailable in its runtime.
  })
}

function renderHighlights(code: string, lang: string): string | undefined {
  if (!highlights || !lightTheme || !darkTheme || !highlights.isSupportedLanguage(lang)) return undefined
  const result = highlights.codeToTokens(code, {
    lang,
    themes: { light: lightTheme, dark: darkTheme },
    defaultColor: false,
  })
  const lines = result.tokens.map((line) => `<span class="line">${line.map((token) => {
    const style = Object.entries(token.htmlStyle ?? {}).map(([key, value]) => `${key}:${value}`).join(';')
    return `<span style="${escapeAttribute(style)}">${escapeHtml(token.content)}</span>`
  }).join('')}</span>`).join('\n')
  return `<pre class="highlights" style="${escapeAttribute(result.rootStyle || '')}"><code>${lines}</code></pre>`
}

export function renderCodeBlock(code: string, language: string | undefined) {
  const lang = normalizeLanguage(language)
  if (!lang || !loadedLanguages.has(lang)) {
    return renderPlainCodeBlock(code, language)
  }

  initializeHighlights()
  // Track initialization in Vue computed renderers, keeping the public API synchronous.
  void highlightsReady.value
  try {
    const highlighted = renderHighlights(code, lang)
    if (highlighted !== undefined) return highlighted
  } catch {
    // Fall back to the existing JavaScript engine for unsupported environments.
  }

  try {
    return highlighter.codeToHtml(code, {
      defaultColor: false,
      lang,
      themes: {
        dark: 'dark-plus',
        light: 'light-plus',
      },
    })
  } catch {
    return renderPlainCodeBlock(code, language)
  }
}

export function languageForFilePath(filePath: string | undefined): string | undefined {
  const normalizedPath = (filePath ?? '').trim().toLowerCase();
  const extension = normalizedPath.match(/\.([^.\\/]+)$/)?.[1];
  switch (extension) {
    case 'patch':
      return 'diff';
    case 'dockerfile':
      return 'docker';
    case 'htm':
      return 'html';
    case 'js':
    case 'mjs':
    case 'cjs':
      return 'javascript';
    case 'jsonc':
      return 'json';
    case 'md':
    case 'mdown':
    case 'mkdn':
      return 'markdown';
    case 'py':
      return 'python';
    case 'rs':
      return 'rust';
    case 'bash':
    case 'zsh':
      return 'sh';
    case 'ts':
    case 'mts':
    case 'cts':
      return 'typescript';
    case 'svg':
      return 'xml';
    case 'yml':
      return 'yaml';
    default:
      if (normalizedPath.endsWith('/dockerfile') || normalizedPath === 'dockerfile') {
        return 'docker';
      }
      return extension;
  }
}

function normalizeLanguage(language: string | undefined) {
  const [lang] = (language ?? '').trim().toLowerCase().split(/\s+/)
  return lang || null
}

function renderPlainCodeBlock(code: string, language: string | undefined) {
  const lang = normalizeLanguage(language)
  const className = lang ? ` class="language-${escapeAttribute(lang)}"` : ''
  return `<pre><code${className}>${renderPlainCodeLines(code)}</code></pre>`
}

function renderPlainCodeLines(code: string) {
  return code.split('\n').map((line) => `<span class="line">${escapeHtml(line)}</span>`).join('\n')
}
