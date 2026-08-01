/**
 * Client-side mirror of the server's rejection escalation (playability
 * ledger): the same pre-flight rejection repeated for the third time gets a
 * help pointer, so the HUD stops reading like a stuck record. Only the THIRD
 * identical message differs — the first two stay as-is.
 */

const counts = new Map<string, number>()

function keyOf(message: string): string {
  return message.toLowerCase().replace(/\s+/g, ' ').trim()
}

export function escalateRejection(message: string): string {
  const key = keyOf(message)
  const n = (counts.get(key) ?? 0) + 1
  counts.set(key, n)
  return n === 3
    ? `${message} — third time: type \`help\` (or \`?\`) for the command list`
    : message
}

/** Drop the counters (new match / screen teardown). */
export function resetRejectionEscalation(): void {
  counts.clear()
}
