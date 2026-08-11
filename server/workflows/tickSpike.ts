import { sleep } from 'workflow'

/**
 * SPIKE (spike/workflow-tick): can Vercel Workflow DevKit drive TERMINA's
 * 4-second batch clock?
 *
 * Measures the one number no documentation publishes — the actual wake-up
 * jitter of `sleep("4s")` — by ticking N times and stamping wall-clock time
 * in a STEP each wake (Date.now() must live in steps: workflow bodies replay
 * deterministically). The workflow's return value is the full interval
 * distribution, readable via `npx workflow inspect` or the Vercel dashboard.
 *
 * Go/no-go (from the migration memo): p95 tick-to-tick within 4.0s ± 250ms,
 * no single interval past 5.0s.
 */

async function stampNow(label: string, i: number): Promise<number> {
  'use step'
  const now = Date.now()
  console.log(`[tickSpike:${label}] tick ${i} at ${now}`)
  return now
}

async function logSummary(summary: Record<string, unknown>): Promise<void> {
  'use step'
  // One greppable line in the Vercel runtime logs — the results channel when
  // the run executes on a protected preview deployment.
  console.log(`[tickSpike:${String(summary.label)}] SUMMARY ${JSON.stringify(summary)}`)
}

export async function tickSpike(label: string, ticks: number) {
  'use workflow'
  const stamps: number[] = []
  for (let i = 0; i < ticks; i++) {
    await sleep('4s')
    stamps.push(await stampNow(label, i))
  }
  const summary = summarize(label, ticks, stamps)
  await logSummary(summary)
  return summary
}

/**
 * Variant 2 — ABSOLUTE deadlines: naive relative sleeps measured a consistent
 * ~1.2s of queue-scheduling overhead per cycle (p50 5204ms on the first
 * Vercel run). Sleeping until t0 + N*4000 anchors the AVERAGE cadence to
 * exactly 4s: overhead eats phase margin instead of stretching the interval.
 */
export async function tickSpikeAbsolute(label: string, ticks: number) {
  'use workflow'
  const t0 = await stampNow(label, -1)
  const stamps: number[] = []
  for (let i = 0; i < ticks; i++) {
    await sleep(new Date(t0 + (i + 1) * 4000))
    stamps.push(await stampNow(label, i))
  }
  const summary = summarize(label, ticks, stamps)
  await logSummary(summary)
  return summary
}

/** Pure interval math — no steps in here (steps stay in the workflow bodies). */
function summarize(label: string, ticks: number, stamps: number[]) {
  const intervals = stamps.slice(1).map((t, i) => t - stamps[i]!)
  const sorted = [...intervals].sort((a, b) => a - b)
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0
  const summary = {
    label,
    ticks,
    firstStamp: stamps[0] ?? null,
    lastStamp: stamps[stamps.length - 1] ?? null,
    intervals,
    p50: at(0.5),
    p95: at(0.95),
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    // The go/no-go verdicts, computed where the data lives.
    p95WithinBudget: at(0.95) >= 3750 && at(0.95) <= 4250,
    worstWithinHardCap: (sorted[sorted.length - 1] ?? 0) <= 5000,
  }
  return summary
}
