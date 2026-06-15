<script setup lang="ts">
import { useGameStore } from '~/stores/game'
import {
  makeTickMessage,
  makeRoster,
  makePlayer,
  makePlayerEndStats,
  SAMPLE_HEROES,
  SAMPLE_EVENTS,
  SAMPLE_INVENTORY,
} from '~/stories/fixtures'
import GameScreen from './GameScreen.vue'

// STORE-COUPLED + socket-aware. GameScreen calls BOTH useGameStore() and
// useGameSocket(). On mount the socket only connects when *both* gameStore.gameId
// AND gameStore.playerId are set (see onMounted). We seed `playerId` (so the
// store resolves `player` / `canAct` / vision) but deliberately LEAVE `gameId`
// unset, so connect() is never called and no live WebSocket / ws-ticket fetch is
// attempted in the Histoire iframe — the component still renders the full active
// game from the seeded tick state. (Seeding gameId would schedule a harmless but
// noisy reconnect loop against a non-existent server.)
//
// State is seeded the canonical way: store.updateFromTick(makeTickMessage(...)),
// which populates players, zones, teams, towers, ancients, roshan, scoreboard,
// net-worth history and the live tick countdown. We add a few combat events so
// the Tick Theater / combat log has content.

function seedActive() {
  const store = useGameStore()
  store.reset()
  store.playerId = 'p1'
  store.updateFromTick(makeTickMessage({ tick: 240 }))
  store.addEvents(SAMPLE_EVENTS)
}

// Same as above, but the local player is dead — exercises the PROCESS TERMINATED
// death overlay + buyback panel.
function seedDead() {
  const store = useGameStore()
  store.reset()
  store.playerId = 'p1'
  const players = makeRoster()
  players.p1 = makePlayer({
    id: 'p1',
    name: 'you',
    heroId: SAMPLE_HEROES.echo,
    zone: 'radiant-base',
    alive: false,
    hp: 0,
    respawnTick: 252,
    gold: 1200,
    buybackCost: 900,
  })
  store.updateFromTick(makeTickMessage({ tick: 240, players }))
  store.addEvents([
    ...SAMPLE_EVENTS,
    { tick: 240, type: 'kill', payload: { killerId: 'e1', victimId: 'p1', zone: 'radiant-base' } },
  ])
}

// Game over — drives the PostGame branch (isGameOver && winner && gameOverStats).
function seedGameOver() {
  const store = useGameStore()
  store.reset()
  store.playerId = 'p1'
  store.updateFromTick(makeTickMessage({ tick: 300 }))
  const stats: Record<string, ReturnType<typeof makePlayerEndStats>> = {}
  for (const p of Object.values(makeRoster())) {
    stats[p.id] = makePlayerEndStats({
      kills: p.kills,
      deaths: p.deaths,
      assists: p.assists,
      gold: p.gold,
      items: p.items.some(Boolean) ? p.items : SAMPLE_INVENTORY,
    })
  }
  store.setGameOver('radiant', stats)
}
</script>

<template>
  <Story title="Game/GameScreen">
    <!-- Full active-game layout: War Room (left), Tick Theater / combat log
         (center), hero+zone+map rail (right), command bar (bottom). -->
    <Variant title="active game" :setup-app="seedActive">
      <GameScreen />
    </Variant>

    <!-- Local player dead: PROCESS TERMINATED overlay + buyback panel. -->
    <Variant title="player dead (buyback)" :setup-app="seedDead">
      <GameScreen />
    </Variant>

    <!-- Match concluded: renders the PostGame scoreboard branch. -->
    <Variant title="game over" :setup-app="seedGameOver">
      <GameScreen />
    </Variant>
  </Story>
</template>
