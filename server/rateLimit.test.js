import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getDb, findOneAndUpdate } = vi.hoisted(() => ({
  getDb: vi.fn(),
  findOneAndUpdate: vi.fn(),
}))

vi.mock('./db.js', () => ({ getDb }))

import { assertRateLimit, clientKey } from './rateLimit.js'

describe('assertRateLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getDb.mockResolvedValue({
      collection: () => ({ findOneAndUpdate }),
    })
  })

  it('increments the limit in one atomic MongoDB operation', async () => {
    findOneAndUpdate.mockResolvedValue({ count: 3, resetAt: Date.now() + 60_000 })

    await assertRateLimit({ key: 'login-phone:1234567890', limit: 10 })

    expect(findOneAndUpdate).toHaveBeenCalledTimes(1)
    expect(findOneAndUpdate.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining([expect.objectContaining({ $set: expect.any(Object) })]),
    )
    expect(findOneAndUpdate.mock.calls[0]?.[2]).toMatchObject({
      upsert: true,
      returnDocument: 'after',
    })
  })

  it('rejects attempts after the configured threshold', async () => {
    findOneAndUpdate.mockResolvedValue({ count: 11, resetAt: Date.now() + 60_000 })

    await expect(
      assertRateLimit({ key: 'login-phone:1234567890', limit: 10 }),
    ).rejects.toMatchObject({ status: 429, retryAfterSec: expect.any(Number) })
  })
})

describe('clientKey', () => {
  it('uses the trusted Express client IP instead of raw forwarded headers', () => {
    expect(
      clientKey({
        ip: '203.0.113.10',
        headers: { 'x-forwarded-for': '198.51.100.1' },
      }),
    ).toBe('203.0.113.10')
  })
})
