import { shallowRef, type InjectionKey } from 'vue'

export const imagePreviewPoolKey: InjectionKey<ImagePreviewPool> = Symbol('image-preview-pool')

type Entry = { reference: string; source: ReturnType<typeof shallowRef<string | undefined>>; original: ReturnType<typeof shallowRef<string | undefined>>; state: ReturnType<typeof shallowRef<'idle' | 'loading' | 'ready'>>; dimensions: ReturnType<typeof shallowRef<{ width: number; height: number } | undefined>>; users: number; near: number; visible: number; width: number; bytes: number; originalBytes: number; thumbnail?: string; thumbnailBytes: number; previewPixels: number; ownedOriginal?: boolean; ownedPreview?: boolean; pending?: Promise<void> }

/** Original compressed bytes outlive decoded previews within one shared budget.
 * Scrolling releases previews, while a cache hit needs no second host transfer. */
export class ImagePreviewPool {
  private readonly entries = new Map<string, Entry>()
  private readonly queue: Array<{ entry: Entry; run: () => Promise<void> }> = []
  private active = 0
  constructor(private readonly read: (reference: string) => Promise<string | null>, private readonly budget: number, readonly viewport = false) {}

  acquire(reference: string) {
    let entry = this.entries.get(reference)
    if (!entry) {
      entry = { reference, source: shallowRef<string>(), original: shallowRef<string>(), state: shallowRef<'idle' | 'loading' | 'ready'>('idle'), dimensions: shallowRef(), users: 0, near: 0, visible: 0, width: 512, bytes: 0, originalBytes: 0, thumbnailBytes: 0, previewPixels: 0 }
      this.entries.set(reference, entry)
    }
    entry.users++
    return entry
  }

  release(entry: Entry) {
    entry.users = Math.max(0, entry.users - 1)
    if (entry.users) return
    this.drop(entry)
    this.entries.delete(entry.reference)
  }

  clear() { for (const entry of this.entries.values()) { entry.users = 0; this.drop(entry) }; this.entries.clear() }

  visibilityChanged(entry: Entry, width: number) {
    entry.width = Math.min(1024, Math.max(1, width * Math.min(2, globalThis.devicePixelRatio)))
    if (!entry.near && !entry.visible) this.dropPreview(entry)
  }

  load(entry: Entry, explicit = false): Promise<void> {
    if (entry.source.value) { this.touch(entry); return Promise.resolve() }
    if (entry.pending) return entry.pending
    entry.state.value = 'loading'
    entry.pending = new Promise<void>(resolve => {
      this.queue.push({ entry, run: async () => {
        let url: string | undefined
        let owned = false
        try {
          if (!entry.users || (this.viewport && !entry.near && !explicit)) return
          if (entry.thumbnail) {
            if (this.room(entry.previewPixels, entry, explicit)) {
              this.touch(entry); entry.bytes = entry.previewPixels; entry.source.value = entry.thumbnail; entry.state.value = 'ready'
            }
            return
          }
          if (!entry.original.value) {
            let data = await this.read(entry.reference)
            if (!entry.users || !data || data.length > 24 * 1024 * 1024) return
            let bytes = 0
            if (/^data:image\/(?:avif|bmp|gif|heic|heif|jpe?g|png|webp);base64,/i.test(data)) {
              const blob = await (await fetch(data)).blob()
              data = null
              if (!entry.users || blob.size > this.budget) return
              bytes = blob.size; url = URL.createObjectURL(blob); owned = true
            } else if (/^(?:https?:|blob:|\/\/)/i.test(data)) url = data
            else return
            if (!this.room(bytes, entry, explicit)) return
            entry.original.value = url; entry.originalBytes = bytes; entry.ownedOriginal = owned; url = undefined
          }
          if (!entry.users || (this.viewport && !entry.near && !explicit)) return
          const preview = await imagePreview(entry.original.value!, this.viewport ? entry.width : undefined)
          url = preview.url; owned = preview.owned
          entry.dimensions.value = preview.originalSize
          const bytes = preview.bytes + preview.width * preview.height * 4
          if (!entry.users || (this.viewport && !entry.near && !explicit) || !this.room(bytes, entry, explicit)) return
          this.touch(entry)
          entry.thumbnail = url; entry.thumbnailBytes = preview.bytes; entry.previewPixels = preview.width * preview.height * 4; entry.bytes = entry.previewPixels; entry.ownedPreview = owned; entry.source.value = url; entry.state.value = 'ready'; url = undefined
        } catch { /* Failed previews remain explicitly retryable. */ }
        finally {
          if (url && owned) URL.revokeObjectURL(url)
          if (!entry.source.value) { entry.state.value = 'idle'; if (!this.viewport) this.drop(entry) }
          entry.pending = undefined; resolve()
        }
      } })
    })
    this.pump()
    return entry.pending
  }

