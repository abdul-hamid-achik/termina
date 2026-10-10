import { and, asc, eq, lt, sql } from 'drizzle-orm'
import { useDb } from '~~/server/db'
import { parties, partyMembers } from '~~/server/db/schema'

/**
 * Parties — a pre-queue group so friends can play co-op vs bots together. A
 * party caps at 5 (one team); the co-op match fills the rest with bots (see
 * server/api/party/start-coop.post.ts).
 *
 * Neon-backed: on Vercel every request may land on a different instance, so
 * the old module-level Maps (a party created on one instance was invisible to
 * the next) are gone. State lives in `parties` + `party_members`
 * (server/db/schema.ts):
 *  - `party_members.player_id` is the PRIMARY KEY → one party per player is
 *    enforced by the database itself;
 *  - `party_members.code` → `parties.code` ON DELETE CASCADE → disbanding a
 *    party removes its members in the same statement.
 *
 * Every MUTATION (create / join / leave) runs in a transaction holding one
 * global advisory lock (`pg_advisory_xact_lock(hashtext('parties'))`, the
 * same primitive queueNeon.ts uses per mode). Party traffic is tiny, so one
 * lock keeps the capacity check + insert, and the leave + promote sequence,
 * strictly serialized across instances — a join can never push a party past
 * MAX_PARTY_SIZE, and a leave can never race a join into an orphaned party.
 * The lock is transaction-scoped, so a crash or error releases it.
 */

export interface PartyMember {
  playerId: string
  username: string
  mmr: number
}

export interface Party {
  code: string
  leaderId: string
  members: PartyMember[]
  createdAt: number
}

export const MAX_PARTY_SIZE = 5

/** A party nobody started or left within this window is stale (abandoned tab):
 *  it is swept opportunistically on the next createParty, since there is no
 *  background process on Vercel to expire rows. */
export const PARTY_TTL_MS = 6 * 60 * 60 * 1000

// Unambiguous uppercase code alphabet (no 0/O/1/I/L to avoid confusion when
// friends read the code to each other).
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 5
const MAX_CODE_ATTEMPTS = 20

function generateCode(): string {
  let code = ''
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  }
  return code
}

type Db = ReturnType<typeof useDb>
/** A Drizzle transaction handle (or the db itself) — what the helpers need. */
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

