<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useGameStore } from '~/stores/game'
import { useGameSocket } from '~/composables/useGameSocket'
import { useCommands, validateCommand, buybackCostFor } from '~/composables/useCommands'
import { useAudio } from '~/composables/useAudio'
import { ZONES, ZONE_MAP } from '~~/shared/constants/zones'
import { HEROES } from '~~/shared/constants/heroes'
import { ITEMS } from '~~/shared/constants/items'
import type { TowerState } from '~~/shared/types/game'
import { uiLog } from '~/utils/logger'
import {
  collapseStructureDamage,
  isStructureTarget,
  teamLabel,
  type CombatLine,
} from '~/utils/combatLog'

const gameStore = useGameStore()
const gameSocket = useGameSocket()
const commands = useCommands()
const { playSound } = useAudio()
const { connected, reconnecting, connectionLost, latency } = gameSocket

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
  } catch {
    /* ignore */
  }
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
function getItemCategory(item: {
  id: string
  cost: number
  consumable: boolean
}): 'starter' | 'core' | 'consumable' {
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
    uiLog.warn('GameScreen mounted without gameId or playerId', {
      gameId: gameStore.gameId,
      playerId: gameStore.playerId,
    })
  }

  // Keyboard listener for Tab (scoreboard toggle)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
})

onUnmounted(() => {
  gameSocket.disconnect()
  gameStore.stopTickCountdown()
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
})

function onKeyDown(e: KeyboardEvent) {
  const target = e.target as HTMLElement
  const isInputFocused = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA'

  // Tab: autocomplete when input is focused, toggle scoreboard when not
  if (e.key === 'Tab') {
    e.preventDefault()
    if (isInputFocused) {
      // Let CommandInput handle autocomplete - don't do anything here
      return
    }
    showScoreboard.value = true
    return
  }

  // Q/W/E/R for abilities - only when not in input
  if (!isInputFocused && ['q', 'w', 'e', 'r'].includes(e.key.toLowerCase())) {
    e.preventDefault()
    handleQuickAction(e.key.toLowerCase())
    return
  }

  // S key for shop toggle (only when not focused on input)
  if (e.key.toLowerCase() === 's') {
    if (isInputFocused) return
    e.preventDefault()
    showShop.value = !showShop.value
    return
  }

  // Number keys 1-6 for item use (only when not focused on input)
  if (isInputFocused) return
  const slot = Number.parseInt(e.key, 10)
  if (slot >= 1 && slot <= 6) {
    e.preventDefault()
    handleItemUseBySlot(slot - 1)
  }

  // Arrow keys for quick movement (only when input not focused)
  if (!target.closest('.cmd-input-wrapper')) {
    if (
      e.key === 'ArrowUp' ||
      e.key === 'ArrowDown' ||
      e.key === 'ArrowLeft' ||
      e.key === 'ArrowRight'
    ) {
      e.preventDefault()
      handleArrowMove(e.key)
    }
  }
}

function handleArrowMove(direction: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight') {
  const p = gameStore.player
  if (!p) return

  const playerZone = ZONE_MAP[p.zone]
  if (!playerZone || !playerZone.adjacentTo.length) return

  // Map arrow keys to adjacent zones based on map position
  // This is a simplified approach - we use the first adjacent zone in a direction
  const adjacent = playerZone.adjacentTo

  // Simple heuristic based on zone naming patterns
  let targetZone: string | null = null

  if (direction === 'ArrowUp') {
    // Move toward radiant base (top of map)
    targetZone =
      adjacent.find(
        (z) =>
          z.includes('rad') ||
          z.includes('t3-rad') ||
          z === 'radiant-base' ||
          z === 'radiant-fountain',
      ) ?? null
  } else if (direction === 'ArrowDown') {
    // Move toward dire base (bottom of map)
    targetZone =
      adjacent.find(
        (z) =>
          z.includes('dire') || z.includes('t3-dire') || z === 'dire-base' || z === 'dire-fountain',
      ) ?? null
  } else if (direction === 'ArrowLeft') {
    // Move toward left side (top lane or jungle)
    targetZone = adjacent.find((z) => z.startsWith('top-') || z.startsWith('jungle-rad')) ?? null
  } else if (direction === 'ArrowRight') {
    // Move toward right side (bot lane or jungle)
    targetZone = adjacent.find((z) => z.startsWith('bot-') || z.startsWith('jungle-dire')) ?? null
  }

  // Fallback: just pick first adjacent
  if (!targetZone && adjacent.length > 0) {
    targetZone = adjacent[0]!
  }

  if (targetZone) {
    handleCommand(`move ${targetZone}`)
  }
}

