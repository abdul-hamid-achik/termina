<script setup lang="ts">
import { computed } from 'vue'
import type { TeamId } from '~~/shared/types/game'
import type { PlayerEndStats } from '~~/shared/types/protocol'

const props = defineProps<{
  winner: TeamId
  stats: Record<string, PlayerEndStats>
  players: Array<{
    id: string
    name: string
    heroId: string
    team: TeamId
  }>
  currentPlayerId: string
  mmrChange?: number
}>()

const emit = defineEmits<{
  playAgain: []
  returnToMenu: []
}>()

interface ScoreRow {
  id: string
  name: string
  heroId: string
  team: TeamId
  kills: number
  deaths: number
  assists: number
  gold: number
  heroDamage: number
  towerDamage: number
  items: (string | null)[]
  isCurrentPlayer: boolean
}

const radiantPlayers = computed((): ScoreRow[] =>
  props.players
    .filter(p => p.team === 'radiant')
    .map(p => toRow(p)),
)

const direPlayers = computed((): ScoreRow[] =>
  props.players
    .filter(p => p.team === 'dire')
    .map(p => toRow(p)),
)

const myStats = computed(() => {
  const s = props.stats[props.currentPlayerId]
  if (!s) return null
  return s
})

function toRow(p: { id: string; name: string; heroId: string; team: TeamId }): ScoreRow {
  const s = props.stats[p.id]
  return {
    id: p.id,
    name: p.name,
    heroId: p.heroId,
    team: p.team,
    kills: s?.kills ?? 0,
    deaths: s?.deaths ?? 0,
    assists: s?.assists ?? 0,
    gold: s?.gold ?? 0,
    heroDamage: s?.heroDamage ?? 0,
    towerDamage: s?.towerDamage ?? 0,
    items: s?.items ?? [],
    isCurrentPlayer: p.id === props.currentPlayerId,
  }
}
</script>

