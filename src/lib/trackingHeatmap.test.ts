import { describe, expect, it } from 'vitest'
import type { ShiftSchedule, Worker } from '../types'
import type { WorkerLaneStats } from '../algorithm'
import {
  compareTrackingRows,
  filterLanesByIntensity,
  formatLoadOneDecimal,
  formatVisitRecency,
  heatLevel,
  inclusiveRangeDays,
  listWorkerLaneVisits,
  maxLaneCount,
  normalizeHeSearch,
  teamAverageLoad,
  workerMatchesSearch,
} from './trackingHeatmap'

describe('heatLevel', () => {
  it('returns 0 for empty cells', () => {
    expect(heatLevel(0, { maxInData: 5, rangeDays: 14 })).toBe(0)
    expect(heatLevel(2, { maxInData: 0, rangeDays: 14 })).toBe(0)
  })

  it('makes the same count hotter in a short range than all-time', () => {
    const short = heatLevel(3, { maxInData: 5, rangeDays: 14 })
    const allTime = heatLevel(3, { maxInData: 5, rangeDays: null })
    expect(short).toBeGreaterThan(allTime)
  })

  it('never marks a single visit as hottest', () => {
    expect(heatLevel(1, { maxInData: 1, rangeDays: 14 })).toBeLessThan(3)
  })

  it('is deterministic for mid values', () => {
    expect(heatLevel(2, { maxInData: 8, rangeDays: 30 })).toBe(1)
    expect(heatLevel(5, { maxInData: 8, rangeDays: 30 })).toBe(3)
    expect(heatLevel(8, { maxInData: 8, rangeDays: 14 })).toBe(4)
  })
})

describe('inclusiveRangeDays', () => {
  it('counts inclusive span', () => {
    expect(inclusiveRangeDays('2026-09-01', '2026-09-14')).toBe(14)
  })

  it('returns null when open-ended', () => {
    expect(inclusiveRangeDays(undefined, '2026-09-14')).toBeNull()
    expect(inclusiveRangeDays('2026-09-01', undefined)).toBeNull()
  })
})

describe('normalizeHeSearch / workerMatchesSearch', () => {
  it('strips nikud and matches substrings', () => {
    expect(normalizeHeSearch('שַׁי')).toContain('שי')
    expect(workerMatchesSearch('שי אלישע', 'שי')).toBe(true)
    expect(workerMatchesSearch('שי אלישע', 'דני')).toBe(false)
  })
})

describe('formatVisitRecency', () => {
  it('labels today / yesterday / N days', () => {
    expect(formatVisitRecency(0)).toBe('מוקדם יותר היום')
    expect(formatVisitRecency(1)).toBe('אתמול')
    expect(formatVisitRecency(5)).toBe('לפני 5 ימים')
  })
})

describe('formatLoadOneDecimal / teamAverageLoad / maxLaneCount', () => {
  it('formats loads and aggregates', () => {
    expect(formatLoadOneDecimal(10)).toBe('10.0')
    expect(formatLoadOneDecimal(12.55)).toBe('12.6')

    const stats: WorkerLaneStats[] = [
      stubStats({ effectiveLoad: 10, byLane: { a: 2 } }),
      stubStats({ effectiveLoad: 15, byLane: { a: 5, b: 1 } }),
    ]
    expect(teamAverageLoad(stats)).toBe(12.5)
    expect(maxLaneCount(stats)).toBe(5)
  })
})

describe('filterLanesByIntensity', () => {
  it('filters or returns all', () => {
    const lanes = [
      { id: '1', intensity: 'easy' as const },
      { id: '2', intensity: 'hard' as const },
    ]
    expect(filterLanesByIntensity(lanes, 'all')).toHaveLength(2)
    expect(filterLanesByIntensity(lanes, 'hard').map((l) => l.id)).toEqual([
      '2',
    ])
  })
})

describe('listWorkerLaneVisits', () => {
  it('returns day visits newest first and excludes nights', () => {
    const history: ShiftSchedule[] = [
      shift('2026-09-10', 'morning', 'w1', 'l1'),
      shift('2026-09-18', 'night', 'w1', 'l1'),
      shift('2026-09-12', 'afternoon', 'w1', 'l2'),
      shift('2026-08-01', 'morning', 'w1', 'l1'),
    ]
    const visits = listWorkerLaneVisits(history, 'w1', 'l1', {
      fromDate: '2026-09-01',
      toDate: '2026-09-30',
      today: '2026-09-20',
    })
    expect(visits).toHaveLength(1)
    expect(visits[0]).toMatchObject({
      date: '2026-09-10',
      shiftType: 'morning',
      daysAgo: 10,
    })
  })
})

describe('compareTrackingRows', () => {
  it('sorts by load desc with name tie-break', () => {
    const workers: Worker[] = [
      stubWorker('a', 'אבי'),
      stubWorker('b', 'בני'),
    ]
    const map = new Map<string, WorkerLaneStats>([
      ['a', stubStats({ effectiveLoad: 5 })],
      ['b', stubStats({ effectiveLoad: 10 })],
    ])
    const cmp = compareTrackingRows(workers[0]!, workers[1]!, 'load', 'desc', map)
    expect(cmp).toBeGreaterThan(0)
  })
})

function stubStats(
  partial: Partial<WorkerLaneStats> & { workerId?: string },
): WorkerLaneStats {
  return {
    workerId: partial.workerId ?? 'w',
    byLane: partial.byLane ?? {},
    hardCount: partial.hardCount ?? 0,
    mediumCount: partial.mediumCount ?? 0,
    easyCount: partial.easyCount ?? 0,
    dayEasyCount: partial.dayEasyCount ?? 0,
    nightEasyCount: partial.nightEasyCount ?? 0,
    effectiveLoad: partial.effectiveLoad ?? 0,
    hardByShift: partial.hardByShift ?? {
      morning: 0,
      afternoon: 0,
      night: 0,
    },
    totalAssignments: partial.totalAssignments ?? 0,
  }
}

function stubWorker(id: string, fullName: string): Worker {
  return {
    id,
    fullName,
    phone: '',
    certifications: [],
    status: 'active',
    isInspector: true,
    isManager: false,
  }
}

function shift(
  date: string,
  shiftType: ShiftSchedule['shiftType'],
  workerId: string,
  laneId: string,
): ShiftSchedule {
  return {
    id: `${date}-${shiftType}`,
    date,
    shiftType,
    activeLaneIds: [laneId],
    presentWorkerIds: [workerId],
    assignments: [{ laneId, workerIds: [workerId] }],
    createdAt: '',
    updatedAt: '',
  }
}
