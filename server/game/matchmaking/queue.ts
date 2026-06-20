import { Effect } from 'effect'
import type { RedisServiceApi } from '~~/server/services/RedisService'
import type { WebSocketServiceApi } from '~~/server/services/WebSocketService'
import type { DatabaseServiceApi } from '~~/server/services/DatabaseService'
import { createLobby } from './lobby'
import { createBotPlayers, isBot } from '~~/server/game/ai/BotManager'
import { sendToPeer } from '~~/server/services/PeerRegistry'
import { matchLog } from '~~/server/utils/log'

const QUEUE_KEY = 'matchmaking:queue'
const QUEUE_TIMES_KEY = 'matchmaking:queue_times'
/** Hash mapping `${playerId}:${mode}` → the JSON member string in the sorted
 *  set, so leaveQueue can zrem directly without scanning + parsing the MMR
 *  window. O(1) leave instead of O(n). */
const QUEUE_MEMBERS_KEY = 'matchmaking:queue_members'
const MATCH_SIZE = 10
const MATCHMAKING_INTERVAL_MS = 5000
const BOT_FILL_WAIT_MS = 10_000
const MATCHMAKING_LOCK_KEY = 'matchmaking:lock'
const MATCHMAKING_LOCK_TTL_SECONDS = 5

const MMR_RANGES: { afterSeconds: number; range: number }[] = [
  { afterSeconds: 0, range: 50 },
  { afterSeconds: 30, range: 100 },
  { afterSeconds: 60, range: 200 },
  { afterSeconds: 120, range: 500 },
]

