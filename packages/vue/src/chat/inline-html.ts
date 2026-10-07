export interface InlineHtmlBlock {
  type: 'html'
  start: number
  end: number
  source: string
  title?: string
  complete: boolean
}

// Recognize explicit artifacts and document-sized HTML fences, not ordinary
// snippets. Consume other fences too, so quoted artifacts remain inert code.
export function findInlineHtmlBlocks(content: string, streaming: boolean): InlineHtmlBlock[] {
  const blocks: InlineHtmlBlock[] = []
  const opening = /(^|\n)(?:(`{3,}|~{3,})([^\n]*)\n|[ \t]*<artifact\b([^>]*)>)/gi
  let match: RegExpExecArray | null
  while ((match = opening.exec(content))) {
    const start = match.index + (match[1]?.length ?? 0)
    const bodyStart = opening.lastIndex
    if (match[2]) {
      const fence = readFence(content, bodyStart, match[2])
      opening.lastIndex = fence.end
      if (match[3]!.trim().toLowerCase() !== 'html' || !/^\s*(?:<!doctype\s+html\b|<html\b)/i.test(fence.source)) continue
      blocks.push({ type: 'html', start, ...fence, complete: fence.complete || !streaming })
    } else {
      const close = /<\/artifact\s*>/gi
      close.lastIndex = bodyStart
      const endTag = close.exec(content)
      const end = endTag ? close.lastIndex : content.length
      let source = content.slice(bodyStart, endTag?.index ?? content.length).replace(/^\s*\n/, '')
      if (!endTag) source = stripPartialArtifactClose(source)
      const fenced = /^(`{3,}|~{3,})html[^\n]*\n/i.exec(source)
      if (fenced) source = readFence(source, fenced[0].length, fenced[1]!).source
      opening.lastIndex = end
      if (!/^\s*</.test(source)) continue
      const title = /\btitle\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(match[4]!)
      blocks.push({
        type: 'html', start, end, source,
        ...(title ? { title: title[1] ?? title[2]! } : {}),
        complete: Boolean(endTag) || !streaming,
      })
    }
  }
  return blocks
}

function readFence(content: string, start: number, fence: string) {
  const close = new RegExp(`^${fence[0]}{${fence.length},}[ \\t]*(?=\\r?\\n|$)`, 'gm')
  close.lastIndex = start
  const match = close.exec(content)
  let source = content.slice(start, match?.index ?? content.length)
  if (!match) {
    // Withhold a partial closing fence, but retain its preceding newline so
    // the source stays append-only when the closing delimiter arrives.
    source = source.replace(new RegExp(`(^|\\n)${fence[0]}{1,}[ \\t]*$`), '$1')
  }
  return { source, end: match ? close.lastIndex : content.length, complete: Boolean(match) }
}

function stripPartialArtifactClose(source: string) {
  const start = source.lastIndexOf('</')
  return start >= 0 && '</artifact>'.startsWith(source.slice(start).toLowerCase()) ? source.slice(0, start) : source
}
