<script setup lang="ts">
import { HERO_IDS, HEROES } from '~~/shared/constants/heroes'
import { TICK_DURATION_MS } from '~~/shared/constants/balance'
import { useStartTutorial } from '~/composables/useStartTutorial'
import { useAuthStore } from '~/stores/auth'

// Live hero count from the registry so the landing page can't drift.
const heroCount = HERO_IDS.length
const tickSeconds = TICK_DURATION_MS / 1000

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

// Ticker content, both sourced from live data so the strip can't advertise a
// hero that was renamed or a command the parser no longer accepts.
const heroTicker = HERO_IDS.map((id) => HEROES[id]?.name ?? id)
const commandTicker = [
  'move mid-river',
  'attack creep:0',
  'cast q hero:daemon',
  'buy blades_of_attack',
  'ward mid-river',
  'deny creep:1',
  'attack roshan',
  'cast r',
  'glyph',
  'attack tower:mid-t1-dire',
]

const pillars = [
  { n: '01', text: 'Command your hero through a terminal. No mouse, no reflexes.' },
  { n: '02', text: `Tick-based combat — every ${tickSeconds} seconds resolves at once.` },
  { n: '03', text: `${heroCount} heroes: carries, supports, assassins, tanks, mages, offlaners.` },
  { n: '04', text: 'Fog of war — ward the map or fight blind.' },
]
</script>

<template>
  <div class="flex flex-col gap-16 pb-16">
    <!-- ── Hero ──────────────────────────────────────────────────
         Three depth layers. The glyph field sits furthest back and drifts
         least; the wordmark and the CTAs ride nearer the reader. Everything
         here is transform/opacity only — see ParallaxLayer for why this is not
         background-attachment: fixed. -->
    <section
      class="relative flex min-h-[calc(100vh-140px)] flex-col items-center justify-center overflow-hidden px-8 text-center max-sm:px-4"
    >
      <!-- Depth 1: an ambient field of terminal glyphs. Purely atmospheric, so
           it is aria-hidden and pointer-events-none — it must never intercept a
           tap meant for the CTA beneath it. -->
      <ParallaxLayer
        :depth="0.15"
        aria-hidden="true"
        class="pointer-events-none absolute inset-0 -z-10 select-none"
      >
        <div
          class="grid h-full w-full grid-cols-8 place-items-center font-mono text-[0.6rem] leading-none text-radiant/[0.07] md:grid-cols-12"
        >
          <span v-for="i in 96" :key="i">{{ ['0', '1', '/', '>', '·', '│'][i % 6] }}</span>
        </div>
      </ParallaxLayer>

      <!-- Depth 2: the wordmark. -->
      <ParallaxLayer :depth="0.35" class="flex flex-col items-center gap-4">
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

        <!-- The tagline decodes on arrival. The delays cascade the two lines so
             they resolve in reading order rather than racing each other. -->
        <p class="text-base tracking-wide text-radiant">
          <ScrambleText text=">_ where every command is a kill" :speed="900" :delay="200" />
        </p>
        <p class="max-w-[460px] text-[0.8rem] leading-relaxed text-text-dim">
          <ScrambleText
            text="A 5v5 MOBA of pure strategy. No download, no reflexes, no queue."
            :speed="1100"
            :delay="700"
          />
        </p>
      </ParallaxLayer>

      <!-- Depth 3: the CTAs travel most — they are nearest the reader. -->
      <ParallaxLayer :depth="0.5" class="mt-10 flex flex-col items-center gap-3">
        <div class="flex flex-wrap justify-center gap-3">
          <!-- Funnel: practice is the primary CTA until the tutorial is done,
               then ranked takes the primary slot. -->
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
        <p class="text-[0.75rem] text-text-dim/70">
          <span class="font-bold text-radiant">&gt;</span>
          <span class="ml-1">ready_</span>
          <span aria-hidden="true" class="animate-blink">█</span>
        </p>
      </ParallaxLayer>
    </section>

    <!-- Hero roster ticker: proof of breadth, straight from the registry. -->
    <MarqueeStrip :items="heroTicker" :duration="55" />

    <!-- ── What it is ───────────────────────────────────────────── -->
    <section class="mx-auto flex w-full max-w-[620px] flex-col gap-3 px-8 max-sm:px-4">
      <h2 class="mb-1 text-[0.7rem] uppercase tracking-widest text-text-dim">// what it is</h2>
      <div v-for="p in pillars" :key="p.n" class="flex items-baseline gap-3 text-[0.85rem]">
        <span class="shrink-0 text-ability">[{{ p.n }}]</span>
        <span class="text-text-dim">{{ p.text }}</span>
      </div>
    </section>

    <!-- ── A turn, concretely ───────────────────────────────────────
         The single most load-bearing piece of teaching on the site: it shows
         the whole loop — you type one command, the scheduler resolves it. -->
    <section class="mx-auto w-full max-w-[620px] px-8 max-sm:px-4">
      <h2 class="mb-2 text-[0.7rem] uppercase tracking-widest text-text-dim">
        // a turn, in plain text
      </h2>
      <div
        class="border border-border bg-bg-secondary p-3 text-left font-mono text-[0.72rem] leading-relaxed"
      >
        <p>
          <span class="text-radiant">&gt;</span>
          <span class="text-ability">cast q hero:daemon</span>
        </p>
        <p class="text-text-dim">
          &nbsp;&nbsp;⤷ tick 42 · Resonance hits Daemon — 80 dmg (+bounce)
        </p>
        <p>
          <span class="text-radiant">&gt;</span> <span class="text-ability">move mid-river</span>
        </p>
        <p class="text-text-dim">&nbsp;&nbsp;⤷ tick 43 · you advance to mid-river</p>
        <p>
          <span class="text-radiant">&gt;</span>
          <span class="text-ability">attack tower:mid-t1-dire</span>
        </p>
        <p class="text-text-dim">&nbsp;&nbsp;⤷ tick 44 · tower takes 55, your creeps pile in</p>
      </div>
    </section>

    <!-- Command ticker, running the other way — the counter-direction against
         the roster strip is what sells the two as separate planes. -->
    <MarqueeStrip :items="commandTicker" :duration="45" reverse />

    <!-- ── Where to go ──────────────────────────────────────────── -->
    <section class="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 px-8 text-[0.8rem]">
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
    </section>
  </div>
</template>
