// Tool transcripts can contain hundreds of rows. Share one observer and release
// each target with its component rather than allocating an observer per title.
const callbacks = new Map<Element, () => void>()
let observer: ResizeObserver | undefined

export function observeTextResize(element: Element, callback: () => void) {
  if (typeof ResizeObserver === 'undefined') return () => {}
  observer ??= new ResizeObserver(entries => {
    for (const entry of entries) callbacks.get(entry.target)?.()
  })
  callbacks.set(element, callback)
  observer.observe(element)
  return () => {
    observer?.unobserve(element)
    callbacks.delete(element)
    if (!callbacks.size) { observer?.disconnect(); observer = undefined }
  }
}
