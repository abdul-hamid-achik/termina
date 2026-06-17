import { describe, it, expect, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import CommandInput from '../../../app/components/game/CommandInput.vue'
import { makePlayer, SAMPLE_HEROES } from '../../../app/stories/fixtures'
import { ITEMS } from '../../../shared/constants/items'
import type { PlayerState } from '../../../shared/types/game'

/**
 * Focused coverage for CommandInput's rich `preview` computed and keyboard
 * driving (autocomplete navigation + command history). The existing
 * CommandInput.test.ts only smoke-tests one error + one submit path; these
 * exercise every preview branch and the arrow/Tab/Escape key handlers, which
 * were the component's largest uncovered surface.
 */

// A radiant hero parked in the fountain (a shop zone) so buy/sell validate, with
// generous gold/mana and everything off cooldown. Override per-test as needed.
function makeShopPlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return makePlayer({
    id: 'me',
    heroId: SAMPLE_HEROES.echo,
    zone: 'radiant-fountain',
    gold: 5000,
    mp: 400,
    maxMp: 400,
    cooldowns: { q: 0, w: 0, e: 0, r: 0 },
    items: [null, null, null, null, null, null],
    buffs: [],
    alive: true,
    ...overrides,
  })
}

function mountInput(player: PlayerState | null = makeShopPlayer(), extraProps = {}) {
  return mount(CommandInput, {
    props: { canAct: true, player, items: ITEMS, ...extraProps },
    attachTo: document.body,
  })
}

