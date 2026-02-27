<script setup lang="ts">
import { ref } from 'vue'

// ── Mock data for UI development ──────────────────────────────────

const tick = ref(42)
const gameTime = ref('12:34')
const gold = ref(1250)
const kills = ref(3)
const deaths = ref(1)
const assists = ref(7)

const heroData = ref({
  name: 'phantom',
  level: 8,
  zone: 'mid',
  hp: 650,
  maxHp: 900,
  mp: 180,
  maxMp: 350,
  cooldowns: { q: 0, w: 3, e: 0, r: 12 },
  items: ['broadsword', 'boots', 'ring_of_health', null, null, null] as (string | null)[],
  buffs: [{ id: 'haste', stacks: 1, ticksRemaining: 3 }],
  gold: 1250,
  alive: true,
})

const combatEvents = ref([
  { tick: 38, text: 'You attack creep_melee for 72 damage', type: 'damage' as const },
  { tick: 38, text: 'You earned 35 gold (last hit)', type: 'gold' as const },
  { tick: 39, text: 'z3r0c00l casts Shadow Strike on you for 120 damage', type: 'ability' as const },
  { tick: 39, text: 'You regenerate 45 HP', type: 'healing' as const },
  { tick: 40, text: 'Allied tower attacks z3r0c00l for 120 damage', type: 'damage' as const },
  { tick: 41, text: 'KILL: You eliminated z3r0c00l! (+200g, +140xp)', type: 'kill' as const },
  { tick: 41, text: 'Your team destroyed T1 tower (top)! (+500g)', type: 'gold' as const },
  { tick: 42, text: 'Creep wave spawned in all lanes', type: 'system' as const },
])

const mapZones = ref([
  { id: 'base_r', name: 'Base (R)', playerHere: false, allies: [], enemyCount: 0, fogged: false },
  { id: 'top', name: 'Top Lane', playerHere: false, allies: ['ironclad'], enemyCount: 1, tower: { team: 'radiant' as const, alive: true, tier: 1 }, fogged: false },
  { id: 'mid', name: 'Mid Lane', playerHere: true, allies: [], enemyCount: 0, tower: { team: 'radiant' as const, alive: true, tier: 1 }, fogged: false },
  { id: 'bot', name: 'Bot Lane', playerHere: false, allies: ['spectre'], enemyCount: 0, tower: { team: 'radiant' as const, alive: true, tier: 1 }, fogged: false },
  { id: 'jungle_t', name: 'Jungle (Top)', playerHere: false, allies: [], enemyCount: 0, fogged: true },
  { id: 'jungle_b', name: 'Jungle (Bot)', playerHere: false, allies: [], enemyCount: 0, fogged: false },
  { id: 'roshan', name: 'Roshan Pit', playerHere: false, allies: [], enemyCount: 0, fogged: true },
  { id: 'top_e', name: 'Top (Dire)', playerHere: false, allies: [], enemyCount: 0, fogged: true },
  { id: 'mid_e', name: 'Mid (Dire)', playerHere: false, allies: [], enemyCount: 2, tower: { team: 'dire' as const, alive: true, tier: 1 }, fogged: false },
  { id: 'bot_e', name: 'Bot (Dire)', playerHere: false, allies: [], enemyCount: 0, fogged: true },
  { id: 'base_d', name: 'Base (D)', playerHere: false, allies: [], enemyCount: 0, fogged: true },
])

function handleCommand(cmd: string) {
  combatEvents.value.push({
    tick: tick.value,
    text: `> ${cmd}`,
    type: 'system',
  })
}
</script>

<template>
  <div class="game-grid">
    <GameStateBar
      class="game-grid__bar"
      :tick="tick"
      :game-time="gameTime"
      :gold="gold"
      :kills="kills"
      :deaths="deaths"
      :assists="assists"
    />

    <TerminalPanel title="Map" class="game-grid__map">
      <AsciiMap :zones="mapZones" player-zone="mid" />
    </TerminalPanel>

    <TerminalPanel title="Combat Log" class="game-grid__log">
      <CombatLog :events="combatEvents" />
    </TerminalPanel>

    <TerminalPanel title="Hero Status" class="game-grid__hero">
      <HeroStatus :hero="heroData" />
    </TerminalPanel>

    <div class="game-grid__cmd">
      <div class="cmd-presets">
        <button class="cmd-preset-btn" @click="handleCommand('attack')">ATK</button>
        <button class="cmd-preset-btn" @click="handleCommand('cast q')">Q</button>
        <button class="cmd-preset-btn" @click="handleCommand('cast w')">W</button>
        <button class="cmd-preset-btn" @click="handleCommand('cast e')">E</button>
        <button class="cmd-preset-btn" @click="handleCommand('cast r')">R</button>
        <button class="cmd-preset-btn" @click="handleCommand('move')">MOVE</button>
      </div>
      <CommandInput
        placeholder="Enter command (Tab for autocomplete)..."
        :tick-countdown="2400"
        @submit="handleCommand"
      />
    </div>
  </div>
</template>

<style scoped>
.game-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: auto 1fr 1fr auto;
  gap: 2px;
  height: 100vh;
  background: var(--bg-primary);
}

.game-grid__bar {
  grid-column: 1 / -1;
}

.game-grid__map {
  grid-row: 2;
  grid-column: 1;
  min-height: 0;
}

.game-grid__log {
  grid-row: 2;
  grid-column: 2;
  min-height: 0;
}

.game-grid__hero {
  grid-row: 3;
  grid-column: 1;
  min-height: 0;
}

.game-grid__cmd {
  grid-row: 3 / 5;
  grid-column: 2;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  min-height: 0;
}

/* Tablet */
@media (max-width: 1024px) {
  .game-grid {
    grid-template-columns: 1fr 1fr;
    grid-template-rows: auto 1fr 1fr 1fr auto;
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
    grid-column: 1 / -1;
    grid-row: 4;
  }

  .game-grid__cmd {
    grid-column: 1 / -1;
    grid-row: 5;
  }
}

/* Mobile */
@media (max-width: 640px) {
  .game-grid {
    grid-template-columns: 1fr;
    grid-template-rows: auto 1fr 1fr 1fr auto;
  }

  .game-grid__map {
    grid-column: 1;
    grid-row: 2;
  }

  .game-grid__log {
    grid-column: 1;
    grid-row: 3;
  }

  .game-grid__hero {
    grid-column: 1;
    grid-row: 4;
  }

  .game-grid__cmd {
    grid-column: 1;
    grid-row: 5;
  }
}
</style>
