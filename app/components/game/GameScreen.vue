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
import { ZONE_MAP } from '~~/shared/constants/zones'
import { WAVE_UNIT_LABELS, type WaveRole } from '~~/shared/constants/world'
import { zonesForMap } from '~~/shared/constants/maps'
import { buildAdjacentZones } from '~/components/game/asciiMapModel'
import { HEROES } from '~~/shared/constants/heroes'
import { recommendedItemsForRole } from '~~/shared/constants/itemBuilds'
import { ITEMS, ITEM_CATEGORIES, DEFAULT_QUICKBUY_ITEMS } from '~~/shared/constants/items'
import type { ItemCategoryId } from '~~/shared/types/items'
import { getTalentTree } from '~~/shared/constants/talents'
import type { IceState } from '~~/shared/types/game'
import { uiLog } from '~/utils/logger'
import { collapseStructureDamage, type CombatLine } from '~/utils/combatLog'
import {
  buildCombatLines,
  deriveKillFeed,
  type NarrativeContext,
  type KillFeedEntry,
} from '~/utils/combatNarrative'
import {
  TICK_DURATION_MS,
  CACHE_DURATION_TICKS,
  ULTIMATE_UNLOCK_LEVEL,
  getAbilityLevel,
} from '~~/shared/constants/balance'
import { pathDistance } from '~~/shared/pathfinding'
import { formatTenant, ticksToClock } from '~/utils/strategy'
import { arrowTargetZone } from '~/utils/arrowMove'
import { computeSituationalActions } from '~/utils/situationalActions'
import { routeGameKey } from '~/utils/gameKeys'
import { getAbilityManaCost } from '~~/shared/utils/ability'
import { isTutorialComplete } from '~~/shared/constants/tutorial'

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

// Item → category lookup against the real five-class partition (ITEM_CATEGORIES)
// — the shop must not invent its own grouping (the old cost/consumable ladder
// said nothing about what an item IS, and /items already reads this map).
const ITEM_CATEGORY_BY_ID: ReadonlyMap<string, ItemCategoryId> = new Map(
  ITEM_CATEGORIES.flatMap((c) => c.ids.map((id) => [id, c.id] as const)),
)

