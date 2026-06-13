<script setup lang="ts">
import { computed, ref } from 'vue'
import type { TeamState, TeamId } from '~~/shared/types/game'
import type { ScoreboardEntry } from '~/stores/game'
import { ITEMS } from '~~/server/game/items/registry'
import { usePointerCoarse } from '~/composables/useTapInspect'

const props = defineProps<{
  players: ScoreboardEntry[]
  teams: { radiant: TeamState; dire: TeamState }
  currentTick: number
  currentPlayerId: string
}>()

const isCoarsePointer = usePointerCoarse()

const radiantPlayers = computed(() => props.players.filter((p) => p.team === 'radiant'))
const direPlayers = computed(() => props.players.filter((p) => p.team === 'dire'))

const teamBlocks = computed((): { team: TeamId; players: ScoreboardEntry[] }[] => [
  { team: 'radiant', players: radiantPlayers.value },
  { team: 'dire', players: direPlayers.value },
])

// Tap/click a row to expand its items as readable text (replaces the old
// title-attribute tooltips, which are invisible on touch devices).
const expandedPlayerId = ref<string | null>(null)

function toggleRow(playerId: string) {
  expandedPlayerId.value = expandedPlayerId.value === playerId ? null : playerId
}

function expandedItemNames(player: ScoreboardEntry): string {
  if (player.fogged) return 'Unknown (fogged)'
  const names = player.items.filter((id): id is string => !!id).map((id) => ITEMS[id]?.name ?? id)
  return names.length ? names.join(', ') : 'No items'
}

function respawnCountdown(player: ScoreboardEntry): string {
  if (player.alive || !player.respawnTick) return ''
  const ticks = player.respawnTick - props.currentTick
  return ticks > 0 ? `${ticks}t` : ''
}

function teamTotalGold(team: TeamId): number {
  return props.players
    .filter((p) => p.team === team && !p.fogged)
    .reduce((sum, p) => sum + p.gold, 0)
}

function formatGold(gold: number): string {
  if (gold >= 10000) return `${(gold / 1000).toFixed(1)}k`
  return gold.toLocaleString()
}

function itemAbbrev(itemId: string | null | undefined): string {
  if (!itemId) return ''
  // Abbreviate long item names: take first 3 chars of each word
  return itemId
    .split('_')
    .map((w) => w.slice(0, 3))
    .join('')
    .toUpperCase()
    .slice(0, 5)
}

const gameTimeFormatted = computed(() => {
  const totalSeconds = props.currentTick * 4
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
})
</script>