function onKeyUp(e: KeyboardEvent) {
  if (e.key === 'Tab') {
    e.preventDefault()
    showScoreboard.value = false
  }
}

// ── Audio cues + screen shake ──────────────────────────────────

const screenShake = ref<'none' | 'light' | 'strong'>('none')
let shakeTimer: ReturnType<typeof setTimeout> | null = null
function triggerShake(level: 'light' | 'strong') {
  if (shakeTimer) clearTimeout(shakeTimer)
  // re-trigger by going none → level on next frame
  screenShake.value = 'none'
  requestAnimationFrame(() => {
    screenShake.value = level
    shakeTimer = setTimeout(() => {
      screenShake.value = 'none'
    }, level === 'strong' ? 600 : 400)
  })
}

// On each new tick: play the tick sound and flush any command the player
// pre-typed while waiting (buffered client-side, sent now that they can act).
watch(
  () => gameStore.tick,
  () => {
    playSound('tick')
    const buffered = gameStore.consumeBufferedCommand()
    if (buffered) {
      handleCommand(buffered)
    }
  },
)

// Watch game events for audio cues + shake
watch(
  () => gameStore.events.length,
  (newLen, oldLen) => {
    if (newLen <= (oldLen ?? 0)) return
    const newEvents = gameStore.events.slice(oldLen ?? 0)
    const pid = gameStore.playerId
    if (!pid) return

    for (const e of newEvents) {
      switch (e.type) {
        case 'damage':
          if (e.payload.targetId === pid) {
            playSound('damage')
            triggerShake('light')
          } else if (e.payload.sourceId === pid) {
            playSound('damage')
          }
          break
        case 'death':
          if (e.payload.playerId === pid) {
            playSound('death')
            triggerShake('strong')
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
            triggerShake('light')
          }
          break
        case 'tower_kill':
          // Audible to everyone — towers are global events
          playSound('tower_fall')
          if (e.payload.killerId === pid) triggerShake('light')
          break
      }
    }
  },
)

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
    name: (p.heroId && HEROES[p.heroId]?.name) || p.name,
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

// Resolve raw entity IDs (github_*, bot_*, creep_3, tower_mid-t1-rad…) to
// readable names: hero name for players ("You" for self), short labels for units.
const abilityNameById: Record<string, string> = {}
for (const hero of Object.values(HEROES)) {
  for (const ability of Object.values(hero.abilities)) {
    abilityNameById[ability.id] = ability.name
  }
  abilityNameById[hero.passive.id] = hero.passive.name
}

function entityLabel(id: unknown): string {
  if (typeof id !== 'string' || !id) return '?'
  if (id === gameStore.playerId) return 'You'
  const p = gameStore.allPlayers[id]
  if (p) return (p.heroId && HEROES[p.heroId]?.name) || p.name || id
  if (id.startsWith('creep')) return 'a creep'
  if (id.startsWith('neutral')) return 'a neutral creep'
  if (id.startsWith('tower')) {
    const zone = id.slice('tower_'.length)
    return `tower (${zone})`
  }
  if (id.startsWith('ancient_')) {
    const team = id.slice('ancient_'.length)
    if (team === 'radiant') return 'the Radiant Core'
    if (team === 'dire') return 'the Dire Core'
    return `the ${team} Core`
  }
  if (id === 'roshan') return 'Roshan'
  if (id === 'buyback') return 'buyback'
  if (id === 'fountain') return 'the fountain'
  return id
}

