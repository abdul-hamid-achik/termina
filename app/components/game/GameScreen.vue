<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { formatTickClock } from '~/utils/gameClock'
import AnnouncementToast from '~/components/game/AnnouncementToast.vue'
import AsciiMap from '~/components/game/AsciiMap.vue'
import CommandInput from '~/components/game/CommandInput.vue'
import DamageFloat, { type DamageFloatEntry } from '~/components/game/DamageFloat.vue'
import FocusBanner from '~/components/game/FocusBanner.vue'
import GameStateBar from '~/components/game/GameStateBar.vue'
import HeroStatus from '~/components/game/HeroStatus.vue'
import InventoryBar from '~/components/game/InventoryBar.vue'
import ItemShop from '~/components/game/ItemShop.vue'
import KillFeed from '~/components/game/KillFeed.vue'
import QuickBuy from '~/components/game/QuickBuy.vue'
import Scoreboard from '~/components/game/Scoreboard.vue'
import TalentPicker from '~/components/game/TalentPicker.vue'
import TickTheater from '~/components/game/TickTheater.vue'
import TutorialHint from '~/components/game/TutorialHint.vue'
import WarRoom from '~/components/game/WarRoom.vue'
import ZonePanel from '~/components/game/ZonePanel.vue'
import PostGame from '~/components/lobby/PostGame.vue'
import TerminalPanel from '~/components/ui/TerminalPanel.vue'
import { useGameStore } from '~/stores/game'
import { useSettingsStore } from '~/stores/settings'
import { useGameSocket } from '~/composables/useGameSocket'
import {
  useCommands,
  validateCommand,
  buybackCostFor,
  pickAbilityTargetString,
  pickAttackTargetString,
  pickDenyTargetString,
  pickItemTargetString,
  formatStatusReadout,
  formatMapReadout,
  formatScanReadout,
  formatHelpReadout,
} from '~/composables/useCommands'
import { useAudio } from '~/composables/useAudio'
import { ZONES, ZONE_MAP } from '~~/shared/constants/zones'
import { HEROES } from '~~/shared/constants/heroes'
import { recommendedItemsForRole } from '~~/shared/constants/itemBuilds'
import { ITEMS, DEFAULT_QUICKBUY_ITEMS } from '~~/shared/constants/items'
import { getTalentTree } from '~~/shared/constants/talents'
import type { TowerState } from '~~/shared/types/game'
import { uiLog } from '~/utils/logger'
import { collapseStructureDamage, type CombatLine } from '~/utils/combatLog'
import {
  buildCombatLines,
  deriveKillFeed,
  type NarrativeContext,
  type KillFeedEntry,
} from '~/utils/combatNarrative'
import { TICK_DURATION_MS, RUNE_DURATION_TICKS } from '~~/shared/constants/balance'
import { formatRoshan } from '~/utils/strategy'
import { arrowTargetZone } from '~/utils/arrowMove'
import { computeSituationalActions } from '~/utils/situationalActions'
import { routeGameKey } from '~/utils/gameKeys'

const gameStore = useGameStore()
const settings = useSettingsStore()
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

// Quick buy pinned items (persisted in localStorage). A player who has never
// customized them gets a curated starter set so the bar isn't empty — a new
// player otherwise has no shopping guidance until they discover pinning.
const pinnedItems = ref<string[]>([...DEFAULT_QUICKBUY_ITEMS])
if (import.meta.client) {
  try {
    const raw = localStorage.getItem('termina:quickbuy')
    if (raw) {
      // Validate shape: a tampered/legacy value that parses to a non-string[]
      // (object, numbers, string) would break the pin filters/props downstream.
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.every((i) => typeof i === 'string')) {
        pinnedItems.value = parsed
      }
    }
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

// Role-based shop recommendations for the new-player funnel — same canonical
// build lists the bots itemise from, surfaced as the shop's "★ FOR YOU" tab.
const recommendedShopItems = computed(() => {
  const heroId = gameStore.player?.heroId
  const role = heroId ? HEROES[heroId]?.role : undefined
  return recommendedItemsForRole(role)
})

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

  // First-time onboarding: a one-shot first-steps nudge in the event log (the
  // review's top retention lever). Gated on a localStorage flag so it shows once
  // for a new player and never nags veterans; clear `termina_intro_seen` to replay.
  try {
    if (typeof localStorage !== 'undefined' && !localStorage.getItem('termina_intro_seen')) {
      localStorage.setItem('termina_intro_seen', '1')
      const intro = [
        'Welcome to Termina — the game runs on 4s ticks; you queue ONE action per tick.',
        'You start in the fountain. Move to a lane: type or tap  move mid-river',
        'Last-hit enemy creeps (≈<50% HP) for gold — tap the creep group in the Zone panel.',
        'In the fountain/base press [S] (SHOP) to buy items; Q/W/E/R cast your abilities.',
        'Destroy the enemy Mainframe to win. Good luck!',
      ]
      for (const text of intro)
        localEvents.value.push({ tick: gameStore.tick, text, type: 'system' })
    }
  } catch {
    // localStorage unavailable (private mode / SSR) — skip the intro silently.
  }

  // Keyboard listener for Tab (scoreboard toggle)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
})

onUnmounted(() => {
  unsubOnMessage()
  gameSocket.disconnect()
  gameStore.stopTickCountdown()
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
})

