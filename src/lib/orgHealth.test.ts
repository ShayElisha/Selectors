import { describe, expect, it } from 'vitest'
import type { Lane, ShiftSchedule } from '../types'
import {
  busiestHardWeekday,
  hardLoadByWeekday,
  laneUtilization,
  monthlyLoadTrend,
  overrideReport,
} from './orgHealth'

function lane(id: string, intensity: Lane['intensity']): Lane {
  return {
    id,
    name: id,
    staffingStandard: 1,
    requiredCertifications: [],
    intensity,
  }
}

function shift(
  date: string,
  laneId: string,
  shiftType: ShiftSchedule['shiftType'] = 'morning',
): ShiftSchedule {
  return {
    id: date + laneId,
    date,
    shiftType,
    activeLaneIds: [laneId],
    presentWorkerIds: ['a'],
    assignments: [{ laneId, workerIds: ['a'] }],
    createdAt: `${date}T00:00:00.000Z`,
    updatedAt: `${date}T00:00:00.000Z`,
  }
}

describe('organizational health', () => {
  const lanes = [lane('hard', 'hard'), lane('easy', 'easy')]

  it('finds the weekday with the most hard-lane work', () => {
    const history = [
      shift('2026-03-01', 'hard'),
      shift('2026-03-01', 'hard', 'afternoon'),
      shift('2026-03-02', 'hard'),
    ]
    const rows = hardLoadByWeekday(history, lanes, '2026-03-01', '2026-03-07')
    const top = busiestHardWeekday(rows)
    expect(top?.label).toBe('ראשון')
    expect(top?.hard).toBe(2)
  })

  it('measures lane use and a monthly rise then fall', () => {
    const history = [
      shift('2026-03-01', 'hard'),
      shift('2026-04-01', 'easy'),
    ]
    const use = laneUtilization(history, lanes)
    expect(use.find((row) => row.laneId === 'hard')?.filled).toBe(1)
    const trend = monthlyLoadTrend(history, lanes)
    expect(trend.map((row) => row.month)).toEqual(['2026-03', '2026-04'])
    expect(trend[0]!.load).toBeGreaterThan(trend[1]!.load)
  })

  it('counts manual overrides against automatic proposals', () => {
    const report = overrideReport(
      [
        { action: 'auto_assign', at: '2026-03-01T10:00:00.000Z' },
        { action: 'manual_assign', at: '2026-03-01T11:00:00.000Z' },
        { action: 'manual_swap', at: '2026-03-02T11:00:00.000Z' },
        { action: 'login', at: '2026-03-02T11:00:00.000Z' },
      ],
      '2026-03-01',
      '2026-03-31',
    )
    expect(report.auto).toBe(1)
    expect(report.manual).toBe(2)
    expect(report.rate).toBeCloseTo(2 / 3)
  })
})
