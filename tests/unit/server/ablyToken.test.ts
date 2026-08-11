import { describe, it, expect, vi } from 'vitest'
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
  function fakeFetch(status: number, body: unknown) {
    return vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    })
  }

  it('POSTs to /keys/{keyName}/requests with Basic auth of the FULL key', async () => {
    const fetchImpl = fakeFetch(200, { id: 'tok1' })
    await mintAblyTokenRequest({ apiKey: 'app1.key1:secret1', playerId: 'p1', fetchImpl })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe('https://rest.ably.io/keys/app1.key1/requests')
    expect(init.method).toBe('POST')
    expect(init.headers.authorization).toBe(
      `Basic ${Buffer.from('app1.key1:secret1').toString('base64')}`,
    )
  })

  it('sends capability scoped to the requesting player, clientId, and a 1h TTL by default', async () => {
    const fetchImpl = fakeFetch(200, { id: 'tok1' })
    await mintAblyTokenRequest({ apiKey: 'app1.key1:secret1', playerId: 'p42', fetchImpl })

    const [, init] = fetchImpl.mock.calls[0]!
    const sentBody = JSON.parse(init.body)
    expect(sentBody.clientId).toBe('p42')
    expect(sentBody.ttl).toBe(ABLY_TOKEN_TTL_MS)
    expect(sentBody.keyName).toBe('app1.key1')
    expect(JSON.parse(sentBody.capability)).toEqual({
      'game:*:p:p42': ['subscribe'],
      'game:*:team:*': ['subscribe'],
    })
  })

  it('honors an explicit ttlMs override', async () => {
    const fetchImpl = fakeFetch(200, { id: 'tok1' })
    await mintAblyTokenRequest({
      apiKey: 'app1.key1:secret1',
      playerId: 'p1',
      ttlMs: 5_000,
      fetchImpl,
    })
    const [, init] = fetchImpl.mock.calls[0]!
    expect(JSON.parse(init.body).ttl).toBe(5_000)
  })

  it('returns the response JSON as-is for the client authCallback', async () => {
    const fetchImpl = fakeFetch(200, { id: 'tok1', mac: 'xyz' })
    const result = await mintAblyTokenRequest({
      apiKey: 'app1.key1:secret1',
      playerId: 'p1',
      fetchImpl,
    })
    expect(result).toEqual({ id: 'tok1', mac: 'xyz' })
  })

  it('throws when Ably responds with a non-2xx status', async () => {
    const fetchImpl = fakeFetch(401, { error: 'bad key' })
    await expect(
      mintAblyTokenRequest({ apiKey: 'app1.key1:secret1', playerId: 'p1', fetchImpl }),
    ).rejects.toThrow(/401/)
  })
})
