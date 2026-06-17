<script setup lang="ts">
import type { ItemDef } from '~~/shared/types/items'
import { ITEMS } from '~~/shared/constants/items'
import { SAMPLE_ITEMS } from '~/stories/fixtures'
import ItemShop from './ItemShop.vue'

type Category = 'starter' | 'core' | 'consumable'

interface ShopItem {
  id: string
  name: string
  cost: number
  def: ItemDef
  category: Category
}

/** Build a ShopItem from a real item id (the def carries name/cost/stats). */
function shopItem(id: string, category: Category): ShopItem {
  const def = ITEMS[id]!
  return { id, name: def.name, cost: def.cost, def, category }
}

// A realistic shop spread: cheap starters, expensive core items, consumables —
// mixing stat-only, active, and passive defs so the cards show every facet.
const items: ShopItem[] = [
  shopItem(SAMPLE_ITEMS.branch, 'starter'),
  shopItem(SAMPLE_ITEMS.salve, 'consumable'),
  shopItem(SAMPLE_ITEMS.blades, 'starter'),
  shopItem(SAMPLE_ITEMS.treads, 'core'),
  shopItem(SAMPLE_ITEMS.desolator, 'core'),
  shopItem(SAMPLE_ITEMS.daedalus, 'core'),
  shopItem(SAMPLE_ITEMS.bkb, 'core'),
  shopItem(SAMPLE_ITEMS.forceStaff, 'core'),
  shopItem(SAMPLE_ITEMS.blink, 'core'),
  shopItem(SAMPLE_ITEMS.observerWard, 'consumable'),
]

const ownedNone: (string | null)[] = [null, null, null, null, null, null]
</script>

<template>
  <Story title="Game/ItemShop">
    <!-- Plenty of gold: most items affordable, [BUY] visible on affordable cards. -->
    <Variant title="rich (most affordable)">
      <div class="bg-bg-primary p-3" style="width: 520px">
        <ItemShop :items="items" :gold="9000" :owned-items="ownedNone" :pinned-items="[]" />
      </div>
    </Variant>

    <!-- Low gold: expensive cores dim out and lose their [BUY] button. -->
    <Variant title="poor (most unaffordable)">
      <div class="bg-bg-primary p-3" style="width: 520px">
        <ItemShop :items="items" :gold="200" :owned-items="ownedNone" :pinned-items="[]" />
      </div>
    </Variant>

    <!-- Owned + pinned states layered on top of affordability. -->
    <Variant title="owned + pinned">
      <div class="bg-bg-primary p-3" style="width: 520px">
        <ItemShop
          :items="items"
          :gold="9000"
          :owned-items="[SAMPLE_ITEMS.treads, SAMPLE_ITEMS.blades, null, null, null, null]"
          :pinned-items="[SAMPLE_ITEMS.daedalus, SAMPLE_ITEMS.bkb]"
        />
      </div>
    </Variant>

    <!-- Role recommendations: ★ badges on the picks + a leading "★ FOR YOU" tab. -->
    <Variant title="role recommendations (★ for you)">
      <div class="bg-bg-primary p-3" style="width: 520px">
        <ItemShop
          :items="items"
          :gold="9000"
          :owned-items="ownedNone"
          :pinned-items="[]"
          :recommended-items="[SAMPLE_ITEMS.bkb, SAMPLE_ITEMS.blink, SAMPLE_ITEMS.daedalus]"
        />
      </div>
    </Variant>

    <!-- No items to show (e.g. a filter that matched nothing). -->
    <Variant title="empty">
      <div class="bg-bg-primary p-3" style="width: 520px">
        <ItemShop :items="[]" :gold="9000" :owned-items="ownedNone" :pinned-items="[]" />
      </div>
    </Variant>
  </Story>
</template>