<template>
  <div class="post-game">
    <div
      class="pg__banner"
      :class="winner === 'radiant' ? 'pg__banner--radiant' : 'pg__banner--dire'"
    >
      <span class="pg__banner-text">
        {{ winner === 'radiant' ? 'RADIANT VICTORY' : 'DIRE VICTORY' }}
      </span>
    </div>

    <div v-if="myStats" class="pg__personal">
      <TerminalPanel title="Your Performance">
        <div class="pg__personal-body">
          <div class="pg__stat">
            <span class="pg__stat-label">K/D/A</span>
            <span class="pg__stat-value">
              <span class="pg__kills">{{ myStats.kills }}</span>
              <span class="pg__sep">/</span>
              <span class="pg__deaths">{{ myStats.deaths }}</span>
              <span class="pg__sep">/</span>
              <span class="pg__assists">{{ myStats.assists }}</span>
            </span>
          </div>
          <div class="pg__stat">
            <span class="pg__stat-label">Hero Damage</span>
            <span class="pg__stat-value">{{ myStats.heroDamage.toLocaleString() }}</span>
          </div>
          <div class="pg__stat">
            <span class="pg__stat-label">Tower Damage</span>
            <span class="pg__stat-value">{{ myStats.towerDamage.toLocaleString() }}</span>
          </div>
          <div class="pg__stat">
            <span class="pg__stat-label">Gold Earned</span>
            <span class="pg__stat-value pg__gold">{{ myStats.gold.toLocaleString() }}</span>
          </div>
          <div v-if="mmrChange !== undefined" class="pg__stat">
            <span class="pg__stat-label">MMR</span>
            <span
              class="pg__stat-value"
              :class="mmrChange >= 0 ? 'pg__mmr-up' : 'pg__mmr-down'"
            >
              {{ mmrChange >= 0 ? '+' : '' }}{{ mmrChange }}
            </span>
          </div>
        </div>
      </TerminalPanel>
    </div>

    <div class="pg__scoreboard">
      <TerminalPanel title="Scoreboard">
        <div class="pg__team-label pg__team-label--radiant">RADIANT</div>
        <table class="pg__table">
          <thead>
            <tr>
              <th>Hero</th>
              <th>Player</th>
              <th>K</th>
              <th>D</th>
              <th>A</th>
              <th>DMG</th>
              <th>Gold</th>
              <th>Items</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="p in radiantPlayers"
              :key="p.id"
              :class="{ 'pg__row--self': p.isCurrentPlayer }"
            >
              <td class="pg__td-hero">{{ p.heroId }}</td>
              <td>{{ p.name }}</td>
              <td class="pg__td-kills">{{ p.kills }}</td>
              <td class="pg__td-deaths">{{ p.deaths }}</td>
              <td class="pg__td-assists">{{ p.assists }}</td>
              <td>{{ p.heroDamage.toLocaleString() }}</td>
              <td class="pg__td-gold">{{ p.gold.toLocaleString() }}</td>
              <td class="pg__td-items">
                <span v-for="(item, i) in p.items.slice(0, 6)" :key="i">
                  {{ item || '-' }}{{ i < 5 ? ' ' : '' }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>

        <div class="pg__team-label pg__team-label--dire">DIRE</div>
        <table class="pg__table">
          <thead>
            <tr>
              <th>Hero</th>
              <th>Player</th>
              <th>K</th>
              <th>D</th>
              <th>A</th>
              <th>DMG</th>
              <th>Gold</th>
              <th>Items</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="p in direPlayers"
              :key="p.id"
              :class="{ 'pg__row--self': p.isCurrentPlayer }"
            >
              <td class="pg__td-hero">{{ p.heroId }}</td>
              <td>{{ p.name }}</td>
              <td class="pg__td-kills">{{ p.kills }}</td>
              <td class="pg__td-deaths">{{ p.deaths }}</td>
              <td class="pg__td-assists">{{ p.assists }}</td>
              <td>{{ p.heroDamage.toLocaleString() }}</td>
              <td class="pg__td-gold">{{ p.gold.toLocaleString() }}</td>
              <td class="pg__td-items">
                <span v-for="(item, i) in p.items.slice(0, 6)" :key="i">
                  {{ item || '-' }}{{ i < 5 ? ' ' : '' }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </TerminalPanel>
    </div>

    <div class="pg__actions">
      <AsciiButton
        label="PLAY AGAIN"
        variant="primary"
        @click="emit('playAgain')"
      />
      <AsciiButton
        label="MAIN MENU"
        variant="ghost"
        @click="emit('returnToMenu')"
      />
    </div>
  </div>
</template>

<style scoped>
.post-game {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
  background: var(--bg-primary);
  min-height: 100vh;
}

.pg__banner {
  text-align: center;
  padding: 16px;
  border: 1px solid var(--border-color);
}

.pg__banner--radiant {
  border-color: var(--color-radiant);
  box-shadow: 0 0 16px rgba(46, 204, 113, 0.3);
}

.pg__banner--dire {
  border-color: var(--color-dire);
  box-shadow: 0 0 16px rgba(233, 69, 96, 0.3);
}

.pg__banner-text {
  font-size: 1.5rem;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-shadow: 0 0 12px currentColor;
}

.pg__banner--radiant .pg__banner-text {
  color: var(--color-radiant);
}

.pg__banner--dire .pg__banner-text {
  color: var(--color-dire);
}

.pg__personal-body {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}

.pg__stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.pg__stat-label {
  color: var(--text-dim);
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.pg__stat-value {
  color: var(--text-primary);
  font-size: 1rem;
  font-weight: 700;
}

.pg__kills { color: var(--color-radiant); }
.pg__deaths { color: var(--color-dire); }
.pg__assists { color: var(--text-dim); }
.pg__sep { color: var(--text-dim); margin: 0 2px; }
.pg__gold { color: var(--color-gold); }
.pg__mmr-up { color: var(--color-radiant); }
.pg__mmr-down { color: var(--color-dire); }

.pg__team-label {
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  padding: 6px 0 4px;
}

.pg__team-label--radiant { color: var(--color-radiant); }
.pg__team-label--dire { color: var(--color-dire); }

.pg__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.75rem;
  margin-bottom: 12px;
}

.pg__table th {
  color: var(--text-dim);
  font-weight: 400;
  text-align: left;
  padding: 3px 6px;
  border-bottom: 1px solid var(--border-color);
}

.pg__table td {
  padding: 3px 6px;
  border-bottom: 1px solid rgba(26, 26, 46, 0.5);
  white-space: nowrap;
}

.pg__row--self td {
  background: rgba(0, 212, 255, 0.05);
  font-weight: 700;
}

.pg__td-hero { color: var(--color-ability); }
.pg__td-kills { color: var(--color-radiant); }
.pg__td-deaths { color: var(--color-dire); }
.pg__td-assists { color: var(--text-dim); }
.pg__td-gold { color: var(--color-gold); }

.pg__td-items {
  font-size: 0.65rem;
  color: var(--text-dim);
}

.pg__actions {
  display: flex;
  justify-content: center;
  gap: 16px;
  padding-top: 8px;
}
</style>
