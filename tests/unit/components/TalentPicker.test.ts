import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TalentPicker from '../../../app/components/game/TalentPicker.vue'
import { TALENT_TREES } from '../../../shared/constants/talents'
import type { PlayerState } from '../../../shared/types/game'

function makePlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: 'p1',
    name: 'Test',
    team: 'radiant',
    heroId: 'echo',
    zone: 'mid-river',
    hp: 500,
    maxHp: 500,
    mp: 200,
    maxMp: 200,
    level: 10,
    xp: 0,
    gold: 0,
    items: [null, null, null, null, null, null],
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    buffs: [],
    alive: true,
    respawnTick: null,
    defense: 5,
    magicResist: 15,
    kills: 0,
    deaths: 0,
    assists: 0,
    damageDealt: 0,
    towerDamageDealt: 0,
    killStreak: 0,
    talents: { tier10: null, tier15: null, tier20: null, tier25: null },
    ...overrides,
  }
}

describe('TalentPicker', () => {
  it('shows the tier-10 options once the player reaches level 10', () => {
    const w = mount(TalentPicker, { props: { player: makePlayer({ level: 10 }) } })
    expect(w.find('[data-testid="talent-picker"]').exists()).toBe(true)
    const tier10 = TALENT_TREES.echo.tiers[10]
    expect(w.find('[data-testid="talent-pick-left"]').text()).toContain(tier10[0].name)
    expect(w.find('[data-testid="talent-pick-right"]').text()).toContain(tier10[1].name)
  })

  it('emits pick with the tier and side when an option is clicked', async () => {
    const w = mount(TalentPicker, { props: { player: makePlayer({ level: 10 }) } })
    await w.find('[data-testid="talent-pick-right"]').trigger('click')
    expect(w.emitted('pick')).toEqual([[10, 'right']])
  })

  it('hides until the player has reached a talent level', () => {
    const w = mount(TalentPicker, { props: { player: makePlayer({ level: 9 }) } })
    expect(w.find('[data-testid="talent-picker"]').exists()).toBe(false)
  })

  it('advances to the next unchosen tier', () => {
    const w = mount(TalentPicker, {
      props: {
        player: makePlayer({
          level: 16,
          talents: { tier10: 'echo_10_left', tier15: null, tier20: null, tier25: null },
        }),
      },
    })
    const tier15 = TALENT_TREES.echo.tiers[15]
    expect(w.find('[data-testid="talent-pick-left"]').text()).toContain(tier15[0].name)
  })

  it('renders nothing with no player', () => {
    const w = mount(TalentPicker, { props: { player: null } })
    expect(w.find('[data-testid="talent-picker"]').exists()).toBe(false)
  })

  it("renders the hero's OWN tailored tree (Cipher's tier-15 is its real abilities, not a generic menu)", () => {
    const w = mount(TalentPicker, {
      props: {
        player: makePlayer({
          heroId: 'cipher',
          level: 16,
          talents: { tier10: 'cipher_10_left', tier15: null, tier20: null, tier25: null },
        }),
      },
    })
    const cipher15 = TALENT_TREES.cipher.tiers[15]
    expect(w.find('[data-testid="talent-pick-left"]').text()).toContain(cipher15[0].name)
    // The flavorful, hero-specific talent — Cipher's real Q ability, not the old
    // shared "+25 Damage" generic line.
    expect(w.find('[data-testid="talent-pick-left"]').text()).toContain('XOR Strike')
  })
})
