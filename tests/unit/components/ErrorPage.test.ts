import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ErrorPage from '../../../app/error.vue'

// error.vue calls Nuxt's auto-imported clearError; stub it + the components it
// renders (the component vitest project has no Nuxt auto-import).
const clearError = vi.fn()
const AsciiButtonStub = {
  name: 'AsciiButton',
  props: ['label', 'variant', 'disabled'],
  emits: ['click'],
  template: `<button :data-variant="variant" @click="$emit('click', $event)">{{ label }}</button>`,
}
const NuxtLinkStub = { name: 'NuxtLink', props: ['to'], template: '<a :href="to"><slot /></a>' }

function mountError(error: Record<string, unknown>) {
  return mount(ErrorPage, {
    props: { error },
    global: { stubs: { AsciiButton: AsciiButtonStub, NuxtLink: NuxtLinkStub } },
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
})
