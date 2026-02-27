<script setup lang="ts">
import { ref, computed } from 'vue'

interface ShopItem {
  id: string
  name: string
  cost: number
  stats: string
}

const props = defineProps<{
  items: ShopItem[]
  gold: number
}>()

const emit = defineEmits<{
  buy: [itemId: string]
}>()

const search = ref('')

const filtered = computed(() => {
  const q = search.value.toLowerCase()
  if (!q) return props.items
  return props.items.filter(
    (i) => i.name.toLowerCase().includes(q) || i.stats.toLowerCase().includes(q),
  )
})
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex items-center gap-1.5 border-b border-border px-2 py-1">
      <span class="font-bold text-gold">&gt;</span>
      <input
        v-model="search"
        class="flex-1 border-none bg-transparent font-mono text-[0.8rem] text-text-primary outline-none placeholder:text-text-dim placeholder:opacity-50"
        placeholder="search items..."
        spellcheck="false"
      >
    </div>

    <div class="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-1">
      <div
        v-for="item in filtered"
        :key="item.id"
        class="flex cursor-pointer flex-col gap-0.5 border bg-bg-secondary p-1.5 text-xs transition-[border-color] duration-150 hover:border-gold"
        :class="{
          'border-border-glow': item.cost <= gold,
          'border-border cursor-not-allowed opacity-50': item.cost > gold,
        }"
        @click="item.cost <= gold && emit('buy', item.id)"
      >
        <div class="font-bold text-text-primary">{{ item.name }}</div>
        <div class="text-[0.7rem] text-text-dim">{{ item.stats }}</div>
        <div class="mt-0.5 flex items-center justify-between">
          <span class="text-gold">{{ item.cost }}g</span>
          <span v-if="item.cost <= gold" class="text-[0.7rem] text-radiant">[BUY]</span>
        </div>
      </div>
    </div>

    <div v-if="!filtered.length" class="p-2 text-[0.8rem] text-text-dim">No items found.</div>
  </div>
</template>
