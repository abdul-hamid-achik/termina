<script setup lang="ts">
import { HEROES } from '~~/shared/constants/heroes'
import type { HeroId, HeroRole } from '~~/shared/types/hero'
import AbilitySlot from '~/components/heroes/AbilitySlot.vue'
import TargetDummy from '~/components/heroes/TargetDummy.vue'
import { useStartTutorial } from '~/composables/useStartTutorial'
import { useTrainingConsole } from '~/composables/useTrainingConsole'
import type { ConsoleSlot } from '~/composables/useTrainingConsole'

useHead({ title: 'Heroes · TERMINA' })

const allHeroes = Object.values(HEROES)

// Deep-link support: /heroes?hero=daemon preselects that hero (e.g. from a lore
// card's TRAIN link), so reading a hero's story flows straight into its kit.
// Falls back to echo for a missing/unknown id.
const route = useRoute()
const queryHero =
  typeof route.query.hero === 'string' && route.query.hero in HEROES
    ? (route.query.hero as HeroId)
    : 'echo'

const selectedId = ref<HeroId>(queryHero)
// selectedId is always a valid HeroId, but noUncheckedIndexedAccess widens the
// lookup to `| undefined` — assert since the key is guaranteed present.
const hero = computed(() => HEROES[selectedId.value]!)

// Role filter so a newcomer can narrow the roster to a role they want to learn
// ("show me a support"). 'all' shows everyone.
const ROLE_FILTERS = ['all', 'carry', 'support', 'mage', 'assassin', 'tank', 'offlaner'] as const
const selectedRole = ref<'all' | HeroRole>('all')
const filteredHeroes = computed(() =>
  selectedRole.value === 'all' ? allHeroes : allHeroes.filter((h) => h.role === selectedRole.value),
)
function selectRole(role: 'all' | HeroRole) {
  selectedRole.value = role
  // Keep the kit panel in sync with the visible grid: if the current hero isn't
  // in the chosen role, jump to the first hero of that role.
  if (role !== 'all' && hero.value.role !== role) {
    const first = filteredHeroes.value[0]
    if (first) selectedId.value = first.id as HeroId
  }
}

// The training-console state machine (cast/advance-tick/dummy/DoT) lives in a
// unit-tested composable; the page just wires it to the UI.
const {
  SLOTS,
  DUMMY_NAME,
  dummyMax,
  mana,
  cooldowns,
  tick,
  log,
  dummyHp,
  dots,
  totalDamage,
  castCount,
  cast,
  castCombo,
  advanceTick,
  reset,
} = useTrainingConsole(hero)

