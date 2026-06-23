<script setup lang="ts">
/**
 * Per-team player scoreboard table — shared by the spectate (live) and replay
 * (historical) pages, which previously inlined two near-identical tables over
 * two different player types (live PlayerState vs replay FramePlayer). Each page
 * normalises its players into PlayerScoreRow[] and this component owns the
 * rendering, so the markup + a11y (caption, scope, dimmed-when-dead, [AI] tag)
 * live in ONE place that a Histoire story + a component test can cover.
 */
export interface PlayerScoreRow {
  id: string
  heroName: string
  level: number
  /** hp/maxHp are optional — the replay end-state snapshot (shown before frames
   *  load) carries no HP, so the cell renders "?" when either is absent. */
  hp?: number
  maxHp?: number
  kills: number
  deaths: number
  assists: number
  gold: number
  zone: string
  alive: boolean
  /** AFK→bot takeover marker (live spectate only; replay rows leave it unset). */
  aiControlled?: boolean
}

defineProps<{
  /** Screen-reader caption, e.g. "Radiant players". */
  caption: string
  rows: PlayerScoreRow[]
}>()
</script>

<template>
  <div class="overflow-x-auto">
    <table class="w-full t-mono-num text-xs">
      <caption class="sr-only">
        {{
          caption
        }}
      </caption>
      <thead>
        <tr class="text-text-muted">
          <th scope="col" class="px-2 py-1 text-left t-caption">Hero</th>
          <th scope="col" class="px-2 py-1 text-left t-caption">Lv</th>
          <th scope="col" class="px-2 py-1 text-left t-caption">HP</th>
          <th scope="col" class="px-2 py-1 text-left t-caption">K/D/A</th>
          <th scope="col" class="px-2 py-1 text-left t-caption">Gold</th>
          <th scope="col" class="px-2 py-1 text-left t-caption">Zone</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="p in rows"
          :key="p.id"
          class="border-t border-border/50"
          :class="{ 'opacity-50': !p.alive }"
        >
          <th scope="row" class="px-2 py-1 font-normal">
            {{ p.heroName }}
            <span v-if="p.aiControlled" class="text-warn t-caption" title="AFK — bot">[AI]</span>
          </th>
          <td class="px-2 py-1 text-gold">{{ p.level }}</td>
          <td class="px-2 py-1">
            <template v-if="p.hp !== undefined && p.maxHp !== undefined"
              >{{ p.hp }}<span class="text-text-muted">/{{ p.maxHp }}</span></template
            >
            <span v-else class="text-text-muted">?</span>
          </td>
          <td class="px-2 py-1">
            <span class="text-radiant">{{ p.kills }}</span
            ><span class="text-text-muted">/</span><span class="text-dire">{{ p.deaths }}</span
            ><span class="text-text-muted">/</span
            ><span class="text-text-dim">{{ p.assists }}</span>
          </td>
          <td class="px-2 py-1 text-gold">{{ p.gold.toLocaleString() }}</td>
          <td class="px-2 py-1 text-zone t-caption">{{ p.zone }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
