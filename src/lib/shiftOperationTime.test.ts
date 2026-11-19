import { describe, expect, it } from 'vitest'
import { shiftStartTimestamp } from './shiftOperationTime'

describe('shiftStartTimestamp', () => {
  it('uses the shift date and local start time', () => {
    expect(shiftStartTimestamp('2026-11-19', 14 * 60 + 30)).toBe(
      new Date(2026, 10, 19, 14, 30).toISOString(),
    )
  })

  it('supports shift start times beyond midnight', () => {
    expect(shiftStartTimestamp('2026-11-19', 25 * 60 + 30)).toBe(
      new Date(2026, 10, 20, 1, 30).toISOString(),
    )
  })

  it('rejects invalid dates and times', () => {
    expect(shiftStartTimestamp('2026-02-30', 6 * 60)).toBeNull()
    expect(shiftStartTimestamp('2026-11-19', Number.NaN)).toBeNull()
  })
})
