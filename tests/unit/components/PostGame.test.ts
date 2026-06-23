import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import PostGame from '../../../app/components/lobby/PostGame.vue'
import { makePlayerEndStats, SAMPLE_HEROES, SAMPLE_ITEMS } from '../../../app/stories/fixtures'
import type { TeamId } from '../../../shared/types/game'
import type { PlayerEndStats } from '../../../shared/types/protocol'

// PostGame renders end-of-game stats. It auto-imports TerminalPanel /
// AsciiButton / NuxtLink in the live app; the components vitest project has no
// Nuxt auto-import, so we stub them. AsciiButton is stubbed with a real <button>
// that mirrors its `label` + `@click` contract so the emit assertions are real.
const AsciiButtonStub = {
  name: 'AsciiButton',
  props: ['label', 'variant', 'disabled'],
  emits: ['click'],
  template: `<button :data-variant="variant" @click="$emit('click', $event)">{{ label }}</button>`,
}

const TerminalPanelStub = {
  name: 'TerminalPanel',
  props: ['title', 'variant'],
  template: `<section><h3 v-if="title">{{ title }}</h3><slot /></section>`,
}

const NuxtLinkStub = {
  name: 'NuxtLink',
  props: ['to'],
  template: `<a :href="to"><slot /></a>`,
}

/** A 4-player, 2v2 roster (drawn from the shared fixture) keyed for stats. */
function smallRoster() {
  return [
    { id: 'p1', name: 'you', heroId: SAMPLE_HEROES.echo, team: 'radiant' as TeamId },
    { id: 'p2', name: 'kernel_main', heroId: SAMPLE_HEROES.kernel, team: 'radiant' as TeamId },
    { id: 'e1', name: 'daemon_carry', heroId: SAMPLE_HEROES.daemon, team: 'dire' as TeamId },
    { id: 'e2', name: 'regex_mid', heroId: SAMPLE_HEROES.regex, team: 'dire' as TeamId },
  ]
}

function smallStats(): Record<string, PlayerEndStats> {
  return {
    p1: makePlayerEndStats({ kills: 9, deaths: 2, assists: 7, gold: 8400, heroDamage: 31_200 }),
    p2: makePlayerEndStats({ kills: 3, deaths: 5, assists: 14, gold: 4100, heroDamage: 9800 }),
    e1: makePlayerEndStats({ kills: 6, deaths: 6, assists: 4, gold: 6900, heroDamage: 21_000 }),
    e2: makePlayerEndStats({ kills: 2, deaths: 8, assists: 5, gold: 3200, heroDamage: 7400 }),
  }
}

function mountPostGame(props: Partial<Parameters<typeof PostGame>[0]> = {}) {
  return mount(PostGame, {
    props: {
      winner: 'radiant' as TeamId,
      stats: smallStats(),
      players: smallRoster(),
      currentPlayerId: 'p1',
      ...props,
    },
    global: {
      stubs: {
        AsciiButton: AsciiButtonStub,
        TerminalPanel: TerminalPanelStub,
        NuxtLink: NuxtLinkStub,
      },
    },
  })
}

