import { Effect, Duration } from 'effect'
import type { RedisServiceApi } from '~~/server/services/RedisService'
import type { WebSocketServiceApi } from '~~/server/services/WebSocketService'
import type { DatabaseServiceApi } from '~~/server/services/DatabaseService'
import type { TeamId } from '~~/shared/types/game'
import type { QueueEntry, QueueMode } from './queue'
import { HERO_IDS, isHeroId } from '~~/shared/constants/heroes'
import { mapIdForMode } from '~~/shared/constants/maps'
import { isBot, createBotPlayers } from '~~/server/game/ai/BotManager'
import { sendToPeer } from '~~/server/services/PeerRegistry'
import { lobbyLog } from '~~/server/utils/log'

const PICK_TIME_SECONDS = 15
const PICK_TIME_MS = PICK_TIME_SECONDS * 1000
const BOT_PICK_DELAY_MS = 1500
const BAN_TIME_SECONDS = 15
const BAN_TIME_MS = BAN_TIME_SECONDS * 1000
const BOT_BAN_DELAY_MS = 1500

const AVAILABLE_HEROES = [...HERO_IDS]

export interface LobbyPlayer {
  playerId: string
  username: string
  mmr: number
  team: TeamId
  heroId: string | null
  ready: boolean
}

export interface Lobby {
  id: string
  players: LobbyPlayer[]
  pickedHeroes: Set<string>
  /** Heroes removed from the draft during the ban phase (unpickable). */
  bannedHeroes: Set<string>
  /** Player indices (into `players`) in ban order; empty = no ban phase. */
  banOrder: number[]
  currentBanIndex: number
  pickOrder: number[]
  currentPickIndex: number
  pickTimer: ReturnType<typeof setTimeout> | null
  /** Timer for the 1.5s delay between the last pick and the ready-check
   *  transition. Tracked separately from pickTimer so cancelLobby can clear
   *  it — otherwise an orphaned timeout fires startReadyCheck on a cancelled
   *  lobby and publishes game_ready for a match that was already cancelled. */
  transitionTimer: ReturnType<typeof setTimeout> | null
  phase: 'banning' | 'picking' | 'ready_check' | 'starting' | 'cancelled'
  /** The queue mode this lobby was formed from. Drives the map (5v5 → 3 lanes,
   *  3v3 → 2 lanes, 1v1 → 1 lane) via mapIdForMode when the game is created. */
  mode: QueueMode
}

const activeLobbies = new Map<string, Lobby>()
const playerToLobby = new Map<string, string>()

export function getPlayerLobby(playerId: string): string | undefined {
  return playerToLobby.get(playerId)
}