// Format items from registry as ShopItem[] for ItemShop component
const shopItems = computed(() => {
  return Object.values(ITEMS).map((item) => ({
    id: item.id,
    name: item.name,
    cost: item.cost,
    def: item,
    category: ITEM_CATEGORY_BY_ID.get(item.id) ?? 'street',
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

// `canBuy` is false for two unrelated reasons — wrong zone, or dead — and the
// shop only ever named the first, so a corpse was told to walk somewhere it
// cannot walk. Buying while dead stays unsupported (the server's buy/sell path
// requires a shop zone, and a dead hero's zone is wherever it fell), so the
// honest fix is to say so rather than to pretend the zone is the problem.
const shopBlockedReason = computed(() =>
  gameStore.isAlive
    ? 'You must be in the fountain or base zone to purchase items.'
    : 'You cannot buy while dead — wait for respawn, or buy back to return now.',
)

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
        'Welcome to TERMINA — the city commits every four seconds. You queue ONE instruction per cycle.',
        'You start in the fountain. Move to a lane: type or tap  move mid-river',
        'Last-hit enemy waves (≈<50% HP) for gold — tap the wave group in the Zone panel.',
        'In the fountain/base click [SHOP] (or press Esc, then S) to buy; tap Q/W/E/R below to cast.',
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

  // Reloading mid-death still owes a respawn cue; the watcher below only sees
  // transitions, and this one already happened.
  awaitingRespawn = gameStore.player != null && !gameStore.isAlive

  measureBar()
})

onUnmounted(() => {
  unsubOnMessage()
  gameSocket.disconnect()
  gameStore.stopTickCountdown()
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  barObserver?.disconnect()
})

// ── HUD lane geometry ─────────────────────────────────────────
// The kill feed and the announcement toast are absolutely positioned overlays
// with hardcoded top offsets that landed on the state bar and the focus banner —
// i.e. on top of the always-on HUD, whose height changes with the tutorial
// banner, the focus banner and the emphasize-vitals setting. Measure the bar and
// publish it as a custom property the overlay lanes are anchored to.
const barEl = ref<HTMLElement | null>(null)
const hudBarHeight = ref(0)
let barObserver: ResizeObserver | null = null

const hudBarStyle = computed(() =>
  hudBarHeight.value > 0 ? { '--hud-bar-h': `${hudBarHeight.value}px` } : {},
)

function measureBar() {
  const el = barEl.value
  if (!el) return
  // No ResizeObserver (older browsers, SSR-ish environments): a single
  // post-mount read still beats the hardcoded offset.
  if (typeof ResizeObserver === 'undefined') {
    hudBarHeight.value = el.offsetHeight
    return
  }
  barObserver = new ResizeObserver((entries) => {
    const h = entries[0]?.contentRect.height ?? 0
    if (h > 0) hudBarHeight.value = h
  })
  barObserver.observe(el)
}

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
    case 'focusPrompt':
      commandInputRef.value?.focus()
      break
  }
}

const commandInputRef = ref<{ focus: () => void } | null>(null)

/** Arrows resolve against the drawn grid, so the miss is reported in its terms. */
const ARROW_WORD: Record<'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight', string> = {
  ArrowUp: 'above',
  ArrowDown: 'below',
  ArrowLeft: 'left of',
  ArrowRight: 'right of',
}

function handleArrowMove(direction: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight') {
  const p = gameStore.player
  if (!p) return

  const playerZone = ZONE_MAP[p.zone]
  if (!playerZone || !playerZone.adjacentTo.length) return

  // Pick the adjacent zone in the pressed direction. The map id matters: the
  // util resolves against the layout the player is looking at, and the subset
  // maps prune zones this adjacency list still names.
  const targetZone = arrowTargetZone(direction, p.zone, playerZone.adjacentTo, gameStore.mapId)

  // No blind fallback: if no adjacent zone clearly lies in the pressed
  // direction, do nothing rather than shoving the hero into an arbitrary
  // adjacent zone (often the wrong way, into danger). The map click + `move
  // <zone>` command remain the precise paths. Say so, though — silence is
  // indistinguishable from the hotkey itself being dead, which it used to be.
  if (targetZone) {
    handleCommand(`move ${targetZone}`)
  } else {
    localEvents.value.push({
      tick: gameStore.tick,
      text: `No zone ${ARROW_WORD[direction]} ${playerZone.name} — click a zone on the map or type move <zone>`,
      type: 'system',
    })
  }
}

function onKeyUp(e: KeyboardEvent) {
  if (e.key === 'Tab') {
    e.preventDefault()
    showScoreboard.value = false
  }
}

// ── Audio cues + impact feedback ───────────────────────────────

// ── Game-feel: impact keys (bumped to replay one-shot animations) ──
const heroFlashKey = ref(0) // I took damage → red flash on the hero panel
const kdaPopKey = ref(0) // I got a kill → KDA pop
const tickPulseKey = ref(0) // each tick → reveal flash in the Tick Theater
const deathVignetteKey = ref(0) // I died → instant red vignette pulse (on the event)
const respawnKey = ref(0) // I respawned → one-shot chaff vignette
let awaitingRespawn = false
// Game-end climax: a one-shot team-colored flash + victory/defeat stinger.
const endFlashKey = ref(0)
const endFlashType = ref<'victory' | 'defeat' | null>(null)

// The most recent server announcement (rejected-action feedback), shown by the
// transient AnnouncementToast and retriggered via gameStore.announcementSeq.
const latestAnnouncement = computed(() => gameStore.announcements.at(-1) ?? '')

// Floating combat numbers for damage involving the local player. Each entry
// rises + fades once (DamageFloat.vue) and is pruned after the animation.
const damageFloats = ref<DamageFloatEntry[]>([])
let _floatId = 0

/** What happens to you rises over your vitals; what you do, over the zone. */
const FLOAT_ANCHOR: Record<DamageFloatEntry['kind'], 'self' | 'target'> = {
  taken: 'self',
  heal: 'self',
  dealt: 'target',
  gold: 'target',
}

function pushDamageFloat(amount: number, kind: DamageFloatEntry['kind']) {
  if (!amount || amount <= 0) return
  const id = ++_floatId
  damageFloats.value = [
    ...damageFloats.value,
    { id, amount: Math.round(amount), kind, anchor: FLOAT_ANCHOR[kind] },
  ].slice(-8)
  setTimeout(() => {
    damageFloats.value = damageFloats.value.filter((f) => f.id !== id)
  }, 750)
}

const selfFloats = computed(() => damageFloats.value.filter((f) => f.anchor === 'self'))
const targetFloats = computed(() => damageFloats.value.filter((f) => f.anchor !== 'self'))

// How hard the last hit landed, as a fraction of max HP, driving the flash and
// impact alpha: a wave chip and a full combo used to paint identically.
const hitIntensity = ref(1)

function hitStrength(amount: number, maxHp: number): number {
  if (!(maxHp > 0)) return 0.5
  return Math.min(1, Math.max(0.25, (amount / maxHp) * 3))
}

// A hit used to translate the ENTIRE 100dvh grid root — including the command
// input the player is reading and typing into — which also exposed the body
// background as a flickering band at the edges. The punch is now a colored
// inset flare on a transparent overlay: nothing that carries text moves.
const impactKey = ref(0)
const impactLevel = ref<'light' | 'strong'>('light')
let lastImpactAt = 0
/** Multiple hits land in the same tick; without a floor they retrigger the
 *  flare on top of itself and it reads as a strobe rather than as impact. */
const IMPACT_RETRIGGER_MS = 250

function triggerImpact(level: 'light' | 'strong') {
  const now = Date.now()
  if (level === 'light' && now - lastImpactAt < IMPACT_RETRIGGER_MS) return
  lastImpactAt = now
  impactLevel.value = level
  impactKey.value++
}

/** Taking damage: the localized panel flash, the screen flare, and the number. */
function registerHit(amount: number) {
  hitIntensity.value = hitStrength(amount, gameStore.player?.maxHp ?? 0)
  heroFlashKey.value++
  triggerImpact('light')
}

// The destination the player last ordered. The server nulls `moveTarget` on the
// arriving hop (ActionResolver) and strips it from enemy views entirely, so the
// last leg of a walk — and every single-hop move — is invisible without a local
// memory of the order. It is also what gates the arrival line: narrating any
// zone change would double-print teleports and fire on every respawn.
const walkTarget = ref<string | null>(null)

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
      // Death cancels the walk server-side too (GameLoop nulls moveTarget), and
      // respawn relocates you to the fountain — a surviving order would narrate
      // that jump as progress toward a destination you abandoned.
      walkTarget.value = null
      awaitingRespawn = true
      return
    }
    // Coming back was a UI element silently disappearing. Gated on an actual
    // death: the store reports "not alive" until the first tick_state lands, so
    // an ungated rising edge would fire the cue on every game load.
    if (!awaitingRespawn) return
    awaitingRespawn = false
    playSound('respawn')
    respawnKey.value++
    localEvents.value.push({
      tick: gameStore.tick,
      text: '>_ PROCESS RESTORED — you are back in the fight',
      type: 'system',
    })
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

// Auto-path walk feedback: each hop prints where you are and how far is left,
// so a multi-zone order reads as progress instead of silence, and arrival is
// announced rather than the feed simply going quiet.
watch(
  () => gameStore.player?.zone,
  (zone, oldZone) => {
    const p = gameStore.player
    if (!p || !zone || !oldZone || zone === oldZone) return
    const target = p.moveTarget ?? walkTarget.value
    if (!target) return
    if (zone === target) {
      walkTarget.value = null
      localEvents.value.push({
        tick: gameStore.tick,
        text: `▸ You arrive at ${ZONE_MAP[zone]?.name ?? zone}`,
        type: 'system',
      })
      return
    }
    // Fog can leave the destination unreachable through known zones (-1); say
    // nothing then rather than inventing a distance.
    const remaining = pathDistance(zone, target, (id) => !!gameStore.visibleZones[id])
    if (remaining > 0) {
      localEvents.value.push({
        tick: gameStore.tick,
        text: `▸ You reach ${ZONE_MAP[zone]?.name ?? zone} — ${remaining} more to ${ZONE_MAP[target]?.name ?? target}`,
        type: 'system',
      })
    }
  },
)

