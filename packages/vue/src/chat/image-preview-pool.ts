import { shallowRef, type InjectionKey } from 'vue'

export const imagePreviewPoolKey: InjectionKey<ImagePreviewPool> = Symbol('image-preview-pool')

type Entry = { reference: string; source: ReturnType<typeof shallowRef<string | undefined>>; state: ReturnType<typeof shallowRef<'idle' | 'loading' | 'ready'>>; users: number; bytes: number; ownedUrl?: boolean; pending?: Promise<void> }

/** Scoped to one host surface. Revocation clears every consumer before releasing
 * its blob; decoded pixels count alongside encoded bytes in the retained budget. */
export class ImagePreviewPool {
  private readonly entries = new Map<string, Entry>()
  private readonly queue: Array<() => Promise<void>> = []
  private active = 0
  constructor(private readonly read: (reference: string) => Promise<string | null>, private readonly budget: number) {}

  acquire(reference: string) {
    let entry = this.entries.get(reference)
    if (!entry) {
      entry = { reference, source: shallowRef<string>(), state: shallowRef<'idle' | 'loading' | 'ready'>('idle'), users: 0, bytes: 0 }
      this.entries.set(reference, entry)
    }
    entry.users++
    return entry
  }

  release(entry: Entry) {
    if (--entry.users > 0) return
    this.drop(entry)
    this.entries.delete(entry.reference)
  }

  clear() { for (const entry of this.entries.values()) { entry.users = 0; this.drop(entry) }; this.entries.clear() }

  load(entry: Entry): Promise<void> {
    if (entry.source.value) { this.entries.delete(entry.reference); this.entries.set(entry.reference, entry); return Promise.resolve() }
    if (entry.pending) return entry.pending
    entry.state.value = 'loading'
    entry.pending = new Promise<void>(resolve => {
      this.queue.push(async () => {
        let url: string | undefined
        let ownedUrl = false
        try {
          if (!entry.users) return
          let data = await this.read(entry.reference)
          if (!entry.users || !data || data.length > 24 * 1024 * 1024) return
          let encodedBytes = 0
          if (/^data:image\/(?:avif|bmp|gif|heic|heif|jpe?g|png|webp);base64,/i.test(data)) {
            const blob = await (await fetch(data)).blob()
            data = null
            if (!entry.users || blob.size > this.budget) return
            encodedBytes = blob.size; url = URL.createObjectURL(blob); ownedUrl = true
          } else if (/^(?:https?:|blob:|\/\/)/i.test(data)) url = data
          else return
          const pixels = await imagePixels(url)
          const bytes = encodedBytes + pixels * 4
          if (!entry.users || bytes > this.budget) return
          let retained = [...this.entries.values()].reduce((sum, item) => sum + item.bytes, 0)
          for (const candidate of this.entries.values()) {
            if (retained + bytes <= this.budget) break
            retained -= candidate.bytes; this.drop(candidate)
          }
          this.entries.delete(entry.reference); this.entries.set(entry.reference, entry)
          entry.bytes = bytes; entry.ownedUrl = ownedUrl; entry.source.value = url; entry.state.value = 'ready'; url = undefined
        } catch { /* Failed or evicted previews can be requested again explicitly. */ }
        finally {
          if (url && ownedUrl) URL.revokeObjectURL(url)
          if (!entry.source.value) entry.state.value = 'idle'
          entry.pending = undefined; resolve()
        }
      })
    })
    this.pump()
    return entry.pending
  }

  private drop(entry: Entry) {
    const url = entry.source.value
    entry.source.value = undefined; entry.bytes = 0
    if (entry.state.value !== 'loading') entry.state.value = 'idle'
    if (url && entry.ownedUrl) URL.revokeObjectURL(url)
    entry.ownedUrl = false
  }
  private pump() {
    while (this.active < 2 && this.queue.length) {
      this.active++
      void this.queue.shift()!().finally(() => { this.active--; this.pump() })
    }
  }
}

function imagePixels(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    const finish = (pixels?: number) => {
      clearTimeout(timer); image.onload = null; image.onerror = null; image.src = ''
      if (pixels) resolve(pixels); else reject(new Error('Image cannot be decoded.'))
    }
    const timer = setTimeout(() => finish(), 15_000)
    image.onload = () => finish(image.naturalWidth * image.naturalHeight)
    image.onerror = () => finish()
    image.src = url
  })
}
