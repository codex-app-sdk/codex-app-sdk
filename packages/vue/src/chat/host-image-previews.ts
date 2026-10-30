import { imagePreviewPoolKey } from './image-preview-pool'
import { computed, inject, shallowRef, watch, type WatchSource } from 'vue'
import { useCodexHostCapabilities } from '../native-capabilities'

function localSource(source: string): boolean {
  return Boolean(source) && !/^(?:https?:|data:|blob:|\/\/)/i.test(source)
}
function displaySource(source: string): boolean {
  return /^(?:https?:|blob:|data:image\/(?:avif|bmp|gif|heic|heif|jpe?g|png|webp);base64,)/i.test(source)
}

/** Hosts resolve their own files; a phone or web client never interprets a laptop path locally. */
export function useHostImageSource(source: WatchSource<string>) {
  const host = useCodexHostCapabilities()
  const resolved = shallowRef<string>()
  watch(source, async (value, _previous, onCleanup) => {
    let active = true
    onCleanup(() => { active = false })
    resolved.value = undefined
    if (!localSource(value) || !host?.readImagePreview) { resolved.value = value; return }
    try {
      const result = await host.readImagePreview(value)
      if (active && result && displaySource(result)) resolved.value = result
    } catch { /* Opening the image lets its host present an unavailable state. */ }
  }, { immediate: true })
  return computed(() => resolved.value)
}

/** A host may bound all native previews in its surface without changing when
 * components request them. Cleanup releases shared resources after the last use. */
export function useManagedImagePreview(source: WatchSource<string>) {
  const pool = inject(imagePreviewPoolKey, undefined)
  if (!pool) return undefined
  const entry = shallowRef<ReturnType<typeof pool.acquire>>()
  watch(source, (reference, _previous, onCleanup) => {
    entry.value = undefined
    if (!reference) return
    const current = pool.acquire(reference)
    entry.value = current
    onCleanup(() => pool.release(current))
    void pool.load(current)
  }, { immediate: true })
  return {
    source: computed(() => entry.value?.source.value),
    loading: computed(() => entry.value?.state.value === 'loading'),
    reload: () => entry.value ? pool.load(entry.value) : Promise.resolve(),
  }
}
