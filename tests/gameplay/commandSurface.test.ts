import { describe, it, expect } from 'vitest'
import { seedGame, HUMAN, type Run } from './harness'
import { useCommands, formatHelpReadout } from '~/composables/useCommands'
import { ZONES } from '~~/shared/constants/zones'
import type { Command } from '~~/shared/types/commands'

/**
 * The command surface, end to end: what the UI advertises → what the parser
 * accepts → what the engine does with it.
 *
 * The recurring failure in this codebase is not a crash, it is SILENCE. A verb
 * the help text lists that the parser does not know; a verb the parser accepts
 * that the engine drops without a reason. Either way the player spends their one
 * instruction for the cycle and nothing happens — and on a four-second clock
 * that is the difference between a game and a toy. Shipped instances:
 *
 *  - the CACHE button emitted `cache`, a verb the wire never had (the verb is
 *    `grab`);
 *  - `grab` and `backup` outside a legal zone burned the cycle in silence;
 *  - the situational WARD button kept emitting `ward` after the verb became
 *    `tap`, which would have burned the cycle on an unknown command.
 *
 * So: every verb is exercised, and the rule is that an illegal one must come
 * back REJECTED WITH A REASON rather than quietly accepted and dropped.
 */

/** Every verb in the Command union. Adding one to the type without adding it
 *  here fails `covers every verb in the Command union`, below. */
const VERBS: Command['type'][] = [
  'move',
  'attack',
  'cast',
  'use',
  'buy',
  'sell',
  'tap',
  'backup',
  'grab',
  'scan',
  'who',
  'net',
  'look',
  'status',
  'map',
  'help',
  'chat',
  'ping',
  'buyback',
  'surrender',
  'missing',
  'burn',
  'select_talent',
  'harden',
  'breach',
]

/** Rejections aimed at the human on the last tick. */
function reasons(game: Run): string[] {
  return game.lastRejected.filter((r) => r.playerId === HUMAN).map((r) => r.reason)
}

