<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useGameStore } from '~/stores/game'
import { useGameSocket } from '~/composables/useGameSocket'
import { useCommands } from '~/composables/useCommands'
import { ZONES } from '~~/shared/constants/zones'
import type { TowerState } from '~~/shared/types/game'

const gameStore = useGameStore()
const gameSocket = useGameSocket()
const commands = useCommands()

// Local combat log for parsed errors + game events
const localEvents = ref<
  Array<{
    tick: number
    text: string
    type: 'damage' | 'healing' | 'kill' | 'gold' | 'system' | 'ability'
  }>
>([])

onMounted(() => {
  if (gameStore.gameId && gameStore.playerId) {
    gameSocket.connect(gameStore.gameId, gameStore.playerId)
  }
})

onUnmounted(() => {
  gameSocket.disconnect()
})

// ── Derived state ──────────────────────────────────────────────

const currentTick = computed(() => gameStore.tick)

const gameTime = computed(() => {
  const totalSeconds = gameStore.tick * 4
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
})

const playerGold = computed(() => gameStore.player?.gold ?? 0)
const playerKills = computed(() => gameStore.player?.kills ?? 0)
const playerDeaths = computed(() => gameStore.player?.deaths ?? 0)
const playerAssists = computed(() => gameStore.player?.assists ?? 0)

const heroData = computed(() => {
  const p = gameStore.player
  if (!p) return null
  return {
    name: p.heroId ?? p.name,
    level: p.level,
    zone: p.zone,
    hp: p.hp,
    maxHp: p.maxHp,
    mp: p.mp,
    maxMp: p.maxMp,
    cooldowns: p.cooldowns,
    items: p.items,
    buffs: p.buffs,
    gold: p.gold,
    alive: p.alive,
  }
})

// Map game events to CombatLog format
const combatEvents = computed(() => {
  const mapped = gameStore.events.map((e) => {
    let text = ''
    let type: 'damage' | 'healing' | 'kill' | 'gold' | 'system' | 'ability' = 'system'

    switch (e.type) {
      case 'damage':
        text = `${e.payload.sourceId} dealt ${e.payload.amount} ${e.payload.damageType ?? ''} damage to ${e.payload.targetId}`
        type = 'damage'
        break
      case 'heal':
        text = `${e.payload.sourceId} healed ${e.payload.targetId} for ${e.payload.amount}`
        type = 'healing'
        break
      case 'kill':
        text = `KILL: ${e.payload.killerId} eliminated ${e.payload.victimId}!`
        type = 'kill'
        break
      case 'death':
        text = `${e.payload.playerId} died (respawn at tick ${e.payload.respawnTick})`
        type = 'damage'
        break
      case 'gold_change':
        text = `${e.payload.playerId} ${(e.payload.amount as number) >= 0 ? 'earned' : 'lost'} ${Math.abs(e.payload.amount as number)}g (${e.payload.reason})`
        type = 'gold'
        break
      case 'level_up':
        text = `${e.payload.playerId} reached level ${e.payload.newLevel}!`
        type = 'system'
        break
      case 'ability_used':
        text = `${e.payload.playerId} used ${e.payload.abilityId}${e.payload.targetId ? ` on ${e.payload.targetId}` : ''}`
        type = 'ability'
        break
      case 'tower_kill':
        text = `${e.payload.killerTeam} destroyed ${e.payload.team} tower in ${e.payload.zone}!`
        type = 'kill'
        break
      case 'creep_lasthit':
        text = `${e.payload.playerId} last-hit ${e.payload.creepType} creep (+${e.payload.goldAwarded}g)`
        type = 'gold'
        break
      case 'item_purchased':
        text = `${e.payload.playerId} purchased ${e.payload.itemId} (-${e.payload.cost}g)`
        type = 'gold'
        break
      default:
        text = `${e.type}: ${JSON.stringify(e.payload)}`
        type = 'system'
    }

    return { tick: e.tick, text, type }
  })

  return [...mapped, ...localEvents.value].sort((a, b) => a.tick - b.tick)
})

// Build tower lookup: zoneId → TowerState (from the tick_state)
// The game store doesn't directly store towers, but they come via the tick state.
// We'll track them via onMessage.
const towers = ref<TowerState[]>([])

gameSocket.onMessage((msg) => {
  if (msg.type === 'tick_state') {
    const state = msg.state as Record<string, unknown>
    if (state.towers) {
      towers.value = state.towers
    }
  }
})

const towersByZone = computed(() => {
  const map = new Map<string, TowerState>()
  for (const t of towers.value) {
    map.set(t.zone, t)
  }
  return map
})

// Map zones for AsciiMap
const mapZones = computed(() => {
  const playerZoneId = gameStore.player?.zone ?? ''
  const playerTeam = gameStore.player?.team ?? 'radiant'
  const visibleZoneIds = new Set(Object.keys(gameStore.visibleZones))

  return ZONES.map((zone) => {
    const fogged = !visibleZoneIds.has(zone.id)

    // Count allies and enemies in this zone
    const allies: string[] = []
    let enemyCount = 0

    if (!fogged) {
      for (const p of Object.values(gameStore.allPlayers)) {
        if (p.zone !== zone.id || !p.alive) continue
        if (p.id === gameStore.playerId) continue
        if (p.team === playerTeam) {
          allies.push(p.heroId ?? p.name)
        } else {
          enemyCount++
        }
      }
    }

    // Tower info
    const tower = towersByZone.value.get(zone.id)
    const towerDisplay = tower
      ? { team: tower.team, alive: tower.alive, tier: getTowerTier(zone.id) }
      : undefined

    return {
      id: zone.id,
      name: zone.name,
      playerHere: zone.id === playerZoneId,
      allies,
      enemyCount,
      tower: towerDisplay,
      fogged,
    }
  })
})

