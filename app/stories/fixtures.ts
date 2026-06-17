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
  TowerState,
  AncientState,
  RoshanState,
  RuneState,
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
  blades: 'blades_of_attack',
  treads: 'power_treads',
  bkb: 'black_king_bar',
  daedalus: 'daedalus',
  desolator: 'desolator',
  blink: 'blink_module',
  forceStaff: 'force_staff',
  salve: 'healing_salve',
  branch: 'iron_branch',
  observerWard: 'observer_ward',
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
 * radiant defaults otherwise (alive, level 9, a couple of items, some KDA).
 */
export function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'player_one',
    team: 'radiant',
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
    towerDamageDealt: 800,
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
    team: 'radiant',
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

// ── Teams / towers / ancients / objectives ──────────────────────────────

export function makeTeamState(id: TeamId, overrides: Partial<TeamState> = {}): TeamState {
  return {
    id,
    kills: id === 'radiant' ? 14 : 9,
    towerKills: id === 'radiant' ? 3 : 1,
    gold: id === 'radiant' ? 5100 : 4150,
    glyphUsedTick: null,
    ...overrides,
  }
}

export function makeTower(
  team: TeamId,
  zone: string,
  overrides: Partial<TowerState> = {},
): TowerState {
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

export function makeRoshan(overrides: Partial<RoshanState> = {}): RoshanState {
  return {
    alive: true,
    hp: 3500,
    maxHp: 5000,
    deathTick: null,
    ...overrides,
  }
}

export function makeRune(overrides: Partial<RuneState> = {}): RuneState {
  return {
    zone: 'rune-top',
    type: 'dd',
    tick: 240,
    ...overrides,
  }
}

export function makeZone(id: string, overrides: Partial<ZoneRuntimeState> = {}): ZoneRuntimeState {
  return {
    id,
    wards: [],
    creeps: [],
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
    towerDamage: 3400,
    ...overrides,
  }
}

// ── Rosters ──────────────────────────────────────────────────────────────

/**
 * A realistic mid-game 5v5 roster keyed by player id (p1-p5 radiant, e1-e5
 * dire) — the shape the store keeps in `allPlayers`. `playerId` defaults to
 * `p1`, who is on radiant.
 */
export function makeRoster(): Record<string, PlayerState> {
  const radiant: PlayerState[] = [
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
      zone: 'bot-t1-dire',
      level: 6,
      gold: 600,
      kills: 1,
      deaths: 2,
      assists: 9,
      items: [SAMPLE_ITEMS.observerWard, null, null, null, null, null],
    }),
    makePlayer({
      id: 'p4',
      name: 'proxy_jg',
      heroId: SAMPLE_HEROES.proxy,
      zone: 'jungle-rad-top',
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
  const dire: PlayerState[] = [
    makePlayer({
      id: 'e1',
      name: 'daemon_carry',
      team: 'dire',
      heroId: SAMPLE_HEROES.daemon,
      zone: 'mid-river',
      level: 9,
    }),
    makePlayer({
      id: 'e2',
      name: 'regex_mid',
      team: 'dire',
      heroId: SAMPLE_HEROES.regex,
      zone: 'bot-river',
      level: 8,
    }),
    makePlayer({
      id: 'e3',
      name: 'cache_sup',
      team: 'dire',
      heroId: SAMPLE_HEROES.cache,
      zone: 'dire-base',
      level: 5,
    }),
    makePlayer({
      id: 'e4',
      name: 'firewall_tank',
      team: 'dire',
      heroId: SAMPLE_HEROES.firewall,
      zone: 'jungle-dire-bot',
      level: 7,
    }),
    makePlayer({
      id: 'e5',
      name: 'nullref_pos5',
      team: 'dire',
      heroId: SAMPLE_HEROES.null_ref,
      zone: 'dire-fountain',
      level: 6,
    }),
  ]
  const all: Record<string, PlayerState> = {}
  for (const p of [...radiant, ...dire]) all[p.id] = p
  return all
}

/** A ready scoreboard derived from {@link makeRoster}, sorted radiant-first. */
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
export const SAMPLE_NET_WORTH_HISTORY: { radiant: number[]; dire: number[] } = {
  radiant: [3200, 3400, 3800, 4200, 4600, 5100, 5400, 5900],
  dire: [3100, 3300, 3500, 3700, 3900, 4150, 4300, 4500],
}

/** A few sample {@link GameEvent}s for combat-log / ticker stories. */
export const SAMPLE_EVENTS: GameEvent[] = [
  { tick: 238, type: 'kill', payload: { killer: 'p1', victim: 'e2', zone: 'mid-river' } },
  { tick: 239, type: 'tower_destroyed', payload: { team: 'dire', zone: 'mid-t1-dire' } },
  { tick: 240, type: 'rune_spawn', payload: { zone: 'rune-top', rune: 'dd' } },
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
    teams: { radiant: makeTeamState('radiant'), dire: makeTeamState('dire') },
    players,
    zones,
    creeps: [],
    neutrals: [],
    towers: [
      makeTower('dire', 'mid-t1-dire', { alive: false, hp: 0 }),
      makeTower('dire', 'mid-t2-dire'),
      makeTower('radiant', 'mid-t1-rad'),
    ],
    ancients: { radiant: makeAncient('radiant'), dire: makeAncient('dire') },
    runes: [makeRune()],
    roshan: makeRoshan(),
    aegis: null,
    events: SAMPLE_EVENTS,
    winner: null,
    surrenderVotes: { radiant: new Set<string>(), dire: new Set<string>() },
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
