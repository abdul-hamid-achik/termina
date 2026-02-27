<script setup lang="ts">
const commands = [
  { cmd: 'move <zone>', desc: 'Move your hero to an adjacent zone', example: 'move mid' },
  { cmd: 'attack <target>', desc: 'Attack a target in your zone (hero, creep, or tower)', example: 'attack hero:phantom' },
  { cmd: 'cast <ability> [target]', desc: 'Cast an ability (q/w/e/r) on optional target', example: 'cast q hero:vortex' },
  { cmd: 'use <item> [target]', desc: 'Use an active item on optional target', example: 'use blink' },
  { cmd: 'buy <item>', desc: 'Purchase an item from the shop (must be in base)', example: 'buy broadsword' },
  { cmd: 'sell <item>', desc: 'Sell an item for half its value', example: 'sell boots' },
  { cmd: 'ward <zone>', desc: 'Place a ward for team vision', example: 'ward jungle_top' },
  { cmd: 'scan', desc: 'Reveal enemy positions briefly (long cooldown)', example: 'scan' },
  { cmd: 'status', desc: 'View your hero stats, items, and buffs', example: 'status' },
  { cmd: 'map', desc: 'View current zone map with known positions', example: 'map' },
  { cmd: 'chat <channel> <msg>', desc: 'Send a message to team or all chat', example: 'chat team gather mid' },
  { cmd: 'ping <zone>', desc: 'Ping a zone to alert your team', example: 'ping roshan' },
]

const concepts = [
  { term: 'Tick', desc: 'The game advances in 4-second ticks. You submit one command per tick during the action window (3.5s).' },
  { term: 'Fog of War', desc: 'You can only see zones where your team has vision (heroes, wards, towers). Unknown zones show as [???].' },
  { term: 'Zones', desc: 'The map is divided into zones (lanes, jungle, base). Move between adjacent zones.' },
  { term: 'Creep Waves', desc: 'AI creeps spawn every 8 ticks and march down lanes. Last-hit them for gold and XP.' },
  { term: 'Towers', desc: 'Defensive structures in each lane. Destroy enemy towers to advance. They hit hard.' },
  { term: 'Roshan', desc: 'Powerful neutral boss. Killing Roshan grants bonus gold and the Aegis of the Immortal.' },
  { term: 'Items', desc: 'Buy items at the shop (in base) to power up. Max 6 item slots.' },
  { term: 'Abilities', desc: 'Each hero has Q/W/E/R abilities with mana costs and cooldowns.' },
]
</script>

<template>
  <div class="learn-page">
    <TerminalPanel title="Command Reference">
      <div class="learn-header">
        <span class="learn-prompt">&gt;_ man termina</span>
      </div>
      <table class="scoreboard">
        <thead>
          <tr>
            <th>Command</th>
            <th>Description</th>
            <th>Example</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in commands" :key="c.cmd">
            <td class="cmd-name">{{ c.cmd }}</td>
            <td>{{ c.desc }}</td>
            <td class="cmd-example">{{ c.example }}</td>
          </tr>
        </tbody>
      </table>
    </TerminalPanel>

    <TerminalPanel title="Game Concepts" class="learn-concepts">
      <div class="concepts-list">
        <div v-for="c in concepts" :key="c.term" class="concept">
          <span class="concept__term">{{ c.term }}</span>
          <span class="concept__desc">{{ c.desc }}</span>
        </div>
      </div>
    </TerminalPanel>
  </div>
</template>

<style scoped>
.learn-page {
  max-width: 800px;
  margin: 24px auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.learn-header {
  padding-bottom: 12px;
  margin-bottom: 12px;
  border-bottom: 1px solid var(--border-color);
}

.learn-prompt {
  color: var(--text-dim);
  font-size: 0.8rem;
}

.cmd-name {
  color: var(--color-ability);
  white-space: nowrap;
}

.cmd-example {
  color: var(--text-dim);
  font-size: 0.75rem;
}

.concepts-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.concept {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.concept__term {
  color: var(--color-gold);
  font-weight: 700;
  font-size: 0.85rem;
}

.concept__desc {
  color: var(--text-dim);
  font-size: 0.8rem;
  padding-left: 12px;
}
</style>
