<script setup lang="ts">
import { HEROES } from '~~/shared/constants/heroes'
import { useAuthStore } from '~/stores/auth'

definePageMeta({ middleware: 'auth' })

const authStore = useAuthStore()

// ── State ────────────────────────────────────────────────────────
const heroIds = Object.keys(HEROES)

const selectedAvatar = ref(authStore.user?.selectedAvatar ?? '')
const usernameInput = ref(authStore.user?.username ?? '')
const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')

const savingAvatar = ref(false)
const savingUsername = ref(false)
const savingPassword = ref(false)

const avatarMsg = ref<{ type: 'ok' | 'err'; text: string } | null>(null)
const usernameMsg = ref<{ type: 'ok' | 'err'; text: string } | null>(null)
const passwordMsg = ref<{ type: 'ok' | 'err'; text: string } | null>(null)

// ── Providers ────────────────────────────────────────────────────
interface ProviderInfo {
  provider: string
  providerId: string
  providerUsername: string | null
  linkedAt: string
}

const { data: providersData, refresh: refreshProviders } = await useFetch<ProviderInfo[]>(
  '/api/player/providers',
)
const providers = computed(() => providersData.value ?? [])
const disconnecting = ref<string | null>(null)
const providerMsg = ref<{ type: 'ok' | 'err'; text: string } | null>(null)

function isProviderLinked(provider: string) {
  return providers.value.some((p) => p.provider === provider)
}

function getProviderUsername(provider: string) {
  return providers.value.find((p) => p.provider === provider)?.providerUsername ?? null
}

// ── Validation ───────────────────────────────────────────────────
const usernameValid = computed(() => /^\w{3,20}$/.test(usernameInput.value))
const usernameError = computed(() => {
  if (!usernameInput.value) return ''
  if (usernameInput.value.length < 3 || usernameInput.value.length > 20)
    return 'must be 3-20 characters'
  if (!/^\w+$/.test(usernameInput.value)) return 'letters, numbers, and underscores only'
  return ''
})

const passwordLongEnough = computed(() => newPassword.value.length >= 8)
const passwordError = computed(() => {
  if (!newPassword.value) return ''
  if (!passwordLongEnough.value) return `${newPassword.value.length}/8 chars required`
  return ''
})

const passwordsMatch = computed(
  () => newPassword.value === confirmPassword.value && confirmPassword.value.length > 0,
)
const confirmError = computed(() => {
  if (!confirmPassword.value) return ''
  if (newPassword.value !== confirmPassword.value) return 'passwords do not match'
  return ''
})

const hasPassword = computed(() => authStore.user?.hasPassword ?? false)

const canSavePassword = computed(() => {
  if (!passwordLongEnough.value || !passwordsMatch.value) return false
  if (hasPassword.value && !currentPassword.value) return false
  return true
})

// ── Actions ──────────────────────────────────────────────────────
async function saveAvatar() {
  if (savingAvatar.value) return
  savingAvatar.value = true
  avatarMsg.value = null
  try {
    await $fetch('/api/player/settings', {
      method: 'PUT',
      body: { selectedAvatar: selectedAvatar.value || null },
    })
    await authStore.fetchUser()
    avatarMsg.value = { type: 'ok', text: 'Avatar updated' }
  } catch (err: unknown) {
    const fetchErr = err as { data?: { message?: string } }
    avatarMsg.value = { type: 'err', text: fetchErr?.data?.message || 'Failed to save avatar' }
  } finally {
    savingAvatar.value = false
  }
}

async function saveUsername() {
  if (savingUsername.value || !usernameValid.value) return
  savingUsername.value = true
  usernameMsg.value = null
  try {
    await $fetch('/api/player/settings', {
      method: 'PUT',
      body: { username: usernameInput.value },
    })
    await authStore.fetchUser()
    usernameMsg.value = { type: 'ok', text: 'Username updated' }
  } catch (err: unknown) {
    const fetchErr = err as { data?: { message?: string } }
    usernameMsg.value = { type: 'err', text: fetchErr?.data?.message || 'Failed to update username' }
  } finally {
    savingUsername.value = false
  }
}

async function savePassword() {
  if (savingPassword.value || !canSavePassword.value) return
  savingPassword.value = true
  passwordMsg.value = null
  try {
    await $fetch('/api/player/password', {
      method: 'PUT',
      body: {
        currentPassword: hasPassword.value ? currentPassword.value : undefined,
        newPassword: newPassword.value,
      },
    })
    await authStore.fetchUser()
    currentPassword.value = ''
    newPassword.value = ''
    confirmPassword.value = ''
    passwordMsg.value = { type: 'ok', text: hasPassword.value ? 'Password changed' : 'Password set' }
  } catch (err: unknown) {
    const fetchErr = err as { data?: { message?: string } }
    passwordMsg.value = { type: 'err', text: fetchErr?.data?.message || 'Failed to update password' }
  } finally {
    savingPassword.value = false
  }
}

function connectProvider(provider: string) {
  navigateTo(`/api/auth/${provider}`, { external: true })
}