async function lockParties(tx: Tx): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('parties'))`)
}

/** Load a party with its members, oldest member first. */
async function loadParty(db: Db | Tx, code: string): Promise<Party | undefined> {
  const rows = await db
    .select({
      code: parties.code,
      leaderId: parties.leaderId,
      createdAt: parties.createdAt,
      playerId: partyMembers.playerId,
      username: partyMembers.username,
      mmr: partyMembers.mmr,
    })
    .from(parties)
    .innerJoin(partyMembers, eq(partyMembers.code, parties.code))
    .where(eq(parties.code, code))
    .orderBy(asc(partyMembers.joinedAt), asc(partyMembers.playerId))
  const first = rows[0]
  if (!first) return undefined
  return {
    code: first.code,
    leaderId: first.leaderId,
    createdAt: first.createdAt.getTime(),
    members: rows.map((r) => ({ playerId: r.playerId, username: r.username, mmr: r.mmr })),
  }
}

/** Remove `playerId` from whatever party they are in (caller holds the lock). */
async function leaveInTx(tx: Tx, playerId: string): Promise<void> {
  const [row] = await tx
    .delete(partyMembers)
    .where(eq(partyMembers.playerId, playerId))
    .returning({ code: partyMembers.code })
  if (!row) return
  const remaining = await tx
    .select({ playerId: partyMembers.playerId })
    .from(partyMembers)
    .where(eq(partyMembers.code, row.code))
    .orderBy(asc(partyMembers.joinedAt), asc(partyMembers.playerId))
  // Empty party → disband. Leader left with members remaining → promote the
  // oldest remaining member so the party stays startable.
  if (remaining.length === 0) {
    await tx.delete(parties).where(eq(parties.code, row.code))
    return
  }
  const [party] = await tx
    .select({ leaderId: parties.leaderId })
    .from(parties)
    .where(eq(parties.code, row.code))
  if (party && party.leaderId === playerId) {
    await tx
      .update(parties)
      .set({ leaderId: remaining[0]!.playerId })
      .where(eq(parties.code, row.code))
  }
}

export async function createParty(leader: PartyMember): Promise<Party> {
  const db = useDb()
  const code = await db.transaction(async (tx) => {
    await lockParties(tx)
    // Sweep abandoned parties (cascade removes their members).
    await tx.delete(parties).where(lt(parties.createdAt, new Date(Date.now() - PARTY_TTL_MS)))
    // A player already in a party leaves it first (one party per player).
    await leaveInTx(tx, leader.playerId)

    for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
      const candidate = generateCode()
      const inserted = await tx
        .insert(parties)
        .values({ code: candidate, leaderId: leader.playerId })
        .onConflictDoNothing()
        .returning({ code: parties.code })
      if (inserted.length === 0) continue // code collision — re-roll
      await tx.insert(partyMembers).values({
        playerId: leader.playerId,
        code: candidate,
        username: leader.username,
        mmr: leader.mmr,
      })
      return candidate
    }
    throw new Error('Could not allocate a unique party code')
  })
  return (await loadParty(db, code))!
}

export async function joinParty(
  code: string,
  member: PartyMember,
): Promise<{ success: boolean; error?: string; party?: Party }> {
  const normalized = code.toUpperCase()
  const db = useDb()
  return db.transaction(async (tx) => {
    await lockParties(tx)
    const party = await loadParty(tx, normalized)
    if (!party) return { success: false, error: 'Party not found' }
    if (party.members.some((m) => m.playerId === member.playerId)) {
      return { success: true, party } // already in it — idempotent
    }
    if (party.members.length >= MAX_PARTY_SIZE) {
      return { success: false, error: 'Party is full' }
    }
    await leaveInTx(tx, member.playerId) // leave any prior party
    await tx.insert(partyMembers).values({
      playerId: member.playerId,
      code: normalized,
      username: member.username,
      mmr: member.mmr,
    })
    return { success: true, party: (await loadParty(tx, normalized))! }
  })
}

export async function leaveParty(playerId: string): Promise<void> {
  await useDb().transaction(async (tx) => {
    await lockParties(tx)
    await leaveInTx(tx, playerId)
  })
}

export async function getParty(code: string): Promise<Party | undefined> {
  return loadParty(useDb(), code.toUpperCase())
}

export async function getPartyByPlayer(playerId: string): Promise<Party | undefined> {
  const db = useDb()
  const [row] = await db
    .select({ code: partyMembers.code })
    .from(partyMembers)
    .where(eq(partyMembers.playerId, playerId))
    .limit(1)
  return row ? loadParty(db, row.code) : undefined
}

export type ClaimPartyResult =
  | { ok: true; party: Party }
  | { ok: false; reason: 'not_in_party' | 'not_leader' }

/**
 * Atomically claim `playerId`'s party for a co-op start: inside the parties
 * advisory lock, snapshot the party (members included) and DELETE it
 * (`DELETE ... WHERE code AND leader_id RETURNING`). The snapshot is the
 * authoritative roster — a member joining after this commits is simply not in
 * it (they find no party), and a member joining before it is in the snapshot,
 * so nobody is silently dropped between "read roster" and "disband". A second
 * concurrent request (double-click, second tab) finds no party and loses.
 * If the game then fails to start, call `restoreParty` with the snapshot.
 */
export async function claimPartyForStart(playerId: string): Promise<ClaimPartyResult> {
  return useDb().transaction(async (tx) => {
    await lockParties(tx)
    const [row] = await tx
      .select({ code: partyMembers.code })
      .from(partyMembers)
      .where(eq(partyMembers.playerId, playerId))
      .limit(1)
    if (!row) return { ok: false as const, reason: 'not_in_party' as const }
    const party = await loadParty(tx, row.code)
    if (!party) return { ok: false as const, reason: 'not_in_party' as const }
    if (party.leaderId !== playerId) return { ok: false as const, reason: 'not_leader' as const }
    const deleted = await tx
      .delete(parties)
      .where(and(eq(parties.code, party.code), eq(parties.leaderId, playerId)))
      .returning({ code: parties.code })
    if (deleted.length === 0) return { ok: false as const, reason: 'not_in_party' as const }
    return { ok: true as const, party }
  })
}

/**
 * Put a claimed party back (the co-op game failed to start). Keeps the code,
 * leader, createdAt and member order. A member who has since joined another
 * party keeps that one (ON CONFLICT DO NOTHING); if the code was somehow
 * re-allocated the restore is skipped.
 */
export async function restoreParty(party: Party): Promise<void> {
  await useDb().transaction(async (tx) => {
    await lockParties(tx)
    const inserted = await tx
      .insert(parties)
      .values({ code: party.code, leaderId: party.leaderId, createdAt: new Date(party.createdAt) })
      .onConflictDoNothing()
      .returning({ code: parties.code })
    if (inserted.length === 0) return
    const base = Date.now() - party.members.length
    await tx
      .insert(partyMembers)
      .values(
        party.members.map((m, i) => ({
          playerId: m.playerId,
          code: party.code,
          username: m.username,
          mmr: m.mmr,
          // Distinct, increasing joinedAt keeps the oldest-first order that
          // leader promotion relies on.
          joinedAt: new Date(base + i),
        })),
      )
      .onConflictDoNothing()
    // Members who joined another party in the meantime were skipped above. No
    // one left → drop the orphan row; leader gone → promote the oldest left.
    const left = await tx
      .select({ playerId: partyMembers.playerId })
      .from(partyMembers)
      .where(eq(partyMembers.code, party.code))
      .orderBy(asc(partyMembers.joinedAt), asc(partyMembers.playerId))
    if (left.length === 0) {
      await tx.delete(parties).where(eq(parties.code, party.code))
    } else if (!left.some((m) => m.playerId === party.leaderId)) {
      await tx
        .update(parties)
        .set({ leaderId: left[0]!.playerId })
        .where(eq(parties.code, party.code))
    }
  })
}

/** Remove a party entirely (called when its co-op game starts). The FK
 *  cascade clears its members, freeing each player to join another party. */
export async function disbandParty(code: string): Promise<void> {
  await useDb().delete(parties).where(eq(parties.code, code.toUpperCase()))
}
