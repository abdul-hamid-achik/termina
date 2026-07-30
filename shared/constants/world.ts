/**
 * World frame — the settled TERMINA canon (see CLAUDE.md "WORLD").
 * Single source of the frame strings so lore / index / learn / lobby
 * cannot drift. Copy here is player-facing prose, not identifiers.
 */
export const CITY = 'TERMINA'

export const DISTRICTS = ['LANDING', 'ROOKERY', 'COLDSTORE', 'SHALLOWS'] as const

export const ROUTES = ['SEAWALL', 'COLDSTORE', 'SHALLOWS'] as const

export const CREWS = { chaff: 'CHAFF', audit: 'AUDIT' } as const

export function cycleFrameLine(seconds: number): string {
  return `The city commits every instruction at once, ${seconds}s wide: one cycle.`
}
