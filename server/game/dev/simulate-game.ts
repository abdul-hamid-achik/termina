/**
 * Headless bot-vs-bot match simulator for balance validation.
 *
 *   bun server/game/dev/simulate-game.ts [matches=1] [maxCycles=1500]
 *
 * Runs full 5v5 bot games through the real engine (processCycle) and prints
 * per-match pacing stats (length, kills, scrip, ice, winner); with matches>1
 * it also prints a BALANCE SUMMARY (side win-rate, length spread, per-hero
 * win-rate) aggregated by ./simStats. A standalone manual tool — run directly,
 * never imported, so its top-level loop only executes when you invoke it.
 */
/* eslint-disable no-console -- this is a standalone CLI tool; console IS its UI */
import { Effect } from 'effect'
import { processCycle } from '../engine/GameLoop'
import { createInMemoryStateManager } from '../engine/StateManager'
import { registerBots, cleanupGame } from '../ai/BotManager'
import { resetWaveIdCounter } from '../map/spawner'
import { playerNetWorth } from '../engine/ScripDistributor'
import { summarizeSimResults, type SimResult } from './simStats'
import { HERO_IDS } from '../../../shared/constants/heroes'
import type { GameState, TeamId } from '../../../shared/types/game'

const matches = Number(process.argv[2] ?? 1)
const maxCycles = Number(process.argv[3] ?? 1500)

function pickHeroes(count: number, exclude: Set<string>): string[] {
  const available = HERO_IDS.filter((h) => !exclude.has(h))
  const picked: string[] = []
  while (picked.length < count && available.length > 0) {
    const idx = Math.floor(Math.random() * available.length)
    picked.push(available.splice(idx, 1)[0]!)
  }
  return picked
}

function teamStats(state: GameState, team: TeamId) {
  const players = Object.values(state.players).filter((p) => p.team === team)
  return {
    kills: state.teams[team].kills,
    deaths: players.reduce((sum, p) => sum + p.deaths, 0),
    netWorth: players.reduce((sum, p) => sum + playerNetWorth(p), 0),
    avgLevel: players.reduce((sum, p) => sum + p.level, 0) / players.length,
    iceAlive: state.ice.filter((t) => t.team === team && t.alive).length,
    waves: state.waves.filter((c) => c.team === team).length,
    terminalHp: state.terminals?.[team]?.integ ?? -1,
    terminalAlive: state.terminals?.[team]?.alive ?? true,
  }
}

function fmtMin(cycle: number): string {
  return `${Math.round((cycle * 4) / 60)}m`
}

