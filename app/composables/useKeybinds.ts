import { onMounted, onUnmounted } from 'vue'
import { useSettingsStore } from '~/stores/settings'

export interface KeybindCallbacks {
  onTab?: () => void
  onArrowUp?: () => void
  onArrowDown?: () => void
  onEscape?: () => void
  onEnter?: () => void
  onQuickCast?: (slot: 'q' | 'w' | 'e' | 'r') => void
}

export function useKeybinds(callbacks: KeybindCallbacks, active: () => boolean) {
  const settings = useSettingsStore()

  const QUICKCAST_MAP: Record<string, 'q' | 'w' | 'e' | 'r'> = {
    '1': 'q',
    '2': 'w',
    '3': 'e',
    '4': 'r',
  }

  function handler(e: KeyboardEvent) {
    if (!active()) return

    // Don't intercept if user is in a non-game input
    const target = e.target as HTMLElement
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
      // Only handle specific keys when focused on the command input
      switch (e.key) {
        case 'Tab':
          e.preventDefault()
          callbacks.onTab?.()
          return
        case 'ArrowUp':
          e.preventDefault()
          callbacks.onArrowUp?.()
          return
        case 'ArrowDown':
          e.preventDefault()
          callbacks.onArrowDown?.()
          return
        case 'Escape':
          callbacks.onEscape?.()
          return
      }
      return
    }

    // Global shortcuts (when not in an input field)
    switch (e.key) {
      case 'Tab':
        e.preventDefault()
        callbacks.onTab?.()
        break
      case 'ArrowUp':
        e.preventDefault()
        callbacks.onArrowUp?.()
        break
      case 'ArrowDown':
        e.preventDefault()
        callbacks.onArrowDown?.()
        break
      case 'Escape':
        callbacks.onEscape?.()
        break
      case 'Enter':
        callbacks.onEnter?.()
        break
    }

    // Quick cast shortcuts
    const quickCastSlot = QUICKCAST_MAP[e.key]
    if (settings.quickCastEnabled && quickCastSlot) {
      callbacks.onQuickCast?.(quickCastSlot)
    }
  }

  onMounted(() => {
    document.addEventListener('keydown', handler)
  })

  onUnmounted(() => {
    document.removeEventListener('keydown', handler)
  })
}
