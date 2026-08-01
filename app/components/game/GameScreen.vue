<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { formatTickClock } from '~/utils/gameClock'
import AnnouncementToast from '~/components/game/AnnouncementToast.vue'
import TraceRail from '~/components/game/TraceRail.vue'
import { buildTrace } from '~/components/game/traceModel'
import ActionRow from '~/components/game/ActionRow.vue'
import CommandInput from '~/components/game/CommandInput.vue'
import DamageFloat, { type DamageFloatEntry } from '~/components/game/DamageFloat.vue'
import GameStateBar from '~/components/game/GameStateBar.vue'
import StatusLines from '~/components/game/StatusLines.vue'
import Stream from '~/components/game/Stream.vue'
import Deck from '~/components/game/Deck.vue'
import InventoryBar from '~/components/game/InventoryBar.vue'
import ItemShop from '~/components/game/ItemShop.vue'
import KillFeed from '~/components/game/KillFeed.vue'
import QuickBuy from '~/components/game/QuickBuy.vue'
import Scoreboard from '~/components/game/Scoreboard.vue'
import TalentPicker from '~/components/game/TalentPicker.vue'
import TutorialHint from '~/components/game/TutorialHint.vue'
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
  formatContactsReadout,
  formatNetReadout,
  formatLookReadout,
  formatHelpReadout,
} from '~/composables/useCommands'
import {
  visionSummary,
  dayNightReadout,
  formatCaches,
  formatBackup,
  scripLead,
  formatScripShort,
} from '~/utils/strategy'
import { useAudio } from '~/composables/useAudio'
import { ZONE_MAP } from '~~/shared/constants/zones'
import { WAVE_UNIT_LABELS, type WaveRole } from '~~/shared/constants/world'
import { zonesForMap } from '~~/shared/constants/maps'
import { buildAdjacentZones } from '~/components/game/traceModel'
import { HEROES } from '~~/shared/constants/heroes'
import { recommendedItemsForRole } from '~~/shared/constants/itemBuilds'
import { ITEMS, ITEM_CATEGORIES, DEFAULT_QUICKBUY_ITEMS } from '~~/shared/constants/items'
import type { ItemCategoryId } from '~~/shared/types/items'
import { getTalentTree } from '~~/shared/constants/talents'
import type { IceState, TerminalState } from '~~/shared/types/game'
import { uiLog } from '~/utils/logger'
import { collapseStructureDamage, type CombatLine } from '~/utils/combatLog'
import {
  buildCombatLines,
  deriveKillFeed,
  type NarrativeContext,
  type KillFeedEntry,
} from '~/utils/combatNarrative'
import {
  CYCLE_DURATION_MS,
  CACHE_DURATION_CYCLES,
  ULTIMATE_UNLOCK_LEVEL,
  getAbilityLevel,
} from '~~/shared/constants/balance'
import { pathDistance } from '~~/shared/pathfinding'
import { formatTenant, ticksToClock } from '~/utils/strategy'
import { computeThreat, recommendAction } from '~/utils/tactics'
import { arrowTargetZone } from '~/utils/arrowMove'
import { computeSituationalActions } from '~/utils/situationalActions'
import { routeGameKey } from '~/utils/gameKeys'
import { escalateRejection, resetRejectionEscalation } from '~/utils/rejectionEscalation'
import {
  evaluateCoach,
  newlyLearned,
  COACH_TIP_IDS,
  type CoachInput,
  type CoachLearned,
  type CoachHistory,
  type CoachTipId,
} from '~/utils/coach'
import { LANE_ROUTES_CORE } from '~~/shared/constants/lanes'
import { getAbilityBwCost } from '~~/shared/utils/ability'
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
    cycle: number
    text: string
    type: 'damage' | 'healing' | 'kill' | 'scrip' | 'system' | 'ability' | 'rig'
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
        'You start in the fountain. Move out onto a route: type or tap  move coldstore-cross',
        // Desktop has no ActionRow (R3-09 hides it on fine pointers), so the
        // shop/scoreboard verbs and the ability keys are the real affordances;
        // the button copy below only exists on touch.
        isFinePointer()
          ? 'Last-hit enemy waves (≈<50% INTEG) for scrip — attack wave:N when a wave is nearly dead.'
          : 'Last-hit enemy waves (≈<50% INTEG) for scrip — use STRIP on the ActionRow, or attack wave:N.',
        isFinePointer()
          ? 'In the fountain/base press Esc then S for the shop (or type  buy <item>); Q/W/E/R quick-cast.'
          : 'In the fountain/base tap [SHOP] to buy; tap Q/W/E/R below to cast.',
        'Destroy the enemy Terminal to win. Good luck!',
      ]
      for (const text of intro)
        localEvents.value.push({ cycle: gameStore.cycle, text, type: 'system' })
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
  measureStreamBody()
})

