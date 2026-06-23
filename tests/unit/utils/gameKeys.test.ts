import { describe, it, expect } from 'vitest'
import { routeGameKey, type GameKeyContext } from '../../../app/utils/gameKeys'

const ctx = (over: Partial<GameKeyContext> = {}): GameKeyContext => ({
  isInputFocused: false,
  overlayOpen: false,
  inCmdInput: false,
  ...over,
})

describe('routeGameKey', () => {
  describe('Escape', () => {
    it('closes an open overlay, else does nothing', () => {
      expect(routeGameKey('Escape', ctx({ overlayOpen: true }))).toEqual({ type: 'closeOverlay' })
      expect(routeGameKey('Escape', ctx())).toEqual({ type: 'none' })
    })
  })

  describe('Tab', () => {
    it('autocompletes while typing, shows scoreboard otherwise', () => {
      expect(routeGameKey('Tab', ctx({ isInputFocused: true }))).toEqual({ type: 'autocomplete' })
      expect(routeGameKey('Tab', ctx())).toEqual({ type: 'showScoreboard' })
    })
  })

  describe('S (shop)', () => {
    it('toggles the shop — even while an overlay is open — but never while typing', () => {
      expect(routeGameKey('s', ctx())).toEqual({ type: 'toggleShop' })
      expect(routeGameKey('S', ctx())).toEqual({ type: 'toggleShop' })
      expect(routeGameKey('s', ctx({ overlayOpen: true }))).toEqual({ type: 'toggleShop' })
      // while typing, 's' is a literal character — not a hotkey
      expect(routeGameKey('s', ctx({ isInputFocused: true }))).toEqual({ type: 'none' })
    })
  })

  describe('in-world actions are suppressed while typing or behind an overlay', () => {
    it('q/w/e/r and 1-6 and arrows do nothing when input focused or overlay open', () => {
      for (const c of [ctx({ isInputFocused: true }), ctx({ overlayOpen: true })]) {
        expect(routeGameKey('q', c)).toEqual({ type: 'none' })
        expect(routeGameKey('3', c)).toEqual({ type: 'none' })
        expect(routeGameKey('ArrowUp', c)).toEqual({ type: 'none' })
      }
    })
  })

  describe('abilities', () => {
    it('routes q/w/e/r (case-insensitive) to quickAbility with the lowercased key', () => {
      expect(routeGameKey('q', ctx())).toEqual({ type: 'quickAbility', key: 'q' })
      expect(routeGameKey('R', ctx())).toEqual({ type: 'quickAbility', key: 'r' })
    })
  })

  describe('item slots', () => {
    it('routes 1-6 to a zero-based item index, ignores 0/7+', () => {
      expect(routeGameKey('1', ctx())).toEqual({ type: 'useItem', index: 0 })
      expect(routeGameKey('6', ctx())).toEqual({ type: 'useItem', index: 5 })
      expect(routeGameKey('0', ctx())).toEqual({ type: 'none' })
      expect(routeGameKey('7', ctx())).toEqual({ type: 'none' })
    })
  })

  describe('arrow movement', () => {
    it('routes arrows to move, unless inside the command input (which owns arrows)', () => {
      expect(routeGameKey('ArrowUp', ctx())).toEqual({ type: 'move', direction: 'ArrowUp' })
      expect(routeGameKey('ArrowRight', ctx())).toEqual({ type: 'move', direction: 'ArrowRight' })
      expect(routeGameKey('ArrowUp', ctx({ inCmdInput: true }))).toEqual({ type: 'none' })
    })
  })

  it('ignores unmapped keys', () => {
    expect(routeGameKey('x', ctx())).toEqual({ type: 'none' })
    expect(routeGameKey('Enter', ctx())).toEqual({ type: 'none' })
  })
})
