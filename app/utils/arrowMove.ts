export type ArrowDirection = 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'

/**
 * Pick the adjacent zone that lies in the pressed arrow direction, by the map's
 * zone-naming convention (rad/radiant = up, dire = down, top/jungle-rad = left,
 * bot/jungle-dire = right). Returns the FIRST adjacent zone matching the
 * direction, or null when none clearly lies that way — the caller then does
 * nothing rather than shoving the hero into an arbitrary (often wrong) zone.
 *
 * Pure (no map lookup / no side effects) so the directional heuristic is
 * unit-tested independently of GameScreen's keyboard handling.
 */
export function arrowTargetZone(direction: ArrowDirection, adjacent: string[]): string | null {
  switch (direction) {
    case 'ArrowUp':
      return (
        adjacent.find(
          (z) =>
            z.includes('rad') ||
            z.includes('t3-rad') ||
            z === 'radiant-base' ||
            z === 'radiant-fountain',
        ) ?? null
      )
    case 'ArrowDown':
      return (
        adjacent.find(
          (z) =>
            z.includes('dire') ||
            z.includes('t3-dire') ||
            z === 'dire-base' ||
            z === 'dire-fountain',
        ) ?? null
      )
    case 'ArrowLeft':
      return adjacent.find((z) => z.startsWith('top-') || z.startsWith('jungle-rad')) ?? null
    case 'ArrowRight':
      return adjacent.find((z) => z.startsWith('bot-') || z.startsWith('jungle-dire')) ?? null
  }
}
