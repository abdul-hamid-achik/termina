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
    i => i.name.toLowerCase().includes(q) || i.stats.toLowerCase().includes(q),
  )
})
</script>

<template>
  <div class="item-shop">
    <div class="shop-search">
      <span class="shop-search__prompt">&gt;</span>
      <input
        v-model="search"
        class="shop-search__input"
        placeholder="search items..."
        spellcheck="false"
      >
    </div>

    <div class="shop-grid">
      <div
        v-for="item in filtered"
        :key="item.id"
        class="shop-item"
        :class="{
          'shop-item--affordable': item.cost <= gold,
          'shop-item--too-expensive': item.cost > gold,
        }"
        @click="item.cost <= gold && emit('buy', item.id)"
      >
        <div class="shop-item__name">{{ item.name }}</div>
        <div class="shop-item__stats">{{ item.stats }}</div>
        <div class="shop-item__footer">
          <span class="shop-item__cost">{{ item.cost }}g</span>
          <span v-if="item.cost <= gold" class="shop-item__buy">[BUY]</span>
        </div>
      </div>
    </div>

    <div v-if="!filtered.length" class="shop-empty">
      No items found.
    </div>
  </div>
</template>

<style scoped>
.item-shop {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.shop-search {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--border-color);
}

.shop-search__prompt {
  color: var(--color-gold);
  font-weight: 700;
}

.shop-search__input {
  flex: 1;
  background: transparent;
  border: none;
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 0.8rem;
  outline: none;
}

.shop-search__input::placeholder {
  color: var(--text-dim);
  opacity: 0.5;
}

.shop-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 4px;
}

.shop-item {
  padding: 6px 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-secondary);
  font-size: 0.75rem;
  cursor: pointer;
  transition: border-color 0.15s;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.shop-item:hover {
  border-color: var(--color-gold);
}

.shop-item--affordable {
  border-color: var(--border-glow);
}

.shop-item--too-expensive {
  opacity: 0.5;
  cursor: not-allowed;
}

.shop-item__name {
  color: var(--text-primary);
  font-weight: 700;
}

.shop-item__stats {
  color: var(--text-dim);
  font-size: 0.7rem;
}

.shop-item__footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 2px;
}

.shop-item__cost {
  color: var(--color-gold);
}

.shop-item__buy {
  color: var(--color-radiant);
  font-size: 0.7rem;
}

.shop-empty {
  color: var(--text-dim);
  font-size: 0.8rem;
  padding: 8px;
}
</style>