function onKeyDown(e: KeyboardEvent) {
  const target = e.target as HTMLElement
  // Pure routing (unit-tested in gameKeys); this only dispatches the side effect.
  const action = routeGameKey(e.key, {
    isInputFocused: target.tagName === 'INPUT' || target.tagName === 'TEXTAREA',
    overlayOpen: showShop.value || showScoreboard.value,
    inCmdInput: !!target.closest('.cmd-input-wrapper'),
  })
  if (action.type === 'none') return
  e.preventDefault()
  switch (action.type) {
    case 'closeOverlay':
      showShop.value = false
      showScoreboard.value = false
      break
    case 'autocomplete':
      break // CommandInput owns autocomplete; we just suppressed the default Tab
    case 'showScoreboard':
      showScoreboard.value = true
      break
    case 'toggleShop':
      showShop.value = !showShop.value
      break
    case 'quickAbility':
      handleQuickAction(action.key)
      break
    case 'useItem':
      handleItemUseBySlot(action.index)
      break
    case 'move':
      handleArrowMove(action.direction)
      break
  }
}

function handleArrowMove(direction: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight') {
  const p = gameStore.player
  if (!p) return

  const playerZone = ZONE_MAP[p.zone]
  if (!playerZone || !playerZone.adjacentTo.length) return

  // Pick the adjacent zone in the pressed direction — pure heuristic extracted
  // to a unit-tested util (arrowTargetZone) so the keyboard mapping is covered
  // independently of this component.
  const targetZone = arrowTargetZone(direction, playerZone.adjacentTo)

  // No blind fallback: if no adjacent zone clearly lies in the pressed
  // direction, do nothing rather than shoving the hero into an arbitrary
  // adjacent zone (often the wrong way, into danger). The map click + `move
  // <zone>` command remain the precise paths.
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

// ── Game-feel: impact keys (bumped to replay one-shot animations) ──
const heroFlashKey = ref(0) // I took damage → red flash on the hero panel
const kdaPopKey = ref(0) // I got a kill → KDA pop
const tickPulseKey = ref(0) // each tick → reveal flash in the Tick Theater
const deathVignetteKey = ref(0) // I died → instant red vignette pulse (on the event)

// The most recent server announcement (rejected-action feedback), shown by the
// transient AnnouncementToast and retriggered via gameStore.announcementSeq.
const latestAnnouncement = computed(() => gameStore.announcements.at(-1) ?? '')

// Floating combat numbers for damage involving the local player. Each entry
// rises + fades once (DamageFloat.vue) and is pruned after the animation.
const damageFloats = ref<DamageFloatEntry[]>([])
let _floatId = 0
function pushDamageFloat(amount: number, kind: 'taken' | 'dealt' | 'heal') {
  if (!amount || amount <= 0) return
  const id = ++_floatId
  damageFloats.value = [...damageFloats.value, { id, amount: Math.round(amount), kind }].slice(-8)
  setTimeout(() => {
    damageFloats.value = damageFloats.value.filter((f) => f.id !== id)
  }, 750)
}

const screenShake = ref<'none' | 'light' | 'strong'>('none')
let shakeTimer: ReturnType<typeof setTimeout> | null = null
function triggerShake(level: 'light' | 'strong') {
  if (shakeTimer) clearTimeout(shakeTimer)
  // re-trigger by going none → level on next frame
  screenShake.value = 'none'
  requestAnimationFrame(() => {
    screenShake.value = level
    shakeTimer = setTimeout(
      () => {
        screenShake.value = 'none'
      },
      level === 'strong' ? 600 : 400,
    )
  })
}

// On each new tick: play the tick sound and flush any command the player
// pre-typed while waiting (buffered client-side, sent now that they can act).
// Dying closes the shop/scoreboard overlays (z-30) that would otherwise hide
// the death screen (z-20), and the shop is non-functional while dead anyway.
watch(
  () => gameStore.isAlive,
  (alive) => {
    if (!alive) {
      showShop.value = false
      showScoreboard.value = false
    }
  },
)

watch(
  () => gameStore.tick,
  () => {
    playSound('tick')
    // Reveal beat: bump the pulse key so the Theater header flashes as the
    // tick's resolution lands.
    tickPulseKey.value++
    const buffered = gameStore.consumeBufferedCommand()
    if (buffered) {
      handleCommand(buffered)
    }
  },
)

// Watch game events for audio cues + shake. Keyed on the store's monotonic
// eventSeq (not events.length, which freezes at the 200-event cap and would
// stop firing mid-game); the newest batch is read from latestEvents.
watch(
  () => gameStore.eventSeq,
  () => {
    const newEvents = gameStore.latestEvents
    const pid = gameStore.playerId
    if (!pid) return

    for (const e of newEvents) {
      switch (e.type) {
        case 'damage':
          if (e.payload.targetId === pid) {
            playSound('damage')
            triggerShake('light')
            heroFlashKey.value++
            pushDamageFloat(Number(e.payload.amount), 'taken')
          } else if (e.payload.sourceId === pid) {
            playSound('damage')
            pushDamageFloat(Number(e.payload.amount), 'dealt')
          }
          break
        case 'heal':
          // Self-heals get a teal +N float so regen / lifesteal / heal abilities
          // read as feedback, not just a silent HP bump.
          if (e.payload.targetId === pid) {
            pushDamageFloat(Number(e.payload.amount), 'heal')
          }
          break
        case 'death':
          if (e.payload.playerId === pid) {
            playSound('death')
            triggerShake('strong')
            // Instant red vignette on the EVENT — the "PROCESS TERMINATED" overlay
            // is tied to authoritative isAlive state (a tick_state away), which can
            // lag the event under latency; the vignette confirms death immediately.
            deathVignetteKey.value++
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
            if ([10, 15, 20, 25].includes(e.payload.newLevel as number)) {
              localEvents.value.push({
                tick: e.tick,
                text: `★ Talent unlocked — choose your level ${e.payload.newLevel} talent below`,
                type: 'system',
              })
            }
          }
          break
        case 'kill':
          if (e.payload.killerId === pid) {
            playSound('kill')
            triggerShake('light')
            kdaPopKey.value++
          }
          break
        case 'tower_kill':
          // Audible to everyone — towers are global events
          playSound('tower_fall')
          if (e.payload.killerId === pid) triggerShake('light')
          break
        case 'ability_used':
          // The caster's cast cue now fires immediately on send (handleCommand),
          // so here we only react when WE are the target of an enemy ability.
          if (e.payload.targetId === pid && e.payload.playerId !== pid) {
            triggerShake('light')
            heroFlashKey.value++
          }
          break
      }
    }
  },
)

// ── Derived state ──────────────────────────────────────────────

const currentTick = computed(() => gameStore.tick)

const gameTime = computed(() => formatTickClock(gameStore.tick, true))

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
    if (team === 'radiant') return 'the Radiant Mainframe'
    if (team === 'dire') return 'the Dire Mainframe'
    return `the ${team} Mainframe`
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

// Build the combat log + kill feed from the engine event stream. The big
// per-event switch now lives in combatNarrative (covering all ~33 event types
// with salience), so this is a thin store→context adapter.
const narrativeCtx = computed<NarrativeContext>(() => ({
  playerId: gameStore.playerId,
  myTeam: gameStore.player?.team,
  entityLabel,
  abilityLabel,
  teamOf: (id) => (typeof id === 'string' ? gameStore.allPlayers[id]?.team : undefined),
  heroIdOf: (id) =>
    typeof id === 'string' ? (gameStore.allPlayers[id]?.heroId ?? undefined) : undefined,
  itemName: (id) => ITEMS[id]?.name ?? id,
}))

const combatEvents = computed<CombatLine[]>(() => {
  const lines = buildCombatLines(gameStore.events, narrativeCtx.value, collapseStructureDamage)
  return [...lines, ...localEvents.value].sort((a, b) => a.tick - b.tick)
})

// Cinematic headline plays — first blood, multi-kills, shutdowns, tower/Roshan/Core.
const killFeed = computed<KillFeedEntry[]>(() =>
  deriveKillFeed(gameStore.events, narrativeCtx.value),
)

// Ancients (team cores) live in the game store — shown on the base zones of the map.
const ancients = computed(() => gameStore.ancients)

// ── Tick Theater drama + low-HP danger framing ───────────────────
const THEATER_BAR_WIDTH = 24

/** Wide countdown bar that drains over the 4s tick — the Theater heartbeat. */
const theaterBar = computed(() => {
  const remaining = Math.max(0, Math.min(TICK_DURATION_MS, gameStore.nextTickIn))
  const filled = Math.round((remaining / TICK_DURATION_MS) * THEATER_BAR_WIDTH)
  return '█'.repeat(filled) + '░'.repeat(THEATER_BAR_WIDTH - filled)
})

/** Anticipation: the last ~1s before resolution. */
const tickImminent = computed(() => gameStore.nextTickIn > 0 && gameStore.nextTickIn < 1000)

/** Theater header label: planning vs already-committed-and-waiting. */
const theaterStatus = computed(() => {
  if (!gameStore.isAlive) return 'DOWN'
  return gameStore.canAct ? 'AWAITING ORDERS' : 'RESOLVING'
})

// HUD setting A: 'classic' keeps the combat log in the center stage and the
// map a compact rail widget; 'map-centric' promotes the map to center and
// demotes the log into the rail. The big center grid column is unchanged —
// only its CONTENTS swap — so no grid-template surgery is needed.
const layout = computed(() => settings.hud.layoutMode)

const hpPct = computed(() => {
  const p = gameStore.player
  return p && p.maxHp > 0 ? (p.hp / p.maxHp) * 100 : 100
})
/** Hero panel turns to the danger variant under 30% HP. */
const heroDanger = computed(() => gameStore.isAlive && hpPct.value <= 30)
// Flag the Zone panel red when an enemy hero shares the player's zone.
const zoneDanger = computed(() => gameStore.nearbyEnemies.length > 0)
/** A red vignette pulses over the whole screen under 15% HP. */
const heroCritical = computed(() => gameStore.isAlive && hpPct.value <= 15)

let firstTickLogged = false
const unsubOnMessage = gameSocket.onMessage((msg) => {
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

  // Currently-live runes by zone (spawned but not yet expired).
  const liveRuneByZone = new Map<string, string>()
  for (const r of gameStore.runes) {
    if (r.tick + RUNE_DURATION_TICKS > gameStore.tick) liveRuneByZone.set(r.zone, r.type)
  }

  // Roshan state for the pit (reuses the War Room's tested respawn readout).
  const roshanReadout = gameStore.roshan ? formatRoshan(gameStore.roshan, gameStore.tick) : null

  return ZONES.map((zone) => {
    const fogged = !visibleZoneIds.has(zone.id)

    // Count allies and enemies in this zone
    const allies: string[] = []
    const enemyNames: string[] = []
    let enemyCount = 0

    if (!fogged) {
      for (const p of Object.values(gameStore.allPlayers)) {
        if (p.zone !== zone.id || !p.alive) continue
        if (p.id === gameStore.playerId) continue
        if (p.team === playerTeam) {
          allies.push(p.heroId ?? p.name)
        } else {
          enemyCount++
          enemyNames.push((p.heroId && HEROES[p.heroId]?.name) || p.name)
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

    // Own-team ward coverage here (a ward's zone is always in our vision).
    const wardCount = (gameStore.visibleZones[zone.id]?.wards ?? []).filter(
      (w) => w.team === playerTeam,
    ).length

    // Tower info
    const tower = towersByZone.value.get(zone.id)
    const towerDisplay = tower
      ? {
          team: tower.team,
          alive: tower.alive,
          tier: zone.tier ?? getTowerTier(zone.id),
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
      enemyNames,
      tower: towerDisplay,
      fogged,
      creepCount,
      creepTypes,
      neutralCount,
      wardCount,
      // Vision-gated: a live rune only shows where the player can see it.
      runeType: fogged ? undefined : liveRuneByZone.get(zone.id),
      roshan:
        zone.id === 'roshan-pit' && !fogged && roshanReadout && roshanReadout.status !== 'unknown'
          ? { alive: roshanReadout.status === 'up', respawnIn: roshanReadout.respawnIn }
          : undefined,
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
  gameStore.creeps.filter((c) => c.zone === playerZone.value).map((c, index) => ({ ...c, index })),
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
    p.buybackCooldown && gameStore.tick < p.buybackCooldown ? p.buybackCooldown - gameStore.tick : 0
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
  // A bare `attack` / `atk` auto-targets the lowest-HP enemy hero in your zone
  // (a MOBA right-click) so you don't have to type the full target. Creeps stay
  // explicit (attack creep:N) so auto-target never steals a last-hit.
  const bareCmd = cmd.trim().toLowerCase()
  if (bareCmd === 'attack' || bareCmd === 'atk') {
    const me = gameStore.player
    if (me) {
      const picked = pickAttackTargetString(me, gameStore.allPlayers)
      if ('error' in picked) {
        localEvents.value.push({ tick: gameStore.tick, text: picked.error, type: 'system' })
        return
      }
      cmd = `attack ${picked.target}`
    }
  }
  // A bare `deny` targets the lowest-HP eligible allied creep in your zone, so
  // you can snap-deny an about-to-die creep without hunting for its index.
  if (bareCmd === 'deny') {
    const me = gameStore.player
    if (me) {
      const picked = pickDenyTargetString(me, gameStore.creeps)
      if ('error' in picked) {
        localEvents.value.push({ tick: gameStore.tick, text: picked.error, type: 'system' })
        return
      }
      cmd = `deny ${picked.target}`
    }
  }
  // Pass the player's team so base/fountain resolve to THEIR side of the map.
  const { command, error } = commands.parse(cmd, gameStore.player?.team)
  if (command) {
    // Auto-resolve a missing target for a targeted ability so clicking Q (or the
    // `q` shortcut, or chat `cast q`) doesn't silently reject server-side. We
    // mirror the bot's target selection: lowest-HP enemy in zone for offensive
    // casts, lowest-HP ally/self for supportive, the current zone for AoE.
    if (command.type === 'cast' && !command.target) {
      const caster = gameStore.player
      const ability = caster?.heroId ? HEROES[caster.heroId]?.abilities[command.ability] : undefined
      if (caster && ability) {
        const picked = pickAbilityTargetString(ability, caster, gameStore.allPlayers)
        if ('error' in picked) {
          localEvents.value.push({ tick: gameStore.tick, text: picked.error, type: 'system' })
          return
        }
        if (picked.target) {
          const resolved = commands.parse(
            `cast ${command.ability} ${picked.target}`,
            gameStore.player?.team,
          ).command
          if (resolved?.type === 'cast') command.target = resolved.target
        }
      }
    }
    // Same auto-target for an item active that declares a targetType, so clicking
    // an offensive item (Dagon, Hex, Hurricane Pike) nukes the obvious enemy
    // instead of rejecting with "Must target a hero". Dual-use items have no
    // targetType and still require an explicit target.
    if (command.type === 'use' && !command.target) {
      const user = gameStore.player
      const targetType = ITEMS[command.item]?.active?.targetType
      if (user && targetType) {
        const picked = pickItemTargetString(targetType, user, gameStore.allPlayers)
        if ('error' in picked) {
          localEvents.value.push({ tick: gameStore.tick, text: picked.error, type: 'system' })
          return
        }
        const resolved = commands.parse(
          `use ${command.item} ${picked.target}`,
          gameStore.player?.team,
        ).command
        if (resolved?.type === 'use') command.target = resolved.target
      }
    }
    // Resolve a `talent <tier> left|right` choice to the hero's actual talentId
    // (parse can't — it has no hero context). A full talentId passes through.
    if (
      command.type === 'select_talent' &&
      (command.talentId === 'left' || command.talentId === 'right')
    ) {
      const heroId = gameStore.player?.heroId
      const opts = heroId ? getTalentTree(heroId)?.tiers[command.tier] : undefined
      if (!opts) {
        localEvents.value.push({
          tick: gameStore.tick,
          text: 'No talents available for your hero',
          type: 'system',
        })
        return
      }
      command.talentId = command.talentId === 'left' ? opts[0].id : opts[1].id
    }
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
    // `missing X` is a quick team callout — there's no server enemy_missing
    // emitter, so reuse the team chat channel: allies see the alert immediately.
    if (command.type === 'missing') {
      const enemy = gameStore.allPlayers?.[command.enemyId]
      const name = enemy ? (HEROES[enemy.heroId ?? '']?.name ?? enemy.name) : command.enemyId
      gameSocket.send({ type: 'chat', channel: 'team', message: `⚠ ${name} is MISSING (ss)!` })
      return
    }
    // help: print the command reference locally (one log line per group) and
    // return without sending — purely informational, never a game action.
    if (command.type === 'help') {
      for (const line of formatHelpReadout()) {
        localEvents.value.push({ tick: gameStore.tick, text: line, type: 'system' })
      }
      return
    }
    // status/map/scan are informational: print a readout to the local log and
    // return WITHOUT sending — the server ignores them, so submitting one would
    // silently burn the player's one action this tick.
    if (command.type === 'status' || command.type === 'map' || command.type === 'scan') {
      const me = gameStore.player
      if (me) {
        const text =
          command.type === 'status'
            ? formatStatusReadout(me)
            : command.type === 'map'
              ? formatMapReadout(me)
              : formatScanReadout(me, gameStore.allPlayers)
        localEvents.value.push({ tick: gameStore.tick, text, type: 'system' })
      }
      return
    }
    // Already acted this tick: buffer the command client-side and auto-send
    // it when the next tick arrives (buyback/surrender are special actions
    // the server handles out-of-band, so they always go through directly).
    const isSpecial =
      command.type === 'buyback' || command.type === 'surrender' || command.type === 'select_talent'
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
    // If the socket isn't open (reconnecting), the action never reached the
    // server — don't fake "Action sent". Buffer it so the next tick after we
    // reconnect re-sends it, and tell the player why their input paused.
    const sent = gameSocket.send({ type: 'action', command })
    if (!sent) {
      gameStore.bufferCommand(cmd)
      localEvents.value.push({
        tick: gameStore.tick,
        text: `⚠ Connection unstable — "${cmd}" paused, will retry`,
        type: 'system',
      })
      return
    }
    uiLog.debug('Command sent', { type: command.type })
    gameStore.markActionSent(cmd)
    // Immediate positive confirmation so the action feels registered NOW, not
    // only when the tick resolves ~4s later. Pre-flight validation already gated
    // out rejects above, so this fires only on actions that will resolve; the
    // landing cues (damage floats, target shake) still come from the tick events.
    if (command.type === 'cast' || command.type === 'attack') playSound('cast')
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
      // Don't fail silently — guide the player. From the fountain/base there's
      // nothing to fight; everywhere else, point at creeps + the explicit syntax.
      const zoneType = ZONE_MAP[p.zone]?.type
      const inBase = zoneType === 'fountain' || zoneType === 'base'
      localEvents.value.push({
        tick: gameStore.tick,
        text: inBase
          ? 'No targets here — move to a lane to fight (e.g.  move mid-river ).'
          : 'No enemies in this zone — last-hit creeps in the Zone panel, or  attack <target> .',
        type: 'system',
      })
    }
    return
  }

  // Q/W/E/R — cast ability (accept both upper and lowercase). handleCommand
  // auto-resolves the target; the cast sound fires on the confirmed
  // ability_used event (see the audio watcher) rather than optimistically.
  if (['Q', 'W', 'E', 'R', 'q', 'w', 'e', 'r'].includes(cmd)) {
    handleCommand(`cast ${cmd.toLowerCase()}`)
    return
  }

  handleCommand(cmd.toLowerCase())
}

// Situational actions (ward / deny / aegis / rune / glyph / surrender) were
// command-line only — invisible + unusable on touch. Surface them as on-screen
// buttons, shown only when actually available so the row stays contextual.
// Which contextual actions the player can take now — pure rules extracted to a
// unit-tested util (computeSituationalActions).
const situationalActions = computed(() =>
  computeSituationalActions({
    player: gameStore.player,
    isAlive: gameStore.isAlive,
    creeps: gameStore.creeps,
    aegis: gameStore.aegis,
    runes: gameStore.runes,
    teams: gameStore.teams,
    tick: gameStore.tick,
  }),
)

function runSituational(cmd: string) {
  const p = gameStore.player
  if (!p) return
  if (cmd === 'ward') handleCommand(`ward ${p.zone}`)
  else if (cmd === 'surrender') handleCommand('surrender confirm')
  else handleCommand(cmd) // deny / aegis / rune / glyph — bare commands (auto-resolved)
}

// ── Quick action button availability ─────────────────────────
// Greys out Q/W/E/R when on cooldown or unaffordable so players can see
// at a glance which abilities are actually castable this tick.
const abilityButtonState = computed(() => {
  const p = gameStore.player
  const result: Record<string, { ready: boolean; label: string; aria: string }> = {}
  for (const slot of ['q', 'w', 'e', 'r'] as const) {
    const upper = slot.toUpperCase()
    if (!p || !p.alive || !p.heroId) {
      result[upper] = { ready: false, label: upper, aria: `${upper}, unavailable` }
      continue
    }
    const name = HEROES[p.heroId]?.abilities[slot]?.name ?? upper
    const cd = p.cooldowns[slot]
    if (cd > 0) {
      result[upper] = {
        ready: false,
        label: `${upper}·${cd}`,
        aria: `${upper} ${name}, on cooldown ${cd} ticks`,
      }
      continue
    }
    const ability = HEROES[p.heroId]?.abilities[slot]
    if (ability && p.mp < ability.manaCost) {
      result[upper] = { ready: false, label: upper, aria: `${upper} ${name}, not enough mana` }
      continue
    }
    result[upper] = { ready: true, label: upper, aria: `${upper} ${name}, ready` }
  }
  return result
})

// Accessible name + toggle state for the quick-action bar buttons (#14).
function quickActionAria(cmd: string): string {
  if (cmd === 'Q' || cmd === 'W' || cmd === 'E' || cmd === 'R') {
    return abilityButtonState.value[cmd]?.aria ?? cmd
  }
  const labels: Record<string, string> = {
    ATK: 'Attack nearest enemy',
    MOVE: 'Move',
    SHOP: 'Toggle shop',
    SCORE: 'Toggle scoreboard',
  }
  return labels[cmd] ?? cmd
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
    :mode="gameStore.mode"
    :mmr-change="gameStore.gameOverMmrChange ?? undefined"
    @play-again="handlePlayAgain"
    @return-to-menu="handleReturnToMenu"
  />

  <!-- Active Game Screen -->
  <div
    v-else
    class="game-grid relative bg-bg-primary"
    :class="{
      'anim-shake': screenShake === 'light',
      'anim-shake-strong': screenShake === 'strong',
    }"
    data-testid="game-screen"
    :data-game-id="gameStore.gameId ?? ''"
    :data-layout="layout"
    :data-density="settings.hud.density"
    :data-vitals="settings.hud.emphasizeVitals ? 'on' : 'off'"
  >
    <!-- Floating combat numbers (rise + fade on damage involving you) -->
    <DamageFloat :floats="damageFloats" />

    <!-- Transient action-feedback toast: surfaces server rejections (out of
         range, juked target, firewalled Ancient, not enough mana, …) that would
         otherwise die silently in the store -->
    <AnnouncementToast
      :text="latestAnnouncement"
      :seq="gameStore.announcementSeq"
      :level="gameStore.lastAnnouncementLevel"
    />

    <!-- Instant death vignette pulse, fired on the death EVENT (the overlay below
         waits for authoritative isAlive state, which can lag under latency) -->
    <div
      v-if="deathVignetteKey > 0"
      :key="deathVignetteKey"
      class="anim-death-vignette pointer-events-none absolute inset-0 z-40"
      aria-hidden="true"
    />

    <div
      v-if="!gameStore.isAlive && gameStore.player"
      class="death-overlay"
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
        <!-- Dead players can still vote to surrender a lost game (the overlay
             otherwise covers the command input). Server validates timing/threshold. -->
        <button
          data-testid="death-surrender-button"
          class="mt-5 border border-border px-4 py-1.5 font-mono text-xs text-text-dim transition-colors hover:border-dire hover:text-dire active:scale-95"
          @click="handleCommand('surrender confirm')"
        >
          [VOTE TO SURRENDER]
        </button>
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

    <!-- Kill feed: cinematic headline plays overlaid near the top -->
    <KillFeed class="game-grid__killfeed" :entries="killFeed" :current-tick="currentTick" />

    <!-- Critical-HP red vignette pulse over the whole screen -->
    <div
      v-if="heroCritical"
      class="critical-vignette anim-glow-pulse pointer-events-none absolute inset-0 z-[15]"
      aria-hidden="true"
    />

    <div class="game-grid__bar">
      <GameStateBar
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
        :teams="gameStore.teams"
        :ancients="ancients"
        :net-worth-radiant="gameStore.netWorth.radiant"
        :net-worth-dire="gameStore.netWorth.dire"
        :kda-pop-key="kdaPopKey"
      />

      <!-- Tutorial banner: current step's hint + the staggered-unlock checklist -->
      <TutorialHint v-if="gameStore.mode === 'tutorial'" :step="gameStore.tutorialStep ?? 0" />

      <!-- Action-focus banner (HUD setting B): at-a-glance threat + what to do -->
      <FocusBanner v-if="settings.hud.focusBanner" />
    </div>

    <!-- Left column: current-zone tactics (top) + strategic War Room (below).
         Zone lives here — not the right rail — so it can't be squeezed to zero
         height between the fixed-size Hero Status and Map panels. It is capped
         (max-h) + shrink-0 so a busy zone scrolls internally instead of starving
         the War Room, and a quiet zone stays compact. -->
    <div class="game-grid__war flex min-h-0 flex-col gap-1">
      <TerminalPanel
        :title="`Zone: ${currentZoneName}`"
        :variant="zoneDanger ? 'danger' : 'default'"
        class="max-h-[45%] shrink-0"
      >
        <ZonePanel
          :zone-name="currentZoneName"
          :zone-id="playerZone"
          :player-team="gameStore.player?.team ?? 'radiant'"
          :enemies="gameStore.nearbyEnemies"
          :allies="gameStore.nearbyAllies"
          :creeps="zoneCreeps"
          :neutrals="zoneNeutrals"
          :tower="zoneTower"
          @command="handleCommand"
        />
      </TerminalPanel>
      <TerminalPanel title="War Room" class="game-grid__warroom min-h-0 flex-1">
        <WarRoom />
      </TerminalPanel>
    </div>

    <!-- Center stage. Classic: the combat narrative is the centerpiece.
         Map-centric: the tactical map takes the center, full-size. -->
    <TerminalPanel
      :title="layout === 'map-centric' ? 'Tactical Map' : 'Combat Log'"
      class="game-grid__log min-h-0"
    >
      <TickTheater
        v-if="layout === 'classic'"
        :events="combatEvents"
        :status="theaterStatus"
        :bar="theaterBar"
        :tick-imminent="tickImminent"
        :next-tick-in="gameStore.nextTickIn"
        :is-alive="gameStore.isAlive"
        :can-act="gameStore.canAct"
        :pulse-key="tickPulseKey"
      />
      <div v-else class="h-full min-h-0 overflow-auto" data-testid="center-map">
        <AsciiMap
          :zones="mapZones"
          :player-zone="playerZone"
          :ancients="ancients"
          :map-id="gameStore.mapId"
          force-mode="full"
          @zone-click="handleZoneClick"
        />
      </div>
    </TerminalPanel>

    <!-- Right rail: hero status + compact map (classic) or the
         demoted combat-log ticker (map-centric). -->
    <div class="game-grid__rail flex min-h-0 flex-col gap-1 overflow-y-auto">
      <TerminalPanel
        title="Hero Status"
        :variant="heroDanger ? 'danger' : 'default'"
        class="shrink-0"
      >
        <div class="relative">
          <!-- Damage flash: a stateless keyed overlay so HeroStatus (and its
               canvas avatar + open tooltips) is NOT remounted on every hit. -->
          <div
            :key="heroFlashKey"
            class="anim-flash pointer-events-none absolute inset-0 z-10"
            aria-hidden="true"
          />
          <HeroStatus
            v-if="heroData"
            :hero="heroData"
            :hero-id="gameStore.player?.heroId ?? undefined"
            @cast-ability="handleQuickAction"
          />
          <div v-else class="p-2 text-[0.8rem] text-text-dim">&gt;_ awaiting hero data...</div>
        </div>
      </TerminalPanel>

      <!-- Classic: compact map in the rail. Map-centric: the map is in the
           center, so the rail carries the demoted combat-log ticker. -->
      <TerminalPanel v-if="layout === 'classic'" title="Map" class="shrink-0">
        <AsciiMap
          :zones="mapZones"
          :player-zone="playerZone"
          :ancients="ancients"
          :map-id="gameStore.mapId"
          force-mode="compact"
          @zone-click="handleZoneClick"
        />
      </TerminalPanel>
      <TerminalPanel v-else title="Combat Log" class="min-h-[8rem] flex-1" data-testid="rail-log">
        <TickTheater
          :events="combatEvents"
          :status="theaterStatus"
          :bar="theaterBar"
          :tick-imminent="tickImminent"
          :next-tick-in="gameStore.nextTickIn"
          :is-alive="gameStore.isAlive"
          :can-act="gameStore.canAct"
          :pulse-key="tickPulseKey"
        />
      </TerminalPanel>
    </div>

    <!-- Scoreboard overlay (Tab hold on desktop, SCORE button on mobile) -->
    <div
      v-if="showScoreboard && gameStore.teams"
      class="absolute inset-0 z-30 flex items-center justify-center bg-bg-overlay/80 p-2 anim-fade-in-up"
      data-testid="scoreboard-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Scoreboard"
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
    <div
      v-if="showShop"
      class="absolute inset-0 z-30 flex items-center justify-center bg-bg-overlay/80"
      role="dialog"
      aria-modal="true"
      aria-label="Item shop"
      @click.self="showShop = false"
    >
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
          :recommended-items="recommendedShopItems"
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
          v-if="pinnedItems.length || recommendedShopItems.length"
          :pinned-items="pinnedItems"
          :gold="playerGold"
          :can-buy="gameStore.canBuy"
          :recommended-items="recommendedShopItems"
          @buy="handleBuyItem"
          @unpin="unpinItem"
        />
        <button
          class="ml-auto whitespace-nowrap border border-border bg-bg-secondary px-2 py-1 font-mono text-[0.7rem] text-gold hover:text-text-primary active:bg-border"
          :class="{ 'border-gold': gameStore.canBuy }"
          title="Shop (S)"
          aria-label="Toggle shop"
          :aria-pressed="showShop"
          @click="showShop = !showShop"
        >
          [SHOP]
        </button>
      </div>
      <div class="flex gap-1 overflow-x-auto px-2 py-1.5">
        <button
          v-for="cmd in ['ATK', 'Q', 'W', 'E', 'R', 'MOVE', 'SHOP', 'SCORE']"
          :key="cmd"
          class="hud-action-btn min-h-[40px] min-w-[44px] whitespace-nowrap border border-border bg-bg-secondary px-2.5 py-1.5 font-mono text-[0.75rem] font-bold text-text-primary transition-all active:bg-border active:scale-95"
          :class="{
            'border-gold text-gold': cmd === 'SHOP' && gameStore.canBuy,
            'border-ability text-ability shadow-glow-ability':
              ['Q', 'W', 'E', 'R'].includes(cmd) && abilityButtonState[cmd]?.ready,
            'cursor-not-allowed border-border/50 text-text-dim opacity-50':
              ['Q', 'W', 'E', 'R'].includes(cmd) && !abilityButtonState[cmd]?.ready,
            'border-self text-self': cmd === 'SCORE',
          }"
          :aria-label="quickActionAria(cmd)"
          :aria-disabled="
            ['Q', 'W', 'E', 'R'].includes(cmd) && !abilityButtonState[cmd]?.ready
              ? 'true'
              : undefined
          "
          :aria-pressed="cmd === 'SHOP' ? showShop : cmd === 'SCORE' ? showScoreboard : undefined"
          @click="handleQuickAction(cmd)"
        >
          {{ ['Q', 'W', 'E', 'R'].includes(cmd) ? abilityButtonState[cmd]?.label : cmd }}
        </button>
      </div>
      <!-- Situational actions — surfaced as buttons only when available, so the
           command-only verbs (ward/deny/aegis/rune/glyph/surrender) are usable
           on touch and discoverable to new players. -->
      <div
        v-if="situationalActions.length"
        class="flex flex-wrap gap-1 px-2 pb-1.5"
        data-testid="situational-actions"
      >
        <button
          v-for="a in situationalActions"
          :key="a.cmd"
          class="hud-action-btn min-h-[36px] whitespace-nowrap border border-ability/40 bg-bg-secondary px-2 py-1 font-mono text-[0.68rem] text-ability transition-all active:bg-border active:scale-95"
          :data-testid="`situational-${a.cmd}`"
          :aria-label="a.aria"
          @click="runSituational(a.cmd)"
        >
          {{ a.label }}
        </button>
      </div>
      <TalentPicker
        :player="gameStore.player"
        @pick="(tier, side) => handleCommand(`talent ${tier} ${side}`)"
      />
      <CommandInput
        placeholder="Enter command — type help for the list (Tab to autocomplete)"
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
/* Desktop: three columns — Zone + War Room (left) | Tick Theater / combat log
   (center, the focal surface) | hero+map/log rail (right). The log is now the
   largest single panel; the near-static map is demoted to a compact rail widget. */
.game-grid {
  display: grid;
  grid-template-columns: minmax(190px, 2.4fr) minmax(0, 5fr) minmax(244px, 3.3fr);
  grid-template-rows: auto 1fr auto;
  gap: 2px;
  overflow: hidden;
  /* dvh tracks the real visible height on mobile (URL bar collapse); vh is the fallback */
  height: 100vh;
  height: 100dvh;
}

.game-grid > * {
  min-width: 0;
}

.game-grid__bar {
  grid-column: 1 / -1;
  grid-row: 1;
  overflow: hidden;
}
.game-grid__war {
  grid-column: 1;
  grid-row: 2;
}
.game-grid__log {
  grid-column: 2;
  grid-row: 2;
}
.game-grid__rail {
  grid-column: 3;
  grid-row: 2;
}
.game-grid__cmd {
  grid-column: 1 / -1;
  grid-row: 3;
}

/* ── HUD setting C: density + emphasize-vitals ────────────────────────────
   Both default to off (comfortable / vitals='off'), reproducing today's look.
   Compact tightens the gaps so more fits on screen (safe at every breakpoint).
   Emphasize-vitals dims the strategic War Room and enlarges the action bar so
   the eye lands on HP / abilities; the column-widening only applies on desktop
   (min-width:1025px) so it never fights the responsive mobile templates. */
.game-grid[data-density='compact'] {
  gap: 0;
}

/* Dim only the strategic War Room — never the Zone panel above it, which carries
   the tutorial-critical last-hit / attack affordances and must stay legible. */
.game-grid[data-vitals='on'] .game-grid__warroom {
  opacity: 0.6;
  transition: opacity 0.15s;
}
.game-grid[data-vitals='on'] .game-grid__warroom:hover {
  opacity: 1;
}
.game-grid[data-vitals='on'] .hud-action-btn {
  min-height: 52px;
  font-size: 0.95rem;
}

@media (min-width: 1025px) {
  /* Give the hero/ability rail more room, taken from the War Room column. */
  .game-grid[data-vitals='on'] {
    grid-template-columns: minmax(150px, 1.7fr) minmax(0, 4.6fr) minmax(290px, 3.8fr);
  }
}

/* Kill feed floats over the top-center, below the bar. */
.game-grid__killfeed {
  position: absolute;
  top: 4.25rem;
  left: 50%;
  transform: translateX(-50%);
  z-index: 25;
  width: max-content;
  max-width: 92%;
}

.death-overlay {
  position: absolute;
  inset: 0;
  z-index: 20;
  background: rgb(var(--bg-overlay) / 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
}

@media (max-width: 1024px) {
  /* Tablet: combat log spans full width as the primary surface; Zone + War Room
     share the left column beneath it, while hero/map live in the right rail. */
  .game-grid {
    grid-template-columns: 1fr 1fr;
    grid-template-rows: auto minmax(220px, 1.7fr) minmax(170px, 1fr) auto;
  }
  .game-grid__bar {
    grid-column: 1 / -1;
    grid-row: 1;
  }
  .game-grid__log {
    grid-column: 1 / -1;
    grid-row: 2;
  }
  .game-grid__war {
    grid-column: 1;
    grid-row: 3;
  }
  .game-grid__rail {
    grid-column: 2;
    grid-row: 3;
  }
  .game-grid__cmd {
    grid-column: 1 / -1;
    grid-row: 4;
  }
}

@media (max-width: 640px) {
  /* Phone: single column, log still primary directly under the bar; hero/map
     rail stacks above the Zone + War Room column, each scrolling internally. */
  .game-grid {
    grid-template-columns: 1fr;
    grid-template-rows:
      auto minmax(200px, 1.9fr) minmax(120px, 1.1fr)
      minmax(170px, 1fr) auto;
    gap: 1px;
  }
  .game-grid__bar {
    grid-column: 1;
    grid-row: 1;
  }
  .game-grid__log {
    grid-column: 1;
    grid-row: 2;
  }
  .game-grid__rail {
    grid-column: 1;
    grid-row: 3;
  }
  .game-grid__war {
    grid-column: 1;
    grid-row: 4;
  }
  .game-grid__cmd {
    grid-column: 1;
    grid-row: 5;
  }
}
</style>
