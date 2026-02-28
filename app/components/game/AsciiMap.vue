<script setup lang="ts">
import { computed } from 'vue'

interface ZoneDisplay {
  id: string
  name: string
  playerHere: boolean
  allies: string[]
  enemyCount: number
  tower?: { team: 'radiant' | 'dire'; alive: boolean; tier: number }
  fogged: boolean
}

const props = defineProps<{
  zones: ZoneDisplay[]
  playerZone: string
}>()

// 5-column spatial grid: TOP LANE | RAD JUNGLE | MID LANE | DIRE JUNGLE | BOT LANE
// Rows go from Radiant base (top) to Dire base (bottom)
const MAP_ROWS: (string | null)[][] = [
  [null, 'radiant-fountain', null, 'radiant-base', null],
  ['top-t3-rad', null, 'mid-t3-rad', null, 'bot-t3-rad'],
  ['top-t2-rad', 'jungle-rad-top', 'mid-t2-rad', 'jungle-rad-bot', 'bot-t2-rad'],
  ['top-t1-rad', null, 'mid-t1-rad', null, 'bot-t1-rad'],
  ['top-river', 'rune-top', 'roshan-pit', 'rune-bot', 'bot-river'],
  [null, null, 'mid-river', null, null],
  ['top-t1-dire', null, 'mid-t1-dire', null, 'bot-t1-dire'],
  ['top-t2-dire', 'jungle-dire-top', 'mid-t2-dire', 'jungle-dire-bot', 'bot-t2-dire'],
  ['top-t3-dire', null, 'mid-t3-dire', null, 'bot-t3-dire'],
  [null, 'dire-base', null, 'dire-fountain', null],
]

const COL_HEADERS = ['TOP', 'RAD JG', 'MID', 'DIRE JG', 'BOT']

const SHORT_NAMES: Record<string, string> = {
  'radiant-fountain': 'Ftn',
  'radiant-base': 'Base',
  'dire-fountain': 'Ftn',
  'dire-base': 'Base',
  'top-t3-rad': 'T3',
  'top-t2-rad': 'T2',
  'top-t1-rad': 'T1',
  'top-river': 'Rvr',
  'top-t1-dire': 'T1',
  'top-t2-dire': 'T2',
  'top-t3-dire': 'T3',
  'mid-t3-rad': 'T3',
  'mid-t2-rad': 'T2',
  'mid-t1-rad': 'T1',
  'mid-river': 'Rvr',
  'mid-t1-dire': 'T1',
  'mid-t2-dire': 'T2',
  'mid-t3-dire': 'T3',
  'bot-t3-rad': 'T3',
  'bot-t2-rad': 'T2',
  'bot-t1-rad': 'T1',
  'bot-river': 'Rvr',
  'bot-t1-dire': 'T1',
  'bot-t2-dire': 'T2',
  'bot-t3-dire': 'T3',
  'jungle-rad-top': 'JgR',
  'jungle-rad-bot': 'JgR',
  'jungle-dire-top': 'JgD',
  'jungle-dire-bot': 'JgD',
  'rune-top': 'RunT',
  'rune-bot': 'RunB',
  'roshan-pit': 'Rosh',
}

const zoneMap = computed(() => {
  const map = new Map<string, ZoneDisplay>()
  for (const z of props.zones) {
    map.set(z.id, z)
  }
  return map
})

function getZone(id: string): ZoneDisplay | undefined {
  return zoneMap.value.get(id)
}

function cellText(zone: ZoneDisplay): string {
  const name = SHORT_NAMES[zone.id] ?? zone.id.slice(0, 4)
  if (zone.fogged) return `${name} ?`

  const indicators: string[] = []
  if (zone.tower) {
    indicators.push(zone.tower.alive ? '\u2713' : '\u2717')
  }
  if (zone.playerHere) indicators.push('>>YOU')
  if (zone.allies.length > 0) indicators.push(`${zone.allies.length}A`)
  if (zone.enemyCount > 0) indicators.push(`${zone.enemyCount}E`)

  return indicators.length > 0 ? `${name} ${indicators.join(' ')}` : name
}

function cellClasses(zone: ZoneDisplay): string {
  if (zone.fogged) return 'text-text-dim opacity-40'
  if (zone.playerHere) return 'text-self font-bold bg-self/10 border border-self/30'
  if (zone.allies.length > 0) return 'text-radiant'
  if (zone.enemyCount > 0) return 'text-dire'
  return 'text-text-dim'
}


</script>

<template>
  <div class="h-full flex flex-col">
    <!-- RADIANT header -->
    <div class="px-1 text-center text-[0.6rem] font-bold tracking-widest text-radiant opacity-70">
      RADIANT
    </div>

    <!-- Column headers -->
    <div class="grid grid-cols-5 gap-px px-1">
      <span
        v-for="hdr in COL_HEADERS"
        :key="hdr"
        class="text-center font-mono text-[0.55rem] font-bold text-text-dim opacity-60"
      >
        {{ hdr }}
      </span>
    </div>

    <!-- Map grid -->
    <div class="flex-1">
      <div
        v-for="(row, ri) in MAP_ROWS"
        :key="ri"
        class="grid grid-cols-5 gap-px"
        :class="{
          'border-b border-border/30': ri === 3 || ri === 5,
        }"
      >
        <template v-for="(zoneId, ci) in row" :key="ci">
          <div
            v-if="zoneId && getZone(zoneId)"
            class="cursor-default px-0.5 py-px text-center font-mono text-[0.7rem] leading-tight hover:bg-white/[0.03]"
            :class="cellClasses(getZone(zoneId)!)"
            :title="zoneId"
          >
            {{ cellText(getZone(zoneId)!) }}
          </div>
          <div v-else class="px-0.5 py-px text-center font-mono text-[0.7rem] leading-tight">
            <span v-if="zoneId" class="text-text-dim opacity-20">·</span>
          </div>
        </template>
      </div>
    </div>

    <!-- DIRE header -->
    <div class="px-1 text-center text-[0.6rem] font-bold tracking-widest text-dire opacity-70">
      DIRE
    </div>

    <div v-if="!zones.length" class="p-2 text-[0.8rem] text-text-dim">
      &gt;_ loading map data...
    </div>
  </div>
</template>