// Watch game events for audio cues + impact. Keyed on the store's monotonic
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
            registerHit(Number(e.payload.amount))
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
            triggerImpact('strong')
            // Instant red vignette on the EVENT — the "PROCESS TERMINATED" overlay
            // is tied to authoritative isAlive state (a tick_state away), which can
            // lag the event under latency; the vignette confirms death immediately.
            deathVignetteKey.value++
          }
          break
        // Farming — the loop the player spends most of the match in. The gold
        // cue used to hang off `gold_change`, whose only emitter is a win
        // sentinel carrying an empty playerId, so last-hitting was silent.
        case 'wave_strip':
        case 'wave_burn':
          if (e.payload.playerId === pid) {
            playSound('gold')
            pushDamageFloat(Number(e.payload.goldAwarded), 'gold')
          }
          break
        case 'neutral_killed':
          // The camp's bounty is not on the wire, so the cue carries no number.
          if (e.payload.playerId === pid) playSound('gold')
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
            triggerImpact('light')
            kdaPopKey.value++
          } else if (Array.isArray(e.payload.assisters) && e.payload.assisters.includes(pid)) {
            // An assist moves your KDA and your gold; it was the one scoring
            // event with no feedback at all. No flare — you did not land it.
            playSound('kill')
            kdaPopKey.value++
          }
          break
        case 'ice_kill': {
          // `killerId` was tested here, a field IceKillEvent has never had, so
          // every ice read identically regardless of whose it was.
          const myTeam = gameStore.player?.team
          if (myTeam && e.payload.team === myTeam) {
            playSound('ice_lost')
            const where = zoneLabel(String(e.payload.zone))
            gameStore.addAnnouncement(`Ice lost — ${where}`, 'warning')
          } else {
            // Audible to everyone — ice are global events.
            playSound('ice_fall')
            if (myTeam && e.payload.killerTeam === myTeam) triggerImpact('light')
          }
          break
        }
        case 'ability_used':
          // The caster's cast cue now fires immediately on send (handleCommand),
          // so here we only react when WE are the target of an enemy ability.
          if (e.payload.targetId === pid && e.payload.playerId !== pid) {
            hitIntensity.value = 0.5
            heroFlashKey.value++
            triggerImpact('light')
          }
          break
        case 'double_cast':
          // Tier-25 exotic proc — a satisfying cue when MY ability fires twice.
          if (e.payload.playerId === pid) {
            playSound('double_cast')
          }
          break
      }
    }
  },
)

// Game-end climax: the win/loss moment gets its own juice — a team-colored
// full-screen flash, a strong flare, and a victory/defeat stinger. PostGame
// provides the screen; this provides the instantaneous punch the fade-in alone
// lacks. Keyed on (ended && winner) so it survives either the tick_state phase
// or the game_over message arriving first, and re-arms when the game resets.
watch(
  () => gameStore.phase === 'ended' && gameStore.winner != null,
  (ended) => {
    if (!ended) return
    const won = gameStore.player?.team != null && gameStore.player.team === gameStore.winner
    endFlashType.value = won ? 'victory' : 'defeat'
    endFlashKey.value++
    playSound(won ? 'victory' : 'defeat')
    triggerImpact('strong')
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
    zone: zoneLabel(p.zone),
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

// Resolve raw entity IDs (github_*, bot_*, creep_3, ice_mid-t1-chaff…) to
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
  if (id.startsWith('wave')) return 'a wave'
  if (id.startsWith('neutral')) return 'a neutral wave'
  if (id.startsWith('ice')) {
    const zone = id.slice('ice_'.length)
    return `ice (${zone})`
  }
  if (id.startsWith('ancient_')) {
    const team = id.slice('ancient_'.length)
    if (team === 'chaff') return 'the Chaff Mainframe'
    if (team === 'audit') return 'the Audit Mainframe'
    return `the ${team} Mainframe`
  }
  if (id === 'tenant') return 'Tenant'
  if (id === 'buyback') return 'buyback'
  if (id === 'fountain') return 'the fountain'
  return id
}

function abilityLabel(id: unknown): string {
  if (typeof id !== 'string') return '?'
  if (abilityNameById[id]) return abilityNameById[id]
  // Item actives arrive as '<itemId>_active' — resolve to the item's name so
  // the feed says "cast Town Portal Scroll", not "cast town_portal_scroll_active".
  if (id.endsWith('_active')) {
    const item = ITEMS[id.slice(0, -'_active'.length)]
    if (item) return item.name
  }
  return id
}

function zoneLabel(id: string): string {
  return ZONE_MAP[id]?.name ?? id
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
  zoneName: zoneLabel,
}))

const combatEvents = computed<CombatLine[]>(() => {
  const lines = buildCombatLines(gameStore.events, narrativeCtx.value, collapseStructureDamage)
  return [...lines, ...localEvents.value].sort((a, b) => a.tick - b.tick)
})

// Cinematic headline plays — first blood, multi-kills, shutdowns, ice/Tenant/Core.
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
      text: `${tag} ${entityLabel(msg.playerId)}: ${msg.message}`,
      type: 'system',
    })
  } else if (msg.type === 'ping_map') {
    localEvents.value.push({
      tick: gameStore.tick,
      text: `[PING] ${entityLabel(msg.playerId)} pinged ${ZONE_MAP[msg.zone]?.name ?? msg.zone}`,
      type: 'system',
    })
  }
})

// Ice lookup: zoneId → IceState (the store tracks ice from tick_state)
const iceByZone = computed(() => {
  const map = new Map<string, IceState>()
  for (const t of gameStore.ice) {
    map.set(t.zone, t)
  }
  return map
})

