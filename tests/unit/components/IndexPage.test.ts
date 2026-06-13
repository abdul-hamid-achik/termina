import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import IndexPage from '../../../app/pages/index.vue'
import { HERO_IDS } from '../../../shared/constants/heroes'

function mountIndex() {
  return mount(IndexPage, {
    global: {
      stubs: {
        NuxtLink: { template: '<a><slot /></a>' },
        AsciiButton: true,
      },
    },
  })
}

describe('index (landing) page', () => {
  it('shows the live hero count from the registry, not a hardcoded 6', () => {
    const text = mountIndex().text()
    expect(text).toContain(`${HERO_IDS.length} unique heroes`)
    expect(text).not.toContain('6 unique heroes')
  })

  it('does not advertise the unimplemented scan command', () => {
    const text = mountIndex().text()
    expect(text).not.toContain('scan')
    expect(text).toContain('place wards to reveal the unseen')
  })
})
