import { describe, expect, it } from 'vitest'
import {
  clampShiftLateMinutes,
  effectiveLateMinutes,
  effectiveWindowAdjustment,
} from './shiftLate'

describe('shiftLate', () => {
  it('clamps to allowed steps', () => {
    expect(clampShiftLateMinutes(30)).toBe(30)
    expect(clampShiftLateMinutes(12)).toBe(0)
  })

  it('uses personal late over shift default', () => {
    expect(
      effectiveLateMinutes({
        workerId: 'w1',
        defaultLateMinutes: 30,
        windowAdjustments: { w1: { lateMinutes: 15 } },
      }),
    ).toBe(15)
    expect(
      effectiveLateMinutes({
        workerId: 'w1',
        defaultLateMinutes: 30,
        windowAdjustments: { w1: { lateMinutes: 0 } },
      }),
    ).toBe(0)
    expect(
      effectiveLateMinutes({
        workerId: 'w2',
        defaultLateMinutes: 30,
        windowAdjustments: {},
      }),
    ).toBe(30)
  })

  it('builds effective adjustment', () => {
    expect(
      effectiveWindowAdjustment({
        workerId: 'w1',
        defaultLateMinutes: 45,
        windowAdjustments: { w1: { earlyMinutes: 15 } },
      }),
    ).toEqual({ lateMinutes: 45, earlyMinutes: 15 })
  })
})
