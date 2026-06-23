<script setup lang="ts">
import { useAuthStore } from '~/stores/auth'

useHead({ title: 'Reset password · TERMINA' })

const authStore = useAuthStore()
const username = ref('')
const loading = ref(false)
const sent = ref(false)

async function submit() {
  if (!username.value || loading.value) return
  loading.value = true
  try {
    await authStore.forgotPassword(username.value)
  } catch {
    // The endpoint always returns ok (no account enumeration); only a network
    // error lands here — show the same neutral confirmation either way.
  } finally {
    loading.value = false
    sent.value = true
  }
}
</script>

<template>
  <div class="flex min-h-[calc(100vh-120px)] items-center justify-center p-8 max-sm:p-4">
    <div class="w-full max-w-[420px]">
      <p class="mb-4 text-center text-[0.85rem] text-text-dim">&gt;_ recover access</p>
      <TerminalPanel title="password reset">
        <div v-if="sent" class="flex flex-col gap-3 text-xs">
          <p class="leading-relaxed text-text-dim">
            <span class="text-radiant">ok</span> — if an account with that username has an email on
            file, a password reset link is on its way. Check your inbox (and spam).
          </p>
          <NuxtLink to="/login" class="text-ability no-underline hover:underline"
            >&lt; back to login</NuxtLink
          >
        </div>
        <form v-else class="flex flex-col gap-3" @submit.prevent="submit">
          <p class="text-xs leading-relaxed text-text-dim">
            Enter your username and we'll email a reset link to the address on your account.
          </p>
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
            />
          </div>
          <AsciiButton
            :label="loading ? 'SENDING...' : 'SEND RESET LINK'"
            variant="primary"
            :disabled="!username || loading"
            class="mt-1 w-full justify-center"
            @click="submit"
          />
          <NuxtLink
            to="/login"
            class="text-center text-[0.7rem] text-text-dim no-underline hover:text-ability"
            >&lt; back to login</NuxtLink
          >
        </form>
      </TerminalPanel>
    </div>
  </div>
</template>
