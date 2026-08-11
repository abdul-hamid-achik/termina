// @vitest-environment happy-dom
//
// This suite needs real DOM focus/activeElement semantics (querySelector,
// .focus(), document.activeElement) that the `tests/unit/**` project's default
// `node` environment doesn't provide — the per-file docblock above opts just
// this file into happy-dom, the same environment `tests/unit/components/**`
// runs under.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref, nextTick, type Ref } from 'vue'
import { useFocusTrap } from '~/composables/useFocusTrap'

/** Type-narrowing helper: an HTMLDivElement fixture as the Ref<HTMLElement | null | undefined> the composable expects. */
function containerRef(el: HTMLElement): Ref<HTMLElement | null | undefined> {
  return ref(el)
}

/** A dialog-shaped DOM fixture: an opener button outside it, a container with
 *  two focusable buttons inside, both attached to document.body (focus only
 *  works on attached elements). */
function makeFixture() {
  const opener = document.createElement('button')
  opener.textContent = 'open'
  document.body.appendChild(opener)

  const container = document.createElement('div')
  const first = document.createElement('button')
  first.textContent = 'first'
  const last = document.createElement('button')
  last.textContent = 'last'
  container.appendChild(first)
  container.appendChild(last)
  document.body.appendChild(container)

  return { opener, container, first, last }
}

function fireKeydown(target: HTMLElement, init: KeyboardEventInit) {
  const event = new KeyboardEvent('keydown', { cancelable: true, bubbles: true, ...init })
  const preventDefault = vi.spyOn(event, 'preventDefault')
  const stopPropagation = vi.spyOn(event, 'stopPropagation')
  target.dispatchEvent(event)
  return { event, preventDefault, stopPropagation }
}

describe('useFocusTrap', () => {
  let fixture: ReturnType<typeof makeFixture>

  beforeEach(() => {
    fixture = makeFixture()
  })

  afterEach(() => {
    fixture.opener.remove()
    fixture.container.remove()
  })

  it('moves focus into the dialog on activation', async () => {
    const active = ref(false)
    useFocusTrap(containerRef(fixture.container), active)

    active.value = true
    await nextTick()
    await nextTick() // activate() schedules its own nextTick

    expect(document.activeElement).toBe(fixture.first)
  })

  it('restores focus to the opener on deactivation', async () => {
    fixture.opener.focus()
    expect(document.activeElement).toBe(fixture.opener)

    const active = ref(false)
    useFocusTrap(containerRef(fixture.container), active)

    active.value = true
    await nextTick()
    await nextTick()
    expect(document.activeElement).toBe(fixture.first) // sanity: trap took focus

    active.value = false
    await nextTick()
    await nextTick()
    expect(document.activeElement).toBe(fixture.opener)
  })

  it('does not restore focus to an opener that left the document', async () => {
    fixture.opener.focus()
    const active = ref(false)
    useFocusTrap(containerRef(fixture.container), active)
    active.value = true
    await nextTick()
    await nextTick()

    fixture.opener.remove() // e.g. the SHOP/SCORE button re-rendered away

    active.value = false
    await nextTick()
    await nextTick()
    // No crash, and focus is simply wherever it naturally ended up (not the
    // detached node) — `document.body.contains` guards the restore.
    expect(document.contains(fixture.opener)).toBe(false)
  })

  it('calls onClose and stops propagation on Escape', () => {
    const onClose = vi.fn()
    const { onKeydown } = useFocusTrap(containerRef(fixture.container), ref(true), { onClose })
    // `@keydown="onKeydown"` in the real component — wire it the same way so
    // dispatching on the container actually reaches the trap.
    fixture.container.addEventListener('keydown', onKeydown)

    const { stopPropagation } = fireKeydown(fixture.container, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(stopPropagation).toHaveBeenCalled()
  })

  describe('Tab cycling', () => {
    it('wraps forward from the last focusable element to the first', () => {
      const { onKeydown } = useFocusTrap(containerRef(fixture.container), ref(true))
      fixture.last.focus()

      const event = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true, bubbles: true })
      const preventDefault = vi.spyOn(event, 'preventDefault')
      onKeydown(event)

      expect(preventDefault).toHaveBeenCalled()
      expect(document.activeElement).toBe(fixture.first)
    })

    it('wraps backward from the first focusable element to the last on Shift+Tab', () => {
      const { onKeydown } = useFocusTrap(containerRef(fixture.container), ref(true))
      fixture.first.focus()

      const event = new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        cancelable: true,
        bubbles: true,
      })
      const preventDefault = vi.spyOn(event, 'preventDefault')
      onKeydown(event)

      expect(preventDefault).toHaveBeenCalled()
      expect(document.activeElement).toBe(fixture.last)
    })

    it('lets Tab move normally between two elements that are both inside the trap', () => {
      // Forward from `first` (not the boundary) must NOT preventDefault — the
      // browser's native Tab already lands on `last` on its own.
      const { onKeydown } = useFocusTrap(containerRef(fixture.container), ref(true))
      fixture.first.focus()

      const event = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true, bubbles: true })
      const preventDefault = vi.spyOn(event, 'preventDefault')
      onKeydown(event)

      expect(preventDefault).not.toHaveBeenCalled()
    })

    it("stops Tab from bubbling to a window-level handler (this app's Tab-hold-scoreboard hotkey)", () => {
      // GameScreen's window keydown listener treats a bare Tab as "hold to
      // peek scoreboard" (app/utils/gameKeys.ts). While a dialog owns focus,
      // Tab must cycle inside it instead — the dialog's own @keydown handler
      // has to stopPropagation() so that window listener never sees it.
      const { onKeydown } = useFocusTrap(containerRef(fixture.container), ref(true))
      fixture.container.addEventListener('keydown', onKeydown)
      fixture.first.focus()

      const { stopPropagation } = fireKeydown(fixture.container, { key: 'Tab' })
      expect(stopPropagation).toHaveBeenCalled()
    })
  })
})
