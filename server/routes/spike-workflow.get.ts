import { start } from 'workflow/api'
import { tickSpike, tickSpikeAbsolute, tickSpikeAligned } from '~~/server/workflows/tickSpike'
import { tickGameSpike } from '~~/server/workflows/tickGameSpike'

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
  // ?mode=game → SPIKE 3 (full pipeline: Neon state + processCycle + Ably);
  // ?mode=aligned → variant 3 timing; ?mode=absolute → variant 2;
  // default = naive relative (variant 1).
  if (q.mode === 'game') {
    const gameId = `spike3_${label}`
    await start(tickGameSpike, [gameId, ticks])
    return {
      started: true,
      mode: 'game',
      gameId,
      maxTicks: ticks,
      note: `bot 2v2 plays itself — summary lands as [gameSpike:${gameId}] SUMMARY`,
    }
  }
  const workflow =
    q.mode === 'aligned' ? tickSpikeAligned : q.mode === 'absolute' ? tickSpikeAbsolute : tickSpike
  await start(workflow, [label, ticks])
  return {
    started: true,
    label,
    ticks,
    note: `~${Math.round((ticks * 4) / 60)} min run — summary lands in runtime logs as [tickSpike:${label}] SUMMARY`,
  }
})
