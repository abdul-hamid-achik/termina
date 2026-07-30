<script setup lang="ts">
import { computed } from 'vue'
import type { TeamId, GameMode } from '~~/shared/types/game'
import type { PlayerEndStats } from '~~/shared/types/protocol'
import { HEROES } from '~~/shared/constants/heroes'
import { ITEMS } from '~~/shared/constants/items'
import { computeMvp } from '~/utils/postgame'
// Imported rather than left to Nuxt's auto-import so the component also mounts
// under the plain-Vite component test runner, which has no unimport pass.
import { useStartTutorial } from '~/composables/useStartTutorial'

const props = withDefaults(
  defineProps<{
    winner: TeamId
    /** Optional so a caller with no `game_over` payload can still render the
     *  result instead of leaving the player parked on a frozen live screen. */
    stats?: Record<string, PlayerEndStats>
    players: Array<{
      id: string
      name: string
      heroId: string
      team: TeamId
    }>
    currentPlayerId: string
    mmrChange?: number
    /** False when the match contained bots and did not affect MMR. */
    ranked?: boolean
    gameId?: string | null
    /** Mode of the concluded game; 'tutorial' swaps in a learn-the-ropes wrap-up. */
    mode?: GameMode
    /** Did the player actually finish the tutorial drills (vs quitting early)? */
    tutorialComplete?: boolean
    /** Match length in ticks — turns the raw totals into per-minute rates, which
     *  is the only form in which a farm number means anything. */
    durationTicks?: number
  }>(),
  { ranked: true, stats: () => ({}) },
)

// After a tutorial we nudge the player toward a real match rather than framing
// it as a ranked result — and 'PLAY AGAIN' (→ lobby) becomes 'FIND A REAL MATCH'.
const isTutorial = computed(() => props.mode === 'tutorial')
// Whether the player actually finished the drills. Practice is now quittable
// from tick 0, so "tutorial game" no longer implies "tutorial completed" — a
// learner who bails at tick 2 must not be congratulated for the basics they
// never saw, nor read their own exit as a defeat.
const finishedTutorial = computed(() => isTutorial.value && props.tutorialComplete === true)

const emit = defineEmits<{
  playAgain: []
  returnToMenu: []
}>()

// "PRACTICE THIS" runs the shared practice launcher rather than emitting a new
// event: the parent would only forward it here anyway, and routing it through
// the composable keeps one learn → play code path across the whole app.
const {
  starting: startingPractice,
  error: practiceError,
  start: startPractice,
} = useStartTutorial()

interface ScoreRow {
  id: string
  name: string
  heroId: string
  team: TeamId
  kills: number
  deaths: number
  assists: number
  gold: number
  netWorth: number
  lastHits: number
  denies: number
  heroDamage: number
  iceDamage: number
  items: (string | null)[]
  isCurrentPlayer: boolean
}

const TICK_SECONDS = 4

const chaffPlayers = computed((): ScoreRow[] =>
  props.players.filter((p) => p.team === 'chaff').map((p) => toRow(p)),
)

const auditPlayers = computed((): ScoreRow[] =>
  props.players.filter((p) => p.team === 'audit').map((p) => toRow(p)),
)

const myStats = computed(() => {
  const s = props.stats[props.currentPlayerId]
  if (!s) return null
  return s
})

// The single standout performer across both teams (the "who carried" beat).
const mvp = computed(() => computeMvp([...chaffPlayers.value, ...auditPlayers.value], props.winner))

function toRow(p: { id: string; name: string; heroId: string; team: TeamId }): ScoreRow {
  const s = props.stats[p.id]
  return {
    id: p.id,
    name: p.name,
    heroId: p.heroId,
    team: p.team,
    kills: s?.kills ?? 0,
    deaths: s?.deaths ?? 0,
    assists: s?.assists ?? 0,
    gold: s?.gold ?? 0,
    // Pre-net-worth servers only sent the wallet balance; showing that under a
    // "Net Worth" heading would be a second wrong lesson, but 0 is worse.
    netWorth: s?.netWorth ?? s?.gold ?? 0,
    lastHits: s?.lastHits ?? 0,
    denies: s?.denies ?? 0,
    heroDamage: s?.heroDamage ?? 0,
    iceDamage: s?.iceDamage ?? 0,
    items: s?.items ?? [],
    isCurrentPlayer: p.id === props.currentPlayerId,
  }
}

/** Net worth, falling back to the wallet balance on a pre-net-worth payload. */
const myNetWorth = computed(() => myStats.value?.netWorth ?? myStats.value?.gold ?? 0)