<template>
  <div class="scoreboard" data-testid="scoreboard">
    <!-- Header -->
    <div class="scoreboard__header">
      <div class="scoreboard__team-label scoreboard__team-label--radiant">RADIANT</div>
      <div class="scoreboard__match-info">
        <div class="scoreboard__time">{{ gameTimeFormatted }}</div>
        <div class="scoreboard__kills-summary">
          <span class="text-radiant">{{ teams.radiant.kills }}</span>
          <span class="scoreboard__vs">vs</span>
          <span class="text-dire">{{ teams.dire.kills }}</span>
        </div>
        <div class="scoreboard__tower-summary">
          <span class="text-radiant" :title="`Radiant towers destroyed`"
            >{{ teams.radiant.towerKills }}T</span
          >
          <span class="scoreboard__separator">/</span>
          <span class="text-dire" :title="`Dire towers destroyed`"
            >{{ teams.dire.towerKills }}T</span
          >
        </div>
      </div>
      <div class="scoreboard__team-label scoreboard__team-label--dire">DIRE</div>
    </div>

    <!-- Team tables: side-by-side on desktop, stacked on narrow screens -->
    <div class="scoreboard__body">
      <template v-for="(block, blockIdx) in teamBlocks" :key="block.team">
        <div v-if="blockIdx > 0" class="scoreboard__divider-col" />

        <section
          class="scoreboard__team-block"
          :class="`scoreboard__team-block--${block.team}`"
          :data-testid="`scoreboard-team-${block.team}`"
        >
          <!-- Column headers -->
          <div class="scoreboard__col-headers">
            <span class="scoreboard__col scoreboard__col--hero" />
            <span class="scoreboard__col scoreboard__col--name">Player</span>
            <span class="scoreboard__col scoreboard__col--kda">K/D/A</span>
            <span class="scoreboard__col scoreboard__col--lv">Lv</span>
            <span class="scoreboard__col scoreboard__col--gold">Gold</span>
            <span class="scoreboard__col scoreboard__col--items">Items</span>
            <span class="scoreboard__col scoreboard__col--status">ST</span>
          </div>

          <!-- Player rows -->
          <div v-for="player in block.players" :key="player.id" class="scoreboard__player-cell">
            <div
              class="scoreboard__player-row"
              :class="{
                'scoreboard__player-row--dead': !player.alive,
                'scoreboard__player-row--self': player.id === currentPlayerId,
              }"
              :data-testid="`scoreboard-row-${player.id}`"
              role="button"
              tabindex="0"
              @click="toggleRow(player.id)"
              @keydown.enter="toggleRow(player.id)"
            >
              <div class="scoreboard__col scoreboard__col--hero">
                <HeroAvatar v-if="player.heroId" :hero-id="player.heroId" :size="32" />
                <div v-else class="scoreboard__no-avatar">?</div>
              </div>
              <div class="scoreboard__col scoreboard__col--name" :title="player.name">
                {{ player.name }}
              </div>
              <div class="scoreboard__col scoreboard__col--kda">
                <span class="text-radiant">{{ player.kills }}</span
                >/<span class="text-dire">{{ player.deaths }}</span
                >/<span class="text-text-dim">{{ player.assists }}</span>
              </div>
              <div class="scoreboard__col scoreboard__col--lv">
                {{ player.level }}
              </div>
              <div class="scoreboard__col scoreboard__col--gold text-gold">
                {{ player.fogged ? '???' : formatGold(player.gold) }}
              </div>
              <div class="scoreboard__col scoreboard__col--items">
                <template v-if="player.fogged">
                  <span
                    v-for="s in 6"
                    :key="s"
                    class="scoreboard__item-slot scoreboard__item-slot--fogged"
                    >-</span
                  >
                </template>
                <template v-else>
                  <span
                    v-for="s in 6"
                    :key="s"
                    class="scoreboard__item-slot"
                    :class="{ 'scoreboard__item-slot--filled': player.items[s - 1] }"
                    >{{ itemAbbrev(player.items[s - 1]) || '.' }}</span
                  >
                </template>
              </div>
              <div class="scoreboard__col scoreboard__col--status">
                <template v-if="player.alive">
                  <span
                    class="scoreboard__alive-dot"
                    :class="`scoreboard__alive-dot--${block.team}`"
                  />
                </template>
                <template v-else>
                  <span class="scoreboard__dead-label">{{
                    respawnCountdown(player) || 'DEAD'
                  }}</span>
                </template>
              </div>
            </div>

            <!-- Expanded item names (tap/click row to toggle) -->
            <div
              v-if="expandedPlayerId === player.id"
              class="scoreboard__items-expanded"
              :data-testid="`scoreboard-items-${player.id}`"
            >
              <span class="scoreboard__items-expanded-label">ITEMS:</span>
              {{ expandedItemNames(player) }}
            </div>
          </div>
        </section>
      </template>
    </div>

    <!-- Team totals footer -->
    <div class="scoreboard__footer">
      <div class="scoreboard__team-total scoreboard__team-total--radiant">
        <span class="scoreboard__total-label">TOTAL</span>
        <span class="text-radiant">{{ teams.radiant.kills }}K</span>
        <span class="text-gold">{{ formatGold(teamTotalGold('radiant')) }}g</span>
        <span class="text-text-dim">{{ teams.radiant.towerKills }}T</span>
      </div>
      <div class="scoreboard__footer-center">
        <span class="text-text-dim text-[0.65rem]" data-testid="scoreboard-hint">{{
          isCoarsePointer ? 'tap outside to close' : 'Hold TAB'
        }}</span>
      </div>
      <div class="scoreboard__team-total scoreboard__team-total--dire">
        <span class="scoreboard__total-label">TOTAL</span>
        <span class="text-dire">{{ teams.dire.kills }}K</span>
        <span class="text-gold">{{ formatGold(teamTotalGold('dire')) }}g</span>
        <span class="text-text-dim">{{ teams.dire.towerKills }}T</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.scoreboard {
  width: 100%;
  font-family: var(--font-mono);
  font-size: 0.75rem;
  line-height: 1.3;
  color: rgb(var(--text-primary));
}

