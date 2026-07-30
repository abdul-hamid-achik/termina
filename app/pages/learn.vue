<script setup lang="ts">
import type { HeroRole } from '~~/shared/types/hero'
import { HEROES, HERO_IDS } from '~~/shared/constants/heroes'
import { ITEMS } from '~~/shared/constants/items'
import {
  TICK_DURATION_MS,
  ACTION_WINDOW_MS,
  PASSIVE_GOLD_PER_TICK,
  CREEP_GOLD,
  KILL_BOUNTY_BASE,
  ASSIST_GOLD,
  ICE_GOLD,
  STARTING_GOLD,
  MAX_ITEMS,
  MAX_LEVEL,
  BASIC_ABILITY_RANKS,
  ULTIMATE_RANKS,
  ULTIMATE_UNLOCK_LEVEL,
  RESPAWN_BASE_TICKS,
  RESPAWN_PER_LEVEL_TICKS,
  RESPAWN_FREE_LEVELS,
  BUYBACK_COOLDOWN_TICKS,
  OBSERVER_WARD_DURATION_TICKS,
  WARD_LIMIT_PER_TEAM,
  CREEP_WAVE_INTERVAL_TICKS,
  MELEE_CREEP_HP,
  MELEE_CREEPS_PER_WAVE,
  RANGED_CREEPS_PER_WAVE,
  SIEGE_CREEP_WAVE_INTERVAL,
  ICE_HP_T1,
  ICE_HP_T2,
  ICE_HP_T3,
  ICE_ATTACK,
  ANCIENT_HP,
  TENANT_BASE_HP,
  FOUNTAIN_HEAL_PER_TICK_PERCENT,
  FOUNTAIN_MANA_PER_TICK_PERCENT,
  SURRENDER_MIN_TICK,
  SURRENDER_VOTE_THRESHOLD,
  RUNE_INTERVAL_TICKS,
  RUNE_DURATION_TICKS,
  GLYPH_DURATION_TICKS,
  GLYPH_COOLDOWN_TICKS,
  RING_OF_HEALTH_REGEN_PERCENT,
  SOBI_MASK_REGEN_PERCENT,
  REGEN_RUNE_HEAL_PERCENT,
  DENY_HP_THRESHOLD,
  DENY_GOLD_RATIO,
  DENY_XP_RATIO,
  CREEP_GOLD_MIN,
  CREEP_GOLD_MAX,
  CREEP_XP,
  CREEP_XP_SHARED,
} from '~~/shared/constants/balance'
import { talentUnlockLevel } from '~~/shared/constants/talents'
import { useStartTutorial } from '~/composables/useStartTutorial'

const {
  starting: startingTutorial,
  error: tutorialError,
  start: startTutorial,
} = useStartTutorial()

// ── Derived display values ───────────────────────────────────────
// Everything below is computed from the live engine constants so the
// guide can never drift from the actual game again.

const tickSeconds = TICK_DURATION_MS / 1000
const actionWindowSeconds = ACTION_WINDOW_MS / 1000
const heroCount = HERO_IDS.length
const wardCost = ITEMS.observer_ward!.cost
const surrenderMinutes = (SURRENDER_MIN_TICK * tickSeconds) / 60
const surrenderPercent = Math.round(SURRENDER_VOTE_THRESHOLD * 100)
const buybackCooldownMinutes = (BUYBACK_COOLDOWN_TICKS * tickSeconds) / 60
const glyphCooldownMinutes = (GLYPH_COOLDOWN_TICKS * tickSeconds) / 60

