import { nextTick, watch, type Ref } from 'vue'

/**
 * WAI-ARIA APG dialog focus trap. Applies to a `role="dialog"` container
 * that mounts/unmounts with a `v-if` (the shop and scoreboard overlays in
 * GameScreen.vue): on activation it remembers the element that had focus
 * (the "opener") and moves focus into the dialog; Tab/Shift+Tab cycle
 * among the dialog's own focusable descendants without escaping to the
 * page; Escape calls `onClose`; on deactivation focus returns to the
 * opener (if it's still attached to the document).
 *
 * GameScreen also runs a window-level keydown handler that treats a bare
 * Tab press as a game hotkey (hold-to-peek scoreboard — see
 * `app/utils/gameKeys.ts`). Wiring `onKeydown` on the dialog root via
 * `@keydown` intercepts Tab/Escape while bubbling *through* the dialog and
 * `stopPropagation()`s them so they never reach that window listener —
 * while a dialog is open, Tab is the dialog's, not the game's.
 */

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

export interface UseFocusTrapOptions {
  /** Called when Escape is pressed inside the dialog (the caller sets its `active` source false). */
  onClose?: () => void
  /** Element to focus on activation. Defaults to the first focusable descendant, or the container itself. */
  initialFocus?: () => HTMLElement | null | undefined
}

export function useFocusTrap(
  containerRef: Ref<HTMLElement | null | undefined>,
  active: Ref<boolean>,
  options: UseFocusTrapOptions = {},
) {
  let opener: HTMLElement | null = null

  function focusableElements(): HTMLElement[] {
    const root = containerRef.value
    if (!root) return []
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
  }

  function activate() {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    nextTick(() => {
      const root = containerRef.value
      if (!root) return
      const target = options.initialFocus?.() ?? focusableElements()[0] ?? root
      if (target === root && !root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1')
      target.focus()
    })
  }

  function deactivate() {
    const toRestore = opener
    opener = null
    nextTick(() => {
      if (toRestore && document.contains(toRestore)) toRestore.focus()
    })
  }

  watch(
    active,
    (isActive) => {
      if (isActive) activate()
      else deactivate()
    },
    { immediate: true },
  )

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.stopPropagation()
      options.onClose?.()
      return
    }
    if (event.key !== 'Tab') return
    event.stopPropagation()

    const els = focusableElements()
    if (!els.length) {
      event.preventDefault()
      return
    }
    const first = els[0]!
    const last = els[els.length - 1]!
    const current = document.activeElement
    const currentIndex = els.indexOf(current as HTMLElement)

    if (event.shiftKey) {
      if (currentIndex <= 0) {
        event.preventDefault()
        last.focus()
      }
    } else {
      if (currentIndex === -1 || currentIndex === els.length - 1) {
        event.preventDefault()
        first.focus()
      }
    }
  }

  return { onKeydown }
}
