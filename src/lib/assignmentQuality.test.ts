import { describe, expect, it } from 'vitest'
import {
  computeShortReturnRate,
  parseOptimizerImprovingPasses,
} from './assignmentQuality'
import type { Lane, ShiftSchedule, Worker } from '../types'

function worker(id: string, name: string): Worker {
  return {
    id,
    fullName: name,
    phone: '0500000000',
    certifications: [],
    status: 'active',
    isInspector: true,
    isManager: false,
  }
}

function lane(id: string, name: string): Lane {
  return {
    id,
    name,
    staffingStandard: 1,
    requiredCertifications: [],
    intensity: 'medium',
  }
}

function shift(
  id: string,
  date: string,
  shiftType: ShiftSchedule['shiftType'],
  assignments: ShiftSchedule['assignments'],
): ShiftSchedule {
  return {
    id,
    date,
    shiftType,
    activeLaneIds: assignments.map((a) => a.laneId),
    presentWorkerIds: assignments.flatMap((a) => a.workerIds),
    assignments,
    createdAt: `${date}T00:00:00.000Z`,
    updatedAt: `${date}T00:00:00.000Z`,
  }
}

describe('computeShortReturnRate', () => {
  it('counts short returns and includes nights', () => {
    const workers = [worker('a', 'A')]
    const lanes = [lane('l1', 'נתיב 1')]
    const history = [
      shift('1', '2026-09-10', 'morning', [
        { laneId: 'l1', workerIds: ['a'] },
      ]),
      shift('2', '2026-09-10', 'night', [{ laneId: 'l1', workerIds: ['a'] }]),
      shift('3', '2026-09-11', 'afternoon', [
        { laneId: 'l1', workerIds: ['a'] },
      ]),
      shift('4', '2026-09-15', 'morning', [
        { laneId: 'l1', workerIds: ['a'] },
      ]),
    ]
    const q = computeShortReturnRate(history, workers, lanes, { maxDays: 2 })
    // 10 morning, 10 night (same day, short), 11 afternoon (short), 15 morning
    expect(q.totalDayPlacements).toBe(4)
    expect(q.shortReturnPlacements).toBe(2)
    expect(q.rate).toBeCloseTo(0.5)
  })
})

describe('parseOptimizerImprovingPasses', () => {
  it('reads improving-pass count from warning', () => {
    expect(
      parseOptimizerImprovingPasses([
        'שיפור לוח: 3 החלפות ב־4 סיבובים · 2 שיפורים אחרי הסיבוב הראשון',
      ]),
    ).toBe(2)
    expect(parseOptimizerImprovingPasses(['אחר'])).toBe(0)
  })
})
