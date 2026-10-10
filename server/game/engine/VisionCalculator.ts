import type {
  GameState,
  PlayerState,
  ZoneRuntimeState,
  FoggedPlayer,
  PlayerVisibleState,
  TeamId,
  GameEvent,
} from '~~/shared/types/game'
import { ZONE_MAP, ZONES } from '~~/shared/constants/zones'
import { SNIFFER_TRUE_SIGHT_RADIUS, NIGHT_VISION_PENALTY } from '~~/shared/constants/balance'
import { LOCATED_EVENT_TAGS } from '~~/server/game/protocol/events'

export type { FoggedPlayer, PlayerVisibleState }

/**
 * Exact set of buff IDs that grant invisibility/stealth to a player.
 *
 * Using a `ReadonlySet` with exact IDs avoids the fragile `b.id.includes('invis')`
 * substring match — a future buff like `not_invisible` or `invis_breaker` would
 * have wrongly matched the substring. Every ID here is a real buff applied by
 * production code (cache, Silver Edge, Blackout Can, cipher/daemon stealth).
 */
const INVISIBILITY_BUFF_IDS: ReadonlySet<string> = new Set([
  'invis', // Invisibility cache
  'invisible', // Legacy alias used in tests + some engine paths
  'ghostwire_edge_invis', // Silver Edge active
  'smoke', // Blackout Can
  'stealth', // Cipher W + Daemon passive
])

/** Each team's base + anchor, derived from the zone records. Home ground is
 *  always visible; hardcoding the four ids made that depend on the naming. */
const HOME_ZONES: Record<TeamId, string[]> = {
  chaff: ZONES.filter((z) => z.team === 'chaff' && (z.type === 'base' || z.type === 'anchor')).map(
    (z) => z.id,
  ),
  audit: ZONES.filter((z) => z.team === 'audit' && (z.type === 'base' || z.type === 'anchor')).map(
    (z) => z.id,
  ),
}

const ADJACENT_CACHE = new Map<string, string[]>()

for (const [zoneId, zoneData] of Object.entries(ZONE_MAP)) {
  ADJACENT_CACHE.set(zoneId, [...zoneData.adjacentTo, zoneId])
}

interface VisionCacheEntry {
  vision: Set<string>
  playerZone: string
  playerAlive: boolean
  timeOfDay: 'day' | 'night'
  wardKey: string
  iceKey: string
  teammateKey: string
  tracepathKey: string
}

const visionCache = new Map<string, VisionCacheEntry>()

/** Cap on cache size — evicts oldest entries when exceeded. */
const VISION_CACHE_MAX = 256

function buildWardKey(state: GameState, team: TeamId): string {
  const wards: string[] = []
  for (const [zoneId, zone] of Object.entries(state.zones)) {
    for (const ward of zone.wards) {
      if (ward.team === team) {
        wards.push(`${zoneId}:${ward.expiryTick}`)
      }
    }
  }
  return wards.sort().join(',')
}

function buildIceKey(state: GameState, team: TeamId): string {
  return state.ice
    .filter((t) => t.team === team && t.alive)
    .map((t) => t.zone)
    .sort()
    .join(',')
}

function buildTeammateKey(state: GameState, team: TeamId, excludePlayerId: string): string {
  return Object.entries(state.players)
    .filter(([id, p]) => p.team === team && id !== excludePlayerId && p.alive)
    .map(([id, p]) => `${id}:${p.zone}`)
    .sort()
    .join(',')
}

/** Team members whose Tracepath is active (id + zone) — their extended sight
 *  changes the team's vision, so it must be part of the cache key. */
function buildTracepathKey(state: GameState, team: TeamId): string {
  return Object.entries(state.players)
    .filter(
      ([, p]) => p.team === team && p.alive && p.buffs.some((b) => b.id === 'tracepath_vision'),
    )
    .map(([id, p]) => `${id}:${p.zone}`)
    .sort()
    .join(',')
}

