<script setup lang="ts">
import type { ItemDef, ItemCategoryId } from '~~/shared/types/items'
import { ITEMS } from '~~/shared/constants/items'
import { SAMPLE_ITEMS } from '~/stories/fixtures'
import ItemShop from './ItemShop.vue'

interface ShopItem {
  id: string
  name: string
  cost: number
  def: ItemDef
  category: ItemCategoryId
}

/** Build a ShopItem from a real item id (the def carries name/cost/stats). */
function shopItem(id: string, category: ItemCategoryId): ShopItem {
  const def = ITEMS[id]!
  return { id, name: def.name, cost: def.cost, def, category }
}

// A realistic shop spread: cheap street goods, big hardware, consumables —
// mixing stat-only, active, and passive defs so the cards show every facet.
const items: ShopItem[] = [
  shopItem(SAMPLE_ITEMS.branch, 'street'),
  shopItem(SAMPLE_ITEMS.salve, 'street'),
  shopItem(SAMPLE_ITEMS.blades, 'street'),
  shopItem(SAMPLE_ITEMS.treads, 'street'),
  shopItem(SAMPLE_ITEMS.rust_driver, 'hardware'),
  shopItem(SAMPLE_ITEMS.killshot_coil, 'hardware'),
  shopItem(SAMPLE_ITEMS.bkb, 'chrome'),
  shopItem(SAMPLE_ITEMS.forceStaff, 'wetware'),
  shopItem(SAMPLE_ITEMS.blink, 'wetware'),
  shopItem(SAMPLE_ITEMS.camtapWard, 'street'),
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
          :pinned-items="[SAMPLE_ITEMS.killshot_coil, SAMPLE_ITEMS.bkb]"
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
          :recommended-items="[SAMPLE_ITEMS.bkb, SAMPLE_ITEMS.blink, SAMPLE_ITEMS.killshot_coil]"
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