function abilityLabel(id: unknown): string {
  if (typeof id !== 'string') return '?'
  return abilityNameById[id] ?? id
}

// Map game events to CombatLog format
const combatEvents = computed(() => {
  const mapped: CombatLine[] = gameStore.events.map((e) => {
    let text = ''
    let type: CombatLine['type'] = 'system'
    let killerHeroId: string | undefined
    let victimHeroId: string | undefined
    let dedupKey: string | undefined
    let dmgAmount: number | undefined

    switch (e.type) {
      case 'damage':
        text = `${entityLabel(e.payload.sourceId)} dealt ${e.payload.amount} ${e.payload.damageType ?? ''} damage to ${entityLabel(e.payload.targetId)}`
        type = 'damage'
        // Structure damage (a hero/creep chipping a tower or the Core) repeats
        // every tick; flag it so consecutive identical lines collapse into one
        // running line instead of flooding the log. Hero-vs-hero damage is left
        // un-keyed so it never merges.
        if (isStructureTarget(e.payload.targetId)) {
          dedupKey = `dmg:${String(e.payload.sourceId)}->${String(e.payload.targetId)}`
          dmgAmount = Number(e.payload.amount) || 0
        }
        break
      case 'heal':
        text = `${entityLabel(e.payload.sourceId)} healed ${entityLabel(e.payload.targetId)} for ${e.payload.amount}`
        type = 'healing'
        break
      case 'kill': {
        const goldPart = e.payload.goldAwarded ? ` (+${e.payload.goldAwarded}g)` : ''
        text = `[KILL] ${entityLabel(e.payload.killerId)} eliminated ${entityLabel(e.payload.victimId)}!${goldPart}`
        type = 'kill'
        killerHeroId = e.payload.killerId
          ? (gameStore.allPlayers[e.payload.killerId as string]?.heroId ?? undefined)
          : undefined
        victimHeroId = e.payload.victimId
          ? (gameStore.allPlayers[e.payload.victimId as string]?.heroId ?? undefined)
          : undefined
        break
      }
      case 'death': {
        const respawnTick = e.payload.respawnTick as number | undefined
        const respawnText =
          respawnTick != null ? ` (respawn in ${respawnTick - gameStore.tick} ticks)` : ''
        text = `[DEATH] ${entityLabel(e.payload.playerId)} was terminated${respawnText}`
        type = 'damage'
        break
      }
      case 'gold_change':
        text = `${entityLabel(e.payload.playerId)} ${(e.payload.amount as number) >= 0 ? 'earned' : 'lost'} ${Math.abs(e.payload.amount as number)}g (${e.payload.reason})`
        type = 'gold'
        break
      case 'level_up':
        text = `[LEVEL UP] ${entityLabel(e.payload.playerId)} reached level ${e.payload.newLevel}!`
        type = 'system'
        break
      case 'ability_used':
        text = `${entityLabel(e.payload.playerId)} used ${abilityLabel(e.payload.abilityId)}${e.payload.targetId ? ` on ${entityLabel(e.payload.targetId)}` : ''}`
        type = 'ability'
        break
      case 'tower_kill':
        text = `[KILL] ${e.payload.killerTeam} destroyed ${e.payload.team} tower in ${e.payload.zone}!`
        type = 'kill'
        break
      case 'ancient_destroyed':
        // The CombatLog renders the [VICTORY] tag for victory-type lines, so the
        // text carries no bracket tag (avoids the old doubled-[KILL] line) and
        // no longer reads as a "tower in <base>".
        text = `${teamLabel(String(e.payload.killerTeam))} destroyed the ${teamLabel(String(e.payload.team))} Core!`
        type = 'victory'
        break
      case 'creep_lasthit':
        text = `${entityLabel(e.payload.playerId)} last-hit ${e.payload.creepType} creep (+${e.payload.goldAwarded}g)`
        type = 'gold'
        break
      case 'item_purchased':
        text = `${entityLabel(e.payload.playerId)} purchased ${ITEMS[e.payload.itemId as string]?.name ?? e.payload.itemId} (-${e.payload.cost}g)`
        type = 'gold'
        break
      default:
        text = `${e.type}: ${JSON.stringify(e.payload)}`
        type = 'system'
    }

    return { tick: e.tick, text, type, killerHeroId, victimHeroId, dedupKey, dmgAmount }
  })

  // Collapse consecutive structure-damage spam (same source chipping the same
  // tower/Core every tick) into one running line with a hit count + total.
  const collapsed = collapseStructureDamage(
    mapped,
    ({ baseText, count, total }) => `${baseText} (${count} hits, ${total} total)`,
  )

  return [...collapsed, ...localEvents.value].sort((a, b) => a.tick - b.tick)
})

