import { ref, computed } from 'vue'
import type { ItemDef } from '~~/shared/types/items'

/**
 * Item loadout sandbox state for the /items reference page: a capped, toggleable
 * set of items the player stacks to preview a build. Extracted from the page so
 * the add/remove/cap rules are unit-tested (the page itself is cairntrace-only),
 * mirroring useStartTutorial — logic → composable → unit test.
 */
export function useLoadout(maxSlots: number) {
  const items = ref<ItemDef[]>([])

  const isFull = computed(() => items.value.length >= maxSlots)

  function isSelected(id: string) {
    return items.value.some((i) => i.id === id)
  }

  /** Add the item, or remove it if already in the build. No-ops at capacity. */
  function toggle(item: ItemDef) {
    const idx = items.value.findIndex((i) => i.id === item.id)
    if (idx >= 0) items.value.splice(idx, 1)
    else if (!isFull.value) items.value.push(item)
  }

  function clear() {
    items.value = []
  }

  return { items, isFull, isSelected, toggle, clear }
}