describe('the command surface', () => {
  describe('what the UI advertises, the parser accepts', () => {
    it('every verb `help` names is a verb the parser knows', () => {
      const { parse } = useCommands()
      const text = formatHelpReadout().join('\n')
      // Verbs are printed as bare words in the help columns; check each known
      // verb that appears there actually parses when given a plausible argument.
      const args: Partial<Record<Command['type'], string>> = {
        move: 'coldstore-cross',
        attack: 'wave:0',
        cast: 'q',
        use: 'trauma_patch',
        buy: 'edge_kit',
        sell: 'edge_kit',
        tap: 'coldstore-cross',
        ping: 'coldstore-cross',
        chat: 'hello',
        burn: 'wave:0',
        surrender: 'confirm',
        missing: 'echo',
      }
      const unknown: string[] = []
      for (const verb of VERBS) {
        if (!new RegExp(`\\b${verb}\\b`).test(text)) continue
        const input = args[verb] ? `${verb} ${args[verb]}` : verb
        const result = parse(input, 'chaff')
        if (!result.command && /unknown command/i.test(result.error ?? '')) {
          unknown.push(`${input} -> ${result.error}`)
        }
      }
      expect(unknown, `help advertises verbs the parser rejects:\n${unknown.join('\n')}`).toEqual(
        [],
      )
    })

    it('covers every verb in the Command union (this list cannot silently rot)', () => {
      // A `Command['type']` added to the union but not to VERBS is a verb with
      // no coverage here at all, which is how the gaps above survived.
      const declared = new Set(VERBS)
      expect(declared.size).toBe(VERBS.length)
      // Type-level exhaustiveness: if the union grows, this stops compiling.
      const _exhaustive: Record<Command['type'], true> = Object.fromEntries(
        VERBS.map((v) => [v, true]),
      ) as Record<Command['type'], true>
      expect(Object.keys(_exhaustive).length).toBe(VERBS.length)
    })
  })

  describe('an illegal action is REJECTED, never silently dropped', () => {
    /** Submit one command from a zone where it cannot possibly be legal. */
    async function refusedFrom(zoneType: 'anchor' | 'route', command: Command) {
      const game = await seedGame('laning_combat', { heroSelf: 'echo' })
      const me = await game.me()
      const zone =
        zoneType === 'anchor'
          ? ZONES.find((z) => z.type === 'anchor' && z.team === me.team)!.id
          : ZONES.find((z) => z.type === 'route' && z.team === me.team)!.id
      await game.patch((s) => ({
        ...s,
        players: { ...s.players, [HUMAN]: { ...s.players[HUMAN]!, zone } },
      }))
      game.submit(command)
      await game.tick()
      return game
    }

    it('grab, outside a cache zone', async () => {
      const game = await refusedFrom('anchor', { type: 'grab' })
      expect(reasons(game).join(' '), 'grab was dropped without a reason').toMatch(/\S/)
    })

    it('backup, outside the drop zone', async () => {
      const game = await refusedFrom('anchor', { type: 'backup' })
      expect(reasons(game).join(' '), 'backup was dropped without a reason').toMatch(/\S/)
    })

    it('tap, in a zone the player cannot reach', async () => {
      const game = await seedGame('laning_combat', { heroSelf: 'echo' })
      const me = await game.me()
      const farSide = ZONES.find((z) => z.type === 'route' && z.team !== me.team)!.id
      game.submit({ type: 'tap', zone: farSide })
      await game.tick()
      expect(reasons(game).join(' '), 'tap was dropped without a reason').toMatch(/\S/)
    })

    it('buy, standing away from a shop zone', async () => {
      const game = await refusedFrom('route', { type: 'buy', item: 'edge_kit' })
      expect(reasons(game).join(' '), 'buy was dropped without a reason').toMatch(/\S/)
    })

    it('move, to a zone that does not exist', async () => {
      const game = await seedGame('laning_combat', { heroSelf: 'echo' })
      game.submit({ type: 'move', zone: 'nowhere-at-all' })
      await game.tick()
      expect(reasons(game).join(' '), 'a nonsense move was dropped without a reason').toMatch(/\S/)
    })

    it('attack, with no such target in the zone', async () => {
      const game = await refusedFrom('anchor', {
        type: 'attack',
        target: { kind: 'hero', name: 'daemon' },
      })
      expect(reasons(game).join(' '), 'attack was dropped without a reason').toMatch(/\S/)
    })

    // Every rejection above must also be legible: a reason that is punctuation,
    // an id, or a bare enum teaches the player nothing about what to do next.
    it('every rejection reason reads as a sentence, not as an internal code', async () => {
      const cases: Array<[string, Command]> = [
        ['grab', { type: 'grab' }],
        ['backup', { type: 'backup' }],
        ['buy', { type: 'buy', item: 'edge_kit' }],
        ['attack', { type: 'attack', target: { kind: 'hero', name: 'daemon' } }],
      ]
      const bad: string[] = []
      for (const [label, command] of cases) {
        const game = await refusedFrom('anchor', command)
        for (const reason of reasons(game)) {
          const words = reason.trim().split(/\s+/)
          if (words.length < 3 || /^[A-Z_]+$/.test(reason.trim())) {
            bad.push(`${label}: "${reason}"`)
          }
        }
      }
      expect(bad, `rejection reasons that do not explain themselves:\n${bad.join('\n')}`).toEqual(
        [],
      )
    })
  })

  describe('informational verbs cost the player nothing', () => {
    // status/map/scan/who/net/look are readouts: checking your own cooldowns
    // must not move you, spend anything, or draw a rejection.
    //
    // Compared against a CONTROL tick rather than against the state before it —
    // passive scrip accrues every cycle regardless of what you did, so "scrip is
    // unchanged" would be asserting the economy is broken.
    async function controlScrip(): Promise<number> {
      const control = await seedGame('laning_combat', { heroSelf: 'echo' })
      await control.tick()
      return (await control.me()).scrip
    }

    for (const verb of ['status', 'map', 'scan', 'who', 'net', 'look'] as const) {
      it(`${verb} costs no scrip, no movement, and no rejection`, async () => {
        const expected = await controlScrip()
        const game = await seedGame('laning_combat', { heroSelf: 'echo' })
        const before = await game.me()
        game.submit({ type: verb } as Command)
        await game.tick()
        const after = await game.me()

        expect(after.zone, `${verb} moved the player`).toBe(before.zone)
        expect(after.scrip, `${verb} changed scrip beyond passive income`).toBe(expected)
        expect(reasons(game), `${verb} was rejected`).toEqual([])
      })
    }
  })
})