function generateId(): string {
  return `lobby_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

// Alternating pick order for 10 players (indices 0-9):
// Team 1: indices 0-4 (radiant), Team 2: indices 5-9 (dire)
// Pick order: R1, D1, D2, R2, R3, D3, D4, R4, R5, D5
const PICK_SEQUENCE_10 = [0, 5, 6, 1, 2, 7, 8, 3, 4, 9]

// Snake pick order for a 6-player draft (3v3). With the snake team split
// R={0,3,4}, D={1,2,5}, a snake draft is R1, D1, D2, R2, R3, D3 = 0,1,2,3,4,5.
const PICK_SEQUENCE_6 = [0, 1, 2, 3, 4, 5]

// Snake pick order for a 2-player draft (1v1): radiant = 0, dire = 1.
const PICK_SEQUENCE_2 = [0, 1]

/** Resolve the snake pick order for a roster size. Falls back to a plain
 *  sequential order for sizes without a hand-tuned sequence so a lobby is
 *  always fully draftable. */
function pickSequenceFor(playerCount: number): number[] {
  if (playerCount === 10) return PICK_SEQUENCE_10
  if (playerCount === 6) return PICK_SEQUENCE_6
  if (playerCount === 2) return PICK_SEQUENCE_2
  // Fallback: a plain sequential order (each player picks once, in roster order).
  return Array.from({ length: playerCount }, (_, i) => i)
}

// Ban order: player indices (into `players`) alternating teams. snakeDraftTeams
// splits radiant={0,3,4,7,8} / dire={1,2,5,6,9} for 10 players, so these pick
// the first two of each team in an R,D,R,D rhythm (2 bans per side).
const BAN_SEQUENCE_10 = [0, 1, 3, 2]
// 3v3 (radiant={0,3,4}, dire={1,2,5}): one ban per side.
const BAN_SEQUENCE_6 = [0, 1]
// 1v1: no bans.
const BAN_SEQUENCE_2: number[] = []

/** Resolve the ban order for a roster size. Empty = no ban phase (the lobby
 *  goes straight to picking). */
function banSequenceFor(playerCount: number): number[] {
  if (playerCount === 10) return BAN_SEQUENCE_10
  if (playerCount === 6) return BAN_SEQUENCE_6
  return BAN_SEQUENCE_2
}

function snakeDraftTeams(sortedByMmr: QueueEntry[]): LobbyPlayer[] {
  // Snake order interleaves teams so MMR is balanced across the draft (highest
  // two go to opposite teams, next two swap, etc.). Sliced for smaller rosters
  // so 6/4/2-player lobbies keep the same alternating rhythm.
  const snakeOrder = [0, 1, 1, 0, 0, 1, 1, 0, 0, 1]
  return sortedByMmr.map((entry, i) => ({
    playerId: entry.playerId,
    username: entry.username,
    mmr: entry.mmr,
    team: snakeOrder[i] === 0 ? 'radiant' : ('dire' as TeamId),
    heroId: null,
    ready: false,
  }))
}

export function createLobby(
  queueEntries: QueueEntry[],
  ws: WebSocketServiceApi,
  redis: RedisServiceApi,
  db: DatabaseServiceApi,
): Lobby {
  const lobbyId = generateId()

  const sorted = [...queueEntries].sort((a, b) => b.mmr - a.mmr)
  const players = snakeDraftTeams(sorted)
  // All entries share a mode (they came from one queue); fall back to 5v5 if a
  // mixed bag is ever passed in.
  const mode = queueEntries[0]?.mode ?? 'ranked_5v5'

  // Larger drafts open with a ban phase; 1v1 (and any size without a tuned ban
  // sequence) skips straight to picking.
  const banOrder = banSequenceFor(players.length)

  const lobby: Lobby = {
    id: lobbyId,
    players,
    pickedHeroes: new Set(),
    bannedHeroes: new Set(),
    banOrder,
    currentBanIndex: 0,
    pickOrder: pickSequenceFor(players.length),
    currentPickIndex: 0,
    pickTimer: null,
    transitionTimer: null,
    phase: banOrder.length > 0 ? 'banning' : 'picking',
    mode,
  }

  activeLobbies.set(lobbyId, lobby)

  for (const p of players) {
    playerToLobby.set(p.playerId, lobbyId)
  }

  lobbyLog.info('Lobby created', { lobbyId, playerCount: players.length })

  const allPlayers = players.map((p) => ({
    playerId: p.playerId,
    username: p.username,
    team: p.team,
    heroId: p.heroId,
  }))

  for (const p of players) {
    if (isBot(p.playerId)) continue
    sendToPeer(p.playerId, {
      type: 'lobby_state',
      lobbyId,
      team: p.team,
      players: allPlayers,
      phase: lobby.phase === 'banning' ? 'banning' : 'picking',
      bans: [],
    })
  }

  if (lobby.phase === 'banning') {
    startBanTimer(lobby, ws, redis, db)
  } else {
    startPickTimer(lobby, ws, redis, db)
  }

  return lobby
}

/**
 * Create a co-op-vs-bots lobby for a party (or a solo player). The party members
 * take radiant; bots fill radiant up to 5 and all of dire, so it's always a 5v5
 * with the humans together on one team. Casual: no ban phase, and the resulting
 * match is labelled casual_5v5 at game-over (it contains bots → no MMR).
 */
export function createCoopLobby(
  members: { playerId: string; username: string; mmr: number }[],
  ws: WebSocketServiceApi,
  redis: RedisServiceApi,
  db: DatabaseServiceApi,
): Lobby {
  const lobbyId = generateId()
  const avgMmr = members.length
    ? Math.round(members.reduce((s, m) => s + m.mmr, 0) / members.length)
    : 1000

  const players: LobbyPlayer[] = members.map((m) => ({
    playerId: m.playerId,
    username: m.username,
    mmr: m.mmr,
    team: 'radiant' as TeamId,
    heroId: null,
    ready: false,
  }))

  const radiantBotsNeeded = Math.max(0, 5 - members.length)
  const direBotsNeeded = 5
  const botEntries = createBotPlayers(
    radiantBotsNeeded + direBotsNeeded,
    members.map((m) => m.playerId),
    avgMmr,
  )
  botEntries.forEach((b, i) => {
    players.push({
      playerId: b.playerId,
      username: b.username,
      mmr: b.mmr,
      team: i < radiantBotsNeeded ? ('radiant' as TeamId) : ('dire' as TeamId),
      heroId: null,
      ready: false,
    })
  })

  const lobby: Lobby = {
    id: lobbyId,
    players,
    pickedHeroes: new Set(),
    bannedHeroes: new Set(),
    banOrder: [], // casual co-op skips bans
    currentBanIndex: 0,
    pickOrder: pickSequenceFor(players.length),
    currentPickIndex: 0,
    pickTimer: null,
    transitionTimer: null,
    phase: 'picking',
    mode: 'ranked_5v5', // relabelled casual_5v5 at game-over (hasBots)
  }

  activeLobbies.set(lobbyId, lobby)
  for (const p of players) {
    playerToLobby.set(p.playerId, lobbyId)
  }

  lobbyLog.info('Co-op lobby created', {
    lobbyId,
    humans: members.length,
    players: players.length,
  })

  const allPlayers = players.map((p) => ({
    playerId: p.playerId,
    username: p.username,
    team: p.team,
    heroId: p.heroId,
  }))
  for (const p of players) {
    if (isBot(p.playerId)) continue
    sendToPeer(p.playerId, {
      type: 'lobby_state',
      lobbyId,
      team: p.team,
      players: allPlayers,
      phase: 'picking',
      bans: [],
    })
  }

  startPickTimer(lobby, ws, redis, db)
  return lobby
}

function pickRandomHero(lobby: Lobby): string {
  // Prefer unpicked, unbanned heroes; fall back to the full pool only if the
  // draft is somehow exhausted.
  const available = AVAILABLE_HEROES.filter(
    (h) => !lobby.pickedHeroes.has(h) && !lobby.bannedHeroes.has(h),
  )
  const pool = available.length > 0 ? available : AVAILABLE_HEROES
  return pool[Math.floor(Math.random() * pool.length)]!
}

/** Pick a random hero to ban (bots / ban timeout). Avoids heroes already banned
 *  or picked unless the pool is somehow exhausted. */
function pickRandomBan(lobby: Lobby): string {
  const available = AVAILABLE_HEROES.filter(
    (h) => !lobby.bannedHeroes.has(h) && !lobby.pickedHeroes.has(h),
  )
  const pool = available.length > 0 ? available : AVAILABLE_HEROES
  return pool[Math.floor(Math.random() * pool.length)]!
}

function startBanTimer(
  lobby: Lobby,
  ws: WebSocketServiceApi,
  redis: RedisServiceApi,
  db: DatabaseServiceApi,
): void {
  if (lobby.pickTimer) clearTimeout(lobby.pickTimer)

  // Tell all clients whose turn it is to ban + the authoritative deadline so the
  // ban countdown is server-synced instead of a drifting client timer.
  const turnIdx = lobby.banOrder[lobby.currentBanIndex]
  const turnPlayer = turnIdx !== undefined ? lobby.players[turnIdx] : undefined
  if (turnPlayer) {
    const turnIsBot = isBot(turnPlayer.playerId)
    for (const p of lobby.players) {
      if (isBot(p.playerId)) continue
      sendToPeer(p.playerId, {
        type: 'ban_turn',
        playerId: turnPlayer.playerId,
        username: turnPlayer.username,
        timeRemainingMs: turnIsBot ? BOT_BAN_DELAY_MS : BAN_TIME_MS,
      })
    }
  }

  // If the current banner is a bot, auto-ban after a visible delay.
  const banIdx = lobby.banOrder[lobby.currentBanIndex]
  if (banIdx !== undefined) {
    const player = lobby.players[banIdx]
    if (player && isBot(player.playerId)) {
      const randomHero = pickRandomBan(lobby)
      lobby.pickTimer = setTimeout(
        () => confirmBan(lobby, player.playerId, randomHero, ws, redis, db),
        BOT_BAN_DELAY_MS,
      )
      return
    }
  }

  lobby.pickTimer = setTimeout(() => {
    // Auto-ban a random hero on timeout.
    const idx = lobby.banOrder[lobby.currentBanIndex]
    if (idx === undefined) return
    const player = lobby.players[idx]
    if (!player) return
    confirmBan(lobby, player.playerId, pickRandomBan(lobby), ws, redis, db)
  }, BAN_TIME_MS)
}

export function banHero(
  lobbyId: string,
  playerId: string,
  heroId: string,
  ws: WebSocketServiceApi,
  redis: RedisServiceApi,
  db: DatabaseServiceApi,
): { success: boolean; error?: string } {
  const lobby = activeLobbies.get(lobbyId)
  if (!lobby) return { success: false, error: 'Lobby not found' }
  if (lobby.phase !== 'banning') return { success: false, error: 'Not in banning phase' }

  const banIdx = lobby.banOrder[lobby.currentBanIndex]
  if (banIdx === undefined) return { success: false, error: 'Invalid ban index' }
  const currentBanner = lobby.players[banIdx]
  if (!currentBanner || currentBanner.playerId !== playerId) {
    return { success: false, error: 'Not your turn to ban' }
  }

  if (!isHeroId(heroId)) return { success: false, error: 'Invalid hero' }
  if (lobby.bannedHeroes.has(heroId)) return { success: false, error: 'Hero already banned' }
  if (lobby.pickedHeroes.has(heroId)) return { success: false, error: 'Hero already picked' }

  confirmBan(lobby, playerId, heroId, ws, redis, db)
  lobbyLog.debug('Hero banned', { lobbyId, playerId, heroId })
  return { success: true }
}

function confirmBan(
  lobby: Lobby,
  playerId: string,
  heroId: string,
  ws: WebSocketServiceApi,
  redis: RedisServiceApi,
  db: DatabaseServiceApi,
): void {
  lobby.bannedHeroes.add(heroId)

  for (const p of lobby.players) {
    if (isBot(p.playerId)) continue
    sendToPeer(p.playerId, { type: 'hero_ban', playerId, heroId })
  }

  lobby.currentBanIndex++

  // All bans done → flip to the pick phase and re-broadcast so clients swap the
  // ban UI for the pick UI.
  if (lobby.currentBanIndex >= lobby.banOrder.length) {
    if (lobby.pickTimer) clearTimeout(lobby.pickTimer)
    lobby.phase = 'picking'
    const allPlayers = lobby.players.map((p) => ({
      playerId: p.playerId,
      username: p.username,
      team: p.team,
      heroId: p.heroId,
    }))
    for (const p of lobby.players) {
      if (isBot(p.playerId)) continue
      sendToPeer(p.playerId, {
        type: 'lobby_state',
        lobbyId: lobby.id,
        team: p.team,
        players: allPlayers,
        phase: 'picking',
        bans: [...lobby.bannedHeroes],
      })
    }
    startPickTimer(lobby, ws, redis, db)
    return
  }

  startBanTimer(lobby, ws, redis, db)
}

function startPickTimer(
  lobby: Lobby,
  ws: WebSocketServiceApi,
  redis: RedisServiceApi,
  db: DatabaseServiceApi,
): void {
  if (lobby.pickTimer) clearTimeout(lobby.pickTimer)

  // Tell all clients whose turn it is and the authoritative deadline so the
  // pick countdown is server-synced instead of a drifting client timer.
  const turnIdx = lobby.pickOrder[lobby.currentPickIndex]
  const turnPlayer = turnIdx !== undefined ? lobby.players[turnIdx] : undefined
  if (turnPlayer) {
    const turnIsBot = isBot(turnPlayer.playerId)
    for (const p of lobby.players) {
      if (isBot(p.playerId)) continue
      sendToPeer(p.playerId, {
        type: 'pick_turn',
        playerId: turnPlayer.playerId,
        username: turnPlayer.username,
        timeRemainingMs: turnIsBot ? BOT_PICK_DELAY_MS : PICK_TIME_MS,
      })
    }
  }

  // If current picker is a bot, auto-pick after a visible delay
  const pickIdx = lobby.pickOrder[lobby.currentPickIndex]
  if (pickIdx !== undefined) {
    const player = lobby.players[pickIdx]
    if (player && !player.heroId && isBot(player.playerId)) {
      const randomHero = pickRandomHero(lobby)
      lobbyLog.debug('Bot picking hero', {
        lobbyId: lobby.id,
        playerId: player.playerId,
        heroId: randomHero,
      })
      lobby.pickTimer = setTimeout(
        () => confirmPick(lobby, player.playerId, randomHero, ws, redis, db),
        BOT_PICK_DELAY_MS,
      )
      return
    }
  }

  lobby.pickTimer = setTimeout(() => {
    // Auto-pick random hero on timeout
    const pickIdx = lobby.pickOrder[lobby.currentPickIndex]
    if (pickIdx === undefined) return
    const player = lobby.players[pickIdx]
    if (!player || player.heroId) return

    const randomHero = pickRandomHero(lobby)
    confirmPick(lobby, player.playerId, randomHero, ws, redis, db)
  }, PICK_TIME_MS)
}

export function pickHero(
  lobbyId: string,
  playerId: string,
  heroId: string,
  ws: WebSocketServiceApi,
  redis: RedisServiceApi,
  db: DatabaseServiceApi,
): { success: boolean; error?: string } {
  const lobby = activeLobbies.get(lobbyId)
  if (!lobby) return { success: false, error: 'Lobby not found' }
  if (lobby.phase !== 'picking') return { success: false, error: 'Not in picking phase' }

  // Check it's this player's turn
  const pickIdx = lobby.pickOrder[lobby.currentPickIndex]
  if (pickIdx === undefined) return { success: false, error: 'Invalid pick index' }
  const currentPicker = lobby.players[pickIdx]
  if (!currentPicker || currentPicker.playerId !== playerId) {
    return { success: false, error: 'Not your turn to pick' }
  }

  if (!isHeroId(heroId)) {
    return { success: false, error: 'Invalid hero' }
  }

  // Banned heroes are unpickable.
  if (lobby.bannedHeroes.has(heroId)) {
    return { success: false, error: 'Hero is banned' }
  }

  // Check hero is available (allow duplicates when all unique heroes are exhausted)
  const available = AVAILABLE_HEROES.filter((h) => !lobby.pickedHeroes.has(h))
  if (available.length > 0 && lobby.pickedHeroes.has(heroId)) {
    return { success: false, error: 'Hero already picked' }
  }

  confirmPick(lobby, playerId, heroId, ws, redis, db)
  lobbyLog.debug('Hero picked', { lobbyId, playerId, heroId })
  return { success: true }
}

function confirmPick(
  lobby: Lobby,
  playerId: string,
  heroId: string,
  ws: WebSocketServiceApi,
  redis: RedisServiceApi,
  db: DatabaseServiceApi,
): void {
  const player = lobby.players.find((p) => p.playerId === playerId)
  if (!player) return

  player.heroId = heroId
  lobby.pickedHeroes.add(heroId)

  // Broadcast pick to all players in lobby
  for (const p of lobby.players) {
    if (isBot(p.playerId)) continue
    sendToPeer(p.playerId, {
      type: 'hero_pick',
      playerId,
      heroId,
    })
  }

  lobby.currentPickIndex++

  // Check if all heroes are picked
  if (lobby.currentPickIndex >= lobby.pickOrder.length) {
    if (lobby.pickTimer) clearTimeout(lobby.pickTimer)
    // Brief delay so the UI can display the last hero pick before transitioning
    lobby.transitionTimer = setTimeout(() => {
      lobby.phase = 'ready_check'
      startReadyCheck(lobby, ws, redis, db)
    }, 1500)
    return
  }

  // Start next pick timer
  startPickTimer(lobby, ws, redis, db)
}

function startReadyCheck(
  lobby: Lobby,
  ws: WebSocketServiceApi,
  redis: RedisServiceApi,
  _db: DatabaseServiceApi,
): void {
  // For now, auto-ready all players and transition to game
  for (const p of lobby.players) {
    p.ready = true
  }

  lobby.phase = 'starting'

  lobbyLog.info('Ready check started', { lobbyId: lobby.id })

  // Send 3-second countdown to all real players
  for (const p of lobby.players) {
    if (isBot(p.playerId)) continue
    sendToPeer(p.playerId, {
      type: 'game_countdown',
      seconds: 3,
    })
  }

  // Transition to game after 3s countdown (publish to Redis for game engine to pick up)
  const gameData = {
    lobbyId: lobby.id,
    mode: lobby.mode,
    mapId: mapIdForMode(lobby.mode),
    players: lobby.players.map((p) => ({
      playerId: p.playerId,
      team: p.team,
      heroId: p.heroId!,
      mmr: p.mmr,
    })),
  }

  Effect.runPromise(
    Effect.sleep(Duration.seconds(3)).pipe(
      Effect.andThen(() => {
        // Re-check phase before publishing: cancelLobby (e.g. the disconnect
        // grace timer) can fire during this detached 3s sleep and set
        // phase='cancelled' synchronously. Without this guard a game_ready would
        // still publish and the game-server would spin up a full game for a
        // lobby that no longer exists.
        if (lobby.phase !== 'starting') {
          lobbyLog.info('Skipping game_ready — lobby no longer starting', {
            lobbyId: lobby.id,
            phase: lobby.phase,
          })
          return Effect.void
        }
        lobbyLog.info('Publishing game_ready', { lobbyId: lobby.id })
        return redis.publish('matchmaking:game_ready', JSON.stringify(gameData))
      }),
      Effect.catchAll((err) => {
        lobbyLog.error('Failed to publish game_ready', { lobbyId: lobby.id, error: String(err) })
        return Effect.void
      }),
    ),
  )

  if (lobby.pickTimer) clearTimeout(lobby.pickTimer)
  // NOTE: Do NOT delete the lobby from activeLobbies/playerToLobby here.
  // The game-server will call cleanupLobby() after the game is created.
  // This prevents a race where the poll returns 'searching' between lobby
  // end and game creation.
}

export function cleanupLobby(lobbyId: string): void {
  const lobby = activeLobbies.get(lobbyId)
  if (!lobby) return
  if (lobby.pickTimer) clearTimeout(lobby.pickTimer)
  if (lobby.transitionTimer) clearTimeout(lobby.transitionTimer)
  for (const p of lobby.players) {
    playerToLobby.delete(p.playerId)
  }
  activeLobbies.delete(lobbyId)
  lobbyLog.info('Lobby cleaned up', { lobbyId })
}

export function getLobby(lobbyId: string): Lobby | undefined {
  return activeLobbies.get(lobbyId)
}

/**
 * The `pick_turn` payload for a lobby's current picker, or null if it isn't in
 * the picking phase. Used to re-send whose-turn-it-is on (re)connect — without
 * this, a client that connects AFTER the pick_turn push (a refresh, or a seeded
 * draft) never learns it's their turn and CONFIRM stays disabled.
 */
export function currentPickTurn(
  lobby: Lobby,
): { type: 'pick_turn'; playerId: string; username: string; timeRemainingMs: number } | null {
  if (lobby.phase !== 'picking') return null
  const idx = lobby.pickOrder[lobby.currentPickIndex]
  const player = idx !== undefined ? lobby.players[idx] : undefined
  if (!player) return null
  return {
    type: 'pick_turn',
    playerId: player.playerId,
    username: player.username,
    timeRemainingMs: isBot(player.playerId) ? BOT_PICK_DELAY_MS : PICK_TIME_MS,
  }
}

/** Whose turn it is to ban (for reconnect recovery). Null outside the ban phase. */
export function currentBanTurn(
  lobby: Lobby,
): { type: 'ban_turn'; playerId: string; username: string; timeRemainingMs: number } | null {
  if (lobby.phase !== 'banning') return null
  const idx = lobby.banOrder[lobby.currentBanIndex]
  const player = idx !== undefined ? lobby.players[idx] : undefined
  if (!player) return null
  return {
    type: 'ban_turn',
    playerId: player.playerId,
    username: player.username,
    timeRemainingMs: isBot(player.playerId) ? BOT_BAN_DELAY_MS : BAN_TIME_MS,
  }
}

/**
 * Dev/test-only: build a draft lobby frozen at the human's pick turn, with the
 * bots ahead of them in the snake order already picked. No auto-pick timer — the
 * human's pick (via the normal `pickHero` path) RESUMES the real draft: the
 * remaining bots auto-pick and the lobby publishes `matchmaking:game_ready`
 * exactly as a live match would. This is the pre-game/draft analogue of
 * `createDevGame` (which seeds an in-progress game). Currently UNUSED — its only
 * caller was the removed `/api/test/new-draft` hook; kept for a future draft-seed
 * harness.
 *
 * `prepick` = how many snake-order slots are filled (by bots) before the human.
 * 9 ⇒ the human makes the FINAL pick, so a single confirm completes the draft
 * and starts the game; a smaller value leaves the human mid-draft.
 */
export function seedDraftLobby(opts: {
  humanId: string
  humanUsername: string
  prepick?: number
  mode?: QueueMode
}): Lobby {
  const prepick = Math.max(0, Math.min(PICK_SEQUENCE_10.length - 1, opts.prepick ?? 9))
  const lobbyId = generateId()
  const snakeOrder = [0, 1, 1, 0, 0, 1, 1, 0, 0, 1]
  const humanIndex = PICK_SEQUENCE_10[prepick]!

  let botCount = 0
  const players: LobbyPlayer[] = Array.from({ length: 10 }, (_, i) => {
    const team: TeamId = snakeOrder[i] === 0 ? 'radiant' : 'dire'
    if (i === humanIndex) {
      return {
        playerId: opts.humanId,
        username: opts.humanUsername,
        mmr: 5000,
        team,
        heroId: null,
        ready: false,
      }
    }
    botCount += 1
    return {
      playerId: `bot_draft${botCount}_${lobbyId}`,
      username: `Bot ${botCount}`,
      mmr: 1000,
      team,
      heroId: null,
      ready: false,
    }
  })

  const lobby: Lobby = {
    id: lobbyId,
    players,
    pickedHeroes: new Set(),
    // Seeded draft starts at the human's pick turn — the ban phase is skipped.
    bannedHeroes: new Set(),
    banOrder: [],
    currentBanIndex: 0,
    pickOrder: [...PICK_SEQUENCE_10],
    currentPickIndex: prepick,
    pickTimer: null,
    transitionTimer: null,
    phase: 'picking',
    // The seed hook is a 5v5 draft by default; tests can override to exercise
    // 3v3/1v1 map wiring end-to-end via the same path.
    mode: opts.mode ?? 'ranked_5v5',
  }

  // Pre-pick distinct heroes for the bots occupying the snake slots before the
  // human; leaves the rest (incl. the human's eventual pick) available.
  for (let k = 0; k < prepick; k++) {
    const slot = PICK_SEQUENCE_10[k]!
    const p = players[slot]!
    const hero = AVAILABLE_HEROES[k % AVAILABLE_HEROES.length]!
    p.heroId = hero
    lobby.pickedHeroes.add(hero)
  }

  activeLobbies.set(lobbyId, lobby)
  for (const p of players) playerToLobby.set(p.playerId, lobbyId)

  lobbyLog.info('Seeded draft lobby', { lobbyId, prepick, humanIndex, humanId: opts.humanId })
  return lobby
}

export function cancelLobby(lobbyId: string, _ws: WebSocketServiceApi): void {
  const lobby = activeLobbies.get(lobbyId)
  if (!lobby) return

  lobby.phase = 'cancelled'
  if (lobby.pickTimer) {
    clearTimeout(lobby.pickTimer)
    lobby.pickTimer = null
  }
  // Clear the ready-check transition timer too — otherwise an orphaned timeout
  // fires startReadyCheck on this cancelled lobby and publishes game_ready.
  if (lobby.transitionTimer) {
    clearTimeout(lobby.transitionTimer)
    lobby.transitionTimer = null
  }

  for (const p of lobby.players) {
    playerToLobby.delete(p.playerId)
    if (isBot(p.playerId)) continue
    // lobby_cancelled (not a bare announcement) so the client resets its lobby
    // store off the draft/found/starting screen — a generic toast left a
    // surviving drafter frozen with no in-app escape.
    sendToPeer(p.playerId, {
      type: 'lobby_cancelled',
      reason: 'Match cancelled — a player failed to load. Back to the menu.',
    })
  }

  activeLobbies.delete(lobbyId)
}

export function replacePlayerWithBot(
  lobbyId: string,
  playerId: string,
  botId: string,
): { success: boolean; error?: string } {
  const lobby = activeLobbies.get(lobbyId)
  if (!lobby) return { success: false, error: 'Lobby not found' }

  const player = lobby.players.find((p) => p.playerId === playerId)
  if (!player) return { success: false, error: 'Player not found' }

  // Keep the playerToLobby reverse-index consistent with the id swap, else the
  // human's entry leaks forever (cleanup iterates lobby.players by the NEW bot
  // id, which was never indexed). Bots aren't tracked in the index (cleanup
  // skips them), so just drop the human's entry.
  playerToLobby.delete(playerId)
  player.playerId = botId
  player.username = botId.replace('bot_', 'Bot ').replace(/\b\w/g, (c) => c.toUpperCase())

  for (const p of lobby.players) {
    if (isBot(p.playerId)) continue
    sendToPeer(p.playerId, {
      type: 'announcement',
      message: `${player.username} has been replaced by a bot.`,
      level: 'info',
    })
  }

  lobbyLog.info('Player replaced with bot', { lobbyId, playerId, botId })
  return { success: true }
}
