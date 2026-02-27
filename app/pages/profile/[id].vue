<script setup lang="ts">
const route = useRoute()
const playerId = route.params.id as string

const mockProfile = {
  name: playerId === 'me' ? 'you' : playerId,
  rating: 2150,
  rank: 42,
  wins: 89,
  losses: 67,
  favoriteHero: 'phantom',
  totalGames: 156,
  winRate: '57.1%',
  avgKda: '5.2/3.1/8.7',
  recentMatches: [
    { id: 1, hero: 'phantom', result: 'WIN', kda: '8/2/5', duration: '24:32' },
    { id: 2, hero: 'vortex', result: 'LOSS', kda: '3/7/4', duration: '31:15' },
    { id: 3, hero: 'phantom', result: 'WIN', kda: '12/1/9', duration: '28:44' },
    { id: 4, hero: 'ironclad', result: 'WIN', kda: '2/4/15', duration: '35:01' },
    { id: 5, hero: 'spectre', result: 'LOSS', kda: '6/5/3', duration: '22:18' },
  ],
}
</script>

<template>
  <div class="profile-page">
    <TerminalPanel title="Player Profile">
      <div class="profile-header">
        <span class="profile-prompt">&gt;_ whois {{ mockProfile.name }}</span>
      </div>

      <div class="profile-stats">
        <div class="stat-row">
          <span class="stat-label">Rating:</span>
          <span class="stat-value stat-rating">{{ mockProfile.rating }}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Rank:</span>
          <span class="stat-value">#{{ mockProfile.rank }}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Record:</span>
          <span class="stat-value">
            <span class="stat-wins">{{ mockProfile.wins }}W</span>
            /
            <span class="stat-losses">{{ mockProfile.losses }}L</span>
            ({{ mockProfile.winRate }})
          </span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Avg KDA:</span>
          <span class="stat-value">{{ mockProfile.avgKda }}</span>
        </div>
        <div class="stat-row">
          <span class="stat-label">Top Hero:</span>
          <span class="stat-value stat-hero">{{ mockProfile.favoriteHero }}</span>
        </div>
      </div>
    </TerminalPanel>

    <TerminalPanel title="Recent Matches" class="profile-matches">
      <table class="scoreboard">
        <thead>
          <tr>
            <th>Hero</th>
            <th>Result</th>
            <th>KDA</th>
            <th>Duration</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in mockProfile.recentMatches" :key="m.id">
            <td class="match-hero">{{ m.hero }}</td>
            <td :class="m.result === 'WIN' ? 'match-win' : 'match-loss'">{{ m.result }}</td>
            <td>{{ m.kda }}</td>
            <td class="match-duration">{{ m.duration }}</td>
          </tr>
        </tbody>
      </table>
    </TerminalPanel>
  </div>
</template>

<style scoped>
.profile-page {
  max-width: 600px;
  margin: 24px auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.profile-header {
  padding-bottom: 12px;
  margin-bottom: 12px;
  border-bottom: 1px solid var(--border-color);
}

.profile-prompt {
  color: var(--text-dim);
  font-size: 0.8rem;
}

.profile-stats {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.stat-row {
  display: flex;
  gap: 8px;
  font-size: 0.85rem;
}

.stat-label {
  color: var(--text-dim);
  min-width: 80px;
}

.stat-value {
  color: var(--text-primary);
}

.stat-rating {
  color: var(--color-gold);
  font-weight: 700;
}

.stat-wins {
  color: var(--color-radiant);
}

.stat-losses {
  color: var(--color-dire);
}

.stat-hero {
  color: var(--color-ability);
}

.match-hero {
  color: var(--color-ability);
}

.match-win {
  color: var(--color-radiant);
  font-weight: 700;
}

.match-loss {
  color: var(--color-dire);
}

.match-duration {
  color: var(--text-dim);
}
</style>
