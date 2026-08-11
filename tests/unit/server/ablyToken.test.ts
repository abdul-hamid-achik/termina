import { describe, it, expect } from 'vitest'
import {
  ABLY_TOKEN_TTL_MS,
  buildAblyCapability,
  parseAblyApiKey,
  mintAblyTokenRequest,
} from '~~/server/utils/ablyToken'

describe('buildAblyCapability', () => {
  it("scopes subscribe-only on the player's own channel and the team wildcard", () => {
    const capability = buildAblyCapability('p1')
    expect(capability).toEqual({
      'game:*:p:p1': ['subscribe'],
      'game:*:team:*': ['subscribe'],
    })
  })

  it('never grants publish, on any channel', () => {
    const capability = buildAblyCapability('p1')
    for (const ops of Object.values(capability)) {
      expect(ops).not.toContain('publish')
      expect(ops).not.toContain('*')
    }
  })

  it("scopes to the given playerId, not some other player's channel", () => {
    const capability = buildAblyCapability('victim')
    expect(capability['game:*:p:attacker']).toBeUndefined()
    expect(capability['game:*:p:victim']).toEqual(['subscribe'])
  })
})

describe('parseAblyApiKey', () => {
  it('splits keyName from secret on the first colon', () => {
    expect(parseAblyApiKey('appId.keyId:secretvalue')).toEqual({
      keyName: 'appId.keyId',
      keySecret: 'secretvalue',
    })
  })

  it('throws on a key with no colon', () => {
    expect(() => parseAblyApiKey('no-colon-here')).toThrow(/Malformed/)
  })

  it('throws on a key with nothing after the colon', () => {
    expect(() => parseAblyApiKey('appId.keyId:')).toThrow(/Malformed/)
  })
})

describe('mintAblyTokenRequest', () => {
  const KEY = 'app1.key1:secret1'

  it('signs a local TokenRequest — correct HMAC over the spec sign-text', async () => {
    const { createHmac } = await import('node:crypto')
    const tr = mintAblyTokenRequest({
      apiKey: KEY,
      playerId: 'p1',
      now: 1234567,
      nonce: 'nonce16nonce16aa',
    })
    const capability = JSON.stringify(buildAblyCapability('p1'))
    const signText =
      ['app1.key1', String(tr.ttl), capability, 'p1', '1234567', 'nonce16nonce16aa'].join('\n') +
      '\n'
    const expectedMac = createHmac('sha256', 'secret1').update(signText).digest('base64')
    expect(tr.mac).toBe(expectedMac)
    expect(tr.keyName).toBe('app1.key1')
    expect(tr.clientId).toBe('p1')
    expect(tr.timestamp).toBe(1234567)
  })

  it('scopes capability to the requesting player with a 1h TTL by default', () => {
    const tr = mintAblyTokenRequest({ apiKey: KEY, playerId: 'p42' })
    expect(tr.ttl).toBe(ABLY_TOKEN_TTL_MS)
    const cap = JSON.parse(tr.capability) as Record<string, string[]>
    expect(cap['game:*:p:p42']).toEqual(['subscribe'])
    expect(cap['game:*:team:*']).toEqual(['subscribe'])
    expect(Object.keys(cap)).toHaveLength(2)
  })

  it('honors an explicit ttlMs override', () => {
    const tr = mintAblyTokenRequest({ apiKey: KEY, playerId: 'p1', ttlMs: 5000 })
    expect(tr.ttl).toBe(5000)
  })

  it('mints a fresh crypto nonce per request (no reuse)', () => {
    const a = mintAblyTokenRequest({ apiKey: KEY, playerId: 'p1' })
    const b = mintAblyTokenRequest({ apiKey: KEY, playerId: 'p1' })
    expect(a.nonce).not.toBe(b.nonce)
    expect(a.nonce.length).toBeGreaterThanOrEqual(16)
  })
})
