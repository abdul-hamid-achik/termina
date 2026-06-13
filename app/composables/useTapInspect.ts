import { ref, onMounted, onBeforeUnmount } from 'vue'
import type { Ref } from 'vue'

/**
 * Reactive coarse-pointer (touch) detection. SSR-safe: defaults to `false`
 * on the server and re-evaluates on mount.
 */
export function usePointerCoarse(): Ref<boolean> {
  const isCoarse = ref(detectCoarsePointer())
  onMounted(() => {
    isCoarse.value = detectCoarsePointer()
  })
  return isCoarse
}

function detectCoarsePointer(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(pointer: coarse)').matches
}

export interface TapInspect {
  /** True when the primary pointer is coarse (touch). */
  isCoarse: Ref<boolean>
  /** Key of the currently inspected element, or null. */
  openKey: Ref<string | null>
  /** Whether the tooltip for `key` is currently open. */
  isOpen: (key: string) => boolean
  /**
   * Call from the trigger's click handler. Returns `true` when the caller
   * should perform the action immediately (fine pointer). Returns `false`
   * when the tap was intercepted to toggle the inspection tooltip instead
   * (coarse pointer) — the action must then be confirmed via an explicit
   * button inside the tooltip.
   */
  interceptActivate: (key: string) => boolean
  /** Hover handlers — no-ops on coarse pointers (emulated mouse events). */
  hoverEnter: (key: string) => void
  hoverLeave: () => void
  /** Close any open tooltip. */
  dismiss: () => void
  /**
   * Register the trigger element for `key` so taps inside it (including its
   * tooltip) don't count as outside-taps. Pass directly to a template ref.
   */
  registerEl: (key: string, el: unknown) => void
}

/**
 * Tap-to-inspect behavior for elements that both act on click and show a
 * tooltip on hover. On fine pointers (mouse) the existing hover + click
 * behavior is preserved. On coarse pointers (touch) the first tap opens the
 * tooltip — which should contain an explicit action button — and a tap
 * outside dismisses it.
 */
export function useTapInspect(): TapInspect {
  const isCoarse = usePointerCoarse()
  const openKey = ref<string | null>(null)
  const elements = new Map<string, Element>()

  function registerEl(key: string, el: unknown): void {
    if (el instanceof Element) {
      elements.set(key, el)
    } else {
      elements.delete(key)
    }
  }

  function isOpen(key: string): boolean {
    return openKey.value === key
  }

  function interceptActivate(key: string): boolean {
    if (!isCoarse.value) return true
    openKey.value = openKey.value === key ? null : key
    return false
  }

  function hoverEnter(key: string): void {
    if (!isCoarse.value) openKey.value = key
  }

  function hoverLeave(): void {
    if (!isCoarse.value) openKey.value = null
  }

  function dismiss(): void {
    openKey.value = null
  }

  function onDocumentPointerDown(event: Event): void {
    if (openKey.value === null) return
    const el = elements.get(openKey.value)
    if (el && event.target instanceof Node && el.contains(event.target)) return
    openKey.value = null
  }

  onMounted(() => {
    document.addEventListener('pointerdown', onDocumentPointerDown, true)
  })
  onBeforeUnmount(() => {
    document.removeEventListener('pointerdown', onDocumentPointerDown, true)
  })

  return {
    isCoarse,
    openKey,
    isOpen,
    interceptActivate,
    hoverEnter,
    hoverLeave,
    dismiss,
    registerEl,
  }
}
