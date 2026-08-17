<script setup lang="ts">
import { HEROES, HERO_IDS } from '~~/shared/constants/heroes'
import { POSTURE_META, POSTURE_ORDER } from '~~/shared/constants/postures'
import { ITEMS } from '~~/shared/constants/items'
import {
  CYCLE_DURATION_MS,
  ACTION_WINDOW_MS,
  PASSIVE_SCRIP_PER_CYCLE,
  WAVE_SCRIP,
  KILL_BOUNTY_BASE,
  ASSIST_SCRIP,
  ICE_SCRIP,
  STARTING_SCRIP,
  MAX_ITEMS,
  MAX_LEVEL,
  BASIC_ABILITY_RANKS,
  ULTIMATE_RANKS,
  ULTIMATE_UNLOCK_LEVEL,
  RESPAWN_BASE_CYCLES,
  RESPAWN_PER_LEVEL_CYCLES,
  RESPAWN_FREE_LEVELS,
  BUYBACK_COOLDOWN_CYCLES,
  CAMTAP_DURATION_CYCLES,
  WARD_LIMIT_PER_TEAM,
  WAVE_INTERVAL_CYCLES,
  LINE_UNIT_HP,
  LINE_UNITS_PER_WAVE,
  SWEEP_UNITS_PER_WAVE,
  BREACH_WAVE_INTERVAL,
  BREACH_DURATION_CYCLES,
  BREACH_COOLDOWN_CYCLES,
  BREACH_BW_COST,
  ICE_HP_T1,
  ICE_HP_T2,
  ICE_HP_T3,
  ICE_ATTACK,
  TERMINAL_HP,
  TENANT_BASE_HP,
  FOUNTAIN_HEAL_PER_CYCLE_PERCENT,
  FOUNTAIN_BW_PER_CYCLE_PERCENT,
  SURRENDER_MIN_CYCLE,
  SURRENDER_VOTE_THRESHOLD,
  CACHE_INTERVAL_CYCLES,
  CACHE_DURATION_CYCLES,
  HARDEN_DURATION_CYCLES,
  HARDEN_COOLDOWN_CYCLES,
  CLOT_RING_REGEN_PERCENT,
  DRIP_MASK_REGEN_PERCENT,
  REGEN_CACHE_HEAL_PERCENT,
  BURN_HP_THRESHOLD,
  STRIP_HP_THRESHOLD,
  BURN_SCRIP_RATIO,
  BURN_XP_RATIO,
  WAVE_SCRIP_MIN,
  WAVE_SCRIP_MAX,
  WAVE_XP,
  WAVE_XP_SHARED,
} from '~~/shared/constants/balance'
import { talentUnlockLevel } from '~~/shared/constants/talents'
import { RANK_TIERS } from '~~/shared/constants/ranks'
import { useStartTutorial } from '~/composables/useStartTutorial'

const {
  starting: startingTutorial,
  error: tutorialError,
  start: startTutorial,
} = useStartTutorial()

// ── Derived display values ───────────────────────────────────────
// Everything below is computed from the live engine constants so the
// guide can never drift from the actual game again.

const tickSeconds = CYCLE_DURATION_MS / 1000
const actionWindowSeconds = ACTION_WINDOW_MS / 1000
const heroCount = HERO_IDS.length
const wardCost = ITEMS.camtap!.cost
const surrenderMinutes = (SURRENDER_MIN_CYCLE * tickSeconds) / 60
const surrenderPercent = Math.round(SURRENDER_VOTE_THRESHOLD * 100)
const buybackCooldownMinutes = (BUYBACK_COOLDOWN_CYCLES * tickSeconds) / 60
const glyphCooldownMinutes = (HARDEN_COOLDOWN_CYCLES * tickSeconds) / 60

/** Respawn time in cycles for a given level — mirrors GameLoop's formula. */
function respawnCycles(level: number): number {
  return RESPAWN_BASE_CYCLES + RESPAWN_PER_LEVEL_CYCLES * Math.max(0, level - RESPAWN_FREE_LEVELS)
}

