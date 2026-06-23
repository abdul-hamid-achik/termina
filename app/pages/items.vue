<script setup lang="ts">
import { ITEMS, ITEM_CATEGORIES } from '~~/shared/constants/items'
import type { ItemDef, ItemCategoryId } from '~~/shared/types/items'
import { byCostAscending } from '~~/shared/itemFormat'
import ItemCard from '~/components/items/ItemCard.vue'
import LoadoutSummary from '~/components/items/LoadoutSummary.vue'
import { useStartTutorial } from '~/composables/useStartTutorial'

useHead({ title: 'Items · TERMINA' })

const MAX_SLOTS = 6

type Filter = ItemCategoryId | 'all'
const activeCategory = ref<Filter>('all')
const search = ref('')

// Visible sections = the selected category (or all), each filtered by the search
// box and sorted cheapest-first; empty sections drop out.
const visibleSections = computed(() => {
  const q = search.value.trim().toLowerCase()
  return ITEM_CATEGORIES.filter(
    (c) => activeCategory.value === 'all' || c.id === activeCategory.value,
  )
    .map((c) => ({
      ...c,
      items: byCostAscending(
        c.ids.map((id) => ITEMS[id]!).filter((it) => !q || it.name.toLowerCase().includes(q)),
      ),
    }))
    .filter((c) => c.items.length > 0)
})

// Loadout sandbox: click items to stack up to a full inventory and see what
// stats, cost and actives the build adds up to — itemization, made tangible.
const loadout = ref<ItemDef[]>([])
function isSelected(id: string) {
  return loadout.value.some((i) => i.id === id)
}
function toggleItem(item: ItemDef) {
  const idx = loadout.value.findIndex((i) => i.id === item.id)
  if (idx >= 0) loadout.value.splice(idx, 1)
  else if (loadout.value.length < MAX_SLOTS) loadout.value.push(item)
}
function clearLoadout() {
  loadout.value = []
}

const { starting: startingTutorial, start: startTutorial } = useStartTutorial()
</script>

<template>
  <div class="mx-auto mt-4 flex max-w-[1100px] flex-col gap-4 pb-10">
    <header class="border-b border-border pb-2">
      <h1 class="text-lg font-bold tracking-widest text-radiant">&gt;_ ITEM SHOP</h1>
      <p class="mt-1 text-[0.78rem] text-text-dim">
        Every item, by category. Click items to stack a build and watch the stats, gold and actives
        add up — learn what to buy before you queue.
      </p>
    </header>

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
          type="text"
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
            <ItemCard
              v-for="it in c.items"
              :key="it.id"
              :item="it"
              interactive
              :selected="isSelected(it.id)"
              @toggle="toggleItem(it)"
            />
          </div>
        </section>
        <p v-if="visibleSections.length === 0" class="text-[0.78rem] italic text-text-dim">
          No items match "{{ search }}".
        </p>
        <p class="text-[0.62rem] italic text-text-dim">
          Note: Move Speed is currently cosmetic — movement is a fixed one zone per tick.
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
      </aside>
    </div>
  </div>
</template>
