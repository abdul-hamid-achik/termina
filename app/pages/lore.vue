<script setup lang="ts">
import { HEROES } from '~~/shared/constants/heroes'
import { POSTURE_META, POSTURE_ORDER } from '~~/shared/constants/postures'
import { CAST } from '~~/shared/constants/cast'
import { CITY, CREWS, FACTION_META } from '~~/shared/constants/world'
import { heroPlaystyleTags } from '~~/shared/heroPlaystyle'
import HeroLoreCard from '~/components/lore/HeroLoreCard.vue'
import LoreBeat from '~/components/lore/LoreBeat.vue'
import CycleDiagram from '~/components/lore/CycleDiagram.vue'
import CityStack from '~/components/lore/CityStack.vue'
import ScrambleText from '~/components/ui/ScrambleText.vue'
import ParallaxLayer from '~/components/ui/ParallaxLayer.vue'
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

/**
 * The page's spine, and the section nav.
 *
 * The lore used to be six paragraphs and a roster: good prose with no way in
 * and no way back. Naming the beats does two things — it makes the page
 * navigable, and it tells a reader up front that the world is a countable
 * number of ideas rather than an unbounded amount of reading.
 */
const BEATS = [
  { id: 'city', index: '01', title: 'THE CITY' },
  { id: 'clock', index: '02', title: 'THE CLOCK' },
  { id: 'deck', index: '03', title: 'YOUR DECK' },
  { id: 'crews', index: '04', title: 'THE CREWS' },
  { id: 'ground', index: '05', title: 'THE GROUND' },
  { id: 'cast', index: '06', title: 'THE CAST' },
] as const
</script>

<template>
  <article class="mx-auto mt-4 flex max-w-[900px] flex-col gap-6 pb-10">
    <!-- Masthead. The trunks sit behind the title on a slow parallax layer:
         twelve cables coming ashore is the literal reason the city exists, and
         depth is the cheapest way to say "this is underneath everything". -->
    <header class="relative overflow-hidden border-b border-border pb-4">
      <ParallaxLayer :depth="0.12" :distance="40" class="pointer-events-none absolute inset-0">
        <pre
          aria-hidden="true"
          class="select-none whitespace-pre text-[0.55rem] leading-[0.85] text-chaff/[0.07]"
        >