async function disconnectProvider(provider: string) {
  disconnecting.value = provider
  providerMsg.value = null
  try {
    await $fetch(`/api/player/providers/${provider}`, { method: 'DELETE' })
    await refreshProviders()
    providerMsg.value = { type: 'ok', text: `${provider} disconnected` }
  } catch (err: unknown) {
    const fetchErr = err as { data?: { message?: string } }
    providerMsg.value = { type: 'err', text: fetchErr?.data?.message || 'Failed to disconnect' }
  } finally {
    disconnecting.value = null
  }
}
</script>

<template>
  <div class="mx-auto mt-6 flex max-w-[600px] flex-col gap-4">
    <div class="mb-2 flex items-center justify-between">
      <span class="text-[0.8rem] text-text-dim">&gt;_ /profile/settings</span>
      <NuxtLink to="/profile/me" class="text-[0.8rem] text-ability no-underline hover:text-radiant">
        &lt; back to profile
      </NuxtLink>
    </div>

    <!-- ═══ AVATAR ═══ -->
    <TerminalPanel title="Avatar">
      <div class="flex flex-col gap-3">
        <!-- Preview -->
        <div class="flex items-center gap-3">
          <div class="flex flex-col items-center gap-1">
            <span class="text-[0.7rem] uppercase tracking-wider text-text-dim">current</span>
            <ClientOnly>
              <HeroAvatar
                v-if="selectedAvatar"
                :hero-id="selectedAvatar"
                :size="96"
                class="border-2 border-ability shadow-[0_0_12px_rgba(0,212,255,0.3)]"
              />
              <div
                v-else
                class="flex items-center justify-center border border-border bg-bg-secondary text-text-dim"
                :style="{ width: '96px', height: '96px' }"
              >
                <span class="text-[0.7rem]">none</span>
              </div>
            </ClientOnly>
            <span v-if="selectedAvatar" class="text-xs font-bold uppercase text-ability">
              {{ HEROES[selectedAvatar]?.name }}
            </span>
          </div>
        </div>

        <!-- Grid -->
        <div class="grid grid-cols-5 gap-2">
          <ClientOnly>
            <button
              v-for="hid in heroIds"
              :key="hid"
              class="flex cursor-pointer flex-col items-center gap-1 border bg-transparent p-1.5 transition-all duration-100"
              :class="
                selectedAvatar === hid
                  ? 'border-ability bg-ability/5 shadow-[0_0_8px_rgba(0,212,255,0.2)]'
                  : 'border-border hover:border-border-glow hover:bg-border-glow/10'
              "
              @click="selectedAvatar = hid"
            >
              <HeroAvatar :hero-id="hid" :size="48" />
              <span
                class="text-[0.6rem] uppercase"
                :class="selectedAvatar === hid ? 'text-ability' : 'text-text-dim'"
              >
                {{ HEROES[hid]?.name }}
              </span>
            </button>
          </ClientOnly>
        </div>

        <!-- Feedback + Save -->
        <div class="flex items-center gap-2">
          <AsciiButton
            :label="savingAvatar ? 'SAVING...' : 'SAVE AVATAR'"
            variant="primary"
            :disabled="savingAvatar"
            @click="saveAvatar"
          />
          <span
            v-if="avatarMsg"
            class="text-[0.75rem]"
            :class="avatarMsg.type === 'ok' ? 'text-radiant' : 'text-dire'"
          >
            {{ avatarMsg.text }}
          </span>
        </div>
      </div>
    </TerminalPanel>

    <!-- ═══ ACCOUNT ═══ -->
    <TerminalPanel title="Account">
      <form class="flex flex-col gap-3" @submit.prevent="saveUsername">
        <div class="flex flex-col gap-1">
          <label class="font-mono text-xs uppercase tracking-wider text-text-dim">
            <span class="text-radiant">$</span> username
          </label>
          <input
            v-model="usernameInput"
            type="text"
            autocomplete="username"
            spellcheck="false"
            placeholder="enter_username"
            class="terminal-input"
          >
          <div v-if="usernameInput && usernameError" class="text-[0.7rem]">
            <span class="text-dire">! {{ usernameError }}</span>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <AsciiButton
            :label="savingUsername ? 'SAVING...' : 'SAVE USERNAME'"
            variant="primary"
            :disabled="!usernameValid || savingUsername || usernameInput === authStore.user?.username"
            @click="saveUsername"
          />
          <span
            v-if="usernameMsg"
            class="text-[0.75rem]"
            :class="usernameMsg.type === 'ok' ? 'text-radiant' : 'text-dire'"
          >
            {{ usernameMsg.text }}
          </span>
        </div>
      </form>
    </TerminalPanel>

    <!-- ═══ PASSWORD ═══ -->
    <TerminalPanel title="Password">
      <form class="flex flex-col gap-3" @submit.prevent="savePassword">
        <p v-if="!hasPassword" class="text-[0.8rem] text-text-dim">
          Set a password to enable credential login.
        </p>

        <!-- Current password (only if user already has one) -->
        <div v-if="hasPassword" class="flex flex-col gap-1">
          <label class="font-mono text-xs uppercase tracking-wider text-text-dim">
            <span class="text-radiant">$</span> current password
          </label>
          <input
            v-model="currentPassword"
            type="password"
            autocomplete="current-password"
            placeholder="••••••••"
            class="terminal-input"
          >
        </div>

        <!-- New password -->
        <div class="flex flex-col gap-1">
          <label class="font-mono text-xs uppercase tracking-wider text-text-dim">
            <span class="text-radiant">$</span> new password
          </label>
          <input
            v-model="newPassword"
            type="password"
            autocomplete="new-password"
            placeholder="••••••••"
            class="terminal-input"
          >
          <div v-if="newPassword && passwordError" class="text-[0.7rem]">
            <span class="text-dire">! {{ passwordError }}</span>
          </div>
        </div>

        <!-- Confirm password -->
        <div class="flex flex-col gap-1">
          <label class="font-mono text-xs uppercase tracking-wider text-text-dim">
            <span class="text-radiant">$</span> confirm password
          </label>
          <input
            v-model="confirmPassword"
            type="password"
            autocomplete="new-password"
            placeholder="••••••••"
            class="terminal-input"
          >
          <div v-if="confirmPassword && confirmError" class="text-[0.7rem]">
            <span class="text-dire">! {{ confirmError }}</span>
          </div>
        </div>

        <div class="flex items-center gap-2">
          <AsciiButton
            :label="savingPassword ? 'SAVING...' : hasPassword ? 'CHANGE PASSWORD' : 'SET PASSWORD'"
            variant="primary"
            :disabled="!canSavePassword || savingPassword"
            @click="savePassword"
          />
          <span
            v-if="passwordMsg"
            class="text-[0.75rem]"
            :class="passwordMsg.type === 'ok' ? 'text-radiant' : 'text-dire'"
          >
            {{ passwordMsg.text }}
          </span>
        </div>
      </form>
    </TerminalPanel>

    <!-- ═══ CONNECTED ACCOUNTS ═══ -->
    <TerminalPanel title="Connected Accounts">
      <div class="flex flex-col gap-3">
        <div
          v-if="providerMsg"
          class="border px-3 py-2 text-xs"
          :class="
            providerMsg.type === 'ok'
              ? 'border-radiant/30 bg-radiant/5 text-radiant'
              : 'border-dire/30 bg-dire/5 text-dire'
          "
        >
          {{ providerMsg.text }}
        </div>

        <!-- GitHub -->
        <div class="flex items-center justify-between border border-border p-2.5">
          <div class="flex flex-col gap-0.5">
            <span class="text-[0.85rem] font-bold uppercase text-text-primary">GitHub</span>
            <span v-if="isProviderLinked('github')" class="text-[0.75rem] text-radiant">
              connected as {{ getProviderUsername('github') }}
            </span>
            <span v-else class="text-[0.75rem] text-text-dim">not connected</span>
          </div>
          <AsciiButton
            v-if="isProviderLinked('github')"
            label="DISCONNECT"
            variant="danger"
            :disabled="disconnecting === 'github'"
            @click="disconnectProvider('github')"
          />
          <AsciiButton
            v-else
            label="CONNECT"
            variant="primary"
            @click="connectProvider('github')"
          />
        </div>

        <!-- Discord -->
        <div class="flex items-center justify-between border border-border p-2.5">
          <div class="flex flex-col gap-0.5">
            <span class="text-[0.85rem] font-bold uppercase text-text-primary">Discord</span>
            <span v-if="isProviderLinked('discord')" class="text-[0.75rem] text-radiant">
              connected as {{ getProviderUsername('discord') }}
            </span>
            <span v-else class="text-[0.75rem] text-text-dim">not connected</span>
          </div>
          <AsciiButton
            v-if="isProviderLinked('discord')"
            label="DISCONNECT"
            variant="danger"
            :disabled="disconnecting === 'discord'"
            @click="disconnectProvider('discord')"
          />
          <AsciiButton
            v-else
            label="CONNECT"
            variant="primary"
            @click="connectProvider('discord')"
          />
        </div>
      </div>
    </TerminalPanel>
  </div>
</template>

<style scoped>
.terminal-input {
  width: 100%;
  padding: 6px 10px;
  font-family: var(--font-mono);
  font-size: 0.85rem;
  color: rgb(var(--text-primary));
  background: rgb(var(--bg-primary));
  border: 1px solid rgb(var(--border-color));
  outline: none;
  transition:
    border-color 0.15s,
    box-shadow 0.15s;
}

.terminal-input::placeholder {
  color: rgb(var(--text-dim) / 0.4);
}

.terminal-input:focus {
  border-color: rgb(var(--border-glow));
  box-shadow:
    0 0 4px rgb(var(--border-glow)),
    inset 0 0 4px rgb(var(--border-glow) / 0.3);
}
</style>
