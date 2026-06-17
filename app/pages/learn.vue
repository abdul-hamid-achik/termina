<script setup lang="ts">
import type { HeroRole } from '~~/shared/types/hero'
import { HEROES, HERO_IDS } from '~~/shared/constants/heroes'
import { ITEMS } from '~~/shared/constants/items'
import {
  TICK_DURATION_MS,
  ACTION_WINDOW_MS,
  PASSIVE_GOLD_PER_TICK,
  CREEP_GOLD_MIN,
  CREEP_GOLD_MAX,
  KILL_BOUNTY_BASE,
  ASSIST_GOLD,
  TOWER_GOLD,
  STARTING_GOLD,
  MAX_ITEMS,
  MAX_LEVEL,
  RESPAWN_BASE_TICKS,
  RESPAWN_PER_LEVEL_TICKS,
  RESPAWN_FREE_LEVELS,
  BUYBACK_COOLDOWN_TICKS,
  OBSERVER_WARD_DURATION_TICKS,
  WARD_LIMIT_PER_TEAM,
  CREEP_WAVE_INTERVAL_TICKS,
  MELEE_CREEPS_PER_WAVE,
  RANGED_CREEPS_PER_WAVE,
  SIEGE_CREEP_WAVE_INTERVAL,
  TOWER_HP_T1,
  TOWER_HP_T2,
  TOWER_HP_T3,
  TOWER_ATTACK,
  ANCIENT_HP,
  ROSHAN_BASE_HP,
  FOUNTAIN_HEAL_PER_TICK_PERCENT,
  FOUNTAIN_MANA_PER_TICK_PERCENT,
  SURRENDER_MIN_TICK,
  SURRENDER_VOTE_THRESHOLD,
  RUNE_INTERVAL_TICKS,
  RUNE_DURATION_TICKS,
  GLYPH_DURATION_TICKS,
  GLYPH_COOLDOWN_TICKS,
} from '~~/shared/constants/balance'

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

const quickStart = [
  {
    step: '1',
    title: 'Queue Up',
    desc: "Click FIND MATCH in the lobby. You'll be matched into a 5v5 game (bots fill empty slots after 10s).",
  },
  {
    step: '2',
    title: 'Pick a Hero',
    desc: `Choose from ${heroCount} heroes, each with a passive and four actives (Q/W/E/R) — all usable from level 1. Picks alternate between teams.`,
  },
  {
    step: '3',
    title: 'Move Out of Fountain',
    desc: 'You start in your fountain. Type move base (a shortcut that always means YOUR base) to leave, then move toward a lane.',
  },
  {
    step: '4',
    title: 'Farm Creeps',
    desc: `Creep waves spawn every ${CREEP_WAVE_INTERVAL_TICKS} ticks. Last-hit them with attack creep:0 to earn ${CREEP_GOLD_MIN}-${CREEP_GOLD_MAX}g and XP.`,
  },
  {
    step: '5',
    title: 'Buy Items',
    desc: `You start with ${STARTING_GOLD}g. Return to base and open the SHOP (press S). You have ${MAX_ITEMS} inventory slots.`,
  },
  {
    step: '6',
    title: 'Fight & Push',
    desc: 'Use abilities on enemies and raze a lane to its T3 tower — that exposes the enemy Mainframe. Destroy it to win.',
  },
]

const movementGuide = [
  {
    title: 'How Movement Works',
    items: [
      'The map is divided into zones (fountain, base, lanes, jungle, river)',
      `You can only move to adjacent zones — one zone per tick (${tickSeconds} seconds)`,
      'Type move <zone-id> to move (e.g., move radiant-base, move mid-t3-rad)',
      'Click the MOVE button to see which zones are adjacent to your current location',
      'Shortcut: mv is the same as move (e.g., mv mid-t2-rad)',
    ],
  },
  {
    title: 'Zone Naming Convention',
    items: [
      'Lanes: top-t1-rad, mid-t2-dire, bot-t3-rad (lane-tier-team)',
      'River: top-river, mid-river, bot-river (neutral crossings)',
      'Jungle: jungle-rad-top, jungle-dire-bot (jungle-team-side)',
      'Base & Fountain: radiant-base, radiant-fountain, dire-base, dire-fountain',
      'Special: roshan-pit, rune-top, rune-bot',
    ],
  },
  {
    title: 'Movement Tips',
    items: [
      `Fountain heals ${FOUNTAIN_HEAL_PER_TICK_PERCENT}% HP / ${FOUNTAIN_MANA_PER_TICK_PERCENT}% MP per tick — retreat there to recover`,
      'Fountain is only adjacent to your base (must go through base first)',
      `You can't move while dead — respawn takes ${RESPAWN_BASE_TICKS} ticks plus ${RESPAWN_PER_LEVEL_TICKS} per level after level ${RESPAWN_FREE_LEVELS}`,
      'Team-relative shortcuts: move base / move fountain always go to YOUR side, whichever team you are',
      'More aliases save typing: move mid → mid-river, move rosh → roshan-pit; unambiguous prefixes work too',
    ],
  },
]

