<script setup lang="ts">
import { ref, computed } from 'vue'
import { HEROES } from '~~/shared/constants/heroes'

interface HeroData {
  name: string
  level: number
  zone: string
  hp: number
  maxHp: number
  mp: number
  maxMp: number
  cooldowns: { q: number; w: number; e: number; r: number }
  items: (string | null)[]
  buffs: { id: string; stacks: number; ticksRemaining: number }[]
  gold: number
  alive: boolean
}

const props = defineProps<{
  hero: HeroData
  heroId?: string
}>()

const hoveredAbility = ref<string | null>(null)

const heroDef = computed(() => {
  if (!props.heroId) return null
  return HEROES[props.heroId] ?? null
})

function getAbilityDef(key: 'q' | 'w' | 'e' | 'r') {
  return heroDef.value?.abilities[key] ?? null
}

function cdLabel(cd: number): string {
  return cd <= 0 ? 'RDY' : `${cd}`
}
</script>

<template>
  <div class="flex flex-col gap-2 text-[0.8rem]">
    <div class="flex flex-wrap items-baseline gap-2">
      <span class="text-[0.9rem] font-bold text-self">{{ hero.name }}</span>
      <span class="text-gold">Lv.{{ hero.level }}</span>
      <span class="text-zone">@ {{ hero.zone }}</span>
      <span v-if="!hero.alive" class="font-bold text-dire">[DEAD]</span>
    </div>

    <div class="flex flex-col gap-0.5">
      <div class="flex items-center gap-1.5">
        <span class="w-5 shrink-0 text-text-dim">HP</span>
        <ProgressBar :value="hero.hp" :max="hero.maxHp" color="radiant" :width="16" show-label />
      </div>
      <div class="flex items-center gap-1.5">
        <span class="w-5 shrink-0 text-text-dim">MP</span>
        <ProgressBar :value="hero.mp" :max="hero.maxMp" color="mana" :width="16" show-label />
      </div>
    </div>

    <div class="flex flex-col gap-1">
      <span class="text-[0.7rem] uppercase tracking-wide text-text-dim">Abilities</span>
      <div class="flex flex-wrap gap-1">
        <span
          v-for="key in ['q', 'w', 'e', 'r'] as const"
          :key="key"
          class="relative inline-flex items-center gap-0.5 border px-1.5 py-0.5 text-xs"
          :class="
            hero.cooldowns[key] <= 0 ? 'border-ability text-ability' : 'border-border text-text-dim'
          "
          @mouseenter="hoveredAbility = key"
          @mouseleave="hoveredAbility = null"
        >
          <span class="font-bold">{{ key.toUpperCase() }}</span>
          <span>[{{ cdLabel(hero.cooldowns[key]) }}]</span>

          <!-- Ability tooltip -->
          <div
            v-if="hoveredAbility === key && getAbilityDef(key)"
            class="absolute bottom-full left-0 z-40 mb-1 w-56 border border-border bg-bg-secondary p-2 text-[0.7rem] shadow-lg"
          >
            <div class="font-bold text-ability">{{ getAbilityDef(key)!.name }}</div>
            <div class="mt-0.5 flex gap-2 text-text-dim">
              <span>Mana: <span class="text-mana">{{ getAbilityDef(key)!.manaCost }}</span></span>
              <span>CD: <span class="text-text-primary">{{ getAbilityDef(key)!.cooldownTicks }}t</span></span>
            </div>
            <div class="mt-1 text-text-primary">{{ getAbilityDef(key)!.description }}</div>
            <div v-if="getAbilityDef(key)!.effects.length" class="mt-1 border-t border-border pt-1">
              <div
                v-for="(effect, i) in getAbilityDef(key)!.effects"
                :key="i"
                class="text-text-dim"
              >
                <span class="text-gold">{{ effect.type }}</span>: {{ effect.value
                }}<span v-if="effect.damageType"> ({{ effect.damageType }})</span
                ><span v-if="effect.duration"> / {{ effect.duration }}t</span
                ><span v-if="effect.description"> - {{ effect.description }}</span>
              </div>
            </div>
          </div>
        </span>
      </div>
    </div>

    <div class="flex flex-col gap-1">
      <span class="text-[0.7rem] uppercase tracking-wide text-text-dim">Items</span>
      <div class="flex flex-wrap gap-1">
        <span
          v-for="(item, i) in 6"
          :key="i"
          class="inline-flex items-center border px-2 py-0.5 text-xs"
          :class="hero.items[i] ? 'border-border' : 'border-dashed border-border text-text-dim'"
        >
          {{ hero.items[i] || '[empty]' }}
        </span>
      </div>
    </div>

    <div v-if="hero.buffs.length" class="flex flex-col gap-1">
      <span class="text-[0.7rem] uppercase tracking-wide text-text-dim">Buffs</span>
      <div class="flex flex-wrap gap-2">
        <span v-for="buff in hero.buffs" :key="buff.id" class="text-xs text-ability">
          {{ buff.id
          }}<span v-if="buff.stacks > 1" class="ml-0.5 text-gold">x{{ buff.stacks }}</span>
          <span class="ml-0.5 text-text-dim">({{ buff.ticksRemaining }}t)</span>
        </span>
      </div>
    </div>

    <div class="mt-1 flex items-center gap-1">
      <span class="font-bold text-gold">$</span>
      <span class="text-[0.9rem] font-bold text-gold">{{ hero.gold.toLocaleString() }}</span>
    </div>
  </div>
</template>