export function calculateVision(state: GameState, playerId: string, gameId?: string): Set<string> {
  const player = state.players[playerId]
  if (!player) return new Set()

  const team = player.team
  const wardKey = buildWardKey(state, team)
  const iceKey = buildIceKey(state, team)
  const teammateKey = buildTeammateKey(state, team, playerId)
  const tracepathKey = buildTracepathKey(state, team)
  const timeOfDay = state.timeOfDay

  // Key the cache by gameId:playerId so concurrent games can't pollute or evict
  // each other's vision entries (a human re-queuing into a second game while
  // the first is still live, or bot ids colliding across games).
  const cacheKey = gameId ? `${gameId}:${playerId}` : playerId
  const cached = visionCache.get(cacheKey)
  if (
    cached &&
    cached.playerZone === player.zone &&
    cached.playerAlive === player.alive &&
    cached.timeOfDay === timeOfDay &&
    cached.wardKey === wardKey &&
    cached.iceKey === iceKey &&
    cached.teammateKey === teammateKey &&
    cached.tracepathKey === tracepathKey
  ) {
    return cached.vision
  }

  const vision = calculateVisionUncached(state, player, team)

  // Bounded LRU-ish: re-set moves the key to the most-recent insertion order.
  // When over the cap, drop the oldest insertion.
  if (visionCache.size >= VISION_CACHE_MAX && !visionCache.has(cacheKey)) {
    const oldest = visionCache.keys().next().value
    if (oldest !== undefined) visionCache.delete(oldest)
  }
  visionCache.delete(cacheKey)
  visionCache.set(cacheKey, {
    vision,
    playerZone: player.zone,
    playerAlive: player.alive,
    timeOfDay,
    wardKey,
    iceKey,
    teammateKey,
    tracepathKey,
  })

  return vision
}

function calculateVisionUncached(state: GameState, player: PlayerState, team: TeamId): Set<string> {
  const visible = new Set<string>()
  const isNight = state.timeOfDay === 'night'

  if (player.alive) {
    addZoneWithAdjacent(visible, player.zone, isNight, team)
  }

  // Home ground is always lit. Resolved from the zone records rather than
  // hardcoded per team: this pair survived the Aug 1 id sweep only because a
  // find-and-replace happened to reach it, and a team whose home ids are wrong
  // here goes permanently blind in its own base with nothing to show for it.
  for (const zone of HOME_ZONES[team]) addZoneWithAdjacent(visible, zone, isNight, team)

  for (const zoneState of Object.values(state.zones)) {
    for (const ward of zoneState.wards) {
      if (ward.team === team) {
        addZoneWithAdjacent(visible, zoneState.id, isNight, team)
      }
    }
  }

  for (const ice of state.ice) {
    if (ice.team === team && ice.alive) {
      addZoneWithAdjacent(visible, ice.zone, isNight, team)
    }
  }

  for (const p of Object.values(state.players)) {
    if (p.team === team && p.alive && p.id !== player.id) {
      addZoneWithAdjacent(visible, p.zone, isNight, team)
    }
  }

  // Ping's Tracepath: while active, that hero's sight reaches one hop further —
  // reveal each of its zone's neighbours along with THEIR neighbours (2 hops).
  for (const p of Object.values(state.players)) {
    if (p.team === team && p.alive && p.buffs.some((b) => b.id === 'tracepath_vision')) {
      for (const neighbor of ADJACENT_CACHE.get(p.zone) ?? []) {
        addZoneWithAdjacent(visible, neighbor, isNight, team)
      }
    }
  }

  return visible
}

function addZoneWithAdjacent(
  visible: Set<string>,
  zoneId: string,
  isNight: boolean = false,
  viewerTeam?: TeamId,
): void {
  // Own zone is ALWAYS visible, even at night. (ADJACENT_CACHE stores
  // [...adjacentTo, zoneId] with zoneId last, so the old night `slice` lopped
  // the own zone off — a hero would go blind in its own zone at night.)
  visible.add(zoneId)
  const adjacent = ADJACENT_CACHE.get(zoneId)
  if (!adjacent) return
  const neighbors = adjacent.filter((z) => z !== zoneId)
  if (!isNight || NIGHT_VISION_PENALTY <= 0) {
    for (const zone of neighbors) visible.add(zone)
    return
  }
  // Night: drop NIGHT_VISION_PENALTY neighbors, preferring to drop the ones
  // furthest from home — enemy-team zones first, then neutral, then own-team.
  // The old `slice(0, len - PENALTY)` dropped the last entry by arbitrary array
  // order, which was non-deterministic and could blind a hero toward their own
  // base while keeping vision toward the enemy. Sorting by "how enemy is this
  // zone" (ascending — own-team first, enemy last) and keeping the first
  // len-PENALTY makes the loss deterministic and geometrically meaningful.
  const enemyTeam: TeamId = viewerTeam === 'chaff' ? 'audit' : 'chaff'
  const threatRank = (z: string): number => {
    const team = ZONE_MAP[z]?.team
    if (team === enemyTeam) return 2 // enemy territory — drop first
    if (team === 'neutral') return 1 // neutral (river/silt) — drop second
    return 0 // own territory — keep
  }
  // Sort ascending (lowest threat first); slice off the end to drop the
  // highest-threat neighbors.
  const sorted = [...neighbors].sort((a, b) => threatRank(a) - threatRank(b))
  const zonesToAdd = sorted.slice(0, Math.max(0, neighbors.length - NIGHT_VISION_PENALTY))
  for (const zone of zonesToAdd) visible.add(zone)
}

