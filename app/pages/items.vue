<script setup lang="ts">
import { ITEMS, ITEM_CATEGORIES } from '~~/shared/constants/items'
import type { ItemCategoryId } from '~~/shared/types/items'
import type { HeroRole } from '~~/shared/types/hero'
import { recommendedItemsForRole } from '~~/shared/constants/itemBuilds'
import { browseSections } from '~~/shared/itemFormat'
import ItemCard from '~/components/items/ItemCard.vue'
import LoadoutSummary from '~/components/items/LoadoutSummary.vue'
import { useStartTutorial } from '~/composables/useStartTutorial'
import { useLoadout } from '~/composables/useLoadout'
import { ROLE_LABELS } from '~~/shared/constants/world'

useHead({ title: 'Items · TERMINA' })

const MAX_SLOTS = 6

type Filter = ItemCategoryId | 'all'
const activeCategory = ref<Filter>('all')
const search = ref('')
const query = computed(() => search.value.trim())

// Visible sections = the selected category (or all), each filtered by the search
// box and sorted cheapest-first; empty sections drop out. Logic lives in the
// unit-tested browseSections helper.
const visibleSections = computed(() =>
  browseSections(ITEM_CATEGORIES, ITEMS, activeCategory.value, query.value),
)

// Build guidance, from the SAME ROLE_BUILD_ORDERS the bot AI buys from and the
// in-match shop recommends — it was only ever readable mid-match, which is the
// one moment a player has no time to read it. The list is cost-ascending, so
// its order is the buy order and the running total is what you save toward.
const BUILD_ROLES: HeroRole[] = ['carry', 'mage', 'assassin', 'tank', 'support', 'offlaner']
const buildRole = ref<HeroRole>(BUILD_ROLES[0]!)
const recommendedBuild = computed(() => {
  let running = 0
  return recommendedItemsForRole(buildRole.value)
    .map((id) => ITEMS[id])
    .filter((it) => it !== undefined)
    .map((it, i) => {
      running += it.cost
      return { step: i + 1, item: it, running }
    })
})
/** Position in the build order (1-based), or 0 for items outside it. */
function buildStep(itemId: string): number {
  return recommendedBuild.value.find((s) => s.item.id === itemId)?.step ?? 0
}

// Loadout sandbox: click items to stack up to a full inventory and see what
// stats, cost and actives the build adds up to — itemization, made tangible.
// Add/remove/cap rules live in the unit-tested useLoadout composable.
const {
  items: loadout,
  isFull,
  isSelected,
  toggle: toggleItem,
  clear: clearLoadout,
} = useLoadout(MAX_SLOTS)

const {
  starting: startingTutorial,
  error: tutorialError,
  start: startTutorial,
} = useStartTutorial()
</script>

