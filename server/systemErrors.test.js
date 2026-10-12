import { beforeEach, describe, expect, it, vi } from 'vitest'

const { collection } = vi.hoisted(() => ({
  collection: {
    insertOne: vi.fn(),
    createIndex: vi.fn(),
    updateMany: vi.fn(),
  },
}))

vi.mock('./db.js', () => ({
  getSystemErrorCollection: async () => collection,
}))

import { recordSystemError } from './systemErrors.js'

describe('system error logging', () => {
  beforeEach(() => {
    collection.insertOne.mockReset()
    collection.createIndex.mockResolvedValue('expiresAt_1')
    collection.updateMany.mockResolvedValue({ modifiedCount: 0 })
  })

  it('stores bounded records while redacting credentials and personal contact details', async () => {
    collection.insertOne.mockResolvedValue({ acknowledged: true })
    const error = new Error('Bearer abc.def sent to person@example.com 050-1234567')

    const result = await recordSystemError({
      source: 'server',
      error,
      status: 500,
      method: 'POST',
      path: '/api/data',
      actor: { id: 'user-1', role: 'org_manager' },
    })

    expect(result.message).not.toContain('abc.def')
    expect(result.message).not.toContain('person@example.com')
    expect(result.message).not.toContain('050-1234567')
    expect(result.actor).toEqual({ id: 'user-1', role: 'org_manager' })
    expect(collection.insertOne).toHaveBeenCalledWith(result)
    expect(collection.createIndex).toHaveBeenCalledWith(
      { expiresAt: 1 },
      { expireAfterSeconds: 0 },
    )
    expect(result.expiresAt).toBeInstanceOf(Date)
    expect(collection.updateMany).toHaveBeenCalled()
  })
})
