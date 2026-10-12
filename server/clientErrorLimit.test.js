import { beforeEach, describe, expect, it, vi } from 'vitest'

const { assertRateLimit, clientKey } = vi.hoisted(() => ({
  assertRateLimit: vi.fn(),
  clientKey: vi.fn(),
}))

vi.mock('./rateLimit.js', () => ({ assertRateLimit, clientKey }))

import { assertClientErrorRateLimit } from './clientErrorLimit.js'

describe('client error rate limits', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clientKey.mockReturnValue('203.0.113.10')
  })

  it('checks the per-IP limit before applying the global daily cap', async () => {
    await assertClientErrorRateLimit({ ip: '203.0.113.10' })

    expect(assertRateLimit).toHaveBeenNthCalledWith(1, {
      key: 'client-error:203.0.113.10',
      limit: 20,
      windowMs: 10 * 60_000,
    })
    expect(assertRateLimit).toHaveBeenNthCalledWith(2, {
      key: 'client-errors:global-daily',
      limit: 5000,
      windowMs: 24 * 60 * 60_000,
    })
  })

  it('stops before consuming global capacity when an IP is over limit', async () => {
    const error = Object.assign(new Error('IP cap'), { status: 429 })
    assertRateLimit.mockRejectedValueOnce(error)

    await expect(assertClientErrorRateLimit({ ip: '203.0.113.10' })).rejects.toBe(error)
    expect(assertRateLimit).toHaveBeenCalledOnce()
  })

  it('stops after the shared cap is exhausted', async () => {
    const error = Object.assign(new Error('daily cap'), { status: 429 })
    assertRateLimit.mockResolvedValueOnce(undefined)
    assertRateLimit.mockRejectedValueOnce(error)

    await expect(assertClientErrorRateLimit({ ip: '203.0.113.10' })).rejects.toBe(error)
    expect(assertRateLimit).toHaveBeenCalledTimes(2)
  })
})
