<script setup lang="ts">
import { HEROES } from '~~/shared/constants/heroes'
import type { HeroId } from '~~/shared/types/hero'
import { abilitySummary } from '~~/shared/abilityFormat'
import AbilitySlot from '~/components/heroes/AbilitySlot.vue'

useHead({ title: 'Heroes · TERMINA' })

const allHeroes = Object.values(HEROES)

type Slot = 'q' | 'w' | 'e' | 'r'
const SLOTS: Slot[] = ['q', 'w', 'e', 'r']

const selectedId = ref<HeroId>('echo')
// selectedId is always a valid HeroId, but noUncheckedIndexedAccess widens the
// lookup to `| undefined` — assert since the key is guaranteed present.
const hero = computed(() => HEROES[selectedId.value]!)

// Mock training-console state — a safe, offline dry-run of the cast interface
// (real ability data, real cooldowns/mana, on the same 4s scheduler tick).
const mana = ref(0)
const cooldowns = reactive<Record<Slot, number>>({ q: 0, w: 0, e: 0, r: 0 })
const tick = ref(0)
const log = ref<string[]>([])

function pushLog(...lines: string[]) {
  log.value.push(...lines)
  if (log.value.length > 50) log.value = log.value.slice(-50)
}

function reset() {
  mana.value = hero.value.baseStats.mp
  for (const s of SLOTS) cooldowns[s] = 0
  tick.value = 0
  log.value = [`>_ ${hero.value.name} loaded — click an ability or press Q/W/E/R to cast.`]
}
watch(selectedId, reset, { immediate: true })

function cast(slot: Slot) {
  const ab = hero.value.abilities[slot]
  if (cooldowns[slot] > 0) {
    pushLog(`! ${ab.name} on cooldown (${cooldowns[slot]}t left)`)
    return
  }
  if (mana.value < ab.manaCost) {
    pushLog(`! not enough mana for ${ab.name} (need ${ab.manaCost}, have ${mana.value})`)
    return
  }
  mana.value -= ab.manaCost
  cooldowns[slot] = ab.cooldownTicks
  pushLog(`> cast ${slot}`, `  ${hero.value.name} casts ${ab.name} — ${abilitySummary(ab)}`)
}

function advanceTick() {
  tick.value++
  for (const s of SLOTS) if (cooldowns[s] > 0) cooldowns[s]--
  const regen = Math.max(2, Math.round(hero.value.baseStats.mp * 0.05))
  mana.value = Math.min(hero.value.baseStats.mp, mana.value + regen)
  pushLog(`— scheduler tick ${tick.value}  (+${regen} mp · cooldowns −1)`)
}

function onKey(e: KeyboardEvent) {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
  const k = e.key.toLowerCase()
  if ((SLOTS as string[]).includes(k)) {
    e.preventDefault()
    cast(k as Slot)
  }
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

const manaPct = computed(() =>
  hero.value.baseStats.mp ? Math.round((mana.value / hero.value.baseStats.mp) * 100) : 0,
)
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

    <!-- Hero selector -->
    <div class="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
      <button
        v-for="h in allHeroes"
        :key="h.id"
        type="button"
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
          <div class="mt-1 flex gap-2">
            <AsciiButton label="ADVANCE TICK (4s)" @click="advanceTick" />
            <AsciiButton label="RESET" variant="ghost" @click="reset" />
          </div>
        </div>

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
  </div>
</template>
