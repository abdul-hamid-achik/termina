<script setup lang="ts">
import { useGameStore } from '~/stores/game'
import { SAMPLE_HEROES, makePlayer } from '~/stories/fixtures'
import FocusBanner from './FocusBanner.vue'

// histoire.setup.ts installs Pinia. Each Variant seeds the game store so the
// banner derives a different verdict + recommendation. nearbyEnemies/allies
// come from allPlayers filtered by the local player's zone + team.
function seed(opts: {
  hp?: number
  maxHp?: number
  alive?: boolean
  cooldowns?: { q: number; w: number; e: number; r: number }
  enemies?: number
  allies?: number
}) {
  const store = useGameStore()
  const me = makePlayer({
    id: 'me',
    team: 'radiant',
    heroId: SAMPLE_HEROES.echo,
    zone: 'mid-river',
    hp: opts.hp ?? 600,
    maxHp: opts.maxHp ?? 600,
    alive: opts.alive ?? true,
    cooldowns: opts.cooldowns ?? { q: 0, w: 0, e: 0, r: 0 },
  })
  const all: Record<string, ReturnType<typeof makePlayer>> = { me }
  for (let i = 0; i < (opts.enemies ?? 0); i++)
    all[`e${i}`] = makePlayer({ id: `e${i}`, team: 'dire', zone: 'mid-river' })
  for (let i = 0; i < (opts.allies ?? 0); i++)
    all[`a${i}`] = makePlayer({ id: `a${i}`, team: 'radiant', zone: 'mid-river' })
  store.playerId = 'me'
  store.player = me
  store.allPlayers = all
}

const seedClear = () => seed({ enemies: 0 })
const seedContested = () => seed({ enemies: 1, cooldowns: { q: 0, w: 4, e: 0, r: 8 } })
const seedDanger = () => seed({ enemies: 2 })
const seedLowHp = () => seed({ hp: 120, enemies: 1 })
const seedDead = () => seed({ alive: false, hp: 0, enemies: 1 })
</script>

<template>
  <Story title="Game/FocusBanner">
    <Variant title="clear" :setup-app="seedClear">
      <div class="bg-bg-primary" style="width: 560px"><FocusBanner /></div>
    </Variant>
    <Variant title="contested (some abilities ready)" :setup-app="seedContested">
      <div class="bg-bg-primary" style="width: 560px"><FocusBanner /></div>
    </Variant>
    <Variant title="danger (outnumbered)" :setup-app="seedDanger">
      <div class="bg-bg-primary" style="width: 560px"><FocusBanner /></div>
    </Variant>
    <Variant title="low HP" :setup-app="seedLowHp">
      <div class="bg-bg-primary" style="width: 560px"><FocusBanner /></div>
    </Variant>
    <Variant title="dead" :setup-app="seedDead">
      <div class="bg-bg-primary" style="width: 560px"><FocusBanner /></div>
    </Variant>
  </Story>
</template>
