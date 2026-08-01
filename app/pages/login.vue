<script setup lang="ts">
import { useAuthStore } from '~/stores/auth'
import { useStartTutorial } from '~/composables/useStartTutorial'

const authStore = useAuthStore()
const route = useRoute()
const { start: startPractice, error: practiceError } = useStartTutorial()

/**
 * Why the visitor is here. The landing page's primary CTA ("PRACTICE VS BOTS")
 * bounces anonymous visitors to this page with `?next=practice`, and the page
 * greeted them with a bare "authenticate to continue" — no mention of the thing
 * they had just clicked, and no sign it would still happen. The launcher does
 * resume (see `resumeAfterAuth`); the page just never said so.
 *
 * The tab default deliberately stays LOGIN. Defaulting to REGISTER on this
 * intent helps a first-time visitor by one click and costs a returning player
 * whose session expired the same click, and both tabs are visible either way.
 */
const intentLine = computed(() =>
  route.query.next === 'practice'
    ? '>_ sign in and your practice match starts immediately'
    : '>_ authenticate to continue',
)

const mode = ref<'login' | 'register'>('login')
const username = ref('')
const email = ref('')
const password = ref('')
const confirmPassword = ref('')
const error = ref('')
const loading = ref(false)

// Email is optional, but enables password recovery. Validate only if provided.
const emailValid = computed(() => !email.value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value))
const emailError = computed(() => (email.value && !emailValid.value ? 'enter a valid email' : ''))

// Validation
const usernameValid = computed(() => /^\w{3,20}$/.test(username.value))
const usernameError = computed(() => {
  if (!username.value) return ''
  if (username.value.length < 3 || username.value.length > 20) return 'must be 3-20 characters'
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
    return (
      usernameValid.value && emailValid.value && passwordLongEnough.value && passwordsMatch.value
    )
  }
  return true
})

/**
 * Where to land after a successful auth. `?redirect=` arrives from the auth
 * middleware and is therefore attacker-controllable via a crafted link, so only
 * same-origin paths are honoured: `//evil.com` passes a bare `startsWith('/')`
 * test and the browser resolves it as a protocol-relative absolute URL — an
 * open redirect straight off a page that has just handled credentials.
 */
function safeRedirect(raw: unknown): string {
  const value = typeof raw === 'string' ? raw : ''
  // Must start with exactly one slash, and the SECOND character must not be a
  // slash or a backslash: browsers treat `/\evil.com` as protocol-relative too,
  // so a `//` test alone is not enough. Leading whitespace and control
  // characters are stripped by the URL parser before that check happens, which
  // is how `/%09/evil.com` and a literal tab slip past a naive guard — reject
  // anything containing one rather than trying to normalise it.
  if (!value.startsWith('/')) return '/'
  if (value.length > 1 && (value[1] === '/' || value[1] === '\\')) return '/'
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\s]/.test(value)) return '/'
  return value
}

/**
 * Resume whatever the player was trying to do. `next=practice` comes from the
 * "practice vs bots" launcher's 401 branch — the intent was to play, not to
 * read the home page, so re-fire the launcher rather than making them find the
 * button again.
 */
async function resumeAfterAuth() {
  if (route.query.next === 'practice') {
    await startPractice()
    if (practiceError.value) error.value = practiceError.value
    return
  }
  await navigateTo(safeRedirect(route.query.redirect))
}

