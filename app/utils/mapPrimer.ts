import type { ZoneDisplay } from '~/components/game/asciiMapModel'
import { ZONES } from '~~/shared/constants/zones'

/**
 * A static, fully-revealed `ZoneDisplay[]` for the /learn map primer — every
 * zone of the canonical 5v5 topology with no players/enemies/fog, towers shown
 * alive, and Roshan marked on its pit. It lets a newcomer explore the map and
 * its adjacency before ever queueing, reusing the in-game AsciiMap renderer.
 *
 * Pure + data-driven from `ZONES`, so the teaching map can't drift from the
 * real one. (Towers always render alive here — this is a topology primer, not
 * live state.)
 */
export function buildMapPrimerZones(): ZoneDisplay[] {
  return ZONES.map((z) => {
    const display: ZoneDisplay = {
      id: z.id,
      name: z.name,
      playerHere: false,
      allies: [],
      enemyCount: 0,
      fogged: false,
    }
    if (z.tower && (z.team === 'radiant' || z.team === 'dire')) {
      display.tower = { team: z.team, alive: true, tier: z.tier ?? 1 }
    }
    if (z.id === 'roshan-pit') {
      display.roshan = { alive: true, respawnIn: 0 }
    }
    return display
  })
}
