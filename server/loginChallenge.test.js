import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getDb, sendLoginCodeEmail } = vi.hoisted(() => ({
  getDb: vi.fn(),
  sendLoginCodeEmail: vi.fn(),
}))

vi.mock('./db.js', () => ({ getDb }))
vi.mock('./mail.js', () => ({ sendLoginCodeEmail }))

import {
  createLoginChallenge,
  verifyLoginChallenge,
} from './loginChallenge.js'

const identity = {
  id: 'manager-1',
  fullName: 'מנהל',
  phone: '0501234567',
  role: 'org_manager',
  orgId: 'org-1',
  orgName: 'ארגון',
  modules: { selectors: true, inspectors: false, security: false },
  module: 'selectors',
  isOrgManager: true,
  staffKind: 'selector',
}

let documents

function matches(document, query) {
  return Object.entries(query).every(([key, expected]) => {
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      if ('$gt' in expected) return document[key] > expected.$gt
      if ('$lt' in expected) return document[key] < expected.$lt
    }
    return document[key] === expected
  })
}

const collection = {
  createIndex: vi.fn(async () => 'expiresAt_1'),
  insertOne: vi.fn(async (document) => {
    documents.set(document._id, { ...document })
    return { acknowledged: true }
  }),
  findOneAndUpdate: vi.fn(async (query, update) => {
    const document = [...documents.values()].find((candidate) =>
      matches(candidate, query),
    )
    if (!document) return null
    const before = { ...document }
    document.attempts += update.$inc.attempts
    return before
  }),
  deleteOne: vi.fn(async (query) => {
    const document = [...documents.values()].find((candidate) =>
      matches(candidate, query),
    )
    if (!document) return { deletedCount: 0 }
    documents.delete(document._id)
    return { deletedCount: 1 }
  }),
}

describe('email login challenges', () => {
  beforeEach(() => {
    documents = new Map()
    vi.stubEnv('SESSION_SECRET', 'a-test-session-secret-long-enough')
    getDb.mockResolvedValue({ collection: () => collection })
    sendLoginCodeEmail.mockResolvedValue({ queued: true })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  it('sends a masked, short-lived code and consumes it once', async () => {
    const result = await createLoginChallenge(identity, {
      email: 'manager@example.com',
      passwordChanged: true,
    })
    const sentCode = sendLoginCodeEmail.mock.calls[0][0].code
    const saved = documents.get(result.challengeId)

    expect(result).toMatchObject({
      next: 'verify_email',
      emailHint: 'm***r@example.com',
    })
    expect(saved.codeHash).toMatch(/^[a-f\d]{64}$/)
    expect(saved.identity).not.toHaveProperty('phone')
    expect(saved.identity).not.toHaveProperty('fullName')
    expect(saved.expiresAt.getTime()).toBeGreaterThan(Date.now())
    expect(
      await verifyLoginChallenge(result.challengeId, sentCode),
    ).toEqual({
      identity: {
        id: 'manager-1',
        role: 'org_manager',
        orgId: 'org-1',
        module: 'selectors',
      },
      passwordChanged: true,
    })
    await expect(
      verifyLoginChallenge(result.challengeId, sentCode),
    ).rejects.toMatchObject({ status: 401 })
  })

  it('invalidates the challenge after five incorrect attempts', async () => {
    const result = await createLoginChallenge(identity, {
      email: 'manager@example.com',
    })
    const correctCode = sendLoginCodeEmail.mock.calls[0][0].code
    const incorrectCode = correctCode === '000000' ? '000001' : '000000'

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expect(
        verifyLoginChallenge(result.challengeId, incorrectCode),
      ).rejects.toMatchObject({ status: 401 })
    }
    expect(documents.get(result.challengeId).attempts).toBe(5)
    await expect(
      verifyLoginChallenge(result.challengeId, correctCode),
    ).rejects.toMatchObject({ status: 401 })
  })

  it('rejects expired challenges', async () => {
    const result = await createLoginChallenge(identity, {
      email: 'manager@example.com',
    })
    documents.get(result.challengeId).expiresAt = new Date(Date.now() - 1)

    await expect(
      verifyLoginChallenge(
        result.challengeId,
        sendLoginCodeEmail.mock.calls[0][0].code,
      ),
    ).rejects.toMatchObject({ status: 401 })
  })

  it('removes the challenge if the email cannot be sent', async () => {
    sendLoginCodeEmail.mockRejectedValueOnce(new Error('SMTP unavailable'))

    await expect(
      createLoginChallenge(identity, { email: 'manager@example.com' }),
    ).rejects.toThrow('SMTP unavailable')
    expect(documents.size).toBe(0)
  })
})
