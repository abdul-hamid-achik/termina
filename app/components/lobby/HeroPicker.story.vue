<script setup lang="ts">
import type { TeamId } from '~~/shared/types/game'
import { SAMPLE_HEROES } from '~/stories/fixtures'
import HeroPicker from './HeroPicker.vue'

// Props-driven (no store). The draft is server-authoritative: the parent feeds
// the picked-heroes map, the per-team roster, whose turn it is (currentPicker),
// and the local player's id (myPlayerId) which gates CONFIRM. Variants cover the
// key draft states the lobby drives this component through.
type RosterMember = { playerId: string; name: string; heroId: string | null; team: TeamId }

const ROSTER: RosterMember[] = [
  { playerId: 'me', name: 'you', heroId: SAMPLE_HEROES.echo, team: 'radiant' },
  { playerId: 'p2', name: 'kernel_main', heroId: SAMPLE_HEROES.kernel, team: 'radiant' },
  { playerId: 'p3', name: 'support_sock', heroId: null, team: 'radiant' },
  { playerId: 'p4', name: 'proxy_jg', heroId: null, team: 'radiant' },
  { playerId: 'p5', name: 'cipher_off', heroId: null, team: 'radiant' },
  { playerId: 'e1', name: 'daemon_carry', heroId: SAMPLE_HEROES.daemon, team: 'dire' },
  { playerId: 'e2', name: 'regex_mid', heroId: SAMPLE_HEROES.regex, team: 'dire' },
  { playerId: 'e3', name: 'cache_sup', heroId: null, team: 'dire' },
  { playerId: 'e4', name: 'firewall_tank', heroId: null, team: 'dire' },
  { playerId: 'e5', name: 'nullref_pos5', heroId: null, team: 'dire' },
]

// Heroes already taken across both teams (drives the dimmed "PICKED" cards).
const PICKED: Record<string, string> = {
  me: SAMPLE_HEROES.echo,
  p2: SAMPLE_HEROES.kernel,
  e1: SAMPLE_HEROES.daemon,
  e2: SAMPLE_HEROES.regex,
}

// An empty roster (no one has joined the draft view yet) for the pre-draft state.
const EMPTY_ROSTER: RosterMember[] = []
</script>

<template>
  <Story title="Lobby/HeroPicker">
    <!-- It's the local player's turn: pulsing "YOUR TURN" banner, CONFIRM unlocks
         once a free hero is selected. -->
    <Variant title="my turn">
      <div class="bg-bg-primary" style="height: 620px">
        <HeroPicker
          team="radiant"
          my-player-id="me"
          :team-roster="ROSTER"
          :picked-heroes="PICKED"
          :current-picker="{ playerId: 'me', username: 'you' }"
          :time-remaining="28"
        />
      </div>
    </Variant>

    <!-- Waiting on a teammate: roster strip highlights the active picker, CONFIRM
         stays locked. -->
    <Variant title="waiting on ally">
      <div class="bg-bg-primary" style="height: 620px">
        <HeroPicker
          team="radiant"
          my-player-id="me"
          :team-roster="ROSTER"
          :picked-heroes="PICKED"
          :current-picker="{ playerId: 'p3', username: 'support_sock' }"
          :time-remaining="18"
        />
      </div>
    </Variant>

    <!-- Final seconds (<=10s): the countdown flips to the dire-glow pulse. -->
    <Variant title="countdown danger">
      <div class="bg-bg-primary" style="height: 620px">
        <HeroPicker
          team="radiant"
          my-player-id="me"
          :team-roster="ROSTER"
          :picked-heroes="PICKED"
          :current-picker="{ playerId: 'me', username: 'you' }"
          :time-remaining="7"
        />
      </div>
    </Variant>

    <!-- Server rejected a pick: inline [ERR] notice above the grid. -->
    <Variant title="pick error">
      <div class="bg-bg-primary" style="height: 620px">
        <HeroPicker
          team="radiant"
          my-player-id="me"
          :team-roster="ROSTER"
          :picked-heroes="PICKED"
          :current-picker="{ playerId: 'me', username: 'you' }"
          error-message="That hero was just taken — pick another"
          :time-remaining="22"
        />
      </div>
    </Variant>

    <!-- Pre-draft: no roster, no current picker, nothing picked yet. -->
    <Variant title="empty / pre-draft">
      <div class="bg-bg-primary" style="height: 620px">
        <HeroPicker
          team="radiant"
          my-player-id="me"
          :team-roster="EMPTY_ROSTER"
          :current-picker="null"
          :time-remaining="30"
        />
      </div>
    </Variant>
  </Story>
</template>
