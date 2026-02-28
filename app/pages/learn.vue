<script setup lang="ts">


const quickStart = [
  { step: '1', title: 'Queue Up', desc: 'Click FIND MATCH in the lobby. You\'ll be matched into a 5v5 game (bots fill empty slots after 10s).' },
  { step: '2', title: 'Pick a Hero', desc: 'Choose from 10 heroes, each with unique abilities (Q/W/E/R). Picks alternate between teams.' },
  { step: '3', title: 'Move Out of Fountain', desc: 'You start in your fountain. Type move radiant-base (or dire-base) to leave, then move toward a lane.' },
  { step: '4', title: 'Farm Creeps', desc: 'Creep waves spawn every 8 ticks. Last-hit them with attack creep:0 to earn gold and XP.' },
  { step: '5', title: 'Buy Items', desc: 'Return to base and open the SHOP. Buy items to get stronger. You have 6 inventory slots.' },
  { step: '6', title: 'Fight & Push', desc: 'Use abilities on enemies, destroy their towers lane by lane, and push to their base to win.' },
]

const movementGuide = [
  { title: 'How Movement Works', items: [
    'The map is divided into zones (fountain, base, lanes, jungle, river)',
    'You can only move to adjacent zones — one zone per tick (4 seconds)',
    'Type move <zone-id> to move (e.g., move radiant-base, move mid-t3-rad)',
    'Click the MOVE button to see which zones are adjacent to your current location',
    'Shortcut: mv is the same as move (e.g., mv mid-t2-rad)',
  ]},
  { title: 'Zone Naming Convention', items: [
    'Lanes: top-t1-rad, mid-t2-dire, bot-t3-rad (lane-tier-team)',
    'River: top-river, mid-river, bot-river (neutral crossings)',
    'Jungle: rad-jungle-top, dire-jungle-bot (team-jungle-side)',
    'Base & Fountain: radiant-base, radiant-fountain, dire-base, dire-fountain',
    'Special: roshan-pit, rune-top, rune-bot',
  ]},
  { title: 'Movement Tips', items: [
    'Fountain heals 15% HP/MP per tick — retreat there to recover',
    'Fountain is only adjacent to your base (must go through base first)',
    'You can\'t move while dead — wait for respawn (3 + level ticks)',
    'Boots of Speed (+1 move speed) lets you move faster',
  ]},
]

const commands = [
  { cmd: 'move <zone>', desc: 'Move to an adjacent zone', example: 'move mid-t1-rad', shortcuts: 'mv' },
  { cmd: 'attack <target>', desc: 'Attack a target in your zone', example: 'attack hero:daemon', shortcuts: 'atk' },
  { cmd: 'cast <q|w|e|r> [target]', desc: 'Use an ability, optionally on a target', example: 'cast q hero:regex', shortcuts: 'q, w, e, r' },
  { cmd: 'use <item>', desc: 'Use an active/consumable item', example: 'use blink_module', shortcuts: '—' },
  { cmd: 'buy <item>', desc: 'Buy an item (must be in base/fountain)', example: 'buy boots_of_speed', shortcuts: 'b' },
  { cmd: 'sell <item>', desc: 'Sell an item for 50% value', example: 'sell iron_branch', shortcuts: '—' },
  { cmd: 'ward <zone>', desc: 'Place a vision ward in a zone', example: 'ward mid-river', shortcuts: '—' },
]

const targeting = [
  { format: 'hero:<name>', desc: 'Target a hero by their hero ID', example: 'attack hero:daemon' },
  { format: 'creep:<index>', desc: 'Target a creep by index (0, 1, 2...)', example: 'attack creep:0' },
  { format: 'tower:<zone>', desc: 'Target the tower in a zone', example: 'attack tower:mid-t1-dire' },
  { format: 'self', desc: 'Target yourself (for self-cast abilities)', example: 'cast w self' },
  { format: '<hero-name>', desc: 'Shorthand for hero: prefix', example: 'attack daemon' },
]

const keybinds = [
  { key: 'Tab', action: 'Hold to show scoreboard' },
  { key: '1-6', action: 'Use item in inventory slot 1-6' },
  { key: 'Tab (in input)', action: 'Autocomplete command' },
  { key: 'Up/Down', action: 'Cycle through command history' },
]

const concepts = [
  { term: 'Ticks', icon: '>', desc: 'The game runs on 4-second ticks. Each tick, you submit one action. The action window is 3.5 seconds — your command is processed when the tick resolves.' },
  { term: 'Gold & Items', icon: '$', desc: 'Earn gold from creep last-hits (30-50g), hero kills (200g base), assists (100g), and passive income (2g/tick). Spend gold at the shop in your base. Max 6 items.' },
  { term: 'Fog of War', icon: '?', desc: 'You can only see zones where your team has vision: your zone + adjacent, ally positions, tower vision, and wards. Enemy positions outside vision are hidden.' },
  { term: 'Creep Waves', icon: '#', desc: 'AI creeps spawn every 8 ticks in each lane. 3 melee + 1 ranged per wave (siege every 5th wave). Last-hit them for gold. They push lanes automatically.' },
  { term: 'Towers', icon: '!', desc: 'Each lane has 3 tower tiers per side (T1, T2, T3). Towers deal 120 damage and must be destroyed in order. Destroying a tower grants 500 gold to the team.' },
  { term: 'Levels & XP', icon: '^', desc: 'Gain XP from creep kills and hero kills. Level up to unlock/upgrade abilities: Q/W/E at levels 1,3,5,7 and R (ultimate) at levels 6,12,18. Max level 25.' },
  { term: 'Abilities', icon: '*', desc: 'Each hero has a passive + 4 active abilities (Q/W/E/R). Abilities cost mana and have cooldowns measured in ticks. Cast with: cast q [target]' },
  { term: 'Death & Respawn', icon: 'X', desc: 'When you die, you respawn at your fountain after 3 + (your level) ticks. You can\'t act while dead. Higher level = longer death timer.' },
  { term: 'Wards', icon: 'o', desc: 'Observer wards (75g) grant vision of a zone for 45 ticks. Max 3 active per team. Place with: ward <zone>. Essential for map control.' },
  { term: 'Win Condition', icon: 'W', desc: 'Destroy all 3 tower tiers in any lane to expose the enemy base. The first team to destroy the enemy base wins.' },
]

