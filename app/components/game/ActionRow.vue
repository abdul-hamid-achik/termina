<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ZoneDisplay } from '~/components/game/traceModel'
import type { SituationalAction } from '~/utils/situationalActions'

/**
 * The single contextual action surface — the phone-first home for move /
 * strip / burn / contextual verbs (R3-04). Absorbs the [ATK][Q][W][E][R][MOVE]
 * [SHOP][SCORE] strip, the [MOVE] picker and the situational-actions row that
 * GameScreen used to own separately, plus the two verbs that used to live only
 * on the situational row: STRIP (lowest-INTEG hostile wave) and BURN (a deny-eligible
 * friendly wave). Emits command strings; GameScreen's handleCommand is the
 * only sender.
 *
 * Design: 390x844 first, ≥44px targets, horizontally scrollable, always
 * visible above the prompt at every breakpoint. On desktop (fine pointer) the
 * button strip hides — the prompt is primary there (R3-09).
 */
const props = defineProps<{
  /** Adjacent zones for the [MOVE] picker. */
  moveZones: ZoneDisplay[]
  /** The situational verbs currently legal (ward/strip/burn/backup/…). */
  situational: SituationalAction[]
  /** Q/W/E/R button state (label + ready) keyed by slot. */
  abilities: Record<string, { label: string; ready: boolean } | undefined>
  /** Full accessible labels per button (the GameScreen quickActionAria copy —
   *  cooldown seconds, unlock hints — so the aria carries the plan, not a bare letter). */
  abilityArias: Record<string, string>
  /** Shop/scoreboard toggle state (for aria-pressed). */
  shopOpen: boolean
  scoreboardOpen: boolean
  /** Whether the player can buy right now (gilds the SHOP button). */
  canBuy: boolean
  /** The verb the player should press this cycle (tutorial / strip). */
  accent?: string | null
}>()

const emit = defineEmits<{
  /** A command string for GameScreen's handleCommand ('attack wave:2', 'move coldstore-cross', 'Q', 'SHOP'…). */
  command: [cmd: string]
}>()

const showMovePicker = ref(false)

function onStatic(cmd: string) {
  if (cmd === 'MOVE') {
    if (!props.moveZones.length) {
      emit('command', '__no-adjacent-zones__')
      return
    }
    showMovePicker.value = !showMovePicker.value
    return
  }
  showMovePicker.value = false
  emit('command', cmd)
}

function pickMove(zoneId: string) {
  showMovePicker.value = false
  emit('command', `move ${zoneId}`)
}

function abilityAria(slot: string): string {
  return props.abilityArias[slot] ?? slot
}

const STATIC_ARIA: Record<string, string> = {
  ATK: 'Attack nearest enemy',
  MOVE: 'Move',
  SHOP: 'Toggle shop',
  SCORE: 'Toggle scoreboard',
}
</script>

<template>
  <div class="action-row" data-testid="action-row">
    <div class="flex gap-1 overflow-x-auto px-2 py-1.5">
      <button
        v-for="cmd in ['ATK', 'Q', 'W', 'E', 'R', 'MOVE', 'SHOP', 'SCORE']"
        :key="cmd"
        class="hud-action-btn min-h-9 min-w-9 whitespace-nowrap border border-border bg-bg-primary px-2 py-1 font-mono t-hud-sm text-text-primary transition-colors active:bg-border"
        :class="{
          'border-gold text-gold': cmd === 'SHOP' && canBuy,
          'border-ability text-ability':
            ['Q', 'W', 'E', 'R'].includes(cmd) && abilities[cmd]?.ready,
          'cursor-not-allowed border-border/50 text-text-dim opacity-50':
            ['Q', 'W', 'E', 'R'].includes(cmd) && !abilities[cmd]?.ready,
          'border-self text-self': cmd === 'SCORE' && scoreboardOpen,
          'border-chaff text-chaff': accent === cmd,
        }"
        :disabled="['Q', 'W', 'E', 'R'].includes(cmd) && !abilities[cmd]?.ready"
        :title="cmd === 'SHOP' ? 'Shop — click, or press Esc then S' : undefined"
        :aria-label="['Q', 'W', 'E', 'R'].includes(cmd) ? abilityAria(cmd) : STATIC_ARIA[cmd]"
        :aria-disabled="
          ['Q', 'W', 'E', 'R'].includes(cmd) && !abilities[cmd]?.ready ? 'true' : undefined
        "
        :aria-pressed="
          cmd === 'SHOP'
            ? shopOpen
            : cmd === 'SCORE'
              ? scoreboardOpen
              : cmd === 'MOVE'
                ? showMovePicker
                : undefined
        "
        :data-testid="`action-${cmd.toLowerCase()}`"
        @click="onStatic(cmd)"
      >
        [{{ ['Q', 'W', 'E', 'R'].includes(cmd) ? (abilities[cmd]?.label ?? cmd) : cmd }}]
      </button>
    </div>

    <!-- [MOVE] picker: one tap per adjacent zone, named as the rest of the UI
         names them. -->
    <div
      v-if="showMovePicker"
      class="flex flex-wrap gap-1 px-2 pb-1.5"
      data-testid="move-picker"
      role="group"
      aria-label="Move to an adjacent zone"
    >
      <button
        v-for="z in moveZones"
        :key="z.id"
        class="hud-action-btn min-h-[44px] whitespace-nowrap border border-chaff/50 bg-bg-secondary px-2 py-1 font-mono t-hud-sm text-chaff transition-all active:bg-border active:scale-95"
        :class="{ 'opacity-60': z.fogged }"
        :data-testid="`move-picker-${z.id}`"
        :aria-label="`Move to ${z.name}`"
        @click="pickMove(z.id)"
      >
        ▸ {{ z.name }}
      </button>
    </div>

    <!-- Situational verbs — only when legal, so tap/strip/burn/backup/cache/
         harden/surrender are touch-usable and discoverable. -->
    <div
      v-if="situational.length"
      class="flex flex-wrap gap-1 px-2 pb-1.5"
      data-testid="situational-actions"
    >
      <button
        v-for="a in situational"
        :key="a.cmd"
        class="hud-action-btn min-h-[44px] whitespace-nowrap border border-ability/40 bg-bg-secondary px-2 py-1 font-mono t-hud-sm text-ability transition-all active:bg-border active:scale-95"
        :data-testid="`situational-${a.cmd}`"
        :aria-label="a.aria"
        @click="emit('command', a.cmd)"
      >
        {{ a.label }}
      </button>
    </div>
  </div>
</template>

<style scoped>
/* Desktop (fine pointer, wide): the prompt is primary — the strip hides and
   the verbs stay reachable through Tab-completion and help (R3-09).
   Narrow / cut screens keep the strip even with a mouse: the prompt is too
   small to be the only verb surface (first-play finding on a split pane). */
@media (pointer: fine) and (min-width: 901px) {
  .action-row {
    display: none;
  }
}
</style>
