<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'

interface PartyMember {
  playerId: string
  username: string
  mmr: number
}
interface Party {
  code: string
  leaderId: string
  members: PartyMember[]
  createdAt: number
}

const props = defineProps<{ myPlayerId: string | null }>()

const party = ref<Party | null>(null)
const joinCode = ref('')
const busy = ref(false)
const error = ref<string | null>(null)

const isLeader = computed(() => !!props.myPlayerId && party.value?.leaderId === props.myPlayerId)

async function refresh() {
  try {
    const res = await $fetch<{ party: Party | null }>('/api/party/status')
    party.value = res.party
  } catch {
    party.value = null
  }
}

async function createParty() {
  busy.value = true
  error.value = null
  try {
    const res = await $fetch<{ party: Party }>('/api/party/create', { method: 'POST' })
    party.value = res.party
  } catch (e) {
    error.value = (e as { data?: { message?: string } })?.data?.message ?? 'Could not create party'
  } finally {
    busy.value = false
  }
}

async function joinParty() {
  if (!joinCode.value.trim()) return
  busy.value = true
  error.value = null
  try {
    const res = await $fetch<{ party: Party }>('/api/party/join', {
      method: 'POST',
      body: { code: joinCode.value.trim() },
    })
    party.value = res.party
    joinCode.value = ''
  } catch (e) {
    error.value = (e as { data?: { message?: string } })?.data?.message ?? 'Could not join party'
  } finally {
    busy.value = false
  }
}

async function leaveParty() {
  busy.value = true
  error.value = null
  try {
    await $fetch('/api/party/leave', { method: 'POST' })
    party.value = null
  } catch (e) {
    error.value = (e as { data?: { message?: string } })?.data?.message ?? 'Could not leave party'
  } finally {
    busy.value = false
  }
}

const emit = defineEmits<{ started: [gameId: string] }>()

async function startCoop() {
  busy.value = true
  error.value = null
  try {
    // The all-Vercel path (server/api/party/start-coop.post.ts) starts the
    // live game directly — no draft, no lobbyId, round-robin heroes — so
    // this hands the caller a gameId straight away instead of waiting on a
    // WS lobby_state push (which no longer exists) to drive a draft screen.
    const res = await $fetch<{ success: boolean; gameId: string }>('/api/party/start-coop', {
      method: 'POST',
    })
    emit('started', res.gameId)
    party.value = null
  } catch (e) {
    error.value = (e as { data?: { message?: string } })?.data?.message ?? 'Could not start co-op'
  } finally {
    busy.value = false
  }
}

// Party state lives in server memory with no push channel — a member joining
// or leaving is invisible until something re-reads /api/party/status. Poll
// lightly while the panel is mounted so the roster stays honest.
let pollTimer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  void refresh()
  pollTimer = setInterval(() => void refresh(), 10_000)
})

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
})
</script>

<template>
  <TerminalPanel title="Play With Friends" title-as="h2">
    <div class="flex flex-col gap-3 p-4">
      <p class="text-[0.78rem] leading-relaxed text-text-dim">
        Party up and play co-op vs bots — your group takes Chaff, bots fill the rest. No rating on
        the line, just a game with friends.
      </p>

      <!-- Not in a party: create or join -->
      <template v-if="!party">
        <AsciiButton label="CREATE PARTY" variant="primary" :disabled="busy" @click="createParty" />
        <div class="flex items-center gap-2">
          <input
            v-model="joinCode"
            type="text"
            maxlength="5"
            placeholder="CODE"
            data-testid="party-join-code"
            class="min-w-0 flex-1 border border-border bg-bg-panel px-2 py-1.5 font-mono text-sm uppercase tracking-[0.3em] text-text-primary placeholder:text-text-muted focus:border-ability focus:outline-none"
            @keyup.enter="joinParty"
          />
          <AsciiButton
            label="JOIN"
            variant="ghost"
            :disabled="busy || !joinCode.trim()"
            @click="joinParty"
          />
        </div>
      </template>

      <!-- In a party: members + start/leave -->
      <template v-else>
        <div class="flex items-center justify-between border border-gold/40 bg-gold/10 px-3 py-2">
          <span class="text-[0.7rem] uppercase tracking-wider text-text-dim">Party code</span>
          <span
            class="font-mono text-lg font-bold tracking-[0.3em] text-gold text-glow-gold"
            data-testid="party-code"
            >{{ party.code }}</span
          >
        </div>
        <div class="flex flex-col gap-1" data-testid="party-members">
          <div
            v-for="m in party.members"
            :key="m.playerId"
            class="flex items-center justify-between border-b border-border/40 py-1 text-[0.8rem] last:border-0"
          >
            <span
              class="font-mono"
              :class="m.playerId === myPlayerId ? 'text-chaff' : 'text-text-primary'"
            >
              {{ m.username
              }}<span v-if="m.playerId === myPlayerId" class="ml-1 text-text-dim">(you)</span>
            </span>
            <span v-if="m.playerId === party.leaderId" class="text-[0.6rem] uppercase text-gold"
              >leader</span
            >
          </div>
        </div>
        <div class="text-[0.68rem] text-text-muted">{{ party.members.length }}/5 players</div>
        <AsciiButton
          v-if="isLeader"
          label="START CO-OP VS BOTS"
          variant="primary"
          :disabled="busy"
          data-testid="party-start-coop"
          @click="startCoop"
        />
        <AsciiButton label="LEAVE PARTY" variant="ghost" :disabled="busy" @click="leaveParty" />
      </template>

      <p v-if="error" class="text-[0.72rem] text-audit" data-testid="party-error" role="alert">
        [ERR] {{ error }}
      </p>
    </div>
  </TerminalPanel>
</template>