// Ancients (team cores) live in the game store — shown on the base zones of the map.
const ancients = computed(() => gameStore.ancients)

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
  } else if (msg.type === 'chat') {
    const tag = msg.channel === 'team' ? '[TEAM]' : '[ALL]'
    localEvents.value.push({
      tick: gameStore.tick,
      text: `${tag} ${msg.playerId}: ${msg.message}`,
      type: 'system',
    })
  } else if (msg.type === 'ping_map') {
    localEvents.value.push({
      tick: gameStore.tick,
      text: `[PING] ${msg.playerId} pinged ${msg.zone}`,
      type: 'system',
    })
  }
})

// Tower lookup: zoneId → TowerState (the store tracks towers from tick_state)
const towersByZone = computed(() => {
  const map = new Map<string, TowerState>()
  for (const t of gameStore.towers) {
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

    // Creeps in this zone
    const creepsInZone = gameStore.creeps.filter((c) => c.zone === zone.id)
    const creepCount = creepsInZone.length
    const creepTypes = [...new Set(creepsInZone.map((c) => c.type))]

    // Neutrals in this zone
    const neutralsInZone = gameStore.neutrals.filter((n) => n.zone === zone.id && n.alive)
    const neutralCount = neutralsInZone.length

    // Tower info
    const tower = towersByZone.value.get(zone.id)
    const towerDisplay = tower
      ? {
          team: tower.team,
          alive: tower.alive,
          tier: getTowerTier(zone.id),
          hp: tower.hp,
          maxHp: tower.maxHp,
        }
      : undefined

    return {
      id: zone.id,
      name: zone.name,
      playerHere: zone.id === playerZoneId,
      allies,
      enemyCount,
      tower: towerDisplay,
      fogged,
      creepCount,
      creepTypes,
      neutralCount,
    }
  })
})

const playerZone = computed(() => gameStore.player?.zone ?? '')

// ── Zone panel data (who's in my zone) ────────────────────────
const currentZoneName = computed(() => gameStore.currentZone?.name ?? playerZone.value)

// Creeps in the player's zone, tagged with their zone-local index (Nth creep
// in this zone) — the convention the server resolves `attack creep:<index>`
// against. Index after filtering: global-array indices are vision-filtered
// and don't survive the trip to the server.
const zoneCreeps = computed(() =>
  gameStore.creeps
    .filter((c) => c.zone === playerZone.value)
    .map((c, index) => ({ ...c, index })),
)

const zoneNeutrals = computed(() =>
  gameStore.neutrals.filter((n) => n.zone === playerZone.value && n.alive),
)

const zoneTower = computed(() => towersByZone.value.get(playerZone.value) ?? null)

