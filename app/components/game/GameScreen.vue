<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useGameStore } from '~/stores/game'
import { useGameSocket } from '~/composables/useGameSocket'
import { useCommands } from '~/composables/useCommands'
import { useAudio } from '~/composables/useAudio'
import { ZONES, ZONE_MAP } from '~~/shared/constants/zones'
import { ITEMS } from '~~/server/game/items/registry'
import type { TowerState } from '~~/shared/types/game'
import { uiLog } from '~/utils/logger'

const gameStore = useGameStore()
const gameSocket = useGameSocket()
const commands = useCommands()
const { playSound } = useAudio()
const { connected, reconnecting, latency } = gameSocket

// Local combat log for parsed errors + game events
const localEvents = ref<
  Array<{
    tick: number
    text: string
    type: 'damage' | 'healing' | 'kill' | 'gold' | 'system' | 'ability'
  }>
>([])

// ── Shop & Scoreboard state ──────────────────────────────────
const showShop = ref(false)
const showScoreboard = ref(false)

// Quick buy pinned items (persisted in localStorage)
const pinnedItems = ref<string[]>([])
if (import.meta.client) {
  try {
    const raw = localStorage.getItem('termina:quickbuy')
    if (raw) pinnedItems.value = JSON.parse(raw)
  } catch { /* ignore */ }
}
function savePins() {
  if (import.meta.client) {
    localStorage.setItem('termina:quickbuy', JSON.stringify(pinnedItems.value))
  }
}
function pinItem(itemId: string) {
  if (!pinnedItems.value.includes(itemId)) {
    pinnedItems.value.push(itemId)
    savePins()
  }
}
function unpinItem(itemId: string) {
  pinnedItems.value = pinnedItems.value.filter((id) => id !== itemId)
  savePins()
}

// Categorize items for the shop
function getItemCategory(item: { id: string; cost: number; consumable: boolean }): 'starter' | 'core' | 'consumable' {
  if (item.consumable) return 'consumable'
  if (item.cost <= 500) return 'starter'
  return 'core'
}

// Format items from registry as ShopItem[] for ItemShop component
const shopItems = computed(() => {
  return Object.values(ITEMS).map((item) => ({
    id: item.id,
    name: item.name,
    cost: item.cost,
    def: item,
    category: getItemCategory(item),
  }))
})

const playerItems = computed(() => gameStore.player?.items ?? [null, null, null, null, null, null])
const playerBuffs = computed(() => gameStore.player?.buffs ?? [])

onMounted(() => {
  if (gameStore.gameId && gameStore.playerId) {
    uiLog.info('GameScreen connecting', { gameId: gameStore.gameId, playerId: gameStore.playerId })
    gameSocket.connect(gameStore.gameId, gameStore.playerId)
  } else {
    uiLog.warn('GameScreen mounted without gameId or playerId', { gameId: gameStore.gameId, playerId: gameStore.playerId })
  }

  // Keyboard listener for Tab (scoreboard toggle)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
})

onUnmounted(() => {
  gameSocket.disconnect()
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
})

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Tab') {
    e.preventDefault()
    showScoreboard.value = true
    return
  }
  // Number keys 1-6 for item use (only when not focused on input)
  const target = e.target as HTMLElement
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
  const slot = Number.parseInt(e.key, 10)
  if (slot >= 1 && slot <= 6) {
    handleItemUseBySlot(slot - 1)
  }
}

function onKeyUp(e: KeyboardEvent) {
  if (e.key === 'Tab') {
    e.preventDefault()
    showScoreboard.value = false
  }
}

// ── Audio cues ───────────────────────────────────────────────

// Play 'tick' sound on each new tick
watch(() => gameStore.tick, () => {
  playSound('tick')
})

