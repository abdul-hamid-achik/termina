<script setup lang="ts">
import { computed } from 'vue'
import { HEROES } from '~~/shared/constants/heroes'
import { ITEMS } from '~~/shared/constants/items'
import { displayBuffs } from '~/utils/buffs'
import { useTapInspect } from '~/composables/useTapInspect'

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

const emit = defineEmits<{
  castAbility: [ability: 'q' | 'w' | 'e' | 'r']
}>()

const {
  isCoarse: isCoarsePointer,
  isOpen,
  interceptActivate,
  hoverEnter,
  hoverLeave,
  dismiss,
  registerEl,
} = useTapInspect()

const heroDef = computed(() => {
  if (!props.heroId) return null
  return HEROES[props.heroId] ?? null
})

// Readable, colour-coded buff chips with internal bookkeeping markers (item
// cooldowns, tp destination) filtered out — see ~/utils/buffs.
const shownBuffs = computed(() => displayBuffs(props.hero.buffs))

function getAbilityDef(key: 'q' | 'w' | 'e' | 'r') {
  return heroDef.value?.abilities[key] ?? null
}

function cdLabel(cd: number): string {
  return cd <= 0 ? 'RDY' : `${cd}`
}

function onAbilityTap(key: 'q' | 'w' | 'e' | 'r') {
  // On coarse pointers the first tap opens the inspection tooltip instead
  // of casting — casting requires the explicit [CAST] button inside it.
  if (!interceptActivate(key)) return
  if (props.hero.cooldowns[key] <= 0) emit('castAbility', key)
}

function confirmCast(key: 'q' | 'w' | 'e' | 'r') {
  if (props.hero.cooldowns[key] > 0) return
  emit('castAbility', key)
  dismiss()
}
</script>

<template>
  <div class="flex flex-col gap-2 text-[0.8rem]" data-testid="hero-status">
    <div class="flex items-start gap-2">
      <HeroAvatar
        v-if="heroId"
        :hero-id="heroId"
        :size="48"
        :class="{ 'opacity-50': !hero.alive }"
      />
      <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span class="t-h2 text-self text-glow-sm t-mono-num">{{ hero.name }}</span>
        <span class="t-caption text-gold t-mono-num">Lv.{{ hero.level }}</span>
        <span class="t-caption text-zone">@ {{ hero.zone }}</span>
        <span v-if="!hero.alive" class="t-h3 text-dire text-glow anim-glow-pulse">[DEAD]</span>
      </div>
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
      <span class="t-caption uppercase">Abilities</span>
      <div class="flex flex-wrap gap-1.5">
        <span
          v-for="key in ['q', 'w', 'e', 'r'] as const"
          :key="key"
          :ref="(el) => registerEl(key, el)"
          class="touch-target relative inline-flex min-h-[36px] min-w-[44px] cursor-pointer items-center gap-1 border px-2 py-1 text-xs t-mono-num transition-all duration-150"
          :class="
            hero.cooldowns[key] <= 0
              ? 'border-ability text-ability shadow-glow-ability hover:bg-ability/15 hover:shadow-glow-ability-lg hover:scale-[1.06]'
              : 'border-border text-text-muted opacity-70'
          "
          :data-testid="`ability-chip-${key}`"
          @click="onAbilityTap(key)"
          @mouseenter="hoverEnter(key)"
          @mouseleave="hoverLeave()"
        >
          <span class="font-bold" :class="hero.cooldowns[key] <= 0 ? 'text-glow-sm' : ''">{{
            key.toUpperCase()
          }}</span>
          <span>[{{ cdLabel(hero.cooldowns[key]) }}]</span>

          <!-- Ability tooltip -->
          <div
            v-if="isOpen(key) && getAbilityDef(key)"
            class="absolute bottom-full left-0 z-40 mb-1 w-56 cursor-default border border-border bg-bg-secondary p-2 text-[0.7rem] shadow-lg"
            :data-testid="`ability-tooltip-${key}`"
            @click.stop
          >
            <div class="font-bold text-ability">{{ getAbilityDef(key)!.name }}</div>
            <div class="mt-0.5 flex gap-2 text-text-dim">
              <span
                >Mana: <span class="text-mana">{{ getAbilityDef(key)!.manaCost }}</span></span
              >
              <span
                >CD:
                <span class="text-text-primary"
                  >{{ getAbilityDef(key)!.cooldownTicks }}t</span
                ></span
              >
            </div>
            <div class="mt-1 text-text-primary">{{ getAbilityDef(key)!.description }}</div>
            <div v-if="getAbilityDef(key)!.effects.length" class="mt-1 border-t border-border pt-1">
              <div
                v-for="(effect, i) in getAbilityDef(key)!.effects"
                :key="i"
                class="text-text-dim"
              >
                <span class="text-gold">{{ effect.type }}</span
                >: {{ effect.value }}<span v-if="effect.damageType"> ({{ effect.damageType }})</span
                ><span v-if="effect.duration"> / {{ effect.duration }}t</span
                ><span v-if="effect.description"> - {{ effect.description }}</span>
              </div>
            </div>

            <!-- Explicit action button on touch: second tap casts -->
            <div v-if="isCoarsePointer" class="mt-1.5 border-t border-border pt-1.5">
              <button
                v-if="hero.cooldowns[key] <= 0"
                class="touch-target w-full cursor-pointer border border-ability bg-transparent px-2 py-1 font-mono text-[0.7rem] text-ability hover:bg-ability/15"
                :data-testid="`ability-cast-${key}`"
                @click.stop="confirmCast(key)"
              >
                [CAST {{ key.toUpperCase() }} — {{ getAbilityDef(key)!.manaCost }}mp]
              </button>
              <span v-else class="block w-full px-2 py-1 text-center text-text-dim">
                [ON COOLDOWN — {{ hero.cooldowns[key] }}t]
              </span>
            </div>
          </div>
        </span>
      </div>
    </div>

    <div class="flex flex-col gap-1">
      <span class="t-caption uppercase">Items</span>
      <div class="flex flex-wrap gap-1">
        <span
          v-for="(item, i) in 6"
          :key="i"
          class="inline-flex items-center border px-2 py-0.5 text-xs"
          :class="hero.items[i] ? 'border-border' : 'border-dashed border-border text-text-dim'"
        >
          {{ hero.items[i] ? (ITEMS[hero.items[i]!]?.name ?? hero.items[i]) : '[empty]' }}
        </span>
      </div>
    </div>

    <div v-if="shownBuffs.length" class="flex flex-col gap-1">
      <span class="t-caption uppercase">Buffs</span>
      <div class="flex flex-wrap gap-2">
        <span
          v-for="buff in shownBuffs"
          :key="buff.id"
          class="text-xs"
          :class="{
            'text-radiant': buff.kind === 'positive',
            'text-dire': buff.kind === 'negative',
            'text-ability': buff.kind === 'neutral',
          }"
          :data-testid="`buff-${buff.id}`"
        >
          {{ buff.label
          }}<span v-if="buff.stacks > 1" class="ml-0.5 text-gold">x{{ buff.stacks }}</span>
          <span v-if="buff.ticks !== null" class="ml-0.5 text-text-dim">({{ buff.ticks }}t)</span>
        </span>
      </div>
    </div>

    <div class="mt-1 flex items-center gap-1">
      <span class="font-bold text-gold text-glow-gold">$</span>
      <span class="t-h2 text-gold text-glow-gold t-mono-num">{{ hero.gold.toLocaleString() }}</span>
    </div>
  </div>
</template>
