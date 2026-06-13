<script setup lang="ts">
import { computed } from 'vue'
import { ITEMS } from '~~/shared/constants/items'
import type { ItemDef } from '~~/shared/types/items'
import type { BuffState } from '~~/shared/types/game'
import { useTapInspect } from '~/composables/useTapInspect'

const props = defineProps<{
  items: (string | null)[]
  buffs: BuffState[]
}>()

const emit = defineEmits<{
  use: [slotIndex: number, itemId: string]
}>()

interface SlotView {
  index: number
  itemId: string | null
  def: ItemDef | null
  cooldown: number
}

const {
  isCoarse: isCoarsePointer,
  isOpen,
  interceptActivate,
  hoverEnter,
  hoverLeave,
  dismiss,
  registerEl,
} = useTapInspect()

function getItemCooldown(itemId: string): number {
  const cdBuff = props.buffs.find((b) => b.id === `item_cd_${itemId}`)
  return cdBuff?.ticksRemaining ?? 0
}

const slots = computed<SlotView[]>(() => {
  return Array.from({ length: 6 }, (_, i) => {
    const itemId = props.items[i] ?? null
    const def = itemId ? (ITEMS[itemId] ?? null) : null
    const cooldown = itemId ? getItemCooldown(itemId) : 0
    return { index: i, itemId, def, cooldown }
  })
})

function abbreviate(name: string): string {
  if (name.length <= 8) return name
  return name
    .split(' ')
    .map((w) => w[0]!.toUpperCase())
    .join('')
}

function slotKey(index: number): string {
  return `slot-${index}`
}

function useItem(slot: SlotView) {
  if (!slot.itemId || !slot.def) return
  if (!slot.def.active) return
  if (slot.cooldown > 0) return
  emit('use', slot.index, slot.itemId)
}

function onSlotTap(slot: SlotView) {
  // Empty slots have nothing to inspect or use
  if (!slot.def) return
  // On coarse pointers the first tap opens the inspection tooltip instead
  // of using the item — using requires the explicit [USE] button inside it.
  if (!interceptActivate(slotKey(slot.index))) return
  useItem(slot)
}

function confirmUse(slot: SlotView) {
  useItem(slot)
  dismiss()
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
  <div class="flex items-center gap-1">
    <span class="mr-0.5 text-[0.6rem] uppercase tracking-wide text-text-dim">Items</span>
    <div
      v-for="slot in slots"
      :key="slot.index"
      :ref="(el) => registerEl(slotKey(slot.index), el)"
      class="touch-target relative flex h-9 w-16 shrink-0 items-center justify-center border font-mono text-[0.65rem] transition-[border-color] duration-100 select-none"
      :class="[
        slot.itemId
          ? slot.cooldown > 0
            ? 'border-border bg-bg-secondary text-text-dim cursor-not-allowed'
            : slot.def?.active
              ? 'border-ability bg-bg-secondary text-text-primary cursor-pointer hover:bg-ability/10'
              : 'border-border bg-bg-secondary text-text-primary'
          : 'border-dashed border-border bg-transparent text-text-dim',
      ]"
      :data-testid="`inventory-slot-${slot.index}`"
      @click="onSlotTap(slot)"
      @mouseenter="hoverEnter(slotKey(slot.index))"
      @mouseleave="hoverLeave()"
    >
      <!-- Slot key hint -->
      <span class="absolute top-0 left-0.5 text-[0.5rem] text-text-dim">{{ slot.index + 1 }}</span>

      <template v-if="slot.itemId && slot.def">
        <span class="truncate px-0.5 text-center leading-tight">
          {{ abbreviate(slot.def.name) }}
        </span>

        <!-- Cooldown overlay -->
        <div
          v-if="slot.cooldown > 0"
          class="absolute inset-0 flex items-center justify-center bg-black/60"
        >
          <span class="text-xs font-bold text-dire">{{ slot.cooldown }}t</span>
        </div>
      </template>

      <template v-else>
        <span class="text-[0.6rem]">--</span>
      </template>

      <!-- Tooltip (hover on fine pointers, first tap on coarse pointers) -->
      <div
        v-if="isOpen(slotKey(slot.index)) && slot.def"
        class="absolute bottom-full left-1/2 z-50 mb-1.5 w-48 -translate-x-1/2 cursor-default border border-border bg-bg-secondary p-2 text-[0.7rem] shadow-lg"
        :data-testid="`inventory-tooltip-${slot.index}`"
        @click.stop
      >
        <div class="font-bold text-text-primary">{{ slot.def.name }}</div>
        <div class="text-gold">{{ slot.def.cost }}g</div>
        <div v-if="formatStats(slot.def).length" class="mt-1 flex flex-col gap-0.5">
          <span v-for="(stat, si) in formatStats(slot.def)" :key="si" class="text-radiant">{{
            stat
          }}</span>
        </div>
        <div v-if="slot.def.active" class="mt-1 border-t border-border pt-1">
          <span class="text-ability">Active: {{ slot.def.active.name }}</span>
          <div class="text-text-dim">{{ slot.def.active.description }}</div>
          <div v-if="slot.def.active.cooldownTicks" class="text-text-dim">
            CD: <span class="text-text-primary">{{ slot.def.active.cooldownTicks }}t</span>
          </div>
        </div>
        <div v-if="slot.def.passive" class="mt-1 border-t border-border pt-1">
          <span class="text-gold">Passive: {{ slot.def.passive.name }}</span>
          <div class="text-text-dim">{{ slot.def.passive.description }}</div>
        </div>
        <div v-if="slot.def.consumable" class="mt-1 text-[0.6rem] text-text-dim">Consumable</div>

        <!-- Explicit action button on touch: second tap uses the item -->
        <button
          v-if="isCoarsePointer && slot.def.active && slot.cooldown <= 0"
          class="touch-target mt-1.5 w-full cursor-pointer border border-ability bg-transparent px-2 py-1 font-mono text-[0.7rem] text-ability hover:bg-ability/15"
          :data-testid="`inventory-use-${slot.index}`"
          @click.stop="confirmUse(slot)"
        >
          [USE]
        </button>

        <div class="mt-1 text-[0.6rem] text-text-dim">
          <template v-if="slot.def.active && slot.cooldown <= 0 && !isCoarsePointer"
            >[Click or press {{ slot.index + 1 }}]</template
          >
          <template v-else-if="slot.def.active && slot.cooldown > 0"
            >[Cooldown: {{ slot.cooldown }}t]</template
          >
          <template v-else-if="!slot.def.active">[Passive]</template>
        </div>
      </div>
    </div>
  </div>
</template>
