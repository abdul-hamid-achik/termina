/**
 * Ably REST publish, extracted from the workflow spike
 * (server/workflows/tickGameSpike.ts SPIKE 3) so the production tick
 * workflow (server/workflows/gameTick.ts) and anything else on the
 * all-Vercel path can reuse it.
 *
 * REST (not the realtime SDK) is the right shape for a workflow step: no
 * persistent connection to keep alive across fresh instances — every step
 * may land on one — and a plain POST is naturally retryable by the step
 * itself if it throws.
 *
 * The publish functions silently no-op when ABLY_API_KEY is unset, matching the
 * spike's "just measure, don't require Ably locally" behavior.
 */

import { gameLog } from '~~/server/utils/log'

const ABLY_REST_HOST = 'https://rest.ably.io'

function ablyAuthHeader(): string | null {
  const key = process.env.ABLY_API_KEY
  if (!key) return null
  return `Basic ${Buffer.from(key).toString('base64')}`
}

/** Publish one message to one channel. */
export async function ablyPublish(
  channel: string,
  data: unknown,
  name: string = 'cycle_state',
): Promise<void> {
  const auth = ablyAuthHeader()
  if (!auth) return
  const res = await fetch(`${ABLY_REST_HOST}/channels/${encodeURIComponent(channel)}/messages`, {
    method: 'POST',
    headers: { authorization: auth, 'content-type': 'application/json' },
    body: JSON.stringify({ name, data }),
  })
  if (!res.ok) throw new Error(`ably publish ${channel} ${res.status}`)
}

export interface AblyBatchSpec {
  channel: string
  data: unknown
  name?: string
}

/**
 * Publish to many channels in one HTTP round trip via Ably's REST batch
 * endpoint — a tick's fog-filtered per-player payloads (10 in a live 5v5)
 * become one POST instead of ten. See Ably's batch publish spec: each entry
 * is `{ channels: string | string[], messages: Message | Message[] }`.
 */
export async function ablyPublishBatch(specs: AblyBatchSpec[]): Promise<void> {
  if (specs.length === 0) return
  const auth = ablyAuthHeader()
  if (!auth) return
  const body = specs.map((s) => ({
    channels: [s.channel],
    messages: { name: s.name ?? 'cycle_state', data: s.data },
  }))
  const res = await fetch(`${ABLY_REST_HOST}/messages`, {
    method: 'POST',
    headers: { authorization: auth, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`ably batch publish ${res.status}`)
}

/** Ably's REST protocol version — the same `X-Ably-Version` the installed
 *  ably-js SDK sends (ably@2.x: 6), which shapes the batch-presence response. */
const ABLY_PROTOCOL_VERSION = '6'
/** A presence lookup rides inside a 4s tick: never let a slow Ably GET eat it. */
const PRESENCE_TIMEOUT_MS = 1_500

/** A broken presence lookup is logged at most this often per process. */
const PRESENCE_WARN_INTERVAL_MS = 5 * 60_000
let lastPresenceWarnAt = -Infinity

/**
 * A presence failure degrades to "unknown ⇒ connected", which silently turns
 * AFK detection OFF — so a capability/auth problem (e.g. a key without the
 * `presence` capability: HTTP 401/403, Ably code 40160) must be visible. Rate
 * limited because the lookup rides every 4s tick. Never logs the key.
 */
function warnPresenceFailure(detail: Record<string, unknown>): void {
  const now = Date.now()
  if (now - lastPresenceWarnAt < PRESENCE_WARN_INTERVAL_MS) return
  lastPresenceWarnAt = now
  gameLog.warn('Ably presence lookup failed — AFK detection is blind until fixed', detail)
}

/** PresenceMessage actions that mean "no longer here" (wire ints + names). */
const GONE_ACTIONS = new Set<unknown>([0, 3, 'absent', 'leave'])

/**
 * Who is present on each channel, via Ably's REST batch-presence endpoint
 * (`GET /presence?channels=a,b` — ably-js's `Rest.batchPresence`): ONE request
 * for every channel asked about (Ably caps a batch at 100 channels).
 *
 * Returns channel → set of present clientIds. A channel Ably reported an
 * error for is OMITTED (unknown, not empty). Returns null — never throws —
 * when ABLY_API_KEY is unset, the request fails or times out, or the body is
 * unreadable: the caller must read null/omitted as "unknown ⇒ connected".
 */
export async function ablyPresence(
  channels: string[],
  fetchImpl: typeof fetch = fetch,
): Promise<Map<string, Set<string>> | null> {
  if (channels.length === 0) return new Map()
  const auth = ablyAuthHeader()
  if (!auth) return null
  try {
    const qs = new URLSearchParams({ channels: channels.join(',') })
    const res = await fetchImpl(`${ABLY_REST_HOST}/presence?${qs}`, {
      method: 'GET',
      headers: {
        authorization: auth,
        accept: 'application/json',
        'X-Ably-Version': ABLY_PROTOCOL_VERSION,
      },
      signal: AbortSignal.timeout(PRESENCE_TIMEOUT_MS),
    })
    if (!res.ok) {
      let ablyCode: unknown
      try {
        ablyCode = ((await res.json()) as { error?: { code?: unknown } })?.error?.code
      } catch {
        // non-JSON error body — the status alone still says enough
      }
      warnPresenceFailure({ status: res.status, ablyCode })
      return null
    }
    const body = (await res.json()) as unknown
    // v2+ protocol: { successCount, failureCount, results: [...] }; older
    // protocol versions answer with the bare per-channel array.
    const results = Array.isArray(body)
      ? body
      : Array.isArray((body as { results?: unknown })?.results)
        ? (body as { results: unknown[] }).results
        : null
    if (!results) return null
    const present = new Map<string, Set<string>>()
    for (const r of results as Array<{ channel?: unknown; presence?: unknown }>) {
      if (typeof r?.channel !== 'string' || !Array.isArray(r.presence)) continue
      const ids = new Set<string>()
      for (const m of r.presence as Array<{ clientId?: unknown; action?: unknown }>) {
        if (typeof m?.clientId === 'string' && !GONE_ACTIONS.has(m.action)) ids.add(m.clientId)
      }
      present.set(r.channel, ids)
    }
    return present
  } catch (err) {
    warnPresenceFailure({ error: err instanceof Error ? err.name : 'unknown' })
    return null
  }
}