function getZonesWithTrueSight(state: GameState, team: TeamId): Set<string> {
  const trueSightZones = new Set<string>()

  for (const zoneState of Object.values(state.zones)) {
    for (const ward of zoneState.wards) {
      if (ward.team === team && ward.type === 'sniffer') {
        trueSightZones.add(zoneState.id)
        if (SNIFFER_TRUE_SIGHT_RADIUS >= 1) {
          const adjacent = ADJACENT_CACHE.get(zoneState.id)
          if (adjacent) {
            for (const z of adjacent) {
              trueSightZones.add(z)
            }
          }
        }
      }
    }
  }

  // Tracer Dust: a carrier reveals invisible enemies in their current
  // and adjacent zones. (The item applies a `dust_reveal` buff that nothing
  // else consumed, so Dust was a dead anti-invis item.)
  for (const player of Object.values(state.players)) {
    if (player.team === team && player.alive && player.buffs.some((b) => b.id === 'dust_reveal')) {
      trueSightZones.add(player.zone)
      for (const z of ADJACENT_CACHE.get(player.zone) ?? []) {
        trueSightZones.add(z)
      }
    }
  }

  return trueSightZones
}

function isInvisible(player: PlayerState): boolean {
  return player.buffs.some((b) => INVISIBILITY_BUFF_IDS.has(b.id))
}

/**
 * True when the player carries a 'revealed' buff applied by a member of the
 * viewing team. A reveal pierces fog AND invisibility/stealth for that team.
 */
function isRevealedToTeam(player: PlayerState, state: GameState, team: TeamId): boolean {
  return player.buffs.some((b) => b.id === 'revealed' && state.players[b.source]?.team === team)
}

/**
 * Build a `PlayerVisibleState` for a spectator — same shape as
 * `filterStateForPlayer` but with no fog applied. All players, zones,
 * waves, and events are exposed. Reuses the player-state shape so a
 * renderer can consume it without changes.
 *
 * Currently unused: the live spectate page (a raw WS stream over this) was
 * deleted with the DO-era WS game server in the all-Vercel cutover, and
 * there is no Ably-backed replacement yet. Kept — it's a pure, WS-agnostic
 * primitive a future Ably-backed spectate mode would want back immediately.
 */
export function filterStateForSpectator(state: GameState): PlayerVisibleState {
  return {
    cycle: state.cycle,
    phase: state.phase,
    winner: state.winner,
    teams: state.teams,
    players: { ...state.players },
    zones: { ...state.zones },
    waves: state.waves,
    neutrals: state.neutrals ?? [],
    ice: state.ice,
    terminals: state.terminals,
    caches: state.caches ?? [],
    tenant: state.tenant,
    backup: state.backup,
    events: state.events,
    visibleZones: Object.keys(state.zones),
    timeOfDay: state.timeOfDay,
    dayNightCycle: state.dayNightCycle,
    mapId: state.mapId,
    mode: state.mode,
    tutorialStep: state.tutorialStep,
  }
}

/**
 * Filter the full game state to what a specific player can see.
 * NEVER leaks information about fogged zones.
 */
