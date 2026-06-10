/**
 * Headless bot-vs-bot match simulator for balance validation.
 *
 *   bun scripts/simulate-game.ts [matches=1] [maxTicks=1500]
 *
 * Runs full 5v5 bot games through the real engine (processTick) and prints
 * pacing stats: match length, kills, gold curves, tower kills, winner.
 */
import { Effect } from 'effect'
import { processTick } from '../server/game/engine/GameLoop'
import { createInMemoryStateManager } from '../server/game/engine/StateManager'
import { registerBots, cleanupGame } from '../server/game/ai/BotManager'
import { resetCreepIdCounter } from '../server/game/map/spawner'
import { playerNetWorth } from '../server/game/engine/GoldDistributor'
import { HERO_IDS } from '../shared/constants/heroes'
import type { GameState, TeamId } from '../shared/types/game'

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
    netWorth: players.reduce((sum, p) => sum + playerNetWorth(p), 0),
    avgLevel: players.reduce((sum, p) => sum + p.level, 0) / players.length,
    towersAlive: state.towers.filter((t) => t.team === team && t.alive).length,
  }
}

function fmtMin(tick: number): string {
  return `${Math.round((tick * 4) / 60)}m`
}

async function simulateOne(matchIdx: number): Promise<void> {
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
  registerBots(gameId, players)

  console.log(`\n=== Match ${matchIdx + 1}: ${radiantHeroes.join(',')} vs ${direHeroes.join(',')}`)

  const checkpoints: number[] = [75, 150, 300, 450, 600, 900, 1200] // 5,10,20,30,40,60,80 min
  let totalKills = 0

  while (state.tick < maxTicks && state.phase !== 'ended') {
    const result = Effect.runSync(processTick(gameId, state))
    state = result.state
    totalKills = state.teams.radiant.kills + state.teams.dire.kills

    if (checkpoints.includes(state.tick)) {
      const rad = teamStats(state, 'radiant')
      const dire = teamStats(state, 'dire')
      console.log(
        `  [${fmtMin(state.tick)}] kills ${rad.kills}:${dire.kills} | ` +
          `networth ${rad.netWorth}:${dire.netWorth} | ` +
          `lvl ${rad.avgLevel.toFixed(1)}:${dire.avgLevel.toFixed(1)} | ` +
          `towers ${rad.towersAlive}:${dire.towersAlive}`,
      )
    }
  }

  const rad = teamStats(state, 'radiant')
  const dire = teamStats(state, 'dire')
  const winner =
    state.winner ?? (rad.towersAlive === 0 ? 'dire' : dire.towersAlive === 0 ? 'radiant' : null)

  console.log(
    winner
      ? `  RESULT: ${winner} wins at ${fmtMin(state.tick)} (tick ${state.tick})`
      : `  RESULT: NO WINNER after ${fmtMin(state.tick)} — game stalled`,
  )
  console.log(
    `  final: kills ${rad.kills}:${dire.kills} (${totalKills} total) | ` +
      `networth ${rad.netWorth}:${dire.netWorth} | towers ${rad.towersAlive}:${dire.towersAlive}`,
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
}

for (let i = 0; i < matches; i++) {
  await simulateOne(i)
}
