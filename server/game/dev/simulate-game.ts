/**
 * Headless bot-vs-bot match simulator for balance validation.
 *
 *   bun server/game/dev/simulate-game.ts [matches=1] [maxTicks=1500]
 *
 * Runs full 5v5 bot games through the real engine (processTick) and prints
 * per-match pacing stats (length, kills, gold, towers, winner); with matches>1
 * it also prints a BALANCE SUMMARY (side win-rate, length spread, per-hero
 * win-rate) aggregated by ./simStats. A standalone manual tool — run directly,
 * never imported, so its top-level loop only executes when you invoke it.
 */
/* eslint-disable no-console -- this is a standalone CLI tool; console IS its UI */
import { Effect } from 'effect'
import { processTick } from '../engine/GameLoop'
import { createInMemoryStateManager } from '../engine/StateManager'
import { registerBots, cleanupGame } from '../ai/BotManager'
import { resetCreepIdCounter } from '../map/spawner'
import { playerNetWorth } from '../engine/GoldDistributor'
import { summarizeSimResults, type SimResult } from './simStats'
import { HERO_IDS } from '../../../shared/constants/heroes'
import type { GameState, TeamId } from '../../../shared/types/game'

const matches = Number(process.argv[2] ?? 1)
const maxTicks = Number(process.argv[3] ?? 1500)

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
    towersAlive: state.towers.filter((t) => t.team === team && t.alive).length,
    creeps: state.creeps.filter((c) => c.team === team).length,
    ancientHp: state.ancients?.[team]?.hp ?? -1,
    ancientAlive: state.ancients?.[team]?.alive ?? true,
  }
}

function fmtMin(tick: number): string {
  return `${Math.round((tick * 4) / 60)}m`
}

