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
 * Both functions silently no-op when ABLY_API_KEY is unset, matching the
 * spike's "just measure, don't require Ably locally" behavior.
 */

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
