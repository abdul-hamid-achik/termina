<script setup lang="ts">
import { useAuthStore } from '~/stores/auth'

const authStore = useAuthStore()
const route = useRoute()

const mode = ref<'login' | 'register'>('login')
const username = ref('')
const password = ref('')
const confirmPassword = ref('')
const error = ref('')
const loading = ref(false)

// Validation
const usernameValid = computed(() => /^\w{3,20}$/.test(username.value))
const usernameError = computed(() => {
  if (!username.value) return ''
  if (username.value.length < 3 || username.value.length > 20)
    return 'must be 3-20 characters'
  if (!/^\w+$/.test(username.value)) return 'letters, numbers, and underscores only'
  return ''
})

const passwordLongEnough = computed(() => password.value.length >= 8)
const passwordError = computed(() => {
  if (!password.value) return ''
  if (!passwordLongEnough.value) return `${password.value.length}/8 chars required`
  return ''
})

const passwordsMatch = computed(
  () => password.value === confirmPassword.value && confirmPassword.value.length > 0,
)
const confirmError = computed(() => {
  if (!confirmPassword.value) return ''
  if (password.value !== confirmPassword.value) return 'passwords do not match'
  return ''
})

const canSubmit = computed(() => {
  if (!username.value || !password.value) return false
  if (mode.value === 'register') {
    return usernameValid.value && passwordLongEnough.value && passwordsMatch.value
  }
  return true
})

async function handleSubmit() {
  if (!canSubmit.value || loading.value) return
  error.value = ''
  loading.value = true

  try {
    if (mode.value === 'login') {
      await authStore.loginWithCredentials(username.value, password.value)
    } else {
      await authStore.register(username.value, password.value)
    }
    const redirect = (route.query.redirect as string) || '/'
    navigateTo(redirect)
  } catch (err: unknown) {
    const fetchErr = err as { data?: { message?: string } }
    error.value = fetchErr?.data?.message || 'Something went wrong'
  } finally {
    loading.value = false
  }
}

function switchMode(newMode: 'login' | 'register') {
  mode.value = newMode
  error.value = ''
}

// Check URL for OAuth errors
if (route.query.error) {
  const raw = String(route.query.error).replace(/<[^>]*>/g, '').slice(0, 100)
  error.value = `OAuth login failed (${raw})`
}
</script>

<template>
  <div class="flex min-h-[calc(100vh-120px)] items-center justify-center p-8 max-sm:p-4">
    <div class="w-full max-w-[420px]">
      <!-- ASCII Art Header -->
      <pre
        class="m-0 mb-4 text-center text-[0.6rem] leading-tight text-radiant select-none"
      >
╔╦╗╔═╗╦═╗╔╦╗╦╔╗╔╔═╗
 ║ ║╣ ╠╦╝║║║║║║║╠═╣
 ╩ ╚═╝╩╚═╩ ╩╩╝╚╝╩ ╩</pre
      >
      <p class="mb-4 text-center text-[0.85rem] text-text-dim">
        &gt;_ authenticate to continue
      </p>

      <TerminalPanel :title="mode === 'login' ? 'authentication' : 'registration'">
        <!-- Tab Switcher -->
        <div class="-mx-2 -mt-2 mb-4 flex border-b border-border">
          <button
            class="flex-1 py-2 text-center font-mono text-xs uppercase tracking-widest transition-colors"
            :class="
              mode === 'login'
                ? 'border-b border-radiant bg-radiant/5 text-radiant'
                : 'text-text-dim hover:text-text-primary'
            "
            @click="switchMode('login')"
          >
            &gt; login
          </button>
          <button
            class="flex-1 border-l border-border py-2 text-center font-mono text-xs uppercase tracking-widest transition-colors"
            :class="
              mode === 'register'
                ? 'border-b border-radiant bg-radiant/5 text-radiant'
                : 'text-text-dim hover:text-text-primary'
            "
            @click="switchMode('register')"
          >
            &gt; register
          </button>
        </div>

        <!-- Error Display -->
        <div
          v-if="error"
          class="mb-3 border border-dire/30 bg-dire/5 px-3 py-2 text-xs text-dire"
        >
          <span class="text-dire/60">[ERR]</span> {{ error }}
        </div>

        <!-- Credentials Form -->
        <form class="flex flex-col gap-3" @submit.prevent="handleSubmit">
          <!-- Username -->
          <div class="flex flex-col gap-1">
            <label class="font-mono text-xs uppercase tracking-wider text-text-dim">
              <span class="text-radiant">$</span> username
            </label>
            <input
              v-model="username"
              type="text"
              autocomplete="username"
              spellcheck="false"
              placeholder="enter_username"
              class="terminal-input"
            >
            <div v-if="mode === 'register' && username" class="text-[0.7rem]">
              <span v-if="usernameError" class="text-dire">! {{ usernameError }}</span>
              <span v-else-if="usernameValid" class="text-radiant">ok</span>
            </div>
          </div>

          <!-- Password -->
          <div class="flex flex-col gap-1">
            <label class="font-mono text-xs uppercase tracking-wider text-text-dim">
              <span class="text-radiant">$</span> password
            </label>
            <input
              v-model="password"
              type="password"
              :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
              placeholder="••••••••"
              class="terminal-input"
            >
            <div v-if="mode === 'register' && password" class="text-[0.7rem]">
              <span v-if="passwordError" class="text-dire">! {{ passwordError }}</span>
              <span v-else class="text-radiant">ok</span>
            </div>
          </div>

          <!-- Confirm Password (register only) -->
          <div v-if="mode === 'register'" class="flex flex-col gap-1">
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
            <div v-if="confirmPassword" class="text-[0.7rem]">
              <span v-if="confirmError" class="text-dire">! {{ confirmError }}</span>
              <span v-else-if="passwordsMatch" class="text-radiant">ok</span>
            </div>
          </div>

          <!-- Submit Button -->
          <AsciiButton
            :label="
              loading ? 'PROCESSING...' : mode === 'login' ? 'LOGIN' : 'REGISTER'
            "
            variant="primary"
            :disabled="!canSubmit || loading"
            class="mt-1 w-full justify-center"
            @click="handleSubmit"
          />
        </form>

        <!-- Divider -->
        <div class="my-4 flex items-center gap-3">
          <span class="h-px flex-1 bg-border" />
          <span class="text-xs tracking-wider text-text-dim">── OR ──</span>
          <span class="h-px flex-1 bg-border" />
        </div>

        <!-- OAuth Buttons -->
        <div
          class="flex flex-col gap-2 [&_button]:w-full [&_button]:justify-center"
        >
          <AsciiButton
            label="CONTINUE WITH GITHUB"
            @click="authStore.loginOAuth('github')"
          />
          <AsciiButton
            label="CONTINUE WITH DISCORD"
            @click="authStore.loginOAuth('discord')"
          />
        </div>
      </TerminalPanel>
    </div>
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
