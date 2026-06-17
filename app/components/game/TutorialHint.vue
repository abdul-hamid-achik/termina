<script setup lang="ts">
import { computed } from 'vue'
import {
  TUTORIAL_FLOW,
  TUTORIAL_STEP_COUNT,
  tutorialHint,
  isTutorialComplete,
} from '~~/shared/constants/tutorial'

/**
 * In-game tutorial banner: shows the current step's hint + a compact checklist
 * of the staggered command unlocks (move → attack → cast → buy). Driven purely
 * by `step` (the broadcast `tutorialStep`) so it's trivially storyable/testable;
 * GameScreen renders it only when `gameStore.mode === 'tutorial'`.
 */
const props = defineProps<{
  /** Current tutorial step (0-based). >= TUTORIAL_STEP_COUNT means free play. */
  step: number
}>()

const complete = computed(() => isTutorialComplete(props.step))
const hint = computed(() => tutorialHint(props.step))
// Clamp for the progress readout so "4/4" shows on the completion state.
const progress = computed(() => Math.min(props.step, TUTORIAL_STEP_COUNT))

/** Per-verb checklist state: done (past), current (active), or upcoming. */
const items = computed(() =>
  TUTORIAL_FLOW.map((s, i) => ({
    verb: s.teaches,
    state: i < props.step ? 'done' : i === props.step ? 'current' : 'upcoming',
  })),
)
</script>

<template>
  <div
    class="flex flex-col gap-1 border-b border-ability/40 bg-ability/5 px-3 py-1.5 font-mono text-[0.8rem]"
    data-testid="tutorial-hint"
    role="status"
    aria-live="polite"
  >
    <div class="flex items-center gap-2">
      <span
        class="shrink-0 text-[0.66rem] font-bold uppercase tracking-wider text-ability text-glow-sm"
      >
        Tutorial
      </span>
      <span class="shrink-0 text-[0.7rem] text-text-dim" data-testid="tutorial-progress">
        {{ progress }}/{{ TUTORIAL_STEP_COUNT }}
      </span>

      <!-- Per-verb checklist -->
      <span class="flex flex-wrap items-center gap-1.5">
        <span
          v-for="item in items"
          :key="item.verb"
          class="text-[0.7rem]"
          :class="{
            'font-bold text-radiant': item.state === 'done',
            'font-bold text-ability text-glow-sm': item.state === 'current',
            'text-text-dim': item.state === 'upcoming',
          }"
          :data-testid="`tutorial-step-${item.verb}`"
        >
          <span aria-hidden="true">{{
            item.state === 'done' ? '✓' : item.state === 'current' ? '▸' : '·'
          }}</span>
          {{ item.verb }}
        </span>
      </span>
    </div>

    <!-- Current hint, or the completion message. -->
    <p v-if="!complete && hint" class="min-w-0 text-text-primary" data-testid="tutorial-hint-text">
      {{ hint }}
    </p>
    <p v-else class="min-w-0 text-radiant" data-testid="tutorial-complete">
      ✓ Tutorial complete — you're in free play. Push mid and destroy the enemy core!
    </p>
  </div>
</template>