export interface QueueEntry {
  playerId: string
  username: string
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

export function joinQueue(redis: RedisServiceApi, entry: QueueEntry): Effect.Effect<void, Error> {
  const data = JSON.stringify(entry)
  const queueKey = `${QUEUE_KEY}:${entry.mode}`
  const queueTimeKey = `${QUEUE_TIMES_KEY}:${entry.playerId}:${entry.mode}`

  const luaScript = `
    local timeKey = KEYS[1]
    local queueKey = KEYS[2]
    local membersKey = KEYS[3]
    local playerId = ARGV[1]
    local score = tonumber(ARGV[2])
    local member = ARGV[3]
    local joinedAt = ARGV[4]
    local mode = ARGV[5]
    
    if redis.call('EXISTS', timeKey) == 1 then
      return 'DUPLICATE'
    end
    
    redis.call('SET', timeKey, joinedAt)
    redis.call('ZADD', queueKey, score, member)
    redis.call('HSET', membersKey, playerId .. ':' .. mode, member)
    return 'OK'
  `

  return Effect.gen(function* () {
    const result = yield* redis.eval(
      luaScript,
      [queueTimeKey, queueKey, QUEUE_MEMBERS_KEY],
      [entry.playerId, entry.mmr, data, String(entry.joinedAt), entry.mode],
    )

    if (result === 'DUPLICATE') {
      return yield* Effect.fail(new Error('already in queue'))
    }

    yield* Effect.logInfo('Player joined queue').pipe(
      Effect.annotateLogs({ playerId: entry.playerId, mmr: entry.mmr, mode: entry.mode }),
    )
  })
}

export function leaveQueue(
  redis: RedisServiceApi,
  playerId: string,
  _mmr: number,
  mode: 'ranked_5v5' | 'quick_3v3' | '1v1' = 'ranked_5v5',
): Effect.Effect<void> {
  const queueKey = `${QUEUE_KEY}:${mode}`
  const memberField = `${playerId}:${mode}`
  return Effect.gen(function* () {
    // O(1) leave: look up the member string from the hash and zrem directly,
    // instead of scanning + JSON.parsing the MMR window.
    const member = yield* redis.hget(QUEUE_MEMBERS_KEY, memberField)
    if (member) {
      yield* redis.zrem(queueKey, member)
      yield* redis.hdel(QUEUE_MEMBERS_KEY, memberField)
    }
    yield* redis.del(`${QUEUE_TIMES_KEY}:${playerId}:${mode}`)
    yield* Effect.logInfo('Player left queue').pipe(Effect.annotateLogs({ playerId }))
  })
}

async function tryFormMatch(
  redis: RedisServiceApi,
  ws: WebSocketServiceApi,
  db: DatabaseServiceApi,
): Promise<void> {
  const lockValue = `${Date.now()}_${Math.random()}`

  const program = Effect.gen(function* () {
    const acquired = yield* redis.setnx(
      MATCHMAKING_LOCK_KEY,
      lockValue,
      MATCHMAKING_LOCK_TTL_SECONDS,
    )
    if (acquired !== 1) {
      matchLog.debug('Could not acquire matchmaking lock, skipping')
      return
    }

    try {
      const modes: Array<'ranked_5v5' | 'quick_3v3' | '1v1'> = ['ranked_5v5', 'quick_3v3', '1v1']

      for (const mode of modes) {
        const queueKey = `${QUEUE_KEY}:${mode}`
        const queueSize = yield* redis.zcard(queueKey)

        if (queueSize === 0) continue

        const allEntries = yield* redis.zrangebyscore(queueKey, 0, 99999)
        const players: QueueEntry[] = allEntries.map((raw) => JSON.parse(raw))

        const now = Date.now()

        const rosterPlayers = players
          .filter((p) => !isBot(p.playerId))
          .map((p) => {
            const base = Math.round(p.mmr / 100) * 100
            return { username: p.username, mmrBracket: `${base - 100}-${base + 100}` }
          })

        for (const p of players) {
          if (!isBot(p.playerId)) {
            sendToPeer(p.playerId, {
              type: 'queue_update',
              playersInQueue: players.length,
              estimatedWaitSeconds: Math.max(
                0,
                Math.round((BOT_FILL_WAIT_MS - (now - p.joinedAt)) / 1000),
              ),
            })
            sendToPeer(p.playerId, {
              type: 'queue_roster',
              players: rosterPlayers,
              total: MATCH_SIZE,
            })
          }
        }

        if (players.length > 0 && players.length < MATCH_SIZE) {
          const longestWait = Math.max(...players.map((p) => now - p.joinedAt))
          if (longestWait >= BOT_FILL_WAIT_MS) {
            const botsNeeded = MATCH_SIZE - players.length
            matchLog.info('Filling with bots', { realPlayers: players.length, botsNeeded })
            for (const p of players) {
              if (!isBot(p.playerId)) {
                sendToPeer(p.playerId, {
                  type: 'queue_filling',
                  botsCount: botsNeeded,
                })
              }
            }

            const avgMmr = Math.round(players.reduce((sum, p) => sum + p.mmr, 0) / players.length)
            const botEntries = createBotPlayers(
              botsNeeded,
              players.map((p) => p.playerId),
              avgMmr,
            )
            const allPlayers = [...players, ...botEntries]

            for (const raw of allEntries) {
              yield* redis.zrem(queueKey, raw)
            }
            for (const p of players) {
              yield* redis.del(`${QUEUE_TIMES_KEY}:${p.playerId}:${mode}`)
              yield* redis.hdel(QUEUE_MEMBERS_KEY, `${p.playerId}:${mode}`)
            }

            createLobby(allPlayers, ws, redis, db)
            matchLog.info('Match formed with bots', {
              realPlayers: players.length,
              bots: botsNeeded,
            })
            return
          }
        }

        if (queueSize < MATCH_SIZE) continue
        if (players.length < MATCH_SIZE) continue

        players.sort((a, b) => a.mmr - b.mmr)

        for (let i = 0; i <= players.length - MATCH_SIZE; i++) {
          const group = players.slice(i, i + MATCH_SIZE)
          const minMmr = group[0]!.mmr
          const maxMmr = group[group.length - 1]!.mmr

          const allWithinRange = group.every((p) => {
            const waitTime = (now - p.joinedAt) / 1000
            const allowedRange = getMmrRange(waitTime)
            return maxMmr - minMmr <= allowedRange * 2
          })

          if (allWithinRange) {
            for (const p of group) {
              const raw = allEntries.find((r) => {
                const entry: QueueEntry = JSON.parse(r)
                return entry.playerId === p.playerId
              })
              if (raw) yield* redis.zrem(queueKey, raw)
            }
            for (const p of group) {
              yield* redis.del(`${QUEUE_TIMES_KEY}:${p.playerId}:${mode}`)
              yield* redis.hdel(QUEUE_MEMBERS_KEY, `${p.playerId}:${mode}`)
            }

            createLobby(group, ws, redis, db)
            matchLog.info('Match formed', { queueSize: players.length, matchSize: MATCH_SIZE })
            return
          }
        }
      }
    } finally {
      // Compare-and-delete: only release the lock if we still own it. The old
      // getdel would delete another instance's lock if our TTL expired and a
      // peer acquired it mid-run — a real correctness bug in multi-instance.
      yield* redis.eval(
        `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`,
        [MATCHMAKING_LOCK_KEY],
        [lockValue],
      )
    }
  })

  await Effect.runPromise(program).catch((err) => {
    matchLog.error('Matchmaking error forming match', { error: String(err) })
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

export function getQueueSize(
  redis: RedisServiceApi,
  mode?: 'ranked_5v5' | 'quick_3v3' | '1v1',
): Effect.Effect<number> {
  const queueKey = mode ? `${QUEUE_KEY}:${mode}` : `${QUEUE_KEY}:ranked_5v5`
  return redis.zcard(queueKey)
}

export function isPlayerInQueue(
  redis: RedisServiceApi,
  playerId: string,
  mode?: 'ranked_5v5' | 'quick_3v3' | '1v1',
): Effect.Effect<boolean> {
  const modes = mode ? [mode] : (['ranked_5v5', 'quick_3v3', '1v1'] as const)
  return Effect.gen(function* () {
    for (const m of modes) {
      const val = yield* redis.get(`${QUEUE_TIMES_KEY}:${playerId}:${m}`)
      if (val !== null) return true
    }
    return false
  })
}
