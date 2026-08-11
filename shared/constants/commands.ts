/**
 * Command vocabulary — Trap #9 hygiene.
 *
 * The wire protocol for player actions is mirrored in three places (was four
 * — `server/utils/ws-schemas.ts`'s zod schemas were deleted with the DO-era
 * WS route in the all-Vercel cutover; its Workflow-path replacement,
 * `server/api/game/action.post.ts`, currently does NOT re-validate
 * `body.command` against a schema before writing it to `pending_actions` —
 * a known, inherited gap from that migration, not reintroduced here — see
 * its own file for the TODO). Adding a verb means updating ALL of the
 * surviving mirrors (or, for client-only readouts, listing it here so a
 * future mirror test knows it must NOT appear on the wire):
 *
 *  1. `shared/types/commands.ts` — Command / TargetRef unions (source of truth)
 *  2. `app/composables/useCommands.ts` — parser + autocomplete
 *  3. `server/game/engine/ActionResolver.ts` — validateAction cases
 *
 * Client-only commands are parsed for local help/status/map readouts and are
 * NEVER submitted as `action` messages (GameScreen short-circuits them). They
 * stay on the Command union so the parser has a typed result.
 */
import type { Command, TargetRef } from '~~/shared/types/commands'

/** Commands handled entirely on the client — must not appear in commandSchema. */
export const CLIENT_ONLY_COMMAND_TYPES = [
  'help',
  'status',
  'map',
  'scan',
  'who',
  'net',
  'look',
] as const satisfies readonly Command['type'][]

/** TargetRef kinds that travel on the wire (must match zod targetRefSchema). */
export const TARGET_KINDS = [
  'hero',
  'wave',
  'neutral',
  'ice',
  'tenant',
  'terminal',
  'zone',
  'self',
] as const satisfies readonly TargetRef['kind'][]
