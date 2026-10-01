import { describe, expect, it } from 'vitest'
import {
  formatSignOffStamp,
  isShiftSignedOff,
  namesMatchForSignOff,
  normalizeSignOff,
} from './shiftSignOff'

describe('shift sign-off', () => {
  it('accepts the connected manager name with collapsed spaces', () => {
    expect(namesMatchForSignOff('  דנה   לוי ', 'דנה לוי')).toBe(true)
    expect(namesMatchForSignOff('דנה', 'דנה לוי')).toBe(false)
    expect(namesMatchForSignOff('   ', 'דנה לוי')).toBe(false)
  })

  it('keeps a complete signature and drops a partial one', () => {
    expect(
      normalizeSignOff({
        signedAt: '2026-10-01T12:00:00.000Z',
        signerName: 'דנה לוי',
        signerId: 'u1',
        signature: 'דנה לוי',
      })?.signerId,
    ).toBe('u1')
    expect(normalizeSignOff({ signedAt: '2026-10-01T12:00:00.000Z' })).toBeUndefined()
    expect(isShiftSignedOff({ signOff: undefined })).toBe(false)
    expect(
      isShiftSignedOff({
        signOff: {
          signedAt: '2026-10-01T12:00:00.000Z',
          signerName: 'דנה לוי',
          signerId: 'u1',
          signature: 'דנה לוי',
        },
      }),
    ).toBe(true)
  })

  it('formats the stamp in Hebrew locale order', () => {
    const stamp = formatSignOffStamp('2026-10-01T12:30:00.000Z')
    expect(stamp).toContain('2026')
    expect(stamp.length).toBeGreaterThan(6)
  })
})
