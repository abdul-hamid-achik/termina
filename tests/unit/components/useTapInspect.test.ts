// Lives in tests/unit/components so it runs in the happy-dom project
// (the composable registers document listeners).
import { describe, it, expect, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, nextTick } from 'vue'
import { useTapInspect, usePointerCoarse } from '../../../app/composables/useTapInspect'
import type { TapInspect } from '../../../app/composables/useTapInspect'
import { mockPointer, restorePointer, tapOutside } from './helpers/pointer'

function mountHarness() {
  let api!: TapInspect
  const wrapper = mount(
    defineComponent({
      setup() {
        api = useTapInspect()
        return () => null
      },
    }),
    { attachTo: document.body },
  )
  return { wrapper, api }
}

afterEach(() => {
  restorePointer()
})

describe('usePointerCoarse', () => {
  it('is false on fine pointers', () => {
    mockPointer(false)
    const { wrapper, api: _api } = mountHarness()
    const inner = mount(
      defineComponent({
        setup() {
          const coarse = usePointerCoarse()
          return { coarse }
        },
        template: '<div/>',
      }),
    )
    expect(inner.vm.coarse).toBe(false)
    inner.unmount()
    wrapper.unmount()
  })

  it('is true on coarse pointers', () => {
    mockPointer(true)
    const inner = mount(
      defineComponent({
        setup() {
          const coarse = usePointerCoarse()
          return { coarse }
        },
        template: '<div/>',
      }),
    )
    expect(inner.vm.coarse).toBe(true)
    inner.unmount()
  })
})

describe('useTapInspect', () => {
  describe('fine pointer (mouse)', () => {
    it('interceptActivate lets the action through and opens nothing', () => {
      mockPointer(false)
      const { wrapper, api } = mountHarness()

      expect(api.interceptActivate('q')).toBe(true)
      expect(api.openKey.value).toBeNull()
      wrapper.unmount()
    })

    it('hoverEnter/hoverLeave drive the tooltip', () => {
      mockPointer(false)
      const { wrapper, api } = mountHarness()

      api.hoverEnter('q')
      expect(api.isOpen('q')).toBe(true)
      api.hoverLeave()
      expect(api.isOpen('q')).toBe(false)
      wrapper.unmount()
    })
  })

  describe('coarse pointer (touch)', () => {
    it('interceptActivate blocks the action and toggles the tooltip', () => {
      mockPointer(true)
      const { wrapper, api } = mountHarness()

      expect(api.interceptActivate('q')).toBe(false)
      expect(api.isOpen('q')).toBe(true)

      // Second activation on the same key toggles it closed
      expect(api.interceptActivate('q')).toBe(false)
      expect(api.isOpen('q')).toBe(false)
      wrapper.unmount()
    })

    it('activating another key switches the open tooltip', () => {
      mockPointer(true)
      const { wrapper, api } = mountHarness()

      api.interceptActivate('q')
      api.interceptActivate('w')
      expect(api.isOpen('q')).toBe(false)
      expect(api.isOpen('w')).toBe(true)
      wrapper.unmount()
    })

    it('hover handlers are no-ops (emulated mouse events on touch)', () => {
      mockPointer(true)
      const { wrapper, api } = mountHarness()

      api.hoverEnter('q')
      expect(api.isOpen('q')).toBe(false)
      api.interceptActivate('q')
      api.hoverLeave()
      expect(api.isOpen('q')).toBe(true)
      wrapper.unmount()
    })

    it('tap outside dismisses the open tooltip', async () => {
      mockPointer(true)
      const { wrapper, api } = mountHarness()

      api.interceptActivate('q')
      expect(api.isOpen('q')).toBe(true)
      tapOutside()
      await nextTick()
      expect(api.isOpen('q')).toBe(false)
      wrapper.unmount()
    })

    it('pointerdown inside the registered element does not dismiss', async () => {
      mockPointer(true)
      const { wrapper, api } = mountHarness()

      const el = document.createElement('div')
      document.body.appendChild(el)
      api.registerEl('q', el)
      api.interceptActivate('q')

      el.dispatchEvent(new Event('pointerdown', { bubbles: true }))
      await nextTick()
      expect(api.isOpen('q')).toBe(true)

      el.remove()
      wrapper.unmount()
    })

    it('removes the document listener on unmount', async () => {
      mockPointer(true)
      const { wrapper, api } = mountHarness()
      api.interceptActivate('q')
      wrapper.unmount()

      // Listener gone — no crash, and state untouched by further taps
      tapOutside()
      await nextTick()
      expect(api.isOpen('q')).toBe(true)
    })
  })
})