<template>
  <div class="mx-auto mt-4 flex max-w-[1100px] flex-col gap-4 pb-10">
    <header class="border-b border-border pb-2">
      <h1 class="text-lg font-bold tracking-widest text-chaff">&gt;_ ITEM SHOP</h1>
      <p class="mt-1 text-[0.78rem] text-text-dim">
        Every item, by category. Click items to stack a build and watch the stats, scrip and actives
        add up — learn what to buy before you queue.
      </p>
    </header>

    <!-- Recommended build — the canonical per-role order, out of the match -->
    <section class="flex flex-col gap-2 border border-border bg-bg-secondary p-2.5">
      <div class="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 class="text-[0.9rem] font-bold tracking-wide text-gold">RECOMMENDED BUILD</h2>
        <p class="text-[0.7rem] text-text-dim">
          What the bots buy and what the in-game shop recommends — buy in this order, saving for the
          next core rather than filling slots.
        </p>
      </div>
      <div class="flex flex-wrap gap-1.5" role="group" aria-label="Recommended build by role">
        <button
          v-for="r in BUILD_ROLES"
          :key="r"
          type="button"
          class="border px-2 py-0.5 text-[0.68rem] uppercase tracking-wider transition-colors"
          :class="
            buildRole === r
              ? 'border-gold bg-gold/10 text-gold'
              : 'border-border text-text-dim hover:border-border-glow hover:text-text-primary'
          "
          :aria-pressed="buildRole === r"
          :data-testid="`build-role-${r}`"
          @click="buildRole = r"
        >
          {{ ROLE_LABELS[r] }}
        </button>
      </div>

      <ol class="flex flex-wrap items-stretch gap-1.5" data-testid="build-order">
        <li
          v-for="s in recommendedBuild"
          :key="s.item.id"
          class="flex min-w-[8.5rem] flex-1 flex-col border border-border bg-bg-primary px-2 py-1"
        >
          <span class="text-[0.6rem] uppercase tracking-wider text-text-muted">
            {{ s.step }}. {{ s.item.cost }}sc
          </span>
          <span class="text-[0.75rem] font-bold text-text-primary">{{ s.item.name }}</span>
          <span class="text-[0.62rem] text-gold">{{ s.running }}sc total</span>
        </li>
      </ol>
    </section>

    <!-- Controls: category filter + search -->
    <div class="flex flex-col gap-2">
      <div class="flex flex-wrap gap-1.5">
        <button
          type="button"
          class="border px-2 py-1 text-[0.7rem] uppercase tracking-wider transition-colors"
          :class="
            activeCategory === 'all'
              ? 'border-ability bg-ability/10 text-ability'
              : 'border-border text-text-dim hover:border-border-glow hover:text-text-primary'
          "
          :aria-pressed="activeCategory === 'all'"
          data-testid="item-category-all"
          @click="activeCategory = 'all'"
        >
          All
        </button>
        <button
          v-for="c in ITEM_CATEGORIES"
          :key="c.id"
          type="button"
          class="border px-2 py-1 text-[0.7rem] uppercase tracking-wider transition-colors"
          :class="
            activeCategory === c.id
              ? 'border-ability bg-ability/10 text-ability'
              : 'border-border text-text-dim hover:border-border-glow hover:text-text-primary'
          "
          :aria-pressed="activeCategory === c.id"
          :data-testid="`item-category-${c.id}`"
          @click="activeCategory = c.id"
        >
          {{ c.label }}
        </button>
      </div>
      <div class="flex items-center gap-2 border border-border bg-bg-secondary px-2 py-1">
        <span class="text-[0.75rem] text-gold">&gt;</span>
        <input
          v-model="search"
          type="search"
          aria-label="Search items"
          placeholder="search items…"
          class="w-full bg-transparent text-[0.78rem] text-text-primary placeholder:text-text-dim focus:outline-none"
          data-testid="item-search"
        />
      </div>
    </div>

    <div class="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]">
      <!-- Catalogue -->
      <div class="flex flex-col gap-5">
        <section v-for="c in visibleSections" :key="c.id" class="flex flex-col gap-2">
          <div class="border-b border-border pb-1">
            <h2 class="text-[0.9rem] font-bold tracking-wide text-ability">{{ c.label }}</h2>
            <p class="text-[0.7rem] text-text-dim">{{ c.blurb }}</p>
          </div>
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div v-for="it in c.items" :key="it.id" class="flex flex-col">
              <!-- Ties the catalogue back to the strip above: a card the chosen
                   role should buy says so, and says when. -->
              <span
                v-if="buildStep(it.id)"
                class="self-start border border-gold/50 bg-gold/10 px-1.5 py-0.5 text-[0.55rem] uppercase tracking-wider text-gold"
                :data-testid="`build-badge-${it.id}`"
              >
                {{ buildRole }} core #{{ buildStep(it.id) }}
              </span>
              <ItemCard
                :item="it"
                interactive
                :selected="isSelected(it.id)"
                :disabled="isFull && !isSelected(it.id)"
                @toggle="toggleItem(it)"
              />
            </div>
          </div>
        </section>
        <p v-if="visibleSections.length === 0" class="text-[0.78rem] italic text-text-dim">
          No items match "{{ query }}".
        </p>
        <p class="text-[0.62rem] italic text-text-dim">
          Note: Move Speed is currently cosmetic — movement is a fixed one zone per cycle.
        </p>
      </div>

      <!-- Loadout sidebar -->
      <aside class="flex flex-col gap-3 lg:sticky lg:top-4 lg:self-start">
        <LoadoutSummary :items="loadout" :max-slots="MAX_SLOTS" @clear="clearLoadout" />

        <footer class="flex flex-col items-stretch gap-2 border-t border-border pt-3 text-center">
          <p class="text-[0.72rem] text-text-dim">Got a build in mind? Try it out.</p>
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
        </footer>
        <InlineError :message="tutorialError" />
      </aside>
    </div>
  </div>
</template>
