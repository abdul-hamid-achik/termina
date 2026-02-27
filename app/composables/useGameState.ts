import { computed, ref, onUnmounted } from 'vue'
import { useGameStore } from '~/stores/game'
import { ZONE_MAP } from '~~/shared/constants/zones'
import { TICK_DURATION_MS } from '~~/shared/constants/balance'

export function useGameState() {
  const store = useGameStore()

  const currentZone = computed(() => store.currentZone)

  const visibleZones = computed(() => store.visibleZones)

  const nearbyEnemies = computed(() => store.nearbyEnemies)

  const nearbyAllies = computed(() => store.nearbyAllies)

  const canBuyItems = computed(() => store.canBuy)

  const isAlive = computed(() => store.isAlive)

  function abilityReady(slot: 'q' | 'w' | 'e' | 'r'): boolean {
    if (!store.player) return false
    return store.player.cooldowns[slot] === 0
  }

  function itemReady(_slot: number): boolean {
    // Item active cooldowns are not tracked in PlayerState yet
    return true
  }

  // Reactive tick countdown
  const tickCountdown = ref(0)
  let countdownInterval: ReturnType<typeof setInterval> | null = null

  function startCountdown() {
    stopCountdown()
    tickCountdown.value = TICK_DURATION_MS
    countdownInterval = setInterval(() => {
      tickCountdown.value = Math.max(0, tickCountdown.value - 100)
    }, 100)
  }

  function stopCountdown() {
    if (countdownInterval) {
      clearInterval(countdownInterval)
      countdownInterval = null
    }
  }

  // Reset countdown on each tick change
  const _tickWatcher = computed(() => store.tick)
  let lastTick = store.tick

  // Manual polling since we can't use watch in a composable without setup
  const pollInterval = setInterval(() => {
    if (store.tick !== lastTick) {
      lastTick = store.tick
      startCountdown()
    }
  }, 200)

  onUnmounted(() => {
    stopCountdown()
    clearInterval(pollInterval)
  })

  const adjacentZones = computed(() => {
    if (!store.player) return []
    const zone = ZONE_MAP[store.player.zone]
    if (!zone) return []
    return zone.adjacentTo.map(id => ZONE_MAP[id]).filter(Boolean)
  })

  const playerHp = computed(() => {
    if (!store.player) return { current: 0, max: 0, percent: 0 }
    return {
      current: store.player.hp,
      max: store.player.maxHp,
      percent: Math.round((store.player.hp / store.player.maxHp) * 100),
    }
  })

  const playerMp = computed(() => {
    if (!store.player) return { current: 0, max: 0, percent: 0 }
    return {
      current: store.player.mp,
      max: store.player.maxMp,
      percent: Math.round((store.player.mp / store.player.maxMp) * 100),
    }
  })

  return {
    currentZone,
    visibleZones,
    nearbyEnemies,
    nearbyAllies,
    canBuyItems,
    isAlive,
    abilityReady,
    itemReady,
    tickCountdown,
    adjacentZones,
    playerHp,
    playerMp,
  }
}
