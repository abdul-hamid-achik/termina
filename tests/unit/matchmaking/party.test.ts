import { describe, it, expect, beforeEach } from 'vitest'
import {
  createParty,
  joinParty,
  leaveParty,
  getParty,
  getPartyByPlayer,
  disbandParty,
  clearAllParties,
  MAX_PARTY_SIZE,
} from '~~/server/game/matchmaking/party'

const member = (id: string) => ({ playerId: id, username: id, mmr: 1000 })

describe('party', () => {
  beforeEach(() => clearAllParties())

  it('creates a party with the leader as the sole member', () => {
    const party = createParty(member('alice'))
    expect(party.code).toHaveLength(5)
    expect(party.leaderId).toBe('alice')
    expect(party.members).toHaveLength(1)
    expect(getPartyByPlayer('alice')?.code).toBe(party.code)
  })

  it('joins an existing party by code (case-insensitive)', () => {
    const party = createParty(member('alice'))
    const result = joinParty(party.code.toLowerCase(), member('bob'))
    expect(result.success).toBe(true)
    expect(getParty(party.code)?.members.map((m) => m.playerId)).toEqual(['alice', 'bob'])
  })

  it('rejects joining a nonexistent party', () => {
    expect(joinParty('NOPE1', member('bob')).success).toBe(false)
  })

  it('is idempotent when a member rejoins their own party', () => {
    const party = createParty(member('alice'))
    joinParty(party.code, member('bob'))
    const again = joinParty(party.code, member('bob'))
    expect(again.success).toBe(true)
    expect(getParty(party.code)?.members).toHaveLength(2)
  })

  it('caps the party at MAX_PARTY_SIZE', () => {
    const party = createParty(member('p0'))
    for (let i = 1; i < MAX_PARTY_SIZE; i++) {
      expect(joinParty(party.code, member(`p${i}`)).success).toBe(true)
    }
    const overflow = joinParty(party.code, member('overflow'))
    expect(overflow.success).toBe(false)
    expect(getParty(party.code)?.members).toHaveLength(MAX_PARTY_SIZE)
  })

  it('moving to a new party leaves the old one', () => {
    const a = createParty(member('alice'))
    joinParty(a.code, member('bob'))
    // Bob creates his own party → leaves Alice's.
    const b = createParty(member('bob'))
    expect(getParty(a.code)?.members.map((m) => m.playerId)).toEqual(['alice'])
    expect(getPartyByPlayer('bob')?.code).toBe(b.code)
  })

  it('promotes a new leader when the leader leaves', () => {
    const party = createParty(member('alice'))
    joinParty(party.code, member('bob'))
    leaveParty('alice')
    const after = getParty(party.code)
    expect(after?.leaderId).toBe('bob')
  })

  it('disbands the party when the last member leaves', () => {
    const party = createParty(member('alice'))
    leaveParty('alice')
    expect(getParty(party.code)).toBeUndefined()
    expect(getPartyByPlayer('alice')).toBeUndefined()
  })

  it('disbandParty removes the party and clears member mappings', () => {
    const party = createParty(member('alice'))
    joinParty(party.code, member('bob'))
    disbandParty(party.code)
    expect(getParty(party.code)).toBeUndefined()
    expect(getPartyByPlayer('alice')).toBeUndefined()
    expect(getPartyByPlayer('bob')).toBeUndefined()
  })
})
