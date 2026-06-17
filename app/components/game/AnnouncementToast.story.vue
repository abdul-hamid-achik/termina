<script setup lang="ts">
import { defineComponent, h, onMounted, ref } from 'vue'
import AnnouncementToast from './AnnouncementToast.vue'

type Level = 'info' | 'warning' | 'kill' | 'objective' | 'error'

// The toast only appears when `seq` CHANGES (the component watches seq, and the
// watch is non-immediate), so each static demo bumps seq 0→1 on mount. Doing it
// per-instance works with Histoire's lazy per-variant rendering — every demo
// fires when IT mounts, regardless of navigation order. A long duration keeps it
// up for the workbench and the build screenshot.
const ToastDemo = defineComponent({
  props: {
    msg: { type: String, required: true },
    lvl: { type: String as () => Level, default: 'warning' },
  },
  setup(props) {
    const demoSeq = ref(0)
    onMounted(() => {
      demoSeq.value = 1
    })
    return () =>
      h('div', { class: 'relative bg-bg-primary', style: 'height: 140px; width: 480px' }, [
        h(AnnouncementToast, {
          text: props.msg,
          seq: demoSeq.value,
          level: props.lvl,
          durationMs: 600000,
        }),
      ])
  },
})

// Interactive variant state (retained from the original story).
const seq = ref(0)
const text = ref('')
const level = ref<Level>('warning')
function show(msg: string, lvl: Level) {
  text.value = msg
  level.value = lvl
  seq.value++
}
onMounted(() => show('Target is not in your zone', 'warning'))
</script>

<template>
  <Story title="Game/AnnouncementToast">
    <!-- One static variant per severity so the workbench shows each toast's
         colour + icon directly (and the build screenshots capture them). The
         `kill` severity is shown nowhere else. -->
    <Variant title="warning (rejection)">
      <ToastDemo msg="Target is not in your zone" lvl="warning" />
    </Variant>
    <Variant title="info">
      <ToastDemo msg="Reconnected to game" lvl="info" />
    </Variant>
    <Variant title="objective">
      <ToastDemo msg="Roshan has been slain!" lvl="objective" />
    </Variant>
    <Variant title="kill">
      <ToastDemo msg="First Blood!" lvl="kill" />
    </Variant>
    <Variant title="error">
      <ToastDemo msg="[ERROR] Connection lost. Reconnecting…" lvl="error" />
    </Variant>

    <Variant title="interactive (all severities)">
      <div class="relative bg-bg-primary" style="height: 240px; width: 480px">
        <!-- Long duration so it persists for the screenshot; the buttons retrigger. -->
        <AnnouncementToast :text="text" :seq="seq" :level="level" :duration-ms="600000" />
        <div
          class="absolute bottom-3 left-1/2 flex -translate-x-1/2 flex-wrap justify-center gap-2"
        >
          <button
            class="t-mono rounded border border-warn px-2 py-1 text-xs text-warn"
            @click="show('Target is not in your zone', 'warning')"
          >
            warning
          </button>
          <button
            class="t-mono rounded border border-self px-2 py-1 text-xs text-self"
            @click="show('Reconnected to game', 'info')"
          >
            info
          </button>
          <button
            class="t-mono rounded border border-gold px-2 py-1 text-xs text-gold"
            @click="show('Roshan has been slain!', 'objective')"
          >
            objective
          </button>
          <button
            class="t-mono rounded border border-dire px-2 py-1 text-xs text-dire"
            @click="show('First Blood!', 'kill')"
          >
            kill
          </button>
          <button
            class="t-mono rounded border border-dire px-2 py-1 text-xs text-dire"
            @click="show('[ERROR] Connection lost. Reconnecting…', 'error')"
          >
            error
          </button>
        </div>
      </div>
    </Variant>
  </Story>
</template>