// Watch game events for audio cues
watch(() => gameStore.events.length, (newLen, oldLen) => {
  if (newLen <= (oldLen ?? 0)) return
  const newEvents = gameStore.events.slice(oldLen ?? 0)
  const pid = gameStore.playerId
  if (!pid) return

  for (const e of newEvents) {
    switch (e.type) {
      case 'damage':
        if (e.payload.sourceId === pid || e.payload.targetId === pid) {
          playSound('damage')
        }
        break
      case 'death':
        if (e.payload.playerId === pid) {
          playSound('death')
        }
        break
      case 'gold_change':
        if (e.payload.playerId === pid) {
          playSound('gold')
        }
        break
      case 'level_up':
        if (e.payload.playerId === pid) {
          playSound('ready')
        }
        break
      case 'kill':
        if (e.payload.killerId === pid) {
          playSound('kill')
        }
        break
    }
  }
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
    let killerHeroId: string | undefined
    let victimHeroId: string | undefined

    switch (e.type) {
      case 'damage':
        text = `${e.payload.sourceId} dealt ${e.payload.amount} ${e.payload.damageType ?? ''} damage to ${e.payload.targetId}`
        type = 'damage'
        break
      case 'heal':
        text = `${e.payload.sourceId} healed ${e.payload.targetId} for ${e.payload.amount}`
        type = 'healing'
        break
      case 'kill': {
        const goldPart = e.payload.goldAwarded ? ` (+${e.payload.goldAwarded}g)` : ''
        text = `[KILL] ${e.payload.killerId} eliminated ${e.payload.victimId}!${goldPart}`
        type = 'kill'
        killerHeroId = e.payload.killerId ? gameStore.allPlayers[e.payload.killerId as string]?.heroId ?? undefined : undefined
        victimHeroId = e.payload.victimId ? gameStore.allPlayers[e.payload.victimId as string]?.heroId ?? undefined : undefined
        break
      }
      case 'death': {
        const respawnTick = e.payload.respawnTick as number | undefined
        const respawnText = respawnTick != null
          ? ` (respawn in ${respawnTick - gameStore.tick} ticks)`
          : ''
        text = `[DEATH] ${e.payload.playerId} was terminated${respawnText}`
        type = 'damage'
        break
      }
      case 'gold_change':
        text = `${e.payload.playerId} ${(e.payload.amount as number) >= 0 ? 'earned' : 'lost'} ${Math.abs(e.payload.amount as number)}g (${e.payload.reason})`
        type = 'gold'
        break
      case 'level_up':
        text = `[LEVEL UP] ${e.payload.playerId} reached level ${e.payload.newLevel}!`
        type = 'system'
        break
      case 'ability_used':
        text = `${e.payload.playerId} used ${e.payload.abilityId}${e.payload.targetId ? ` on ${e.payload.targetId}` : ''}`
        type = 'ability'
        break
      case 'tower_kill':
        text = `[KILL] ${e.payload.killerTeam} destroyed ${e.payload.team} tower in ${e.payload.zone}!`
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

    return { tick: e.tick, text, type, killerHeroId, victimHeroId }
  })

  return [...mapped, ...localEvents.value].sort((a, b) => a.tick - b.tick)
})

// Build tower lookup: zoneId → TowerState (from the tick_state)
// The game store doesn't directly store towers, but they come via the tick state.
// We'll track them via onMessage.
const towers = ref<TowerState[]>([])

