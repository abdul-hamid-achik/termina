<script setup lang="ts">
import { useAuthStore } from '~/stores/auth'

useHead({ title: 'Verify email · TERMINA' })

const authStore = useAuthStore()
const route = useRoute()

const state = ref<'verifying' | 'success' | 'error'>('verifying')
const message = ref('')

onMounted(async () => {
  const token = (route.query.token as string) || ''
  if (!token) {
    state.value = 'error'
    message.value = 'This verification link is missing its token.'
    return
  }
  try {
    await authStore.verifyEmail(token)
    state.value = 'success'
  } catch (err: unknown) {
    const e = err as { data?: { message?: string } }
    state.value = 'error'
    message.value = e?.data?.message || 'This verification link is invalid or has expired.'
  }
})
</script>

<template>
  <div class="flex min-h-[calc(100vh-120px)] items-center justify-center p-8 max-sm:p-4">
    <div class="w-full max-w-[420px]">
      <p class="mb-4 text-center text-[0.85rem] text-text-dim">&gt;_ email verification</p>
      <TerminalPanel title="verify email">
        <div class="flex flex-col gap-3 text-xs">
          <p v-if="state === 'verifying'" class="text-text-dim">
            <span class="text-ability">…</span> verifying your email
          </p>

          <template v-else-if="state === 'success'">
            <p class="leading-relaxed text-text-dim">
              <span class="text-radiant">ok</span> — your email is verified. Your account is all
              set.
            </p>
            <NuxtLink to="/lobby" class="text-ability no-underline hover:underline"
              >&gt; play now</NuxtLink
            >
          </template>

          <template v-else>
            <p class="leading-relaxed text-dire">
              <span class="text-dire/60">[ERR]</span> {{ message }}
            </p>
            <p class="text-text-dim">
              You can request a fresh link from your
              <NuxtLink to="/profile/settings" class="text-ability no-underline hover:underline"
                >settings</NuxtLink
              >.
            </p>
          </template>
        </div>
      </TerminalPanel>
    </div>
  </div>
</template>
