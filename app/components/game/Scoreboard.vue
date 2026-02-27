<script setup lang="ts">
interface PlayerScore {
  name: string
  heroId: string
  team: 'radiant' | 'dire'
  kills: number
  deaths: number
  assists: number
  gold: number
  level: number
  items: (string | null)[]
}

defineProps<{
  players: PlayerScore[]
}>()
</script>

<template>
  <div class="overflow-x-auto">
    <table class="w-full border-collapse text-xs">
      <thead>
        <tr>
          <th
            class="whitespace-nowrap border-b border-border px-1.5 py-1 text-left font-normal text-text-dim"
          >
            Hero
          </th>
          <th
            class="whitespace-nowrap border-b border-border px-1.5 py-1 text-left font-normal text-text-dim"
          >
            Player
          </th>
          <th
            class="whitespace-nowrap border-b border-border px-1.5 py-1 text-left font-normal text-text-dim"
          >
            K
          </th>
          <th
            class="whitespace-nowrap border-b border-border px-1.5 py-1 text-left font-normal text-text-dim"
          >
            D
          </th>
          <th
            class="whitespace-nowrap border-b border-border px-1.5 py-1 text-left font-normal text-text-dim"
          >
            A
          </th>
          <th
            class="whitespace-nowrap border-b border-border px-1.5 py-1 text-left font-normal text-text-dim"
          >
            Gold
          </th>
          <th
            class="whitespace-nowrap border-b border-border px-1.5 py-1 text-left font-normal text-text-dim"
          >
            Lv
          </th>
          <th
            class="whitespace-nowrap border-b border-border px-1.5 py-1 text-left font-normal text-text-dim"
          >
            Items
          </th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="p in players" :key="p.name">
          <td
            class="whitespace-nowrap border-b border-border/50 px-1.5 py-1 text-ability"
            :class="
              p.team === 'radiant' ? 'border-l-2 border-l-radiant' : 'border-l-2 border-l-dire'
            "
          >
            {{ p.heroId }}
          </td>
          <td class="whitespace-nowrap border-b border-border/50 px-1.5 py-1">{{ p.name }}</td>
          <td class="whitespace-nowrap border-b border-border/50 px-1.5 py-1 text-radiant">
            {{ p.kills }}
          </td>
          <td class="whitespace-nowrap border-b border-border/50 px-1.5 py-1 text-dire">
            {{ p.deaths }}
          </td>
          <td class="whitespace-nowrap border-b border-border/50 px-1.5 py-1 text-text-dim">
            {{ p.assists }}
          </td>
          <td class="whitespace-nowrap border-b border-border/50 px-1.5 py-1 text-gold">
            {{ p.gold.toLocaleString() }}
          </td>
          <td class="whitespace-nowrap border-b border-border/50 px-1.5 py-1">{{ p.level }}</td>
          <td class="flex gap-1 border-b border-border/50 px-1.5 py-1">
            <span
              v-for="(item, i) in p.items.slice(0, 6)"
              :key="i"
              class="text-[0.7rem] text-text-dim"
            >
              {{ item || '-' }}
            </span>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
