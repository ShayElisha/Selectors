import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSessionToken, verifySessionToken } from './session.js'

function encode(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function signedToken(payload) {
  const body = encode(JSON.stringify(payload))
  const signature = encode(
    createHmac('sha256', process.env.SESSION_SECRET).update(body).digest(),
  )
  return `${body}.${signature}`
}

describe('email-verified session tokens', () => {
  beforeEach(() => {
    vi.stubEnv('SESSION_SECRET', 'session-test-secret-long-enough')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('marks newly issued sessions as email-verified', () => {
    const token = createSessionToken({
      id: 'manager-1',
      fullName: 'Manager',
      phone: '0501234567',
      role: 'org_manager',
      orgId: 'org-1',
      modules: { selectors: true },
      module: 'selectors',
    })

    expect(verifySessionToken(token)).toMatchObject({
      id: 'manager-1',
      role: 'org_manager',
      orgId: 'org-1',
    })
  })

  it('rejects sessions issued before email verification was required', () => {
    const token = signedToken({
      id: 'manager-1',
      fullName: 'Manager',
      phone: '0501234567',
      role: 'org_manager',
      orgId: 'org-1',
      modules: { selectors: true },
      exp: Date.now() + 60_000,
    })

    expect(verifySessionToken(token)).toBeNull()
  })
})
