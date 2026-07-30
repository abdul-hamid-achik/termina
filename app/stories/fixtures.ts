/**
 * Shared, typed mock factories for Histoire stories.
 *
 * Story files import these so each `.story.vue` doesn't re-declare a full
 * `PlayerState` etc. by hand. Everything here is TYPE-CORRECT against the real
 * domain types (`~~/shared/types/game`, `~~/shared/types/protocol`) and uses
 * real hero / item / zone ids from the constants, so stories render against the
 * same shapes the live game produces.
 *
 * Two usage modes:
 *  - props-driven stories pass `makePlayer()` / `makeScoreboardEntry()` etc.
 *    straight into a component's props.
 *  - store-coupled stories (see WarRoom.story.vue) seed the Pinia game store via
 *    `store.updateFromTick(makeTickMessage(...))`, or assign the lighter
 *    `makeGameState()` pieces directly onto the store's refs.
 */
import type {
  PlayerState,
  GameState,
  TeamState,
  TeamId,
  ZoneRuntimeState,
  IceState,
  AncientState,
  TenantState,
  CacheState,
  GameEvent,
} from '~~/shared/types/game'
import type { TickStateMessage, PlayerEndStats } from '~~/shared/types/protocol'
import type { ScoreboardEntry } from '~/stores/game'

// ── Sample ids (all real, drawn from shared/constants/*) ─────────────

/** A handful of real hero ids, indexed for readable roster building. */
export const SAMPLE_HEROES = {
  echo: 'echo',
  kernel: 'kernel',
  daemon: 'daemon',
  regex: 'regex',
  socket: 'socket',
  proxy: 'proxy',
  cipher: 'cipher',
  firewall: 'firewall',
  null_ref: 'null_ref',
  cache: 'cache',
} as const

/** A real hero id, handy when a story just needs "some hero". */
export const SAMPLE_HERO_ID = SAMPLE_HEROES.echo

/** Real item ids, useful for inventory / shop fixtures. */
export const SAMPLE_ITEMS = {
  blades: 'edge_kit',
  treads: 'gait_rig',
  bkb: 'black_king_bar',
  daedalus: 'daedalus',
  desolator: 'desolator',
  blink: 'blink_module',
  forceStaff: 'force_staff',
  salve: 'trauma_patch',
  branch: 'scrap_lot',
  camtapWard: 'camtap',
} as const

/** A populated 6-slot inventory (real item ids + a trailing empty slot). */
export const SAMPLE_INVENTORY: (string | null)[] = [
  SAMPLE_ITEMS.treads,
  SAMPLE_ITEMS.bkb,
  SAMPLE_ITEMS.daedalus,
  SAMPLE_ITEMS.blades,
  SAMPLE_ITEMS.salve,
  null,
]

// ── Player ───────────────────────────────────────────────────────────

/**
 * A fully-valid {@link PlayerState}. Override any field; sensible mid-game
 * chaff defaults otherwise (alive, level 9, a couple of items, some KDA).
 */
export function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'player_one',
    team: 'chaff',
    heroId: SAMPLE_HERO_ID,
    zone: 'mid-river',
    hp: 520,
    maxHp: 620,
    mp: 180,
    maxMp: 300,
    level: 9,
    xp: 1400,
    gold: 1400,
    items: [SAMPLE_ITEMS.blades, null, null, null, null, null],
    cooldowns: { q: 0, w: 2, e: 0, r: 8 },
    buffs: [],
    alive: true,
    respawnTick: null,
    defense: 5,
    magicResist: 15,
    kills: 4,
    deaths: 1,
    assists: 6,
    damageDealt: 12_400,
    iceDamageDealt: 800,
    killStreak: 2,
    buybackCost: 900,
    talents: { tier10: null, tier15: null, tier20: null, tier25: null },
    ...overrides,
  }
}

// ── Scoreboard ─────────────────────────────────────────────────────────

/** A fully-valid {@link ScoreboardEntry} (the in-store derived row shape). */
export function makeScoreboardEntry(overrides: Partial<ScoreboardEntry> = {}): ScoreboardEntry {
  return {
    id: 'p1',
    name: 'player_one',
    heroId: SAMPLE_HERO_ID,
    team: 'chaff',
    kills: 4,
    deaths: 1,
    assists: 6,
    gold: 1400,
    level: 9,
    items: [SAMPLE_ITEMS.blades, null, null, null, null, null],
    alive: true,
    respawnTick: null,
    fogged: false,
    ...overrides,
  }
}

