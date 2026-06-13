import { createHmac, timingSafeEqual } from 'node:crypto'

const TICKET_TTL_MS = 60_000

interface TicketPayload {
  playerId: string
  exp: number
}

export function createWsTicket(playerId: string, secret: string): string {
  const payload: TicketPayload = {
    playerId,
    exp: Date.now() + TICKET_TTL_MS,
  }
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = createHmac('sha256', secret).update(encoded).digest('base64url')
  return `${encoded}.${sig}`
}

export function verifyWsTicket(ticket: string, secret: string): string | null {
  const dotIdx = ticket.indexOf('.')
  if (dotIdx === -1) return null

  const encoded = ticket.slice(0, dotIdx)
  const sig = ticket.slice(dotIdx + 1)

  const expectedSig = createHmac('sha256', secret).update(encoded).digest('base64url')
  const sigBuf = Buffer.from(sig)
  const expectedBuf = Buffer.from(expectedSig)
  // timingSafeEqual THROWS on length mismatch — a crafted short ticket must
  // be an auth failure, not an exception in the WS open hook.
  if (sigBuf.byteLength !== expectedBuf.byteLength) return null
  if (!timingSafeEqual(sigBuf, expectedBuf)) return null

  try {
    const payload: TicketPayload = JSON.parse(Buffer.from(encoded, 'base64url').toString())
    // exp must be a real number — a signed payload missing exp must not
    // become a ticket that never expires.
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) return null
    if (payload.exp < Date.now()) return null
    return payload.playerId || null
  } catch {
    return null
  }
}
