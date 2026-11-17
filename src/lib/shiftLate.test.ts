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

  it('uses personal late only (ignores shift default)', () => {
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
    ).toBe(0)
  })

  it('builds effective adjustment from personal values', () => {
    expect(
      effectiveWindowAdjustment({
        workerId: 'w1',
        defaultLateMinutes: 45,
        windowAdjustments: { w1: { earlyMinutes: 15 } },
      }),
    ).toEqual({ earlyMinutes: 15 })
    expect(
      effectiveWindowAdjustment({
        workerId: 'w1',
        windowAdjustments: { w1: { lateMinutes: 30, earlyMinutes: 15 } },
      }),
    ).toEqual({ lateMinutes: 30, earlyMinutes: 15 })
  })
})
