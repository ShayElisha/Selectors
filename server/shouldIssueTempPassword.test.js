import { describe, expect, it } from 'vitest'
import { shouldIssueTempPassword } from './data.js'

describe('shouldIssueTempPassword', () => {
  it('issues for a brand-new manager', () => {
    expect(
      shouldIssueTempPassword(
        {
          id: 'w1',
          isManager: true,
          email: 'a@example.com',
        },
        null,
      ),
    ).toBe(true)
  })

  it('issues when login is newly granted', () => {
    expect(
      shouldIssueTempPassword(
        {
          id: 'w1',
          isManager: true,
          email: 'a@example.com',
        },
        {
          id: 'w1',
          isManager: false,
          canLogin: false,
          email: 'a@example.com',
        },
      ),
    ).toBe(true)
  })

  it('does not re-issue for an existing manager without worker passwordHash', () => {
    expect(
      shouldIssueTempPassword(
        {
          id: 'w1',
          isManager: true,
          canLogin: true,
          email: 'a@example.com',
        },
        {
          id: 'w1',
          isManager: true,
          canLogin: true,
          email: 'a@example.com',
          // password may live only on the account collection
        },
      ),
    ).toBe(false)
  })

  it('does not issue for non-login workers', () => {
    expect(
      shouldIssueTempPassword(
        {
          id: 'w1',
          isManager: false,
          canLogin: false,
          email: 'a@example.com',
        },
        null,
      ),
    ).toBe(false)
  })
})