// Talent TIER ids (10/15/20/25) are not the levels they unlock at — the two
// parted ways when the tiers were pulled forward to match real match length.
// Read the levels so this sentence can't drift back into stating the tier ids.
const TALENT_TIER_IDS = [10, 15, 20, 25] as const
const talentLevels = TALENT_TIER_IDS.map(talentUnlockLevel)
const talentLevelList = `${talentLevels.slice(0, -1).join(', ')} and ${talentLevels[talentLevels.length - 1]}`
// Only worth explaining while the two sets of numbers actually differ.
const talentTierNote = talentLevels.some((lvl, i) => lvl !== TALENT_TIER_IDS[i])
  ? ' — the tier names stay 10/15/20/25 regardless'
  : ''

// Sustain / last-hitting numbers, derived so the two cards below can't drift.
const ringRegenPercent = Math.round(CLOT_RING_REGEN_PERCENT * 100)
const sobiRegenPercent = Math.round(DRIP_MASK_REGEN_PERCENT * 100)
const cacheRegenPercent = Math.round(REGEN_CACHE_HEAL_PERCENT * 100)
const stripHpPercent = Math.round(STRIP_HP_THRESHOLD * 100)
const burnHpPercent = Math.round(BURN_HP_THRESHOLD * 100)
const burnGold = Math.floor(((WAVE_SCRIP_MIN + WAVE_SCRIP_MAX) / 2) * BURN_SCRIP_RATIO)
const burnXp = Math.floor(WAVE_XP * BURN_XP_RATIO)

const quickStart = [
  {
    step: '1',
    title: 'Practice First',
    desc: 'Click PRACTICE VS BOTS. One route, verbs unlock as you go, no account required. FIND MATCH is the lobby queue for later — it is not the first walk.',
  },
  {
    step: '2',
    title: 'Get a Handle',
    desc: `Quick-match assigns you one of ${heroCount} operators — Q/W/E from level 1, the ultimate (R) at level ${ULTIMATE_UNLOCK_LEVEL}. Bots fill empty slots after ten seconds. There is no pick/ban screen on this path.`,
  },
  {
    step: '3',
    title: 'Leave the Anchor',
    desc: 'You start in your fountain (the anchor). Type move terminal — always YOUR terminal — then move coldstore-t2-chaff onto the route behind your first ICE. Walking onto T1 on cycle one is how you die.',
  },
  {
    step: '4',
    title: 'Farm Waves',
    desc: `Waves spawn every ${WAVE_INTERVAL_CYCLES} cycles. Last-hit them with attack wave:0 to earn ${WAVE_SCRIP}sc and XP.`,
  },
  {
    step: '5',
    title: 'Buy Items',
    desc: `You start with ${STARTING_SCRIP}sc. Return to base and open the SHOP (click it, or press Esc then S). You have ${MAX_ITEMS} inventory slots.`,
  },
  {
    step: '6',
    title: 'Fight & Push',
    desc: 'Use abilities on enemies and raze a route to its T3 ICE — that exposes the enemy Terminal. Destroy it to win.',
  },
]

const movementGuide = [
  {
    title: 'How Movement Works',
    items: [
      'The map is divided into zones (fountain, base, routes, silt, crossings)',
      `You walk one zone per cycle (${tickSeconds} seconds) — but you can order a move to ANY zone and your hero auto-paths there, cycle by cycle`,
      'Type move <zone-id> to move (e.g., move rookery-terminal, move coldstore-t3-chaff), or tap any zone on the map',
      'Issuing any new action cancels the walk; a new move order redirects it',
      'Shortcut: mv is the same as move (e.g., mv coldstore-t2-chaff)',
    ],
  },
  {
    title: 'Zone Naming Convention',
    items: [
      'Routes: seawall-t1-chaff, coldstore-t2-audit, shallows-t3-chaff (route-tier-team) — top is SEAWALL, mid is COLDSTORE, bot is SHALLOWS',
      'Crossings: seawall-cross, coldstore-cross, shallows-cross (the neutral ground between the two sides)',
      'Silt: silt-chaff-upper, silt-audit-lower (silt-team-side)',
      'Base & Fountain: rookery-terminal, rookery-anchor, landing-terminal, landing-anchor',
      'Special: hollow, cache-seawall, cache-shallows',
    ],
  },
  {
    title: 'Movement Tips',
    items: [
      `Fountain heals ${FOUNTAIN_HEAL_PER_CYCLE_PERCENT}% INTEG / ${FOUNTAIN_BW_PER_CYCLE_PERCENT}% BW per cycle — retreat there to recover`,
      'Fountain is only adjacent to your base (must go through base first)',
      `You can't move while dead — respawn takes ${RESPAWN_BASE_CYCLES} cycles plus ${RESPAWN_PER_LEVEL_CYCLES} per level after level ${RESPAWN_FREE_LEVELS}`,
      'Team-relative shortcuts: move terminal / move anchor always go to YOUR side, whichever team you are',
      'More aliases save typing: move coldstore (or cs) → coldstore-cross, move hollow → the Tenant pit; unambiguous prefixes work too',
    ],
  },
]