// Map zones for AsciiMap
const mapZones = computed(() => {
  const playerZoneId = gameStore.player?.zone ?? ''
  const playerTeam = gameStore.player?.team ?? 'chaff'
  const visibleZoneIds = new Set(gameStore.visibleZoneIds)

  // Currently-live caches by zone (spawned but not yet expired).
  const liveCacheByZone = new Map<string, string>()
  for (const r of gameStore.caches) {
    if (r.tick + CACHE_DURATION_TICKS > gameStore.tick) liveCacheByZone.set(r.zone, r.type)
  }

  // Tenant state for the pit (reuses the War Room's tested respawn readout).
  const tenantReadout = gameStore.tenant ? formatTenant(gameStore.tenant, gameStore.tick) : null

  // The GAME's zone set, not the global 32. On the one-lane tutorial map the
  // full list put ~20 zones on the board that the game does not contain — and
  // because the compact map derives its tap-to-move cards from this list, half
  // of them ordered a walk to a zone the server would reject.
  return zonesForMap(gameStore.mapId).map((zone) => {
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

    // Waves in this zone — types render as the crew's OWN unit names
    // (mule/script/picket vs guard/sweeper/auditor), never the role slots.
    const wavesInZone = gameStore.waves.filter((c) => c.zone === zone.id)
    const waveCount = wavesInZone.length
    const waveTypes = [
      ...new Set(
        wavesInZone.map(
          (c) => WAVE_UNIT_LABELS[c.team]?.[c.type as WaveRole] ?? (c.type as string),
        ),
      ),
    ]

    // Neutrals in this zone
    const neutralsInZone = gameStore.neutrals.filter((n) => n.zone === zone.id && n.alive)
    const neutralCount = neutralsInZone.length

    // Own-team ward coverage here (a ward's zone is always in our vision).
    const wardCount = (gameStore.visibleZones[zone.id]?.wards ?? []).filter(
      (w) => w.team === playerTeam,
    ).length

    // Ice info
    const ice = iceByZone.value.get(zone.id)
    const iceDisplay = ice
      ? {
          team: ice.team,
          alive: ice.alive,
          tier: zone.tier ?? getIceTier(zone.id),
          hp: ice.hp,
          maxHp: ice.maxHp,
        }
      : undefined

    return {
      id: zone.id,
      name: zone.name,
      playerHere: zone.id === playerZoneId,
      allies,
      enemyCount,
      enemyNames,
      ice: iceDisplay,
      fogged,
      waveCount,
      waveTypes,
      neutralCount,
      wardCount,
      // Global, not vision-gated: the server sends caches unfiltered (see
      // VisionCalculator) and the War Room ticker already names the live one.
      // Hiding the map marker only made the two surfaces disagree — a cache spot
      // is unwarded almost by definition, so the fog gate hid it nearly always.
      cacheType: liveCacheByZone.get(zone.id),
      tenant:
        zone.id === 'hollow' && !fogged && tenantReadout && tenantReadout.status !== 'unknown'
          ? { alive: tenantReadout.status === 'up', respawnIn: tenantReadout.respawnIn }
          : undefined,
    }
  })
})

const playerZone = computed(() => gameStore.player?.zone ?? '')

// ── Auto-path readout ────────────────────────────────────────
// Where the hero is walking, if anywhere. Same source of truth as the arrival
// narration: the server nulls `moveTarget` on the last hop, so the local order
// is what covers the final leg and every single-hop move.
const walkDestination = computed(() => gameStore.player?.moveTarget ?? walkTarget.value)

/** `WALKING → <name> · Nt` — a queued walk had no persistent surface at all. */
const walkReadout = computed(() => {
  const p = gameStore.player
  const target = walkDestination.value
  if (!p || !p.alive || !target || target === p.zone) return null
  const zoneIds = new Set(mapZones.value.map((z) => z.id))
  // Restricted to this game's zone set, mirroring the server's own BFS
  // (resolveMovementPhase paths over `zones`, never over what you can see).
  const ticks = pathDistance(p.zone, target, (id) => zoneIds.has(id))
  if (ticks <= 0) return null
  return { zone: target, name: ZONE_MAP[target]?.name ?? target, ticks }
})

/** Stop walking: re-ordering a move to where you stand clears `moveTarget`. */
function stopWalking() {
  const p = gameStore.player
  if (!p) return
  handleCommand(`move ${p.zone}`)
}

// ── Zone panel data (who's in my zone) ────────────────────────
const currentZoneName = computed(() => gameStore.currentZone?.name ?? playerZone.value)

// Waves in the player's zone, tagged with their zone-local index (Nth wave
// in this zone) — the convention the server resolves `attack wave:<index>`
// against. Index after filtering: global-array indices are vision-filtered
// and don't survive the trip to the server.
const zoneWaves = computed(() =>
  gameStore.waves.filter((c) => c.zone === playerZone.value).map((c, index) => ({ ...c, index })),
)

// Neutrals in the player's zone, tagged with their GLOBAL index. Unlike waves
// the server resolves `attack neutral:<index>` against the whole neutrals array
// (it reaches the client unfiltered), so the index must be taken before the
// zone filter — re-indexing the survivors would attack a different camp.
const zoneNeutrals = computed(() =>
  gameStore.neutrals
    .map((n, index) => ({ ...n, index }))
    .filter((n) => n.zone === playerZone.value && n.alive),
)

/** Tenant, but only where he can actually be fought (and only while alive). */
const zoneTenant = computed(() =>
  playerZone.value === 'hollow' && gameStore.tenant?.alive ? gameStore.tenant : null,
)

const zoneIce = computed(() => iceByZone.value.get(playerZone.value) ?? null)

// ── Death overlay ─────────────────────────────────────────────

/**
 * Ticks are the engine's unit, but nothing in the HUD ever tells a player a
 * tick is 4s — so the countdowns they have to act on carry wall time too.
 * Under a minute the tick count is still the actionable number (you queue one
 * action per tick), so both are shown; "0:12" reads worse than "12s" anyway.
 * From a minute up the clock alone is enough.
 */
function countdownText(ticks: number): string {
  const t = Math.max(0, ticks)
  const seconds = (t * TICK_DURATION_MS) / 1000
  return seconds < 60 ? `${t}c (${seconds}s)` : ticksToClock(t)
}

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

function getIceTier(zoneId: string): number {
  if (zoneId.includes('t1')) return 1
  if (zoneId.includes('t2')) return 2
  if (zoneId.includes('t3')) return 3
  return 1
}

// ── Command handling ───────────────────────────────────────────

