import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'

// Point party.ts's useDb() at the real test-DB connection — same hoist-safe
// async-factory pattern as tests/integration/queueNeon.test.ts.
vi.mock('~~/server/db', async () => {
  const { testDb } = await import('../helpers/test-db')
  return { useDb: () => testDb }
})

import {
  createParty,
  joinParty,
  leaveParty,
  getParty,
  getPartyByPlayer,
  disbandParty,
  claimPartyForStart,
  restoreParty,
  MAX_PARTY_SIZE,
  PARTY_TTL_MS,
} from '~~/server/game/matchmaking/party'
import { truncateAll, client, testDb } from '../helpers/test-db'
import { parties, partyMembers } from '~~/server/db/schema'

beforeEach(async () => {
  await truncateAll()
})

afterAll(async () => {
  await client.end()
})

const member = (id: string, mmr = 1000) => ({ playerId: id, username: id, mmr })
const ids = (p?: { members: { playerId: string }[] }) => p?.members.map((m) => m.playerId)

/** A fresh copy of party.ts with brand-new module state — what a different
 *  Vercel instance sees. Nothing may be cached in-process. */
async function freshInstance() {
  vi.resetModules()
  return import('~~/server/game/matchmaking/party')
}

describe('party (real Postgres)', () => {
  it('creates a party with the leader as the sole member', async () => {
    const party = await createParty(member('alice', 1234))
    expect(party.code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{5}$/)
    expect(party.leaderId).toBe('alice')
    expect(party.members).toEqual([{ playerId: 'alice', username: 'alice', mmr: 1234 }])
    expect(typeof party.createdAt).toBe('number')
    expect((await getPartyByPlayer('alice'))?.code).toBe(party.code)
  })

  describe('cross-instance visibility (no in-process state)', () => {
    it('a party created on one instance is joinable + readable from another', async () => {
      const party = await createParty(member('alice'))

      const other = await freshInstance()
      const joined = await other.joinParty(party.code.toLowerCase(), member('bob'))
      expect(joined.success).toBe(true)
      expect(ids(joined.party)).toEqual(['alice', 'bob'])

      const third = await freshInstance()
      expect(ids(await third.getParty(party.code))).toEqual(['alice', 'bob'])
      expect((await third.getPartyByPlayer('bob'))?.code).toBe(party.code)
      expect((await third.getPartyByPlayer('alice'))?.leaderId).toBe('alice')
    })

    it('a leave on one instance is seen by another (with leader promotion)', async () => {
      const party = await createParty(member('alice'))
      await joinParty(party.code, member('bob'))

      const other = await freshInstance()
      await other.leaveParty('alice')

      const third = await freshInstance()
      const after = await third.getParty(party.code)
      expect(after?.leaderId).toBe('bob')
      expect(ids(after)).toEqual(['bob'])
      expect(await third.getPartyByPlayer('alice')).toBeUndefined()
    })
  })

  describe('join', () => {
    it('joins by code, case-insensitively', async () => {
      const party = await createParty(member('alice'))
      const result = await joinParty(party.code.toLowerCase(), member('bob'))
      expect(result.success).toBe(true)
      expect(ids(await getParty(party.code))).toEqual(['alice', 'bob'])
    })

    it('rejects a nonexistent party', async () => {
      const result = await joinParty('NOPE1', member('bob'))
      expect(result).toMatchObject({ success: false, error: 'Party not found' })
      expect(await getPartyByPlayer('bob')).toBeUndefined()
    })

    it('is idempotent when a member rejoins their own party', async () => {
      const party = await createParty(member('alice'))
      await joinParty(party.code, member('bob'))
      const again = await joinParty(party.code, member('bob'))
      expect(again.success).toBe(true)
      expect((await getParty(party.code))?.members).toHaveLength(2)
    })

    it('caps the party at MAX_PARTY_SIZE', async () => {
      const party = await createParty(member('p0'))
      for (let i = 1; i < MAX_PARTY_SIZE; i++) {
        expect((await joinParty(party.code, member(`p${i}`))).success).toBe(true)
      }
      const overflow = await joinParty(party.code, member('overflow'))
      expect(overflow).toMatchObject({ success: false, error: 'Party is full' })
      expect((await getParty(party.code))?.members).toHaveLength(MAX_PARTY_SIZE)
      expect(await getPartyByPlayer('overflow')).toBeUndefined()
    })

    it('a full-party rejection does not drop the joiner from their current party', async () => {
      const full = await createParty(member('p0'))
      for (let i = 1; i < MAX_PARTY_SIZE; i++) await joinParty(full.code, member(`p${i}`))
      const mine = await createParty(member('carol'))
      const result = await joinParty(full.code, member('carol'))
      expect(result.success).toBe(false)
      expect((await getPartyByPlayer('carol'))?.code).toBe(mine.code)
    })

    it('never exceeds MAX_PARTY_SIZE under concurrent joins at capacity', async () => {
      const party = await createParty(member('lead'))
      const results = await Promise.all(
        Array.from({ length: 12 }, (_, i) => joinParty(party.code, member(`j${i}`))),
      )
      expect(results.filter((r) => r.success)).toHaveLength(MAX_PARTY_SIZE - 1)
      expect(results.filter((r) => !r.success).every((r) => r.error === 'Party is full')).toBe(true)
      expect((await getParty(party.code))?.members).toHaveLength(MAX_PARTY_SIZE)
      expect(await testDb.select().from(partyMembers)).toHaveLength(MAX_PARTY_SIZE)
    })

    it('one player racing joins into two parties ends up in exactly one', async () => {
      const a = await createParty(member('a'))
      const b = await createParty(member('b'))
      await Promise.all([
        joinParty(a.code, member('racer')),
        joinParty(b.code, member('racer')),
        joinParty(a.code, member('racer')),
        joinParty(b.code, member('racer')),
      ])
      const rows = (await testDb.select().from(partyMembers)).filter((r) => r.playerId === 'racer')
      expect(rows).toHaveLength(1)
    })
  })

  describe('create', () => {
    it('moving to a new party leaves the old one', async () => {
      const a = await createParty(member('alice'))
      await joinParty(a.code, member('bob'))
      const b = await createParty(member('bob')) // bob starts his own
      expect(ids(await getParty(a.code))).toEqual(['alice'])
      expect((await getPartyByPlayer('bob'))?.code).toBe(b.code)
    })

    it('concurrent creates by one player leave exactly one party', async () => {
      await Promise.all(Array.from({ length: 5 }, () => createParty(member('dup'))))
      expect(await testDb.select().from(parties)).toHaveLength(1)
      expect(await testDb.select().from(partyMembers)).toHaveLength(1)
    })

    it('sweeps abandoned parties older than PARTY_TTL_MS', async () => {
      const stale = await createParty(member('ghost'))
      await testDb.update(parties).set({ createdAt: new Date(Date.now() - PARTY_TTL_MS - 1000) })
      await createParty(member('fresh'))
      expect(await getParty(stale.code)).toBeUndefined()
      expect(await getPartyByPlayer('ghost')).toBeUndefined()
      expect(await getPartyByPlayer('fresh')).toBeDefined()
    })
  })

  describe('leave', () => {
    it('promotes the OLDEST remaining member when the leader leaves', async () => {
      const party = await createParty(member('alice'))
      await joinParty(party.code, member('bob'))
      await joinParty(party.code, member('carol'))
      await leaveParty('alice')
      const after = await getParty(party.code)
      expect(after?.leaderId).toBe('bob')
      expect(ids(after)).toEqual(['bob', 'carol'])
    })

    it('keeps the leader when a non-leader leaves', async () => {
      const party = await createParty(member('alice'))
      await joinParty(party.code, member('bob'))
      await leaveParty('bob')
      expect(await getParty(party.code)).toMatchObject({ leaderId: 'alice' })
    })

    it('deletes the party row when the last member leaves', async () => {
      const party = await createParty(member('alice'))
      await leaveParty('alice')
      expect(await getParty(party.code)).toBeUndefined()
      expect(await getPartyByPlayer('alice')).toBeUndefined()
      expect(await testDb.select().from(parties)).toHaveLength(0)
    })

    it('is a no-op for a player in no party', async () => {
      await expect(leaveParty('nobody')).resolves.toBeUndefined()
    })
  })

  describe('disband (start-coop cleanup)', () => {
    it('removes the party and frees every member', async () => {
      const party = await createParty(member('alice'))
      await joinParty(party.code, member('bob'))
      await disbandParty(party.code)
      expect(await getParty(party.code)).toBeUndefined()
      expect(await getPartyByPlayer('alice')).toBeUndefined()
      expect(await getPartyByPlayer('bob')).toBeUndefined()
      expect(await testDb.select().from(partyMembers)).toHaveLength(0)
      // freed: bob can join elsewhere
      const next = await createParty(member('carol'))
      expect((await joinParty(next.code, member('bob'))).success).toBe(true)
    })
  })

  describe('claimPartyForStart (atomic co-op start)', () => {
    it('deletes the party and returns the member snapshot in join order', async () => {
      const party = await createParty(member('alice'))
      await joinParty(party.code, member('bob'))
      const claim = await claimPartyForStart('alice')
      expect(claim.ok).toBe(true)
      if (!claim.ok) throw new Error('unreachable')
      expect(claim.party.code).toBe(party.code)
      expect(ids(claim.party)).toEqual(['alice', 'bob'])
      expect(await getParty(party.code)).toBeUndefined()
      expect(await getPartyByPlayer('bob')).toBeUndefined()
    })

    it('rejects a non-leader without consuming the party', async () => {
      const party = await createParty(member('alice'))
      await joinParty(party.code, member('bob'))
      expect(await claimPartyForStart('bob')).toEqual({ ok: false, reason: 'not_leader' })
      expect(ids(await getParty(party.code))).toEqual(['alice', 'bob'])
    })

    it('rejects a player in no party', async () => {
      expect(await claimPartyForStart('nobody')).toEqual({ ok: false, reason: 'not_in_party' })
    })

    it('two concurrent claims by the leader: exactly one wins', async () => {
      await createParty(member('alice'))
      const rs = await Promise.all([claimPartyForStart('alice'), claimPartyForStart('alice')])
      expect(rs.filter((r) => r.ok)).toHaveLength(1)
      expect(rs.find((r) => !r.ok)).toEqual({ ok: false, reason: 'not_in_party' })
    })

    it('a join racing the claim is either in the snapshot or cleanly refused — never dropped', async () => {
      const party = await createParty(member('alice'))
      const [claim, join] = await Promise.all([
        claimPartyForStart('alice'),
        joinParty(party.code, member('late')),
      ])
      if (!claim.ok) throw new Error('claim should win for the leader')
      if (join.success) {
        // Joined before the claim -> must be in the snapshot.
        expect(ids(claim.party)).toContain('late')
      } else {
        expect(join.error).toBe('Party not found')
        expect(ids(claim.party)).toEqual(['alice'])
      }
      expect(await getPartyByPlayer('late')).toBeUndefined()
    })
  })

  describe('restoreParty (failed co-op start)', () => {
    it('puts the party back with the same code, leader and member order', async () => {
      // Join order deliberately differs from alphabetical order.
      const party = await createParty(member('zoe'))
      await joinParty(party.code, member('bob'))
      await joinParty(party.code, member('amy'))
      const claim = await claimPartyForStart('zoe')
      if (!claim.ok) throw new Error('unreachable')
      await restoreParty(claim.party)
      const back = await getParty(party.code)
      expect(back?.leaderId).toBe('zoe')
      expect(ids(back)).toEqual(['zoe', 'bob', 'amy'])
      expect(back?.createdAt).toBe(claim.party.createdAt)
      // Order survives: promoting on leader-leave picks the oldest remaining.
      await leaveParty('zoe')
      expect((await getParty(party.code))?.leaderId).toBe('bob')
    })

    it('does not steal a member who joined another party in the meantime', async () => {
      const party = await createParty(member('alice'))
      await joinParty(party.code, member('bob'))
      const claim = await claimPartyForStart('alice')
      if (!claim.ok) throw new Error('unreachable')
      const other = await createParty(member('bob'))
      await restoreParty(claim.party)
      expect((await getPartyByPlayer('bob'))?.code).toBe(other.code)
      expect(ids(await getParty(party.code))).toEqual(['alice'])
    })
  })

  describe('database invariants', () => {
    it('party_members.player_id is unique at the DB level', async () => {
      await createParty(member('a'))
      const b = await createParty(member('b'))
      await expect(
        testDb.insert(partyMembers).values({ playerId: 'a', code: b.code, username: 'a', mmr: 1 }),
      ).rejects.toThrow()
    })

    it('party_members.code must reference a real party', async () => {
      await expect(
        testDb
          .insert(partyMembers)
          .values({ playerId: 'x', code: 'ZZZZZ', username: 'x', mmr: 1000 }),
      ).rejects.toThrow()
    })
  })
})