const commands = [
  {
    cmd: 'move <zone>',
    desc: 'Walk to any zone — one zone per cycle, auto-pathing until you arrive',
    example: 'move coldstore-t1-chaff',
    shortcuts: 'mv',
  },
  {
    cmd: 'attack [target]',
    desc: 'Attack a target in your zone. Bare attack auto-hits the nearest enemy hero',
    example: 'attack wave:0',
    shortcuts: 'atk',
  },
  {
    cmd: 'burn [wave:N]',
    desc: 'Last-hit your OWN low-INTEG wave to burn the enemy its scrip. Bare burn auto-picks one',
    example: 'burn wave:0',
    shortcuts: '—',
  },
  {
    cmd: 'cast <q|w|e|r> [target]',
    desc: 'Use an ability. Bare `cast q` auto-picks a target; add one to aim it yourself',
    example: 'cast q',
    shortcuts: 'q, w, e, r',
  },
  {
    cmd: 'use <item>',
    desc: 'Use an active/consumable item. Offensive actives (Burnout, Hex…) auto-hit the nearest enemy',
    example: 'use trauma_patch',
    shortcuts: '—',
  },
  {
    cmd: 'buy <item>',
    desc: 'Buy an item (must be in base/fountain)',
    example: 'buy edge_kit',
    shortcuts: 'b',
  },
  {
    cmd: 'sell <item>',
    desc: 'Sell an item for 50% value',
    example: 'sell scrap_lot',
    shortcuts: '—',
  },
  {
    cmd: 'tap <zone>',
    desc: 'Place a camtap or sniffer (current or adjacent zone)',
    example: 'tap coldstore-cross',
    shortcuts: '—',
  },
  { cmd: 'grab', desc: 'Pick up the cache in your zone', example: 'grab', shortcuts: '—' },
  {
    cmd: 'backup',
    desc: 'Pick up the Backup in the Tenant pit',
    example: 'backup',
    shortcuts: '—',
  },
  {
    cmd: 'harden',
    desc: `Make your ice invulnerable for ${HARDEN_DURATION_CYCLES} cycles (one per team every ${glyphCooldownMinutes} min)`,
    example: 'harden',
    shortcuts: '—',
  },
  {
    cmd: 'chat <team|all> <msg>',
    desc: 'Send a chat message',
    example: 'chat team group mid',
    shortcuts: '—',
  },
  { cmd: 'ping <zone>', desc: 'Ping a map zone', example: 'ping coldstore-cross', shortcuts: '—' },
  {
    cmd: 'buyback',
    desc: 'Pay scrip to respawn instantly (while dead)',
    example: 'buyback',
    shortcuts: '—',
  },
  {
    cmd: 'surrender confirm',
    desc: `Vote to forfeit (after ${surrenderMinutes} min; ${surrenderPercent}% of team must agree)`,
    example: 'surrender confirm',
    shortcuts: '—',
  },
  {
    cmd: 'talent <10|15|20|25> <left|right>',
    desc: `Pick a talent — a one-time left/right choice. The tiers unlock at levels ${talentLevelList} (you still type talent 10|15|20|25)`,
    example: 'talent 10 left',
    shortcuts: '—',
  },
  {
    cmd: 'status / map / scan',
    desc: 'Print a quick readout (your stats / reachable zones / visible enemies). Free — costs no cycle',
    example: 'status',
    shortcuts: '—',
  },
  {
    cmd: 'who / net / look',
    desc: "More readouts: visible contacts with cooldowns (who) / macro state (net) / your zone's units (look). Free — costs no cycle",
    example: 'who',
    shortcuts: '—',
  },
]

