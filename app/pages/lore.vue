<script setup lang="ts">
import { HEROES } from '~~/shared/constants/heroes'
import { POSTURE_META, POSTURE_ORDER } from '~~/shared/constants/postures'
import { CAST } from '~~/shared/constants/cast'
import { CITY, CREWS } from '~~/shared/constants/world'
import { heroPlaystyleTags } from '~~/shared/heroPlaystyle'
import HeroLoreCard from '~/components/lore/HeroLoreCard.vue'
import { useStartTutorial } from '~/composables/useStartTutorial'

type HeroId = keyof typeof CAST

useHead({ title: `Lore · ${CITY}` })

const {
  starting: startingTutorial,
  error: tutorialError,
  start: startTutorial,
} = useStartTutorial()

// Roster grouped by posture — labels/blurbs from POSTURE_META, heroes
// data-driven from HEROES, so neither can drift.
const roster = POSTURE_ORDER.map((posture) => ({
  posture,
  label: POSTURE_META[posture].label,
  blurb: POSTURE_META[posture].blurb,
  heroes: Object.values(HEROES).filter((h) => h.posture === posture),
})).filter((r) => r.heroes.length > 0)
</script>

<template>
  <article class="mx-auto mt-4 flex max-w-[850px] flex-col gap-5 pb-10">
    <header class="mb-1 border-b border-border pb-2">
      <h1 class="text-lg font-bold tracking-widest text-chaff">&gt;_ {{ CITY }}</h1>
      <p class="mt-1 text-[0.75rem] text-text-dim">
        A cable-landing city, and the clock it runs on.
      </p>
    </header>

    <!-- Worldbuilding -->
    <section class="flex flex-col gap-3 text-[0.82rem] leading-relaxed text-text-dim">
      <p>
        Twelve transoceanic trunks come out of the sea here and stop. Everything the world has to
        say to this coast arrives at <span class="text-text-primary">{{ CITY }}</span> first, and
        the city grew on top of the landing: LANDING on the cable heads, ROOKERY stacked above it,
        COLDSTORE in the racks, SHALLOWS where the fibre thins out and the ground gets cheap.
      </p>
      <p>
        {{ CITY }} does not run in real time. The city commits every instruction at once, four
        seconds wide, in no order. One commit is a <span class="text-text-primary">CYCLE</span>. It
        was built that way to end a latency arms race that was killing people over ten metres of
        ground — now nobody is faster than anybody. You get one instruction per cycle. So does
        everyone else.
      </p>
      <p>
        You are not in the city. You are on a terminal, and the terminal is your deck. Everything
        you know about the ground arrives as text — a route, a depth, a list of contacts. Everything
        you do leaves as one typed instruction, queued into the next cycle.
      </p>
      <p>
        Two crews work the routes. <span class="text-chaff">{{ CREWS.chaff }}</span> came up off the
        street and stayed there. <span class="text-chaff">{{ CREWS.audit }}</span> is Quorum's
        corporate response division. Quorum is not just the other crew — it is the ground. The ICE
        on the routes is Quorum's. The traffic is Quorum's. The clock is Quorum's.
      </p>
      <p>
        Each crew keeps one
        <span class="text-chaff">Terminal</span> alive. Bring the other crew's Terminal down and the
        ground is yours.
      </p>
      <p>
        The units that walk the routes every cycle are traffic, not scenery. Every one of them is
        carrying something worth taking, and nobody out there is a bystander.
      </p>
    </section>

    <!-- Roster by posture -->
    <section v-for="group in roster" :key="group.posture" class="flex flex-col gap-2">
      <div class="border-b border-border pb-1">
        <h2 class="text-[0.9rem] font-bold tracking-wide text-ability">{{ group.label }}</h2>
        <p class="text-[0.72rem] text-text-dim">{{ group.blurb }}</p>
      </div>
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <HeroLoreCard
          v-for="h in group.heroes"
          :key="h.id"
          :hero="h"
          :real-name="CAST[h.id as HeroId].realName"
          :origin="CAST[h.id as HeroId].origin"
          :bio="CAST[h.id as HeroId].bio"
          :handle-rationale="CAST[h.id as HeroId].handleRationale"
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
      <InlineError :message="tutorialError" />
    </footer>
  </article>
</template>