describe('PostGame', () => {
  describe('victory banner', () => {
    it('announces RADIANT VICTORY when radiant wins', () => {
      const wrapper = mountPostGame({ winner: 'radiant' })
      const banner = wrapper.find('[data-testid="post-game"]')
      expect(banner.text()).toContain('RADIANT VICTORY')
      expect(banner.text()).not.toContain('DIRE VICTORY')
    })

    it('announces DIRE VICTORY when dire wins', () => {
      const wrapper = mountPostGame({ winner: 'dire' })
      expect(wrapper.text()).toContain('DIRE VICTORY')
      expect(wrapper.text()).not.toContain('RADIANT VICTORY')
    })
  })

  describe('MMR change tile', () => {
    it('shows a signed MMR delta when provided', () => {
      expect(mountPostGame({ mmrChange: 25 }).text()).toContain('+25')
      expect(mountPostGame({ mmrChange: -18 }).text()).toContain('-18')
    })

    it('omits the MMR tile when no change is provided', () => {
      const wrapper = mountPostGame()
      // 'MMR' label only renders inside the tile (v-if mmrChange !== undefined)
      expect(wrapper.text()).not.toContain('MMR')
    })
  })

  describe('your-performance panel', () => {
    it("shows the current player's K/D/A, damage and gold", () => {
      const wrapper = mountPostGame()
      const text = wrapper.text()
      // p1 stats: 9/2/7, 31,200 hero dmg, 8,400 gold (toLocaleString → grouped)
      expect(text).toContain('9')
      expect(text).toContain('31,200')
      expect(text).toContain('8,400')
    })

    it('renders an MMR delta with a sign when provided', () => {
      const gain = mountPostGame({ mmrChange: 27 })
      expect(gain.text()).toContain('+27')

      const loss = mountPostGame({ mmrChange: -18 })
      expect(loss.text()).toContain('-18')
    })

    it('omits the MMR field when mmrChange is undefined', () => {
      const wrapper = mountPostGame()
      expect(wrapper.text()).not.toContain('MMR')
    })

    it('hides the performance panel when the current player has no stats', () => {
      const wrapper = mountPostGame({ currentPlayerId: 'ghost' })
      expect(wrapper.text()).not.toContain('Your Performance')
      // The scoreboard panel still renders.
      expect(wrapper.text()).toContain('Scoreboard')
    })
  })

  describe('scoreboard', () => {
    it('splits players into RADIANT and DIRE sections with hero + player names', () => {
      const wrapper = mountPostGame()
      const text = wrapper.text()
      expect(text).toContain('RADIANT')
      expect(text).toContain('DIRE')
      // hero names resolved from HEROES
      expect(text).toContain('Echo')
      expect(text).toContain('Daemon')
      // player names
      expect(text).toContain('you')
      expect(text).toContain('daemon_carry')
    })

    it('renders one scoreboard row per player across both teams', () => {
      const wrapper = mountPostGame()
      const rows = wrapper.findAll('tbody tr')
      expect(rows).toHaveLength(4)
    })

    it('resolves item ids to readable item names', () => {
      const players = [
        { id: 'p1', name: 'you', heroId: SAMPLE_HEROES.echo, team: 'radiant' as TeamId },
      ]
      const stats: Record<string, PlayerEndStats> = {
        p1: makePlayerEndStats({
          items: [SAMPLE_ITEMS.salve, SAMPLE_ITEMS.treads, null, null, null, null],
        }),
      }
      const wrapper = mountPostGame({ players, stats, currentPlayerId: 'p1' })
      const text = wrapper.text()
      expect(text).toContain('Healing Salve')
      expect(text).toContain('Power Treads')
    })

    it('highlights the current player row', () => {
      const wrapper = mountPostGame()
      // the self-row gets the bg-ability/font-bold class block
      const highlighted = wrapper.findAll('tr.font-bold')
      expect(highlighted.length).toBe(1)
      expect(highlighted[0]!.text()).toContain('you')
    })

    it('defaults missing stats to zeros instead of crashing', () => {
      // e2 has no stats entry → row should still render with 0/0/0
      const stats = smallStats()
      delete stats.e2
      const wrapper = mountPostGame({ stats })
      const rows = wrapper.findAll('tbody tr')
      expect(rows).toHaveLength(4)
      expect(wrapper.text()).toContain('regex_mid')
    })
  })

  describe('actions', () => {
    it('emits playAgain when PLAY AGAIN is clicked', async () => {
      const wrapper = mountPostGame()
      await wrapper.get('[data-testid="play-again-btn"]').trigger('click')
      expect(wrapper.emitted('playAgain')).toHaveLength(1)
    })

    it('emits returnToMenu when MAIN MENU is clicked', async () => {
      const wrapper = mountPostGame()
      await wrapper.get('[data-testid="return-to-menu-btn"]').trigger('click')
      expect(wrapper.emitted('returnToMenu')).toHaveLength(1)
    })

    it('shows a WATCH REPLAY link to the replay route only when a gameId is present', () => {
      const without = mountPostGame()
      expect(without.find('a[href^="/replay/"]').exists()).toBe(false)

      const withId = mountPostGame({ gameId: 'game_abc' })
      const link = withId.find('a[href^="/replay/"]')
      expect(link.exists()).toBe(true)
      expect(link.attributes('href')).toBe('/replay/game_abc')
      expect(link.text()).toContain('WATCH REPLAY')
    })
  })

  describe('tutorial wrap-up', () => {
    it('frames a normal game as a match, with a PLAY AGAIN button and no tutorial note', () => {
      const wrapper = mountPostGame()
      expect(wrapper.text()).toContain('match concluded')
      expect(wrapper.find('[data-testid="tutorial-wrapup"]').exists()).toBe(false)
      expect(wrapper.get('[data-testid="play-again-btn"]').text()).toBe('PLAY AGAIN')
    })

    it('celebrates a tutorial and nudges toward a real match', () => {
      const wrapper = mountPostGame({ mode: 'tutorial' })
      expect(wrapper.text()).toContain('tutorial complete')
      expect(wrapper.get('[data-testid="tutorial-wrapup"]').text()).toContain('Ready for a real')
      // The primary CTA (still the playAgain emit → lobby) is relabelled.
      const cta = wrapper.get('[data-testid="play-again-btn"]')
      expect(cta.text()).toBe('FIND A REAL MATCH')
    })

    it('still emits playAgain from the relabelled tutorial CTA', async () => {
      const wrapper = mountPostGame({ mode: 'tutorial' })
      await wrapper.get('[data-testid="play-again-btn"]').trigger('click')
      expect(wrapper.emitted('playAgain')).toHaveLength(1)
    })
  })

  describe('match MVP', () => {
    it('crowns the highest-impact performer', () => {
      // p1 ("you"): 9k/2d/7a + 31.2k dmg dominates the default roster.
      const mvp = mountPostGame().find('[data-testid="post-game-mvp"]')
      expect(mvp.exists()).toBe(true)
      expect(mvp.get('[data-testid="mvp-name"]').text()).toContain('you')
    })

    it('can crown a losing-team player who out-performed everyone', () => {
      const stats = smallStats()
      stats.e1 = makePlayerEndStats({
        kills: 20,
        deaths: 0,
        assists: 10,
        gold: 12_000,
        heroDamage: 50_000,
      })
      const wrapper = mountPostGame({ stats, winner: 'radiant' })
      // MVP is the absolute best individual game, even on the losing side.
      expect(wrapper.get('[data-testid="mvp-name"]').text()).toContain('daemon_carry')
    })
  })
})
