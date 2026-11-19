import { describe, expect, it } from 'vitest'
import { assertCookieMutationOrigin } from './csrf.js'

const allowedOrigins = new Set(['https://app.example.com'])

describe('cookie mutation origin protection', () => {
  it('accepts a trusted same-origin cookie mutation', () => {
    expect(() =>
      assertCookieMutationOrigin(
        {
          method: 'POST',
          headers: {
            cookie: 'getin_session=session-token',
            origin: 'https://app.example.com/',
          },
        },
        allowedOrigins,
      ),
    ).not.toThrow()
  })

  it.each([undefined, 'https://attacker.example'])(
    'rejects a cookie mutation with origin %s',
    (origin) => {
      expect(() =>
        assertCookieMutationOrigin(
          {
            method: 'POST',
            headers: {
              cookie: 'getin_session=session-token',
              ...(origin ? { origin } : {}),
            },
          },
          allowedOrigins,
        ),
      ).toThrow(expect.objectContaining({ status: 403 }))
    },
  )

  it('does not apply the cookie origin check to bearer or safe requests', () => {
    expect(() =>
      assertCookieMutationOrigin(
        { method: 'POST', headers: { authorization: 'Bearer token' } },
        allowedOrigins,
      ),
    ).not.toThrow()
    expect(() =>
      assertCookieMutationOrigin(
        { method: 'GET', headers: { cookie: 'getin_session=session-token' } },
        allowedOrigins,
      ),
    ).not.toThrow()
  })
})
