<script setup lang="ts">
import { formatTickClock } from '~/utils/gameClock'

interface LeaderboardEntry {
  rank: number
  id: string
  username: string
  avatarUrl: string | null
  mmr: number
  gamesPlayed: number
  wins: number
  winRate: number
}

interface ActiveGame {
  gameId: string
  tick: number
  radiantKills: number
  direKills: number
  radiantHeroes: string[]
  direHeroes: string[]
}

const {
  data,
  status,
  refresh: refreshLeaderboard,
} = await useFetch<{ leaderboard: LeaderboardEntry[] }>('/api/leaderboard')
const { data: activeData, refresh: refreshActive } = await useFetch<{ games: ActiveGame[] }>(
  '/api/match/active',
  {
    // Re-fetch every 10s while the page is open
    server: false,
  },
)

// Poll both the leaderboard + active games every 10s while the page is open.
let pollTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  pollTimer = setInterval(() => {
    void refreshActive()
    void refreshLeaderboard()
  }, 10_000)
})
onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
})

const players = computed(() => data.value?.leaderboard ?? [])
const activeGames = computed(() => activeData.value?.games ?? [])

// Highlight the viewing player's own row so they can spot their rank at a glance
// (null when anonymous — the leaderboard is public).
const { user } = useUserSession()
const meId = computed(() => (user.value?.id as string | undefined) ?? null)

function gameTime(tick: number): string {
  return formatTickClock(tick)
}
</script>

<template>
  <div class="mx-auto mt-6 flex max-w-[700px] flex-col gap-4">
    <TerminalPanel v-if="activeGames.length > 0" title="Live Games">
      <div class="mb-2 border-b border-border pb-2 text-[0.8rem] text-text-dim">
        &gt;_ {{ activeGames.length }} game{{ activeGames.length === 1 ? '' : 's' }} in progress —
        click to spectate
      </div>
      <div class="flex flex-col">
        <div
          v-for="g in activeGames"
          :key="g.gameId"
          class="flex items-center justify-between gap-3 border-b border-border/50 py-1.5 text-[0.8rem] last:border-0"
        >
          <div class="flex flex-col">
            <div class="t-mono-num">
              <span class="text-radiant">{{ g.radiantKills }}</span>
              <span class="mx-1 text-text-muted">vs</span>
              <span class="text-dire">{{ g.direKills }}</span>
              <span class="ml-3 text-text-dim">@ {{ gameTime(g.tick) }}</span>
            </div>
            <div class="text-[0.7rem] text-text-dim">
              <span class="text-radiant">{{ g.radiantHeroes.join(', ') }}</span>
              <span class="mx-1">·</span>
              <span class="text-dire">{{ g.direHeroes.join(', ') }}</span>
            </div>
          </div>
          <NuxtLink
            :to="`/spectate/${g.gameId}`"
            class="border border-warn px-2 py-0.5 text-warn no-underline hover:bg-warn/10 hover:text-radiant"
          >
            [spectate]
          </NuxtLink>
        </div>
      </div>
    </TerminalPanel>

    <TerminalPanel title="Leaderboard">
      <div class="mb-3 border-b border-border pb-3">
        <span class="text-[0.8rem] text-text-dim">&gt;_ top players by rating</span>
      </div>

      <div v-if="status === 'pending'" class="py-6 text-center text-[0.85rem] text-text-dim">
        Loading leaderboard<span class="animate-blink">_</span>
      </div>

      <div v-else-if="status === 'error'" class="py-6 text-center text-[0.85rem] text-dire">
        Couldn't load the leaderboard.
        <button type="button" class="text-ability hover:text-radiant" @click="refreshLeaderboard()">
          retry
        </button>
      </div>

      <div v-else-if="players.length === 0" class="py-6 text-center text-[0.85rem] text-text-dim">
        No players found.
      </div>

      <table v-else class="w-full border-collapse text-xs">
        <caption class="sr-only">
          Top players ranked by rating
        </caption>
        <thead>
          <tr>
            <th
              scope="col"
              class="whitespace-nowrap border-b border-border px-1.5 py-1 text-left font-normal text-text-dim"
            >
              #
            </th>
            <th
              scope="col"
              class="whitespace-nowrap border-b border-border px-1.5 py-1 text-left font-normal text-text-dim"
            >
              Player
            </th>
            <th
              scope="col"
              class="whitespace-nowrap border-b border-border px-1.5 py-1 text-left font-normal text-text-dim"
            >
              Rating
            </th>
            <th
              scope="col"
              class="whitespace-nowrap border-b border-border px-1.5 py-1 text-left font-normal text-text-dim"
            >
              W
            </th>
            <th
              scope="col"
              class="whitespace-nowrap border-b border-border px-1.5 py-1 text-left font-normal text-text-dim"
            >
              L
            </th>
            <th
              scope="col"
              class="whitespace-nowrap border-b border-border px-1.5 py-1 text-left font-normal text-text-dim"
            >
              Win%
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="p in players"
            :key="p.id"
            :class="{ 'bg-ability/10 font-bold': p.id === meId }"
            :data-self="p.id === meId ? 'true' : undefined"
          >
            <td class="border-b border-border/50 px-1.5 py-1 text-text-dim">{{ p.rank }}</td>
            <th scope="row" class="border-b border-border/50 px-1.5 py-1 text-left font-normal">
              <NuxtLink :to="`/profile/${p.id}`" class="text-ability">{{ p.username }}</NuxtLink>
              <span v-if="p.id === meId" class="ml-1 text-[0.65rem] text-radiant">
                &lt; you<span class="sr-only"> (this is your rank)</span>
              </span>
            </th>
            <td class="border-b border-border/50 px-1.5 py-1 font-bold text-gold">{{ p.mmr }}</td>
            <td class="border-b border-border/50 px-1.5 py-1 text-radiant">{{ p.wins }}</td>
            <td class="border-b border-border/50 px-1.5 py-1 text-dire">
              {{ p.gamesPlayed - p.wins }}
            </td>
            <td class="border-b border-border/50 px-1.5 py-1">{{ p.winRate }}%</td>
          </tr>
        </tbody>
      </table>
    </TerminalPanel>
  </div>
</template>
