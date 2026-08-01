/**
 * Trap #9 — command vocabulary is mirrored in four places. A green suite used
 * to let a verb land in the parser but not the zod schema (or vice versa).
 * This test is the tripwire: add a Command type → update schema + parser +
 * ActionResolver, or declare it client-only in shared/constants/commands.ts.
 */
import { describe, it, expect } from 'vitest'
import { commandSchema } from '~~/server/utils/ws-schemas'
import { CLIENT_ONLY_COMMAND_TYPES, TARGET_KINDS } from '~~/shared/constants/commands'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** Extract `"foo"` from `type: 'foo'` / `z.literal('foo')` lines. */
function quotedStrings(src: string, re: RegExp): string[] {
  const out: string[] = []
  for (const m of src.matchAll(re)) {
    if (m[1]) out.push(m[1])
  }
  return [...new Set(out)].sort()
}

const root = resolve(import.meta.dirname, '../../..')

const commandsTs = readFileSync(resolve(root, 'shared/types/commands.ts'), 'utf8')
const schemasTs = readFileSync(resolve(root, 'server/utils/ws-schemas.ts'), 'utf8')
const resolverTs = readFileSync(resolve(root, 'server/game/engine/ActionResolver.ts'), 'utf8')
const parserTs = readFileSync(resolve(root, 'app/composables/useCommands.ts'), 'utf8')

/** Command types declared on the Command union. */
const commandTypes = quotedStrings(commandsTs, /\| \{ type: '([a-z_]+)'/g)

/** Target kinds on TargetRef. */
const targetKinds = quotedStrings(commandsTs, /\| \{ kind: '([a-z]+)'/g)

/** z.literal command types inside commandSchema only (before clientMessageSchema). */
const schemaBlock = schemasTs.split('clientMessageSchema')[0] ?? schemasTs
const schemaCommandTypes = quotedStrings(schemaBlock, /type: z\.literal\('([a-z_]+)'\)/g).filter(
  (t) => !['q', 'w', 'e', 'r', 'team', 'all', 'yes', 'no'].includes(t),
)

const schemaTargetKinds = quotedStrings(schemaBlock, /kind: z\.literal\('([a-z]+)'\)/g)

/** validateAction switch cases. */
const validateStart = resolverTs.indexOf('switch (cmd.type)')
const validateSlice = resolverTs.slice(validateStart, validateStart + 8000)
const resolverCases = quotedStrings(validateSlice, /case '([a-z_]+)':/g)

describe('Trap #9 — command vocabulary mirrors', () => {
  it('Command union and TargetRef kinds are non-empty', () => {
    expect(commandTypes.length).toBeGreaterThan(10)
    expect(targetKinds).toEqual([...TARGET_KINDS].sort())
  })

  it('every server-bound Command type is in the zod commandSchema', () => {
    const clientOnly = new Set<string>(CLIENT_ONLY_COMMAND_TYPES)
    const missing = commandTypes.filter(
      (t) => !clientOnly.has(t) && !schemaCommandTypes.includes(t),
    )
    expect(missing, `add to ws-schemas commandSchema: ${missing.join(', ')}`).toEqual([])
  })

  it('client-only commands are NOT in the zod commandSchema', () => {
    const leaked = CLIENT_ONLY_COMMAND_TYPES.filter((t) => schemaCommandTypes.includes(t))
    expect(leaked, `client-only must not be wire-validated: ${leaked.join(', ')}`).toEqual([])
  })

  it('TargetRef kinds match zod targetRefSchema', () => {
    expect(schemaTargetKinds.sort()).toEqual([...TARGET_KINDS].sort())
  })

  it('ActionResolver validateAction has a case for every server-bound Command type', () => {
    const clientOnly = new Set<string>(CLIENT_ONLY_COMMAND_TYPES)
    // Resolver also lists client-only as no-ops (scan/status/map/help) for
    // defense-in-depth if a message slips through — require server-bound only.
    const missing = commandTypes.filter((t) => !clientOnly.has(t) && !resolverCases.includes(t))
    expect(missing, `add validateAction case: ${missing.join(', ')}`).toEqual([])
  })

  it('useCommands parser switch mentions every Command type (or a typed alias)', () => {
    // Parser uses short aliases for some verbs (ss→missing, mv→move). Require
    // the canonical type string appears somewhere in the parse switch body.
    const parseStart = parserTs.indexOf('switch (cmd)')
    const parseBody = parserTs.slice(parseStart, parseStart + 12000)
    const missing = commandTypes.filter(
      (t) => !parseBody.includes(`'${t}'`) && !parseBody.includes(`"${t}"`),
    )
    // 'select_talent' is parsed as 'talent' then normalized — allow talent alias.
    const allowedMissing = new Set(['select_talent'])
    expect(
      missing.filter((t) => !allowedMissing.has(t)),
      `parser must recognize: ${missing.join(', ')}`,
    ).toEqual([])
  })

  it('commandSchema accepts a representative server-bound action', () => {
    const parsed = commandSchema.safeParse({ type: 'move', zone: 'coldstore-cross' })
    expect(parsed.success).toBe(true)
  })

  it('commandSchema rejects an unknown verb (trap: silent accept)', () => {
    const parsed = commandSchema.safeParse({ type: 'dance', zone: 'coldstore-cross' })
    expect(parsed.success).toBe(false)
  })
})