async function simulateOne(matchIdx: number): Promise<SimResult> {
  resetWaveIdCounter()
  const gameId = `sim_${matchIdx}_${Math.random().toString(36).slice(2, 8)}`
  const stateManager = createInMemoryStateManager()

  const chaffHeroes = pickHeroes(5, new Set())
  const auditHeroes = pickHeroes(5, new Set(chaffHeroes))

  const players = [
    ...chaffHeroes.map((heroId, i) => ({
      playerId: `bot_r${i}`,
      team: 'chaff' as TeamId,
      heroId,
    })),
    ...auditHeroes.map((heroId, i) => ({ playerId: `bot_d${i}`, team: 'audit' as TeamId, heroId })),
  ]

  let state = Effect.runSync(
    stateManager.createGame(
      gameId,
      players.map((p) => ({ id: p.playerId, name: p.playerId, team: p.team, heroId: p.heroId })),
    ),
  )
  state = { ...state, phase: 'playing' }
  // SIM_IDLE_CHAFF=1 leaves the first chaff slot as an idle (non-bot)
  // player who never submits actions — mirrors the e2e composition of one
  // AFK human + nine bots.
  const idleChaff = process.env.SIM_IDLE_CHAFF === '1'
  registerBots(gameId, idleChaff ? players.filter((p) => p.playerId !== 'bot_r0') : players)

  console.log(`\n=== Match ${matchIdx + 1}: ${chaffHeroes.join(',')} vs ${auditHeroes.join(',')}`)

  const checkpoints: number[] = [75, 150, 300, 450, 600, 900, 1200] // 5,10,20,30,40,60,80 min
  let totalKills = 0
  // Tenant contest metrics — the objective's whole point is dropping the
  // BACKUP; if no bot match ever kills him the numbers need a balance pass.
  let tenantKills = 0
  let tenantRespawns = 0
  let backupPickups = 0

  while (state.cycle < maxCycles && state.phase !== 'ended') {
    const result = Effect.runSync(processCycle(gameId, state))
    state = result.state
    totalKills = state.teams.chaff.kills + state.teams.audit.kills

    for (const e of result.events) {
      if (e._tag === 'tenant_killed') tenantKills++
      else if (e._tag === 'tenant_respawn') tenantRespawns++
      else if (e._tag === 'backup_picked') backupPickups++
    }

    if (process.env.SIM_DUMP_ZONES === '1' && state.cycle % 50 === 0) {
      console.log(
        `      t${state.cycle} actions: ${result.actions
          .map((a) => `${a.playerId}:${JSON.stringify(a.command)}`)
          .join(' | ')}`,
      )
      if (result.rejectedActions.length > 0) {
        console.log(
          `      t${state.cycle} rejected: ${result.rejectedActions
            .map((r) => `${r.playerId}:${r.reason}`)
            .join(' | ')}`,
        )
      }
    }

    if (checkpoints.includes(state.cycle)) {
      const chaff = teamStats(state, 'chaff')
      const audit = teamStats(state, 'audit')
      console.log(
        `  [${fmtMin(state.cycle)}] kills ${chaff.kills}:${audit.kills} | ` +
          `networth ${chaff.netWorth}:${audit.netWorth} | ` +
          `lvl ${chaff.avgLevel.toFixed(1)}:${audit.avgLevel.toFixed(1)} | ` +
          `ice ${chaff.iceAlive}:${audit.iceAlive} | ` +
          `waves ${chaff.waves}:${audit.waves} | ` +
          `terminal ${chaff.terminalHp}:${audit.terminalHp}` +
          (state.tenant.alive ? ` | tenant ${state.tenant.integ}/${state.tenant.maxInteg}` : ''),
      )
      if (process.env.SIM_DUMP_ZONES === '1') {
        for (const p of Object.values(state.players)) {
          console.log(
            `      ${p.id} (${p.team}) zone=${p.zone} integ =${p.integ}/${p.maxInteg} bw =${p.bw}/${p.maxBw} ` +
              `scrip=${p.scrip} alive=${p.alive} buffs=[${p.buffs.map((b) => b.id).join(',')}]`,
          )
        }
        const waveZones = new Map<string, number>()
        for (const c of state.waves) {
          waveZones.set(`${c.team}:${c.zone}`, (waveZones.get(`${c.team}:${c.zone}`) ?? 0) + 1)
        }
        console.log(
          `      waves: ${[...waveZones.entries()].map(([k, v]) => `${k}=${v}`).join(' ')}`,
        )
      }
    }
  }

  const chaff = teamStats(state, 'chaff')
  const audit = teamStats(state, 'audit')
  const winner =
    state.winner ?? (!chaff.terminalAlive ? 'audit' : !audit.terminalAlive ? 'chaff' : null)

  console.log(
    winner
      ? `  RESULT: ${winner} wins at ${fmtMin(state.cycle)} (cycle ${state.cycle}) — terminal destroyed: ${!chaff.terminalAlive ? 'chaff' : !audit.terminalAlive ? 'audit' : 'none (surrender?)'}`
      : `  RESULT: NO WINNER after ${fmtMin(state.cycle)} — game stalled`,
  )
  console.log(
    `  final: kills ${chaff.kills}:${audit.kills} (${totalKills} total) | ` +
      `deaths ${chaff.deaths + audit.deaths} total | ` +
      `networth ${chaff.netWorth}:${audit.netWorth} | ice ${chaff.iceAlive}:${audit.iceAlive} | ` +
      `waves ${chaff.waves}:${audit.waves} | terminal ${chaff.terminalHp}:${audit.terminalHp}`,
  )
  console.log(
    `  tenant: ${tenantKills} kill(s) · ${tenantRespawns} respawn(s) · ${backupPickups} backup pickup(s)`,
  )

  // K/D/A spread per player
  for (const p of Object.values(state.players)) {
    const items = p.items.filter(Boolean).join(',') || '-'
    console.log(
      `    ${p.team === 'chaff' ? 'C' : 'A'} ${p.heroId?.padEnd(10)} lvl ${String(p.level).padStart(2)} ` +
        `${p.kills}/${p.deaths}/${p.assists} nw ${playerNetWorth(p)} [${items}]`,
    )
  }

  cleanupGame(gameId)
  Effect.runSync(stateManager.deleteGame(gameId))

  return { winner, ticks: state.cycle, chaffHeroes, auditHeroes }
}

const results: SimResult[] = []
for (let i = 0; i < matches; i++) {
  results.push(await simulateOne(i))
}

// Aggregate across the batch — the actual balance signal (a single game is noise).
if (matches > 1) {
  const s = summarizeSimResults(results)
  console.log(`\n══ BALANCE SUMMARY (${s.matches} matches) ══`)
  console.log(
    `  side win-rate: chaff ${s.winRate.chaff.toFixed(0)}% / audit ${s.winRate.audit.toFixed(0)}%` +
      `  (R ${s.wins.chaff} · D ${s.wins.audit} · stalled ${s.wins.none})` +
      `  ${s.sideBiasSignificant ? '← SIGNIFICANT (likely real)' : '(within normal variance — run more)'}`,
  )
  console.log(
    `  length: ${fmtMin(s.length.minTicks)}–${fmtMin(s.length.maxCycles)} ` +
      `(median ${fmtMin(s.length.medianTicks)}, avg ${fmtMin(s.length.avgTicks)})`,
  )
  const top = s.heroWinRates.slice(0, 5)
  const bottom = s.heroWinRates.slice(-5).reverse()
  // A trailing * marks a win-rate that's beyond small-sample noise (2σ) — i.e. a
  // hero actually worth tuning, vs one that just had a lucky/unlucky few games.
  const fmtHero = (h: (typeof s.heroWinRates)[number]) =>
    `${h.heroId} ${h.winRate.toFixed(0)}% (${h.wins}/${h.appearances})${h.significant ? '*' : ''}`
  console.log(`  best heroes:  ${top.map(fmtHero).join(' · ')}`)
  console.log(`  worst heroes: ${bottom.map(fmtHero).join(' · ')}`)
  console.log(`  (* = beyond small-sample noise; run more matches if nothing is starred)`)
}