// Drive the v-model directly, then read the rendered preview line.
async function previewFor(wrapper: ReturnType<typeof mountInput>, value: string) {
  await wrapper.find('input').setValue(value)
  return wrapper.find('[data-testid="command-preview"]')
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('CommandInput preview line', () => {
  it('shows a "typing" dim hint for a partial command name', async () => {
    const wrapper = mountInput()
    const preview = await previewFor(wrapper, 'mo')
    expect(preview.text()).toContain('typing: mo')
    wrapper.unmount()
  })

  it('shows a usage hint once a bare command name is complete', async () => {
    const wrapper = mountInput()
    const preview = await previewFor(wrapper, 'move')
    expect(preview.text()).toContain('move: specify a zone')
    wrapper.unmount()
  })

  it('renders a valid move preview with the resolved zone name', async () => {
    // mid alias resolves to "Mid River Crossing"; fountain is adjacent to base only,
    // so move uses a player whose move target is reachable — preview reflects the dest name.
    const wrapper = mountInput(makeShopPlayer({ zone: 'mid-river' }))
    const preview = await previewFor(wrapper, 'move mid')
    expect(preview.text()).toContain('>> Move to Mid River Crossing')
    expect(preview.classes()).toContain('text-radiant')
    wrapper.unmount()
  })

  it('shows an error preview when moving to a non-adjacent zone', async () => {
    const wrapper = mountInput(makeShopPlayer({ zone: 'mid-river' }))
    const preview = await previewFor(wrapper, 'move dire-base')
    expect(preview.text()).toContain('!!')
    expect(preview.text().toLowerCase()).toContain('one zone per tick')
    expect(preview.classes()).toContain('text-dire')
    wrapper.unmount()
  })

  it('renders a valid attack preview against a hero target', async () => {
    const wrapper = mountInput(makeShopPlayer({ zone: 'mid-river' }))
    const preview = await previewFor(wrapper, 'attack creep:0')
    expect(preview.text()).toContain('>> Attack creep #0')
    wrapper.unmount()
  })

  it('renders a valid cast preview with the ability letter uppercased', async () => {
    const wrapper = mountInput()
    const preview = await previewFor(wrapper, 'cast q')
    expect(preview.text()).toContain('>> Cast Q')
    wrapper.unmount()
  })

  it('blocks a cast that is on cooldown with an error preview', async () => {
    const wrapper = mountInput(makeShopPlayer({ cooldowns: { q: 0, w: 0, e: 3, r: 0 } }))
    const preview = await previewFor(wrapper, 'cast e')
    expect(preview.text()).toContain('!!')
    expect(preview.text().toLowerCase()).toContain('cooldown')
    wrapper.unmount()
  })

  it('renders a buy preview with the item name and cost from the items map', async () => {
    const wrapper = mountInput()
    const preview = await previewFor(wrapper, 'buy healing_salve')
    expect(preview.text()).toContain('>> Buy Healing Salve')
    expect(preview.text()).toContain('-150g')
    wrapper.unmount()
  })

  it('errors a buy when outside a shop zone', async () => {
    const wrapper = mountInput(makeShopPlayer({ zone: 'mid-river' }))
    const preview = await previewFor(wrapper, 'buy healing_salve')
    expect(preview.text()).toContain('!!')
    expect(preview.text().toLowerCase()).toContain('shop')
    wrapper.unmount()
  })

  it('renders a sell preview for an owned item', async () => {
    const wrapper = mountInput(
      makeShopPlayer({ items: ['healing_salve', null, null, null, null, null] }),
    )
    const preview = await previewFor(wrapper, 'sell healing_salve')
    expect(preview.text()).toContain('>> Sell Healing Salve')
    wrapper.unmount()
  })

  it('renders a ward preview for the current zone', async () => {
    const wrapper = mountInput(makeShopPlayer({ zone: 'mid-river' }))
    const preview = await previewFor(wrapper, 'ward mid-river')
    expect(preview.text()).toContain('>> Place ward in mid-river')
    wrapper.unmount()
  })

  it('renders a buyback preview with the computed cost while dead', async () => {
    const wrapper = mountInput(
      makeShopPlayer({ alive: false, hp: 0, buybackCost: 1200, gold: 5000 }),
    )
    const preview = await previewFor(wrapper, 'buyback')
    expect(preview.text()).toContain('>> Buyback')
    expect(preview.text()).toContain('-1200g')
    wrapper.unmount()
  })

  it('renders a surrender-yes preview after confirm', async () => {
    const wrapper = mountInput(makeShopPlayer(), { tick: 500 })
    const preview = await previewFor(wrapper, 'surrender confirm')
    expect(preview.text()).toContain('Vote YES to surrender')
    wrapper.unmount()
  })

  it('renders simple-command previews (scan/status/map)', async () => {
    const wrapper = mountInput()
    expect((await previewFor(wrapper, 'scan')).text()).toContain('>> Scan nearby zone')
    expect((await previewFor(wrapper, 'status')).text()).toContain('>> Show hero status')
    expect((await previewFor(wrapper, 'map')).text()).toContain('>> Show map overview')
    wrapper.unmount()
  })

  it('makes help discoverable: typing hint, then a valid preview (not "unknown")', async () => {
    const wrapper = mountInput()
    // partial name → "typing" hint (proves help is in the known-command list)
    expect((await previewFor(wrapper, 'hel')).text()).toContain('typing: hel')
    // complete → a valid preview, never an unknown-command error
    const full = (await previewFor(wrapper, 'help')).text()
    expect(full).toContain('>> List all commands')
    expect(full.toLowerCase()).not.toContain('unknown')
    wrapper.unmount()
  })

  it('shows an error preview for an unknown command', async () => {
    const wrapper = mountInput()
    const preview = await previewFor(wrapper, 'frobnicate now')
    expect(preview.text()).toContain('!!')
    expect(preview.text().toLowerCase()).toContain('unknown command')
    wrapper.unmount()
  })

  it('shows no preview when the input is empty', async () => {
    const wrapper = mountInput()
    await wrapper.find('input').setValue('move')
    await wrapper.find('input').setValue('')
    expect(wrapper.find('[data-testid="command-preview"]').exists()).toBe(false)
    wrapper.unmount()
  })
})

describe('CommandInput keyboard driving', () => {
  it('does not submit a command whose preview is an error', async () => {
    const wrapper = mountInput(makeShopPlayer({ zone: 'mid-river' }))
    const input = wrapper.find('input')
    await input.setValue('move dire-base') // not adjacent -> error preview

    const vm = wrapper.vm as unknown as { open: boolean }
    vm.open = false
    await wrapper.vm.$nextTick()
    await input.trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('submit')).toBeUndefined()
    wrapper.unmount()
  })

  it('Tab opens the dropdown when suggestions exist', async () => {
    const wrapper = mountInput()
    const input = wrapper.find('input')
    await input.setValue('mo')

    const vm = wrapper.vm as unknown as { open: boolean }
    vm.open = false
    await wrapper.vm.$nextTick()

    await input.trigger('keydown', { key: 'Tab' })
    await wrapper.vm.$nextTick()

    expect((wrapper.vm as unknown as { open: boolean }).open).toBe(true)
    wrapper.unmount()
  })

  it('Escape closes an open dropdown without clearing the input', async () => {
    const wrapper = mountInput()
    const input = wrapper.find('input')
    await input.setValue('mov') // auto-opens

    const vm = wrapper.vm as unknown as { open: boolean; input: string }
    expect(vm.open).toBe(true)

    await input.trigger('keydown', { key: 'Escape' })
    await wrapper.vm.$nextTick()

    expect(vm.open).toBe(false)
    expect(vm.input).toBe('mov')
    wrapper.unmount()
  })

  it('Escape clears the input when the dropdown is already closed', async () => {
    const wrapper = mountInput()
    const input = wrapper.find('input')
    await input.setValue('garbage') // no suggestions -> stays closed

    const vm = wrapper.vm as unknown as { open: boolean; input: string }
    vm.open = false
    await wrapper.vm.$nextTick()

    await input.trigger('keydown', { key: 'Escape' })
    await wrapper.vm.$nextTick()

    expect(vm.input).toBe('')
    wrapper.unmount()
  })

  it('ArrowUp recalls the previous command from history once submitted', async () => {
    const wrapper = mountInput()
    const input = wrapper.find('input')
    const vm = wrapper.vm as unknown as { input: string; open: boolean }

    // Submit a command so it enters history.
    vm.input = 'cast q'
    await wrapper.vm.$nextTick()
    vm.open = false
    await wrapper.vm.$nextTick()
    await input.trigger('keydown', { key: 'Enter' })
    await wrapper.vm.$nextTick()
    expect(vm.input).toBe('') // cleared after submit

    // ArrowUp on an empty, closed prompt walks history back.
    await input.trigger('keydown', { key: 'ArrowUp' })
    await wrapper.vm.$nextTick()
    expect(vm.input).toBe('cast q')
    wrapper.unmount()
  })

  it('ArrowDown moves the suggestion selection while the dropdown is open', async () => {
    const wrapper = mountInput()
    const input = wrapper.find('input')
    await input.setValue('') // empty
    const vm = wrapper.vm as unknown as { open: boolean; selectedIndex: number }
    // Force the dropdown open with the empty-state suggestion list.
    vm.open = true
    await wrapper.vm.$nextTick()
    expect(vm.selectedIndex).toBe(0)

    await input.trigger('keydown', { key: 'ArrowDown' })
    await wrapper.vm.$nextTick()
    expect(vm.selectedIndex).toBe(1)

    await input.trigger('keydown', { key: 'ArrowUp' })
    await wrapper.vm.$nextTick()
    expect(vm.selectedIndex).toBe(0)
    wrapper.unmount()
  })

  it('clicking a suggestion completes the input and keeps the prompt usable', async () => {
    const wrapper = mountInput()
    const input = wrapper.find('input')
    await input.setValue('mov') // opens dropdown with the "move" suggestion

    const option = wrapper.find('.cmd-input-wrapper .absolute > div')
    expect(option.exists()).toBe(true)
    await option.trigger('click')
    await wrapper.vm.$nextTick()

    const vm = wrapper.vm as unknown as { input: string }
    // accepting a single-token command appends a trailing space to continue typing args
    expect(vm.input.startsWith('move')).toBe(true)
    expect(vm.input.endsWith(' ')).toBe(true)
    wrapper.unmount()
  })
})
