import type { ArrowDirection } from '~/utils/arrowMove'

/** What an in-game key press resolves to (the side effect is the caller's job). */
export type GameKeyAction =
  | { type: 'none' }
  | { type: 'closeOverlay' }
  | { type: 'autocomplete' } // Tab while typing — CommandInput handles it; just preventDefault
  | { type: 'showScoreboard' }
  | { type: 'toggleShop' }
  | { type: 'quickAbility'; key: string }
  | { type: 'useItem'; index: number }
  | { type: 'move'; direction: ArrowDirection }

export interface GameKeyContext {
  /** Focus is in a text input/textarea (typing a command) — suppress hotkeys. */
  isInputFocused: boolean
  /** Shop or scoreboard overlay is open — suppress in-world actions. */
  overlayOpen: boolean
  /** The event target is within the command-input wrapper (let it own arrows). */
  inCmdInput: boolean
}

/**
 * Map a key press to an in-game action, given focus/overlay context. Pure — the
 * exact routing rules from GameScreen.onKeyDown, extracted so the keyboard
 * matrix (and its many guards) is unit-tested. The caller preventDefault()s for
 * any action other than `none` and dispatches the side effect.
 */
export function routeGameKey(key: string, ctx: GameKeyContext): GameKeyAction {
  const k = key.toLowerCase()

  // Escape closes an open overlay (otherwise it's not ours).
  if (key === 'Escape') {
    return ctx.overlayOpen ? { type: 'closeOverlay' } : { type: 'none' }
  }

  // Tab: autocomplete while typing, hold-to-view scoreboard otherwise.
  if (key === 'Tab') {
    return ctx.isInputFocused ? { type: 'autocomplete' } : { type: 'showScoreboard' }
  }

  // S toggles the shop — but not while typing (let the 's' character through).
  if (k === 's') {
    return ctx.isInputFocused ? { type: 'none' } : { type: 'toggleShop' }
  }

  // Everything below is an in-world action: suppressed while typing or while an
  // overlay is open, so the player never acts blind behind the shop/scoreboard.
  if (ctx.isInputFocused || ctx.overlayOpen) return { type: 'none' }

  if (k === 'q' || k === 'w' || k === 'e' || k === 'r') return { type: 'quickAbility', key: k }

  const slot = Number.parseInt(key, 10)
  if (slot >= 1 && slot <= 6) return { type: 'useItem', index: slot - 1 }

  if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight') {
    return ctx.inCmdInput ? { type: 'none' } : { type: 'move', direction: key }
  }

  return { type: 'none' }
}
