import type { Message } from './types'

export type CodexMessageImage = {
  alt: string
  kind: 'attachment' | 'media'
  mimeType?: string
  name?: string
  path?: string
  src: string
  title?: string
}

export type CodexMessageImageOpenHandler = (
  image: CodexMessageImage,
  context?: CodexMessageImageContext,
) => boolean | void | Promise<boolean | void>

export type CodexMessageImageOpenIntent = 'fullscreen' | 'open'

export type CodexMessageImageContext = {
  intent: CodexMessageImageOpenIntent
  index?: number
  message?: Message
}