export function filterStateForPlayer(
  state: GameState,
  playerId: string,
  gameId?: string,
): PlayerVisibleState {
  let visible = calculateVision(state, playerId, gameId)
  const player = state.players[playerId]
  if (!player) {
    return {
      cycle: state.cycle,
      phase: state.phase,
      winner: state.winner,
      teams: state.teams,
      players: {},
      zones: {},
      waves: [],
      neutrals: [],
      ice: state.ice,
      terminals: state.terminals,
      caches: state.caches ?? [],
      tenant: state.tenant,
      backup: state.backup,
      events: [],
      visibleZones: [],
      timeOfDay: state.timeOfDay,
      dayNightCycle: state.dayNightCycle,
      mapId: state.mapId,
      mode: state.mode,
      tutorialStep: state.tutorialStep,
    }
  }

  const team = player.team
  const trueSightZones = getZonesWithTrueSight(state, team)

  // Enemies revealed by the viewer's team are rendered unfogged and their
  // zones added to the visible set. Copy before mutating — the vision set is
  // shared via cache and must not be poisoned with transient reveal zones.
  const revealedEnemies = new Set<string>()
  for (const [pid, p] of Object.entries(state.players)) {
    if (p.team !== team && p.alive && isRevealedToTeam(p, state, team)) {
      revealedEnemies.add(pid)
      if (!visible.has(p.zone)) {
        visible = new Set(visible)
        visible.add(p.zone)
      }
    }
  }

  const filteredPlayers: Record<string, PlayerState | FoggedPlayer> = {}
  for (const [pid, p] of Object.entries(state.players)) {
    if (p.team === team) {
      filteredPlayers[pid] = p
    } else if (visible.has(p.zone) && p.alive) {
      // 'revealed' overrides invisibility/stealth
      if (isInvisible(p) && !trueSightZones.has(p.zone) && !revealedEnemies.has(pid)) {
        filteredPlayers[pid] = {
          id: p.id,
          name: p.name,
          guildTag: p.guildTag,
          team: p.team,
          heroId: p.heroId,
          level: p.level,
          kills: p.kills,
          deaths: p.deaths,
          assists: p.assists,
          alive: p.alive,
          fogged: true,
        }
      } else {
        // A visible enemy shows full combat state, but never their queued
        // orders — the auto-path destination leaks where they're rotating and
        // the standing attack order leaks what they've committed to hitting.
        const { moveTarget: _moveTarget, attackTarget: _attackTarget, ...publicState } = p
        filteredPlayers[pid] = publicState
      }
    } else {
      filteredPlayers[pid] = {
        id: p.id,
        name: p.name,
        guildTag: p.guildTag,
        team: p.team,
        heroId: p.heroId,
        level: p.level,
        kills: p.kills,
        deaths: p.deaths,
        assists: p.assists,
        alive: p.alive,
        fogged: true,
      }
    }
  }

  // Filter zones: only include visible zone states
  const filteredZones: Record<string, ZoneRuntimeState> = {}
  for (const [zoneId, zs] of Object.entries(state.zones)) {
    // Traps are invisible to the enemy even in a fully-visible zone — only the
    // owning team ever sees its own armed traps.
    const ownTraps = zs.traps?.filter((t) => t.team === team)
    if (visible.has(zoneId)) {
      filteredZones[zoneId] = zs.traps ? { ...zs, traps: ownTraps } : zs
    } else {
      // Show zone exists but strip wards and wave details for enemy info
      filteredZones[zoneId] = {
        id: zs.id,
        wards: zs.wards.filter((w) => w.team === team), // Only show own wards
        ...(zs.traps ? { traps: ownTraps } : {}),
      }
    }
  }

  // Filter waves: only show waves in visible zones
  const filteredWaves = state.waves.filter((c) => visible.has(c.zone))

  // Filter neutrals: Silt dwellers respect fog exactly like waves — only
  // camps in a currently-visible zone are reported. A camp's presence,
  // health, and type are combat-relevant intel the enemy team should not
  // get for free.
  const filteredNeutrals = (state.neutrals ?? []).filter((n) => visible.has(n.zone))

  // Enemies the viewer cannot see even where they stand: stealthed, with no
  // true sight or reveal on them. An event that gets through on LOCATION alone
  // must not name one (a stealthed Daemon hitting a wave in my sight).
  const unseenEnemies = new Set<string>()
  for (const [pid, p] of Object.entries(state.players)) {
    if (
      p.team !== team &&
      p.alive &&
      isInvisible(p) &&
      !trueSightZones.has(p.zone) &&
      !revealedEnemies.has(pid)
    ) {
      unseenEnemies.add(pid)
    }
  }

  const filteredEvents: GameEvent[] = []
  for (const e of state.events) {
    const delivered = eventForViewer(e, state, team, visible, unseenEnemies)
    if (delivered) filteredEvents.push(delivered)
  }

  return {
    cycle: state.cycle,
    phase: state.phase,
    // The final broadcast of a game carries `phase: 'ended'` — without the
    // winner riding along, a client whose game_over message goes missing can
    // freeze on a dead board with no post-game screen (first-playtest bug).
    winner: state.winner,
    teams: state.teams,
    players: filteredPlayers,
    zones: filteredZones,
    waves: filteredWaves,
    neutrals: filteredNeutrals, // Fogged like waves: only visible-zone camps are reported
    ice: state.ice, // ICE are always visible (global info)
    terminals: state.terminals, // Terminals are always visible (global info)
    caches: state.caches ?? [],
    tenant: state.tenant,
    backup: state.backup,
    events: filteredEvents,
    visibleZones: [...visible],
    timeOfDay: state.timeOfDay,
    dayNightCycle: state.dayNightCycle,
    mapId: state.mapId,
    mode: state.mode,
    tutorialStep: state.tutorialStep,
  }
}