const targeting = [
  { format: 'hero:<name>', desc: 'Target a hero by their hero ID', example: 'attack hero:daemon' },
  {
    format: 'wave:<index>',
    desc: 'Target a wave by index (0, 1, 2...)',
    example: 'attack wave:0',
  },
  {
    format: 'neutral:<index>',
    desc: 'Target a silt camp wave standing in your zone',
    example: 'attack neutral:0',
  },
  {
    format: 'ice:<zone>',
    desc: 'Target the ice in a zone',
    example: 'attack ice:coldstore-t1-audit',
  },
  {
    format: 'tenant',
    desc: 'Target Tenant — only from inside the pit. Killing him drops the Backup',
    example: 'attack tenant',
  },
  { format: 'self', desc: 'Target yourself (for self-cast abilities)', example: 'cast w self' },
  { format: '<hero-name>', desc: 'Shorthand for hero: prefix', example: 'attack daemon' },
]

/**
 * `probe` is the literal KeyboardEvent.key a row stands for. A component test
 * runs each one through routeGameKey — the router the game screen actually uses
 * — so this panel can neither advertise a binding that does nothing nor keep
 * one after it is dropped. Rows that belong to the command prompt rather than
 * the game (autocomplete, history) have no probe: routeGameKey isn't their
 * authority, CommandInput is.
 */
const keybinds: Array<{ key: string; probe: string | null; action: string }> = [
  {
    key: 'Esc',
    probe: null,
    action: 'Close suggestions → clear the prompt → release the keyboard',
  },
  { key: 'S', probe: 's', action: 'Toggle the shop' },
  { key: 'Q/W/E/R', probe: 'q', action: 'Quick-cast that ability' },
  { key: '1-6', probe: '1', action: 'Use the item in that inventory slot' },
  {
    key: 'Arrows',
    probe: 'ArrowUp',
    action: 'Move one hop along the trace (up = deeper, down = back)',
  },
  { key: 'Tab', probe: 'Tab', action: 'Hold to show the scoreboard' },
  { key: 'Tab (typing)', probe: null, action: 'Autocomplete the command' },
  { key: 'Up/Down (typing)', probe: null, action: 'Cycle through command history' },
]