const playerZone = computed(() => gameStore.player?.zone ?? '')

function getTowerTier(zoneId: string): number {
  if (zoneId.includes('t1')) return 1
  if (zoneId.includes('t2')) return 2
  if (zoneId.includes('t3')) return 3
  return 1
}

// ── Command handling ───────────────────────────────────────────

function handleCommand(cmd: string) {
  const parsed = commands.parse(cmd)
  if (parsed) {
    gameSocket.send({ type: 'action', command: parsed })
  } else {
    localEvents.value.push({
      tick: gameStore.tick,
      text: `Unknown command: ${cmd}`,
      type: 'system',
    })
  }
}

// ── Game over ──────────────────────────────────────────────────

const isGameOver = computed(() => gameStore.phase === 'ended')

const postGamePlayers = computed(() => {
  return Object.values(gameStore.allPlayers).map((p) => ({
    id: p.id,
    name: p.name,
    heroId: p.heroId ?? '',
    team: p.team,
  }))
})

function handlePlayAgain() {
  gameStore.reset()
  navigateTo('/lobby')
}

function handleReturnToMenu() {
  gameStore.reset()
  navigateTo('/')
}
</script>

<template>
  <!-- Game Over Screen -->
  <PostGame
    v-if="isGameOver && gameStore.winner && gameStore.gameOverStats"
    :winner="gameStore.winner"
    :stats="gameStore.gameOverStats"
    :players="postGamePlayers"
    :current-player-id="gameStore.playerId ?? ''"
    @play-again="handlePlayAgain"
    @return-to-menu="handleReturnToMenu"
  />

  <!-- Active Game Screen -->
  <div v-else class="game-grid relative bg-bg-primary">
    <div
v-if="!gameStore.isAlive && gameStore.player"
         class="absolute inset-0 z-20 flex items-center justify-center bg-black/70">
      <div class="text-center">
        <p class="text-2xl font-bold text-dire">PROCESS TERMINATED</p>
        <p v-if="gameStore.player.respawnTick" class="mt-2 text-text-dim">
          Respawning in {{ gameStore.player.respawnTick - gameStore.tick }} ticks
        </p>
      </div>
    </div>
    <GameStateBar
      class="game-grid__bar"
      :tick="currentTick"
      :game-time="gameTime"
      :gold="playerGold"
      :kills="playerKills"
      :deaths="playerDeaths"
      :assists="playerAssists"
    />

    <TerminalPanel title="Map" class="game-grid__map min-h-0">
      <AsciiMap :zones="mapZones" :player-zone="playerZone" />
    </TerminalPanel>

    <TerminalPanel title="Combat Log" class="game-grid__log min-h-0">
      <CombatLog :events="combatEvents" />
    </TerminalPanel>

    <TerminalPanel title="Hero Status" class="game-grid__hero min-h-0">
      <HeroStatus v-if="heroData" :hero="heroData" />
      <div v-else class="p-2 text-[0.8rem] text-text-dim">&gt;_ awaiting hero data...</div>
    </TerminalPanel>

    <div class="game-grid__cmd flex min-h-0 flex-col justify-end">
      <div class="hidden gap-1 px-2 py-1 overflow-x-auto lg:hidden max-lg:flex">
        <button
          v-for="cmd in ['ATK', 'Q', 'W', 'E', 'R', 'MOVE']"
          :key="cmd"
          class="whitespace-nowrap border border-border bg-bg-secondary px-2 py-1 font-mono text-[0.7rem] text-text-primary active:bg-border"
          @click="
            handleCommand(
              cmd === 'ATK'
                ? 'attack'
                : cmd.length === 1
                  ? `cast ${cmd.toLowerCase()}`
                  : cmd.toLowerCase(),
            )
          "
        >
          {{ cmd }}
        </button>
      </div>
      <CommandInput
        placeholder="Enter command (Tab for autocomplete)..."
        :tick-countdown="gameStore.nextTickIn"
        @submit="handleCommand"
      />
    </div>
  </div>
</template>

<style scoped>
.game-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: auto 1fr 1fr auto;
  gap: 2px;
  height: 100vh;
}

.game-grid__bar {
  grid-column: 1 / -1;
}
.game-grid__map {
  grid-row: 2;
  grid-column: 1;
}
.game-grid__log {
  grid-row: 2;
  grid-column: 2;
}
.game-grid__hero {
  grid-row: 3;
  grid-column: 1;
}
.game-grid__cmd {
  grid-row: 3 / 5;
  grid-column: 2;
}

@media (max-width: 1024px) {
  .game-grid {
    grid-template-columns: 1fr 1fr;
    grid-template-rows: auto 1fr 1fr 1fr auto;
  }
  .game-grid__map {
    grid-column: 1 / -1;
    grid-row: 2;
  }
  .game-grid__log {
    grid-column: 1 / -1;
    grid-row: 3;
  }
  .game-grid__hero {
    grid-column: 1 / -1;
    grid-row: 4;
  }
  .game-grid__cmd {
    grid-column: 1 / -1;
    grid-row: 5;
  }
}

@media (max-width: 640px) {
  .game-grid {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr 1fr 1fr auto;
  }
  .game-grid__map {
    grid-column: 1;
    grid-row: 2;
  }
  .game-grid__log {
    grid-column: 1;
    grid-row: 3;
  }
  .game-grid__hero {
    grid-column: 1;
    grid-row: 4;
  }
  .game-grid__cmd {
    grid-column: 1;
    grid-row: 5;
  }
}
</style>
