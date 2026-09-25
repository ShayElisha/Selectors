import { describe, expect, it } from 'vitest'
import {
  formatShiftDate,
  formatShiftDateShort,
  formatShiftWindow,
  pluralizeHe,
  shiftWindowParts,
} from './hebrew'

describe('pluralizeHe', () => {
  const lanes = {
    one: 'נתיב אחד',
    two: 'שני נתיבים',
    many: 'נתיבים',
  }

  it('uses singular for 1', () => {
    expect(pluralizeHe(1, lanes)).toBe('נתיב אחד')
  })

  it('uses dual for 2', () => {
    expect(pluralizeHe(2, lanes)).toBe('שני נתיבים')
  })

  it('prefixes count for many and zero', () => {
    expect(pluralizeHe(0, lanes)).toBe('0 נתיבים')
    expect(pluralizeHe(5, lanes)).toBe('5 נתיבים')
  })
})

describe('formatShiftDate', () => {
  it('formats ISO as D.M.YYYY', () => {
    expect(formatShiftDate('2026-09-19')).toBe('19.9.2026')
    expect(formatShiftDate('2026-12-01')).toBe('1.12.2026')
  })
})

describe('formatShiftDateShort', () => {
  it('omits year when same as now', () => {
    expect(formatShiftDateShort('2026-09-19', new Date(2026, 8, 20))).toBe(
      '19.9',
    )
  })

  it('keeps year when different', () => {
    expect(formatShiftDateShort('2025-09-19', new Date(2026, 8, 20))).toBe(
      '19.9.2025',
    )
  })
})

describe('formatShiftWindow', () => {
  it('formats day shifts without next-day note', () => {
    expect(formatShiftWindow('morning')).toBe('06:00 עד 14:30')
    expect(formatShiftWindow('afternoon')).toBe('14:30 עד 21:30')
  })

  it('marks night end as next day', () => {
    expect(formatShiftWindow('night')).toBe('21:30 עד 06:00 (למחרת)')
    expect(shiftWindowParts('night')).toEqual({
      start: '21:30',
      end: '06:00',
      nextDay: true,
    })
  })
})
