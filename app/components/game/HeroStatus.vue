<script setup lang="ts">
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

defineProps<{
  hero: HeroData
}>()

function cdLabel(cd: number): string {
  return cd <= 0 ? 'RDY' : `${cd}`
}

function cdClass(cd: number): string {
  return cd <= 0 ? 'ability-slot--ready' : 'ability-slot--cooldown'
}
</script>

<template>
  <div class="hero-status">
    <div class="hs__header">
      <span class="hs__name">{{ hero.name }}</span>
      <span class="hs__level">Lv.{{ hero.level }}</span>
      <span class="hs__zone">@ {{ hero.zone }}</span>
      <span v-if="!hero.alive" class="hs__dead">[DEAD]</span>
    </div>

    <div class="hs__bars">
      <div class="hs__bar-row">
        <span class="hs__bar-label">HP</span>
        <ProgressBar
          :value="hero.hp"
          :max="hero.maxHp"
          color="radiant"
          :width="16"
          show-label
        />
      </div>
      <div class="hs__bar-row">
        <span class="hs__bar-label">MP</span>
        <ProgressBar
          :value="hero.mp"
          :max="hero.maxMp"
          color="mana"
          :width="16"
          show-label
        />
      </div>
    </div>

    <div class="hs__abilities">
      <span class="hs__section-label">Abilities</span>
      <div class="hs__ability-list">
        <span
          v-for="key in (['q', 'w', 'e', 'r'] as const)"
          :key="key"
          class="ability-slot"
          :class="cdClass(hero.cooldowns[key])"
        >
          <span class="ability-slot__key">{{ key.toUpperCase() }}</span>
          <span class="ability-slot__cd">[{{ cdLabel(hero.cooldowns[key]) }}]</span>
        </span>
      </div>
    </div>

    <div class="hs__items">
      <span class="hs__section-label">Items</span>
      <div class="hs__item-list">
        <span
          v-for="(item, i) in 6"
          :key="i"
          class="item-slot"
          :class="{ 'item-slot--empty': !hero.items[i] }"
        >
          {{ hero.items[i] || '[empty]' }}
        </span>
      </div>
    </div>

    <div v-if="hero.buffs.length" class="hs__buffs">
      <span class="hs__section-label">Buffs</span>
      <div class="hs__buff-list">
        <span v-for="buff in hero.buffs" :key="buff.id" class="hs__buff">
          {{ buff.id }}<span v-if="buff.stacks > 1" class="hs__buff-stacks">x{{ buff.stacks }}</span>
          <span class="hs__buff-time">({{ buff.ticksRemaining }}t)</span>
        </span>
      </div>
    </div>

    <div class="hs__gold">
      <span class="hs__gold-icon">$</span>
      <span class="hs__gold-value">{{ hero.gold.toLocaleString() }}</span>
    </div>
  </div>
</template>

<style scoped>
.hero-status {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 0.8rem;
}

.hs__header {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}

.hs__name {
  color: var(--color-self);
  font-weight: 700;
  font-size: 0.9rem;
}

.hs__level {
  color: var(--color-gold);
}

.hs__zone {
  color: var(--color-zone);
}

.hs__dead {
  color: var(--color-dire);
  font-weight: 700;
}

.hs__bars {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.hs__bar-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.hs__bar-label {
  color: var(--text-dim);
  width: 20px;
  flex-shrink: 0;
}

.hs__section-label {
  color: var(--text-dim);
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.hs__abilities,
.hs__items,
.hs__buffs {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.hs__ability-list {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.ability-slot {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px 6px;
  border: 1px solid var(--border-color);
  font-size: 0.75rem;
}

.ability-slot--ready {
  border-color: var(--color-ability);
  color: var(--color-ability);
}

.ability-slot--cooldown {
  border-color: var(--border-color);
  color: var(--text-dim);
}

.ability-slot__key {
  font-weight: 700;
}

.hs__item-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.item-slot {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border: 1px solid var(--border-color);
  font-size: 0.75rem;
}

.item-slot--empty {
  color: var(--text-dim);
  border-style: dashed;
}

.hs__buff-list {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.hs__buff {
  color: var(--color-ability);
  font-size: 0.75rem;
}

.hs__buff-stacks {
  color: var(--color-gold);
  margin-left: 2px;
}

.hs__buff-time {
  color: var(--text-dim);
  margin-left: 2px;
}

.hs__gold {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
}

.hs__gold-icon {
  color: var(--color-gold);
  font-weight: 700;
}

.hs__gold-value {
  color: var(--color-gold);
  font-weight: 700;
  font-size: 0.9rem;
}
</style>