/** Respawn time in ticks for a given level — mirrors GameLoop's formula. */
function respawnTicks(level: number): number {
  return RESPAWN_BASE_TICKS + RESPAWN_PER_LEVEL_TICKS * Math.max(0, level - RESPAWN_FREE_LEVELS)
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
const ringRegenPercent = Math.round(RING_OF_HEALTH_REGEN_PERCENT * 100)
const sobiRegenPercent = Math.round(SOBI_MASK_REGEN_PERCENT * 100)
const runeRegenPercent = Math.round(REGEN_RUNE_HEAL_PERCENT * 100)
const denyHpPercent = Math.round(DENY_HP_THRESHOLD * 100)
const denyGold = Math.floor(((CREEP_GOLD_MIN + CREEP_GOLD_MAX) / 2) * DENY_GOLD_RATIO)
const denyXp = Math.floor(CREEP_XP * DENY_XP_RATIO)

const quickStart = [
  {
    step: '1',
    title: 'Queue Up',
    desc: "Click FIND MATCH in the lobby. You'll be matched into a 5v5 game (bots fill empty slots after 10s).",
  },
  {
    step: '2',
    title: 'Pick a Hero',
    desc: `Choose from ${heroCount} heroes, each with a passive and four actives — Q/W/E from level 1, the ultimate (R) at level ${ULTIMATE_UNLOCK_LEVEL}. Picks alternate between teams.`,
  },
  {
    step: '3',
    title: 'Move Out of Fountain',
    desc: 'You start in your fountain. Type move base (a shortcut that always means YOUR base) to leave, then move toward a lane.',
  },
  {
    step: '4',
    title: 'Farm Creeps',
    desc: `Creep waves spawn every ${CREEP_WAVE_INTERVAL_TICKS} cycles. Last-hit them with attack creep:0 to earn ${CREEP_GOLD}g and XP.`,
  },
  {
    step: '5',
    title: 'Buy Items',
    desc: `You start with ${STARTING_GOLD}g. Return to base and open the SHOP (click it, or press Esc then S). You have ${MAX_ITEMS} inventory slots.`,
  },
  {
    step: '6',
    title: 'Fight & Push',
    desc: 'Use abilities on enemies and raze a lane to its T3 ice — that exposes the enemy Mainframe. Destroy it to win.',
  },
]

const movementGuide = [
  {
    title: 'How Movement Works',
    items: [
      'The map is divided into zones (fountain, base, lanes, jungle, river)',
      `You walk one zone per cycle (${tickSeconds} seconds) — but you can order a move to ANY zone and your hero auto-paths there, cycle by cycle`,
      'Type move <zone-id> to move (e.g., move chaff-base, move mid-t3-chaff), or tap any zone on the map',
      'Issuing any new action cancels the walk; a new move order redirects it',
      'Shortcut: mv is the same as move (e.g., mv mid-t2-chaff)',
    ],
  },
  {
    title: 'Zone Naming Convention',
    items: [
      'Lanes: top-t1-chaff, mid-t2-audit, bot-t3-chaff (lane-tier-team)',
      'River: top-river, mid-river, bot-river (neutral crossings)',
      'Jungle: silt-chaff-top, silt-audit-bot (jungle-team-side)',
      'Base & Fountain: chaff-base, chaff-fountain, audit-base, audit-fountain',
      'Special: hollow, cache-top, cache-bot',
    ],
  },
  {
    title: 'Movement Tips',
    items: [
      `Fountain heals ${FOUNTAIN_HEAL_PER_TICK_PERCENT}% HP / ${FOUNTAIN_MANA_PER_TICK_PERCENT}% MP per cycle — retreat there to recover`,
      'Fountain is only adjacent to your base (must go through base first)',
      `You can't move while dead — respawn takes ${RESPAWN_BASE_TICKS} cycles plus ${RESPAWN_PER_LEVEL_TICKS} per level after level ${RESPAWN_FREE_LEVELS}`,
      'Team-relative shortcuts: move base / move fountain always go to YOUR side, whichever team you are',
      'More aliases save typing: move mid → mid-river, move rosh → hollow; unambiguous prefixes work too',
    ],
  },
]

const commands = [
  {
    cmd: 'move <zone>',
    desc: 'Walk to any zone — one zone per cycle, auto-pathing until you arrive',
    example: 'move mid-t1-chaff',
    shortcuts: 'mv',
  },
  {
    cmd: 'attack [target]',
    desc: 'Attack a target in your zone. Bare attack auto-hits the nearest enemy hero',
    example: 'attack creep:0',
    shortcuts: 'atk',
  },
  {
    cmd: 'deny [creep:N]',
    desc: 'Last-hit your OWN low-HP creep to deny the enemy its gold. Bare deny auto-picks one',
    example: 'deny creep:0',
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
    desc: 'Use an active/consumable item. Offensive actives (Dagon, Hex…) auto-hit the nearest enemy',
    example: 'use healing_salve',
    shortcuts: '—',
  },
  {
    cmd: 'buy <item>',
    desc: 'Buy an item (must be in base/fountain)',
    example: 'buy blades_of_attack',
    shortcuts: 'b',
  },
  {
    cmd: 'sell <item>',
    desc: 'Sell an item for 50% value',
    example: 'sell iron_branch',
    shortcuts: '—',
  },
  {
    cmd: 'ward <zone>',
    desc: 'Place a vision ward (current or adjacent zone)',
    example: 'ward mid-river',
    shortcuts: '—',
  },
  { cmd: 'rune', desc: 'Pick up the rune in your zone', example: 'rune', shortcuts: '—' },
  {
    cmd: 'backup',
    desc: 'Pick up the Backup in the Tenant pit',
    example: 'backup',
    shortcuts: '—',
  },
  {
    cmd: 'glyph',
    desc: `Make your ice invulnerable for ${GLYPH_DURATION_TICKS} cycles (one per team every ${glyphCooldownMinutes} min)`,
    example: 'glyph',
    shortcuts: '—',
  },
  {
    cmd: 'chat <team|all> <msg>',
    desc: 'Send a chat message',
    example: 'chat team group mid',
    shortcuts: '—',
  },
  { cmd: 'ping <zone>', desc: 'Ping a map zone', example: 'ping mid-river', shortcuts: '—' },
  {
    cmd: 'buyback',
    desc: 'Pay gold to respawn instantly (while dead)',
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
    desc: 'Pick a tier talent — a one-time left/right power choice unlocked at levels 10/15/20/25',
    example: 'talent 10 left',
    shortcuts: '—',
  },
  {
    cmd: 'status / map / scan',
    desc: 'Print a quick readout (your stats / reachable zones / visible enemies). Free — costs no cycle',
    example: 'status',
    shortcuts: '—',
  },
]

const targeting = [
  { format: 'hero:<name>', desc: 'Target a hero by their hero ID', example: 'attack hero:daemon' },
  {
    format: 'creep:<index>',
    desc: 'Target a creep by index (0, 1, 2...)',
    example: 'attack creep:0',
  },
  {
    format: 'neutral:<index>',
    desc: 'Target a jungle camp creep standing in your zone',
    example: 'attack neutral:0',
  },
  {
    format: 'ice:<zone>',
    desc: 'Target the ice in a zone',
    example: 'attack ice:mid-t1-audit',
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
  { key: 'Arrows', probe: 'ArrowUp', action: 'Move one zone that way on the map' },
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
    term: 'Gold & Items',
    icon: '$',
    desc: `Earn gold from creep last-hits (${CREEP_GOLD}g), hero kills (${KILL_BOUNTY_BASE}g base + streak and comeback bonuses), assists (${ASSIST_GOLD}g split), and passive income (${PASSIVE_GOLD_PER_TICK}g/cycle). Spend gold at the shop in your base. Max ${MAX_ITEMS} items.`,
  },
  {
    term: 'No Feed',
    icon: '?',
    desc: 'You have no feed on ground you do not hold. You see your own zone and the zones next to it, your allies, your ice, and anywhere you have a ward. Enemies outside that are not on your screen at all.',
  },
  {
    term: 'Creep Waves',
    icon: '#',
    desc: `AI creeps spawn every ${CREEP_WAVE_INTERVAL_TICKS} cycles in each lane. ${MELEE_CREEPS_PER_WAVE} melee + ${RANGED_CREEPS_PER_WAVE} ranged per wave (siege every ${SIEGE_CREEP_WAVE_INTERVAL}th wave). Last-hit them for gold. They push lanes automatically.`,
  },
  {
    term: 'ICE',
    icon: '!',
    desc: `Each lane has 3 ice tiers per side: T1 ${ICE_HP_T1} HP, T2 ${ICE_HP_T2} HP, T3 ${ICE_HP_T3} HP. ICE hit for ${ICE_ATTACK} and prioritize heroes who attack under them, then creeps. A ice kill splits ${ICE_GOLD}g among allies in the zone.`,
  },
  {
    term: 'The Mainframe',
    icon: '@',
    desc: `Each base houses its team's core — the Mainframe (${ANCIENT_HP} HP). It is invulnerable until at least one of that team's T3 ice falls; once exposed, heroes and creeps in the base can attack it.`,
  },
  {
    term: 'Levels & XP',
    icon: '^',
    desc: `Gain XP from creep kills and hero kills, up to level ${MAX_LEVEL}. Q/W/E are usable from level 1 and get stronger at levels ${BASIC_ABILITY_RANKS.join(', ')}. Your ultimate (R) unlocks at level ${ULTIMATE_UNLOCK_LEVEL} and strengthens at ${ULTIMATE_RANKS.slice(1).join(' and ')}. Reaching levels ${talentLevelList} each grants a one-time talent choice (a left/right power pick): use \`talent <tier> <left|right>\`${talentTierNote}.`,
  },
  {
    term: 'Abilities',
    icon: '*',
    desc: 'Each hero has a passive + 4 active abilities (Q/W/E/R). Abilities cost mana and have cooldowns measured in cycles. Cast with: cast q [target]',
  },
  {
    term: 'Sustain',
    icon: '+',
    desc: `There is NO innate regeneration — an HP or MP bar you spend stays spent. The only recoveries are: your fountain (${FOUNTAIN_HEAL_PER_TICK_PERCENT}% HP / ${FOUNTAIN_MANA_PER_TICK_PERCENT}% MP per cycle, and only while out of combat), Healing Salve and Mana Vial (consumables you carry), Ring of Health (${ringRegenPercent}% max HP per cycle) and Sobi's Mask (${sobiRegenPercent}% max MP per cycle), and the regeneration rune (${runeRegenPercent}% of both per cycle). Buy one of those before you plan to hold a lane — otherwise every trade is one-way and the walk home costs you the wave.`,
  },
  {
    term: 'Last-Hitting & Denying',
    icon: '/',
    desc: `Only the killing blow pays gold: chip a creep to 1 HP and a lane-mate takes it, you get nothing. A melee creep has ${MELEE_CREEP_HP} HP and your hero hits for 30–70, so wait until its remaining HP is under one of your attacks, then take it with attack creep:0 for ${CREEP_GOLD}g and ${CREEP_XP} XP (allies in the zone share ${CREEP_XP_SHARED} XP, so standing in lane is never worth zero). Denying is the mirror: once one of YOUR creeps drops below ${denyHpPercent}% HP, deny creep:0 kills it so the enemy gets nothing — you keep ${denyGold}g and ${denyXp} XP. Prefer tapping the creep group in the zone panel over typing an index: creep:N counts the living creeps in your zone, so N shifts every cycle as creeps die and waves spawn.`,
  },
  {
    term: 'Death & Respawn',
    icon: 'X',
    desc: `When you die, you respawn at your fountain after ${RESPAWN_BASE_TICKS} cycles + ${RESPAWN_PER_LEVEL_TICKS} per level after level ${RESPAWN_FREE_LEVELS} (${respawnTicks(1)} cycles at level 1, ${respawnTicks(10)} at level 10). Buyback with gold to return instantly (${buybackCooldownMinutes} min cooldown).`,
  },
  {
    term: 'Wards',
    icon: 'o',
    desc: `Observer wards (${wardCost}g) grant vision of a zone for ${OBSERVER_WARD_DURATION_TICKS} cycles. Max ${WARD_LIMIT_PER_TEAM} active per team. Place with: ward <zone>. Essential for map control.`,
  },
  {
    term: 'Tenant & Runes',
    icon: '%',
    desc: `Tenant (${TENANT_BASE_HP}+ HP) lurks in hollow and drops the Backup when killed — grab it with backup. Power-up runes spawn at cache-top/cache-bot every ${RUNE_INTERVAL_TICKS} cycles and expire after ${RUNE_DURATION_TICKS}; grab them with rune.`,
  },
  {
    term: 'Win Condition',
    icon: 'W',
    desc: `Destroying any of a team's T3 ice exposes their Mainframe (${ANCIENT_HP} HP) in their base. Destroy the enemy Mainframe to win. Teams may also surrender after ${surrenderMinutes} minutes with a ${surrenderPercent}% vote.`,
  },
  {
    term: 'Draft & Bans',
    icon: 'D',
    desc: "In 5v5 and 3v3, the draft opens with a ban phase: teams take turns removing heroes from the pool before the snake pick. Banned heroes can't be picked by either side — use bans to deny a matchup you don't want to face.",
  },
  {
    term: 'Seasons & Ranks',
    icon: 'S',
    desc: 'The competitive ladder resets each season. Ranked games (no bots) move your seasonal rating (SR); from it you earn a rank tier — Iron → Bronze → Silver → Gold → Platinum → Diamond → Terminal. The leaderboard shows the current season; your lifetime rating is tracked separately.',
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

const ROLE_DETAILS: ReadonlyArray<{ role: HeroRole; label: string; icon: string; desc: string }> = [
  {
    role: 'carry',
    label: 'Carry',
    icon: '>>',
    desc: 'Scales with items. Weak early, dominant late. Farm creeps and buy damage items.',
  },
  {
    role: 'support',
    label: 'Support',
    icon: '++',
    desc: 'Heals and shields allies. Buy wards. Protect your carry in lane.',
  },
  {
    role: 'assassin',
    label: 'Assassin',
    icon: '**',
    desc: 'High burst damage. Stealth and mobility. Pick off isolated targets.',
  },
  {
    role: 'tank',
    label: 'Tank',
    icon: '##',
    desc: 'High HP and defense. Taunts enemies. Absorbs damage for the team.',
  },
  {
    role: 'mage',
    label: 'Mage',
    icon: '~~',
    desc: 'Magic damage and crowd control. Strong mid-game spike with abilities.',
  },
  {
    role: 'offlaner',
    label: 'Offlaner',
    icon: '<>',
    desc: 'Durable damage dealer. Links to enemies and disrupts formations.',
  },
]

// Hero lists per role are read from the live hero registry.
const heroRoles = ROLE_DETAILS.map((r) => ({
  role: r.label,
  icon: r.icon,
  desc: r.desc,
  heroes: Object.values(HEROES)
    .filter((h) => h.role === r.role)
    .map((h) => h.name)
    .join(', '),
}))
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
            >chaff-fountain</span
          >
          <span class="text-text-dim">&rarr;</span>
          <span class="border border-border bg-bg-secondary px-1.5 py-0.5 text-ability"
            >move chaff-base</span
          >
          <span class="text-text-dim">&rarr;</span>
          <span class="border border-border bg-bg-secondary px-1.5 py-0.5 text-ability"
            >move mid-t3-chaff</span
          >
          <span class="text-text-dim">&rarr;</span>
          <span class="border border-border bg-bg-secondary px-1.5 py-0.5 text-ability"
            >move mid-t2-chaff</span
          >
          <span class="text-text-dim">&rarr;</span>
          <span class="border border-border bg-bg-secondary px-1.5 py-0.5 text-ability"
            >move mid-t1-chaff</span
          >
          <span class="text-text-dim">&rarr;</span>
          <span class="border border-border bg-bg-secondary px-1.5 py-0.5 text-ability"
            >move mid-river</span
          >
          <span class="text-text-dim">&rarr;</span>
          <span class="border border-border bg-bg-secondary px-1.5 py-0.5 text-gold"
            >mid-river</span
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
        <span class="text-ability">ward</span> or <span class="text-ability">surrender</span>. Press
        <span class="text-ability">Esc</span> on an empty prompt to hand the keyboard to the game:
        the prompt glyph changes from <span class="text-ability">&gt;_</span> to
        <span class="text-ability">[KEYS]</span> and the keys below become live. Click the prompt to
        type again.
      </p>
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
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

    <!-- Hero Roles -->
    <TerminalPanel title="Hero Roles" title-as="h2">
      <div class="mb-2 border-b border-border pb-2">
        <span class="text-[0.8rem] text-text-dim">&gt;_ ls /heroes/roles/</span>
      </div>
      <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <div v-for="r in heroRoles" :key="r.role" class="border border-border bg-bg-secondary p-2">
          <div class="mb-1 flex items-center gap-2">
            <span class="text-[0.85rem] font-bold text-ability">{{ r.icon }}</span>
            <span class="text-[0.85rem] font-bold text-text-primary">{{ r.role }}</span>
          </div>
          <p class="text-[0.75rem] text-text-dim">{{ r.desc }}</p>
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
          <NuxtLink to="/lobby">
            <AsciiButton label="ENTER THE TERMINAL" variant="ghost" />
          </NuxtLink>
        </div>
        <InlineError :message="tutorialError" />
      </div>
    </TerminalPanel>
  </div>
</template>
