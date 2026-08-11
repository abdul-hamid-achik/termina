import { start } from 'workflow/api'
import { tickSpike } from '~~/server/workflows/tickSpike'

/**
 * SPIKE trigger, GET variant: preview deployments sit behind Vercel
 * Authentication, which the owner's logged-in browser passes automatically —
 * so the trigger must be clickable. Results are read from runtime logs (the
 * workflow's final step logs the interval summary as JSON).
 *
 * GET /spike-workflow?key=<SPIKE_KEY>&ticks=150&label=vercel1
 */
export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const expected = process.env.SPIKE_KEY ?? 'dev'
  if (q.key !== expected) {
    throw createError({ statusCode: 403, message: 'spike key required' })
  }
  const ticks = Math.min(600, Math.max(2, Number(q.ticks ?? 150)))
  const label = String(q.label ?? 'spike')
  await start(tickSpike, [label, ticks])
  return {
    started: true,
    label,
    ticks,
    note: `~${Math.round((ticks * 4) / 60)} min run — summary lands in runtime logs as [tickSpike:${label}] SUMMARY`,
  }
})
