import { computed, shallowRef, watch, type WatchSource } from 'vue'
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
