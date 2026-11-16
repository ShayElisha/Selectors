import { describe, expect, it } from 'vitest'
import type { Lane, StaffingStandard } from '../types'
import {
  clampStaffingStandard,
  effectiveStaffingStandard,
  effectiveStaffingStandardAtTime,
  getEffectivePeakHours,
  headcountDeficit,
  isInPeakHours,
  lanesWithStaffingOverrides,
  MAX_LANE_STAFFING,
  MAX_SHIFT_HEADCOUNT,
  normalizeHeadcountStandard,
  normalizeStaffingOverrides,
  shiftHeadcountSnapshot,
  staffingChoicesForLane,
  totalHeadcountDeficit,
  type PeakHoursConfig,
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

  it('builds a reusable shift headcount snapshot', () => {
    expect(
      shiftHeadcountSnapshot({
        presentWorkerIds: ['a', 'b'],
        headcountStandard: undefined,
      }),
    ).toEqual({
      tracked: false,
      standard: undefined,
      present: 2,
      deficit: 0,
      surplus: 0,
    })
    expect(
      shiftHeadcountSnapshot({
        presentWorkerIds: ['a', 'b', 'c'],
        headcountStandard: 5,
      }),
    ).toEqual({
      tracked: true,
      standard: 5,
      present: 3,
      deficit: 2,
      surplus: 0,
    })
    expect(
      totalHeadcountDeficit([
        { presentWorkerIds: ['a'], headcountStandard: 3 },
        { presentWorkerIds: ['a', 'b'], headcountStandard: 2 },
        { presentWorkerIds: ['a'], headcountStandard: undefined },
      ]),
    ).toBe(2)
  })

  describe('peak hours', () => {
    const peakConfig: PeakHoursConfig = {
      hours: [
        { start: 480, end: 600 },   // 08:00-10:00
        { start: 840, end: 960 },   // 14:00-16:00
      ],
      peakStandard: 3,
    }

    // Catalog max must be high enough to allow peakStandard (3+)
    const laneWithPeaks: Lane = {
      ...lane('peak-lane', 5),
      peakHours: peakConfig,
    }

    it('isInPeakHours detects peak time', () => {
      expect(isInPeakHours(peakConfig, 420)).toBe(false)  // 07:00 - before peak
      expect(isInPeakHours(peakConfig, 480)).toBe(true)   // 08:00 - start of peak
      expect(isInPeakHours(peakConfig, 540)).toBe(true)   // 09:00 - during peak
      expect(isInPeakHours(peakConfig, 600)).toBe(false)  // 10:00 - after peak
      expect(isInPeakHours(peakConfig, 840)).toBe(true)   // 14:00 - second peak
      expect(isInPeakHours(peakConfig, 960)).toBe(false)  // 16:00 - after second peak
      expect(isInPeakHours(undefined, 540)).toBe(false)   // no config
    })

    it('getEffectivePeakHours returns lane catalog by default', () => {
      const result = getEffectivePeakHours(laneWithPeaks)
      expect(result).toEqual(peakConfig)
    })

    it('getEffectivePeakHours prefers shift override', () => {
      const overrideConfig: PeakHoursConfig = {
        hours: [{ start: 600, end: 720 }],
        peakStandard: 4,
      }
      
      const result = getEffectivePeakHours(laneWithPeaks, {
        'peak-lane': overrideConfig,
      })
      
      expect(result).toEqual(overrideConfig)
    })

    it('getEffectivePeakHours returns undefined for lane without peaks', () => {
      const result = getEffectivePeakHours(lane('normal-lane', 2))
      expect(result).toBeUndefined()
    })

    it('defaults to shift תקן 1, never catalog max', () => {
      // Catalog max is 2, but without an override the shift base is 1
      expect(effectiveStaffingStandardAtTime(laneWithPeaks, 420)).toBe(1)
      expect(effectiveStaffingStandardAtTime(laneWithPeaks, 540)).toBe(1)
      expect(
        effectiveStaffingStandardAtTime(lane('security', 2), 540),
      ).toBe(1)
    })

    it('uses peak standard only with surplus staff', () => {
      const withSurplus = {
        availableWorkers: 12,
        totalLanes: 5,
      }

      expect(
        effectiveStaffingStandardAtTime(laneWithPeaks, 420, withSurplus),
      ).toBe(1)
      expect(
        effectiveStaffingStandardAtTime(laneWithPeaks, 540, withSurplus),
      ).toBe(3)
      expect(
        effectiveStaffingStandardAtTime(laneWithPeaks, 720, withSurplus),
      ).toBe(1)
      expect(
        effectiveStaffingStandardAtTime(laneWithPeaks, 900, withSurplus),
      ).toBe(3)
    })

    it('skips peak hours when staff is tight or missing headcount context', () => {
      // No availability info → never boost
      expect(effectiveStaffingStandardAtTime(laneWithPeaks, 540)).toBe(1)

      // Exactly base requirement → no surplus → no peak
      expect(
        effectiveStaffingStandardAtTime(laneWithPeaks, 540, {
          availableWorkers: 5,
          totalLanes: 5,
        }),
      ).toBe(1)
    })

    it('respects staffing overrides over peaks', () => {
      expect(
        effectiveStaffingStandardAtTime(laneWithPeaks, 540, {
          staffingOverrides: { 'peak-lane': 1 },
          availableWorkers: 20,
          totalLanes: 5,
        }),
      ).toBe(1)
      expect(
        effectiveStaffingStandardAtTime(laneWithPeaks, 540, {
          staffingOverrides: { 'peak-lane': 2 },
          availableWorkers: 20,
          totalLanes: 5,
        }),
      ).toBe(2)
    })

    it('uses shift peak override only with surplus staff', () => {
      const overrideConfig: PeakHoursConfig = {
        hours: [{ start: 600, end: 720 }],
        peakStandard: 4,
      }
      const withSurplus = {
        peakHoursOverrides: { 'peak-lane': overrideConfig },
        availableWorkers: 20,
        totalLanes: 5,
      }

      expect(
        effectiveStaffingStandardAtTime(laneWithPeaks, 540, withSurplus),
      ).toBe(1)
      expect(
        effectiveStaffingStandardAtTime(laneWithPeaks, 660, withSurplus),
      ).toBe(4)
    })

    it('handles overnight peaks with surplus staff', () => {
      const overnightLane: Lane = {
        ...lane('overnight-lane', 5),
        peakHours: {
          hours: [{ start: 1380, end: 60 }], // 23:00-01:00
          peakStandard: 3,
        },
      }
      const withSurplus = { availableWorkers: 10, totalLanes: 4 }

      expect(
        effectiveStaffingStandardAtTime(overnightLane, 1400, withSurplus),
      ).toBe(3)
      expect(
        effectiveStaffingStandardAtTime(overnightLane, 30, withSurplus),
      ).toBe(3)
      expect(
        effectiveStaffingStandardAtTime(overnightLane, 120, withSurplus),
      ).toBe(1)
    })

    it('priority order: override > peak(with surplus) > shift base 1', () => {
      const overrideConfig: PeakHoursConfig = {
        hours: [{ start: 540, end: 600 }],
        peakStandard: 5,
      }
      const surplus = { availableWorkers: 20, totalLanes: 5 }

      expect(
        effectiveStaffingStandardAtTime(laneWithPeaks, 540, {
          staffingOverrides: { 'peak-lane': 1 },
          peakHoursOverrides: { 'peak-lane': overrideConfig },
          ...surplus,
        }),
      ).toBe(1)

      expect(
        effectiveStaffingStandardAtTime(laneWithPeaks, 540, {
          peakHoursOverrides: { 'peak-lane': overrideConfig },
          ...surplus,
        }),
      ).toBe(5)

      expect(
        effectiveStaffingStandardAtTime(laneWithPeaks, 540, surplus),
      ).toBe(3)

      expect(
        effectiveStaffingStandardAtTime(laneWithPeaks, 420, surplus),
      ).toBe(1)
    })
  })
})
