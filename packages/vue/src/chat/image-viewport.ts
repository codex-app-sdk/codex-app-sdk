/** Share two observers per scroll container, independent of transcript size. */
type Visibility = { near: boolean; visible: boolean }
type Target = Visibility & { update: (visibility: Visibility) => void }
const roots = new Map<Element | null, { targets: Map<Element, Target>; near: IntersectionObserver; visible: IntersectionObserver }>()

export function observeImageViewport(element: HTMLElement, update: Target['update']): () => void {
  if (typeof IntersectionObserver === 'undefined') { update({ near: true, visible: true }); return () => {} }
  let root: HTMLElement | null = element.parentElement
  while (root && !/(auto|scroll)/.test(getComputedStyle(root).overflowY)) root = root.parentElement
  let observers = roots.get(root)
  if (!observers) {
    const targets = new Map<Element, Target>()
    const observer = (kind: 'near' | 'visible', margin: string) => new IntersectionObserver(entries => {
      for (const entry of entries) {
        const target = targets.get(entry.target)
        if (!target) continue
        target[kind] = entry.isIntersecting
        target.update({ near: target.near || target.visible, visible: target.visible })
      }
    }, { root, rootMargin: margin })
    observers = { targets, near: observer('near', '400px 0px'), visible: observer('visible', '0px') }
    roots.set(root, observers)
  }
  observers.targets.set(element, { near: false, visible: false, update })
  observers.near.observe(element); observers.visible.observe(element)
  return () => {
    observers.targets.delete(element)
    observers.near.unobserve(element); observers.visible.unobserve(element)
    if (!observers.targets.size) { observers.near.disconnect(); observers.visible.disconnect(); roots.delete(root) }
  }
}
