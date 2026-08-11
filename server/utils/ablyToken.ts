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
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch
}

/**
 * Mint a scoped Ably TokenRequest for `playerId` via Ably's REST API
 * (POST /keys/{keyName}/requests, Basic-authed with the full API key) and
 * return the JSON body as-is — it's handed straight to the client SDK's
 * authCallback, unmodified.
 */
export async function mintAblyTokenRequest(options: MintAblyTokenRequestOptions): Promise<unknown> {
  const { apiKey, playerId, ttlMs = ABLY_TOKEN_TTL_MS, fetchImpl = fetch } = options
  const { keyName } = parseAblyApiKey(apiKey)
  const capability = buildAblyCapability(playerId)

  const requestBody = {
    keyName,
    capability: JSON.stringify(capability),
    clientId: playerId,
    ttl: ttlMs,
    timestamp: Date.now(),
  }

  const res = await fetchImpl(`https://rest.ably.io/keys/${encodeURIComponent(keyName)}/requests`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(apiKey).toString('base64')}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  })

  if (!res.ok) {
    throw new Error(`Ably token mint failed (${res.status})`)
  }

  return res.json()
}
