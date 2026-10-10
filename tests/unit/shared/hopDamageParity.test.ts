import { describe, it, expect } from 'vitest'
import type { BuffState, GameState, PlayerState, WaveUnitState } from '~~/shared/types/game'
import { predictedHopDamage } from '~~/server/game/engine/ActionResolver'
import { filterStateForPlayer } from '~~/server/game/engine/VisionCalculator'
import { commandDanger, predictIncoming, type DangerState } from '~~/app/utils/dangerPreview'
import { ZONES } from '~~/shared/constants/zones'
import { SILT_DWELLERS, TENANT_ATTACK, waveUnitMaxHp } from '~~/shared/constants/balance'

/**
 * Round-5 review: the client's danger preview and the server's walk hold ran
 * two different formulas (base plate vs effective plate; enemy attack without
 * items) — an L15 hero read 129 on the client and 99 on the server, an L10
 * Malloc with items 129 vs 200. Both now run shared/utils/hopDamage. Same
 * state in, the client fed its own fog-filtered cycle_state, the server the
 * raw state: the numbers must be IDENTICAL.
 */

const T1 = 'coldstore-t1-audit'
const CROSS = 'coldstore-cross'
const CYCLE = 100

function hero(over: Partial<PlayerState>): PlayerState {
  return {
    id: 'p1',
    name: 'p1',
    team: 'chaff',
    alive: true,
    zone: T1,
    integ: 500,
    maxInteg: 600,
    plate: 4,
    ice: 15,
    items: [],
    buffs: [],
    heroId: 'firewall',
    level: 1,
    ...over,
  } as PlayerState
}

function mk(
  over: Partial<GameState> = {},
  me: Partial<PlayerState> = {},
  enemy?: Partial<PlayerState>,
): GameState {
  return {
    cycle: CYCLE,
    phase: 'playing',
    mode: 'normal',
    zones: Object.fromEntries(ZONES.map((z) => [z.id, { id: z.id, wards: [] }])),
    waves: [],
    ice: [],
    neutrals: [],
    events: [],
    caches: [],
    terminals: [],
    teams: { chaff: {}, audit: {} },
    tenant: { alive: false, integ: 0, maxInteg: 5000, deathCycle: null },
    players: {
      p1: hero(me),
      ...(enemy
        ? { e1: hero({ id: 'e1', name: 'e1', team: 'audit', heroId: 'malloc', ...enemy }) }
        : {}),
    },
    ...over,
  } as unknown as GameState
}

/** The client's reading: the HUD's own fog-filtered state, one cycle earlier
 *  on screen (a fresh order resolves in the NEXT cycle). */
function clientState(s: GameState): DangerState {
  const view = filterStateForPlayer(s, 'p1')
  return {
    me: view.players.p1 as PlayerState,
    waves: view.waves,
    neutrals: view.neutrals,
    ice: view.ice,
    tenant: view.tenant,
    players: view.players,
    cycle: s.cycle - 1,
  }
}

function both(s: GameState, zone: string, aggro = false) {
  const server = predictedHopDamage(s, s.players.p1!, zone, aggro)
  const client = predictIncoming(zone, clientState(s), { drawsIceAggro: aggro })
  return { server, client }
}

