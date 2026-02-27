<script setup lang="ts">
interface PlayerScore {
  name: string
  heroId: string
  team: 'radiant' | 'dire'
  kills: number
  deaths: number
  assists: number
  gold: number
  level: number
  items: (string | null)[]
}

defineProps<{
  players: PlayerScore[]
}>()
</script>

<template>
  <div class="scoreboard-wrapper">
    <table class="scoreboard">
      <thead>
        <tr>
          <th>Hero</th>
          <th>Player</th>
          <th>K</th>
          <th>D</th>
          <th>A</th>
          <th>Gold</th>
          <th>Lv</th>
          <th>Items</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="p in players"
          :key="p.name"
          :class="p.team === 'radiant' ? 'tr--radiant' : 'tr--dire'"
        >
          <td class="sb__hero">{{ p.heroId }}</td>
          <td>{{ p.name }}</td>
          <td class="sb__kills">{{ p.kills }}</td>
          <td class="sb__deaths">{{ p.deaths }}</td>
          <td class="sb__assists">{{ p.assists }}</td>
          <td class="sb__gold">{{ p.gold.toLocaleString() }}</td>
          <td>{{ p.level }}</td>
          <td class="sb__items">
            <span v-for="(item, i) in p.items.slice(0, 6)" :key="i" class="sb__item">
              {{ item || '-' }}
            </span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.scoreboard-wrapper {
  overflow-x: auto;
}

.scoreboard {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.75rem;
}

.scoreboard th {
  color: var(--text-dim);
  font-weight: 400;
  text-align: left;
  padding: 4px 6px;
  border-bottom: 1px solid var(--border-color);
  white-space: nowrap;
}

.scoreboard td {
  padding: 4px 6px;
  border-bottom: 1px solid rgba(26, 26, 46, 0.5);
  white-space: nowrap;
}

.tr--radiant td:first-child {
  border-left: 2px solid var(--color-radiant);
}

.tr--dire td:first-child {
  border-left: 2px solid var(--color-dire);
}

.sb__hero {
  color: var(--color-ability);
}

.sb__kills {
  color: var(--color-radiant);
}

.sb__deaths {
  color: var(--color-dire);
}

.sb__assists {
  color: var(--text-dim);
}

.sb__gold {
  color: var(--color-gold);
}

.sb__items {
  display: flex;
  gap: 4px;
}

.sb__item {
  color: var(--text-dim);
  font-size: 0.7rem;
}
</style>
