import { describe, expect, it } from 'vitest'
import {
  filterMidShiftOperationEvents,
  isDocumentedStationChangeTime,
  shiftStartTimestamp,
} from './shiftOperationTime'

const models = [
  {
    id: 'afternoon',
    startMinutes: 14 * 60 + 30,
    endMinutes: 21 * 60 + 30,
  },
]

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

describe('isDocumentedStationChangeTime', () => {
  it('keeps a planned afternoon entry at 18:30 on the history timeline', () => {
    const at = new Date(2026, 10, 24, 18, 30).toISOString()
    expect(
      isDocumentedStationChangeTime('2026-11-24', 'afternoon', at, models),
    ).toBe(true)
    expect(
      filterMidShiftOperationEvents(
        [{ id: '1', effectiveAt: at }],
        '2026-11-24',
        'afternoon',
        models,
      ),
    ).toHaveLength(1)
  })
})
