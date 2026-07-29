<script setup lang="ts">
import { HERO_IDS } from '~~/shared/constants/heroes'
import { useStartTutorial } from '~/composables/useStartTutorial'
import { useAuthStore } from '~/stores/auth'

// Live hero count from the registry so the landing page can't drift.
const heroCount = HERO_IDS.length

// Practice vs bots: shared one-lane tutorial launcher (see useStartTutorial).
const {
  starting: startingTutorial,
  error: tutorialError,
  start: startTutorial,
} = useStartTutorial()

// Funnel: new players (no completed tutorial) are steered to practice as the
// primary CTA; returning players who finished it get ranked as the primary.
const authStore = useAuthStore()
const tutorialDone = computed(() => authStore.user?.tutorialCompleted === true)
</script>

<template>
  <div
    class="flex min-h-[calc(100vh-120px)] flex-col items-center justify-center gap-8 p-8 text-center max-sm:p-4"
  >
    <div class="flex flex-col items-center gap-3">
      <h1 class="sr-only">TERMINA — a text-based MOBA</h1>
      <pre
        aria-hidden="true"
        class="m-0 text-[0.5rem] leading-[1.15] text-radiant text-glow md:text-[0.7rem]"
      >
████████╗███████╗██████╗ ███╗   ███╗██╗███╗   ██╗ █████╗
╚══██╔══╝██╔════╝██╔══██╗████╗ ████║██║████╗  ██║██╔══██╗
   ██║   █████╗  ██████╔╝██╔████╔██║██║██╔██╗ ██║███████║
   ██║   ██╔══╝  ██╔══██╗██║╚██╔╝██║██║██║╚██╗██║██╔══██║
   ██║   ███████╗██║  ██║██║ ╚═╝ ██║██║██║ ╚████║██║  ██║
   ╚═╝   ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝</pre
      >

      <p class="text-base tracking-wide text-text-dim">&gt;_ where every command is a kill</p>
      <p class="max-w-[460px] text-[0.8rem] leading-relaxed text-text-dim/80">
        A 5v5 MOBA of pure strategy — no reflexes, no download, no waiting on a queue. Play against
        bots any time, or rank up when you're ready.
      </p>
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

    <!-- Sample turn — show the text-MOBA loop concretely: you issue one command,
         the 4-second scheduler resolves it, repeat. Demystifies the core loop. -->
    <div
      class="w-full max-w-[600px] border border-border bg-bg-secondary p-3 text-left font-mono text-[0.72rem] leading-relaxed"
      aria-label="Sample turn"
    >
      <div class="mb-1 text-[0.62rem] uppercase tracking-widest text-text-dim">
        // a turn, in plain text
      </div>
      <p>
        <span class="text-radiant">&gt;</span> <span class="text-ability">cast q hero:daemon</span>
      </p>
      <p class="text-text-dim">&nbsp;&nbsp;⤷ tick 42 · Resonance hits Daemon — 80 dmg (+bounce)</p>
      <p><span class="text-radiant">&gt;</span> <span class="text-ability">move mid-river</span></p>
      <p class="text-text-dim">&nbsp;&nbsp;⤷ tick 43 · you advance to mid-river</p>
      <p>
        <span class="text-radiant">&gt;</span>
        <span class="text-ability">attack tower:mid-t1-dire</span>
      </p>
      <p class="text-text-dim">&nbsp;&nbsp;⤷ tick 44 · tower takes 55, your creeps pile in</p>
    </div>

    <div class="flex flex-wrap justify-center gap-3">
      <!-- Funnel: practice is the primary CTA until the tutorial is done, then
           ranked takes the primary slot (returning players skip the nudge). -->
      <AsciiButton
        :label="startingTutorial ? 'STARTING…' : 'PRACTICE VS BOTS'"
        :disabled="startingTutorial"
        :variant="tutorialDone ? 'ghost' : 'primary'"
        data-testid="start-tutorial"
        @click="startTutorial"
      />
      <NuxtLink to="/lobby" class="no-underline">
        <AsciiButton label="ENTER THE TERMINAL" :variant="tutorialDone ? 'primary' : 'ghost'" />
      </NuxtLink>
    </div>
    <InlineError :message="tutorialError" />

    <!-- New-player paths: learn the kit + the world before queueing. -->
    <div class="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-[0.8rem]">
      <NuxtLink to="/heroes" class="text-ability no-underline transition-colors hover:text-radiant">
        &gt; meet the heroes
      </NuxtLink>
      <NuxtLink to="/items" class="text-text-dim no-underline transition-colors hover:text-ability">
        &gt; browse items
      </NuxtLink>
      <NuxtLink to="/learn" class="text-text-dim no-underline transition-colors hover:text-ability">
        &gt; learn commands
      </NuxtLink>
      <NuxtLink to="/lore" class="text-text-dim no-underline transition-colors hover:text-ability">
        &gt; read the lore
      </NuxtLink>
    </div>

    <div class="mt-4 text-[0.85rem]">
      <span class="font-bold text-radiant">&gt;</span>
      <span class="ml-1 text-text-dim">ready_</span>
      <span aria-hidden="true" class="animate-blink">█</span>
    </div>
  </div>
</template>
