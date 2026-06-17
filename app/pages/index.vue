<script setup lang="ts">
import { ref } from 'vue'
import { HERO_IDS } from '~~/shared/constants/heroes'

// Live hero count from the registry so the landing page can't drift.
const heroCount = HERO_IDS.length

// Practice: spin up a guided one-lane tutorial vs bots and jump straight in,
// bypassing matchmaking. Not signed in → the server 401s and we send to login.
const startingTutorial = ref(false)
async function startTutorial() {
  if (startingTutorial.value) return
  startingTutorial.value = true
  try {
    const res = await $fetch<{ url: string }>('/api/game/tutorial', { method: 'POST', body: {} })
    await navigateTo(res.url)
  } catch (err: unknown) {
    const status = (err as { statusCode?: number })?.statusCode
    // 401 = not signed in; anything else (already in a game, server warming up)
    // still routes to the lobby, which surfaces the right next step.
    await navigateTo(status === 401 ? '/login' : '/lobby')
  } finally {
    startingTutorial.value = false
  }
}
</script>

<template>
  <div
    class="flex min-h-[calc(100vh-120px)] flex-col items-center justify-center gap-8 p-8 text-center max-sm:p-4"
  >
    <div class="flex flex-col items-center gap-3">
      <pre class="m-0 text-[0.5rem] leading-[1.15] text-radiant text-glow md:text-[0.7rem]">
████████╗███████╗██████╗ ███╗   ███╗██╗███╗   ██╗ █████╗
╚══██╔══╝██╔════╝██╔══██╗████╗ ████║██║████╗  ██║██╔══██╗
   ██║   █████╗  ██████╔╝██╔████╔██║██║██╔██╗ ██║███████║
   ██║   ██╔══╝  ██╔══██╗██║╚██╔╝██║██║██║╚██╗██║██╔══██║
   ██║   ███████╗██║  ██║██║ ╚═╝ ██║██║██║ ╚████║██║  ██║
   ╚═╝   ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝</pre
      >

      <p class="text-base tracking-wide text-text-dim">&gt;_ where every command is a kill</p>
    </div>

    <div class="flex max-w-[600px] flex-col gap-2 text-left">
      <div class="flex items-baseline gap-3 text-[0.85rem]">
        <span class="shrink-0 text-ability">[01]</span>
        <span class="text-text-dim"
          >Text-based MOBA — command your hero through a terminal interface</span
        >
      </div>
      <div class="flex items-baseline gap-3 text-[0.85rem]">
        <span class="shrink-0 text-ability">[02]</span>
        <span class="text-text-dim"
          >Tick-based combat — plan, execute, outplay. Every 4 seconds matters.</span
        >
      </div>
      <div class="flex items-baseline gap-3 text-[0.85rem]">
        <span class="shrink-0 text-ability">[03]</span>
        <span class="text-text-dim"
          >{{ heroCount }} unique heroes — carries, supports, assassins, tanks, mages,
          offlaners</span
        >
      </div>
      <div class="flex items-baseline gap-3 text-[0.85rem]">
        <span class="shrink-0 text-ability">[04]</span>
        <span class="text-text-dim">Fog of war — place wards to reveal the unseen</span>
      </div>
    </div>

    <div class="flex flex-wrap justify-center gap-3">
      <NuxtLink to="/lobby" class="no-underline">
        <AsciiButton label="ENTER THE TERMINAL" variant="primary" />
      </NuxtLink>
      <AsciiButton
        :label="startingTutorial ? 'STARTING…' : 'PRACTICE VS BOTS'"
        :disabled="startingTutorial"
        variant="ghost"
        data-testid="start-tutorial"
        @click="startTutorial"
      />
      <NuxtLink to="/learn" class="no-underline">
        <AsciiButton label="LEARN COMMANDS" variant="ghost" />
      </NuxtLink>
    </div>

    <div class="mt-4 text-[0.85rem]">
      <span class="font-bold text-radiant">&gt;</span>
      <span class="ml-1 text-text-dim">ready_</span>
      <span class="animate-blink">█</span>
    </div>
  </div>
</template>