const commands = [
  {
    cmd: 'move <zone>',
    desc: 'Move to an adjacent zone',
    example: 'move mid-t1-rad',
    shortcuts: 'mv',
  },
  {
    cmd: 'attack [target]',
    desc: 'Attack a target in your zone. Bare attack auto-hits the nearest enemy hero',
    example: 'attack creep:0',
    shortcuts: 'atk',
  },
  {
    cmd: 'cast <q|w|e|r> [target]',
    desc: 'Use an ability, optionally on a target',
    example: 'cast q hero:regex',
    shortcuts: 'q, w, e, r',
  },
  {
    cmd: 'use <item>',
    desc: 'Use an active/consumable item',
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
  { cmd: 'aegis', desc: 'Pick up the Aegis in the Roshan pit', example: 'aegis', shortcuts: '—' },
  {
    cmd: 'glyph',
    desc: `Make your towers invulnerable for ${GLYPH_DURATION_TICKS} ticks (one per team every ${glyphCooldownMinutes} min)`,
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
    cmd: 'scan / status / map',
    desc: 'Reserved — accepted by the server but not implemented yet',
    example: 'scan',
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
    format: 'tower:<zone>',
    desc: 'Target the tower in a zone',
    example: 'attack tower:mid-t1-dire',
  },
  { format: 'self', desc: 'Target yourself (for self-cast abilities)', example: 'cast w self' },
  { format: '<hero-name>', desc: 'Shorthand for hero: prefix', example: 'attack daemon' },
]

const keybinds = [
  { key: 'Tab', action: 'Hold to show scoreboard' },
  { key: 'Tab (in input)', action: 'Autocomplete command' },
  { key: 'Q/W/E/R', action: 'Quick-cast ability (input unfocused)' },
  { key: 'S', action: 'Toggle the shop' },
  { key: '1-6', action: 'Use item in inventory slot 1-6' },
  { key: 'Up/Down (in input)', action: 'Cycle through command history' },
  { key: 'Arrows', action: 'Quick-move to an adjacent zone' },
  { key: 'Esc', action: 'Close autocomplete suggestions' },
]

const concepts = [
  {
    term: 'Ticks',
    icon: '>',
    desc: `The game runs on ${tickSeconds}-second ticks. Each tick, you submit one action. The action window is ${actionWindowSeconds} seconds — your command is processed when the tick resolves.`,
  },
  {
    term: 'Gold & Items',
    icon: '$',
    desc: `Earn gold from creep last-hits (${CREEP_GOLD_MIN}-${CREEP_GOLD_MAX}g), hero kills (${KILL_BOUNTY_BASE}g base + streak and comeback bonuses), assists (${ASSIST_GOLD}g split), and passive income (${PASSIVE_GOLD_PER_TICK}g/tick). Spend gold at the shop in your base. Max ${MAX_ITEMS} items.`,
  },
  {
    term: 'Fog of War',
    icon: '?',
    desc: 'You can only see zones where your team has vision: your zone + adjacent, ally positions, tower vision, and wards. Enemy positions outside vision are hidden.',
  },
  {
    term: 'Creep Waves',
    icon: '#',
    desc: `AI creeps spawn every ${CREEP_WAVE_INTERVAL_TICKS} ticks in each lane. ${MELEE_CREEPS_PER_WAVE} melee + ${RANGED_CREEPS_PER_WAVE} ranged per wave (siege every ${SIEGE_CREEP_WAVE_INTERVAL}th wave). Last-hit them for gold. They push lanes automatically.`,
  },
  {
    term: 'Towers',
    icon: '!',
    desc: `Each lane has 3 tower tiers per side: T1 ${TOWER_HP_T1} HP, T2 ${TOWER_HP_T2} HP, T3 ${TOWER_HP_T3} HP. Towers hit for ${TOWER_ATTACK} and prioritize heroes who attack under them, then creeps. A tower kill splits ${TOWER_GOLD}g among allies in the zone.`,
  },
  {
    term: 'The Mainframe',
    icon: '@',
    desc: `Each base houses its team's core — the Mainframe (${ANCIENT_HP} HP). It is invulnerable until at least one of that team's T3 towers falls; once exposed, heroes and creeps in the base can attack it.`,
  },
  {
    term: 'Levels & XP',
    icon: '^',
    desc: `Gain XP from creep kills and hero kills, up to level ${MAX_LEVEL}. All four abilities (Q/W/E/R) work from level 1 — leveling up grows your stats, it does not unlock abilities.`,
  },
  {
    term: 'Abilities',
    icon: '*',
    desc: 'Each hero has a passive + 4 active abilities (Q/W/E/R). Abilities cost mana and have cooldowns measured in ticks. Cast with: cast q [target]',
  },
  {
    term: 'Death & Respawn',
    icon: 'X',
    desc: `When you die, you respawn at your fountain after ${RESPAWN_BASE_TICKS} ticks + ${RESPAWN_PER_LEVEL_TICKS} per level after level ${RESPAWN_FREE_LEVELS} (${respawnTicks(1)} ticks at level 1, ${respawnTicks(10)} at level 10). Buyback with gold to return instantly (${buybackCooldownMinutes} min cooldown).`,
  },
  {
    term: 'Wards',
    icon: 'o',
    desc: `Observer wards (${wardCost}g) grant vision of a zone for ${OBSERVER_WARD_DURATION_TICKS} ticks. Max ${WARD_LIMIT_PER_TEAM} active per team. Place with: ward <zone>. Essential for map control.`,
  },
  {
    term: 'Roshan & Runes',
    icon: '%',
    desc: `Roshan (${ROSHAN_BASE_HP}+ HP) lurks in roshan-pit and drops the Aegis when killed — grab it with aegis. Power-up runes spawn at rune-top/rune-bot every ${RUNE_INTERVAL_TICKS} ticks and expire after ${RUNE_DURATION_TICKS}; grab them with rune.`,
  },
  {
    term: 'Win Condition',
    icon: 'W',
    desc: `Destroying any of a team's T3 towers exposes their Mainframe (${ANCIENT_HP} HP) in their base. Destroy the enemy Mainframe to win. Teams may also surrender after ${surrenderMinutes} minutes with a ${surrenderPercent}% vote.`,
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
    <!-- Quick Start -->
    <TerminalPanel title="Quick Start Guide">
      <div class="mb-2 border-b border-border pb-2">
        <span class="text-[0.8rem] text-text-dim">&gt;_ cat /usr/share/termina/quickstart.txt</span>
      </div>
      <div class="flex flex-col gap-2">
        <div v-for="s in quickStart" :key="s.step" class="flex gap-3">
          <span class="w-6 shrink-0 text-center text-[0.85rem] font-bold text-ability">{{
            s.step
          }}</span>
          <div class="min-w-0">
            <span class="text-[0.85rem] font-bold text-radiant">{{ s.title }}</span>
            <p class="text-[0.8rem] text-text-dim">{{ s.desc }}</p>
          </div>
        </div>
      </div>
    </TerminalPanel>

    <!-- Movement Guide -->
    <TerminalPanel title="Movement & Navigation">
      <div class="mb-2 border-b border-border pb-2">
        <span class="text-[0.8rem] text-text-dim">&gt;_ man move</span>
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
          Example: Getting to Mid Lane (Radiant)
        </div>
        <div class="flex flex-wrap items-center gap-1 text-[0.75rem]">
          <span class="border border-border bg-bg-secondary px-1.5 py-0.5 text-radiant"
            >radiant-fountain</span
          >
          <span class="text-text-dim">&rarr;</span>
          <span class="border border-border bg-bg-secondary px-1.5 py-0.5 text-ability"
            >move radiant-base</span
          >
          <span class="text-text-dim">&rarr;</span>
          <span class="border border-border bg-bg-secondary px-1.5 py-0.5 text-ability"
            >move mid-t3-rad</span
          >
          <span class="text-text-dim">&rarr;</span>
          <span class="border border-border bg-bg-secondary px-1.5 py-0.5 text-ability"
            >move mid-t2-rad</span
          >
          <span class="text-text-dim">&rarr;</span>
          <span class="border border-border bg-bg-secondary px-1.5 py-0.5 text-ability"
            >move mid-t1-rad</span
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
          Each arrow = 1 tick ({{ tickSeconds }} seconds). This path takes 5 ticks ({{
            5 * tickSeconds
          }}
          seconds) to reach mid river from fountain.
        </p>
      </div>
    </TerminalPanel>

    <!-- Commands Reference -->
    <TerminalPanel title="Command Reference">
      <div class="mb-2 border-b border-border pb-2">
        <span class="text-[0.8rem] text-text-dim">&gt;_ help --all</span>
      </div>
      <!-- The command table has whitespace-nowrap cells; let it scroll inside
           the panel on narrow phones instead of widening the page. -->
      <div class="overflow-x-auto">
        <table class="w-full table-fixed border-collapse break-words text-xs">
          <thead>
            <tr>
              <th class="border-b border-border px-1.5 py-1 text-left font-normal text-text-dim">
                Command
              </th>
              <th class="border-b border-border px-1.5 py-1 text-left font-normal text-text-dim">
                Description
              </th>
              <th class="border-b border-border px-1.5 py-1 text-left font-normal text-text-dim">
                Example
              </th>
              <th class="border-b border-border px-1.5 py-1 text-left font-normal text-text-dim">
                Shortcuts
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in commands" :key="c.cmd">
              <td class="border-b border-border/50 px-1.5 py-1 text-ability">
                {{ c.cmd }}
              </td>
              <td class="border-b border-border/50 px-1.5 py-1">{{ c.desc }}</td>
              <td class="border-b border-border/50 px-1.5 py-1 text-text-dim">{{ c.example }}</td>
              <td class="border-b border-border/50 px-1.5 py-1 text-gold">{{ c.shortcuts }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </TerminalPanel>

    <!-- Targeting -->
    <TerminalPanel title="Targeting System">
      <div class="mb-2 border-b border-border pb-2">
        <span class="text-[0.8rem] text-text-dim">&gt;_ man targeting</span>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full table-fixed border-collapse break-words text-xs">
          <thead>
            <tr>
              <th class="border-b border-border px-1.5 py-1 text-left font-normal text-text-dim">
                Format
              </th>
              <th class="border-b border-border px-1.5 py-1 text-left font-normal text-text-dim">
                Description
              </th>
              <th class="border-b border-border px-1.5 py-1 text-left font-normal text-text-dim">
                Example
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in targeting" :key="t.format">
              <td class="border-b border-border/50 px-1.5 py-1 text-ability">
                {{ t.format }}
              </td>
              <td class="border-b border-border/50 px-1.5 py-1">{{ t.desc }}</td>
              <td class="border-b border-border/50 px-1.5 py-1 text-text-dim">{{ t.example }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </TerminalPanel>

    <!-- Keyboard Shortcuts -->
    <TerminalPanel title="Keyboard Shortcuts">
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
    <TerminalPanel title="Game Concepts">
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
    <TerminalPanel title="Hero Roles">
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
    <TerminalPanel title="Ready?">
      <div class="flex flex-col items-center gap-4 py-4">
        <span class="text-[0.8rem] text-text-dim">&gt;_ tutorial_complete. deploy --force</span>
        <span class="text-lg font-bold tracking-widest text-radiant">READY TO PLAY?</span>
        <div class="flex gap-3">
          <NuxtLink to="/lobby">
            <AsciiButton label="ENTER THE TERMINAL" variant="primary" />
          </NuxtLink>
          <NuxtLink to="/leaderboard">
            <AsciiButton label="VIEW LEADERBOARD" variant="ghost" />
          </NuxtLink>
        </div>
      </div>
    </TerminalPanel>
  </div>
</template>
