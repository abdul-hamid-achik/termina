<script setup lang="ts">
import { HEROES } from '~~/shared/constants/heroes'
import HeroLoreCard from '~/components/lore/HeroLoreCard.vue'
import type { HeroRole } from '~~/shared/types/hero'

useHead({ title: 'Lore · TERMINA' })

// Roster grouped by role — data-driven from HEROES so it can never drift.
const roles: { role: HeroRole; label: string; blurb: string }[] = [
  {
    role: 'carry',
    label: 'Carries',
    blurb: 'Fragile early, unstoppable if fed — they scale into late-game wreckers.',
  },
  { role: 'mage', label: 'Mages', blurb: 'Burst casters who delete targets with ability combos.' },
  {
    role: 'assassin',
    label: 'Assassins',
    blurb: 'Pick off isolated targets from stealth and reposition before the answer lands.',
  },
  {
    role: 'tank',
    label: 'Tanks',
    blurb: 'Front-line cores that soak punishment and start the fights.',
  },
  {
    role: 'support',
    label: 'Supports',
    blurb: 'Enable the team — heals, shields, vision, and utility.',
  },
  {
    role: 'offlaner',
    label: 'Offlaners',
    blurb: 'Durable disruptors who thrive in contested space.',
  },
]

const roster = roles
  .map((r) => ({ ...r, heroes: Object.values(HEROES).filter((h) => h.role === r.role) }))
  .filter((r) => r.heroes.length > 0)
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
        <HeroLoreCard v-for="h in group.heroes" :key="h.id" :hero="h" />
      </div>
    </section>

    <footer class="mt-2 border-t border-border pt-3 text-[0.78rem] text-text-dim">
      Ready to deploy?
      <NuxtLink to="/learn" class="text-ability no-underline hover:underline"
        >learn the verbs</NuxtLink
      >
      or
      <NuxtLink to="/lobby" class="text-ability no-underline hover:underline"
        >enter the terminal</NuxtLink
      >.
    </footer>
  </article>
</template>