async function simulateOne(matchIdx: number): Promise<SimResult> {
  resetCreepIdCounter()
  const gameId = `sim_${matchIdx}_${Math.random().toString(36).slice(2, 8)}`
  const stateManager = createInMemoryStateManager()

  const radiantHeroes = pickHeroes(5, new Set())
  const direHeroes = pickHeroes(5, new Set(radiantHeroes))

  const players = [
    ...radiantHeroes.map((heroId, i) => ({
      playerId: `bot_r${i}`,
      team: 'radiant' as TeamId,
      heroId,
    })),
    ...direHeroes.map((heroId, i) => ({ playerId: `bot_d${i}`, team: 'dire' as TeamId, heroId })),
  ]

  let state = Effect.runSync(
    stateManager.createGame(
      gameId,
      players.map((p) => ({ id: p.playerId, name: p.playerId, team: p.team, heroId: p.heroId })),
    ),
  )
  state = { ...state, phase: 'playing' }
  // SIM_IDLE_RADIANT=1 leaves the first radiant slot as an idle (non-bot)
  // player who never submits actions — mirrors the e2e composition of one
  // AFK human + nine bots.
  const idleRadiant = process.env.SIM_IDLE_RADIANT === '1'
  registerBots(gameId, idleRadiant ? players.filter((p) => p.playerId !== 'bot_r0') : players)

  console.log(`\n=== Match ${matchIdx + 1}: ${radiantHeroes.join(',')} vs ${direHeroes.join(',')}`)

  const checkpoints: number[] = [75, 150, 300, 450, 600, 900, 1200] // 5,10,20,30,40,60,80 min
  let totalKills = 0

  while (state.tick < maxTicks && state.phase !== 'ended') {
    const result = Effect.runSync(processTick(gameId, state))
    state = result.state
    totalKills = state.teams.radiant.kills + state.teams.dire.kills

    if (process.env.SIM_DUMP_ZONES === '1' && state.tick % 50 === 0) {
      console.log(
        `      t${state.tick} actions: ${result.actions
          .map((a) => `${a.playerId}:${JSON.stringify(a.command)}`)
          .join(' | ')}`,
      )
      if (result.rejectedActions.length > 0) {
        console.log(
          `      t${state.tick} rejected: ${result.rejectedActions
            .map((r) => `${r.playerId}:${r.reason}`)
            .join(' | ')}`,
        )
      }
    }

    if (checkpoints.includes(state.tick)) {
      const rad = teamStats(state, 'radiant')
      const dire = teamStats(state, 'dire')
      console.log(
        `  [${fmtMin(state.tick)}] kills ${rad.kills}:${dire.kills} | ` +
          `networth ${rad.netWorth}:${dire.netWorth} | ` +
          `lvl ${rad.avgLevel.toFixed(1)}:${dire.avgLevel.toFixed(1)} | ` +
          `towers ${rad.towersAlive}:${dire.towersAlive} | ` +
          `creeps ${rad.creeps}:${dire.creeps} | ` +
          `ancient ${rad.ancientHp}:${dire.ancientHp}`,
      )
      if (process.env.SIM_DUMP_ZONES === '1') {
        for (const p of Object.values(state.players)) {
          console.log(
            `      ${p.id} (${p.team}) zone=${p.zone} hp=${p.hp}/${p.maxHp} mp=${p.mp}/${p.maxMp} ` +
              `gold=${p.gold} alive=${p.alive} buffs=[${p.buffs.map((b) => b.id).join(',')}]`,
          )
        }
        const creepZones = new Map<string, number>()
        for (const c of state.creeps) {
          creepZones.set(`${c.team}:${c.zone}`, (creepZones.get(`${c.team}:${c.zone}`) ?? 0) + 1)
        }
        console.log(
          `      creeps: ${[...creepZones.entries()].map(([k, v]) => `${k}=${v}`).join(' ')}`,
        )
      }
    }
  }

  const rad = teamStats(state, 'radiant')
  const dire = teamStats(state, 'dire')
  const winner =
    state.winner ?? (!rad.ancientAlive ? 'dire' : !dire.ancientAlive ? 'radiant' : null)

  console.log(
    winner
      ? `  RESULT: ${winner} wins at ${fmtMin(state.tick)} (tick ${state.tick}) — ancient destroyed: ${!rad.ancientAlive ? 'radiant' : !dire.ancientAlive ? 'dire' : 'none (surrender?)'}`
      : `  RESULT: NO WINNER after ${fmtMin(state.tick)} — game stalled`,
  )
  console.log(
    `  final: kills ${rad.kills}:${dire.kills} (${totalKills} total) | ` +
      `deaths ${rad.deaths + dire.deaths} total | ` +
      `networth ${rad.netWorth}:${dire.netWorth} | towers ${rad.towersAlive}:${dire.towersAlive} | ` +
      `creeps ${rad.creeps}:${dire.creeps} | ancient ${rad.ancientHp}:${dire.ancientHp}`,
  )

  // K/D/A spread per player
  for (const p of Object.values(state.players)) {
    const items = p.items.filter(Boolean).join(',') || '-'
    console.log(
      `    ${p.team === 'radiant' ? 'R' : 'D'} ${p.heroId?.padEnd(10)} lvl ${String(p.level).padStart(2)} ` +
        `${p.kills}/${p.deaths}/${p.assists} nw ${playerNetWorth(p)} [${items}]`,
    )
  }

  cleanupGame(gameId)
  Effect.runSync(stateManager.deleteGame(gameId))

  return { winner, ticks: state.tick, radiantHeroes, direHeroes }
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
    `  side win-rate: radiant ${s.winRate.radiant.toFixed(0)}% / dire ${s.winRate.dire.toFixed(0)}%` +
      `  (R ${s.wins.radiant} · D ${s.wins.dire} · stalled ${s.wins.none})`,
  )
  console.log(
    `  length: ${fmtMin(s.length.minTicks)}–${fmtMin(s.length.maxTicks)} ` +
      `(median ${fmtMin(s.length.medianTicks)}, avg ${fmtMin(s.length.avgTicks)})`,
  )
  const top = s.heroWinRates.slice(0, 5)
  const bottom = s.heroWinRates.slice(-5).reverse()
  const fmtHero = (h: (typeof s.heroWinRates)[number]) =>
    `${h.heroId} ${h.winRate.toFixed(0)}% (${h.wins}/${h.appearances})`
  console.log(`  best heroes:  ${top.map(fmtHero).join(' · ')}`)
  console.log(`  worst heroes: ${bottom.map(fmtHero).join(' · ')}`)
}