// ── Buyback (death overlay) ───────────────────────────────────
const buybackInfo = computed(() => {
  const p = gameStore.player
  if (!p || p.alive) return null
  const cost = buybackCostFor(p)
  const cooldownTicks =
    p.buybackCooldown && gameStore.tick < p.buybackCooldown
      ? p.buybackCooldown - gameStore.tick
      : 0
  const shortfall = Math.max(0, cost - p.gold)
  return {
    cost,
    cooldownTicks,
    shortfall,
    canBuyback: cooldownTicks === 0 && shortfall === 0,
  }
})

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
    // Chat and ping are top-level WS messages, not game actions
    if (command.type === 'chat') {
      uiLog.debug('Chat sent', { channel: command.channel })
      gameSocket.send({ type: 'chat', channel: command.channel, message: command.message })
      return
    }
    if (command.type === 'ping') {
      uiLog.debug('Ping sent', { zone: command.zone })
      gameSocket.send({ type: 'ping_map', zone: command.zone })
      return
    }
    // Already acted this tick: buffer the command client-side and auto-send
    // it when the next tick arrives (buyback/surrender are special actions
    // the server handles out-of-band, so they always go through directly).
    const isSpecial = command.type === 'buyback' || command.type === 'surrender'
    if (!isSpecial && gameStore.isAlive && !gameStore.canAct) {
      gameStore.bufferCommand(cmd)
      localEvents.value.push({
        tick: gameStore.tick,
        text: `[QUEUED] ${cmd} — will send next tick`,
        type: 'system',
      })
      return
    }
    // Pre-flight validation mirroring server rules — don't waste the one
    // action this tick on a command the server will reject.
    const validationError = validateCommand(command, {
      player: gameStore.player,
      visibleZones: gameStore.visibleZones,
      allPlayers: gameStore.allPlayers,
      items: ITEMS,
      tick: gameStore.tick,
    })
    if (validationError) {
      localEvents.value.push({
        tick: gameStore.tick,
        text: validationError,
        type: 'system',
      })
      return
    }
    uiLog.debug('Command sent', { type: command.type })
    gameSocket.send({ type: 'action', command })
    gameStore.markActionSent(cmd)
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

function handleZoneClick(zoneId: string) {
  const p = gameStore.player
  if (!p) return

  // Check if zone is adjacent or current
  const playerZone = ZONE_MAP[p.zone]
  if (!playerZone) return

  if (p.zone === zoneId) {
    localEvents.value.push({
      tick: gameStore.tick,
      text: `Already in ${zoneId}`,
      type: 'system',
    })
    return
  }

  if (!playerZone.adjacentTo.includes(zoneId)) {
    localEvents.value.push({
      tick: gameStore.tick,
      text: `Cannot move to ${zoneId} — not adjacent`,
      type: 'system',
    })
    return
  }

  handleCommand(`move ${zoneId}`)
}

