// Pure view helpers for the replay scrubber (app/pages/replay/[gameId].vue).
// Extracted so the branchy command-formatting + scrub-clamp logic is unit-tested
// independently of the page's data-fetching and template.

export interface ReplayCommand {
  type: string
  [k: string]: unknown
}

/**
 * Human label for a replayed action-log command. Mirrors the in-game command
 * vocabulary; an unrecognised command type falls through to its bare name rather
 * than dumping raw JSON.
 */
export function formatReplayCommand(cmd: ReplayCommand): string {
  switch (cmd.type) {
    case 'move':
      return `move → ${String(cmd['zone'] ?? '?')}`
    case 'attack': {
      const t = cmd['target'] as { kind?: string; id?: string } | undefined
      return `attack ${t?.kind ?? ''} ${t?.id ?? ''}`.trim()
    }
    case 'cast':
      return `cast ${String(cmd['ability'] ?? '?')}`
    case 'buy':
      return `buy ${String(cmd['item'] ?? '?')}`
    case 'sell':
      return `sell ${String(cmd['item'] ?? '?')}`
    case 'buyback':
      return 'buyback'
    case 'surrender':
      return `surrender (${String(cmd['vote'] ?? '?')})`
    case 'select_talent':
      return `talent tier${String(cmd['tier'] ?? '?')}`
    case 'place_ward':
      return `ward ${String(cmd['kind'] ?? '?')} @ ${String(cmd['zone'] ?? '?')}`
    default:
      return cmd.type
  }
}

/**
 * Clamp a scrub position to a valid frame index. Frames are indexed by tick
 * (0..N-1); scrubbing past the end pins to the last frame, before the start
 * pins to the first. Returns -1 when there are no frames (caller renders the
 * snapshot fallback instead).
 */
export function clampFrameIndex(frameCount: number, scrubTick: number): number {
  if (frameCount <= 0) return -1
  if (scrubTick < 0) return 0
  return Math.min(scrubTick, frameCount - 1)
}

/**
 * The next playback position, one tick on, capped at the final tick — drives the
 * replay's play/pause auto-advance. Stays at `max` once reached (the caller stops
 * the timer there).
 */
export function nextScrubTick(current: number, max: number): number {
  if (max <= 0) return 0
  return Math.min(current + 1, max)
}

/** The minimal frame shape keyMoments needs (team kill/tower tallies per tick). */
export interface ReplayFrameLite {
  tick: number
  teams: {
    radiant: { kills: number; towerKills: number }
    dire: { kills: number; towerKills: number }
  }
}

/** A notable tick in a replay, for the jump-to-the-action markers. */
export interface KeyMoment {
  tick: number
  kind: 'fight' | 'tower'
  label: string
}

/**
 * Notable ticks in a replay, derived from frame-to-frame score deltas, so a
 * learner can jump straight to the action instead of scrubbing blindly. A tower
 * falling is its own marker; runs of consecutive kill ticks (within
 * `coalesceGap` ticks of each other) fold into ONE "fight" marker anchored at
 * the first kill and tallying the kills — so a teamfight reads as a single chip,
 * not five. Pure over the frame stream; returned in chronological order.
 */
export function keyMoments(frames: ReplayFrameLite[], coalesceGap = 3): KeyMoment[] {
  const moments: KeyMoment[] = []
  const totalKills = (f: ReplayFrameLite) => f.teams.radiant.kills + f.teams.dire.kills
  const totalTowers = (f: ReplayFrameLite) => f.teams.radiant.towerKills + f.teams.dire.towerKills

  let fight: { tick: number; kills: number; lastTick: number } | null = null
  const flush = () => {
    if (!fight) return
    moments.push({
      tick: fight.tick,
      kind: 'fight',
      label: fight.kills > 1 ? `Fight ×${fight.kills}` : 'Kill',
    })
    fight = null
  }

  for (let i = 1; i < frames.length; i++) {
    const prev = frames[i - 1]!
    const cur = frames[i]!
    const killDelta = totalKills(cur) - totalKills(prev)
    const towerDelta = totalTowers(cur) - totalTowers(prev)

    // A long lull since the last kill closes the current fight.
    if (fight && cur.tick - fight.lastTick > coalesceGap) flush()

    if (killDelta > 0) {
      if (fight) {
        fight.kills += killDelta
        fight.lastTick = cur.tick
      } else {
        fight = { tick: cur.tick, kills: killDelta, lastTick: cur.tick }
      }
    }
    if (towerDelta > 0) moments.push({ tick: cur.tick, kind: 'tower', label: 'Tower' })
  }
  flush()
  return moments.sort((a, b) => a.tick - b.tick)
}
