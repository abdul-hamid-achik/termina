import { start } from 'workflow/api'
import { tickSpike } from '~~/server/workflows/tickSpike'

/**
 * SPIKE trigger (spike/workflow-tick branch). Lives OUTSIDE /api on purpose:
 * vercel.json rewrites /api/* to the DigitalOcean backend, which would
 * swallow this route on preview deployments.
 *
 * POST /spike-workflow?key=<SPIKE_KEY>&ticks=150&label=preview1
 */
export default defineEventHandler(async (event) => {
  const q = getQuery(event)
  const expected = process.env.SPIKE_KEY ?? 'dev'
  if (q.key !== expected) {
    throw createError({ statusCode: 403, message: 'spike key required' })
  }
  const ticks = Math.min(600, Math.max(2, Number(q.ticks ?? 150)))
  const label = String(q.label ?? 'spike')
  const run = await start(tickSpike, [label, ticks])
  return { started: true, label, ticks, run }
})