function handleQuickAction(cmd: string) {
  uiLog.debug('Quick action', { cmd })
  const p = gameStore.player
  if (!p) return

  if (cmd === 'SHOP') {
    showShop.value = !showShop.value
    return
  }

  if (cmd === 'SCORE') {
    showScoreboard.value = !showScoreboard.value
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

  // Q/W/E/R — cast ability (accept both upper and lowercase)
  if (['Q', 'W', 'E', 'R', 'q', 'w', 'e', 'r'].includes(cmd)) {
    playSound('cast')
    handleCommand(`cast ${cmd.toLowerCase()}`)
    return
  }

  handleCommand(cmd.toLowerCase())
}

// ── Quick action button availability ─────────────────────────
// Greys out Q/W/E/R when on cooldown or unaffordable so players can see
// at a glance which abilities are actually castable this tick.
const abilityButtonState = computed(() => {
  const p = gameStore.player
  const result: Record<string, { ready: boolean; label: string }> = {}
  for (const slot of ['q', 'w', 'e', 'r'] as const) {
    const upper = slot.toUpperCase()
    if (!p || !p.alive || !p.heroId) {
      result[upper] = { ready: false, label: upper }
      continue
    }
    const cd = p.cooldowns[slot]
    if (cd > 0) {
      result[upper] = { ready: false, label: `${upper}·${cd}` }
      continue
    }
    const ability = HEROES[p.heroId]?.abilities[slot]
    if (ability && p.mp < ability.manaCost) {
      result[upper] = { ready: false, label: upper }
      continue
    }
    result[upper] = { ready: true, label: upper }
  }
  return result
})

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

// Get the most recent death event for the player
const lastDeathEvent = computed(() => {
  const pid = gameStore.playerId
  if (!pid) return null
  // Find the most recent kill event where the player was the victim
  const kills = gameStore.events.filter((e) => e.type === 'kill' && e.payload.victimId === pid)
  return kills.length > 0 ? kills[kills.length - 1] : null
})

const killerName = computed(() => {
  const death = lastDeathEvent.value
  if (!death) return null
  const killerId = death.payload.killerId as string | undefined
  if (!killerId) return null
  const killer = gameStore.allPlayers[killerId]
  return (killer?.heroId && HEROES[killer.heroId]?.name) || killer?.name || killerId
})

const postGamePlayers = computed(() => {
  return Object.values(gameStore.allPlayers).map((p) => ({
    id: p.id,
    name: p.name,
    heroId: p.heroId ?? '',
    team: p.team,
  }))
})

function reloadPage() {
  window.location.reload()
}

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
    :game-id="gameStore.gameId ?? null"
    @play-again="handlePlayAgain"
    @return-to-menu="handleReturnToMenu"
  />

  <!-- Active Game Screen -->
  <div
    v-else
    class="game-grid relative bg-bg-primary"
    :class="{ 'anim-shake': screenShake === 'light', 'anim-shake-strong': screenShake === 'strong' }"
    data-testid="game-screen"
    :data-game-id="gameStore.gameId ?? ''"
  >
    <div
      v-if="!gameStore.isAlive && gameStore.player"
      class="game-grid__map death-overlay"
      data-testid="death-overlay"
    >
      <div
        class="anim-fade-in-up flex h-full flex-col items-center justify-center rounded-lg border-2 border-dire bg-bg-panel p-6 text-center bloom-dire"
      >
        <div class="mb-4 text-6xl text-dire text-glow-dire anim-glow-pulse">☠</div>
        <p class="t-display text-dire text-glow-dire tracking-widest">PROCESS TERMINATED</p>
        <p v-if="killerName" class="t-h3 mt-5 text-text-primary">
          Killed by <span class="text-dire text-glow-dire">{{ killerName }}</span>
        </p>
        <p v-if="gameStore.player.respawnTick" class="mt-5 t-body text-text-dim">
          Respawning in
          <span class="text-radiant text-glow-radiant font-bold t-mono-num">{{
            Math.max(0, gameStore.player.respawnTick - gameStore.tick)
          }}</span>
          ticks...
        </p>
        <div v-if="buybackInfo" class="mt-6 flex flex-col items-center gap-2">
          <button
            data-testid="buyback-button"
            class="border px-4 py-2 font-mono text-sm transition-all"
            :class="
              buybackInfo.canBuyback
                ? 'border-gold text-gold hover:bg-gold/10 active:scale-95'
                : 'cursor-not-allowed border-border text-text-dim opacity-60'
            "
            :disabled="!buybackInfo.canBuyback"
            @click="handleCommand('buyback')"
          >
            [BUYBACK — {{ buybackInfo.cost }}g]
          </button>
          <p v-if="buybackInfo.cooldownTicks > 0" class="t-caption text-dire">
            Buyback on cooldown ({{ buybackInfo.cooldownTicks }} ticks remaining)
          </p>
          <p v-else-if="buybackInfo.shortfall > 0" class="t-caption text-text-dim">
            Need {{ buybackInfo.shortfall }}g more ({{ gameStore.player.gold }}g /
            {{ buybackInfo.cost }}g)
          </p>
        </div>
        <p class="mt-4 t-caption">Wait for respawn or buy back to return instantly</p>
      </div>
    </div>
    <!-- Connection lost: all reconnect attempts exhausted -->
    <div
      v-if="connectionLost"
      class="absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-bg-primary/90"
      data-testid="connection-lost-overlay"
    >
      <div class="text-4xl text-dire text-glow-dire">⚠ CONNECTION LOST</div>
      <p class="max-w-md text-center text-sm text-text-dim">
        Could not reach the game server after multiple attempts. The match may still be running —
        reload to try again.
      </p>
      <button
        class="border border-dire px-4 py-2 font-mono text-dire transition-all hover:bg-dire/10 active:scale-95"
        @click="reloadPage"
      >
        [RELOAD]
      </button>
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
      :time-of-day="gameStore.timeOfDay"
      :day-night-tick="gameStore.dayNightTick"
      :next-tick-in="gameStore.nextTickIn"
    />

    <TerminalPanel title="Map" class="game-grid__map min-h-0">
      <div class="flex h-full items-center justify-center">
        <AsciiMap
          :zones="mapZones"
          :player-zone="playerZone"
          :ancients="ancients"
          @zone-click="handleZoneClick"
        />
      </div>
    </TerminalPanel>

    <TerminalPanel title="Combat Log" class="game-grid__log min-h-0">
      <CombatLog :events="combatEvents" />
    </TerminalPanel>

    <TerminalPanel title="Hero Status" class="game-grid__hero min-h-0">
      <HeroStatus
        v-if="heroData"
        :hero="heroData"
        :hero-id="gameStore.player?.heroId ?? undefined"
        @cast-ability="handleQuickAction"
      />
      <div v-else class="p-2 text-[0.8rem] text-text-dim">&gt;_ awaiting hero data...</div>
    </TerminalPanel>

    <TerminalPanel :title="`Zone: ${currentZoneName}`" class="game-grid__zone min-h-0">
      <ZonePanel
        :zone-name="currentZoneName"
        :player-team="gameStore.player?.team ?? 'radiant'"
        :enemies="gameStore.nearbyEnemies"
        :allies="gameStore.nearbyAllies"
        :creeps="zoneCreeps"
        :neutrals="zoneNeutrals"
        :tower="zoneTower"
        @command="handleCommand"
      />
    </TerminalPanel>

    <!-- Scoreboard overlay (Tab hold on desktop, SCORE button on mobile) -->
    <div
      v-if="showScoreboard && gameStore.teams"
      class="absolute inset-0 z-30 flex items-center justify-center bg-black/80 p-2 anim-fade-in-up"
      data-testid="scoreboard-overlay"
      @click.self="showScoreboard = false"
    >
      <div class="w-full max-w-4xl border border-border bg-bg-primary">
        <Scoreboard
          :players="gameStore.scoreboard"
          :teams="gameStore.teams"
          :current-tick="currentTick"
          :current-player-id="gameStore.playerId ?? ''"
        />
        <button
          class="block w-full border-t border-border bg-bg-secondary py-2 t-caption hover:text-text-primary"
          @click="showScoreboard = false"
        >
          [tap outside or here to close]
        </button>
      </div>
    </div>

    <!-- Item Shop overlay -->
    <div v-if="showShop" class="absolute inset-0 z-30 flex items-center justify-center bg-black/80">
      <div
        class="flex max-h-[85vh] w-full max-w-2xl flex-col border border-border bg-bg-primary p-4"
      >
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
        <InventoryBar :items="playerItems" :buffs="playerBuffs" @use="handleItemUse" />
        <QuickBuy
          v-if="pinnedItems.length"
          :pinned-items="pinnedItems"
          :gold="playerGold"
          :can-buy="gameStore.canBuy"
          @buy="handleBuyItem"
          @unpin="unpinItem"
        />
        <button
          class="ml-auto whitespace-nowrap border border-border bg-bg-secondary px-2 py-1 font-mono text-[0.7rem] text-gold hover:text-text-primary active:bg-border"
          :class="{ 'border-gold': gameStore.canBuy }"
          title="Shop (S)"
          @click="showShop = !showShop"
        >
          [SHOP]
        </button>
      </div>
      <div class="flex gap-1 overflow-x-auto px-2 py-1.5">
        <button
          v-for="cmd in ['ATK', 'Q', 'W', 'E', 'R', 'MOVE', 'SHOP', 'SCORE']"
          :key="cmd"
          class="min-h-[40px] min-w-[44px] whitespace-nowrap border border-border bg-bg-secondary px-2.5 py-1.5 font-mono text-[0.75rem] font-bold text-text-primary transition-all active:bg-border active:scale-95"
          :class="{
            'border-gold text-gold': cmd === 'SHOP' && gameStore.canBuy,
            'border-ability text-ability shadow-glow-ability':
              ['Q', 'W', 'E', 'R'].includes(cmd) && abilityButtonState[cmd]?.ready,
            'cursor-not-allowed border-border/50 text-text-dim opacity-50':
              ['Q', 'W', 'E', 'R'].includes(cmd) && !abilityButtonState[cmd]?.ready,
            'border-self text-self': cmd === 'SCORE',
          }"
          @click="handleQuickAction(cmd)"
        >
          {{ ['Q', 'W', 'E', 'R'].includes(cmd) ? abilityButtonState[cmd]?.label : cmd }}
        </button>
      </div>
      <CommandInput
        placeholder="Enter command (Tab for autocomplete)..."
        :tick-countdown="gameStore.nextTickIn"
        :player="gameStore.player"
        :visible-zones="gameStore.visibleZones"
        :all-players="gameStore.allPlayers"
        :items="ITEMS"
        :can-act="gameStore.canAct"
        :pending-command="gameStore.pendingCommand"
        :buffered-command="gameStore.bufferedCommand"
        :tick="gameStore.tick"
        @submit="handleCommand"
      />
    </div>
  </div>
