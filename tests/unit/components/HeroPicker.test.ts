import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import HeroPicker from '~~/app/components/lobby/HeroPicker.vue'
import { HEROES, HERO_IDS } from '~~/shared/constants/heroes'
import type { TeamId } from '~~/shared/types/game'

// Stubs for Nuxt auto-imported components
const AsciiButtonStub = {
  props: ['label', 'variant', 'disabled'],
  emits: ['click'],
  template: `<button :disabled="disabled" data-testid="ascii-button" @click="$emit('click')">{{ label }}</button>`,
}
const HeroPortraitStub = {
  props: ['heroId', 'size'],
  template: `<span data-testid="hero-avatar" />`,
}

function mountPicker(props: Record<string, unknown> = {}) {
  return mount(HeroPicker, {
    props: {
      team: 'chaff' as TeamId,
      myPlayerId: 'me',
      ...props,
    },
    global: {
      stubs: {
        AsciiButton: AsciiButtonStub,
        HeroPortrait: HeroPortraitStub,
      },
    },
  })
}

const roster = [
  { playerId: 'me', name: 'Me', heroId: null, team: 'chaff' as TeamId },
  { playerId: 'p2', name: 'Ally', heroId: null, team: 'chaff' as TeamId },
  { playerId: 'e1', name: 'Enemy', heroId: null, team: 'audit' as TeamId },
]