function handleCommand(cmd: string) {
  // A bare `attack` / `atk` auto-targets the lowest-HP enemy hero in your zone
  // (a MOBA right-click) so you don't have to type the full target. Waves stay
  // explicit (attack wave:N) so auto-target never steals a last-hit.
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
  // A bare `burn` targets the lowest-HP eligible allied wave in your zone, so
  // you can snap-burn an about-to-die wave without hunting for its index.
  if (bareCmd === 'burn') {
    const me = gameStore.player
    if (me) {
      const picked = pickDenyTargetString(me, gameStore.waves)
      if ('error' in picked) {
        localEvents.value.push({ tick: gameStore.tick, text: picked.error, type: 'system' })
        return
      }
      cmd = `burn ${picked.target}`
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
              ? formatMapReadout(me, gameStore.mapId)
              : formatScanReadout(me, gameStore.allPlayers)
        localEvents.value.push({ tick: gameStore.tick, text, type: 'system' })
      }
      return
    }
    // AFK takeover (no-reclaim): a bot plays this hero for the rest of the
    // match, so don't queue doomed game actions — the server would drop them.
    // Surrender still goes through (the human's vote counts); chat/ping/missing
    // and the local readouts returned above stay available too.
    if (gameStore.player?.aiControlled && command.type !== 'surrender') {
      localEvents.value.push({
        tick: gameStore.tick,
        text: 'A bot controls your hero for the rest of this match — you can still chat, ping, and vote to surrender.',
        type: 'system',
      })
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
      neutrals: gameStore.neutrals,
      tick: gameStore.tick,
      mode: gameStore.mode,
    })
    if (validationError) {
      localEvents.value.push({
        tick: gameStore.tick,
        text: validationError,
        type: 'system',
      })
      // A rejection is the one [SYS] line the player MUST notice — client-side
      // rejects now raise the same amber toast the server path already raises,
      // which keeps grey [SYS] for genuine meta-chatter (chat, pings, readouts).
      gameStore.addAnnouncement(validationError, 'warning')
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
    // Remember (or drop) the walk order. `isSpecial` is exactly the server's
    // KEEPS_AUTOPATH set minus `move`, so this mirrors GameLoop: a deliberate
    // non-move order replaces the walk, and no arrival is owed any more.
    // Ordering a move to where you already stand is the STOP command (the
    // server's BFS finds no next hop and nulls moveTarget), so it must clear
    // the local memory too rather than leave the current zone as a destination.
    if (command.type === 'move') {
      walkTarget.value = command.zone === gameStore.player?.zone ? null : command.zone
    } else if (!isSpecial) walkTarget.value = null
    // Immediate positive confirmation so the action feels registered NOW, not
    // only when the tick resolves ~4s later. Pre-flight validation already gated
    // out rejects above, so this fires only on actions that will resolve; the
    // landing cues (damage floats, impact flare) still come from the tick events.
    // Offensive orders get the meatier `cast` whoosh; everything else — move,
    // buy, ward, burn — used to send in total silence.
    if (command.type === 'cast' || command.type === 'attack') playSound('cast')
    else playSound('submit')
  } else if (error) {
    localEvents.value.push({
      tick: gameStore.tick,
      text: error,
      type: 'system',
    })
    gameStore.addAnnouncement(error, 'warning')
  }
}

function handleBuyItem(itemId: string) {
  handleCommand(`buy ${itemId}`)
}

function handleZoneClick(zoneId: string) {
  const p = gameStore.player
  if (!p) return

  if (p.zone === zoneId) {
    localEvents.value.push({
      tick: gameStore.tick,
      text: `Already in ${ZONE_MAP[zoneId]?.name ?? zoneId}`,
      type: 'system',
    })
    return
  }

  // Auto-path: any zone is a valid order — the hero walks one zone per tick
  // toward it (validateCommand still rejects zones off this game's map).
  handleCommand(`move ${zoneId}`)
}

// ── [MOVE] picker ────────────────────────────────────────────
// The same one-tap-to-move list the compact AsciiMap draws, reachable from the
// action bar (which is on screen at every breakpoint, unlike the map).
const showMovePicker = ref(false)
const movePickerZones = computed(() =>
  buildAdjacentZones(gameStore.player?.zone ?? '', mapZones.value),
)

