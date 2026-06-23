<script setup lang="ts">
import { useAuthStore } from '~/stores/auth'

useHead({ title: 'Set a new password · TERMINA' })

const authStore = useAuthStore()
const route = useRoute()
const token = computed(() => (route.query.token as string) || '')

const password = ref('')
const confirmPassword = ref('')
const loading = ref(false)
const done = ref(false)
const error = ref('')

const passwordLongEnough = computed(() => password.value.length >= 8)
const passwordsMatch = computed(
  () => password.value === confirmPassword.value && confirmPassword.value.length > 0,
)
const canSubmit = computed(
  () => !!token.value && passwordLongEnough.value && passwordsMatch.value && !loading.value,
)

async function submit() {
  if (!canSubmit.value) return
  error.value = ''
  loading.value = true
  try {
    await authStore.resetPassword(token.value, password.value)
    done.value = true
  } catch (err: unknown) {
    const e = err as { data?: { message?: string } }
    error.value = e?.data?.message || 'Could not reset password. The link may have expired.'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="flex min-h-[calc(100vh-120px)] items-center justify-center p-8 max-sm:p-4">
    <div class="w-full max-w-[420px]">
      <p class="mb-4 text-center text-[0.85rem] text-text-dim">&gt;_ set a new password</p>
      <TerminalPanel title="password reset">
        <!-- Missing token -->
        <div v-if="!token" class="flex flex-col gap-3 text-xs">
          <p class="text-dire">This reset link is missing its token. Request a new one.</p>
          <NuxtLink to="/forgot-password" class="text-ability no-underline hover:underline"
            >request a new link &gt;</NuxtLink
          >
        </div>

        <!-- Success -->
        <div v-else-if="done" class="flex flex-col gap-3 text-xs">
          <p class="leading-relaxed text-text-dim">
            <span class="text-radiant">ok</span> — your password has been updated. You can now log
            in with your new password.
          </p>
          <NuxtLink to="/login" class="text-ability no-underline hover:underline"
            >&gt; go to login</NuxtLink
          >
        </div>

        <!-- Form -->
        <form v-else class="flex flex-col gap-3" @submit.prevent="submit">
          <div
            v-if="error"
            role="alert"
            aria-live="assertive"
            class="border border-dire/30 bg-dire/5 px-3 py-2 text-xs text-dire"
          >
            <span class="text-dire/60">[ERR]</span> {{ error }}
          </div>
          <div class="flex flex-col gap-1">
            <label
              for="reset-password"
              class="font-mono text-xs uppercase tracking-wider text-text-dim"
            >
              <span class="text-radiant">$</span> new password
            </label>
            <input
              id="reset-password"
              v-model="password"
              type="password"
              autocomplete="new-password"
              placeholder="••••••••"
              class="terminal-input"
            />
            <div v-if="password" class="text-[0.7rem]">
              <span v-if="!passwordLongEnough" class="text-dire"
                >! {{ password.length }}/8 chars required</span
              >
              <span v-else class="text-radiant">ok</span>
            </div>
          </div>
          <div class="flex flex-col gap-1">
            <label
              for="reset-confirm-password"
              class="font-mono text-xs uppercase tracking-wider text-text-dim"
            >
              <span class="text-radiant">$</span> confirm password
            </label>
            <input
              id="reset-confirm-password"
              v-model="confirmPassword"
              type="password"
              autocomplete="new-password"
              placeholder="••••••••"
              class="terminal-input"
            />
            <div v-if="confirmPassword" class="text-[0.7rem]">
              <span v-if="!passwordsMatch" class="text-dire">! passwords do not match</span>
              <span v-else class="text-radiant">ok</span>
            </div>
          </div>
          <AsciiButton
            :label="loading ? 'UPDATING...' : 'SET NEW PASSWORD'"
            variant="primary"
            :disabled="!canSubmit"
            class="mt-1 w-full justify-center"
            @click="submit"
          />
        </form>
      </TerminalPanel>
    </div>
  </div>
</template>
