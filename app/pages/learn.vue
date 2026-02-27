<script setup lang="ts">
const commands = [
  { cmd: 'move <zone>', desc: 'Move your hero to an adjacent zone', example: 'move mid' },
  {
    cmd: 'attack <target>',
    desc: 'Attack a target in your zone (hero, creep, or tower)',
    example: 'attack hero:phantom',
  },
  {
    cmd: 'cast <ability> [target]',
    desc: 'Cast an ability (q/w/e/r) on optional target',
    example: 'cast q hero:vortex',
  },
  {
    cmd: 'use <item> [target]',
    desc: 'Use an active item on optional target',
    example: 'use blink',
  },
  {
    cmd: 'buy <item>',
    desc: 'Purchase an item from the shop (must be in base)',
    example: 'buy broadsword',
  },
  { cmd: 'sell <item>', desc: 'Sell an item for half its value', example: 'sell boots' },
  { cmd: 'ward <zone>', desc: 'Place a ward for team vision', example: 'ward jungle_top' },
  { cmd: 'scan', desc: 'Reveal enemy positions briefly (long cooldown)', example: 'scan' },
  { cmd: 'status', desc: 'View your hero stats, items, and buffs', example: 'status' },
  { cmd: 'map', desc: 'View current zone map with known positions', example: 'map' },
  {
    cmd: 'chat <channel> <msg>',
    desc: 'Send a message to team or all chat',
    example: 'chat team gather mid',
  },
  { cmd: 'ping <zone>', desc: 'Ping a zone to alert your team', example: 'ping roshan' },
]

const concepts = [
  {
    term: 'Tick',
    desc: 'The game advances in 4-second ticks. You submit one command per tick during the action window (3.5s).',
  },
  {
    term: 'Fog of War',
    desc: 'You can only see zones where your team has vision (heroes, wards, towers). Unknown zones show as [???].',
  },
  {
    term: 'Zones',
    desc: 'The map is divided into zones (lanes, jungle, base). Move between adjacent zones.',
  },
  {
    term: 'Creep Waves',
    desc: 'AI creeps spawn every 8 ticks and march down lanes. Last-hit them for gold and XP.',
  },
  {
    term: 'Towers',
    desc: 'Defensive structures in each lane. Destroy enemy towers to advance. They hit hard.',
  },
  {
    term: 'Roshan',
    desc: 'Powerful neutral boss. Killing Roshan grants bonus gold and the Aegis of the Immortal.',
  },
  { term: 'Items', desc: 'Buy items at the shop (in base) to power up. Max 6 item slots.' },
  { term: 'Abilities', desc: 'Each hero has Q/W/E/R abilities with mana costs and cooldowns.' },
]
</script>

<template>
  <div class="mx-auto mt-6 flex max-w-[800px] flex-col gap-4">
    <TerminalPanel title="Command Reference">
      <div class="mb-3 border-b border-border pb-3">
        <span class="text-[0.8rem] text-text-dim">&gt;_ man termina</span>
      </div>
      <table class="w-full border-collapse text-xs">
        <thead>
          <tr>
            <th
              class="whitespace-nowrap border-b border-border px-1.5 py-1 text-left font-normal text-text-dim"
            >
              Command
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
          <tr v-for="c in commands" :key="c.cmd">
            <td class="whitespace-nowrap border-b border-border/50 px-1.5 py-1 text-ability">
              {{ c.cmd }}
            </td>
            <td class="border-b border-border/50 px-1.5 py-1">{{ c.desc }}</td>
            <td class="border-b border-border/50 px-1.5 py-1 text-xs text-text-dim">
              {{ c.example }}
            </td>
          </tr>
        </tbody>
      </table>
    </TerminalPanel>

    <TerminalPanel title="Game Concepts">
      <div class="flex flex-col gap-3">
        <div v-for="c in concepts" :key="c.term" class="flex flex-col gap-0.5">
          <span class="text-[0.85rem] font-bold text-gold">{{ c.term }}</span>
          <span class="pl-3 text-[0.8rem] text-text-dim">{{ c.desc }}</span>
        </div>
      </div>
    </TerminalPanel>

    <TerminalPanel title="Ready?">
      <div class="flex flex-col items-center gap-4 py-4">
        <span class="text-[0.8rem] text-text-dim">&gt;_ tutorial_complete. deploy --force</span>
        <span class="text-lg font-bold tracking-widest text-radiant">READY TO PLAY?</span>
        <div class="flex gap-3">
          <NuxtLink to="/play">
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