const concepts = [
  {
    term: 'Cycles',
    icon: '>',
    desc: `TERMINA commits every instruction at once, ${tickSeconds} seconds wide — one cycle. You queue ONE action per cycle. The action window is ${actionWindowSeconds} seconds; your command resolves when the cycle commits.`,
  },
  {
    term: 'Scrip & Items',
    icon: '$',
    desc: `Earn scrip from wave last-hits (${WAVE_SCRIP}sc), hero kills (${KILL_BOUNTY_BASE}sc base + streak and comeback bonuses), assists (${ASSIST_SCRIP}sc split), and passive income (${PASSIVE_SCRIP_PER_CYCLE}sc/cycle). Spend scrip at the shop in your base. Max ${MAX_ITEMS} items.`,
  },
  {
    term: 'No Feed',
    icon: '?',
    desc: 'You have no feed on ground you do not hold. You see your own zone and the zones next to it, your allies, your ice, and anywhere you have a camtap. Enemies outside that are not on your screen at all.',
  },
  {
    term: 'Wave Waves',
    icon: '#',
    desc: `AI waves spawn every ${WAVE_INTERVAL_CYCLES} cycles in each lane. ${LINE_UNITS_PER_WAVE} line + ${SWEEP_UNITS_PER_WAVE} sweep per wave (breach every ${BREACH_WAVE_INTERVAL}th wave). Last-hit them for scrip. They push lanes automatically.`,
  },
  {
    term: 'ICE',
    icon: '!',
    desc: `Each lane has 3 ice tiers per side: T1 ${ICE_HP_T1} INTEG, T2 ${ICE_HP_T2} INTEG, T3 ${ICE_HP_T3} INTEG. ICE hit for ${ICE_ATTACK} and prioritize heroes who attack under them, then waves. A ice kill splits ${ICE_SCRIP}sc among allies in the zone.`,
  },
  {
    term: 'The Terminal',
    icon: '@',
    desc: `Each base houses its team's Terminal (${TERMINAL_HP} INTEG). It is invulnerable until at least one of that team's T3 ice falls; once exposed, heroes and waves in the base can attack it.`,
  },
  {
    term: 'Levels & XP',
    icon: '^',
    desc: `Gain XP from wave kills and hero kills, up to level ${MAX_LEVEL}. Q/W/E are usable from level 1 and get stronger at levels ${BASIC_ABILITY_RANKS.join(', ')}. Your ultimate (R) unlocks at level ${ULTIMATE_UNLOCK_LEVEL} and strengthens at ${ULTIMATE_RANKS.slice(1).join(' and ')}. Reaching levels ${talentLevelList} each grants a one-time talent choice (a left/right power pick): use \`talent <tier> <left|right>\`${talentTierNote}.`,
  },
  {
    term: 'Abilities',
    icon: '*',
    desc: 'Each hero has a passive + 4 active abilities (Q/W/E/R). Abilities cost BW and have cooldowns measured in cycles. Cast with: cast q [target]',
  },
  {
    term: 'Sustain',
    icon: '+',
    desc: `There is NO innate regeneration — an INTEG or BW bar you spend stays spent. The only recoveries are: your fountain (${FOUNTAIN_HEAL_PER_CYCLE_PERCENT}% INTEG / ${FOUNTAIN_BW_PER_CYCLE_PERCENT}% BW per cycle, and only while out of combat), Trauma Patch and Charge Tab (consumables you carry), Clot Ring (${ringRegenPercent}% max INTEG per cycle) and Drip Mask (${sobiRegenPercent}% max BW per cycle), and the regeneration cache (${cacheRegenPercent}% of both per cycle). Buy one of those before you plan to hold a route — otherwise every trade is one-way and the walk home costs you the wave.`,
  },
  {
    term: 'Stripping & Burning',
    icon: '/',
    desc: `Only the killing blow pays scrip: chip a wave to 1 INTEG and someone on your route takes it, you get nothing. You do NOT have to out-damage a wave unit to take it — a line unit spawns with ${LINE_UNIT_HP} INTEG and grows all match, while you hit for 30–70 once per cycle. Instead, wait for the window: once a unit is at or below ${stripHpPercent}% of the INTEG it spawned with, it is carrying more than it can defend and attack wave:0 takes the payload outright, for ${WAVE_SCRIP}sc and ${WAVE_XP} XP (allies in the zone share ${WAVE_XP_SHARED} XP, so standing on the route is never worth zero). The ActionRow says which: STRIP means a unit is in the window right now, HIT means you would only be chipping. Burning is the mirror on your own side — once one of YOUR units drops below ${burnHpPercent}% INTEG, burn wave:0 takes it out so the enemy gets nothing, and you keep ${burnGold}sc and ${burnXp} XP. Prefer STRIP / BURN on the ActionRow (or look then attack wave:N) over guessing an index: wave:N counts the living waves in your zone, so N shifts every cycle as waves die and waves spawn.`,
  },
  {
    term: 'Death & Respawn',
    icon: 'X',
    desc: `When you die, you respawn at your fountain after ${RESPAWN_BASE_CYCLES} cycles + ${RESPAWN_PER_LEVEL_CYCLES} per level after level ${RESPAWN_FREE_LEVELS} (${respawnCycles(1)} cycles at level 1, ${respawnCycles(10)} at level 10). Buyback with scrip to return instantly (${buybackCooldownMinutes} min cooldown).`,
  },
  {
    term: 'Wards',
    icon: 'o',
    desc: `CAMTAPs (${wardCost}sc) grant vision of a zone for ${CAMTAP_DURATION_CYCLES} cycles. Max ${WARD_LIMIT_PER_TEAM} active per team. Place with: tap <zone>. Essential for map control.`,
  },
  {
    term: 'Tenant & Caches',
    icon: '%',
    desc: `Tenant (${TENANT_BASE_HP}+ INTEG) lurks in hollow and drops the Backup when killed — pick it up with backup. Power-up caches spawn at cache-seawall/cache-shallows every ${CACHE_INTERVAL_CYCLES} cycles and expire after ${CACHE_DURATION_CYCLES}; pick them up with grab.`,
  },
  {
    term: 'Win Condition',
    icon: 'W',
    desc: `Destroying any of a team's T3 ice exposes their Terminal (${TERMINAL_HP} INTEG) in their base. Destroy the enemy Terminal to win. Teams may also surrender after ${surrenderMinutes} minutes with a ${surrenderPercent}% vote.`,
  },
  {
    term: 'BREACH',
    icon: 'B',
    desc: `Targets start closed. Code damage is halved into a closed target and hard control fails outright. breach <hero> opens a ${BREACH_DURATION_CYCLES}-cycle window for your whole crew (${BREACH_BW_COST} BW, ${BREACH_COOLDOWN_CYCLES}-cycle cooldown). Kinetic never needs access. If you are the one opened, breach self flushes it.`,
  },
  {
    term: 'Two slots',
    icon: '=',
    desc: 'Each cycle has two slots: MAIN (move, attack, cast, buy, burn, tap) and RIG (use <item>). An item active and an ability can fire in the SAME cycle — that is the combo. The HUD shows MAIN and RIG as open or committed.',
  },
  {
    term: 'Matchmaking',
    icon: 'Q',
    desc: 'The live path is quick-match: you search, bots fill after ten seconds, heroes are assigned. A 5v5 snake draft is not live yet. Party co-op puts your crew on CHAFF with bots filling the rest.',
  },
  {
    term: 'Seasons & Ranks',
    icon: 'S',
    desc: `The competitive ladder resets each season. Ranked games (no bots) move your seasonal rating; from it you earn a rank — ${RANK_TIERS.map((t) => t.name).join(' → ')}. The leaderboard shows the current season; your lifetime rating is tracked separately.`,
  },
  {
    term: 'Parties & Co-op',
    icon: '&',
    desc: "Create a party from the lobby and share the 5-letter code with friends (up to 5). The leader can start a co-op game: your party takes Chaff and bots fill the rest — a no-pressure way to play together (co-op games don't affect your rating).",
  },
  {
    term: 'Guilds',
    icon: 'G',
    desc: 'Found or join a guild to get a tag that rides next to your name on the leaderboard and your profile. Guilds are persistent — a home for your crew across seasons.',
  },
]

