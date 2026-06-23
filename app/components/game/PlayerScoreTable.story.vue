<script setup lang="ts">
import PlayerScoreTable, { type PlayerScoreRow } from './PlayerScoreTable.vue'

// A typical live radiant team: a fed carry, a normal support, a dead player
// (dimmed), and an AFK player taken over by a bot ([AI] tag).
const liveTeam: PlayerScoreRow[] = [
  {
    id: 'p1',
    heroName: 'Daemon',
    level: 16,
    hp: 1820,
    maxHp: 2100,
    kills: 9,
    deaths: 2,
    assists: 4,
    gold: 12450,
    zone: 'mid-river',
    alive: true,
  },
  {
    id: 'p2',
    heroName: 'Socket',
    level: 12,
    hp: 640,
    maxHp: 1300,
    kills: 1,
    deaths: 3,
    assists: 11,
    gold: 4980,
    zone: 'bot-rune',
    alive: true,
  },
  {
    id: 'p3',
    heroName: 'Kernel',
    level: 14,
    hp: 0,
    maxHp: 1750,
    kills: 5,
    deaths: 5,
    assists: 6,
    gold: 7320,
    zone: 'radiant-base',
    alive: false,
  },
  {
    id: 'p4',
    heroName: 'Cron',
    level: 10,
    hp: 980,
    maxHp: 1400,
    kills: 0,
    deaths: 4,
    assists: 3,
    gold: 3110,
    zone: 'top-t2-rad',
    alive: true,
    aiControlled: true,
  },
]

// The replay end-state snapshot shown before frames load carries no HP → "?".
const snapshotTeam: PlayerScoreRow[] = liveTeam.map((p) => ({
  ...p,
  hp: undefined,
  maxHp: undefined,
  aiControlled: false,
}))
</script>

<template>
  <Story title="Game/PlayerScoreTable" :layout="{ type: 'single' }">
    <Variant title="Live team (alive · dead · [AI])">
      <div class="max-w-[480px] border border-radiant/40 bg-bg-panel p-1">
        <PlayerScoreTable caption="Radiant players" :rows="liveTeam" />
      </div>
    </Variant>

    <Variant title="Snapshot (no HP yet → ?)">
      <div class="max-w-[480px] border border-dire/40 bg-bg-panel p-1">
        <PlayerScoreTable caption="Dire players" :rows="snapshotTeam" />
      </div>
    </Variant>

    <Variant title="Empty">
      <div class="max-w-[480px] border border-border bg-bg-panel p-1">
        <PlayerScoreTable caption="No players" :rows="[]" />
      </div>
    </Variant>
  </Story>
</template>
