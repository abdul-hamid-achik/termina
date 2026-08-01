<script setup lang="ts">
import { HEROES } from '~~/shared/constants/heroes'
import { POSTURE_META } from '~~/shared/constants/postures'
import { CAST } from '~~/shared/constants/cast'
import { getTalentTree, talentUnlockLevel, type TalentTier } from '~~/shared/constants/talents'
import { heroPlaystyleTags, type PlaystyleTag } from '~~/shared/heroPlaystyle'
import { filterHeroes, type PostureFilter, type PlaystyleFilter } from '~/utils/heroFilter'
import type { HeroId, HeroRole, HeroDifficulty, HeroPosture } from '~~/shared/types/hero'
import AbilitySlot from '~/components/heroes/AbilitySlot.vue'
import { getAbilityBwCost } from '~~/shared/utils/ability'
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
// Kit-identity tags (Burst/Control/Sustain/…) — a quick "how does this play".
const playstyle = computed(() => heroPlaystyleTags(hero.value))

// Two filter axes a newcomer can narrow the roster by: posture (what you pick
// on) and playstyle (how the kit plays). 'all' on either passes everything through.
const POSTURE_FILTERS = ['all', 'BREACH', 'HOLD', 'ROAM', 'HARDLINE'] as const
const PLAYSTYLE_TAGS = ['Burst', 'Damage over time', 'Control', 'Sustain', 'Mobility'] as const
const selectedPosture = ref<PostureFilter>('all')
const selectedPlaystyle = ref<PlaystyleFilter>('all')

// Only offer playstyle filters that some hero actually has (e.g. drop a tag no
// kit qualifies for), so a filter chip never yields an empty grid by itself.
const availablePlaystyles = computed<PlaystyleFilter[]>(() => {
  const present = new Set<PlaystyleTag>()
  for (const h of allHeroes) for (const t of heroPlaystyleTags(h)) present.add(t)
  return ['all', ...PLAYSTYLE_TAGS.filter((t) => present.has(t))]
})

const filteredHeroes = computed(() =>
  filterHeroes(allHeroes, selectedPosture.value, selectedPlaystyle.value),
)

function selectPosture(posture: PostureFilter) {
  selectedPosture.value = posture
}
function selectPlaystyle(p: PlaystyleFilter) {
  selectedPlaystyle.value = p
}

// Keep the kit panel coherent with the grid: if the active filters hide the
// currently-selected hero, jump to the first one still visible (when any).
watch(filteredHeroes, (list) => {
  if (list.length && !list.some((h) => h.id === selectedId.value)) {
    selectedId.value = list[0]!.id as HeroId
  }
})

// The training-console state machine (cast/advance-tick/dummy/DoT) lives in a
// unit-tested composable; the page just wires it to the UI.
const {
  SLOTS,
  DUMMY_NAME,
  CONSOLE_LEVELS,
  dummyMax,
  level,
  maxBw,
  bw,
  cooldowns,
  cycle,
  log,
  dummyHp,
  dots,
  statuses,
  totalDamage,
  castCount,
  rankOf,
  isLocked,
  maxRankFor,
  unlockLevelFor,
  cast,
  castCombo,
  advanceCycle,
  reset,
} = useTrainingConsole(hero)

// Pick guidance, authored per hero. `difficulty` rates how punishing the kit is
// to misuse (conditional gates, stack economies, self-displacement) — not how
// strong it is — so a newcomer can pick a hero that forgives a misclick.
const DIFFICULTY_META: Record<HeroDifficulty, { label: string; class: string }> = {
  easy: { label: 'BEGINNER', class: 'border-chaff/50 bg-chaff/10 text-chaff' },
  medium: { label: 'MEDIUM', class: 'border-gold/50 bg-gold/10 text-gold' },
  hard: { label: 'HARD', class: 'border-audit/50 bg-audit/10 text-audit' },
}

