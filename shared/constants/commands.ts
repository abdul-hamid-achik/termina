/**
 * Command vocabulary — Trap #9 hygiene.
 *
 * The wire protocol for player actions is mirrored in four places. Adding a
 * verb means updating ALL of them (or, for client-only readouts, listing it
 * here so the mirror test knows it must NOT appear on the wire):
 *
 *  1. `shared/types/commands.ts` — Command / TargetRef unions (source of truth)
 *  2. `server/utils/ws-schemas.ts` — zod schemas for client → server messages
 *  3. `app/composables/useCommands.ts` — parser + autocomplete
 *  4. `server/game/engine/ActionResolver.ts` — validateAction cases
 *
 * Client-only commands are parsed for local help/status/map readouts and are
 * NEVER submitted as `action` messages (GameScreen short-circuits them). They
 * stay on the Command union so the parser has a typed result, but they are
 * absent from the zod schema by design.
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