// ── Per-viewer event visibility ─────────────────────────────────

/**
 * Events every player receives regardless of fog — each mirrors state that is
 * already broadcast unfogged (`timeOfDay`, `tenant`, `terminals`, `ice`,
 * `phase`/`winner`), so delivering the event leaks nothing new. Several of
 * these carry the LOSING/OWNING `team`, which used to hide them from exactly
 * the crew that caused them (the winners never saw `surrendered` or
 * `terminal_destroyed`; razing enemy ice out of sight printed nothing).
 */
const GLOBAL_EVENT_TYPES: ReadonlySet<string> = new Set([
  'night_falls',
  'day_breaks',
  'tenant_killed',
  'tenant_respawn',
  'terminal_destroyed',
  'ice_kill',
  'harden_used',
  'surrendered',
])

/** Every payload key that names a participant. `casterId` (spell_blocked) and
 *  `owner` (trap_triggered) are easy to miss — without them a viewer's ally is
 *  "not referenced" by a block on their spell or a trap they set. */
const PARTICIPANT_KEYS = [
  'playerId',
  'sourceId',
  'targetId',
  'killerId',
  'victimId',
  'casterId',
  'owner',
] as const

function participants(payload: Record<string, unknown>): string[] {
  const ids: string[] = []
  for (const key of PARTICIPANT_KEYS) {
    const v = payload[key]
    if (typeof v === 'string' && v) ids.push(v)
  }
  const assisters = payload['assisters']
  if (Array.isArray(assisters)) {
    for (const a of assisters) if (typeof a === 'string' && a) ids.push(a)
  }
  return ids
}

/**
 * THE per-viewer event rule. An event reaches a viewer on team T when ANY of:
 *  1. its type is global (GLOBAL_EVENT_TYPES);
 *  2. `payload.team === T` (team-owned: harden, surrender votes, own wards…);
 *  3. it names a HERO on team T in any participant slot (PARTICIPANT_KEYS +
 *     assisters) — "an enemy's damage to my ally is visible". Only heroes
 *     count: own waves give no vision, so "enemy X hit my wave" in fog would
 *     hand over X's position. Own ice/Terminal need no entry — their zones
 *     are always lit, so rule 4 covers them;
 *  4. `payload.zone` is in the viewer's visible set (incl. reveals) AND no
 *     participant is a stealthed enemy the viewer can't see. Combat events get
 *     that zone from `stampEventZones` (where the effect landed, at the end of
 *     the phase that resolved it).
 * Otherwise it is dropped: two enemies fighting in fog stays hidden.
 *
 * A LOCATED stamp (LOCATED_EVENT_TAGS) is redacted when its zone is not
 * visible — an event delivered by rule 1–3 must not reveal where an unseen
 * enemy is (my ally's DoT ticking on someone who walked into fog). An enemy's
 * `ability_used` also loses its `cooldown` (private timing).
 */
export function eventForViewer(
  e: GameEvent,
  state: GameState,
  team: TeamId,
  visible: ReadonlySet<string>,
  unseenEnemies: ReadonlySet<string> = new Set(),
): GameEvent | null {
  const payload = e.payload
  const zone = typeof payload['zone'] === 'string' ? (payload['zone'] as string) : undefined
  const zoneVisible = zone !== undefined && visible.has(zone)
  const ids = participants(payload)
  const delivered =
    GLOBAL_EVENT_TYPES.has(e.type) ||
    payload['team'] === team ||
    ids.some((id) => state.players[id]?.team === team) ||
    (zoneVisible && !ids.some((id) => unseenEnemies.has(id)))
  if (!delivered) return null
  let out = e
  if (zone !== undefined && !zoneVisible && LOCATED_EVENT_TAGS.has(e.type)) {
    const { zone: _zone, ...rest } = out.payload
    out = { ...out, payload: rest }
  }
  // An enemy's cast line says WHAT they cast; their resulting cooldown is their
  // team's business (it used to ride along whenever the cast named one of us).
  if (e.type === 'ability_used' && state.players[String(payload['playerId'])]?.team !== team) {
    if ('cooldown' in out.payload) {
      const { cooldown: _cooldown, ...rest } = out.payload
      out = { ...out, payload: rest }
    }
  }
  return out
}
