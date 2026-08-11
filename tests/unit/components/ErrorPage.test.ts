import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ErrorPage from '~~/app/error.vue'

// error.vue calls Nuxt's auto-imported clearError; stub it + the components it
// renders (the component vitest project has no Nuxt auto-import).
const clearError = vi.fn()
// Mirrors the real AsciiButton's `to` handling (renders AS the link, not a
// <button> nested inside an <a> — the nested-interactive bug that was fixed)
// so this stub doesn't silently diverge from the flattened markup.
const AsciiButtonStub = {
  name: 'AsciiButton',
  props: ['label', 'variant', 'disabled', 'to'],
  emits: ['click'],
  template: `
    <a v-if="to" :href="to" :data-variant="variant">{{ label }}</a>
    <button v-else :data-variant="variant" @click="$emit('click', $event)">{{ label }}</button>
  `,
}

function mountError(error: Record<string, unknown>) {
  return mount(ErrorPage, {
    props: { error },
    global: { stubs: { AsciiButton: AsciiButtonStub } },
  })
}

beforeEach(() => {
  vi.stubGlobal('clearError', clearError)
  clearError.mockClear()
})
afterEach(() => vi.unstubAllGlobals())

describe('error page', () => {
  it('renders a 404 as a themed "segment not found"', () => {
    const wrapper = mountError({ statusCode: 404, statusMessage: 'Page not found' })
    const text = wrapper.text()
    expect(text).toContain('404')
    expect(text).toContain('segment not found')
    expect(text).toContain('Page not found')
  })

  it('renders a non-404 as a "system fault"', () => {
    const wrapper = mountError({ statusCode: 500, statusMessage: 'boom' })
    const text = wrapper.text()
    expect(text).toContain('500')
    expect(text).toContain('system fault')
  })

  it('falls back to a generic 404 detail when none is supplied', () => {
    const wrapper = mountError({ statusCode: 404 })
    expect(wrapper.text()).toContain('No process is listening at that path.')
  })

  it('recovers home via clearError when RETURN HOME is clicked', async () => {
    const wrapper = mountError({ statusCode: 404 })
    const home = wrapper.findAll('button').find((b) => b.text() === 'RETURN HOME')
    expect(home).toBeTruthy()
    await home!.trigger('click')
    expect(clearError).toHaveBeenCalledWith({ redirect: '/' })
  })

  it('offers a recovery link to the learn guide', () => {
    const wrapper = mountError({ statusCode: 500 })
    expect(wrapper.find('a[href="/learn"]').exists()).toBe(true)
  })

  it('never nests a button inside the learn-guide link (invalid, breaks AT)', () => {
    // Regression: this used to be `<NuxtLink to="/learn"><AsciiButton /></NuxtLink>`,
    // i.e. <a><button>…</button></a> — invalid HTML that gives assistive tech two
    // controls for one action. AsciiButton now renders AS the link via `to`.
    const wrapper = mountError({ statusCode: 500 })
    const link = wrapper.get('a[href="/learn"]')
    expect(link.find('button').exists()).toBe(false)
  })
})