let firstTickLogged = false
gameSocket.onMessage((msg) => {
  if (msg.type === 'tick_state') {
    if (!firstTickLogged) {
      firstTickLogged = true
      uiLog.info('First tick_state received — game is live')
      localEvents.value.push({
        tick: 0,
        text: '>_ Connected to game server. Stream active.',
        type: 'system',
      })
    }
    const state = msg.state as Record<string, unknown>
    if (state.towers) {
      towers.value = state.towers
    }
  } else if (msg.type === 'announcement') {
    localEvents.value.push({
      tick: gameStore.tick,
      text: `>_ ${msg.message}`,
      type: 'system',
    })
  } else if (msg.type === 'error') {
    localEvents.value.push({
      tick: gameStore.tick,
      text: `[ERROR] ${msg.message}`,
      type: 'system',
    })
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
  const { command, error } = commands.parse(cmd)
  if (command) {
    // Client-side validation for move commands
    if (command.type === 'move' && gameStore.player) {
      const playerZone = ZONE_MAP[gameStore.player.zone]
      if (playerZone && command.zone !== gameStore.player.zone && !playerZone.adjacentTo.includes(command.zone)) {
        localEvents.value.push({
          tick: gameStore.tick,
          text: `Cannot move to ${command.zone} — not adjacent. Adjacent zones: ${playerZone.adjacentTo.join(', ')}`,
          type: 'system',
        })
        return
      }
    }
    // Client-side validation for cast mana cost
    if (command.type === 'cast' && gameStore.player && !gameStore.player.alive) {
      localEvents.value.push({
        tick: gameStore.tick,
        text: 'Cannot act while dead',
        type: 'system',
      })
      return
    }
    uiLog.debug('Command sent', { type: command.type })
    gameSocket.send({ type: 'action', command })
  } else if (error) {
    localEvents.value.push({
      tick: gameStore.tick,
      text: error,
      type: 'system',
    })
  }
}

function handleBuyItem(itemId: string) {
  handleCommand(`buy ${itemId}`)
}

function handleQuickAction(cmd: string) {
  uiLog.debug('Quick action', { cmd })
  const p = gameStore.player
  if (!p) return

  if (cmd === 'SHOP') {
    showShop.value = !showShop.value
    return
  }

  if (cmd === 'MOVE') {
    // Show adjacent zones as a hint
    const zone = ZONE_MAP[p.zone]
    if (zone) {
      const adjacent = zone.adjacentTo.join(', ')
      localEvents.value.push({
        tick: gameStore.tick,
        text: `Adjacent zones: ${adjacent}`,
        type: 'system',
      })
    }
    return
  }

  if (cmd === 'ATK') {
    // Auto-target nearest enemy in zone
    const enemies = Object.values(gameStore.allPlayers).filter(
      (e) => e.zone === p.zone && e.team !== p.team && e.alive,
    )
    if (enemies.length > 0) {
      const target = enemies[0]!
      const targetRef = `hero:${target.heroId ?? target.name}`
      handleCommand(`attack ${targetRef}`)
    } else {
      localEvents.value.push({
        tick: gameStore.tick,
        text: 'No enemies in your zone. Usage: attack <target>',
        type: 'system',
      })
    }
    return
  }

  // Q/W/E/R — cast ability
  if (['Q', 'W', 'E', 'R'].includes(cmd)) {
    handleCommand(`cast ${cmd.toLowerCase()}`)
    return
  }

  handleCommand(cmd.toLowerCase())
}

// ── Item use from inventory bar / keybinds ───────────────────
function handleItemUse(_slotIndex: number, itemId: string) {
  if (!gameStore.player?.alive) {
    localEvents.value.push({
      tick: gameStore.tick,
      text: 'Cannot use items while dead',
      type: 'system',
    })
    return
  }
  handleCommand(`use ${itemId}`)
}

function handleItemUseBySlot(slotIndex: number) {
  const itemId = gameStore.player?.items[slotIndex]
  if (!itemId) return
  handleItemUse(slotIndex, itemId)
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
          Respawning in {{ Math.max(0, gameStore.player.respawnTick - gameStore.tick) }} ticks
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
      :hero-id="gameStore.player?.heroId ?? undefined"
      :connected="connected"
      :reconnecting="reconnecting"
      :latency="latency"
    />

    <TerminalPanel title="Map" class="game-grid__map min-h-0">
      <AsciiMap :zones="mapZones" :player-zone="playerZone" />
    </TerminalPanel>

    <TerminalPanel title="Combat Log" class="game-grid__log min-h-0">
      <CombatLog :events="combatEvents" />
    </TerminalPanel>

    <TerminalPanel title="Hero Status" class="game-grid__hero min-h-0">
      <HeroStatus v-if="heroData" :hero="heroData" :hero-id="gameStore.player?.heroId ?? undefined" />
      <div v-else class="p-2 text-[0.8rem] text-text-dim">&gt;_ awaiting hero data...</div>
    </TerminalPanel>

    <!-- Scoreboard overlay (Tab hold) -->
    <div
      v-if="showScoreboard && gameStore.teams"
      class="absolute inset-0 z-30 flex items-center justify-center bg-black/80"
    >
      <div class="w-full max-w-4xl border border-border bg-bg-primary">
        <Scoreboard
          :players="gameStore.scoreboard"
          :teams="gameStore.teams"
          :current-tick="currentTick"
          :current-player-id="gameStore.playerId ?? ''"
        />
      </div>
    </div>

    <!-- Item Shop overlay -->
    <div
      v-if="showShop"
      class="absolute inset-0 z-30 flex items-center justify-center bg-black/80"
    >
      <div class="w-full max-w-2xl border border-border bg-bg-primary p-4">
        <div class="mb-2 flex items-center justify-between">
          <span class="text-[0.9rem] font-bold text-gold">&gt;_ ITEM SHOP</span>
          <button
            class="border border-border px-2 py-0.5 font-mono text-[0.7rem] text-text-dim hover:text-text-primary"
            @click="showShop = false"
          >
            [CLOSE]
          </button>
        </div>
        <div
          v-if="!gameStore.canBuy"
          class="mb-2 border border-dire/30 bg-dire/5 px-3 py-1.5 text-xs text-dire"
        >
          [WARN] You must be in the fountain or base zone to purchase items.
        </div>
        <div
          v-if="playerItems.filter(Boolean).length >= 6"
          class="mb-2 border border-gold/30 bg-gold/5 px-3 py-1.5 text-xs text-gold"
        >
          [WARN] Inventory full (6/6 slots). Sell an item to make room.
        </div>
        <ItemShop
          :items="shopItems"
          :gold="playerGold"
          :owned-items="playerItems"
          :pinned-items="pinnedItems"
          @buy="handleBuyItem"
          @pin="pinItem"
          @unpin="unpinItem"
        />
      </div>
    </div>

    <div class="game-grid__cmd flex min-h-0 flex-col justify-end">
      <!-- Inventory Bar (above command input) -->
      <div class="flex items-center gap-2 border-t border-border bg-bg-secondary px-2 py-1">
        <InventoryBar
          :items="playerItems"
          :buffs="playerBuffs"
          @use="handleItemUse"
        />
        <QuickBuy
          v-if="pinnedItems.length"
          :pinned-items="pinnedItems"
          :gold="playerGold"
          :can-buy="gameStore.canBuy"
          @buy="handleBuyItem"
          @unpin="unpinItem"
        />
      </div>
      <div class="hidden gap-1 px-2 py-1 overflow-x-auto lg:hidden max-lg:flex">
        <button
          v-for="cmd in ['ATK', 'Q', 'W', 'E', 'R', 'MOVE', 'SHOP']"
          :key="cmd"
          class="whitespace-nowrap border border-border bg-bg-secondary px-2 py-1 font-mono text-[0.7rem] text-text-primary active:bg-border"
          :class="{ 'border-gold text-gold': cmd === 'SHOP' && gameStore.canBuy }"
          @click="handleQuickAction(cmd)"
        >
          {{ cmd }}
        </button>
      </div>
      <CommandInput
        placeholder="Enter command (Tab for autocomplete)..."
        :tick-countdown="gameStore.nextTickIn"
        :player="gameStore.player"
        :visible-zones="gameStore.visibleZones"
        :all-players="gameStore.allPlayers"
        :items="ITEMS"
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
