<script setup lang="ts">
import { ref, computed } from 'vue'
import type { ItemDef } from '~~/shared/types/items'

type Category = 'all' | 'starter' | 'core' | 'consumable'

interface ShopItem {
  id: string
  name: string
  cost: number
  def: ItemDef
  category: Category
}

const props = defineProps<{
  items: ShopItem[]
  gold: number
  ownedItems: (string | null)[]
  pinnedItems: string[]
}>()

const emit = defineEmits<{
  buy: [itemId: string]
  pin: [itemId: string]
  unpin: [itemId: string]
}>()

const search = ref('')
const activeTab = ref<Category>('all')

const TABS: { key: Category; label: string }[] = [
  { key: 'all', label: 'ALL' },
  { key: 'starter', label: 'STARTER' },
  { key: 'core', label: 'CORE' },
  { key: 'consumable', label: 'CONSUMABLE' },
]

const filtered = computed(() => {
  let list = props.items
  if (activeTab.value !== 'all') {
    list = list.filter((i) => i.category === activeTab.value)
  }
  const q = search.value.toLowerCase()
  if (q) {
    list = list.filter((i) => i.name.toLowerCase().includes(q))
  }
  return list
})

function isOwned(itemId: string): boolean {
  return props.ownedItems.includes(itemId)
}

function isPinned(itemId: string): boolean {
  return props.pinnedItems.includes(itemId)
}

function togglePin(itemId: string) {
  if (isPinned(itemId)) {
    emit('unpin', itemId)
  } else {
    emit('pin', itemId)
  }
}

function formatStats(def: ItemDef): string[] {
  const lines: string[] = []
  for (const [key, val] of Object.entries(def.stats)) {
    if (val) lines.push(`+${val} ${key}`)
  }
  return lines
}
</script>

<template>
  <div class="flex flex-col gap-2">
    <!-- Category tabs -->
    <div class="flex gap-1 border-b border-border pb-1">
      <button
        v-for="tab in TABS"
        :key="tab.key"
        class="border px-2 py-0.5 font-mono text-[0.7rem] transition-[border-color,color] duration-100"
        :class="[
          activeTab === tab.key
            ? 'border-gold text-gold'
            : 'border-border text-text-dim hover:text-text-primary',
        ]"
        @click="activeTab = tab.key"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- Search -->
    <div class="flex items-center gap-1.5 border-b border-border px-2 py-1">
      <span class="font-bold text-gold">&gt;</span>
      <input
        v-model="search"
        class="flex-1 border-none bg-transparent font-mono text-[0.8rem] text-text-primary outline-none placeholder:text-text-dim placeholder:opacity-50"
        placeholder="search items..."
        spellcheck="false"
      >
    </div>

    <!-- Item grid -->
    <div class="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-1">
      <div
        v-for="item in filtered"
        :key="item.id"
        class="flex flex-col gap-0.5 border p-1.5 text-xs transition-[border-color] duration-150"
        :class="[
          isOwned(item.id)
            ? 'border-radiant bg-radiant/5'
            : item.cost <= gold
              ? 'border-border-glow cursor-pointer hover:border-gold'
              : 'border-border opacity-60',
        ]"
        @click="item.cost <= gold && emit('buy', item.id)"
      >
        <div class="flex items-center justify-between">
          <span class="font-bold text-text-primary">{{ item.name }}</span>
          <span v-if="isOwned(item.id)" class="text-[0.6rem] text-radiant">[OWNED]</span>
        </div>

        <!-- Stats -->
        <div v-if="formatStats(item.def).length" class="flex flex-wrap gap-1">
          <span
            v-for="(stat, si) in formatStats(item.def)"
            :key="si"
            class="text-[0.65rem] text-radiant"
          >{{ stat }}</span>
        </div>

        <!-- Active -->
        <div v-if="item.def.active" class="text-[0.65rem]">
          <span class="text-ability">Active:</span>
          <span class="text-text-dim"> {{ item.def.active.description }}</span>
          <span v-if="item.def.active.cooldownTicks" class="text-text-dim"> ({{ item.def.active.cooldownTicks }}t CD)</span>
        </div>

        <!-- Passive -->
        <div v-if="item.def.passive" class="text-[0.65rem]">
          <span class="text-gold">Passive:</span>
          <span class="text-text-dim"> {{ item.def.passive.description }}</span>
        </div>

        <!-- Footer -->
        <div class="mt-0.5 flex items-center justify-between">
          <span class="text-gold">{{ item.cost }}g</span>
          <div class="flex items-center gap-1">
            <button
              class="text-[0.65rem] transition-colors duration-100"
              :class="isPinned(item.id) ? 'text-gold' : 'text-text-dim hover:text-gold'"
              @click.stop="togglePin(item.id)"
            >
              {{ isPinned(item.id) ? '[PINNED]' : '[PIN]' }}
            </button>
            <span v-if="item.cost <= gold && !isOwned(item.id)" class="text-[0.65rem] text-radiant">[BUY]</span>
          </div>
        </div>
      </div>
    </div>

    <div v-if="!filtered.length" class="p-2 text-[0.8rem] text-text-dim">No items found.</div>
  </div>
</template>
