import { vi } from 'vitest'

/**
 * Stub `window.matchMedia` so `usePointerCoarse()` reports the given pointer
 * type. Call `vi.unstubAllGlobals()` (or `restorePointer`) in afterEach.
 */
export function mockPointer(coarse: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: coarse && query === '(pointer: coarse)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  )
}

export function restorePointer(): void {
  vi.unstubAllGlobals()
}

/** Simulate a tap outside everything (document body). */
export function tapOutside(): void {
  document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
}