// ── Teams / ice / ancients / objectives ──────────────────────────────

export function makeTeamState(id: TeamId, overrides: Partial<TeamState> = {}): TeamState {
  return {
    id,
    kills: id === 'chaff' ? 14 : 9,
    iceKills: id === 'chaff' ? 3 : 1,
    gold: id === 'chaff' ? 5100 : 4150,
    hardenUsedTick: null,
    ...overrides,
  }
}

export function makeIce(team: TeamId, zone: string, overrides: Partial<IceState> = {}): IceState {
  return {
    team,
    zone,
    hp: 1800,
    maxHp: 1800,
    alive: true,
    invulnerable: false,
    ...overrides,
  }
}

export function makeAncient(team: TeamId, overrides: Partial<AncientState> = {}): AncientState {
  return {
    team,
    hp: 4500,
    maxHp: 4500,
    alive: true,
    vulnerable: false,
    ...overrides,
  }
}

export function makeTenant(overrides: Partial<TenantState> = {}): TenantState {
  return {
    alive: true,
    hp: 3500,
    maxHp: 5000,
    deathTick: null,
    ...overrides,
  }
}

export function makeCache(overrides: Partial<CacheState> = {}): CacheState {
  return {
    zone: 'cache-top',
    type: 'dd',
    tick: 240,
    ...overrides,
  }
}

export function makeZone(id: string, overrides: Partial<ZoneRuntimeState> = {}): ZoneRuntimeState {
  return {
    id,
    wards: [],
    waves: [],
    ...overrides,
  }
}

// ── Player end-of-game stats ─────────────────────────────────────────────

export function makePlayerEndStats(overrides: Partial<PlayerEndStats> = {}): PlayerEndStats {
  return {
    kills: 8,
    deaths: 3,
    assists: 12,
    gold: 6200,
    items: SAMPLE_INVENTORY,
    heroDamage: 24_800,
    iceDamage: 3400,
    ...overrides,
  }
}

// ── Rosters ──────────────────────────────────────────────────────────────

/**
 * A realistic mid-game 5v5 roster keyed by player id (p1-p5 chaff, e1-e5
 * audit) — the shape the store keeps in `allPlayers`. `playerId` defaults to
 * `p1`, who is on chaff.
 */
export function makeRoster(): Record<string, PlayerState> {
  const chaff: PlayerState[] = [
    makePlayer({ id: 'p1', name: 'you', heroId: SAMPLE_HEROES.echo, zone: 'mid-river' }),
    makePlayer({
      id: 'p2',
      name: 'kernel_main',
      heroId: SAMPLE_HEROES.kernel,
      zone: 'top-river',
      level: 8,
      hp: 720,
      maxHp: 980,
    }),
    makePlayer({
      id: 'p3',
      name: 'support_sock',
      heroId: SAMPLE_HEROES.socket,
      zone: 'bot-t1-audit',
      level: 6,
      gold: 600,
      kills: 1,
      deaths: 2,
      assists: 9,
      items: [SAMPLE_ITEMS.camtapWard, null, null, null, null, null],
    }),
    makePlayer({
      id: 'p4',
      name: 'proxy_jg',
      heroId: SAMPLE_HEROES.proxy,
      zone: 'silt-chaff-top',
      level: 7,
    }),
    makePlayer({
      id: 'p5',
      name: 'cipher_off',
      heroId: SAMPLE_HEROES.cipher,
      zone: 'top-river',
      level: 9,
      alive: false,
      respawnTick: 268,
      hp: 0,
    }),
  ]
  const audit: PlayerState[] = [
    makePlayer({
      id: 'e1',
      name: 'daemon_carry',
      team: 'audit',
      heroId: SAMPLE_HEROES.daemon,
      zone: 'mid-river',
      level: 9,
    }),
    makePlayer({
      id: 'e2',
      name: 'regex_mid',
      team: 'audit',
      heroId: SAMPLE_HEROES.regex,
      zone: 'bot-river',
      level: 8,
    }),
    makePlayer({
      id: 'e3',
      name: 'cache_sup',
      team: 'audit',
      heroId: SAMPLE_HEROES.cache,
      zone: 'audit-base',
      level: 5,
    }),
    makePlayer({
      id: 'e4',
      name: 'firewall_tank',
      team: 'audit',
      heroId: SAMPLE_HEROES.firewall,
      zone: 'silt-audit-bot',
      level: 7,
    }),
    makePlayer({
      id: 'e5',
      name: 'nullref_pos5',
      team: 'audit',
      heroId: SAMPLE_HEROES.null_ref,
      zone: 'audit-fountain',
      level: 6,
    }),
  ]
  const all: Record<string, PlayerState> = {}
  for (const p of [...chaff, ...audit]) all[p.id] = p
  return all
}