/* ── Header ─────────────────────────────────────────────── */
.scoreboard__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid rgb(var(--border-color));
  background: rgb(var(--bg-secondary));
}

.scoreboard__team-label {
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
}

.scoreboard__team-label--radiant {
  color: rgb(var(--color-radiant));
  text-shadow:
    0 0 6px rgb(var(--color-radiant) / 0.9),
    0 0 16px rgb(var(--color-radiant) / 0.45);
}

.scoreboard__team-label--dire {
  color: rgb(var(--color-dire));
  text-shadow:
    0 0 6px rgb(var(--color-dire) / 0.9),
    0 0 16px rgb(var(--color-dire) / 0.45);
}

.scoreboard__match-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.scoreboard__time {
  font-size: 0.7rem;
  color: rgb(var(--text-dim));
  letter-spacing: 0.05em;
}

.scoreboard__kills-summary {
  font-size: 1.35rem;
  font-weight: 700;
  letter-spacing: 0.05em;
  font-variant-numeric: tabular-nums;
}

.scoreboard__kills-summary .text-radiant {
  text-shadow:
    0 0 6px rgb(var(--color-radiant) / 0.85),
    0 0 14px rgb(var(--color-radiant) / 0.4);
}

.scoreboard__kills-summary .text-dire {
  text-shadow:
    0 0 6px rgb(var(--color-dire) / 0.85),
    0 0 14px rgb(var(--color-dire) / 0.4);
}

.scoreboard__vs {
  margin: 0 6px;
  font-size: 0.65rem;
  font-weight: 400;
  color: rgb(var(--text-dim));
  text-transform: uppercase;
}

.scoreboard__tower-summary {
  font-size: 0.65rem;
  color: rgb(var(--text-dim));
}

.scoreboard__separator {
  margin: 0 4px;
  color: rgb(var(--border-color));
}

/* ── Body: two team blocks ───────────────────────────────── */
.scoreboard__body {
  display: flex;
}

