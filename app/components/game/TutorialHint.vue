<script setup lang="ts">
import { computed } from 'vue'
import {
  TUTORIAL_FLOW,
  TUTORIAL_STEP_COUNT,
  tutorialHint,
  tutorialTryCommand,
  isTutorialComplete,
} from '~~/shared/constants/tutorial'

/**
 * Live tutorial strip. Renders at the top of the FEED so the current drill
 * stays on screen while the log scrolls — the navbar only has room for the
 * cycle clock.
 */
const props = defineProps<{
  /** Current tutorial step (0-based). >= TUTORIAL_STEP_COUNT means free play. */
  step: number
}>()

const emit = defineEmits<{
  command: [cmd: string]
}>()

const complete = computed(() => isTutorialComplete(props.step))
const hint = computed(() => tutorialHint(props.step)?.replace(/^🎓\s*/, '') ?? '')
const tryCmd = computed(() => tutorialTryCommand(props.step))
const progress = computed(() => Math.min(props.step, TUTORIAL_STEP_COUNT))

const items = computed(() =>
  TUTORIAL_FLOW.map((s, i) => ({
    verb: s.id,
    state: i < props.step ? 'done' : i === props.step ? 'current' : 'upcoming',
  })),
)
</script>

<template>
  <div
    class="flex flex-col gap-1 border-b border-ability/40 bg-ability/5 px-2 py-1.5 font-mono text-[0.78rem]"
    data-testid="tutorial-hint"
    role="status"
    aria-live="polite"
  >
    <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
      <span
        class="shrink-0 text-[0.66rem] font-bold uppercase tracking-wider text-ability text-glow-sm"
      >
        Tutorial
      </span>
      <span class="shrink-0 text-[0.7rem] text-text-dim" data-testid="tutorial-progress">
        {{ progress }}/{{ TUTORIAL_STEP_COUNT }}
      </span>
      <span class="flex flex-wrap items-center gap-1.5">
        <span
          v-for="item in items"
          :key="item.verb"
          class="text-[0.7rem]"
          :class="{
            'font-bold text-chaff': item.state === 'done',
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

    <p v-if="complete" class="min-w-0 text-chaff" data-testid="tutorial-complete">
      ✓ Practice complete — wrapping up.
    </p>
    <p
      v-else-if="hint"
      class="min-w-0 leading-snug text-text-primary"
      data-testid="tutorial-hint-text"
    >
      {{ hint }}
    </p>
    <button
      v-if="tryCmd && !complete"
      type="button"
      class="self-start border border-ability/50 bg-ability/10 px-1.5 py-0.5 text-[0.7rem] text-ability hover:bg-ability/20"
      data-testid="tutorial-try"
      @click="emit('command', tryCmd)"
    >
      try: {{ tryCmd }}
    </button>
  </div>
</template>
