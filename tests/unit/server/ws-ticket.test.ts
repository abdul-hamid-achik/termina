import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHmac } from 'node:crypto'
import { createWsTicket, verifyWsTicket } from '~~/server/utils/ws-ticket'

const SECRET = 'test-session-password-32-chars-min!'
const TICKET_TTL_MS = 60_000 // mirrors the constant in ws-ticket.ts

/** Sign an arbitrary encoded payload exactly the way the module does. */
function sign(encoded: string, secret: string): string {
  return createHmac('sha256', secret).update(encoded).digest('base64url')
}

function craftTicket(payload: unknown, secret: string): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${encoded}.${sign(encoded, secret)}`
}

describe('ws-ticket', () => {
  describe('round-trip', () => {
    it('verifies a freshly created ticket and returns the playerId', () => {
      const ticket = createWsTicket('github_7379966', SECRET)
      expect(verifyWsTicket(ticket, SECRET)).toBe('github_7379966')
    })

    it('round-trips playerIds containing dots and special chars', () => {
      const playerId = 'local.user-name_42'
      const ticket = createWsTicket(playerId, SECRET)
      expect(verifyWsTicket(ticket, SECRET)).toBe(playerId)
    })

    it('produces a two-part base64url ticket', () => {
      const ticket = createWsTicket('p1', SECRET)
      const parts = ticket.split('.')
      expect(parts).toHaveLength(2)
      expect(parts[0]).toMatch(/^[\w-]+$/)
      expect(parts[1]).toMatch(/^[\w-]+$/)
    })
  })

  describe('expiry', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-06-12T12:00:00Z'))
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('remains valid just before the TTL elapses', () => {
      const ticket = createWsTicket('p1', SECRET)
      vi.advanceTimersByTime(TICKET_TTL_MS - 1)
      expect(verifyWsTicket(ticket, SECRET)).toBe('p1')
    })

    it('remains valid at exactly the expiry instant (exp < now is strict)', () => {
      const ticket = createWsTicket('p1', SECRET)
      vi.advanceTimersByTime(TICKET_TTL_MS)
      expect(verifyWsTicket(ticket, SECRET)).toBe('p1')
    })

    it('rejects one millisecond after expiry', () => {
      const ticket = createWsTicket('p1', SECRET)
      vi.advanceTimersByTime(TICKET_TTL_MS + 1)
      expect(verifyWsTicket(ticket, SECRET)).toBeNull()
    })

    it('rejects a ticket whose exp is in the past at creation-verification time', () => {
      const ticket = craftTicket({ playerId: 'p1', exp: Date.now() - 1 }, SECRET)
      expect(verifyWsTicket(ticket, SECRET)).toBeNull()
    })
  })

  describe('tampering', () => {
    it('rejects a ticket whose payload was swapped (signature no longer matches)', () => {
      const ticket = createWsTicket('victim', SECRET)
      const sig = ticket.slice(ticket.indexOf('.') + 1)
      const forgedPayload = Buffer.from(
        JSON.stringify({ playerId: 'attacker', exp: Date.now() + 60_000 }),
      ).toString('base64url')
      expect(verifyWsTicket(`${forgedPayload}.${sig}`, SECRET)).toBeNull()
    })

    it('rejects a ticket with a same-length corrupted signature', () => {
      const ticket = createWsTicket('p1', SECRET)
      const dotIdx = ticket.indexOf('.')
      const sig = ticket.slice(dotIdx + 1)
      // Flip the first signature char to a different valid base64url char
      const flipped = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1)
      expect(verifyWsTicket(`${ticket.slice(0, dotIdx)}.${flipped}`, SECRET)).toBeNull()
    })

    it('rejects a ticket signed with the wrong secret', () => {
      const ticket = createWsTicket('p1', 'a-completely-different-secret-value')
      expect(verifyWsTicket(ticket, SECRET)).toBeNull()
    })

    it('rejects a self-signed ticket when verifier uses a different secret', () => {
      const ticket = craftTicket({ playerId: 'p1', exp: Date.now() + 60_000 }, 'attacker-secret')
      expect(verifyWsTicket(ticket, SECRET)).toBeNull()
    })
  })

  describe('malformed input', () => {
    it('rejects a ticket with no separator dot', () => {
      expect(verifyWsTicket('justonepart', SECRET)).toBeNull()
      expect(verifyWsTicket('', SECRET)).toBeNull()
    })

    it('rejects a correctly signed payload that is not JSON', () => {
      const encoded = Buffer.from('this is not json').toString('base64url')
      expect(verifyWsTicket(`${encoded}.${sign(encoded, SECRET)}`, SECRET)).toBeNull()
    })

    it('rejects a correctly signed payload with an empty playerId', () => {
      const ticket = craftTicket({ playerId: '', exp: Date.now() + 60_000 }, SECRET)
      expect(verifyWsTicket(ticket, SECRET)).toBeNull()
    })

    it('rejects a correctly signed payload missing playerId', () => {
      const ticket = craftTicket({ exp: Date.now() + 60_000 }, SECRET)
      expect(verifyWsTicket(ticket, SECRET)).toBeNull()
    })

    // A signature of a different length is an auth failure, not an exception
    // — timingSafeEqual throws on length mismatch, so verifyWsTicket guards
    // lengths first (a crafted ?ticket=x.short must not crash the WS open hook).
    it('returns null on a signature of a different length', () => {
      const encoded = Buffer.from(JSON.stringify({ playerId: 'p1', exp: Date.now() + 60_000 }))
        .toString('base64url')
      expect(verifyWsTicket(`${encoded}.short`, SECRET)).toBeNull()
    })

    // A signed payload with no exp must be rejected, not treated as eternal —
    // `undefined < Date.now()` is false, so exp is validated explicitly.
    it('rejects a signed payload without exp', () => {
      const ticket = craftTicket({ playerId: 'p1' }, SECRET)
      expect(verifyWsTicket(ticket, SECRET)).toBeNull()
    })
  })
})