function lines(n: number, zone: string, team: 'chaff' | 'audit' = 'audit'): WaveUnitState[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${team}-${zone}-${i}`,
    team,
    zone,
    integ: waveUnitMaxHp('line', CYCLE),
    maxInteg: waveUnitMaxHp('line', CYCLE),
    type: 'line' as const,
  }))
}

const buff = (id: string, stacks = 0): BuffState =>
  ({ id, cyclesRemaining: 5, stacks, source: 'x' }) as BuffState

describe('one damage prediction: client preview === server hold', () => {
  // The reviewer's four cases, at the server's (engine-faithful) numbers.
  const cases: Array<[string, Partial<PlayerState>, Partial<PlayerState>, number]> = [
    ['L1 vs L1 Malloc', {}, { level: 1 }, 58],
    ['L1 vs L10 Malloc', {}, { level: 10 }, 125],
    [
      'L1 vs L10 Malloc with items',
      {},
      { level: 10, items: ['rust_driver', 'fracture_edge'] },
      200,
    ],
    ['L15 (grown plate) vs L10 Malloc', { level: 15 }, { level: 10 }, 99],
  ]
  for (const [name, me, enemy, expected] of cases) {
    it(`${name}: ${expected} on both sides`, () => {
      const { server, client } = both(mk({}, me, enemy), T1)
      expect(server.damage).toBe(expected)
      expect(client.total).toBe(expected)
      expect(client.heroes).toBe(server.heroes)
    })
  }

  it('waves + ICE at the landing cycle, with talents/items on the walker', () => {
    const s = mk(
      {
        waves: lines(4, T1),
        ice: [
          { zone: T1, team: 'audit', alive: true, integ: 1500, maxInteg: 1500 },
        ] as GameState['ice'],
      },
      { level: 12, items: ['plate_weave', 'field_damper'] },
    )
    const { server, client } = both(s, T1, true)
    expect(server.units).toBe(4)
    expect(server.ice).toBe(true)
    expect(client.total).toBe(server.damage)
  })

  it('shields, a phase-shift dodge and Kernel hardened run the same chain', () => {
    const s = mk(
      {
        waves: lines(3, T1),
        ice: [
          { zone: T1, team: 'audit', alive: true, integ: 1500, maxInteg: 1500 },
        ] as GameState['ice'],
      },
      { buffs: [buff('shield', 40), buff('phaseShift'), buff('hardened')] },
    )
    const { server, client } = both(s, T1, true)
    expect(server.damage).toBeGreaterThan(0)
    expect(client.total).toBe(server.damage)
  })

  it('a Silt camp: every visible dweller swings at you, on both sides', () => {
    const camp = 'silt-chaff-upper'
    const s = mk(
      {
        neutrals: [
          { id: 'n1', zone: camp, type: 'warden', integ: 900, maxInteg: 900, alive: true },
          { id: 'n2', zone: camp, type: 'stub', integ: 250, maxInteg: 250, alive: true },
        ],
      },
      { zone: camp, plate: 0, heroId: null },
    )
    const { server, client } = both(s, camp)
    expect(server.neutrals).toBe(2)
    expect(server.damage).toBe(SILT_DWELLERS.warden.attack + SILT_DWELLERS.stub.attack)
    expect(client.total).toBe(server.damage)
  })

  it('THE TENANT in the Hollow: public, counted on both sides', () => {
    const s = mk(
      { tenant: { alive: true, integ: 5000, maxInteg: 5000, deathCycle: null } },
      { zone: 'hollow', plate: 0, heroId: null },
    )
    const { server, client } = both(s, 'hollow')
    expect(server).toMatchObject({ tenant: true, damage: TENANT_ATTACK })
    expect(client.total).toBe(server.damage)
  })

  it('a stack the walker cannot see counts on NEITHER side', () => {
    // The walker one hop out, the stack in a zone with no vision on it.
    const far = 'coldstore-t2-audit'
    const s = mk({ waves: lines(6, far) }, { zone: CROSS })
    expect(filterStateForPlayer(s, 'p1').waves).toHaveLength(0)
    const { server, client } = both(s, far)
    expect(server).toMatchObject({ units: 0, damage: 0 })
    expect(client.total).toBe(0)
  })
})

describe('the client warns where the pit / camp would hurt (round-5 review)', () => {
  it('`move hollow` and `attack tenant` at 400 INTEG warn of THE TENANT', () => {
    const s = mk(
      { tenant: { alive: true, integ: 5000, maxInteg: 5000, deathCycle: null } },
      { zone: 'hollow', integ: 400, plate: 0, heroId: null },
    )
    const ds = clientState(s)
    expect(commandDanger({ type: 'attack', target: { kind: 'tenant' } }, ds)?.text).toMatch(
      /THE TENANT \(~150\/cycle\) — you have 400/,
    )
    // Walking in from its neighbour warns at the pit.
    const walking = { ...ds, me: { ...ds.me, zone: 'cache-seawall' } }
    expect(commandDanger({ type: 'move', zone: 'hollow' }, walking)?.incoming).toMatchObject({
      zone: 'hollow',
      tenant: true,
    })
  })
})