  private touch(entry: Entry) { this.entries.delete(entry.reference); this.entries.set(entry.reference, entry) }

  private room(bytes: number, owner: Entry, explicit: boolean) {
    let retained = [...this.entries.values()].reduce((sum, item) => sum + item.bytes + item.originalBytes + item.thumbnailBytes, 0)
    const candidates = [...this.entries.values()].filter(entry => entry !== owner && !entry.pending && !(this.viewport && entry.visible && !explicit))
      .sort((a, b) => a.visible - b.visible || a.near - b.near)
    for (const candidate of candidates) {
      if (retained + bytes <= this.budget) break
      retained -= candidate.bytes
      if (this.viewport) this.dropPreview(candidate)
      else { retained -= candidate.originalBytes + candidate.thumbnailBytes; this.drop(candidate) }
    }
    for (const candidate of candidates) {
      if (retained + bytes <= this.budget) break
      retained -= candidate.originalBytes + candidate.thumbnailBytes; this.drop(candidate)
    }
    return retained + bytes <= this.budget
  }

  private dropPreview(entry: Entry) {
    entry.source.value = undefined; entry.bytes = 0
    if (entry.state.value !== 'loading') entry.state.value = 'idle'
  }

  private drop(entry: Entry) {
    this.dropPreview(entry)
    if (entry.ownedPreview) URL.revokeObjectURL(entry.thumbnail!)
    entry.thumbnail = undefined; entry.thumbnailBytes = 0; entry.previewPixels = 0; entry.ownedPreview = false
    if (entry.ownedOriginal) URL.revokeObjectURL(entry.original.value!)
    entry.original.value = undefined; entry.originalBytes = 0; entry.ownedOriginal = false
  }

  private pump() {
    while (this.active < 2 && this.queue.length) {
      this.active++
      this.queue.sort((a, b) => b.entry.visible - a.entry.visible || b.entry.near - a.entry.near)
      void this.queue.shift()!.run().finally(() => { this.active--; this.pump() })
    }
  }
}

function imagePreview(url: string, maxWidth = Infinity): Promise<{ url: string; owned: boolean; bytes: number; width: number; height: number; originalSize: { width: number; height: number } }> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    let canvas: HTMLCanvasElement | undefined
    let finished = false
    const cleanup = () => {
      clearTimeout(timer); image.onload = null; image.onerror = null; image.src = ''
      if (canvas) { canvas.width = 0; canvas.height = 0; canvas = undefined }
    }
    const fail = () => { if (finished) return; finished = true; cleanup(); reject(new Error('Image cannot be decoded.')) }
    const timer = setTimeout(fail, 15_000)
    image.onload = () => {
      const originalSize = { width: image.naturalWidth, height: image.naturalHeight }
      const scale = Math.min(1, maxWidth / originalSize.width)
      if (scale === 1) { finished = true; cleanup(); resolve({ url, owned: false, bytes: 0, ...originalSize, originalSize }); return }
      try {
        canvas = document.createElement('canvas')
        const width = Math.max(1, Math.round(originalSize.width * scale)), height = Math.max(1, Math.round(originalSize.height * scale))
        canvas.width = width; canvas.height = height
        const context = canvas.getContext('2d')!
        context.drawImage(image, 0, 0, width, height)
        image.onload = null; image.onerror = null; image.src = ''
        canvas.toBlob(blob => {
          if (finished) return
          finished = true; cleanup()
          if (blob) resolve({ url: URL.createObjectURL(blob), owned: true, bytes: blob.size, width, height, originalSize })
          else reject(new Error('Image cannot be resized.'))
        }, 'image/png')
      } catch { fail() }
    }
    image.onerror = fail
    image.src = url
  })
}