════════════════════════════════════════════════════════
══════════════════════════════════════════════════════
════════════════════════════════════════════════════
══════════════════════════════════════════════════
════════════════════════════════════════════════
══════════════════════════════════════════════
════════════════════════════════════════════
══════════════════════════════════════════
════════════════════════════════════════
══════════════════════════════════════
════════════════════════════════════
══════════════════════════════════</pre
        >
      </ParallaxLayer>

      <div class="relative">
        <h1 class="text-lg font-bold tracking-widest text-chaff">
          &gt;_ <ScrambleText :text="CITY" :speed="600" />
        </h1>
        <p class="mt-1 max-w-[46ch] text-[0.78rem] leading-relaxed text-text-dim">
          Twelve transoceanic trunks come out of the sea here and stop. Everything the world has to
          say to this coast arrives at {{ CITY }} first.
        </p>
      </div>
    </header>

    <!-- Section nav: sticky, so the page never traps you at the bottom of it. -->
    <nav
      class="sticky top-0 z-10 -mx-2 flex flex-wrap gap-x-3 gap-y-1 border-b border-border bg-bg-primary/95 px-2 py-1.5 backdrop-blur"
      aria-label="Sections"
    >
      <a
        v-for="b in BEATS"
        :key="b.id"
        :href="`#${b.id}`"
        class="font-mono text-[0.68rem] uppercase tracking-wider text-text-muted no-underline transition-colors hover:text-chaff"
        >{{ b.index }} {{ b.title }}</a
      >
    </nav>

    <LoreBeat id="city" index="01" title="THE CITY">
      <p>
        The city grew on top of the landing, and it is still growing on top of it. Everything above
        the cable heads was built by somebody who needed the room.
      </p>
      <CityStack />
    </LoreBeat>

    <LoreBeat id="clock" index="02" title="THE CLOCK">
      <p>
        {{ CITY }} does not run in real time. The city commits every instruction at once, four
        seconds wide, in no order. One commit is a <span class="text-text-primary">CYCLE</span>.
      </p>
      <CycleDiagram />
      <p>
        It was built that way to end a latency arms race that was killing people over ten metres of
        ground. Now nobody is faster than anybody. You get one instruction per cycle.
        <span class="text-text-primary">So does everyone else.</span>
      </p>
      <p class="border-l-2 border-chaff/40 pl-3 text-text-primary">
        It is the fairest thing in the city, and a company owns it.
      </p>
    </LoreBeat>

    <LoreBeat id="deck" index="03" title="YOUR DECK">
      <p>
        You are not in the city. You are on a terminal, and the terminal is your deck. Everything
        you know about the ground arrives as text — a route, a depth, a list of contacts. Everything
        you do leaves as one typed instruction, queued into the next cycle.
      </p>
      <p class="text-text-muted">
        You will never see the street. You will see what the street reports.
      </p>
    </LoreBeat>

    <LoreBeat id="crews" index="04" title="THE CREWS">
      <p>Two crews work the routes.</p>
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div
          v-for="team in ['chaff', 'audit'] as const"
          :key="team"
          class="flex flex-col gap-1 border p-3"
          :class="team === 'chaff' ? 'border-chaff/50' : 'border-audit/50'"
        >
          <span
            class="text-[0.85rem] font-bold tracking-widest"
            :class="team === 'chaff' ? 'text-chaff' : 'text-audit'"
            >{{ CREWS[team] }}</span
          >
          <p class="text-[0.76rem] leading-relaxed text-text-dim">
            {{ FACTION_META[team].blurb }}
          </p>
        </div>
      </div>
      <p>
        Quorum is not just the other crew — it is the ground. The ICE on the routes is Quorum's. The
        traffic is Quorum's. The clock is Quorum's.
      </p>
    </LoreBeat>

    <LoreBeat id="ground" index="05" title="THE GROUND">
      <p>
        Each crew keeps one <span class="text-text-primary">Terminal</span> alive. Bring the other
        crew's Terminal down and the ground is yours. Everything between the two is three routes and
        the ICE standing on them.
      </p>
      <p>
        The units that walk those routes every cycle are traffic, not scenery. Every one of them is
        carrying something worth taking, and
        <span class="text-text-primary">nobody out there is a bystander</span>.
      </p>
    </LoreBeat>

    <!-- Roster by posture -->
    <section id="cast" class="scroll-mt-20 flex flex-col gap-4">
      <header class="flex items-baseline gap-3 border-b border-border pb-1.5">
        <span class="t-mono-num shrink-0 text-[0.7rem] text-text-muted">[06]</span>
        <h2 class="text-[0.95rem] font-bold tracking-widest text-chaff">
          <ScrambleText text="THE CAST" :speed="380" />
        </h2>
        <span class="ml-auto text-[0.68rem] text-text-muted"
          >{{ Object.keys(HEROES).length }} operators</span
        >
      </header>

      <div v-for="group in roster" :key="group.posture" class="flex flex-col gap-2">
        <div class="border-b border-border/60 pb-1">
          <h3 class="text-[0.85rem] font-bold tracking-wide text-ability">{{ group.label }}</h3>
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
      </div>
    </section>

    <footer class="mt-2 flex flex-col items-center gap-2 border-t border-border pt-4 text-center">
      <p class="text-[0.8rem] text-text-dim">Ready to deploy?</p>
      <div class="flex flex-wrap justify-center gap-3">
        <AsciiButton
          :label="startingTutorial ? 'STARTING…' : 'PRACTICE VS BOTS'"
          :disabled="startingTutorial"
          variant="primary"
          data-testid="start-tutorial"
          @click="startTutorial"
        />
        <NuxtLink to="/cast" class="no-underline">
          <AsciiButton label="MEET THE HEROES" variant="ghost" />
        </NuxtLink>
      </div>
      <InlineError :message="tutorialError" />
    </footer>
  </article>
</template>
