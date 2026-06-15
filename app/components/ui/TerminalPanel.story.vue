<script setup lang="ts">
import TerminalPanel from './TerminalPanel.vue'
</script>

<!--
  Pure slot/props panel chrome. Covers the title bar (present/absent), the three
  border variants (default/highlight/danger), and content overflow/scroll. Sized
  with a themed wrapper since the panel is flex/min-w-0 and grows to its parent.
-->
<template>
  <Story title="UI/TerminalPanel" :layout="{ type: 'grid', width: 360 }">
    <Variant title="default + title">
      <div class="bg-bg-primary p-2" style="width: 320px">
        <TerminalPanel title="Scoreboard">
          <p class="font-mono text-xs text-text-primary">Radiant 14 — 9 Dire</p>
        </TerminalPanel>
      </div>
    </Variant>

    <Variant title="no title">
      <div class="bg-bg-primary p-2" style="width: 320px">
        <TerminalPanel>
          <p class="font-mono text-xs text-text-primary">A bare panel with no header bar.</p>
        </TerminalPanel>
      </div>
    </Variant>

    <Variant title="highlight variant">
      <div class="bg-bg-primary p-2" style="width: 320px">
        <TerminalPanel title="Objective" variant="highlight">
          <p class="font-mono text-xs text-text-primary">Roshan is vulnerable — group mid.</p>
        </TerminalPanel>
      </div>
    </Variant>

    <Variant title="danger variant">
      <div class="bg-bg-primary p-2" style="width: 320px">
        <TerminalPanel title="Ancient Under Attack" variant="danger">
          <p class="font-mono text-xs text-dire">Defend the base!</p>
        </TerminalPanel>
      </div>
    </Variant>

    <Variant title="long title (truncates)">
      <div class="bg-bg-primary p-2" style="width: 240px">
        <TerminalPanel title="A Very Long Panel Title That Should Truncate In The Header">
          <p class="font-mono text-xs text-text-primary">Header truncates, body wraps.</p>
        </TerminalPanel>
      </div>
    </Variant>

    <Variant title="overflowing content (scrolls)">
      <div class="bg-bg-primary p-2" style="width: 320px; height: 160px">
        <TerminalPanel title="Combat Log">
          <ul class="space-y-1 font-mono text-xs text-text-primary">
            <li v-for="n in 20" :key="n">[t{{ 230 + n }}] echo slew regex in mid-river</li>
          </ul>
        </TerminalPanel>
      </div>
    </Variant>
  </Story>
</template>
