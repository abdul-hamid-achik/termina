<script setup lang="ts">
import { useAuthStore } from '~/stores/auth'

const route = useRoute()
const authStore = useAuthStore()

const playerId = computed(() => {
  const id = route.params.id as string
  return id === 'me' ? (authStore.user?.id ?? '') : id
})

const isOwnProfile = computed(() => {
  return authStore.user?.id === playerId.value
})

const { data: profileData, status: profileStatus } = await useFetch(
  () => `/api/player/${playerId.value}`,
  {
    watch: [playerId],
  },
)

const { data: matchData } = await useFetch(() => `/api/match/history?player=${playerId.value}`, {
  watch: [playerId],
})

const player = computed(() => (profileData.value as Record<string, unknown>)?.player ?? null)
const recentMatches = computed(() => (matchData.value as Record<string, unknown>)?.matches ?? [])

function formatDuration(ticks: number | null): string {
  if (!ticks) return '--:--'
  const totalSeconds = ticks * 4
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '--'
  return new Date(dateStr).toLocaleDateString()
}
</script>

<template>
  <div class="mx-auto mt-6 flex max-w-[600px] flex-col gap-4">
    <div v-if="profileStatus === 'pending'" class="py-10 text-center text-[0.85rem] text-text-dim">
      Loading profile<span class="animate-blink">_</span>
    </div>

    <div v-else-if="!player" class="py-10 text-center">
      <TerminalPanel title="Error">
        <p class="p-4 text-[0.85rem] text-dire">Player not found.</p>
      </TerminalPanel>
    </div>

    <template v-else>
      <TerminalPanel title="Player Profile">
        <div class="mb-3 flex items-center justify-between border-b border-border pb-3">
          <div class="flex items-center gap-3">
            <ClientOnly>
              <HeroAvatar
                v-if="player.selectedAvatar"
                :hero-id="player.selectedAvatar"
                :size="48"
              />
            </ClientOnly>
            <span class="text-[0.8rem] text-text-dim">&gt;_ whois {{ player.username }}</span>
          </div>
          <NuxtLink
            v-if="isOwnProfile"
            to="/profile/settings"
            class="text-[0.75rem] text-ability no-underline hover:text-radiant"
          >
            [EDIT]
          </NuxtLink>
        </div>

        <div class="flex flex-col gap-1.5">
          <div class="flex gap-2 text-[0.85rem]">
            <span class="min-w-[80px] text-text-dim">Rating:</span>
            <span class="font-bold text-gold">{{ player.mmr ?? 1000 }}</span>
          </div>
          <div class="flex gap-2 text-[0.85rem]">
            <span class="min-w-[80px] text-text-dim">Games:</span>
            <span class="text-text-primary">{{ player.gamesPlayed ?? 0 }}</span>
          </div>
          <div class="flex gap-2 text-[0.85rem]">
            <span class="min-w-[80px] text-text-dim">Record:</span>
            <span class="text-text-primary">
              <span class="text-radiant">{{ player.wins ?? 0 }}W</span>
              /
              <span class="text-dire">{{ (player.gamesPlayed ?? 0) - (player.wins ?? 0) }}L</span>
              <template v-if="player.gamesPlayed > 0">
                ({{ ((player.wins / player.gamesPlayed) * 100).toFixed(1) }}%)
              </template>
            </span>
          </div>
          <div class="flex gap-2 text-[0.85rem]">
            <span class="min-w-[80px] text-text-dim">Joined:</span>
            <span class="text-text-primary">{{ formatDate(player.createdAt) }}</span>
          </div>
        </div>
      </TerminalPanel>

      <TerminalPanel title="Recent Matches">
        <div v-if="recentMatches.length === 0" class="py-4 text-center text-[0.8rem] text-text-dim">
          No matches played yet.
        </div>
        <table v-else class="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th
                class="whitespace-nowrap border-b border-border px-1.5 py-1 text-left font-normal text-text-dim"
              >
                Mode
              </th>
              <th
                class="whitespace-nowrap border-b border-border px-1.5 py-1 text-left font-normal text-text-dim"
              >
                Result
              </th>
              <th
                class="whitespace-nowrap border-b border-border px-1.5 py-1 text-left font-normal text-text-dim"
              >
                Duration
              </th>
              <th
                class="whitespace-nowrap border-b border-border px-1.5 py-1 text-left font-normal text-text-dim"
              >
                Date
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="m in recentMatches" :key="m.id">
              <td class="border-b border-border/50 px-1.5 py-1 text-ability">{{ m.mode }}</td>
              <td
                class="border-b border-border/50 px-1.5 py-1 font-bold"
                :class="m.winner ? 'text-radiant' : 'text-text-dim'"
              >
                {{ m.winner ?? 'IN PROGRESS' }}
              </td>
              <td class="border-b border-border/50 px-1.5 py-1 text-text-dim">
                {{ formatDuration(m.durationTicks) }}
              </td>
              <td class="border-b border-border/50 px-1.5 py-1 text-text-dim">
                {{ formatDate(m.createdAt) }}
              </td>
            </tr>
          </tbody>
        </table>
      </TerminalPanel>
    </template>
  </div>
</template>
