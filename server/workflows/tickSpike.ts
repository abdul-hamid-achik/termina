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

export async function tickSpike(label: string, ticks: number) {
  'use workflow'
  const stamps: number[] = []
  for (let i = 0; i < ticks; i++) {
    await sleep('4s')
    stamps.push(await stampNow(label, i))
  }

  const intervals = stamps.slice(1).map((t, i) => t - stamps[i]!)
  const sorted = [...intervals].sort((a, b) => a - b)
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0
  return {
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
}