const durationMinutes = computed(() =>
  props.durationTicks ? (props.durationTicks * TICK_SECONDS) / 60 : null,
)

/** Last hits per minute — the form in which a farm total is legible. */
const csPerMinute = computed(() => {
  const mins = durationMinutes.value
  const s = myStats.value
  if (!s || !mins || mins < 1) return null
  return (s.lastHits ?? 0) / mins
})

interface Advice {
  id: string
  /** What the number was — quoted back so the advice is evidently about them. */
  observation: string
  /** The literal command to type next game. */
  command: string
  detail: string
}

/**
 * "What to work on" — at most three items, worst first, each naming a real
 * command. Absolute thresholds only where the stat is absolute (deaths, denies);
 * everything farm-shaped is rate-based, because a 40-CS game is strong at ten
 * minutes and weak at thirty.
 *
 * Deliberately never empty: a player who did everything right still gets one
 * "next thing to try", because an empty panel reads as a broken panel.
 */
const advice = computed((): Advice[] => {
  const s = myStats.value
  if (!s) return []
  const out: Advice[] = []
  const cs = s.lastHits ?? 0
  const rate = csPerMinute.value

  if (s.deaths >= 6 || (s.deaths >= 4 && s.deaths > s.kills + s.assists)) {
    out.push({
      id: 'deaths',
      observation: `You died ${s.deaths} times`,
      command: 'move base',
      detail:
        'Watch the focus banner: the moment it flips to DANGER you are outnumbered. Retreating costs one tick — dying costs the respawn plus everything the enemy earns for it.',
    })
  }

  if (rate !== null && rate < 2) {
    out.push({
      id: 'last-hits',
      observation: `You last-hit ${cs} creeps (${rate.toFixed(1)}/min)`,
      command: 'attack creep:0',
      detail:
        'Only the killing blow pays gold, so swing when a creep is nearly dead rather than every tick. Tap the creep in the zone panel — the numbers shift each tick.',
    })
  } else if (rate === null && cs < 20) {
    out.push({
      id: 'last-hits',
      observation: `You last-hit ${cs} creeps`,
      command: 'attack creep:0',
      detail:
        'Only the killing blow pays gold, so swing when a creep is nearly dead rather than every tick. Tap the creep in the zone panel — the numbers shift each tick.',
    })
  }

  if ((s.denies ?? 0) === 0) {
    out.push({
      id: 'denies',
      observation: 'You denied 0 creeps',
      command: 'deny creep:0',
      detail:
        'When one of YOUR creeps drops below half health you can finish it yourself. The enemy laner gets no gold and less experience for it — it is the cheapest lead in the game.',
    })
  }

  if (s.gold >= 1500) {
    out.push({
      id: 'unspent',
      observation: `You finished holding ${s.gold.toLocaleString()} unspent gold`,
      command: 'buy blades_of_attack',
      detail:
        'Gold in your pocket does nothing and half of it is lost when you die. Spend it the moment you can afford the next item in your build.',
    })
  }

  if (out.length === 0) {
    out.push({
      id: 'next',
      observation: 'Clean game — nothing obvious to fix',
      command: 'ward mid-river',
      detail:
        'Next step up is map control: an observer ward on the river shows you the enemy before they arrive, which is what turns good farm into won fights.',
    })
  }

  return out.slice(0, 3)
})
</script>

