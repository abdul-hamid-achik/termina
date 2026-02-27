<script setup lang="ts">
import { useAuthStore } from '~/stores/auth'

const authStore = useAuthStore()
</script>

<template>
  <div class="flex min-h-[calc(100vh-120px)] items-center justify-center p-8 max-sm:p-4">
    <div
      class="flex w-full max-w-[400px] flex-col items-center gap-5 border border-border bg-bg-panel p-8"
    >
      <pre class="m-0 text-center text-[0.6rem] leading-tight text-radiant">
╔╦╗╔═╗╦═╗╔╦╗╦╔╗╔╔═╗
 ║ ║╣ ╠╦╝║║║║║║║╠═╣
 ╩ ╚═╝╩╚═╩ ╩╩╝╚╝╩ ╩</pre
      >
      <p class="text-[0.85rem] text-text-dim">&gt;_ authenticate to continue</p>

      <div
        class="flex w-full flex-col items-stretch gap-2 [&_button]:w-full [&_button]:justify-center"
      >
        <AsciiButton
          label="LOGIN WITH GITHUB"
          variant="primary"
          @click="authStore.login('github')"
        />
        <AsciiButton
          label="LOGIN WITH DISCORD"
          variant="primary"
          @click="authStore.login('discord')"
        />
      </div>

      <p class="text-xs text-text-dim">
        <span class="text-text-dim">No account?</span>
        Sign in to create one automatically.
      </p>
    </div>
  </div>
</template>
