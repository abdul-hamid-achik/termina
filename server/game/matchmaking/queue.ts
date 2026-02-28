import { Effect } from 'effect'
import type { RedisServiceApi } from '../../services/RedisService'
import type { WebSocketServiceApi } from '../../services/WebSocketService'
import type { DatabaseServiceApi } from '../../services/DatabaseService'
import { createLobby } from './lobby'
import { createBotPlayers } from '../ai/BotManager'
import { matchLog } from '../../utils/log'

const QUEUE_KEY = 'matchmaking:queue'
const QUEUE_TIMES_KEY = 'matchmaking:queue_times'
const MATCH_SIZE = 10 // 5v5
const MATCHMAKING_INTERVAL_MS = 5000
const BOT_FILL_WAIT_MS = 10_000 // Fill with bots after 10s wait

// MMR range expansion over time
const MMR_RANGES: { afterSeconds: number; range: number }[] = [
  { afterSeconds: 0, range: 50 },
  { afterSeconds: 30, range: 100 },
  { afterSeconds: 60, range: 200 },
  { afterSeconds: 120, range: 500 },
]

export interface QueueEntry {
  playerId: string
  mmr: number
  joinedAt: number
  mode: 'ranked_5v5' | 'quick_3v3' | '1v1'
}

function getMmrRange(waitTimeSeconds: number): number {
  let range = MMR_RANGES[0]!.range
  for (const entry of MMR_RANGES) {
    if (waitTimeSeconds >= entry.afterSeconds) {
      range = entry.range
    }
  }
  return range
}

export function joinQueue(redis: RedisServiceApi, entry: QueueEntry): Effect.Effect<void> {
  const data = JSON.stringify(entry)
  return Effect.gen(function* () {
    yield* redis.zadd(QUEUE_KEY, entry.mmr, data)
    yield* redis.set(`${QUEUE_TIMES_KEY}:${entry.playerId}`, String(entry.joinedAt))
    yield* Effect.logInfo('Player joined queue').pipe(
      Effect.annotateLogs({ playerId: entry.playerId, mmr: entry.mmr, mode: entry.mode }),
    )
  })
}

export function leaveQueue(
  redis: RedisServiceApi,
  playerId: string,
  mmr: number,
): Effect.Effect<void> {
  return Effect.gen(function* () {
    // We need to find and remove the entry; search around the player's MMR
    const entries = yield* redis.zrangebyscore(QUEUE_KEY, mmr - 1000, mmr + 1000)
    for (const raw of entries) {
      const entry: QueueEntry = JSON.parse(raw)
      if (entry.playerId === playerId) {
        yield* redis.zrem(QUEUE_KEY, raw)
        break
      }
    }
    yield* redis.del(`${QUEUE_TIMES_KEY}:${playerId}`)
    yield* Effect.logInfo('Player left queue').pipe(Effect.annotateLogs({ playerId }))
  })
}

async function tryFormMatch(
  redis: RedisServiceApi,
  ws: WebSocketServiceApi,
  db: DatabaseServiceApi,
): Promise<void> {
  const program = Effect.gen(function* () {
    const queueSize = yield* redis.zcard(QUEUE_KEY)

    // Get all queued players
    const allEntries = yield* redis.zrangebyscore(QUEUE_KEY, 0, 99999)
    const players: QueueEntry[] = allEntries.map((raw) => JSON.parse(raw))

    const now = Date.now()

    // Bot fill: if any player has waited > BOT_FILL_WAIT_MS and we have at least 1 player
    if (players.length > 0 && players.length < MATCH_SIZE) {
      const longestWait = Math.max(...players.map((p) => now - p.joinedAt))
      if (longestWait >= BOT_FILL_WAIT_MS) {
        const botsNeeded = MATCH_SIZE - players.length
        matchLog.info('Filling with bots', { realPlayers: players.length, botsNeeded })
        const botEntries = createBotPlayers(
          botsNeeded,
          players.map((p) => p.playerId),
        )
        const allPlayers = [...players, ...botEntries]

        // Remove real players from queue
        for (const raw of allEntries) {
          yield* redis.zrem(QUEUE_KEY, raw)
        }
        for (const p of players) {
          yield* redis.del(`${QUEUE_TIMES_KEY}:${p.playerId}`)
        }

        createLobby(allPlayers, ws, redis, db)
        matchLog.info('Match formed with bots', { realPlayers: players.length, bots: botsNeeded })
        return
      }
    }

    if (queueSize < MATCH_SIZE) return
    if (players.length < MATCH_SIZE) return

    // Sort by MMR
    players.sort((a, b) => a.mmr - b.mmr)

    // Try to find a group of MATCH_SIZE players within acceptable MMR range
    for (let i = 0; i <= players.length - MATCH_SIZE; i++) {
      const group = players.slice(i, i + MATCH_SIZE)
      const minMmr = group[0]!.mmr
      const maxMmr = group[group.length - 1]!.mmr

      // Check if all players in this group have waited long enough for this range
      const allWithinRange = group.every((p) => {
        const waitTime = (now - p.joinedAt) / 1000
        const allowedRange = getMmrRange(waitTime)
        return maxMmr - minMmr <= allowedRange * 2
      })

      if (allWithinRange) {
        // Remove matched players from queue
        for (const p of group) {
          const raw = allEntries.find(r => {
            const entry: QueueEntry = JSON.parse(r)
            return entry.playerId === p.playerId
          })
          if (raw) yield* redis.zrem(QUEUE_KEY, raw)
        }
        for (const p of group) {
          yield* redis.del(`${QUEUE_TIMES_KEY}:${p.playerId}`)
        }

        // Create lobby
        createLobby(group, ws, redis, db)
        matchLog.info('Match formed', { queueSize: players.length, matchSize: MATCH_SIZE })
        return
      }
    }
  })

  await Effect.runPromise(program).catch((err) => {
    Effect.runPromise(
      Effect.logError('Matchmaking error forming match').pipe(
        Effect.annotateLogs({ error: String(err) }),
      ),
    )
  })
}

export function startMatchmakingLoop(
  redis: RedisServiceApi,
  ws: WebSocketServiceApi,
  db: DatabaseServiceApi,
): ReturnType<typeof setInterval> {
  return setInterval(() => {
    tryFormMatch(redis, ws, db)
  }, MATCHMAKING_INTERVAL_MS)
}

export function getQueueSize(redis: RedisServiceApi): Effect.Effect<number> {
  return redis.zcard(QUEUE_KEY)
}
