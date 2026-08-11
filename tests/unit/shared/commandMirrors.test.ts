/**
 * Trap #9 — command vocabulary is mirrored across three places (was four; the
 * zod wire-schema mirror, server/utils/ws-schemas.ts, was deleted with the
 * DO-era WS route in the all-Vercel cutover — see shared/constants/
 * commands.ts's doc comment). A green suite used to let a verb land in the
 * parser but not ActionResolver (or vice versa). This test is the tripwire:
 * add a Command type → update the parser + ActionResolver, or declare it
 * client-only in shared/constants/commands.ts.
 */
import { describe, it, expect } from 'vitest'
import { CLIENT_ONLY_COMMAND_TYPES, TARGET_KINDS } from '~~/shared/constants/commands'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** Extract `"foo"` from `type: 'foo'` lines. */
function quotedStrings(src: string, re: RegExp): string[] {
  const out: string[] = []
  for (const m of src.matchAll(re)) {
    if (m[1]) out.push(m[1])
  }
  return [...new Set(out)].sort()
}

const root = resolve(import.meta.dirname, '../../..')

const commandsTs = readFileSync(resolve(root, 'shared/types/commands.ts'), 'utf8')
const resolverTs = readFileSync(resolve(root, 'server/game/engine/ActionResolver.ts'), 'utf8')
const parserTs = readFileSync(resolve(root, 'app/composables/useCommands.ts'), 'utf8')

/** Command types declared on the Command union. */
const commandTypes = quotedStrings(commandsTs, /\| \{ type: '([a-z_]+)'/g)

/** Target kinds on TargetRef. */
const targetKinds = quotedStrings(commandsTs, /\| \{ kind: '([a-z]+)'/g)

/** validateAction switch cases. */
const validateStart = resolverTs.indexOf('switch (cmd.type)')
const validateSlice = resolverTs.slice(validateStart, validateStart + 8000)
const resolverCases = quotedStrings(validateSlice, /case '([a-z_]+)':/g)

describe('Trap #9 — command vocabulary mirrors', () => {
  it('Command union and TargetRef kinds are non-empty', () => {
    expect(commandTypes.length).toBeGreaterThan(10)
    expect(targetKinds).toEqual([...TARGET_KINDS].sort())
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
})
