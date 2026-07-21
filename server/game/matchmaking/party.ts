/**
 * Parties — a lightweight, in-memory pre-queue group so friends can play co-op
 * vs bots together. Parties are transient (they live until the co-op game starts
 * or the party disbands), so they're kept in process memory like lobbies rather
 * than persisted. A party caps at 5 (one team); the co-op match fills the rest
 * with bots (see createCoopLobby).
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

const parties = new Map<string, Party>()
const playerToParty = new Map<string, string>()

// Unambiguous uppercase code alphabet (no 0/O/1/I/L to avoid confusion when
// friends read the code to each other).
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 5

function generateCode(): string {
  // Re-roll on the (astronomically unlikely) chance of a collision.
  for (;;) {
    let code = ''
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
    }
    if (!parties.has(code)) return code
  }
}

export function createParty(leader: PartyMember): Party {
  // A player already in a party leaves it first (one party per player).
  leaveParty(leader.playerId)
  const party: Party = {
    code: generateCode(),
    leaderId: leader.playerId,
    members: [leader],
    createdAt: Date.now(),
  }
  parties.set(party.code, party)
  playerToParty.set(leader.playerId, party.code)
  return party
}

export function joinParty(
  code: string,
  member: PartyMember,
): { success: boolean; error?: string; party?: Party } {
  const party = parties.get(code.toUpperCase())
  if (!party) return { success: false, error: 'Party not found' }
  if (party.members.some((m) => m.playerId === member.playerId)) {
    return { success: true, party } // already in it — idempotent
  }
  if (party.members.length >= MAX_PARTY_SIZE) {
    return { success: false, error: 'Party is full' }
  }
  leaveParty(member.playerId) // leave any prior party
  party.members.push(member)
  playerToParty.set(member.playerId, party.code)
  return { success: true, party }
}

export function leaveParty(playerId: string): void {
  const code = playerToParty.get(playerId)
  if (!code) return
  playerToParty.delete(playerId)
  const party = parties.get(code)
  if (!party) return
  party.members = party.members.filter((m) => m.playerId !== playerId)
  // Empty party → disband. Leader left with members remaining → promote the
  // first remaining member so the party stays startable.
  if (party.members.length === 0) {
    parties.delete(code)
  } else if (party.leaderId === playerId) {
    party.leaderId = party.members[0]!.playerId
  }
}

export function getParty(code: string): Party | undefined {
  return parties.get(code.toUpperCase())
}

export function getPartyByPlayer(playerId: string): Party | undefined {
  const code = playerToParty.get(playerId)
  return code ? parties.get(code) : undefined
}

/** Remove a party entirely (called when its co-op game starts). */
export function disbandParty(code: string): void {
  const party = parties.get(code.toUpperCase())
  if (!party) return
  for (const m of party.members) playerToParty.delete(m.playerId)
  parties.delete(code.toUpperCase())
}

/** Test helper — clear all parties. */
export function clearAllParties(): void {
  parties.clear()
  playerToParty.clear()
}
