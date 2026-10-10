import { and, eq, sql } from 'drizzle-orm'
import { liveGames, type LiveGameRoster } from '~~/server/db/schema'
import type { LiveGamesRepo } from '~~/server/workflows/gameTickCore'
import type { AblyBatchSpec } from '~~/server/utils/ablyRest'
import { authLog } from '~~/server/utils/log'
import {
  GAME_SESSION_CHANGED,
  GAME_SESSION_CHANGED_MESSAGE,
  isGuestId,
} from '~~/server/utils/guest'
import type { TeamId } from '~~/shared/types/game'

/** CAS attempts against a ticking game before giving up (each loss means a tick
 *  committed in between — the next read sees it). */
const MAX_ATTEMPTS = 3

export interface GuestPracticeEndDeps {
  /** Live games whose roster names `playerId`. */
  findGameIds(playerId: string): Promise<string[]>
  repo: Pick<LiveGamesRepo, 'get' | 'casUpdate'>
  publish(specs: AblyBatchSpec[]): Promise<void>
}

async function productionDeps(): Promise<GuestPracticeEndDeps> {
  const [{ useDb }, core, ably] = await Promise.all([
    import('~~/server/db'),
    import('~~/server/workflows/gameTickCore'),
    import('~~/server/utils/ablyRest'),
  ])
  const d = useDb()
  return {
    async findGameIds(playerId) {
      const rows = await d
        .select({ gameId: liveGames.gameId })
        .from(liveGames)
        .where(
          and(
            eq(liveGames.mode, 'tutorial'),
            sql`${liveGames.roster}->'players' @> ${JSON.stringify([{ playerId }])}::jsonb`,
          ),
        )
      return rows.map((r) => r.gameId)
    },
    repo: core.liveGamesRepo(d as unknown as Parameters<typeof core.liveGamesRepo>[0]),
    publish: ably.ablyPublishBatch,
  }
}

/**
 * End the practice game(s) a guest left running when that guest signed in or
 * registered (the session's `formerGuestId`). Without this the guest's game
 * kept ticking on its Workflow clock for nobody, every 4s, until the AFK rules
 * caught up with it.
 *
 * The row goes to phase 'ended' with the cycle column bumped: a tick already in
 * flight then loses its CAS, re-reads, sees 'ended' and the run finalizes —
 * as practice, so no match, stats or replay is recorded (gameTickCore
 * isPracticeGame) — and stops. `runEpoch`/`consumedActionIds` ride along
 * untouched. The old tab hears it on the guest's own channel as an `error`
 * with the same code and words the 409 from /api/game/action carries.
 *
 * Practice (`tutorial`-mode) games only: a guest can play nothing else. Never
 * throws — a sign-in must not fail over a stale practice game. Returns the ids
 * it ended.
 */
export async function endFormerGuestPractice(
  guestId: string,
  deps?: GuestPracticeEndDeps,
): Promise<string[]> {
  if (!isGuestId(guestId)) return []
  const ended: string[] = []
  try {
    const d = deps ?? (await productionDeps())
    for (const gameId of await d.findGameIds(guestId)) {
      if (await endOne(d, gameId, guestId)) ended.push(gameId)
    }
    if (ended.length > 0) {
      await d
        .publish(
          ended.map((gameId) => ({
            channel: `game:${gameId}:p:${guestId}`,
            name: 'error',
            data: { code: GAME_SESSION_CHANGED, message: GAME_SESSION_CHANGED_MESSAGE },
          })),
        )
        .catch((err: unknown) => {
          authLog.warn('Could not tell the old tab its guest practice ended', {
            guestId,
            err: String(err),
          })
        })
    }
  } catch (err) {
    authLog.warn('Could not end the former guest’s practice game', { guestId, err: String(err) })
  }
  return ended
}

async function endOne(d: GuestPracticeEndDeps, gameId: string, guestId: string): Promise<boolean> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const row = await d.repo.get(gameId)
    if (!row || row.mode !== 'tutorial') return false
    const next = abandonedState(row.state, row.roster, guestId)
    if (!next) return false
    // No epoch fence: this is not the run. The cycle bump is the fence.
    if (await d.repo.casUpdate(gameId, row.cycle, next, row.cycle + 1)) {
      authLog.info('Ended a former guest’s practice game on sign-in', { gameId, guestId })
      return true
    }
  }
  return false
}

/** The row's state with the game over (the guest's side loses), or null when
 *  it is already over or the guest is not on it. */
function abandonedState(
  state: Record<string, unknown>,
  roster: LiveGameRoster,
  guestId: string,
): Record<string, unknown> | null {
  if (state.phase === 'ended') return null
  const team = roster.players.find((p) => p.playerId === guestId)?.team
  if (!team) return null
  const winner: TeamId = team === 'chaff' ? 'audit' : 'chaff'
  return { ...state, phase: 'ended', winner }
}