onUnmounted(() => {
  unsubOnMessage()
  gameSocket.disconnect()
  gameStore.stopTickCountdown()
  resetRejectionEscalation()
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  barObserver?.disconnect()
  streamObserver?.disconnect()
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

// Clearing the bar is not enough: directly under it sits the STREAM panel's own
// chrome — its title row and the FEED filter/density controls — and both overlay
// lanes landed on those instead. Measure where the stream's scrolling body
// actually starts and hang the lanes off that, so a toast can never sit on the
// controls. Falls back to the bar-relative offsets when unmeasured.
const streamWrapEl = ref<HTMLElement | null>(null)
const streamBodyTop = ref(0)
let streamObserver: ResizeObserver | null = null

const hudBarStyle = computed(() => ({
  ...(hudBarHeight.value > 0 ? { '--hud-bar-h': `${hudBarHeight.value}px` } : {}),
  ...(streamBodyTop.value > 0 ? { '--stream-body-top': `${streamBodyTop.value}px` } : {}),
}))

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

/** Distance from the grid's top edge to the top of the stream's scrolling body. */
function readStreamBodyTop() {
  const wrap = streamWrapEl.value
  const body = wrap?.querySelector('[data-testid="stream-body"]') as HTMLElement | null
  const grid = wrap?.closest('.game-grid') as HTMLElement | null
  if (!body || !grid) return
  const top = body.getBoundingClientRect().top - grid.getBoundingClientRect().top
  if (top > 0) streamBodyTop.value = top
}

function measureStreamBody() {
  const wrap = streamWrapEl.value
  if (!wrap) return
  readStreamBodyTop()
  if (typeof ResizeObserver === 'undefined') return
  // The bar above it grows and shrinks (tutorial banner, focus banner, density),
  // which moves the stream body without resizing it — observe the grid too.
  streamObserver = new ResizeObserver(() => readStreamBodyTop())
  streamObserver.observe(wrap)
  const grid = wrap.closest('.game-grid')
  if (grid) streamObserver.observe(grid)
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

/**
 * R3-09 — prompt-primary on desktop only. Aggressive autofocus on a coarse
 * pointer pops the soft keyboard over the game on every overlay close / cycle;
 * gate every reclaim of the prompt on (pointer: fine).
 */
function isFinePointer(): boolean {
  if (typeof window === 'undefined') return false
  if (window.matchMedia?.('(pointer: fine)')?.matches) return true
  if (window.matchMedia?.('(pointer: coarse)')?.matches) return false
  return (navigator.maxTouchPoints ?? 0) === 0
}

function focusPromptIfDesktop() {
  if (!isFinePointer()) return
  nextTick(() => commandInputRef.value?.focus())
}

// Reclaim the prompt when the last overlay closes (shop, scoreboard). The
// close can come from Esc, the SHOP/SCORE toggle, the dialog backdrop, or
// death clearing them — one watch covers all of them.
watch([showShop, showScoreboard], ([shop, score], [wasShop, wasScore]) => {
  const closedSomething = (wasShop && !shop) || (wasScore && !score)
  if (closedSomething && !shop && !score) focusPromptIfDesktop()
})

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

  // Pick the adjacent zone in the pressed direction on the 1D trace: up/down
  // are hops along your route, left/right switch routes at the same hop.
  const targetZone = arrowTargetZone(direction, p.zone, playerZone.adjacentTo, p.team)

  // No blind fallback: if no adjacent zone clearly lies in the pressed
  // direction, do nothing rather than shoving the hero into an arbitrary
  // adjacent zone (often the wrong way, into danger). The map click + `move
  // <zone>` command remain the precise paths. Say so, though — silence is
  // indistinguishable from the hotkey itself being dead, which it used to be.
  if (targetZone) {
    handleCommand(`move ${targetZone}`)
  } else {
    localEvents.value.push({
      cycle: gameStore.cycle,
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
const tickPulseKey = ref(0) // each cycle → reveal flash in the STREAM header
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
  scrip: 'target',
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

// How hard the last hit landed, as a fraction of max INTEG, driving the flash and
// impact alpha: a wave chip and a full combo used to paint identically.
const hitIntensity = ref(1)

function hitStrength(amount: number, maxInteg: number): number {
  if (!(maxInteg > 0)) return 0.5
  return Math.min(1, Math.max(0.25, (amount / maxInteg) * 3))
}

// A hit used to translate the ENTIRE 100dvh grid root — including the command
// input the player is reading and typing into — which also exposed the body
// background as a flickering band at the edges. The punch is now a colored
// inset flare on a transparent overlay: nothing that carries text moves.
const impactKey = ref(0)
const impactLevel = ref<'light' | 'strong'>('light')
let lastImpactAt = 0
/** Multiple hits land in the same cycle; without a floor they retrigger the
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
  hitIntensity.value = hitStrength(amount, gameStore.player?.maxInteg ?? 0)
  heroFlashKey.value++
  triggerImpact('light')
}

// The destination the player last ordered. The server nulls `moveTarget` on the
// arriving hop (ActionResolver) and strips it from enemy views entirely, so the
// last leg of a walk — and every single-hop move — is invisible without a local
// memory of the order. It is also what gates the arrival line: narrating any
// zone change would double-print teleports and fire on every respawn.
const walkTarget = ref<string | null>(null)

// On each new cycle: play the cycle sound and flush any command the player
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
    // death: the store reports "not alive" until the first cycle_state lands, so
    // an ungated rising edge would fire the cue on every game load.
    if (!awaitingRespawn) return
    awaitingRespawn = false
    playSound('respawn')
    respawnKey.value++
    localEvents.value.push({
      cycle: gameStore.cycle,
      text: '>_ PROCESS RESTORED — you are back in the fight',
      type: 'system',
    })
  },
)

watch(
  () => gameStore.cycle,
  () => {
    playSound('cycle')
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
        cycle: gameStore.cycle,
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
        cycle: gameStore.cycle,
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
          // read as feedback, not just a silent INTEG bump.
          if (e.payload.targetId === pid) {
            pushDamageFloat(Number(e.payload.amount), 'heal')
          }
          break
        case 'death':
          if (e.payload.playerId === pid) {
            playSound('death')
            triggerImpact('strong')
            // Instant red vignette on the EVENT — the "PROCESS TERMINATED" overlay
            // is tied to authoritative isAlive state (a cycle_state away), which can
            // lag the event under latency; the vignette confirms death immediately.
            deathVignetteKey.value++
          }
          break
        // Farming — the loop the player spends most of the match in. The scrip
        // cue used to hang off `scrip_change`, whose only emitter is a win
        // sentinel carrying an empty playerId, so last-hitting was silent.
        case 'wave_strip':
        case 'wave_burn':
          if (e.payload.playerId === pid) {
            playSound('scrip')
            pushDamageFloat(Number(e.payload.scripAwarded), 'scrip')
            coachLastHits.value++
          }
          break
        case 'neutral_killed':
          // The camp's bounty is not on the wire, so the cue carries no number.
          if (e.payload.playerId === pid) playSound('scrip')
          break
        case 'level_up':
          if (e.payload.playerId === pid) {
            playSound('ready')
            if ([10, 15, 20, 25].includes(e.payload.newLevel as number)) {
              localEvents.value.push({
                cycle: e.cycle,
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
            // An assist moves your KDA and your scrip; it was the one scoring
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
          // Counted from the ENGINE's event, not from the click: a cast that the
          // server rejected did not teach the player anything.
          if (e.payload.playerId === pid) coachCasts.value++
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
// lacks. Keyed on (ended && winner) so it survives either the cycle_state phase
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

const currentCycle = computed(() => gameStore.cycle)

const gameTime = computed(() => formatTickClock(gameStore.cycle, true))

const playerScrip = computed(() => gameStore.player?.scrip ?? 0)
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
    integ: p.integ,
    maxInteg: p.maxInteg,
    bw: p.bw,
    maxBw: p.maxBw,
    cooldowns: p.cooldowns,
    items: p.items,
    buffs: p.buffs,
    scrip: p.scrip,
    alive: p.alive,
  }
})

// Resolve raw entity IDs (github_*, bot_*, creep_3, ice_coldstore-t1-chaff…) to
// readable names: hero name for players ("You" for self), short labels for units.
const abilityNameById: Record<string, string> = {}
for (const hero of Object.values(HEROES)) {
  for (const ability of Object.values(hero.abilities)) {
    abilityNameById[ability.id] = ability.name
  }
  abilityNameById[hero.passive.id] = hero.passive.name
}

function entityLabel(id: unknown): string {
  // 'someone' rather than '?': the label lands mid-sentence in the feed, and a
  // bare question mark rendered lines like "? terminated ?", which reads as a
  // broken template rather than as a participant the client could not name.
  if (typeof id !== 'string' || !id) return 'someone'
  if (id === gameStore.playerId) return 'You'
  const p = gameStore.allPlayers[id]
  if (p) return (p.heroId && HEROES[p.heroId]?.name) || p.name || id
  if (id.startsWith('wave')) return 'a wave'
  if (id.startsWith('neutral')) return 'a neutral wave'
  if (id.startsWith('ice')) {
    const zone = id.slice('ice_'.length)
    return `ice (${zone})`
  }
  if (id.startsWith('terminal_')) {
    const team = id.slice('terminal_'.length)
    if (team === 'chaff') return 'the Chaff Terminal'
    if (team === 'audit') return 'the Audit Terminal'
    return `the ${team} Terminal`
  }
  if (id === 'tenant') return 'Tenant'
  if (id === 'buyback') return 'buyback'
  if (id === 'anchor') return 'the fountain'
  return id
}

function abilityLabel(id: unknown): string {
  if (typeof id !== 'string') return '?'
  if (abilityNameById[id]) return abilityNameById[id]
  // Item actives arrive as '<itemId>_active' — resolve to the item's name so
  // the feed says "cast Recall Token", not "cast recall_token_active".
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
  return [...lines, ...localEvents.value].sort((a, b) => a.cycle - b.cycle)
})

// Cinematic headline plays — first blood, multi-kills, shutdowns, ice/Tenant/Core.
const killFeed = computed<KillFeedEntry[]>(() =>
  deriveKillFeed(gameStore.events, narrativeCtx.value),
)

// Terminals live in the game store — shown on the base zones of the map.
const terminals = computed(() => gameStore.terminals)

// ── STREAM header drama + low-INTEG danger framing ───────────────────
const THEATER_BAR_WIDTH = 24

/** Wide countdown bar that drains over the 4s cycle — the Theater heartbeat. */
const theaterBar = computed(() => {
  const remaining = Math.max(0, Math.min(CYCLE_DURATION_MS, gameStore.nextCycleIn))
  const filled = Math.round((remaining / CYCLE_DURATION_MS) * THEATER_BAR_WIDTH)
  return '█'.repeat(filled) + '░'.repeat(THEATER_BAR_WIDTH - filled)
})

/** Anticipation: the last ~1s before resolution. */
const cycleImminent = computed(() => gameStore.nextCycleIn > 0 && gameStore.nextCycleIn < 1000)

/** Theater header label: planning vs already-committed-and-waiting. */
const theaterStatus = computed(() => {
  if (!gameStore.isAlive) return 'DOWN'
  return gameStore.canAct ? 'AWAITING ORDERS' : 'RESOLVING'
})

const hpPct = computed(() => {
  const p = gameStore.player
  return p && p.maxInteg > 0 ? (p.integ / p.maxInteg) * 100 : 100
})
/** Hero panel turns to the danger variant under 30% INTEG. */
const heroDanger = computed(() => gameStore.isAlive && hpPct.value <= 30)
// Flag the deck / ActionRow red when an enemy hero shares the player's zone.
const zoneDanger = computed(() => gameStore.nearbyEnemies.length > 0)
/** A red vignette pulses over the whole screen under 15% INTEG. */
const heroCritical = computed(() => gameStore.isAlive && hpPct.value <= 15)

let firstTickLogged = false
const unsubOnMessage = gameSocket.onMessage((msg) => {
  if (msg.type === 'cycle_state') {
    if (!firstTickLogged) {
      firstTickLogged = true
      uiLog.info('First cycle_state received — game is live')
      localEvents.value.push({
        cycle: 0,
        text: '>_ Connected to game server. Stream active.',
        type: 'system',
      })
    }
  } else if (msg.type === 'announcement') {
    localEvents.value.push({
      cycle: gameStore.cycle,
      text: `>_ ${msg.message}`,
      type: 'system',
    })
  } else if (msg.type === 'error') {
    localEvents.value.push({
      cycle: gameStore.cycle,
      text: `[ERROR] ${msg.message}`,
      type: 'system',
    })
  } else if (msg.type === 'chat') {
    const tag = msg.channel === 'team' ? '[TEAM]' : '[ALL]'
    localEvents.value.push({
      cycle: gameStore.cycle,
      text: `${tag} ${entityLabel(msg.playerId)}: ${msg.message}`,
      type: 'system',
    })
  } else if (msg.type === 'ping_map') {
    localEvents.value.push({
      cycle: gameStore.cycle,
      text: `[PING] ${entityLabel(msg.playerId)} pinged ${ZONE_MAP[msg.zone]?.name ?? msg.zone}`,
      type: 'system',
    })
  }
})

// Ice lookup: zoneId → IceState (the store tracks ice from cycle_state)
const iceByZone = computed(() => {
  const map = new Map<string, IceState>()
  for (const t of gameStore.ice) {
    map.set(t.zone, t)
  }
  return map
})

// Map zones for the trace and the move picker
const mapZones = computed(() => {
  const playerZoneId = gameStore.player?.zone ?? ''
  const playerTeam = gameStore.player?.team ?? 'chaff'
  const visibleZoneIds = new Set(gameStore.visibleZoneIds)

  // Currently-live caches by zone (spawned but not yet expired).
  const liveCacheByZone = new Map<string, string>()
  for (const r of gameStore.caches) {
    if (r.cycle + CACHE_DURATION_CYCLES > gameStore.cycle) liveCacheByZone.set(r.zone, r.type)
  }

  // Tenant state for the pit (reuses the net readout's tested respawn readout).
  const tenantReadout = gameStore.tenant ? formatTenant(gameStore.tenant, gameStore.cycle) : null

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
          integ: ice.integ,
          maxInteg: ice.maxInteg,
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
      // VisionCalculator) and the net readout ticker already names the live one.
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

// ── Zone unit list (who's in my zone — feeds look / ActionRow) ─
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
 * cycle is 4s — so the countdowns they have to act on carry wall time too.
 * Under a minute the cycle count is still the actionable number (you queue one
 * action per cycle), so both are shown; "0:12" reads worse than "12s" anyway.
 * From a minute up the clock alone is enough.
 */
function countdownText(ticks: number): string {
  const t = Math.max(0, ticks)
  const seconds = (t * CYCLE_DURATION_MS) / 1000
  return seconds < 60 ? `${t}c (${seconds}s)` : ticksToClock(t)
}

const buybackInfo = computed(() => {
  const p = gameStore.player
  if (!p || p.alive) return null
  const cost = buybackCostFor(p)
  const cooldownCycles =
    p.buybackCooldown && gameStore.cycle < p.buybackCooldown
      ? p.buybackCooldown - gameStore.cycle
      : 0
  const shortfall = Math.max(0, cost - p.scrip)
  return {
    cost,
    cooldownCycles,
    shortfall,
    canBuyback: cooldownCycles === 0 && shortfall === 0,
  }
})

/** Tier from the zone RECORD — the server's `zones.ts` reads it the same way.
 *  Substring-matching the id ('t1'/'t2'/'t3') tied this to the id scheme. */
function getIceTier(zoneId: string): number {
  return ZONE_MAP[zoneId]?.tier ?? 1
}

// ── Command handling ───────────────────────────────────────────

function handleCommand(cmd: string) {
  // A bare `attack` / `atk` auto-targets the lowest-INTEG enemy hero in your zone
  // (a MOBA right-click) so you don't have to type the full target. Waves stay
  // explicit (attack wave:N) so auto-target never steals a last-hit.
  const bareCmd = cmd.trim().toLowerCase()
  if (bareCmd === 'attack' || bareCmd === 'atk') {
    const me = gameStore.player
    if (me) {
      const picked = pickAttackTargetString(me, gameStore.allPlayers)
      if ('error' in picked) {
        localEvents.value.push({ cycle: gameStore.cycle, text: picked.error, type: 'system' })
        return
      }
      cmd = `attack ${picked.target}`
    }
  }
  // A bare `burn` targets the lowest-INTEG eligible allied wave in your zone, so
  // you can snap-burn an about-to-die wave without hunting for its index.
  if (bareCmd === 'burn') {
    const me = gameStore.player
    if (me) {
      const picked = pickDenyTargetString(me, gameStore.waves)
      if ('error' in picked) {
        localEvents.value.push({ cycle: gameStore.cycle, text: picked.error, type: 'system' })
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
    // mirror the bot's target selection: lowest-INTEG enemy in zone for offensive
    // casts, lowest-INTEG ally/self for supportive, the current zone for AoE.
    if (command.type === 'cast' && !command.target) {
      const caster = gameStore.player
      const ability = caster?.heroId ? HEROES[caster.heroId]?.abilities[command.ability] : undefined
      if (caster && ability) {
        const picked = pickAbilityTargetString(ability, caster, gameStore.allPlayers)
        if ('error' in picked) {
          localEvents.value.push({ cycle: gameStore.cycle, text: picked.error, type: 'system' })
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
          localEvents.value.push({ cycle: gameStore.cycle, text: picked.error, type: 'system' })
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
          cycle: gameStore.cycle,
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
        localEvents.value.push({ cycle: gameStore.cycle, text: line, type: 'system' })
      }
      return
    }
    // status/map/scan/who/net/look are informational: print a readout to the
    // local log and return WITHOUT sending — the server ignores them, so
    // submitting one would silently burn the player's one action this cycle.
    if (
      command.type === 'status' ||
      command.type === 'map' ||
      command.type === 'scan' ||
      command.type === 'who' ||
      command.type === 'net' ||
      command.type === 'look'
    ) {
      const me = gameStore.player
      if (me) {
        if (command.type === 'who') {
          for (const line of formatContactsReadout(
            me,
            gameStore.allPlayers,
            gameStore.lastSeen,
            gameStore.cycle,
          )) {
            localEvents.value.push({ cycle: gameStore.cycle, text: line, type: 'system' })
          }
        } else if (command.type === 'net') {
          const myWards = Object.values(gameStore.visibleZones).flatMap((z) => z.wards ?? [])
          const vision = visionSummary(
            Object.keys(gameStore.visibleZones),
            myWards.filter((w) => w.team === me.team),
            gameStore.cycle,
          )
          const dn = dayNightReadout(gameStore.timeOfDay)
          const visionText =
            `vision ${vision.visible}/${vision.total}` +
            (vision.wardsActive
              ? ` · wards ${vision.wardsActive}${vision.nextWardExpiry != null ? ` · ${vision.nextWardExpiry}c` : ''}`
              : ' · no wards')
          const objectives = formatObjectivesLine()
          const text = formatNetReadout({
            chaffNetWorth: gameStore.netWorth.chaff,
            auditNetWorth: gameStore.netWorth.audit,
            netWorthHistory: gameStore.netWorthHistory,
            visionText,
            dayNight: `${dn.label} · ${dn.meaning}`,
            objectives,
          })
          localEvents.value.push({ cycle: gameStore.cycle, text, type: 'system' })
        } else if (command.type === 'look') {
          for (const line of formatLookReadout(me, gameStore.waves, gameStore.neutrals)) {
            localEvents.value.push({ cycle: gameStore.cycle, text: line, type: 'system' })
          }
        } else if (command.type === 'scan') {
          // The "what can I do right now" readout — multi-line, and every line
          // it prints is a command the player can type back verbatim.
          for (const line of formatScanReadout(me, gameStore.allPlayers, {
            waves: gameStore.waves,
            neutrals: gameStore.neutrals,
            ice: gameStore.ice,
            visibleZoneIds: gameStore.visibleZoneIds,
            caches: gameStore.caches,
            mapId: gameStore.mapId,
          })) {
            localEvents.value.push({ cycle: gameStore.cycle, text: line, type: 'system' })
          }
        } else {
          const text =
            command.type === 'status'
              ? formatStatusReadout(me)
              : formatMapReadout(me, gameStore.mapId)
          localEvents.value.push({ cycle: gameStore.cycle, text, type: 'system' })
        }
      }
      return
    }
    // AFK takeover (no-reclaim): a bot plays this hero for the rest of the
    // match, so don't queue doomed game actions — the server would drop them.
    // Surrender still goes through (the human's vote counts); chat/ping/missing
    // and the local readouts returned above stay available too.
    if (gameStore.player?.aiControlled && command.type !== 'surrender') {
      localEvents.value.push({
        cycle: gameStore.cycle,
        text: 'A bot controls your hero for the rest of this match — you can still chat, ping, and vote to surrender.',
        type: 'system',
      })
      return
    }
    // Already acted this cycle: buffer the command client-side and auto-send
    // it when the next cycle arrives (buyback/surrender are special actions
    // the server handles out-of-band, so they always go through directly).
    const isSpecial =
      command.type === 'buyback' || command.type === 'surrender' || command.type === 'select_talent'
    if (!isSpecial && gameStore.isAlive && !gameStore.canAct) {
      gameStore.bufferCommand(cmd)
      localEvents.value.push({
        cycle: gameStore.cycle,
        text: `[QUEUED] ${cmd} — will send next cycle`,
        type: 'system',
      })
      return
    }
    // Pre-flight validation mirroring server rules — don't waste the one
    // action this cycle on a command the server will reject.
    const validationError = validateCommand(command, {
      player: gameStore.player,
      visibleZones: gameStore.visibleZones,
      allPlayers: gameStore.allPlayers,
      items: ITEMS,
      neutrals: gameStore.neutrals,
      tenant: gameStore.tenant ?? undefined,
      cycle: gameStore.cycle,
      mode: gameStore.mode,
    })
    if (validationError) {
      // Third identical rejection reads differently (playability ledger).
      const escalated = escalateRejection(validationError)
      localEvents.value.push({
        cycle: gameStore.cycle,
        text: escalated,
        type: 'system',
      })
      // A rejection is the one [SYS] line the player MUST notice — client-side
      // rejects now raise the same amber toast the server path already raises,
      // which keeps grey [SYS] for genuine meta-chatter (chat, pings, readouts).
      gameStore.addAnnouncement(escalated, 'warning')
      return
    }
    // If the socket isn't open (reconnecting), the action never reached the
    // server — don't fake "Action sent". Buffer it so the next cycle after we
    // reconnect re-sends it, and tell the player why their input paused.
    const sent = gameSocket.send({ type: 'action', command })
    if (!sent) {
      gameStore.bufferCommand(cmd)
      localEvents.value.push({
        cycle: gameStore.cycle,
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
    // only when the cycle resolves ~4s later. Pre-flight validation already gated
    // out rejects above, so this fires only on actions that will resolve; the
    // landing cues (damage floats, impact flare) still come from the cycle events.
    // Offensive orders get the meatier `cast` whoosh; everything else — move,
    // buy, ward, burn — used to send in total silence.
    if (command.type === 'cast' || command.type === 'attack') playSound('cast')
    else playSound('submit')
  } else if (error) {
    localEvents.value.push({
      cycle: gameStore.cycle,
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
      cycle: gameStore.cycle,
      text: `Already in ${ZONE_MAP[zoneId]?.name ?? zoneId}`,
      type: 'system',
    })
    return
  }

  // Auto-path: any zone is a valid order — the hero walks one zone per cycle
  // toward it (validateCommand still rejects zones off this game's map).
  handleCommand(`move ${zoneId}`)
}

// The trace the rail renders — rebuilt per cycle from the store (C1a).
const FALLBACK_TERMINAL: TerminalState = {
  team: 'chaff',
  integ: 0,
  maxInteg: 0,
  alive: false,
  vulnerable: false,
}
const traceModel = computed(() => {
  const p = gameStore.player
  const contacts = Object.values(gameStore.allPlayers)
    .filter((c) => c.id !== p?.id)
    .map((c) => {
      // Fogged enemies arrive as `FoggedPlayer`: KDA + hero + level, and NO
      // zone. This used to hardcode `fogged: false` and read `c.zone` anyway,
      // so every enemy on the roster was listed as a contact — most of them at
      // a blank location — and TRACE claimed vision it did not have. A contact
      // is something you can currently see; anything else is not a contact.
      const zone = (c as { zone?: string }).zone
      return {
        id: c.id,
        name: (c.heroId && HEROES[c.heroId]?.name) || c.name,
        zone: zone ?? '',
        team: c.team,
        alive: c.alive,
        fogged: (c as { fogged?: boolean }).fogged === true || !zone,
      }
    })
  return buildTrace({
    playerZone: p?.zone ?? '',
    playerTeam: p?.team ?? 'chaff',
    contacts,
    terminals: terminals.value ?? { chaff: FALLBACK_TERMINAL, audit: FALLBACK_TERMINAL },
    visibleZoneIds: gameStore.visibleZoneIds,
  })
})

// ── The coach ─────────────────────────────────────────────────
// Situational teaching in the STREAM (see app/utils/coach.ts for why it lives
// in the feed rather than over it). Everything here is bookkeeping; every
// DECISION is in the pure module, which is where it is tested.
const coachLastHits = ref(0)
const coachCasts = ref(0)
const coachHistory = ref<CoachHistory>({})

/** What this player has already proved they know, across matches. */
const coachLearned = ref<CoachLearned>({})
if (import.meta.client) {
  try {
    const raw = localStorage.getItem('termina:coach')
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (parsed && typeof parsed === 'object') {
        // Only keep ids the current catalogue still has — a renamed tip must not
        // stay retired forever under its old key.
        for (const id of COACH_TIP_IDS) {
          if ((parsed as Record<string, unknown>)[id] === true) coachLearned.value[id] = true
        }
      }
    }
  } catch {
    /* private mode — the coach simply starts fresh */
  }
}

function rememberLearned(ids: CoachTipId[]) {
  if (!ids.length) return
  for (const id of ids) coachLearned.value[id] = true
  if (import.meta.client) {
    try {
      localStorage.setItem('termina:coach', JSON.stringify(coachLearned.value))
    } catch {
      /* ignore */
    }
  }
}

/** The live snapshot the pure evaluator reasons over. */
const coachInput = computed<CoachInput | null>(() => {
  const p = gameStore.player
  if (!p) return null
  const zone = ZONE_MAP[p.zone]
  const active = traceModel.value.routes.find((r) => r.active)
  const zoneWaves = gameStore.waves.filter((c) => c.zone === p.zone && c.integ > 0)
  const enemyIce = gameStore.ice.find((t) => t.zone === p.zone && t.alive && t.team !== p.team)
  return {
    cycle: gameStore.cycle,
    alive: gameStore.isAlive,
    hpFraction: p.maxInteg > 0 ? p.integ / p.maxInteg : 0,
    scrip: p.scrip,
    level: p.level,
    lastHits: coachLastHits.value,
    items: p.items ?? [],
    inShopZone: zone?.shop === true,
    onRoute: !!active,
    hopIndex: active?.depth ?? -1,
    hopTotal: active?.total ?? 0,
    enemiesHere: rigEnemyCount.value,
    alliesHere: Math.max(0, rigAllyHeadcount.value - 1),
    strippableWaves: zoneWaves.filter(
      (c) => c.team !== p.team && c.integ / (c.maxInteg || c.integ) <= 0.5,
    ).length,
    attackableIce: !!enemyIce,
    castsMade: coachCasts.value,
    routeVision: active
      ? (LANE_ROUTES_CORE[active.route]?.[p.team] ?? []).filter((z) =>
          gameStore.visibleZoneIds.includes(z),
        ).length
      : 0,
    routeTotal: active?.total ?? 0,
  }
})

// One evaluation per cycle. The coach is off by default for anyone who has
// finished the tutorial — it exists to get a newcomer to competence, not to
// narrate a veteran's match.
watch(
  () => gameStore.cycle,
  (cycle) => {
    if (!settings.hud.coach) return
    const snapshot = coachInput.value
    if (!snapshot) return

    rememberLearned(newlyLearned(snapshot, coachLearned.value))

    const tip = evaluateCoach(snapshot, coachLearned.value, coachHistory.value)
    if (!tip) return
    coachHistory.value = { ...coachHistory.value, [tip.id]: cycle }
    localEvents.value.push({ cycle, text: tip.text, type: 'system' })
    if (tip.command) {
      localEvents.value.push({ cycle, text: `        try:  ${tip.command}`, type: 'system' })
    }
  },
)

// ── [MOVE] picker ────────────────────────────────────────────
// The same one-tap-to-move list the trace era's picker draws, reachable from the
// action bar (which is on screen at every breakpoint, unlike the map).
const showMovePicker = ref(false)
const movePickerZones = computed(() =>
  buildAdjacentZones(gameStore.player?.zone ?? '', mapZones.value),
)

function pickMoveZone(zoneId: string) {
  showMovePicker.value = false
  handleZoneClick(zoneId)
}

// ActionRow emits raw command strings; the walk-stop and no-adjacent-zones
// notices stay here (they write localEvents), everything else routes through
// the same handlers the old strip used.
function handleActionRowCommand(cmd: string) {
  if (cmd === '__no-adjacent-zones__') {
    localEvents.value.push({
      cycle: gameStore.cycle,
      text: 'No adjacent zones to move to from here.',
      type: 'system',
    })
    return
  }
  if (cmd.startsWith('move ')) {
    handleZoneClick(cmd.slice(5))
    return
  }
  if (
    cmd.startsWith('attack ') ||
    cmd === 'burn' ||
    cmd === 'tap' ||
    cmd === 'backup' ||
    cmd === 'grab' ||
    cmd === 'harden' ||
    cmd === 'surrender'
  ) {
    runSituational(cmd)
    return
  }
  handleQuickAction(cmd)
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
    // Used to print the raw adjacency list ("coldstore-t1-chaff, cache-seawall, …") — slugs
    // that appear nowhere else in the UI, off this game's map half the time,
    // and not clickable. It is a MOVE button; it now moves.
    if (!movePickerZones.value.length) {
      localEvents.value.push({
        cycle: gameStore.cycle,
        text: 'No adjacent zones to move to from here.',
        type: 'system',
      })
      return
    }
    showMovePicker.value = !showMovePicker.value
    return
  }

  if (cmd === 'ATK') {
    // Same picker as bare `attack` — the lowest-INTEG enemy hero in the zone.
    // The two surfaces must not disagree on what "attack" means: ATK used to
    // take the first enemy in object order, which could swing at a full-INTEG
    // hero while the nearly-dead one stood ignored.
    if (p) {
      const picked = pickAttackTargetString(p, gameStore.allPlayers)
      if ('error' in picked) {
        // No hero target — guide instead of failing silently, mirroring the
        // old ATK fallthrough copy.
        const zoneType = ZONE_MAP[p.zone]?.type
        const inBase = zoneType === 'anchor' || zoneType === 'base'
        localEvents.value.push({
          cycle: gameStore.cycle,
          text: inBase
            ? 'No targets here — move onto a route to fight (e.g.  move coldstore-cross ).'
            : 'No enemies in this zone — last-hit waves via STRIP / attack wave:N, or  attack <target> .',
          type: 'system',
        })
        return
      }
      handleCommand(`attack ${picked.target}`)
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
    cycle: gameStore.cycle,
    mode: gameStore.mode,
  }),
)

function runSituational(cmd: string) {
  const p = gameStore.player
  if (!p) return
  if (cmd === 'tap') handleCommand(`tap ${p.zone}`)
  else if (cmd === 'surrender') handleCommand('surrender confirm')
  else handleCommand(cmd) // burn / backup / cache / harden — bare commands (auto-resolved)
}

// ── Quick action button availability ─────────────────────────
// Greys out Q/W/E/R when on cooldown or unaffordable so players can see
// at a glance which abilities are actually castable this cycle.
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
      // The chip stays a bare cycle count so the dense bar keeps its width; the
      // seconds a player actually plans in go into the accessible name instead.
      result[upper] = {
        ready: false,
        label: `${upper}·${cd}`,
        aria: `${upper} ${name}, on cooldown ${cd} cycles, about ${(cd * CYCLE_DURATION_MS) / 1000} seconds`,
      }
      continue
    }
    const ability = HEROES[p.heroId]?.abilities[slot]
    if (ability && p.bw < getAbilityBwCost(ability, slot, p.level)) {
      result[upper] = { ready: false, label: upper, aria: `${upper} ${name}, not enough BW` }
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

// The accessible labels ActionRow renders per ability slot — same source as
// quickActionAria so the aria never drifts from the button state.
const abilityArias = computed(() => {
  const out: Record<string, string> = {}
  for (const slot of ['Q', 'W', 'E', 'R']) out[slot] = quickActionAria(slot)
  return out
})

// ── The rig's voice (R3-06) ─────────────────────────────────────
// The recommendation FocusBanner used to pin above the grid, printed into the
// scrollback as a `> ` line WHEN IT CHANGES (a per-cycle repeat is noise). The
// INTEG readout and threat verdict ride in the same line so nothing the banner
// showed is lost.
const rigRecommendation = computed(() => {
  const p = gameStore.player
  if (!p) return null
  const enemyCount = gameStore.enemyPlayers.filter((e) => e.zone === p.zone && e.alive).length
  const allyHeadcount = gameStore.allyPlayers.filter((a) => a.zone === p.zone && a.alive).length + 1
  const enemyIcePresent = gameStore.ice.some(
    (t) => t.zone === p.zone && t.alive && t.team !== p.team,
  )
  const threat = computeThreat(enemyCount, allyHeadcount, enemyIcePresent)
  const hasReadyAbility = ['Q', 'W', 'E', 'R'].some((s) => abilityButtonState.value[s]?.ready)
  const action = recommendAction({
    alive: p.alive,
    hpFraction: p.maxInteg > 0 ? p.integ / p.maxInteg : 0,
    threat,
    hasReadyAbility,
  })
  const integ = `${p.integ}/${p.maxInteg}`
  return `${action} · INTEG ${integ} · ${threat.label}${enemyCount ? ` (${enemyCount} hostile)` : ''}`
})

// The status-line helpers — the same values the rig line reads, exposed for
// StatusLines (one source, no drift).
const rigEnemyCount = computed(() => {
  const p = gameStore.player
  return p ? gameStore.enemyPlayers.filter((e) => e.zone === p.zone && e.alive).length : 0
})
const rigAllyHeadcount = computed(() => {
  const p = gameStore.player
  return p ? gameStore.allyPlayers.filter((a) => a.zone === p.zone && a.alive).length + 1 : 1
})
const rigEnemyIcePresent = computed(() => {
  const p = gameStore.player
  return p ? gameStore.ice.some((t) => t.zone === p.zone && t.alive && t.team !== p.team) : false
})
const rigHasReadyAbility = computed(() =>
  ['Q', 'W', 'E', 'R'].some((s) => abilityButtonState.value[s]?.ready),
)
const netLeadText = computed(() => {
  const lead = scripLead(gameStore.netWorth.chaff, gameStore.netWorth.audit)
  return lead.leader === null
    ? 'even'
    : `${lead.leader === 'chaff' ? 'CHF' : 'AUD'} +${formatScripShort(lead.amount)}`
})

watch(rigRecommendation, (rec, prev) => {
  if (!rec || rec === prev) return
  localEvents.value.push({ cycle: gameStore.cycle, text: rec, type: 'rig' })
})

// The `net` command's objective segment — tenant / caches / backup in one
// line, from the same pure formatters the ticker used (R3-08).
const backupHolder = computed(() => {
  for (const p of Object.values(gameStore.allPlayers)) {
    const buff = (p.buffs ?? []).find((b) => b.id === 'backup')
    if (buff) {
      const name = (p.heroId && HEROES[p.heroId]?.name) || p.name
      return { name, cyclesRemaining: buff.cyclesRemaining }
    }
  }
  return null
})

function formatObjectivesLine(): string {
  const t = gameStore.tenant ? formatTenant(gameStore.tenant, gameStore.cycle).label : 'TENANT —'
  const c = formatCaches(gameStore.caches, gameStore.cycle).label
  const b = formatBackup(gameStore.backup, backupHolder.value).label
  return `${t} · ${c} · ${b}`
}

// ── Item use from inventory bar / keybinds ───────────────────
function handleItemUse(_slotIndex: number, itemId: string) {
  if (!gameStore.player?.alive) {
    localEvents.value.push({
      cycle: gameStore.cycle,
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

// The cycle of the player's most recent death. `death` is emitted for EVERY
// death — including one with no eligible killer — so it is the only reliable
// anchor. Everything below is scoped to it: the events list is a 200-entry ring
// buffer, and the overlay used to scan it unbounded, so a kill from ten minutes
// ago could be reported as the cause of the death on screen right now.
const lastDeathTick = computed<number | null>(() => {
  const pid = gameStore.playerId
  if (!pid) return null
  for (let i = gameStore.events.length - 1; i >= 0; i--) {
    const e = gameStore.events[i]!
    if (e.type === 'death' && e.payload.playerId === pid) return e.cycle
  }
  return null
})

const killerName = computed(() => {
  const pid = gameStore.playerId
  const deathCycle = lastDeathTick.value
  if (!pid || deathCycle == null) return null

  let attributed: string | null = null
  let lastDamaged: string | null = null
  for (let i = gameStore.events.length - 1; i >= 0; i--) {
    const e = gameStore.events[i]!
    if (e.cycle < deathCycle) break
    if (e.type === 'kill' && e.payload.victimId === pid && e.payload.killerId) {
      attributed = e.payload.killerId as string
      break
    }
    // ICE, waves and neutrals are not eligible killers (handleDeaths only
    // accepts a killerId that resolves to a player), so an NPC kill produces a
    // `death` with no `kill` at all. Since NPC hits now emit `damage`, the last
    // thing that hit us on the death cycle is the honest answer — without it the
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
    :data-density="settings.hud.density"
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
         range, juked target, firewalled Terminal, not enough BW, …) that would
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
        <p v-if="gameStore.player.respawnCycle" class="mt-5 t-body text-text-dim">
          Respawning in
          <span class="text-chaff text-glow-chaff font-bold t-mono-num">{{
            countdownText(gameStore.player.respawnCycle - gameStore.cycle)
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
          <p v-if="buybackInfo.cooldownCycles > 0" class="t-caption text-audit">
            Buyback on cooldown — {{ countdownText(buybackInfo.cooldownCycles) }} remaining
          </p>
          <p v-else-if="buybackInfo.shortfall > 0" class="t-caption text-text-dim">
            Need {{ buybackInfo.shortfall }}sc more ({{ gameStore.player.scrip }}sc /
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
    <KillFeed class="game-grid__killfeed" :entries="killFeed" :current-cycle="currentCycle" />

    <!-- Critical-INTEG red vignette pulse over the whole screen -->
    <div
      v-if="heroCritical"
      class="critical-vignette anim-glow-pulse pointer-events-none absolute inset-0 z-[15]"
      aria-hidden="true"
    />

    <div ref="barEl" class="game-grid__bar">
      <GameStateBar
        :cycle="currentCycle"
        :game-time="gameTime"
        :scrip="playerScrip"
        :kills="playerKills"
        :deaths="playerDeaths"
        :assists="playerAssists"
        :hero-id="gameStore.player?.heroId ?? undefined"
        :connected="connected"
        :reconnecting="reconnecting"
        :latency="latency"
        :time-of-day="gameStore.timeOfDay"
        :day-night-cycle="gameStore.dayNightCycle"
        :teams="gameStore.teams"
        :terminals="terminals"
        :net-worth-chaff="gameStore.netWorth.chaff"
        :net-worth-audit="gameStore.netWorth.audit"
        :kda-pop-key="kdaPopKey"
      />

      <!-- Tutorial banner: current step's hint + the staggered-unlock checklist -->
      <TutorialHint v-if="gameStore.mode === 'tutorial'" :step="gameStore.tutorialStep ?? 0" />

      <!-- Desktop-only shop/scoreboard openers (fine pointer): the ActionRow
           that carries SHOP/SCORE is display:none there (R3-09), and the
           keyboard-only paths (Esc then S / hold Tab) were undiscoverable.
           The prompt keeps focus ownership; these are just visible handles. -->
      <div class="desktop-overlay-chips" data-testid="desktop-overlay-chips">
        <button
          type="button"
          data-testid="desktop-shop-chip"
          :aria-pressed="showShop"
          @click="showShop = !showShop"
        >
          [SHOP]
        </button>
        <button
          type="button"
          data-testid="desktop-score-chip"
          :aria-pressed="showScoreboard"
          @click="showScoreboard = true"
        >
          [SCORE]
        </button>
      </div>

      <!-- Action-focus banner (HUD setting B): at-a-glance threat + what to do -->
    </div>

    <!-- Left column: current-zone tactics (top) + strategic net readout (below).
         Zone lives here — not the right rail — so it can't be squeezed to zero
         height between the fixed-size Hero Status and Map panels. It is capped
         (max-h) + shrink-0 so a busy zone scrolls internally instead of starving
         the net readout, and a quiet zone stays compact. -->
    <!-- Status lines replaced the panel chrome (R3-08): hop + threat, net
         lead, the cycle clock — no borders. -->
    <div class="game-grid__war">
      <StatusLines
        :trace="traceModel"
        :hp-fraction="
          gameStore.player && gameStore.player.maxInteg > 0
            ? gameStore.player.integ / gameStore.player.maxInteg
            : 0
        "
        :alive="gameStore.isAlive"
        :net-lead="netLeadText"
        :next-cycle-in="gameStore.nextCycleIn"
        :cycle="gameStore.cycle"
        :can-act="gameStore.canAct"
        :enemy-count="rigEnemyCount"
        :ally-headcount="rigAllyHeadcount"
        :enemy-ice-present="rigEnemyIcePresent"
        :has-ready-ability="rigHasReadyAbility"
      />
    </div>

    <!-- Center stage: the stream owns the full column. -->
    <TerminalPanel title="STREAM" class="game-grid__log min-h-0">
      <!-- `ref` here reaches Stream's root; the overlay lanes need the scrolling
           BODY's position, which sits below Stream's own filter row. -->
      <div ref="streamWrapEl" class="flex h-full min-h-0 flex-col">
        <Stream :events="combatEvents" />
      </div>
    </TerminalPanel>

    <!-- Right rail: TRACE (route as hop depth) + DECK. One layout — no
         classic / map-centric toggle (R3-10). -->
    <div class="game-grid__rail">
      <!-- TRACE never leaves the screen: own non-scrolling grid row
           (.rail-map); DECK and the rest share what is left and scroll. -->
      <TerminalPanel title="TRACE" class="rail-map">
        <TraceRail :trace="traceModel" />
      </TerminalPanel>

      <!-- Everything below the board shares the remaining height and scrolls
           together, so the board itself never has to. -->
      <div class="rail-scroll">
        <TerminalPanel title="DECK" :variant="heroDanger ? 'danger' : 'default'" class="shrink-0">
          <div class="relative">
            <!-- Damage flash: a stateless keyed overlay so Deck (and its
               canvas avatar + open tooltips) is NOT remounted on every hit. -->
            <div
              :key="heroFlashKey"
              class="anim-flash-damage pointer-events-none absolute inset-0 z-10"
              :style="{ '--hit-intensity': hitIntensity }"
              data-testid="hero-hit-flash"
              aria-hidden="true"
            />
            <Deck
              v-if="heroData"
              :hero="heroData"
              :hero-id="gameStore.player?.heroId ?? undefined"
              @cast-ability="handleQuickAction"
            />
            <div v-else class="p-2 text-[0.8rem] text-text-dim">&gt;_ awaiting hero data...</div>
          </div>
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
          :current-cycle="currentCycle"
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
          :scrip="playerScrip"
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
          :scrip="playerScrip"
          :can-buy="gameStore.canBuy"
          :recommended-items="recommendedShopItems"
          @buy="handleBuyItem"
          @unpin="unpinItem"
        />
      </div>
      <ActionRow
        :move-zones="movePickerZones"
        :situational="situationalActions"
        :abilities="abilityButtonState"
        :ability-arias="abilityArias"
        :shop-open="showShop"
        :scoreboard-open="showScoreboard"
        :can-buy="gameStore.canBuy"
        @command="handleActionRowCommand"
      />

      <!-- A queued walk is otherwise invisible: the order scrolls out of the log
           and the hero just drifts a zone per cycle with no way to call it off. -->
      <div
        v-if="walkReadout"
        class="flex items-center gap-2 px-2 pb-1 font-mono t-hud-sm text-self"
        data-testid="walk-strip"
      >
        <span>WALKING → {{ walkReadout.name }} · {{ walkReadout.ticks }}c</span>
        <button
          class="border border-border px-1.5 py-0.5 text-text-dim hover:text-text-primary active:bg-border"
          data-testid="walk-stop"
          aria-label="Stop walking"
          @click="stopWalking"
        >
          [stop]
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
        :cycle="gameStore.cycle"
        :mode="gameStore.mode"
        :neutrals="gameStore.neutrals"
        :tenant="gameStore.tenant ?? undefined"
        :waves="gameStore.waves"
        @submit="handleCommand"
      />
    </div>
  </div>
</template>

<style scoped>
/* Desktop: three columns — status lines (left) | STREAM (center) | TRACE + DECK
   rail (right). Phone collapses to a single column with ActionRow above the
   prompt (R3-04 / R3-08). */
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
  /* The desktop overlay chips sit at the bar's right edge. */
  display: flex;
  align-items: center;
}
.game-grid__bar > :first-child {
  flex: 1 1 auto;
  min-width: 0;
}
.desktop-overlay-chips {
  display: none;
}
@media (pointer: fine) {
  .desktop-overlay-chips {
    display: flex;
    gap: 0.25rem;
    padding: 0 0.5rem;
  }
  .desktop-overlay-chips button {
    font-family: var(--font-mono);
    font-size: 0.7rem;
    line-height: 1;
    padding: 0.35rem 0.5rem;
    color: var(--color-text-dim);
    border: 1px solid var(--color-border);
    background: var(--color-bg-secondary);
    white-space: nowrap;
  }
  .desktop-overlay-chips button:hover {
    color: var(--color-text-primary);
    border-color: var(--color-border-glow);
  }
  .desktop-overlay-chips button[aria-pressed='true'] {
    color: var(--color-text-primary);
    border-color: var(--color-ability);
  }
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

/* TRACE is pinned to row 1 so DECK cannot steal the spatial surface. The panel's
   own body scrolls (TerminalPanel), so content past the row height is reachable
   — what the phone breakpoint had wrong was the row's SHARE, not its overflow. */
.rail-map {
  grid-row: 1;
  overflow: hidden;
}

/* Everything below TRACE shares the remaining height and scrolls together. */
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
   Emphasize-vitals dims the strategic net readout and enlarges the action bar so
   the eye lands on INTEG / abilities; the column-widening only applies on desktop
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

/* Overlay lanes, stacked below the measured HUD bar (--hud-bar-h, published from
   the script). The fixed 4.25rem both of these used to sit at is 68px at the
   root font size — squarely on the focus banner and the cycle/scrip/KDA row. The
   fallback keeps the old placement if the measurement never arrives. */
.game-grid__killfeed {
  position: absolute;
  /* Below the STREAM's scrolling body when measured (see --stream-body-top),
     so neither lane can sit on the FEED filter chips. */
  top: calc(var(--stream-body-top, calc(var(--hud-bar-h, 4.25rem) + 2.75rem)) + 2rem);
  left: 50%;
  transform: translateX(-50%);
  z-index: 25;
  width: max-content;
  max-width: 92%;
}

/* The toast owns the lane directly under the stream's controls; the kill feed
   sits below it. Both used to be anchored to the bar alone, which put them on
   top of the STREAM panel's title and FEED filter row. */
.game-grid :deep(.announcement-toast) {
  top: calc(var(--stream-body-top, calc(var(--hud-bar-h, 4.25rem) + 0.5rem)) + 0.25rem);
}

/* Death is up to 108 seconds long. A 70%-opaque full-bleed scrim that also ate
   every click turned that into a blackout: the TRACE, the stream, the deck and
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
  /* Tablet: combat log spans full width as the primary surface; Zone + net readout
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
     rail stacks above the Zone + net readout column, each scrolling internally. */
  .game-grid {
    grid-template-columns: 1fr;
    /* Weights, measured at 390x844 with the command block at its tallest (items
       + quick buy + a pending talent choice): the rail — TRACE *and* DECK, i.e.
       where you are, who is in contact, and your own INTEG/BW/abilities — was
       on 1.1fr and landed at 109px, while the three-line status advisory beside
       it was on 1fr and took 99px. The rail carries the match state and gets the
       weight to match; the advisory keeps enough for its wrapped lines. */
    grid-template-rows:
      auto minmax(0, 1.7fr) minmax(0, 1.9fr)
      minmax(0, 0.75fr) auto;
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