/** A ready scoreboard derived from {@link makeRoster}, sorted chaff-first. */
export function makeScoreboard(): ScoreboardEntry[] {
  return Object.values(makeRoster()).map((p) =>
    makeScoreboardEntry({
      id: p.id,
      name: p.name,
      heroId: p.heroId ?? '',
      team: p.team,
      kills: p.kills,
      deaths: p.deaths,
      assists: p.assists,
      gold: p.gold,
      level: p.level,
      items: p.items,
      alive: p.alive,
      respawnTick: p.respawnTick,
    }),
  )
}

// ── Full game state / tick message ───────────────────────────────────────

/** Sample net-worth trend history (one sample per tick, per team). */
export const SAMPLE_NET_WORTH_HISTORY: { chaff: number[]; audit: number[] } = {
  chaff: [3200, 3400, 3800, 4200, 4600, 5100, 5400, 5900],
  audit: [3100, 3300, 3500, 3700, 3900, 4150, 4300, 4500],
}

/** A few sample {@link GameEvent}s for combat-log / ticker stories. */
export const SAMPLE_EVENTS: GameEvent[] = [
  { tick: 238, type: 'kill', payload: { killer: 'p1', victim: 'e2', zone: 'mid-river' } },
  { tick: 239, type: 'ice_destroyed', payload: { team: 'audit', zone: 'mid-t1-audit' } },
  { tick: 240, type: 'cache_spawn', payload: { zone: 'cache-top', cache: 'dd' } },
]

/**
 * A fully-valid {@link GameState}. Mostly useful as a base for
 * {@link makeTickMessage}; the store's `updateFromTick` only reads a subset, but
 * this keeps the whole shape type-correct for stories that need it directly.
 */
export function makeGameState(overrides: Partial<GameState> = {}): GameState {
  const players = makeRoster()
  const zones: Record<string, ZoneRuntimeState> = {}
  for (const p of Object.values(players)) zones[p.zone] ??= makeZone(p.zone)
  return {
    tick: 240,
    phase: 'playing',
    teams: { chaff: makeTeamState('chaff'), audit: makeTeamState('audit') },
    players,
    zones,
    waves: [],
    neutrals: [],
    ice: [
      makeIce('audit', 'mid-t1-audit', { alive: false, hp: 0 }),
      makeIce('audit', 'mid-t2-audit'),
      makeIce('chaff', 'mid-t1-chaff'),
    ],
    ancients: { chaff: makeAncient('chaff'), audit: makeAncient('audit') },
    caches: [makeCache()],
    tenant: makeTenant(),
    backup: null,
    events: SAMPLE_EVENTS,
    winner: null,
    surrenderVotes: { chaff: new Set<string>(), audit: new Set<string>() },
    timeOfDay: 'day',
    dayNightTick: 12,
    ...overrides,
  }
}

/**
 * A {@link TickStateMessage} ready to feed `store.updateFromTick(...)`. The
 * store treats the `state` as a `PlayerVisibleState`; `makeGameState()` is a
 * superset of the fields it reads, so a cast keeps this both ergonomic and
 * type-honest for story seeding.
 */
export function makeTickMessage(overrides: Partial<GameState> = {}): TickStateMessage {
  const state = makeGameState(overrides)
  return {
    type: 'tick_state',
    tick: state.tick,
    state: state as unknown as TickStateMessage['state'],
  }
}
