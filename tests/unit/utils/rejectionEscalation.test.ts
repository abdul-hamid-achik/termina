import { describe, it, expect, beforeEach } from 'vitest'
import { escalateRejection, resetRejectionEscalation } from '~~/app/utils/rejectionEscalation'

describe('rejectionEscalation (client)', () => {
  beforeEach(() => resetRejectionEscalation())

  it('passes the first two identical rejections through unchanged', () => {
    const msg = 'Requires a hero target'
    expect(escalateRejection(msg)).toBe(msg)
    expect(escalateRejection(msg)).toBe(msg)
  })

  it('appends a help pointer on the THIRD identical rejection', () => {
    const msg = 'Requires a hero target'
    escalateRejection(msg)
    escalateRejection(msg)
    const third = escalateRejection(msg)
    expect(third).toContain(msg)
    expect(third).toContain('help')
    // The fourth is plain again — the hint has been shown once.
    expect(escalateRejection(msg)).toBe(msg)
  })

  it('counts rejections independently of casing and whitespace', () => {
    escalateRejection('No cache in this zone to grab')
    escalateRejection('  no cache in this zone to grab ')
    expect(escalateRejection('No cache in this zone to grab')).toContain('help')
  })

  it('treats different rejections separately', () => {
    escalateRejection('Cannot act while dead')
    escalateRejection('Cannot act while dead')
    expect(escalateRejection('No cache in this zone to grab')).toBe('No cache in this zone to grab')
  })

  it('reset clears the counters', () => {
    escalateRejection('x')
    escalateRejection('x')
    resetRejectionEscalation()
    expect(escalateRejection('x')).toBe('x')
  })
})
