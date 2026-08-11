/**
 * Ably realtime-token minting (spike/workflow-tick: Ably replaces the
 * DO-hosted WebSocket transport). Kept out of the API route file so the
 * capability-scoping logic is directly unit-testable without stubbing
 * Nitro/h3 auto-imports.
 *
 * Deliberately has ZERO dependency on server/utils/ablyRest.ts (built in
 * parallel by another agent for the Workflow tick's server→client publish
 * path) — that module PUBLISHES on behalf of the server; this one mints a
 * SUBSCRIBE-only credential for a browser client's authCallback. Different
 * halves of the same Ably account, no shared code needed.
 */

import { createHmac, randomBytes } from 'node:crypto'

/** 1 hour — matches Ably's own default TokenRequest TTL. */
export const ABLY_TOKEN_TTL_MS = 60 * 60 * 1000

/**
 * Subscribe-only capability for one player: their own per-player channel
 * (private state — camera/inventory/etc, whatever gameTick's publish side
 * names it) across any game, plus every game's team-broadcast wildcard.
 * Never grants publish — clients only ever receive cycle state over Ably,
 * actions still go through POST /api/game/action.
 */
export function buildAblyCapability(playerId: string): Record<string, string[]> {
  return {
    [`game:*:p:${playerId}`]: ['subscribe'],
    'game:*:team:*': ['subscribe'],
  }
}

/** Split `appId.keyId:secret` into the keyName Ably's API addresses by path. */
export function parseAblyApiKey(apiKey: string): { keyName: string; keySecret: string } {
  const colonIdx = apiKey.indexOf(':')
  if (colonIdx === -1 || colonIdx === apiKey.length - 1) {
    throw new Error('Malformed ABLY_API_KEY (expected "keyName:secret")')
  }
  return { keyName: apiKey.slice(0, colonIdx), keySecret: apiKey.slice(colonIdx + 1) }
}

export interface MintAblyTokenRequestOptions {
  apiKey: string
  playerId: string
  ttlMs?: number
  /** Injectable for tests; default Date.now(). */
  now?: number
  /** Injectable for tests; default crypto-random. */
  nonce?: string
}

export interface AblyTokenRequest {
  keyName: string
  ttl: number
  capability: string
  clientId: string
  timestamp: number
  nonce: string
  mac: string
}

/**
 * Mint a scoped Ably TokenRequest for `playerId` — SIGNED LOCALLY with
 * HMAC-SHA256 per Ably's TokenRequest spec (no network call; the previous
 * implementation POSTed to a /keys/{keyName}/requests endpoint that does not
 * exist and 404'd in production). The returned object is handed straight to
 * the client SDK's authCallback; the SDK exchanges it with Ably itself.
 *
 * Sign text per spec: keyName, ttl, capability, clientId, timestamp, nonce —
 * newline-joined WITH a trailing newline — HMAC'd with the key secret.
 */
export function mintAblyTokenRequest(options: MintAblyTokenRequestOptions): AblyTokenRequest {
  const { apiKey, playerId, ttlMs = ABLY_TOKEN_TTL_MS } = options
  const { keyName, keySecret } = parseAblyApiKey(apiKey)
  const capability = JSON.stringify(buildAblyCapability(playerId))
  const timestamp = options.now ?? Date.now()
  const nonce = options.nonce ?? randomBytes(16).toString('hex')

  const signText =
    [keyName, String(ttlMs), capability, playerId, String(timestamp), nonce].join('\n') + '\n'
  const mac = createHmac('sha256', keySecret).update(signText).digest('base64')

  return { keyName, ttl: ttlMs, capability, clientId: playerId, timestamp, nonce, mac }
}