const openingCombo = computed(() =>
  hero.value.openingCombo.map((s) => ({
    slot: s,
    name: hero.value.abilities[s].name,
    locked: isLocked(s),
  })),
)

// Talents are the only permanent build choice in a match, and until now they
// existed nowhere outside one: the player met the pick mid-fight on the 4s
// clock. Tier IDs (10/15/20/25) are NOT the levels they unlock at — read the
// level from talentUnlockLevel so this can't drift from the engine's schedule.
const TALENT_TIERS: readonly TalentTier[] = [10, 15, 20, 25]
const talentTree = computed(() => getTalentTree(selectedId.value))

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

const bwPct = computed(() => (maxBw.value ? Math.round((bw.value / maxBw.value) * 100) : 0))

// Learn → play: shared practice-vs-bots launcher for the footer CTA.
const {
  starting: startingTutorial,
  error: tutorialError,
  start: startTutorial,
} = useStartTutorial()
</script>

<template>
  <div class="mx-auto mt-4 flex max-w-[980px] flex-col gap-4 pb-10">
    <header class="border-b border-border pb-2">
      <h1 class="text-lg font-bold tracking-widest text-chaff">&gt;_ HERO TRAINING</h1>
      <p class="mt-1 text-[0.78rem] text-text-dim">
        A safe dry-run of every kit. Pick an operative, cast its abilities, and watch the real
        outcomes resolve on the 4-second scheduler — learn the heroes before you queue.
      </p>
    </header>

    <!-- Posture filter — narrow the roster to a posture to learn -->
    <div class="flex flex-wrap gap-1.5" role="group" aria-label="Filter heroes by posture">
      <button
        v-for="p in POSTURE_FILTERS"
        :key="p"
        type="button"
        :data-testid="`posture-filter-${p}`"
        :aria-pressed="p === selectedPosture"
        class="border px-2 py-0.5 text-[0.65rem] uppercase tracking-wider transition-colors"
        :class="
          p === selectedPosture
            ? 'border-ability bg-ability/10 text-ability'
            : 'border-border text-text-dim hover:border-border-glow hover:text-text-primary'
        "
        @click="selectPosture(p)"
      >
        {{ p }}
      </button>
    </div>
    <!-- What the filtered posture does — a one-line primer for newcomers. -->
    <p
      v-if="selectedPosture !== 'all'"
      class="-mt-2 text-[0.72rem] text-text-dim"
      data-testid="posture-blurb"
    >
      {{ POSTURE_META[selectedPosture].blurb }}
    </p>

    <!-- Playstyle filter — narrow by how the kit plays (Burst/Control/…) -->
    <div
      class="flex flex-wrap items-center gap-1.5"
      role="group"
      aria-label="Filter heroes by playstyle"
    >
      <span class="text-[0.6rem] uppercase tracking-wider text-text-muted">playstyle</span>
      <button
        v-for="p in availablePlaystyles"
        :key="p"
        type="button"
        :data-testid="`playstyle-filter-${p}`"
        :aria-pressed="p === selectedPlaystyle"
        class="border px-2 py-0.5 text-[0.65rem] uppercase tracking-wider transition-colors"
        :class="
          p === selectedPlaystyle
            ? 'border-ability bg-ability/10 text-ability'
            : 'border-border text-text-dim hover:border-border-glow hover:text-text-primary'
        "
        @click="selectPlaystyle(p)"
      >
        {{ p }}
      </button>
    </div>

    <!-- Empty state when the two filters together match no hero -->
    <p
      v-if="filteredHeroes.length === 0"
      class="-mt-1 text-[0.72rem] text-warn"
      data-testid="hero-filter-empty"
    >
      &gt;_ no {{ selectedPosture === 'all' ? '' : selectedPosture + ' ' }}hero plays
      {{ selectedPlaystyle }} — try another combination.
    </p>

    <!-- Hero selector -->
    <div class="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
      <button
        v-for="h in filteredHeroes"
        :key="h.id"
        type="button"
        data-testid="hero-pick"
        :data-posture="h.posture"
        :data-playstyle="heroPlaystyleTags(h).join(',')"
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
        <!-- POSTURE, not role. The filter above these cards is by posture, so
             labelling each card with its role meant filtering to HOLD produced
             a grid of cards reading TANK / SUPPORT — the vocabulary you filtered
             by never appeared on the thing you filtered. Role stays a secondary
             label on the detail header, where it has context. -->
        <span class="text-[0.58rem] uppercase tracking-wider opacity-70">{{ h.posture }}</span>
        <span
          v-if="h.difficulty === 'easy'"
          class="text-[0.52rem] uppercase tracking-wider text-chaff"
          data-testid="hero-beginner-badge"
          >beginner</span
        >
      </button>
    </div>

    <div class="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
      <!-- Kit -->
      <section class="flex flex-col gap-2">
        <div class="flex items-baseline gap-2 border-b border-border pb-1">
          <h2 class="text-[0.95rem] font-bold text-text-primary">
            {{ CAST[selectedId as HeroId].realName }}
          </h2>
          <span class="text-[0.65rem] text-text-dim">`{{ selectedId }}`</span>
          <span class="text-[0.65rem] uppercase tracking-widest text-chaff">{{
            hero.posture
          }}</span>
          <span class="text-[0.62rem] uppercase tracking-widest text-text-dim">{{
            hero.role
          }}</span>
          <!-- Reverse funnel: jump to this hero's lore card on /lore. -->
          <NuxtLink
            :to="`/lore#lore-${selectedId}`"
            class="ml-auto text-[0.65rem] text-text-dim no-underline hover:text-chaff"
            :aria-label="`Read ${hero.name}'s lore`"
          >
            &gt; LORE
          </NuxtLink>
        </div>
        <div class="flex flex-wrap gap-x-3 gap-y-1 text-[0.68rem] text-text-dim">
          <span><span class="text-chaff">integ</span> {{ hero.baseStats.integ }}</span>
          <span><span class="text-ability">bw</span> {{ hero.baseStats.bw }}</span>
          <span><span class="text-gold">atk</span> {{ hero.baseStats.attack }}</span>
          <span>plate {{ hero.baseStats.plate }}</span>
          <span>ice {{ hero.baseStats.ice }}</span>
          <span
            class="uppercase tracking-wider"
            :class="hero.attackType === 'code' ? 'text-ability' : 'text-gold'"
            data-testid="hero-attack-type"
            >{{ hero.attackType }}</span
          >
        </div>
        <!-- Kit identity at a glance — how this hero plays, beyond its role. -->
        <div class="flex flex-wrap gap-1" data-testid="hero-playstyle">
          <span
            v-for="t in playstyle"
            :key="t"
            class="border border-ability/40 bg-ability/10 px-1.5 py-0.5 text-[0.6rem] uppercase tracking-wider text-ability"
          >
            {{ t }}
          </span>
        </div>
        <p class="text-[0.75rem] italic leading-relaxed text-text-dim">
          {{ CAST[selectedId as HeroId].bio }}
        </p>
        <p class="text-[0.68rem] italic leading-relaxed text-text-dim">
          why the handle: {{ CAST[selectedId as HeroId].handleRationale }}
        </p>

        <!-- How the kit reads as this person -->
        <div class="border border-border bg-bg-secondary p-2.5" data-testid="hero-kit-reading">
          <h3 class="mb-1 text-[0.75rem] font-bold tracking-wide text-chaff">HOW THE KIT READS</h3>
          <p class="text-[0.72rem] leading-relaxed text-text-dim">
            {{ CAST[selectedId as HeroId].kitReading }}
          </p>
        </div>

        <!-- How to play — the decision content a pick screen never has room for -->
        <div class="border border-border bg-bg-secondary p-2.5" data-testid="hero-how-to-play">
          <div class="mb-1.5 flex flex-wrap items-center gap-2">
            <span class="text-[0.75rem] font-bold tracking-wide text-gold">HOW TO PLAY</span>
            <span
              class="border px-1.5 py-0.5 text-[0.58rem] uppercase tracking-wider"
              :class="DIFFICULTY_META[hero.difficulty].class"
              data-testid="hero-difficulty"
            >
              {{ DIFFICULTY_META[hero.difficulty].label }}
            </span>
          </div>
          <div class="flex flex-wrap items-center gap-1.5" data-testid="hero-opening-combo">
            <span class="text-[0.6rem] uppercase tracking-wider text-text-muted">opening</span>
            <template v-for="(step, i) in openingCombo" :key="i">
              <span v-if="i > 0" class="text-[0.7rem] text-text-dim">&rarr;</span>
              <span
                class="border px-1.5 py-0.5 text-[0.65rem]"
                :class="
                  step.locked
                    ? 'border-border text-text-muted line-through'
                    : 'border-ability/40 text-ability'
                "
              >
                {{ step.slot.toUpperCase() }} {{ step.name }}
              </span>
            </template>
          </div>
          <p class="mt-1.5 text-[0.75rem] leading-relaxed text-text-dim" data-testid="hero-tip">
            {{ hero.oneLineTip }}
          </p>
        </div>

        <AbilitySlot slot-key="◆" :ability="hero.passive" class="mt-1" />
        <div v-for="s in SLOTS" :key="s" :class="isLocked(s) ? 'opacity-60' : ''">
          <!-- Rank/lock line sits ABOVE the slot: the console now simulates a
               chosen hero level, and an ultimate the hero cannot cast yet has to
               look locked rather than merely unaffordable. -->
          <div class="flex items-baseline justify-between px-0.5 text-[0.58rem] tracking-wider">
            <span class="uppercase text-text-muted">rank {{ rankOf(s) }}/{{ maxRankFor(s) }}</span>
            <span v-if="isLocked(s)" class="uppercase text-warn" :data-testid="`ability-lock-${s}`"
              >locked · level {{ unlockLevelFor(s) }}</span
            >
          </div>
          <AbilitySlot
            :slot-key="s.toUpperCase()"
            :ability="hero.abilities[s]"
            :cooldown-remaining="cooldowns[s]"
            :bw-available="bw"
            :bw-cost="getAbilityBwCost(hero.abilities[s], s, level)"
            interactive
            @cast="cast(s)"
          />
        </div>
        <p class="text-[0.6rem] text-text-dim">
          Click a slot or press Q / W / E / R to cast — or C for the opening combo.
        </p>

        <!-- Talents: the match's only permanent build choice, previously shown
             for the first time mid-fight on the 4-second clock. -->
        <div v-if="talentTree" class="mt-2 flex flex-col gap-2" data-testid="hero-talents">
          <div class="border-b border-border pb-1">
            <h3 class="text-[0.85rem] font-bold tracking-wide text-gold">TALENTS</h3>
            <p class="text-[0.7rem] leading-relaxed text-text-dim">
              Each tier is one permanent choice. Pick a side with
              <span class="text-ability">talent &lt;tier&gt; &lt;left|right&gt;</span> and the other
              side is gone for the rest of the match — there is no respec.
            </p>
          </div>
          <div v-for="t in TALENT_TIERS" :key="t" class="flex flex-col gap-1">
            <div class="text-[0.6rem] uppercase tracking-wider text-text-muted">
              tier {{ t }} · unlocks at level {{ talentUnlockLevel(t) }}
            </div>
            <div class="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              <div
                v-for="(talent, i) in talentTree.tiers[t]"
                :key="talent.id"
                class="border border-border bg-bg-secondary p-2"
              >
                <div class="flex items-baseline gap-1.5">
                  <span class="text-[0.58rem] uppercase tracking-wider text-ability">{{
                    i === 0 ? 'left' : 'right'
                  }}</span>
                  <span class="text-[0.75rem] font-bold text-text-primary">{{ talent.name }}</span>
                </div>
                <p class="text-[0.7rem] leading-snug text-text-dim">{{ talent.description }}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Console -->
      <section class="flex flex-col gap-2">
        <!-- Hero level drives what the console will even let you cast. Without
             it the tool taught a rotation nobody can perform: R at level 1. -->
        <div
          class="flex flex-wrap items-center gap-1.5"
          role="group"
          aria-label="Simulate a hero level"
        >
          <span class="text-[0.6rem] uppercase tracking-wider text-text-muted">level</span>
          <button
            v-for="l in CONSOLE_LEVELS"
            :key="l"
            type="button"
            :data-testid="`console-level-${l}`"
            :aria-pressed="l === level"
            class="border px-2 py-0.5 text-[0.65rem] tracking-wider transition-colors"
            :class="
              l === level
                ? 'border-ability bg-ability/10 text-ability'
                : 'border-border text-text-dim hover:border-border-glow hover:text-text-primary'
            "
            @click="level = l"
          >
            {{ l }}
          </button>
          <span class="text-[0.6rem] text-text-dim">changing level resets the console</span>
        </div>

        <div class="flex flex-col gap-1 border border-border p-2.5">
          <div class="flex items-center justify-between text-[0.7rem] text-text-dim">
            <span><span class="text-ability">bw</span> {{ bw }} / {{ maxBw }}</span>
            <span>cycle {{ cycle }}</span>
          </div>
          <div class="h-1.5 w-full bg-bg-secondary">
            <div class="h-full bg-ability transition-all" :style="{ width: `${bwPct}%` }" />
          </div>
          <!-- Output tally — lets a learner compare each kit's burst at a glance. -->
          <div class="flex items-center justify-between text-[0.7rem] text-text-dim">
            <span
              ><span class="text-audit">dmg dealt</span> {{ totalDamage.toLocaleString() }}</span
            >
            <span>{{ castCount }} cast{{ castCount === 1 ? '' : 's' }}</span>
          </div>
          <div class="mt-1 flex flex-wrap gap-2">
            <AsciiButton label="CAST COMBO (C)" variant="primary" @click="castCombo" />
            <AsciiButton label="ADVANCE CYCLE (4s)" @click="advanceCycle" />
            <AsciiButton label="RESET" variant="ghost" @click="reset" />
          </div>
          <p class="text-[0.6rem] leading-snug text-text-dim" data-testid="console-refill-note">
            Each cycle refills BW so the sandbox can't lock up. Heroes have no innate regen in a
            real match — the fountain, items and the regen cache are the only recovery.
            <NuxtLink to="/learn" class="text-ability no-underline hover:underline"
              >See Sustain</NuxtLink
            >.
          </p>
        </div>

        <TargetDummy
          :name="DUMMY_NAME"
          :integ="dummyHp"
          :max-integ="dummyMax"
          :dots="dots.length"
          :statuses="statuses"
        />
        <p class="text-[0.6rem] leading-snug text-text-dim">
          Impact shows each ability's rank-1 base values — no armor, ice or amp, and no per-rank
          scaling. A feel for each kit, not a combat sim.
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
                ? 'text-audit'
                : line.startsWith('—')
                  ? 'text-text-dim'
                  : line.startsWith('>')
                    ? 'text-chaff'
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
          :label="startingTutorial ? 'STARTING…' : `PRACTICE AS ${hero.name.toUpperCase()}`"
          :disabled="startingTutorial"
          variant="primary"
          data-testid="start-tutorial"
          @click="() => startTutorial(selectedId)"
        />
        <NuxtLink to="/lobby" class="no-underline">
          <AsciiButton label="ENTER THE TERMINAL" variant="ghost" />
        </NuxtLink>
      </div>
      <InlineError :message="tutorialError" />
    </footer>
  </div>
</template>