function onKey(e: KeyboardEvent) {
  // Don't hijack browser/OS chords (Cmd/Ctrl/Alt + key) or typing in fields.
  if (e.ctrlKey || e.metaKey || e.altKey) return
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
  const k = e.key.toLowerCase()
  if ((SLOTS as string[]).includes(k)) {
    e.preventDefault()
    cast(k as ConsoleSlot)
  } else if (k === 'c') {
    e.preventDefault()
    castCombo()
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

const manaPct = computed(() =>
  hero.value.baseStats.mp ? Math.round((mana.value / hero.value.baseStats.mp) * 100) : 0,
)

// Learn → play: shared practice-vs-bots launcher for the footer CTA.
const { starting: startingTutorial, start: startTutorial } = useStartTutorial()
</script>

<template>
  <div class="mx-auto mt-4 flex max-w-[980px] flex-col gap-4 pb-10">
    <header class="border-b border-border pb-2">
      <h1 class="text-lg font-bold tracking-widest text-radiant">&gt;_ HERO TRAINING</h1>
      <p class="mt-1 text-[0.78rem] text-text-dim">
        A safe dry-run of every kit. Pick an operative, cast its abilities, and watch the real
        outcomes resolve on the 4-second scheduler — learn the heroes before you queue.
      </p>
    </header>

    <!-- Role filter — narrow the roster to a role to learn -->
    <div class="flex flex-wrap gap-1.5" role="group" aria-label="Filter heroes by role">
      <button
        v-for="r in ROLE_FILTERS"
        :key="r"
        type="button"
        :data-testid="`role-filter-${r}`"
        :aria-pressed="r === selectedRole"
        class="border px-2 py-0.5 text-[0.65rem] uppercase tracking-wider transition-colors"
        :class="
          r === selectedRole
            ? 'border-ability bg-ability/10 text-ability'
            : 'border-border text-text-dim hover:border-border-glow hover:text-text-primary'
        "
        @click="selectRole(r)"
      >
        {{ r }}
      </button>
    </div>

    <!-- Hero selector -->
    <div class="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
      <button
        v-for="h in filteredHeroes"
        :key="h.id"
        type="button"
        data-testid="hero-pick"
        :data-role="h.role"
        :aria-pressed="h.id === selectedId"
        class="flex flex-col items-center gap-0.5 border px-1 py-1.5 transition-colors"
        :class="
          h.id === selectedId
            ? 'border-ability bg-ability/10 text-ability'
            : 'border-border text-text-dim hover:border-border-glow hover:text-text-primary'
        "
        @click="selectedId = h.id as HeroId"
      >
        <span class="text-[0.78rem] font-bold">{{ h.name }}</span>
        <span class="text-[0.58rem] uppercase tracking-wider opacity-70">{{ h.role }}</span>
      </button>
    </div>

    <div class="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
      <!-- Kit -->
      <section class="flex flex-col gap-2">
        <div class="flex items-baseline gap-2 border-b border-border pb-1">
          <h2 class="text-[0.95rem] font-bold text-text-primary">{{ hero.name }}</h2>
          <span class="text-[0.65rem] uppercase tracking-widest text-ability">{{ hero.role }}</span>
          <!-- Reverse funnel: jump to this hero's lore card on /lore. -->
          <NuxtLink
            :to="`/lore#lore-${selectedId}`"
            class="ml-auto text-[0.65rem] text-text-dim no-underline hover:text-radiant"
            :aria-label="`Read ${hero.name}'s lore`"
          >
            &gt; LORE
          </NuxtLink>
        </div>
        <div class="flex flex-wrap gap-x-3 gap-y-1 text-[0.68rem] text-text-dim">
          <span><span class="text-radiant">hp</span> {{ hero.baseStats.hp }}</span>
          <span><span class="text-ability">mp</span> {{ hero.baseStats.mp }}</span>
          <span><span class="text-gold">atk</span> {{ hero.baseStats.attack }}</span>
          <span>def {{ hero.baseStats.defense }}</span>
          <span>mres {{ hero.baseStats.magicResist }}</span>
          <span class="uppercase">{{ hero.baseStats.attackRange }}</span>
        </div>
        <p class="text-[0.75rem] italic leading-relaxed text-text-dim">{{ hero.lore }}</p>

        <AbilitySlot slot-key="◆" :ability="hero.passive" class="mt-1" />
        <AbilitySlot
          v-for="s in SLOTS"
          :key="s"
          :slot-key="s.toUpperCase()"
          :ability="hero.abilities[s]"
          :cooldown-remaining="cooldowns[s]"
          :mana-available="mana"
          interactive
          @cast="cast(s)"
        />
        <p class="text-[0.6rem] text-text-dim">
          Click a slot or press Q / W / E / R to cast — or C for the full combo.
        </p>
      </section>

      <!-- Console -->
      <section class="flex flex-col gap-2">
        <div class="flex flex-col gap-1 border border-border p-2.5">
          <div class="flex items-center justify-between text-[0.7rem] text-text-dim">
            <span><span class="text-ability">mana</span> {{ mana }} / {{ hero.baseStats.mp }}</span>
            <span>tick {{ tick }}</span>
          </div>
          <div class="h-1.5 w-full bg-bg-secondary">
            <div class="h-full bg-ability transition-all" :style="{ width: `${manaPct}%` }" />
          </div>
          <!-- Output tally — lets a learner compare each kit's burst at a glance. -->
          <div class="flex items-center justify-between text-[0.7rem] text-text-dim">
            <span><span class="text-dire">dmg dealt</span> {{ totalDamage.toLocaleString() }}</span>
            <span>{{ castCount }} cast{{ castCount === 1 ? '' : 's' }}</span>
          </div>
          <div class="mt-1 flex flex-wrap gap-2">
            <AsciiButton label="CAST COMBO (C)" variant="primary" @click="castCombo" />
            <AsciiButton label="ADVANCE TICK (4s)" @click="advanceTick" />
            <AsciiButton label="RESET" variant="ghost" @click="reset" />
          </div>
        </div>

        <TargetDummy :name="DUMMY_NAME" :hp="dummyHp" :max-hp="dummyMax" :dots="dots.length" />
        <p class="text-[0.6rem] leading-snug text-text-dim">
          Impact shows base values — no armor, magic resist or amp. A feel for each kit, not a
          combat sim.
        </p>

        <!-- Announce only the latest line to AT, not the whole 50-line buffer. -->
        <div aria-live="polite" aria-atomic="true" class="sr-only">{{ log[log.length - 1] }}</div>
        <div
          class="flex-1 overflow-y-auto border border-border bg-bg-secondary p-2 font-mono text-[0.72rem] leading-relaxed"
          style="min-height: 240px; max-height: 360px"
        >
          <p
            v-for="(line, i) in log"
            :key="i"
            class="whitespace-pre-wrap"
            :class="
              line.startsWith('!')
                ? 'text-dire'
                : line.startsWith('—')
                  ? 'text-text-dim'
                  : line.startsWith('>')
                    ? 'text-radiant'
                    : 'text-text-primary'
            "
          >
            {{ line }}
          </p>
        </div>
      </section>
    </div>

    <footer class="flex flex-col items-center gap-2 border-t border-border pt-3 text-center">
      <p class="text-[0.8rem] text-text-dim">
        Got the hang of {{ hero.name }}? Take a kit into a real match.
      </p>
      <div class="flex flex-wrap justify-center gap-3">
        <AsciiButton
          :label="startingTutorial ? 'STARTING…' : 'PRACTICE VS BOTS'"
          :disabled="startingTutorial"
          variant="primary"
          data-testid="start-tutorial"
          @click="startTutorial"
        />
        <NuxtLink to="/lobby" class="no-underline">
          <AsciiButton label="ENTER THE TERMINAL" variant="ghost" />
        </NuxtLink>
      </div>
    </footer>
  </div>
</template>