function pickMoveZone(zoneId: string) {
  showMovePicker.value = false
  handleZoneClick(zoneId)
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
    // Used to print the raw adjacency list ("mid-t1-chaff, cache-top, …") — slugs
    // that appear nowhere else in the UI, off this game's map half the time,
    // and not clickable. It is a MOVE button; it now moves.
    if (!movePickerZones.value.length) {
      localEvents.value.push({
        tick: gameStore.tick,
        text: 'No adjacent zones to move to from here.',
        type: 'system',
      })
      return
    }
    showMovePicker.value = !showMovePicker.value
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
      // nothing to fight; everywhere else, point at waves + the explicit syntax.
      const zoneType = ZONE_MAP[p.zone]?.type
      const inBase = zoneType === 'fountain' || zoneType === 'base'
      localEvents.value.push({
        tick: gameStore.tick,
        text: inBase
          ? 'No targets here — move to a lane to fight (e.g.  move mid-river ).'
          : 'No enemies in this zone — last-hit waves in the Zone panel, or  attack <target> .',
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

// Situational actions (ward / burn / backup / cache / harden / surrender) were
// command-line only — invisible + unusable on touch. Surface them as on-screen
// buttons, shown only when actually available so the row stays contextual.
// Which contextual actions the player can take now — pure rules extracted to a
// unit-tested util (computeSituationalActions).
const situationalActions = computed(() =>
  computeSituationalActions({
    player: gameStore.player,
    isAlive: gameStore.isAlive,
    waves: gameStore.waves,
    backup: gameStore.backup,
    caches: gameStore.caches,
    teams: gameStore.teams,
    tick: gameStore.tick,
    mode: gameStore.mode,
  }),
)

function runSituational(cmd: string) {
  const p = gameStore.player
  if (!p) return
  if (cmd === 'ward') handleCommand(`ward ${p.zone}`)
  else if (cmd === 'surrender') handleCommand('surrender confirm')
  else handleCommand(cmd) // burn / backup / cache / harden — bare commands (auto-resolved)
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
    // Not learned yet outranks every other reason: the ultimate is unusable
    // below ULTIMATE_UNLOCK_LEVEL (getAbilityLevel returns rank 0 and the engine
    // refuses with "Ability not yet learned"). R used to render as READY at
    // level 1, so the button promised a cast the server was always going to
    // reject — and nothing on screen said why.
    if (getAbilityLevel(p.level, slot) <= 0) {
      const at = slot === 'r' ? ULTIMATE_UNLOCK_LEVEL : 1
      result[upper] = {
        ready: false,
        label: `${upper}·L${at}`,
        aria: `${upper} ${name}, unlocks at level ${at}`,
      }
      continue
    }
    const cd = p.cooldowns[slot]
    if (cd > 0) {
      // The chip stays a bare tick count so the dense bar keeps its width; the
      // seconds a player actually plans in go into the accessible name instead.
      result[upper] = {
        ready: false,
        label: `${upper}·${cd}`,
        aria: `${upper} ${name}, on cooldown ${cd} cycles, about ${(cd * TICK_DURATION_MS) / 1000} seconds`,
      }
      continue
    }
    const ability = HEROES[p.heroId]?.abilities[slot]
    if (ability && p.mp < getAbilityManaCost(ability, slot, p.level)) {
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

// The tick of the player's most recent death. `death` is emitted for EVERY
// death — including one with no eligible killer — so it is the only reliable
// anchor. Everything below is scoped to it: the events list is a 200-entry ring
// buffer, and the overlay used to scan it unbounded, so a kill from ten minutes
// ago could be reported as the cause of the death on screen right now.
const lastDeathTick = computed<number | null>(() => {
  const pid = gameStore.playerId
  if (!pid) return null
  for (let i = gameStore.events.length - 1; i >= 0; i--) {
    const e = gameStore.events[i]!
    if (e.type === 'death' && e.payload.playerId === pid) return e.tick
  }
  return null
})

const killerName = computed(() => {
  const pid = gameStore.playerId
  const deathTick = lastDeathTick.value
  if (!pid || deathTick == null) return null

  let attributed: string | null = null
  let lastDamaged: string | null = null
  for (let i = gameStore.events.length - 1; i >= 0; i--) {
    const e = gameStore.events[i]!
    if (e.tick < deathTick) break
    if (e.type === 'kill' && e.payload.victimId === pid && e.payload.killerId) {
      attributed = e.payload.killerId as string
      break
    }
    // ICE, waves and neutrals are not eligible killers (handleDeaths only
    // accepts a killerId that resolves to a player), so an NPC kill produces a
    // `death` with no `kill` at all. Since NPC hits now emit `damage`, the last
    // thing that hit us on the death tick is the honest answer — without it the
    // overlay simply said nothing after the most instructive death in the game,
    // the ice dive.
    if (lastDamaged === null && e.type === 'damage' && e.payload.targetId === pid) {
      lastDamaged = e.payload.sourceId as string
    }
  }

  const killerId = attributed ?? lastDamaged
  return killerId ? entityLabel(killerId) : null
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
    v-if="isGameOver && gameStore.winner"
    :winner="gameStore.winner"
    :stats="gameStore.gameOverStats ?? {}"
    :players="postGamePlayers"
    :current-player-id="gameStore.playerId ?? ''"
    :game-id="gameStore.gameId ?? null"
    :mode="gameStore.mode"
    :tutorial-complete="isTutorialComplete(gameStore.tutorialStep ?? 0)"
    :duration-ticks="gameStore.gameOverDurationTicks ?? undefined"
    :mmr-change="gameStore.gameOverMmrChange ?? undefined"
    :ranked="gameStore.gameOverRanked"
    @play-again="handlePlayAgain"
    @return-to-menu="handleReturnToMenu"
  />

  <!-- Active Game Screen -->
  <div
    v-else
    class="game-grid relative bg-bg-primary"
    :style="hudBarStyle"
    data-testid="game-screen"
    :data-game-id="gameStore.gameId ?? ''"
    :data-layout="layout"
    :data-density="settings.hud.density"
    :data-vitals="settings.hud.emphasizeVitals ? 'on' : 'off'"
  >
    <!-- Floating combat numbers, one lane each: what lands on you, and what you
         land on someone else -->
    <DamageFloat :floats="selfFloats" anchor="self" />
    <DamageFloat :floats="targetFloats" anchor="target" />

    <!-- Impact flare: the hit punch that used to translate this whole grid —
         command input included — and expose the page background at the edges -->
    <div
      v-if="impactKey > 0"
      :key="impactKey"
      class="pointer-events-none absolute inset-0 z-[16]"
      :class="impactLevel === 'strong' ? 'anim-impact-strong' : 'anim-impact'"
      :style="{ '--hit-intensity': hitIntensity }"
      data-testid="impact-overlay"
      aria-hidden="true"
    />

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

    <!-- Respawn: the mirror of the death vignette, so coming back is an event
         rather than an overlay quietly vanishing -->
    <div
      v-if="respawnKey > 0"
      :key="respawnKey"
      class="anim-respawn-vignette pointer-events-none absolute inset-0 z-40"
      data-testid="respawn-vignette"
      aria-hidden="true"
    />

    <!-- Game-end climax flash: a one-shot team-colored wash fired the instant
         the game ends (paired with the victory/defeat stinger + strong flare) -->
    <div
      v-if="endFlashKey > 0 && endFlashType"
      :key="endFlashKey"
      :class="endFlashType === 'victory' ? 'anim-end-victory' : 'anim-end-defeat'"
      class="pointer-events-none absolute inset-0 z-40"
      aria-hidden="true"
    />

    <div
      v-if="!gameStore.isAlive && gameStore.player"
      class="death-overlay"
      data-testid="death-overlay"
    >
      <div
        class="anim-fade-in-up pointer-events-auto flex max-h-[90%] max-w-[min(92vw,26rem)] flex-col items-center justify-center overflow-y-auto rounded-lg border-2 border-audit bg-bg-panel p-6 text-center bloom-audit"
      >
        <div class="mb-4 text-6xl text-audit text-glow-audit anim-glow-pulse">☠</div>
        <p class="t-display text-audit text-glow-audit tracking-widest">PROCESS TERMINATED</p>
        <p v-if="killerName" class="t-h3 mt-5 text-text-primary">
          Killed by <span class="text-audit text-glow-audit">{{ killerName }}</span>
        </p>
        <p v-if="gameStore.player.respawnTick" class="mt-5 t-body text-text-dim">
          Respawning in
          <span class="text-chaff text-glow-chaff font-bold t-mono-num">{{
            countdownText(gameStore.player.respawnTick - gameStore.tick)
          }}</span>
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
            [BUYBACK — {{ buybackInfo.cost }}sc]
          </button>
          <p v-if="buybackInfo.cooldownTicks > 0" class="t-caption text-audit">
            Buyback on cooldown — {{ countdownText(buybackInfo.cooldownTicks) }} remaining
          </p>
          <p v-else-if="buybackInfo.shortfall > 0" class="t-caption text-text-dim">
            Need {{ buybackInfo.shortfall }}sc more ({{ gameStore.player.gold }}sc /
            {{ buybackInfo.cost }}sc)
          </p>
        </div>
        <p class="mt-4 t-caption">Wait for respawn or buy back to return instantly</p>
        <!-- Dead players can still vote to surrender a lost game (the overlay
             otherwise covers the command input). Server validates timing/threshold. -->
        <button
          data-testid="death-surrender-button"
          class="mt-5 border border-border px-4 py-1.5 font-mono text-xs text-text-dim transition-colors hover:border-audit hover:text-audit active:scale-95"
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
      <div class="text-4xl text-audit text-glow-audit">⚠ CONNECTION LOST</div>
      <p class="max-w-md text-center text-sm text-text-dim">
        Could not reach the game server after multiple attempts. The match may still be running —
        reload to try again.
      </p>
      <button
        class="border border-audit px-4 py-2 font-mono text-audit transition-all hover:bg-audit/10 active:scale-95"
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

    <div ref="barEl" class="game-grid__bar">
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
        :teams="gameStore.teams"
        :ancients="ancients"
        :net-worth-chaff="gameStore.netWorth.chaff"
        :net-worth-audit="gameStore.netWorth.audit"
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
          :player-team="gameStore.player?.team ?? 'chaff'"
          :enemies="gameStore.nearbyEnemies"
          :allies="gameStore.nearbyAllies"
          :waves="zoneWaves"
          :neutrals="zoneNeutrals"
          :ice="zoneIce"
          :tenant="zoneTenant"
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
          :move-target="walkDestination"
          force-mode="full"
          @zone-click="handleZoneClick"
        />
      </div>
    </TerminalPanel>

    <!-- Right rail: compact map + hero status (classic) or the
         demoted combat-log ticker (map-centric).
         The map leads the rail: it is the only spatial surface in the classic
         layout, and the rail scrolls — behind Hero Status the overview grid
         fell below the fold on short viewports. -->
    <div class="game-grid__rail">
      <!-- Classic: compact map in the rail. Map-centric: the map is in the
           center, so the rail carries the demoted combat-log ticker.
           overview-open: the whole-board grid is the map's actual payload, so
           it ships expanded here rather than behind the toggle. Only this
           instance — the component default stays collapsed for mobile. -->
      <!-- The board is the one thing that must never leave the screen: without
           it the player loses all spatial sense of the match. It gets its own
           non-scrolling grid row (see .rail-map) and the panels beneath it share
           what is left and scroll — rather than the map itself scrolling, which
           is what a plain max-height produced. -->
      <TerminalPanel v-if="layout === 'classic'" title="Map" class="rail-map">
        <AsciiMap
          :zones="mapZones"
          :player-zone="playerZone"
          :ancients="ancients"
          :map-id="gameStore.mapId"
          :move-target="walkDestination"
          force-mode="compact"
          :overview-open="true"
          @zone-click="handleZoneClick"
        />
      </TerminalPanel>

      <!-- Everything below the board shares the remaining height and scrolls
           together, so the board itself never has to. -->
      <div class="rail-scroll">
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
              class="anim-flash-damage pointer-events-none absolute inset-0 z-10"
              :style="{ '--hit-intensity': hitIntensity }"
              data-testid="hero-hit-flash"
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

        <TerminalPanel
          v-if="layout === 'map-centric'"
          title="Combat Log"
          class="min-h-[8rem] flex-1"
          data-testid="rail-log"
        >
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
            class="border border-border px-2 py-0.5 font-mono t-hud-sm text-text-dim hover:text-text-primary"
            @click="showShop = false"
          >
            [CLOSE]
          </button>
        </div>
        <div
          v-if="!gameStore.canBuy"
          class="mb-2 border border-audit/30 bg-audit/5 px-3 py-1.5 text-xs text-audit"
          data-testid="shop-blocked-reason"
        >
          [WARN] {{ shopBlockedReason }}
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
          class="ml-auto whitespace-nowrap border border-border bg-bg-secondary px-2 py-1 font-mono t-hud-sm text-gold hover:text-text-primary active:bg-border"
          :class="{ 'border-gold': gameStore.canBuy }"
          title="Shop — click, or press Esc then S"
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
          class="hud-action-btn min-h-[40px] min-w-[44px] whitespace-nowrap border border-border bg-bg-secondary px-2.5 py-1.5 font-mono t-hud-sm font-bold text-text-primary transition-all active:bg-border active:scale-95"
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
          :aria-pressed="
            cmd === 'SHOP'
              ? showShop
              : cmd === 'SCORE'
                ? showScoreboard
                : cmd === 'MOVE'
                  ? showMovePicker
                  : undefined
          "
          @click="handleQuickAction(cmd)"
        >
          {{ ['Q', 'W', 'E', 'R'].includes(cmd) ? abilityButtonState[cmd]?.label : cmd }}
        </button>
      </div>

      <!-- [MOVE] picker: one tap per adjacent zone, named as the rest of the UI
           names them. Only this game's map contributes (mapZones). -->
      <div
        v-if="showMovePicker"
        class="flex flex-wrap gap-1 px-2 pb-1.5"
        data-testid="move-picker"
        role="group"
        aria-label="Move to an adjacent zone"
      >
        <button
          v-for="z in movePickerZones"
          :key="z.id"
          class="hud-action-btn min-h-[36px] whitespace-nowrap border border-chaff/50 bg-bg-secondary px-2 py-1 font-mono t-hud-sm text-chaff transition-all active:bg-border active:scale-95"
          :class="{ 'opacity-60': z.fogged }"
          :data-testid="`move-picker-${z.id}`"
          :aria-label="`Move to ${z.name}`"
          @click="pickMoveZone(z.id)"
        >
          ▸ {{ z.name }}
        </button>
      </div>

      <!-- A queued walk is otherwise invisible: the order scrolls out of the log
           and the hero just drifts a zone per tick with no way to call it off. -->
      <div
        v-if="walkReadout"
        class="flex items-center gap-2 px-2 pb-1 font-mono t-hud-sm text-self"
        data-testid="walk-strip"
      >
        <span>WALKING → {{ walkReadout.name }} · {{ walkReadout.ticks }}t</span>
        <button
          class="border border-border px-1.5 py-0.5 text-text-dim hover:text-text-primary active:bg-border"
          data-testid="walk-stop"
          aria-label="Stop walking"
          @click="stopWalking"
        >
          [stop]
        </button>
      </div>
      <!-- Situational actions — surfaced as buttons only when available, so the
           command-only verbs (ward/burn/backup/cache/harden/surrender) are usable
           on touch and discoverable to new players. -->
      <div
        v-if="situationalActions.length"
        class="flex flex-wrap gap-1 px-2 pb-1.5"
        data-testid="situational-actions"
      >
        <button
          v-for="a in situationalActions"
          :key="a.cmd"
          class="hud-action-btn min-h-[36px] whitespace-nowrap border border-ability/40 bg-bg-secondary px-2 py-1 font-mono t-hud-sm text-ability transition-all active:bg-border active:scale-95"
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
        ref="commandInputRef"
        placeholder="Enter command — type help for the list (Tab to autocomplete)"
        :player="gameStore.player"
        :visible-zones="gameStore.visibleZones"
        :all-players="gameStore.allPlayers"
        :items="ITEMS"
        :can-act="gameStore.canAct"
        :pending-command="gameStore.pendingCommand"
        :buffered-command="gameStore.bufferedCommand"
        :tick="gameStore.tick"
        :mode="gameStore.mode"
        :neutrals="gameStore.neutrals"
        :waves="gameStore.waves"
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
  /* Two rows: the board (always visible, never scrolled away) and everything
     else (shares the remainder, scrolls). A plain flex column with
     overflow-y:auto let the map scroll out of view, which costs the player
     their read of the whole match.

     The board's cap lives on the TRACK, not on the panel. A percentage
     max-height on an `auto` track is cyclic and silently does nothing, and an
     `auto` first track sized by the board's natural height ate the entire rail
     — Hero Status collapsed to 0px with no scrollbar to reach it. */
  display: grid;
  grid-template-rows: minmax(0, 60%) minmax(0, 1fr);
  gap: 0.25rem;
  min-height: 0;
}

/* Pinned to row 1 explicitly: the map is v-if'd out in the map-centric layout,
   and without this the surviving child auto-places into row 1 and the empty
   track absorbs the rail. `overflow: visible` let the board spill out and
   intercept taps on the action bar, SHOP and the talent picker. */
.rail-map {
  grid-row: 1;
  overflow: hidden;
}

/* The rail renders AsciiMap in compact mode, whose cells carry a FIXED h-7 —
   so the board could not shrink to its track and had to be scrolled. A
   min-height override cannot shrink a fixed height; this sets `height`, and
   !important is required to beat the Tailwind utility. */
.rail-map :deep(.map-cell-compact) {
  height: clamp(16px, 2.8vh, 28px) !important;
}

/* Everything below the board scrolls together. */
/* Everything below the board shares the remaining height and scrolls together,
   so the board itself never has to. */
.rail-scroll {
  grid-row: 2;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  min-height: 0;
  overflow-y: auto;
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
  /* Flooring the panel type at 12px costs rows per screen. Compact is the knob
     that already exists for buying those rows back, so it steps the two HUD
     tiers down rather than a separate "small text" setting being invented — and
     it still lands well above the 7.7px–8.1px this replaced. */
  --hud-text-xs: 0.6875rem;
  --hud-text-sm: 0.75rem;
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

/* Overlay lanes, stacked below the measured HUD bar (--hud-bar-h, published from
   the script). The fixed 4.25rem both of these used to sit at is 68px at the
   root font size — squarely on the focus banner and the tick/gold/KDA row. The
   fallback keeps the old placement if the measurement never arrives. */
.game-grid__killfeed {
  position: absolute;
  top: calc(var(--hud-bar-h, 4.25rem) + 2.75rem);
  left: 50%;
  transform: translateX(-50%);
  z-index: 25;
  width: max-content;
  max-width: 92%;
}

/* The toast owns the lane directly under the bar; the kill feed sits below it. */
.game-grid :deep(.announcement-toast) {
  top: calc(var(--hud-bar-h, 4.25rem) + 0.5rem);
}

/* Death is up to 108 seconds long. A 70%-opaque full-bleed scrim that also ate
   every click turned that into a blackout: the map, the log, the war room and
   the scoreboard were all unreadable and unreachable for the duration. Only the
   card takes pointer events, so the HUD underneath keeps working — watching the
   fight you just lost is most of what there is to do while dead. */
.death-overlay {
  position: absolute;
  inset: 0;
  z-index: 20;
  pointer-events: none;
  background: rgb(var(--bg-overlay) / 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
}

@media (max-width: 1024px) {
  /* Tablet: combat log spans full width as the primary surface; Zone + War Room
     share the left column beneath it, while hero/map live in the right rail. */
  /* The content rows must be free to shrink to nothing. `.game-grid` is
     `overflow: hidden; height: 100dvh`, so any px floor here is subtracted from
     the LAST row — the command input, Q/W/E/R and shop — and pushes it off the
     bottom of the screen. Every row below the bar scrolls internally already
     (TerminalPanel's body, and `.game-grid__rail`), so there is nothing a floor
     protects. */
  .game-grid {
    grid-template-columns: 1fr 1fr;
    grid-template-rows: auto minmax(0, 1.7fr) minmax(0, 1fr) auto;
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
      auto minmax(0, 1.9fr) minmax(0, 1.1fr)
      minmax(0, 1fr) auto;
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