.scoreboard__team-block {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

/* ── Column Headers ──────────────────────────────────────── */
.scoreboard__col-headers {
  display: flex;
  align-items: center;
  padding: 4px 6px;
  gap: 4px;
  border-bottom: 1px solid rgb(var(--border-color));
  background: rgba(var(--bg-secondary), 0.5);
}

.scoreboard__col-headers .scoreboard__col {
  font-size: 0.6rem;
  color: rgb(var(--text-dim));
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* ── Column sizing ───────────────────────────────────────── */
.scoreboard__col--hero {
  width: 36px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.scoreboard__col--name {
  flex: 1;
  min-width: 60px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.scoreboard__col--kda {
  width: 62px;
  flex-shrink: 0;
  text-align: center;
  white-space: nowrap;
}

.scoreboard__col--lv {
  width: 24px;
  flex-shrink: 0;
  text-align: center;
}

.scoreboard__col--gold {
  width: 44px;
  flex-shrink: 0;
  text-align: right;
}

.scoreboard__col--items {
  width: 90px;
  flex-shrink: 0;
  display: flex;
  gap: 2px;
  justify-content: center;
}

.scoreboard__col--status {
  width: 40px;
  flex-shrink: 0;
  text-align: center;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* ── Divider ─────────────────────────────────────────────── */
.scoreboard__divider-col {
  width: 1px;
  background: rgb(var(--border-glow));
  flex-shrink: 0;
}

/* ── Player rows ─────────────────────────────────────────── */
.scoreboard__player-cell {
  border-bottom: 1px solid rgba(var(--border-color), 0.5);
}

.scoreboard__player-row {
  display: flex;
  align-items: center;
  padding: 4px 6px;
  gap: 4px;
  min-height: 40px;
  cursor: pointer;
  transition: background-color 0.15s;
}

.scoreboard__player-row:hover {
  background: rgba(var(--border-color), 0.3);
}

.scoreboard__player-row--dead {
  opacity: 0.45;
}

.scoreboard__player-row--self {
  background: rgb(var(--color-ability) / 0.1);
  box-shadow:
    inset 3px 0 0 rgb(var(--color-ability)),
    inset 0 0 14px rgb(var(--color-ability) / 0.18);
}

.scoreboard__player-row--self.scoreboard__player-row--dead {
  opacity: 0.6;
}

/* ── Expanded item names ─────────────────────────────────── */
.scoreboard__items-expanded {
  padding: 2px 8px 6px 42px;
  font-size: 0.65rem;
  color: rgb(var(--color-ability));
  word-break: break-word;
}

.scoreboard__items-expanded-label {
  color: rgb(var(--text-dim));
  letter-spacing: 0.05em;
}

/* ── Item slots ──────────────────────────────────────────── */
.scoreboard__item-slot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 13px;
  height: 13px;
  border: 1px solid rgba(var(--border-color), 0.6);
  font-size: 0.5rem;
  color: rgb(var(--text-dim));
  background: rgba(var(--bg-primary), 0.5);
}

.scoreboard__item-slot--filled {
  border-color: rgba(var(--color-ability), 0.4);
  color: rgb(var(--color-ability));
  background: rgba(var(--color-ability), 0.06);
}

.scoreboard__item-slot--fogged {
  border-color: rgba(var(--border-color), 0.3);
  color: rgba(var(--text-dim), 0.4);
}

/* ── Avatar placeholder ─────────────────────────────────── */
.scoreboard__no-avatar {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgb(var(--border-color));
  background: rgb(var(--bg-secondary));
  color: rgb(var(--text-dim));
  font-size: 0.7rem;
}

/* ── Status indicators ──────────────────────────────────── */
.scoreboard__alive-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

.scoreboard__alive-dot--radiant {
  background: rgb(var(--color-radiant));
  box-shadow:
    0 0 6px rgb(var(--color-radiant) / 0.9),
    0 0 14px rgb(var(--color-radiant) / 0.5);
  animation: glow-pulse 2.4s ease-in-out infinite;
}

.scoreboard__alive-dot--dire {
  background: rgb(var(--color-dire));
  box-shadow:
    0 0 6px rgb(var(--color-dire) / 0.9),
    0 0 14px rgb(var(--color-dire) / 0.5);
  animation: glow-pulse 2.4s ease-in-out infinite;
}

.scoreboard__dead-label {
  font-size: 0.6rem;
  color: rgb(var(--color-dire));
  font-weight: 700;
  letter-spacing: 0.05em;
}

/* ── Footer (team totals) ───────────────────────────────── */
.scoreboard__footer {
  display: flex;
  align-items: center;
  border-top: 1px solid rgb(var(--border-color));
  background: rgb(var(--bg-secondary));
}

.scoreboard__team-total {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  font-size: 0.7rem;
}

.scoreboard__team-total--radiant {
  justify-content: flex-start;
}

.scoreboard__team-total--dire {
  justify-content: flex-end;
}

.scoreboard__total-label {
  font-weight: 700;
  color: rgb(var(--text-dim));
  font-size: 0.6rem;
  letter-spacing: 0.1em;
}

.scoreboard__footer-center {
  width: 1px;
  padding: 0 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
}

/* ── Narrow screens: stack teams vertically, compact columns ── */
@media (max-width: 767px) {
  .scoreboard__body {
    flex-direction: column;
  }

  .scoreboard__body .scoreboard__divider-col {
    display: none;
  }

  /* Team caption per stacked block (pseudo-element so it doesn't add
     another RADIANT/DIRE text node to the DOM) */
  .scoreboard__team-block::before {
    display: block;
    padding: 4px 8px 0;
    font-size: 0.65rem;
    font-weight: 700;
    letter-spacing: 0.15em;
  }

  .scoreboard__team-block--radiant::before {
    content: 'RADIANT';
    color: rgb(var(--color-radiant));
  }

  .scoreboard__team-block--dire::before {
    content: 'DIRE';
    color: rgb(var(--color-dire));
    border-top: 1px solid rgb(var(--border-color));
  }

  /* Item abbreviations don't fit on phones — items are available via
     tap-to-expand on each row instead */
  .scoreboard__col--items {
    display: none;
  }

  .scoreboard__col--name {
    min-width: 0;
  }

  /* Comfortable touch target per row */
  .scoreboard__player-row {
    min-height: 44px;
  }
}
</style>