describe('HeroPicker', () => {
  describe('turn gating', () => {
    it('disables CONFIRM when it is not my turn, even with a hero selected', async () => {
      const wrapper = mountPicker({
        currentPicker: { playerId: 'p2', username: 'Ally' },
      })

      await wrapper.find('[data-testid="hero-card-echo"]').trigger('click')

      const btn = wrapper.find('[data-testid="ascii-button"]')
      expect(btn.attributes('disabled')).toBeDefined()
      expect(wrapper.emitted('pick')).toBeUndefined()
    })

    it('enables CONFIRM on my turn with a hero selected and emits pick', async () => {
      const wrapper = mountPicker({
        currentPicker: { playerId: 'me', username: 'Me' },
      })

      await wrapper.find('[data-testid="hero-card-echo"]').trigger('click')

      const btn = wrapper.find('[data-testid="ascii-button"]')
      expect(btn.attributes('disabled')).toBeUndefined()

      await btn.trigger('click')
      expect(wrapper.emitted('pick')).toEqual([['echo']])
    })

    it('selects a hero by keyboard (Enter) — the card is a focusable button', async () => {
      const wrapper = mountPicker({
        currentPicker: { playerId: 'me', username: 'Me' },
      })

      const card = wrapper.find('[data-testid="hero-card-echo"]')
      // exposed as a keyboard-operable control
      expect(card.attributes('role')).toBe('button')
      expect(card.attributes('tabindex')).toBe('0')

      await card.trigger('keydown.enter')
      expect(card.attributes('aria-pressed')).toBe('true')

      const btn = wrapper.find('[data-testid="ascii-button"]')
      expect(btn.attributes('disabled')).toBeUndefined()
      await btn.trigger('click')
      expect(wrapper.emitted('pick')).toEqual([['echo']])
    })

    it('does not emit pick when confirming out of turn', async () => {
      const wrapper = mountPicker({
        currentPicker: { playerId: 'p2', username: 'Ally' },
      })

      await wrapper.find('[data-testid="hero-card-echo"]').trigger('click')
      // Force-trigger the click even though the button is disabled
      await wrapper.find('[data-testid="ascii-button"]').trigger('click')

      expect(wrapper.emitted('pick')).toBeUndefined()
    })

    it('disables CONFIRM after my pick is registered', async () => {
      const wrapper = mountPicker({
        currentPicker: { playerId: 'me', username: 'Me' },
        pickedHeroes: { me: 'echo' },
      })

      const btn = wrapper.find('[data-testid="ascii-button"]')
      expect(btn.attributes('disabled')).toBeDefined()
    })
  })

  describe('turn banner', () => {
    it('shows a prominent YOUR TURN banner on my turn', () => {
      const wrapper = mountPicker({
        currentPicker: { playerId: 'me', username: 'Me' },
      })

      const banner = wrapper.find('[data-testid="turn-banner"]')
      expect(banner.exists()).toBe(true)
      expect(banner.text()).toContain('YOUR TURN TO PICK')
    })

    it("shows who is picking when it is someone else's turn", () => {
      const wrapper = mountPicker({
        currentPicker: { playerId: 'p2', username: 'Ally' },
      })

      const banner = wrapper.find('[data-testid="turn-banner"]')
      expect(banner.text()).toContain('waiting: Ally is picking')
    })

    it('renders no banner before the first pick_turn arrives', () => {
      const wrapper = mountPicker({ currentPicker: null })
      expect(wrapper.find('[data-testid="turn-banner"]').exists()).toBe(false)
    })
  })

  describe('error surface', () => {
    it('renders the inline error notice when errorMessage is set', () => {
      const wrapper = mountPicker({
        currentPicker: { playerId: 'me', username: 'Me' },
        errorMessage: 'Not your turn to pick',
      })

      const err = wrapper.find('[data-testid="pick-error"]')
      expect(err.exists()).toBe(true)
      expect(err.text()).toContain('Not your turn to pick')
    })

    it('hides the error notice when there is no error', () => {
      const wrapper = mountPicker({})
      expect(wrapper.find('[data-testid="pick-error"]').exists()).toBe(false)
    })
  })

  describe('confirm reset (failed pick recovery)', () => {
    it('re-enables CONFIRM after an optimistic pick is rolled back', async () => {
      const wrapper = mountPicker({
        currentPicker: { playerId: 'me', username: 'Me' },
        pickedHeroes: {},
      })

      await wrapper.find('[data-testid="hero-card-echo"]').trigger('click')
      await wrapper.find('[data-testid="ascii-button"]').trigger('click')
      expect(wrapper.emitted('pick')).toHaveLength(1)

      // Parent applies the optimistic pick…
      await wrapper.setProps({ pickedHeroes: { me: 'echo' } })
      expect(wrapper.find('[data-testid="ascii-button"]').attributes('disabled')).toBeDefined()

      // …then the server rejects it and the parent rolls it back
      await wrapper.setProps({ pickedHeroes: {} })

      expect(wrapper.find('[data-testid="ascii-button"]').attributes('disabled')).toBeUndefined()

      await wrapper.find('[data-testid="ascii-button"]').trigger('click')
      expect(wrapper.emitted('pick')).toHaveLength(2)
    })

    it('resets the confirm latch when the pick turn moves on', async () => {
      const wrapper = mountPicker({
        currentPicker: { playerId: 'me', username: 'Me' },
      })

      await wrapper.find('[data-testid="hero-card-echo"]').trigger('click')
      await wrapper.find('[data-testid="ascii-button"]').trigger('click')

      // Turn moves to someone else without my pick landing (rejected silently)
      await wrapper.setProps({ currentPicker: { playerId: 'p2', username: 'Ally' } })
      // Then it is my turn again
      await wrapper.setProps({ currentPicker: { playerId: 'me', username: 'Me' } })

      expect(wrapper.find('[data-testid="ascii-button"]').attributes('disabled')).toBeUndefined()
    })
  })

  describe('mobile roster strip', () => {
    it('renders a compact strip with one slot per player', () => {
      const wrapper = mountPicker({
        teamRoster: roster,
        currentPicker: { playerId: 'me', username: 'Me' },
      })

      const strip = wrapper.find('[data-testid="roster-strip"]')
      expect(strip.exists()).toBe(true)
      // 5 chaff + 5 audit slots
      expect(strip.findAll('div').length).toBe(10)
      // Unpicked players show their initial
      expect(strip.text()).toContain('M')
    })
  })

  describe('hero selection', () => {
    it('does not select heroes that are already picked', async () => {
      const wrapper = mountPicker({
        currentPicker: { playerId: 'me', username: 'Me' },
        pickedHeroes: { e1: 'echo' },
      })

      await wrapper.find('[data-testid="hero-card-echo"]').trigger('click')

      const btn = wrapper.find('[data-testid="ascii-button"]')
      expect(btn.attributes('disabled')).toBeDefined()
    })
  })

  describe('hero detail panel (draft info)', () => {
    it('shows the selected hero passive + ability descriptions for informed drafting', async () => {
      const wrapper = mountPicker()
      await wrapper.find('[data-testid="hero-card-echo"]').trigger('click')

      // Passive: name + what it actually does (echo's Resonance)
      const passive = wrapper.find('[data-testid="picker-passive"]')
      expect(passive.exists()).toBe(true)
      expect(passive.text()).toContain('Resonance')
      expect(passive.text().toLowerCase()).toContain('consecutive')

      // Every ability shows a description, not just its name/MP/CD
      for (const slot of ['q', 'w', 'e', 'r'] as const) {
        const desc = wrapper.find(`[data-testid="picker-ability-desc-${slot}"]`)
        expect(desc.exists()).toBe(true)
        expect(desc.text().length).toBeGreaterThan(3)
      }
    })

    it('shows the select prompt and no passive panel before a hero is chosen', () => {
      const wrapper = mountPicker()
      expect(wrapper.find('[data-testid="picker-passive"]').exists()).toBe(false)
      expect(wrapper.text()).toContain('select a handle')
    })

    it('shows kit-identity playstyle tags for the selected hero', async () => {
      const wrapper = mountPicker()
      await wrapper.find('[data-testid="hero-card-echo"]').trigger('click')

      const tags = wrapper.find('[data-testid="picker-playstyle"]')
      expect(tags.exists()).toBe(true)
      // echo is a burst carry — at least one tag, all from the known set.
      const chips = tags.findAll('span').map((s) => s.text())
      expect(chips.length).toBeGreaterThan(0)
      const known = ['Burst', 'Damage over time', 'Control', 'Sustain', 'Mobility']
      for (const c of chips) expect(known).toContain(c)
    })

    it('shows no playstyle tags before a hero is chosen', () => {
      const wrapper = mountPicker()
      expect(wrapper.find('[data-testid="picker-playstyle"]').exists()).toBe(false)
    })
  })

  describe('finding a hero in the grid', () => {
    it('narrows the grid to one posture when a posture tab is active', async () => {
      const wrapper = mountPicker()
      expect(wrapper.find('[data-testid="hero-card-echo"]').exists()).toBe(true)

      await wrapper.find('[data-testid="posture-tab-HOLD"]').trigger('click')

      // kernel is HOLD; echo is HARDLINE
      expect(wrapper.find('[data-testid="hero-card-kernel"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="hero-card-echo"]').exists()).toBe(false)
      const holds = HERO_IDS.filter((id) => HEROES[id]!.posture === 'HOLD').length
      expect(wrapper.get('[data-testid="hero-count"]').text()).toBe(`${holds}/${HERO_IDS.length}`)
      // every visible card carries the filtered posture
      for (const card of wrapper.findAll('[data-posture]')) {
        expect(card.attributes('data-posture')).toBe('HOLD')
      }
    })

    it('filters by typed text, case-insensitively, and stacks with the posture tab', async () => {
      const wrapper = mountPicker()

      await wrapper.find('[data-testid="hero-search"]').setValue('KERN')
      expect(wrapper.find('[data-testid="hero-card-kernel"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="hero-card-echo"]').exists()).toBe(false)

      // kernel is HOLD, so a BREACH tab plus that text matches nothing
      await wrapper.find('[data-testid="posture-tab-BREACH"]').trigger('click')
      expect(wrapper.find('[data-testid="hero-card-kernel"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="hero-empty"]').exists()).toBe(true)
    })

    it('restores the full grid from the empty state', async () => {
      const wrapper = mountPicker()
      await wrapper.find('[data-testid="hero-search"]').setValue('zzzz')
      expect(wrapper.find('[data-testid="hero-empty"]').exists()).toBe(true)

      await wrapper.find('[data-testid="hero-filter-clear"]').trigger('click')

      expect(wrapper.find('[data-testid="hero-empty"]').exists()).toBe(false)
      expect(wrapper.get('[data-testid="hero-count"]').text()).toBe(
        `${HERO_IDS.length}/${HERO_IDS.length}`,
      )
    })
  })

  describe('[RANDOM]', () => {
    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('never lands on a hero that is already taken', async () => {
      // Only `echo` is left, and the roll is pinned at the TOP of the range —
      // an unfiltered pool would land on the last card in the grid instead.
      const taken = Object.fromEntries(
        HERO_IDS.filter((id) => id !== 'echo' && id !== 'cache').map((id, i) => [`p${i}`, id]),
      )
      const wrapper = mountPicker({
        currentPicker: { playerId: 'me', username: 'Me' },
        pickedHeroes: taken,
        bannedHeroes: ['cache'],
      })

      vi.spyOn(Math, 'random').mockReturnValue(0.999)
      await wrapper.find('[data-testid="hero-random"]').trigger('click')

      expect(wrapper.get('[data-testid="hero-card-echo"]').attributes('aria-pressed')).toBe('true')
      await wrapper.find('[data-testid="ascii-button"]').trigger('click')
      expect(wrapper.emitted('pick')).toEqual([['echo']])
    })

    it('rolls outside the filter rather than no-oping when nothing in it is left', async () => {
      const tanks = HERO_IDS.filter((id) => HEROES[id]!.role === 'tank')
      const taken = Object.fromEntries(tanks.map((id, i) => [`p${i}`, id]))
      const wrapper = mountPicker({
        currentPicker: { playerId: 'me', username: 'Me' },
        pickedHeroes: taken,
      })
      await wrapper.find('[data-testid="posture-tab-HOLD"]').trigger('click')

      vi.spyOn(Math, 'random').mockReturnValue(0.999)
      await wrapper.find('[data-testid="hero-random"]').trigger('click')
      await wrapper.find('[data-testid="ascii-button"]').trigger('click')

      const rolled = wrapper.emitted('pick')?.[0]?.[0] as string
      expect(rolled).toBeDefined()
      expect(tanks).not.toContain(rolled)
    })

    it('stops rolling once the pick is locked in', async () => {
      const wrapper = mountPicker({
        currentPicker: { playerId: 'me', username: 'Me' },
        pickedHeroes: { me: 'echo' },
      })

      const btn = wrapper.get('[data-testid="hero-random"]')
      expect(btn.attributes('disabled')).toBeDefined()

      vi.spyOn(Math, 'random').mockReturnValue(0)
      await btn.trigger('click')

      // A re-roll after locking in would show a hero the player cannot have.
      expect(wrapper.find('[data-testid="hero-card-echo"]').attributes('aria-pressed')).toBe(
        'false',
      )
    })

    it('rolls within the active filter', async () => {
      const wrapper = mountPicker({ currentPicker: { playerId: 'me', username: 'Me' } })
      await wrapper.find('[data-testid="posture-tab-HOLD"]').trigger('click')

      vi.spyOn(Math, 'random').mockReturnValue(0)
      await wrapper.find('[data-testid="hero-random"]').trigger('click')
      await wrapper.find('[data-testid="ascii-button"]').trigger('click')

      const rolled = wrapper.emitted('pick')?.[0]?.[0] as string
      expect(HEROES[rolled]!.role).toBe('tank')
    })
  })

  describe('beginner guidance', () => {
    it('badges only heroes whose whole kit is self- or single-target', () => {
      const wrapper = mountPicker()
      const badged = HERO_IDS.filter((id) =>
        wrapper.find(`[data-testid="beginner-badge-${id}"]`).exists(),
      )

      expect(badged.length).toBeGreaterThanOrEqual(3)
      expect(badged.length).toBeLessThanOrEqual(4)
      // The badge claims "easy to learn"; the mechanical half of that claim is
      // that nothing in the kit needs zone placement to aim.
      for (const id of badged) {
        const abilities = HEROES[id]!.abilities
        for (const slot of ['q', 'w', 'e', 'r'] as const) {
          expect(abilities[slot].targetType).not.toBe('zone')
        }
      }
    })

    it('pre-selects a badged hero for a player who has not finished the tutorial', () => {
      const wrapper = mountPicker({ newPlayer: true })

      const note = wrapper.find('[data-testid="beginner-recommendation"]')
      expect(note.exists()).toBe(true)
      const pressed = HERO_IDS.filter(
        (id) =>
          wrapper.find(`[data-testid="hero-card-${id}"]`).attributes('aria-pressed') === 'true',
      )
      expect(pressed).toHaveLength(1)
      expect(wrapper.find(`[data-testid="beginner-badge-${pressed[0]}"]`).exists()).toBe(true)
      expect(note.text()).toContain(HEROES[pressed[0]!]!.name)
    })

    it('leaves a returning player with an empty selection', () => {
      const wrapper = mountPicker()
      expect(wrapper.find('[data-testid="beginner-recommendation"]').exists()).toBe(false)
      expect(
        HERO_IDS.filter(
          (id) =>
            wrapper.find(`[data-testid="hero-card-${id}"]`).attributes('aria-pressed') === 'true',
        ),
      ).toHaveLength(0)
    })

    it('never pre-selects during the ban phase — that would arm a ban', () => {
      const wrapper = mountPicker({ newPlayer: true, mode: 'ban' })
      expect(wrapper.find('[data-testid="beginner-recommendation"]').exists()).toBe(false)
      expect(
        HERO_IDS.filter(
          (id) =>
            wrapper.find(`[data-testid="hero-card-${id}"]`).attributes('aria-pressed') === 'true',
        ),
      ).toHaveLength(0)
    })

    it('seeds the recommendation when the draft leaves the ban phase', async () => {
      // 10- and 6-player lobbies open on bans and REUSE this component for the
      // pick phase, so a mount-time-only seed would never fire for a ranked
      // first game — the exact case it exists for.
      const wrapper = mountPicker({ newPlayer: true, mode: 'ban' })

      await wrapper.setProps({ mode: 'pick' })

      const pressed = HERO_IDS.filter(
        (id) =>
          wrapper.find(`[data-testid="hero-card-${id}"]`).attributes('aria-pressed') === 'true',
      )
      expect(pressed).toHaveLength(1)
      expect(wrapper.find(`[data-testid="beginner-badge-${pressed[0]}"]`).exists()).toBe(true)
    })
  })

  describe('stale selection', () => {
    it('drops the highlighted hero when another drafter takes it', async () => {
      // The pre-selection is made at mount, potentially many turns before ours —
      // confirming it after someone else picked it would burn the turn.
      const wrapper = mountPicker({
        newPlayer: true,
        currentPicker: { playerId: 'p2', username: 'Ally' },
      })
      const mine = HERO_IDS.find(
        (id) =>
          wrapper.find(`[data-testid="hero-card-${id}"]`).attributes('aria-pressed') === 'true',
      )!

      await wrapper.setProps({
        pickedHeroes: { p2: mine },
        currentPicker: { playerId: 'me', username: 'Me' },
      })

      expect(wrapper.find(`[data-testid="hero-card-${mine}"]`).attributes('aria-pressed')).toBe(
        'false',
      )
      expect(wrapper.find('[data-testid="ascii-button"]').attributes('disabled')).toBeDefined()
      await wrapper.find('[data-testid="ascii-button"]').trigger('click')
      expect(wrapper.emitted('pick')).toBeUndefined()
    })
  })

  describe('auto-pick warning', () => {
    it('states what the countdown actually does, on our turn only', async () => {
      const wrapper = mountPicker({
        currentPicker: { playerId: 'p2', username: 'Ally' },
        pickDeadline: Date.now() + 11_500,
      })
      expect(wrapper.find('[data-testid="auto-pick-hint"]').exists()).toBe(false)

      await wrapper.setProps({ currentPicker: { playerId: 'me', username: 'Me' } })

      const hint = wrapper.get('[data-testid="auto-pick-hint"]')
      expect(hint.text()).toContain('auto-picks a random hero')
      // Derived from the server deadline, not a fixed 15 — a mid-turn reconnect
      // lands on whatever is left.
      expect(hint.text()).toContain('12s')
    })

    it('says bans during the ban phase', () => {
      const wrapper = mountPicker({
        mode: 'ban',
        currentPicker: { playerId: 'me', username: 'Me' },
      })
      expect(wrapper.get('[data-testid="auto-pick-hint"]').text()).toContain('auto-bans')
    })

    it('drops the warning once our pick is locked in', async () => {
      const wrapper = mountPicker({ currentPicker: { playerId: 'me', username: 'Me' } })
      expect(wrapper.find('[data-testid="auto-pick-hint"]').exists()).toBe(true)

      await wrapper.setProps({ pickedHeroes: { me: 'echo' } })

      expect(wrapper.find('[data-testid="auto-pick-hint"]').exists()).toBe(false)
    })
  })
})