const heroRoles = [
  { role: 'Carry', icon: '>>', desc: 'Scales with items. Weak early, dominant late. Farm creeps and buy damage items.', heroes: 'Echo, Malloc' },
  { role: 'Support', icon: '++', desc: 'Heals and shields allies. Buy wards. Protect your carry in lane.', heroes: 'Sentry, Proxy' },
  { role: 'Assassin', icon: '**', desc: 'High burst damage. Stealth and mobility. Pick off isolated targets.', heroes: 'Daemon, Cipher' },
  { role: 'Tank', icon: '##', desc: 'High HP and defense. Taunts enemies. Absorbs damage for the team.', heroes: 'Kernel, Firewall' },
  { role: 'Mage', icon: '~~', desc: 'Magic damage and crowd control. Strong mid-game spike with abilities.', heroes: 'Regex' },
  { role: 'Offlaner', icon: '<>', desc: 'Durable damage dealer. Links to enemies and disrupts formations.', heroes: 'Socket' },
]
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
          <span class="w-6 shrink-0 text-center text-[0.85rem] font-bold text-ability">{{ s.step }}</span>
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
        <div class="mb-1 text-[0.8rem] font-bold text-gold">Example: Getting to Mid Lane (Radiant)</div>
        <div class="flex flex-wrap items-center gap-1 text-[0.75rem]">
          <span class="border border-border bg-bg-secondary px-1.5 py-0.5 text-radiant">radiant-fountain</span>
          <span class="text-text-dim">&rarr;</span>
          <span class="border border-border bg-bg-secondary px-1.5 py-0.5 text-ability">move radiant-base</span>
          <span class="text-text-dim">&rarr;</span>
          <span class="border border-border bg-bg-secondary px-1.5 py-0.5 text-ability">move mid-t3-rad</span>
          <span class="text-text-dim">&rarr;</span>
          <span class="border border-border bg-bg-secondary px-1.5 py-0.5 text-ability">move mid-t2-rad</span>
          <span class="text-text-dim">&rarr;</span>
          <span class="border border-border bg-bg-secondary px-1.5 py-0.5 text-ability">move mid-t1-rad</span>
          <span class="text-text-dim">&rarr;</span>
          <span class="border border-border bg-bg-secondary px-1.5 py-0.5 text-gold">mid-river</span>
        </div>
        <p class="mt-1 text-[0.75rem] text-text-dim">Each arrow = 1 tick (4 seconds). This path takes 4 ticks to reach mid river from fountain.</p>
      </div>
    </TerminalPanel>

    <!-- Commands Reference -->
    <TerminalPanel title="Command Reference">
      <div class="mb-2 border-b border-border pb-2">
        <span class="text-[0.8rem] text-text-dim">&gt;_ help --all</span>
      </div>
      <table class="w-full border-collapse text-xs">
        <thead>
          <tr>
            <th class="whitespace-nowrap border-b border-border px-1.5 py-1 text-left font-normal text-text-dim">Command</th>
            <th class="border-b border-border px-1.5 py-1 text-left font-normal text-text-dim">Description</th>
            <th class="border-b border-border px-1.5 py-1 text-left font-normal text-text-dim">Example</th>
            <th class="border-b border-border px-1.5 py-1 text-left font-normal text-text-dim">Shortcuts</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in commands" :key="c.cmd">
            <td class="whitespace-nowrap border-b border-border/50 px-1.5 py-1 text-ability">{{ c.cmd }}</td>
            <td class="border-b border-border/50 px-1.5 py-1">{{ c.desc }}</td>
            <td class="border-b border-border/50 px-1.5 py-1 text-text-dim">{{ c.example }}</td>
            <td class="border-b border-border/50 px-1.5 py-1 text-gold">{{ c.shortcuts }}</td>
          </tr>
        </tbody>
      </table>
    </TerminalPanel>

    <!-- Targeting -->
    <TerminalPanel title="Targeting System">
      <div class="mb-2 border-b border-border pb-2">
        <span class="text-[0.8rem] text-text-dim">&gt;_ man targeting</span>
      </div>
      <table class="w-full border-collapse text-xs">
        <thead>
          <tr>
            <th class="whitespace-nowrap border-b border-border px-1.5 py-1 text-left font-normal text-text-dim">Format</th>
            <th class="border-b border-border px-1.5 py-1 text-left font-normal text-text-dim">Description</th>
            <th class="border-b border-border px-1.5 py-1 text-left font-normal text-text-dim">Example</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="t in targeting" :key="t.format">
            <td class="whitespace-nowrap border-b border-border/50 px-1.5 py-1 text-ability">{{ t.format }}</td>
            <td class="border-b border-border/50 px-1.5 py-1">{{ t.desc }}</td>
            <td class="border-b border-border/50 px-1.5 py-1 text-text-dim">{{ t.example }}</td>
          </tr>
        </tbody>
      </table>
    </TerminalPanel>

    <!-- Keyboard Shortcuts -->
    <TerminalPanel title="Keyboard Shortcuts">
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div v-for="k in keybinds" :key="k.key" class="border border-border bg-bg-secondary p-2 text-center">
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
