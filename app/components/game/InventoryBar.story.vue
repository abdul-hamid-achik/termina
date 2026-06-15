<script setup lang="ts">
import type { BuffState } from '~~/shared/types/game'
import { SAMPLE_ITEMS, SAMPLE_INVENTORY } from '~/stories/fixtures'
import InventoryBar from './InventoryBar.vue'

const empty: (string | null)[] = [null, null, null, null, null, null]

// blades_of_attack (stats-only / passive), healing_salve + force_staff have actives.
const mixed: (string | null)[] = [
  SAMPLE_ITEMS.salve,
  SAMPLE_ITEMS.forceStaff,
  SAMPLE_ITEMS.blades,
  null,
  null,
  null,
]

// An item cooldown is expressed as a buff `item_cd_<itemId>` with ticksRemaining.
const onCooldownBuffs: BuffState[] = [
  { id: `item_cd_${SAMPLE_ITEMS.salve}`, stacks: 1, ticksRemaining: 3, source: 'item' },
]

const noBuffs: BuffState[] = []
</script>

<template>
  <Story title="Game/InventoryBar">
    <Variant title="empty">
      <div class="bg-bg-primary p-3" style="width: 560px">
        <InventoryBar :items="empty" :buffs="noBuffs" />
      </div>
    </Variant>

    <Variant title="active + passive items">
      <div class="bg-bg-primary p-3" style="width: 560px">
        <InventoryBar :items="mixed" :buffs="noBuffs" />
      </div>
    </Variant>

    <Variant title="item on cooldown">
      <div class="bg-bg-primary p-3" style="width: 560px">
        <InventoryBar :items="mixed" :buffs="onCooldownBuffs" />
      </div>
    </Variant>

    <Variant title="full 6-slot build">
      <div class="bg-bg-primary p-3" style="width: 560px">
        <InventoryBar :items="SAMPLE_INVENTORY" :buffs="noBuffs" />
      </div>
    </Variant>
  </Story>
</template>
