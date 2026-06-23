<script setup lang="ts">
import { HEROES } from '~~/shared/constants/heroes'
import { ROLE_META, ROLE_ORDER } from '~~/shared/constants/roles'
import { heroPlaystyleTags } from '~~/shared/heroPlaystyle'
import HeroLoreCard from '~/components/lore/HeroLoreCard.vue'
import { useStartTutorial } from '~/composables/useStartTutorial'

useHead({ title: 'Lore · TERMINA' })

const { starting: startingTutorial, start: startTutorial } = useStartTutorial()

// Roster grouped by role — labels/blurbs from the shared ROLE_META, heroes
// data-driven from HEROES, so neither can drift.
const roster = ROLE_ORDER.map((role) => ({
  role,
  label: ROLE_META[role].label,
  blurb: ROLE_META[role].blurb,
  heroes: Object.values(HEROES).filter((h) => h.role === role),
})).filter((r) => r.heroes.length > 0)
</script>

<template>
  <article class="mx-auto mt-4 flex max-w-[850px] flex-col gap-5 pb-10">
    <header class="mb-1 border-b border-border pb-2">
      <h1 class="text-lg font-bold tracking-widest text-radiant">&gt;_ THE GRID</h1>
      <p class="mt-1 text-[0.75rem] text-text-dim">The world of Termina</p>
    </header>

    <!-- Worldbuilding -->
    <section class="flex flex-col gap-3 text-[0.82rem] leading-relaxed text-text-dim">
      <p>
        Beneath every terminal hums <span class="text-text-primary">the Grid</span> — a living
        network of zones, each a node fought over by autonomous programs that woke up with a will of
        their own. Two rival systems contest it: each fields a team of five
        <span class="text-ability">operatives</span> and defends a single core structure — its
        <span class="text-radiant">Mainframe</span>, the Ancient that keeps its system alive.
      </p>
      <p>
        Breach the enemy network, push through their defensive processes, and tear down their
        Mainframe before they tear down yours. There is no map you can see in full — vision is
        earned, zone by zone, ward by ward. Everything resolves to the
        <span class="text-text-primary">Scheduler</span>: every four seconds the clock ticks, queued
        commands execute at once, and the battle advances one deterministic step.
      </p>
      <p>
        The operatives are not people. They are
        <span class="text-text-primary">processes given form</span> — daemons, protocols,
        allocators, and locks — each a fragment of the machine turned weapon. Learn them before you
        deploy.
      </p>
    </section>

    <!-- Roster by role -->
    <section v-for="group in roster" :key="group.role" class="flex flex-col gap-2">
      <div class="border-b border-border pb-1">
        <h2 class="text-[0.9rem] font-bold tracking-wide text-ability">{{ group.label }}</h2>
        <p class="text-[0.72rem] text-text-dim">{{ group.blurb }}</p>
      </div>
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <HeroLoreCard
          v-for="h in group.heroes"
          :key="h.id"
          :hero="h"
          :tags="heroPlaystyleTags(h)"
        />
      </div>
    </section>

    <footer class="mt-2 flex flex-col items-center gap-2 border-t border-border pt-3 text-center">
      <p class="text-[0.8rem] text-text-dim">Ready to deploy?</p>
      <div class="flex flex-wrap justify-center gap-3">
        <AsciiButton
          :label="startingTutorial ? 'STARTING…' : 'PRACTICE VS BOTS'"
          :disabled="startingTutorial"
          variant="primary"
          data-testid="start-tutorial"
          @click="startTutorial"
        />
        <NuxtLink to="/heroes" class="no-underline">
          <AsciiButton label="MEET THE HEROES" variant="ghost" />
        </NuxtLink>
      </div>
    </footer>
  </article>
</template>
