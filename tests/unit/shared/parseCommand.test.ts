import { describe, it, expect } from 'vitest'
import { parseWireCommand } from '~~/shared/utils/parseCommand'

describe('parseWireCommand', () => {
  it('accepts a legal move', () => {
    const r = parseWireCommand({ type: 'move', zone: 'coldstore-cross' })
    expect(r).toEqual({ ok: true, command: { type: 'move', zone: 'coldstore-cross' } })
  })

  it('accepts a cast with a hero target', () => {
    const r = parseWireCommand({
      type: 'cast',
      ability: 'q',
      target: { kind: 'hero', name: 'daemon' },
    })
    expect(r.ok).toBe(true)
    if (r.ok)
      expect(r.command).toEqual({
        type: 'cast',
        ability: 'q',
        target: { kind: 'hero', name: 'daemon' },
      })
  })

  it('rejects client-only readouts so they never hit pending_actions', () => {
    for (const type of ['help', 'status', 'map', 'scan', 'who', 'net', 'look']) {
      const r = parseWireCommand({ type })
      expect(r.ok, type).toBe(false)
      if (!r.ok) expect(r.reason).toMatch(/local readout/)
    }
  })

  it('rejects unknown types and empty required fields', () => {
    expect(parseWireCommand(null).ok).toBe(false)
    expect(parseWireCommand({ type: 'explode' }).ok).toBe(false)
    expect(parseWireCommand({ type: 'move', zone: '' }).ok).toBe(false)
    expect(parseWireCommand({ type: 'attack' }).ok).toBe(false)
    expect(parseWireCommand({ type: 'cast', ability: 'x' }).ok).toBe(false)
    expect(parseWireCommand({ type: 'burn', target: { kind: 'hero', name: 'echo' } }).ok).toBe(
      false,
    )
    expect(parseWireCommand({ type: 'select_talent', tier: 11, talentId: 'x' }).ok).toBe(false)
  })

  it('rejects a chat that is empty or over the 200-char cap', () => {
    expect(parseWireCommand({ type: 'chat', channel: 'team', message: '' }).ok).toBe(false)
    expect(parseWireCommand({ type: 'chat', channel: 'team', message: 'x'.repeat(201) }).ok).toBe(
      false,
    )
    expect(parseWireCommand({ type: 'chat', channel: 'team', message: 'ss mid' }).ok).toBe(true)
  })
})