</template>

<style scoped>
.game-grid {
  display: grid;
  grid-template-columns: 7fr 3fr;
  grid-template-rows: auto 1fr auto auto auto;
  gap: 2px;
  /* dvh tracks the real visible height on mobile (URL bar collapse); vh is the fallback */
  height: 100vh;
  height: 100dvh;
}

.game-grid__bar {
  grid-column: 1 / -1;
}
.game-grid__map {
  grid-row: 2 / 6;
  grid-column: 1;
}
.game-grid__log {
  grid-row: 2;
  grid-column: 2;
}
.game-grid__hero {
  grid-row: 3;
  grid-column: 2;
}
.game-grid__zone {
  grid-row: 4;
  grid-column: 2;
}
.game-grid__cmd {
  grid-row: 5;
  grid-column: 2;
}

.death-overlay {
  position: absolute;
  inset: 0;
  z-index: 20;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
}

@media (max-width: 1024px) {
  .game-grid {
    /* Map gets more vertical real estate than log/hero on tablet.
       The compact zone-card map needs a guaranteed minimum to stay usable.
       Hero status and zone panel share a row side-by-side. */
    grid-template-columns: 1fr 1fr;
    grid-template-rows: auto minmax(240px, 2fr) 1fr 1fr auto;
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
    grid-column: 1;
    grid-row: 4;
  }
  .game-grid__zone {
    grid-column: 2;
    grid-row: 4;
  }
  .game-grid__cmd {
    grid-column: 1 / -1;
    grid-row: 5;
  }
}

@media (max-width: 640px) {
  .game-grid {
    /* On phones, prioritize map + hero + zone (touch targeting).
       The compact map (current zone + tappable adjacent cards) scrolls
       internally, so 200px keeps it usable without starving the zone
       panel below it. The log gets the smallest slice. */
    grid-template-columns: 1fr;
    grid-template-rows:
      auto minmax(200px, 2fr) minmax(96px, 1fr) minmax(120px, 1.3fr)
      minmax(64px, 0.8fr) auto;
    gap: 1px;
  }
  .game-grid__map {
    grid-column: 1;
    grid-row: 2;
  }
  .game-grid__hero {
    grid-column: 1;
    grid-row: 3;
  }
  .game-grid__zone {
    grid-column: 1;
    grid-row: 4;
  }
  .game-grid__log {
    grid-column: 1;
    grid-row: 5;
  }
  .game-grid__cmd {
    grid-column: 1;
    grid-row: 6;
  }
}
</style>