async function handleSubmit() {
  if (!canSubmit.value || loading.value) return
  error.value = ''
  loading.value = true

  try {
    if (mode.value === 'login') {
      await authStore.loginWithCredentials(username.value, password.value)
    } else {
      await authStore.register(username.value, password.value, email.value || undefined)
    }
    await resumeAfterAuth()
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
  const raw = String(route.query.error)
    .replace(/<[^>]*>/g, '')
    .slice(0, 100)
  error.value = `OAuth login failed (${raw})`
}
</script>

<template>
  <div class="flex min-h-[calc(100vh-120px)] items-center justify-center p-8 max-sm:p-4">
    <div class="w-full max-w-[420px]">
      <!-- ASCII Art Header -->
      <pre
        aria-hidden="true"
        class="m-0 mb-4 text-center text-[0.6rem] leading-tight text-chaff select-none"
      >
╔╦╗╔═╗╦═╗╔╦╗╦╔╗╔╔═╗
 ║ ║╣ ╠╦╝║║║║║║║╠═╣
 ╩ ╚═╝╩╚═╩ ╩╩╝╚╝╩ ╩</pre
      >
      <p class="mb-4 text-center text-[0.85rem] text-text-dim" data-testid="login-intent">
        {{ intentLine }}
      </p>

      <TerminalPanel :title="mode === 'login' ? 'authentication' : 'registration'" title-as="h1">
        <!-- Tab Switcher -->
        <div class="-mx-2 -mt-2 mb-4 flex border-b border-border">
          <button
            class="flex-1 py-2 text-center font-mono text-xs uppercase tracking-widest transition-colors"
            :class="
              mode === 'login'
                ? 'border-b border-chaff bg-chaff/5 text-chaff'
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
                ? 'border-b border-chaff bg-chaff/5 text-chaff'
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
          role="alert"
          aria-live="assertive"
          class="mb-3 border border-audit/30 bg-audit/5 px-3 py-2 text-xs text-audit"
        >
          <span class="text-audit/60">[ERR]</span> {{ error }}
        </div>

        <!-- Credentials Form -->
        <form class="flex flex-col gap-3" @submit.prevent="handleSubmit">
          <!-- Username -->
          <div class="flex flex-col gap-1">
            <label
              for="login-username"
              class="font-mono text-xs uppercase tracking-wider text-text-dim"
            >
              <span class="text-chaff">$</span> username
            </label>
            <input
              id="login-username"
              v-model="username"
              type="text"
              autocomplete="username"
              spellcheck="false"
              placeholder="enter_username"
              class="terminal-input"
            />
            <div v-if="mode === 'register' && username" class="text-[0.7rem]">
              <span v-if="usernameError" class="text-audit">! {{ usernameError }}</span>
              <span v-else-if="usernameValid" class="text-chaff">ok</span>
            </div>
          </div>

          <!-- Email (register only, optional — enables password recovery) -->
          <div v-if="mode === 'register'" class="flex flex-col gap-1">
            <label
              for="login-email"
              class="font-mono text-xs uppercase tracking-wider text-text-dim"
            >
              <span class="text-chaff">$</span> email
              <span class="text-text-dim/60">(optional)</span>
            </label>
            <input
              id="login-email"
              v-model="email"
              type="email"
              autocomplete="email"
              spellcheck="false"
              placeholder="you@example.com — for password recovery"
              class="terminal-input"
            />
            <div v-if="email" class="text-[0.7rem]">
              <span v-if="emailError" class="text-audit">! {{ emailError }}</span>
              <span v-else class="text-chaff">ok</span>
            </div>
          </div>

          <!-- Password -->
          <div class="flex flex-col gap-1">
            <label
              for="login-password"
              class="font-mono text-xs uppercase tracking-wider text-text-dim"
            >
              <span class="text-chaff">$</span> password
            </label>
            <input
              id="login-password"
              v-model="password"
              type="password"
              :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
              placeholder="••••••••"
              class="terminal-input"
            />
            <div v-if="mode === 'register' && password" class="text-[0.7rem]">
              <span v-if="passwordError" class="text-audit">! {{ passwordError }}</span>
              <span v-else class="text-chaff">ok</span>
            </div>
          </div>

          <!-- Forgot password (login only) -->
          <NuxtLink
            v-if="mode === 'login'"
            to="/forgot-password"
            class="-mt-1 self-end text-[0.7rem] text-text-dim no-underline transition-colors hover:text-ability"
          >
            forgot password?
          </NuxtLink>

          <!-- Confirm Password (register only) -->
          <div v-if="mode === 'register'" class="flex flex-col gap-1">
            <label
              for="login-confirm-password"
              class="font-mono text-xs uppercase tracking-wider text-text-dim"
            >
              <span class="text-chaff">$</span> confirm password
            </label>
            <input
              id="login-confirm-password"
              v-model="confirmPassword"
              type="password"
              autocomplete="new-password"
              placeholder="••••••••"
              class="terminal-input"
            />
            <div v-if="confirmPassword" class="text-[0.7rem]">
              <span v-if="confirmError" class="text-audit">! {{ confirmError }}</span>
              <span v-else-if="passwordsMatch" class="text-chaff">ok</span>
            </div>
          </div>

          <!-- Submit Button -->
          <AsciiButton
            :label="loading ? 'PROCESSING...' : mode === 'login' ? 'LOGIN' : 'REGISTER'"
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
        <div class="flex flex-col gap-2 [&_button]:w-full [&_button]:justify-center">
          <AsciiButton label="CONTINUE WITH GITHUB" @click="authStore.loginOAuth('github')" />
          <AsciiButton label="CONTINUE WITH DISCORD" @click="authStore.loginOAuth('discord')" />
        </div>
      </TerminalPanel>
    </div>
  </div>
</template>