// Posture groups — what a player picks ON (B2a). Same source as the pick
// screen, /cast and /lore, so the teaching surface can't drift from the
// roster it teaches.
const postureGroups = POSTURE_ORDER.map((posture) => ({
  posture,
  label: POSTURE_META[posture].label,
  blurb: POSTURE_META[posture].blurb,
  heroes: Object.values(HEROES)
    .filter((h) => h.posture === posture)
    .map((h) => h.name)
    .join(', '),
})).filter((g) => g.heroes.length > 0)
</script>

<template>
  <div class="mx-auto mt-4 flex max-w-[850px] flex-col gap-4 pb-8">
    <header class="border-b border-border pb-2">
      <h1 class="text-lg font-bold tracking-widest text-chaff">&gt;_ HOW TO PLAY</h1>
      <p class="mt-1 text-[0.78rem] text-text-dim">
        Everything you need before your first match — movement, commands, targeting, and the
        concepts that win games on the 4-second scheduler.
      </p>
    </header>

    <!-- Quick Start -->
    <TerminalPanel title="Quick Start Guide" title-as="h2">
      <div class="mb-2 border-b border-border pb-2">
        <span class="text-[0.8rem] text-text-dim">&gt;_ cat /usr/share/termina/quickstart.txt</span>
      </div>
      <div class="flex flex-col gap-2">
        <div v-for="s in quickStart" :key="s.step" class="flex gap-3">
          <span class="w-6 shrink-0 text-center text-[0.85rem] font-bold text-ability">{{
            s.step
          }}</span>
          <div class="min-w-0">
            <span class="text-[0.85rem] font-bold text-chaff">{{ s.title }}</span>
            <p class="text-[0.8rem] text-text-dim">{{ s.desc }}</p>
          </div>
        </div>
      </div>
    </TerminalPanel>

    <!-- Movement Guide -->
    <TerminalPanel title="Movement & Navigation" title-as="h2">
      <div class="mb-2 border-b border-border pb-2">
        <span class="text-[0.8rem] text-text-dim">&gt;_ man move</span>
      </div>

      <!-- Interactive map primer: explore the real topology + feel adjacency
           before a live game. Click a dashed zone to hop one zone per cycle. -->
      <div class="mb-4">
        <div class="mb-1.5 text-[0.85rem] font-bold text-gold">Explore the Map</div>
        <ClientOnly>
          <MapPrimer />
          <template #fallback>
            <div
              class="flex h-[460px] items-center justify-center border border-border text-text-dim"
            >
              &gt;_ loading map…
            </div>
          </template>
        </ClientOnly>
      </div>

      <div class="flex flex-col gap-4">
        <div v-for="section in movementGuide" :key="section.title">
          <div class="mb-1.5 text-[0.85rem] font-bold text-gold">{{ section.title }}</div>
          <ul class="flex flex-col gap-1 pl-3">
            <li v-for="(item, i) in section.items" :key="i" class="text-[0.8rem] text-text-dim">
              <span class="mr-1.5 text-ability">-</span>{{ item }}
            </li>
          </ul>
        </div>
      </div>
      <!-- Example movement path -->
      <div class="mt-3 border-t border-border pt-3">
        <div class="mb-1 text-[0.8rem] font-bold text-gold">
          Example: Getting to Mid Lane (Chaff)
        </div>
        <div class="flex flex-wrap items-center gap-1 text-[0.75rem]">
          <span class="border border-border bg-bg-secondary px-1.5 py-0.5 text-chaff"
            >rookery-anchor</span
          >
          <span class="text-text-dim">&rarr;</span>
          <span class="border border-border bg-bg-secondary px-1.5 py-0.5 text-ability"
            >move rookery-terminal</span
          >
          <span class="text-text-dim">&rarr;</span>
          <span class="border border-border bg-bg-secondary px-1.5 py-0.5 text-ability"
            >move coldstore-t3-chaff</span
          >
          <span class="text-text-dim">&rarr;</span>
          <span class="border border-border bg-bg-secondary px-1.5 py-0.5 text-ability"
            >move coldstore-t2-chaff</span
          >
          <span class="text-text-dim">&rarr;</span>
          <span class="border border-border bg-bg-secondary px-1.5 py-0.5 text-ability"
            >move coldstore-t1-chaff</span
          >
          <span class="text-text-dim">&rarr;</span>
          <span class="border border-border bg-bg-secondary px-1.5 py-0.5 text-ability"
            >move coldstore-cross</span
          >
          <span class="text-text-dim">&rarr;</span>
          <span class="border border-border bg-bg-secondary px-1.5 py-0.5 text-gold"
            >coldstore-cross</span
          >
        </div>
        <p class="mt-1 text-[0.75rem] text-text-dim">
          Each arrow = 1 cycle ({{ tickSeconds }} seconds). This path takes 5 cycles ({{
            5 * tickSeconds
          }}
          seconds) to reach mid river from fountain.
        </p>
      </div>
    </TerminalPanel>

    <!-- Commands Reference -->
    <TerminalPanel title="Command Reference" title-as="h2">
      <div class="mb-2 border-b border-border pb-2">
        <span class="text-[0.8rem] text-text-dim">&gt;_ help --all</span>
      </div>
      <!-- The command table has whitespace-nowrap cells; let it scroll inside
           the panel on narrow phones instead of widening the page. -->
      <div class="overflow-x-auto">
        <table class="w-full table-fixed border-collapse break-words text-xs">
          <caption class="sr-only">
            In-game command reference
          </caption>
          <thead>
            <tr>
              <th
                scope="col"
                class="border-b border-border px-1.5 py-1 text-left font-normal text-text-dim"
              >
                Command
              </th>
              <th
                scope="col"
                class="border-b border-border px-1.5 py-1 text-left font-normal text-text-dim"
              >
                Description
              </th>
              <th
                scope="col"
                class="border-b border-border px-1.5 py-1 text-left font-normal text-text-dim"
              >
                Example
              </th>
              <th
                scope="col"
                class="border-b border-border px-1.5 py-1 text-left font-normal text-text-dim"
              >
                Shortcuts
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in commands" :key="c.cmd">
              <th
                scope="row"
                class="border-b border-border/50 px-1.5 py-1 text-left font-normal text-ability"
              >
                {{ c.cmd }}
              </th>
              <td class="border-b border-border/50 px-1.5 py-1">{{ c.desc }}</td>
              <td class="border-b border-border/50 px-1.5 py-1 text-text-dim">{{ c.example }}</td>
              <td class="border-b border-border/50 px-1.5 py-1 text-gold">{{ c.shortcuts }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </TerminalPanel>

    <!-- Targeting -->
    <TerminalPanel title="Targeting System" title-as="h2">
      <div class="mb-2 border-b border-border pb-2">
        <span class="text-[0.8rem] text-text-dim">&gt;_ man targeting</span>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full table-fixed border-collapse break-words text-xs">
          <caption class="sr-only">
            Targeting format reference
          </caption>
          <thead>
            <tr>
              <th
                scope="col"
                class="border-b border-border px-1.5 py-1 text-left font-normal text-text-dim"
              >
                Format
              </th>
              <th
                scope="col"
                class="border-b border-border px-1.5 py-1 text-left font-normal text-text-dim"
              >
                Description
              </th>
              <th
                scope="col"
                class="border-b border-border px-1.5 py-1 text-left font-normal text-text-dim"
              >
                Example
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in targeting" :key="t.format">
              <th
                scope="row"
                class="border-b border-border/50 px-1.5 py-1 text-left font-normal text-ability"
              >
                {{ t.format }}
              </th>
              <td class="border-b border-border/50 px-1.5 py-1">{{ t.desc }}</td>
              <td class="border-b border-border/50 px-1.5 py-1 text-text-dim">{{ t.example }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </TerminalPanel>

    <!-- Keyboard Shortcuts -->
    <TerminalPanel title="Keyboard Shortcuts" title-as="h2">
      <!-- Stated once, at panel level: the game keys below are live only while
           the command prompt does NOT have focus, and it takes focus by default.
           Documenting them without this read as eight broken keys. -->
      <p class="mb-2 border-b border-border pb-2 text-[0.75rem] leading-relaxed text-text-dim">
        The command prompt takes focus first, and while it has focus it keeps every keystroke —
        that's what lets you type <span class="text-ability">sell</span>,
        <span class="text-ability">tap</span> or <span class="text-ability">surrender</span>. Press
        <span class="text-ability">Esc</span> on an empty prompt to hand the keyboard to the game:
        the prompt harden changes from <span class="text-ability">&gt;_</span> to
        <span class="text-ability">[KEYS]</span> and the keys below become live. Click the prompt to
        type again.
      </p>
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div
          v-for="k in keybinds"
          :key="k.key"
          class="border border-border bg-bg-secondary p-2 text-center"
        >
          <div class="text-[0.85rem] font-bold text-ability">{{ k.key }}</div>
          <div class="text-[0.7rem] text-text-dim">{{ k.action }}</div>
        </div>
      </div>
    </TerminalPanel>

    <!-- Game Concepts -->
    <TerminalPanel title="Game Concepts" title-as="h2">
      <div class="mb-2 border-b border-border pb-2">
        <span class="text-[0.8rem] text-text-dim">&gt;_ cat /etc/termina/rules.conf</span>
      </div>
      <div class="grid gap-3 sm:grid-cols-2">
        <div v-for="c in concepts" :key="c.term" class="border border-border bg-bg-secondary p-2">
          <div class="mb-1 flex items-center gap-2">
            <span class="w-5 text-center text-[0.85rem] font-bold text-ability">{{ c.icon }}</span>
            <span class="text-[0.85rem] font-bold text-gold">{{ c.term }}</span>
          </div>
          <p class="pl-7 text-[0.75rem] leading-relaxed text-text-dim">{{ c.desc }}</p>
        </div>
      </div>
    </TerminalPanel>

    <!-- Postures -->
    <TerminalPanel title="Postures" title-as="h2">
      <div class="mb-2 border-b border-border pb-2">
        <span class="text-[0.8rem] text-text-dim">&gt;_ ls /cast/postures/</span>
      </div>
      <div class="grid gap-2 sm:grid-cols-2">
        <div
          v-for="r in postureGroups"
          :key="r.posture"
          class="border border-border bg-bg-secondary p-2"
        >
          <div class="mb-1 flex items-center gap-2">
            <span class="text-[0.85rem] font-bold text-ability">{{ r.label }}</span>
          </div>
          <p class="text-[0.75rem] text-text-dim">{{ r.blurb }}</p>
          <div class="mt-1 text-[0.7rem] text-gold">{{ r.heroes }}</div>
        </div>
      </div>
    </TerminalPanel>

    <!-- Ready CTA -->
    <TerminalPanel title="Ready?" title-as="h2">
      <div class="flex flex-col items-center gap-4 py-4">
        <span class="text-[0.8rem] text-text-dim">&gt;_ tutorial_complete. deploy --force</span>
        <span class="text-lg font-bold tracking-widest text-chaff">READY TO PLAY?</span>
        <div class="flex flex-wrap justify-center gap-3">
          <AsciiButton
            :label="startingTutorial ? 'STARTING…' : 'PRACTICE VS BOTS'"
            :disabled="startingTutorial"
            variant="primary"
            data-testid="start-tutorial"
            @click="startTutorial"
          />
          <AsciiButton label="ENTER THE TERMINAL" variant="ghost" to="/lobby" />
        </div>
        <InlineError :message="tutorialError" />
      </div>
    </TerminalPanel>
  </div>
</template>
