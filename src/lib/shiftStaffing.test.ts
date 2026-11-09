import { describe, expect, it } from 'vitest'
import type { Lane, StaffingStandard } from '../types'
import {
  clampStaffingStandard,
  effectiveStaffingStandard,
  headcountDeficit,
  lanesWithStaffingOverrides,
  MAX_LANE_STAFFING,
  MAX_SHIFT_HEADCOUNT,
  normalizeHeadcountStandard,
  normalizeStaffingOverrides,
  staffingChoicesForLane,
} from './shiftStaffing'

const lane = (id: string, staffingStandard: StaffingStandard): Lane => ({
  id,
  name: id,
  staffingStandard,
  requiredCertifications: [],
  intensity: 'easy',
})

describe('shiftStaffing', () => {
  it('clamps staffing to 1…5', () => {
    expect(clampStaffingStandard(0)).toBe(1)
    expect(clampStaffingStandard(3)).toBe(3)
    expect(clampStaffingStandard(9)).toBe(MAX_LANE_STAFFING)
    expect(clampStaffingStandard('4')).toBe(4)
  })

  it('normalizes overrides', () => {
    expect(normalizeStaffingOverrides({ a: 2, b: 3, c: '1', d: 9 })).toEqual({
      a: 2,
      b: 3,
      c: 1,
    })
    expect(normalizeStaffingOverrides(null)).toEqual({})
  })

  it('resolves effective תקן defaulting to 1, clamped to lane max', () => {
    const l = lane('x', 1)
    expect(effectiveStaffingStandard(l, { x: 2 })).toBe(1)
    expect(effectiveStaffingStandard(l, {})).toBe(1)
    expect(effectiveStaffingStandard(lane('y', 2), { y: 1 })).toBe(1)
    expect(effectiveStaffingStandard(lane('y', 2), {})).toBe(1)
    expect(effectiveStaffingStandard(lane('y', 2), { y: 2 })).toBe(2)
    expect(effectiveStaffingStandard(lane('z', 5), { z: 4 })).toBe(4)
    expect(
      effectiveStaffingStandard(
        lane('z', 5),
        { z: 9 } as unknown as Record<string, StaffingStandard>,
      ),
    ).toBe(5)
    expect(effectiveStaffingStandard(undefined, { x: 2 })).toBe(1)
  })

  it('maps lanes with overrides; empty overrides use default 1', () => {
    const lanes = [lane('a', 1), lane('b', 2)]
    const next = lanesWithStaffingOverrides(lanes, { a: 2, b: 1 })
    expect(next[0]!.staffingStandard).toBe(1)
    expect(next[1]!.staffingStandard).toBe(1)
    expect(lanes[0]!.staffingStandard).toBe(1)
    const defaults = lanesWithStaffingOverrides(lanes, {})
    expect(defaults[0]!.staffingStandard).toBe(1)
    expect(defaults[1]!.staffingStandard).toBe(1)
  })

  it('lists staffing choices up to lane max', () => {
    expect(staffingChoicesForLane(lane('a', 1))).toEqual([1])
    expect(staffingChoicesForLane(lane('b', 2))).toEqual([1, 2])
    expect(staffingChoicesForLane(lane('c', 5))).toEqual([1, 2, 3, 4, 5])
  })

  it('normalizes whole-shift headcount; empty clears tracking', () => {
    expect(normalizeHeadcountStandard(undefined)).toBeUndefined()
    expect(normalizeHeadcountStandard('')).toBeUndefined()
    expect(normalizeHeadcountStandard(0)).toBeUndefined()
    expect(normalizeHeadcountStandard(-2)).toBeUndefined()
    expect(normalizeHeadcountStandard(12)).toBe(12)
    expect(normalizeHeadcountStandard('8')).toBe(8)
    expect(normalizeHeadcountStandard(200)).toBe(MAX_SHIFT_HEADCOUNT)
  })

  it('computes headcount deficit vs present', () => {
    expect(headcountDeficit(10, undefined)).toBe(0)
    expect(headcountDeficit(10, 8)).toBe(0)
    expect(headcountDeficit(7, 10)).toBe(3)
    expect(headcountDeficit(0, 5)).toBe(5)
  })
})
