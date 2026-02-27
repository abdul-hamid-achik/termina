<script setup lang="ts">
const mockPlayers = [
  { rank: 1, name: 'ph4nt0m', rating: 2847, wins: 342, losses: 198, winRate: '63.3%' },
  { rank: 2, name: 'z3r0c00l', rating: 2791, wins: 289, losses: 177, winRate: '62.0%' },
  { rank: 3, name: 'n3ur0', rating: 2756, wins: 401, losses: 261, winRate: '60.6%' },
  { rank: 4, name: 'synt4x', rating: 2698, wins: 156, losses: 104, winRate: '60.0%' },
  { rank: 5, name: 'byteKill', rating: 2654, wins: 523, losses: 367, winRate: '58.8%' },
  { rank: 6, name: 'sh3llsh0ck', rating: 2612, wins: 234, losses: 178, winRate: '56.8%' },
  { rank: 7, name: 'r00tkit', rating: 2589, wins: 445, losses: 341, winRate: '56.6%' },
  { rank: 8, name: 'v0id_', rating: 2534, wins: 189, losses: 147, winRate: '56.3%' },
  { rank: 9, name: 'xpl0it', rating: 2501, wins: 312, losses: 256, winRate: '54.9%' },
  { rank: 10, name: 'malware_', rating: 2467, wins: 267, losses: 223, winRate: '54.5%' },
]
</script>

<template>
  <div class="leaderboard-page">
    <TerminalPanel title="Leaderboard">
      <div class="lb-header">
        <span class="lb-prompt">&gt;_ top players by rating</span>
      </div>
      <table class="scoreboard">
        <thead>
          <tr>
            <th>#</th>
            <th>Player</th>
            <th>Rating</th>
            <th>W</th>
            <th>L</th>
            <th>Win%</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in mockPlayers" :key="p.rank">
            <td class="lb-rank">{{ p.rank }}</td>
            <td>
              <NuxtLink :to="`/profile/${p.name}`" class="lb-name">{{ p.name }}</NuxtLink>
            </td>
            <td class="lb-rating">{{ p.rating }}</td>
            <td class="lb-wins">{{ p.wins }}</td>
            <td class="lb-losses">{{ p.losses }}</td>
            <td>{{ p.winRate }}</td>
          </tr>
        </tbody>
      </table>
    </TerminalPanel>
  </div>
</template>

<style scoped>
.leaderboard-page {
  max-width: 700px;
  margin: 24px auto;
}

.lb-header {
  padding-bottom: 12px;
  margin-bottom: 12px;
  border-bottom: 1px solid var(--border-color);
}

.lb-prompt {
  color: var(--text-dim);
  font-size: 0.8rem;
}

.lb-rank {
  color: var(--text-dim);
  width: 30px;
}

.lb-name {
  color: var(--color-ability);
}

.lb-rating {
  color: var(--color-gold);
  font-weight: 700;
}

.lb-wins {
  color: var(--color-radiant);
}

.lb-losses {
  color: var(--color-dire);
}
</style>