<template>
  <div class="flex min-h-screen flex-col gap-4 bg-bg-primary p-4" data-testid="post-game">
    <div
      class="anim-fade-in-up border-2 p-6 text-center"
      :class="winner === 'chaff' ? 'border-chaff bloom-chaff' : 'border-audit bloom-audit'"
    >
      <div class="t-caption mb-2 text-text-muted">
        {{
          isTutorial
            ? finishedTutorial
              ? '// tutorial complete'
              : '// practice ended'
            : '// match concluded'
        }}
      </div>
      <span
        class="t-display tracking-[0.2em] anim-glow-pulse"
        :class="winner === 'chaff' ? 'text-chaff' : 'text-audit'"
      >
        <template v-if="isTutorial">{{
          finishedTutorial ? 'PRACTICE COMPLETE' : 'PRACTICE ENDED'
        }}</template>
        <template v-else>{{ winner === 'chaff' ? 'CHAFF VICTORY' : 'AUDIT VICTORY' }}</template>
      </span>
      <p v-if="isTutorial" class="mt-3 text-sm text-text-dim" data-testid="tutorial-wrapup">
        {{
          finishedTutorial
            ? "You've got the basics — move, last-hit, cast, and buy. Ready for a real match?"
            : 'Practice ended early — the drills are still there whenever you want them.'
        }}
      </p>
    </div>

    <!-- Match MVP — the standout performer across both teams -->
    <div
      v-if="mvp"
      class="anim-fade-in-up flex items-center justify-center gap-3 border p-3"
      :class="mvp.team === 'chaff' ? 'border-chaff/60' : 'border-audit/60'"
      data-testid="post-game-mvp"
    >
      <span class="t-h1 text-gold text-glow-gold" aria-hidden="true">★</span>
      <div class="flex flex-col">
        <span class="t-caption uppercase tracking-wider text-gold">Match MVP</span>
        <span
          class="t-h2"
          :class="mvp.team === 'chaff' ? 'text-chaff' : 'text-audit'"
          data-testid="mvp-name"
          >{{ mvp.name }}
          <span class="text-text-dim">({{ HEROES[mvp.heroId]?.name ?? mvp.heroId }})</span></span
        >
        <span class="t-caption t-mono-num text-text-dim">
          {{ mvp.kills }}/{{ mvp.deaths }}/{{ mvp.assists }} ·
          {{ mvp.heroDamage.toLocaleString() }} hero dmg
        </span>
      </div>
    </div>

    <div v-if="myStats">
      <TerminalPanel title="Your Performance">
        <div class="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-6">
          <div class="flex flex-col gap-1">
            <span class="t-caption uppercase">K/D/A</span>
            <span class="t-h1 t-mono-num">
              <span class="text-chaff text-glow-chaff">{{ myStats.kills }}</span>
              <span class="mx-0.5 text-text-muted">/</span>
              <span class="text-audit text-glow-audit">{{ myStats.deaths }}</span>
              <span class="mx-0.5 text-text-muted">/</span>
              <span class="text-text-dim">{{ myStats.assists }}</span>
            </span>
          </div>
          <div class="flex flex-col gap-1" data-testid="my-cs">
            <span class="t-caption uppercase" title="Last hits / denies">CS</span>
            <span class="t-h1 t-mono-num">
              <span class="text-text-primary text-glow-sm">{{ myStats.lastHits ?? 0 }}</span>
              <span class="mx-0.5 text-text-muted">/</span>
              <span class="text-text-dim">{{ myStats.denies ?? 0 }}</span>
            </span>
            <span v-if="csPerMinute !== null" class="t-caption t-mono-num text-text-muted">
              {{ csPerMinute.toFixed(1) }}/min
            </span>
          </div>
          <div class="flex flex-col gap-1" data-testid="my-net-worth">
            <span
              class="t-caption uppercase"
              title="Unspent gold plus everything you bought with it"
            >
              Net Worth
            </span>
            <span class="t-h1 text-gold text-glow-gold t-mono-num">{{
              myNetWorth.toLocaleString()
            }}</span>
          </div>
          <div class="flex flex-col gap-1">
            <span class="t-caption uppercase">Hero Damage</span>
            <span class="t-h1 text-text-primary text-glow-sm t-mono-num">{{
              myStats.heroDamage.toLocaleString()
            }}</span>
          </div>
          <div class="flex flex-col gap-1">
            <span class="t-caption uppercase">Ice Damage</span>
            <span class="t-h1 text-text-primary text-glow-sm t-mono-num">{{
              myStats.iceDamage.toLocaleString()
            }}</span>
          </div>
          <div v-if="mmrChange !== undefined" class="flex flex-col gap-1">
            <span class="t-caption uppercase">MMR</span>
            <!-- Bot games (practice / bot-filled) are unranked — no MMR moved. -->
            <span
              v-if="ranked === false"
              class="t-h1 text-text-dim"
              title="This match contained bots and did not affect MMR"
            >
              UNRANKED
            </span>
            <span
              v-else
              class="t-h1 t-mono-num"
              :class="mmrChange >= 0 ? 'text-chaff text-glow-chaff' : 'text-audit text-glow-audit'"
            >
              {{ mmrChange >= 0 ? '+' : '' }}{{ mmrChange }}
            </span>
          </div>
        </div>
      </TerminalPanel>
    </div>

    <div v-if="advice.length > 0" data-testid="what-to-work-on">
      <TerminalPanel title="What To Work On">
        <ul class="flex flex-col gap-2">
          <li
            v-for="a in advice"
            :key="a.id"
            class="border-l-2 border-gold/60 pl-3"
            :data-advice="a.id"
          >
            <div class="text-sm text-text-primary">
              {{ a.observation }} —
              <span class="text-text-dim">{{ a.detail }}</span>
            </div>
            <div class="t-caption mt-0.5 text-text-muted">
              try:
              <code class="ml-1 bg-bg-secondary px-1 text-ability">{{ a.command }}</code>
            </div>
          </li>
        </ul>
        <div class="mt-3 flex flex-wrap items-center gap-3">
          <NuxtLink
            to="/learn"
            class="inline-flex items-center border border-border px-2 py-1 font-mono text-xs text-text-dim transition-colors hover:border-ability hover:text-ability"
          >
            [READ THE BASICS]
          </NuxtLink>
          <AsciiButton
            v-if="!isTutorial"
            label="PRACTICE THIS"
            variant="ghost"
            :disabled="startingPractice"
            data-testid="practice-this-btn"
            @click="startPractice"
          />
        </div>
        <p v-if="practiceError" class="mt-2 text-xs text-audit" data-testid="practice-error">
          {{ practiceError }}
        </p>
      </TerminalPanel>
    </div>

    <div>
      <TerminalPanel title="Scoreboard">
        <div class="t-h3 pb-1 pt-1.5 text-chaff text-glow-chaff">CHAFF</div>
        <div class="mb-3 overflow-x-auto">
          <table class="w-full border-collapse text-xs">
            <caption class="sr-only">
              Chaff team final scoreboard
            </caption>
            <thead>
              <tr>
                <th
                  scope="col"
                  class="border-b border-border px-1.5 py-0.5 text-left font-normal text-text-dim"
                >
                  Hero
                </th>
                <th
                  scope="col"
                  class="border-b border-border px-1.5 py-0.5 text-left font-normal text-text-dim"
                >
                  Player
                </th>
                <th
                  scope="col"
                  class="border-b border-border px-1.5 py-0.5 text-left font-normal text-text-dim"
                >
                  K
                </th>
                <th
                  scope="col"
                  class="border-b border-border px-1.5 py-0.5 text-left font-normal text-text-dim"
                >
                  D
                </th>
                <th
                  scope="col"
                  class="border-b border-border px-1.5 py-0.5 text-left font-normal text-text-dim"
                >
                  A
                </th>
                <th
                  scope="col"
                  class="border-b border-border px-1.5 py-0.5 text-left font-normal text-text-dim"
                  title="Creep last hits / denies"
                >
                  CS
                </th>
                <th
                  scope="col"
                  class="hidden border-b border-border px-1.5 py-0.5 text-left font-normal text-text-dim md:table-cell"
                >
                  DMG
                </th>
                <th
                  scope="col"
                  class="border-b border-border px-1.5 py-0.5 text-left font-normal text-text-dim"
                  title="Unspent gold plus everything bought with it"
                >
                  Net Worth
                </th>
                <th
                  scope="col"
                  class="border-b border-border px-1.5 py-0.5 text-left font-normal text-text-dim"
                >
                  Items
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="p in chaffPlayers"
                :key="p.id"
                class="anim-fade-in-up"
                :class="{
                  'bg-ability/10 font-bold shadow-inset-ability': p.isCurrentPlayer,
                }"
              >
                <td class="whitespace-nowrap border-b border-border/50 px-1.5 py-0.5 text-ability">
                  {{ HEROES[p.heroId]?.name ?? p.heroId }}
                </td>
                <th
                  scope="row"
                  class="whitespace-nowrap border-b border-border/50 px-1.5 py-0.5 text-left font-normal"
                >
                  {{ p.name }}
                </th>
                <td class="whitespace-nowrap border-b border-border/50 px-1.5 py-0.5 text-chaff">
                  {{ p.kills }}
                </td>
                <td class="whitespace-nowrap border-b border-border/50 px-1.5 py-0.5 text-audit">
                  {{ p.deaths }}
                </td>
                <td class="whitespace-nowrap border-b border-border/50 px-1.5 py-0.5 text-text-dim">
                  {{ p.assists }}
                </td>
                <td class="whitespace-nowrap border-b border-border/50 px-1.5 py-0.5 text-text-dim">
                  {{ p.lastHits }}<span class="text-text-muted">/{{ p.denies }}</span>
                </td>
                <td
                  class="hidden whitespace-nowrap border-b border-border/50 px-1.5 py-0.5 md:table-cell"
                >
                  {{ p.heroDamage.toLocaleString() }}
                </td>
                <td class="whitespace-nowrap border-b border-border/50 px-1.5 py-0.5 text-gold">
                  {{ p.netWorth.toLocaleString() }}
                </td>
                <td class="border-b border-border/50 px-1.5 py-0.5 text-[0.65rem] text-text-dim">
                  <span v-for="(item, i) in p.items.slice(0, 6)" :key="i">
                    {{ item ? (ITEMS[item]?.name ?? item) : '-' }}{{ i < 5 ? ' ' : '' }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="t-h3 pb-1 pt-1.5 text-audit text-glow-audit">AUDIT</div>
        <div class="overflow-x-auto">
          <table class="w-full border-collapse text-xs">
            <caption class="sr-only">
              Audit team final scoreboard
            </caption>
            <thead>
              <tr>
                <th
                  scope="col"
                  class="border-b border-border px-1.5 py-0.5 text-left font-normal text-text-dim"
                >
                  Hero
                </th>
                <th
                  scope="col"
                  class="border-b border-border px-1.5 py-0.5 text-left font-normal text-text-dim"
                >
                  Player
                </th>
                <th
                  scope="col"
                  class="border-b border-border px-1.5 py-0.5 text-left font-normal text-text-dim"
                >
                  K
                </th>
                <th
                  scope="col"
                  class="border-b border-border px-1.5 py-0.5 text-left font-normal text-text-dim"
                >
                  D
                </th>
                <th
                  scope="col"
                  class="border-b border-border px-1.5 py-0.5 text-left font-normal text-text-dim"
                >
                  A
                </th>
                <th
                  scope="col"
                  class="border-b border-border px-1.5 py-0.5 text-left font-normal text-text-dim"
                  title="Creep last hits / denies"
                >
                  CS
                </th>
                <th
                  scope="col"
                  class="hidden border-b border-border px-1.5 py-0.5 text-left font-normal text-text-dim md:table-cell"
                >
                  DMG
                </th>
                <th
                  scope="col"
                  class="border-b border-border px-1.5 py-0.5 text-left font-normal text-text-dim"
                  title="Unspent gold plus everything bought with it"
                >
                  Net Worth
                </th>
                <th
                  scope="col"
                  class="border-b border-border px-1.5 py-0.5 text-left font-normal text-text-dim"
                >
                  Items
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="p in auditPlayers"
                :key="p.id"
                class="anim-fade-in-up"
                :class="{
                  'bg-ability/10 font-bold shadow-inset-ability': p.isCurrentPlayer,
                }"
              >
                <td class="whitespace-nowrap border-b border-border/50 px-1.5 py-0.5 text-ability">
                  {{ HEROES[p.heroId]?.name ?? p.heroId }}
                </td>
                <th
                  scope="row"
                  class="whitespace-nowrap border-b border-border/50 px-1.5 py-0.5 text-left font-normal"
                >
                  {{ p.name }}
                </th>
                <td class="whitespace-nowrap border-b border-border/50 px-1.5 py-0.5 text-chaff">
                  {{ p.kills }}
                </td>
                <td class="whitespace-nowrap border-b border-border/50 px-1.5 py-0.5 text-audit">
                  {{ p.deaths }}
                </td>
                <td class="whitespace-nowrap border-b border-border/50 px-1.5 py-0.5 text-text-dim">
                  {{ p.assists }}
                </td>
                <td class="whitespace-nowrap border-b border-border/50 px-1.5 py-0.5 text-text-dim">
                  {{ p.lastHits }}<span class="text-text-muted">/{{ p.denies }}</span>
                </td>
                <td
                  class="hidden whitespace-nowrap border-b border-border/50 px-1.5 py-0.5 md:table-cell"
                >
                  {{ p.heroDamage.toLocaleString() }}
                </td>
                <td class="whitespace-nowrap border-b border-border/50 px-1.5 py-0.5 text-gold">
                  {{ p.netWorth.toLocaleString() }}
                </td>
                <td class="border-b border-border/50 px-1.5 py-0.5 text-[0.65rem] text-text-dim">
                  <span v-for="(item, i) in p.items.slice(0, 6)" :key="i">
                    {{ item ? (ITEMS[item]?.name ?? item) : '-' }}{{ i < 5 ? ' ' : '' }}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </TerminalPanel>
    </div>

    <div class="flex flex-wrap items-center justify-center gap-3 pt-2">
      <AsciiButton
        :label="isTutorial ? 'FIND A REAL MATCH' : 'PLAY AGAIN'"
        variant="primary"
        data-testid="play-again-btn"
        @click="emit('playAgain')"
      />
      <NuxtLink
        v-if="gameId"
        :to="`/replay/${gameId}`"
        class="inline-flex items-center gap-1 border border-ability bg-bg-secondary px-3 py-1.5 font-mono text-sm text-ability shadow-glow-ability transition-all hover:bg-ability/10 hover:shadow-glow-ability-lg"
      >
        [WATCH REPLAY]
      </NuxtLink>
      <AsciiButton
        label="MAIN MENU"
        variant="ghost"
        data-testid="return-to-menu-btn"
        @click="emit('returnToMenu')"
      />
    </div>
  </div>
</template>
