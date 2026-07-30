<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'

interface Guild {
  id: string
  name: string
  tag: string
  leaderId: string
}
interface GuildMember {
  id: string
  username: string
  avatarUrl: string | null
  seasonMmr: number
  isLeader: boolean
}

const props = defineProps<{ myPlayerId: string | null }>()

const guild = ref<Guild | null>(null)
const members = ref<GuildMember[]>([])
const guildList = ref<Guild[]>([])

const newName = ref('')
const newTag = ref('')
const joinName = ref('')
const busy = ref(false)
const error = ref<string | null>(null)

const isLeader = computed(() => !!props.myPlayerId && guild.value?.leaderId === props.myPlayerId)

async function refreshMyGuild() {
  try {
    const res = await $fetch<{ guild: Guild | null; members: GuildMember[] }>('/api/guild/my')
    guild.value = res.guild
    members.value = res.members
  } catch {
    guild.value = null
    members.value = []
  }
}

async function refreshGuildList() {
  try {
    const res = await $fetch<{ guilds: Guild[] }>('/api/guild/list')
    guildList.value = res.guilds
  } catch {
    guildList.value = []
  }
}

async function createGuild() {
  busy.value = true
  error.value = null
  try {
    const res = await $fetch<{ guild: Guild }>('/api/guild/create', {
      method: 'POST',
      body: { name: newName.value.trim(), tag: newTag.value.trim() },
    })
    guild.value = res.guild
    newName.value = ''
    newTag.value = ''
    await refreshMyGuild()
  } catch (e) {
    error.value = (e as { data?: { message?: string } })?.data?.message ?? 'Could not create guild'
  } finally {
    busy.value = false
  }
}

async function joinGuild(name: string) {
  if (!name.trim()) return
  busy.value = true
  error.value = null
  try {
    const res = await $fetch<{ guild: Guild }>('/api/guild/join', {
      method: 'POST',
      body: { name: name.trim() },
    })
    guild.value = res.guild
    joinName.value = ''
    await refreshMyGuild()
  } catch (e) {
    error.value = (e as { data?: { message?: string } })?.data?.message ?? 'Could not join guild'
  } finally {
    busy.value = false
  }
}

async function leaveGuild() {
  busy.value = true
  error.value = null
  try {
    await $fetch('/api/guild/leave', { method: 'POST' })
    guild.value = null
    members.value = []
    await refreshGuildList()
  } catch (e) {
    error.value = (e as { data?: { message?: string } })?.data?.message ?? 'Could not leave guild'
  } finally {
    busy.value = false
  }
}

onMounted(async () => {
  await Promise.all([refreshMyGuild(), refreshGuildList()])
})
</script>

<template>
  <TerminalPanel title="Guild" title-as="h2">
    <div class="flex flex-col gap-3 p-4">
      <!-- In a guild: banner + roster + leave -->
      <template v-if="guild">
        <div class="flex items-center gap-2 border border-ability/40 bg-ability/10 px-3 py-2">
          <span
            class="border border-ability px-1.5 py-0.5 font-mono text-xs font-bold text-ability"
            data-testid="guild-tag"
            >{{ guild.tag }}</span
          >
          <span class="font-bold text-text-primary" data-testid="guild-name">{{ guild.name }}</span>
          <span v-if="isLeader" class="ml-auto text-[0.6rem] uppercase text-gold">leader</span>
        </div>
        <div class="flex flex-col gap-1" data-testid="guild-members">
          <div
            v-for="m in members"
            :key="m.id"
            class="flex items-center justify-between border-b border-border/40 py-1 text-[0.8rem] last:border-0"
          >
            <span
              class="font-mono"
              :class="m.id === myPlayerId ? 'text-chaff' : 'text-text-primary'"
            >
              {{ m.username
              }}<span v-if="m.id === myPlayerId" class="ml-1 text-text-dim">(you)</span>
            </span>
            <span class="text-[0.68rem] text-gold">{{ m.seasonMmr }}</span>
          </div>
        </div>
        <div class="text-[0.68rem] text-text-muted">{{ members.length }} members</div>
        <AsciiButton label="LEAVE GUILD" variant="ghost" :disabled="busy" @click="leaveGuild" />
      </template>

      <!-- Not in a guild: create or join -->
      <template v-else>
        <p class="text-[0.78rem] leading-relaxed text-text-dim">
          Found a guild or join one — your guild tag rides along next to your name on the
          leaderboard.
        </p>
        <div class="flex flex-col gap-2">
          <input
            v-model="newName"
            type="text"
            maxlength="24"
            placeholder="GUILD NAME"
            data-testid="guild-new-name"
            class="border border-border bg-bg-panel px-2 py-1.5 text-sm text-text-primary placeholder:text-text-muted focus:border-ability focus:outline-none"
          />
          <div class="flex items-center gap-2">
            <input
              v-model="newTag"
              type="text"
              maxlength="5"
              placeholder="TAG"
              data-testid="guild-new-tag"
              class="min-w-0 w-24 border border-border bg-bg-panel px-2 py-1.5 font-mono text-sm uppercase tracking-widest text-text-primary placeholder:text-text-muted focus:border-ability focus:outline-none"
            />
            <AsciiButton
              label="CREATE"
              variant="primary"
              :disabled="busy || !newName.trim() || !newTag.trim()"
              @click="createGuild"
            />
          </div>
        </div>

        <div v-if="guildList.length" class="flex flex-col gap-1 border-t border-border pt-2">
          <div class="text-[0.66rem] uppercase tracking-wider text-text-dim">Join a guild</div>
          <button
            v-for="g in guildList"
            :key="g.id"
            class="flex items-center gap-2 border-b border-border/40 py-1 text-left text-[0.8rem] last:border-0 hover:text-ability"
            data-testid="guild-list-item"
            @click="joinGuild(g.name)"
          >
            <span class="border border-border px-1 font-mono text-[0.66rem] text-ability">{{
              g.tag
            }}</span>
            <span class="text-text-primary">{{ g.name }}</span>
          </button>
        </div>
      </template>

      <p v-if="error" class="text-[0.72rem] text-audit" data-testid="guild-error" role="alert">
        [ERR] {{ error }}
      </p>
    </div>
  </TerminalPanel>
</template>
