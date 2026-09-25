import { describe, expect, it } from 'vitest'
import type { Lane, ShiftSchedule, Worker } from '../types'
import {
  FAIRNESS_GAP_ATTENTION,
  FAIRNESS_GAP_HIGH,
  computeTeamAnalytics,
  fairnessGapStatus,
  filterLaneRepeats,
  formatLoadOneDecimal,
  loadDeviationFromMean,
  loadPerShift,
  nextLocalDateISO,
  reliefScore,
  type LaneConcentration,
} from './analytics'

describe('fairnessGapStatus', () => {
  it('uses assumed thresholds', () => {
    expect(FAIRNESS_GAP_ATTENTION).toBe(3)
    expect(FAIRNESS_GAP_HIGH).toBe(6)
    expect(fairnessGapStatus(0)).toBe('good')
    expect(fairnessGapStatus(2.9)).toBe('good')
    expect(fairnessGapStatus(3)).toBe('attention')
    expect(fairnessGapStatus(5.9)).toBe('attention')
    expect(fairnessGapStatus(6)).toBe('high')
  })
})

describe('loadPerShift / formatLoadOneDecimal / deviation', () => {
  it('computes load per shift', () => {
    expect(loadPerShift(10, 4)).toBe(2.5)
    expect(loadPerShift(10, 0)).toBeNull()
  })

  it('formats one decimal', () => {
    expect(formatLoadOneDecimal(8)).toBe('8.0')
    expect(formatLoadOneDecimal(12.55)).toBe('12.6')
  })

  it('classifies deviation from mean', () => {
    expect(loadDeviationFromMean(10, 10)).toBe('near')
    expect(loadDeviationFromMean(10.4, 10)).toBe('near')
    expect(loadDeviationFromMean(11, 10)).toBe('above')
    expect(loadDeviationFromMean(9, 10)).toBe('below')
  })
})

describe('filterLaneRepeats', () => {
  it('keeps only topWorkerCount >= 2 and sorts by count then share', () => {
    const lanes: LaneConcentration[] = [
      stubLane({ laneId: 'a', topWorkerCount: 1, totalAssignments: 5, concentration: 0.2 }),
      stubLane({
        laneId: 'b',
        topWorkerCount: 3,
        totalAssignments: 6,
        concentration: 0.5,
      }),
      stubLane({
        laneId: 'c',
        topWorkerCount: 2,
        totalAssignments: 8,
        concentration: 0.25,
      }),
      stubLane({
        laneId: 'd',
        topWorkerCount: 3,
        totalAssignments: 4,
        concentration: 0.75,
      }),
    ]
    const filtered = filterLaneRepeats(lanes)
    expect(filtered.map((l) => l.laneId)).toEqual(['d', 'b', 'c'])
  })
})

describe('nextLocalDateISO', () => {
  it('advances one calendar day', () => {
    expect(nextLocalDateISO('2026-09-19')).toBe('2026-09-20')
    expect(nextLocalDateISO('2026-09-30')).toBe('2026-10-01')
  })
})

describe('computeTeamAnalytics KPIs', () => {
  const workers: Worker[] = [
    stubWorker('w1', 'אלון'),
    stubWorker('w2', 'בת'),
    stubWorker('w3', 'גיל'),
  ]
  const lanes: Lane[] = [
    stubLaneDef('easy', 'easy'),
    stubLaneDef('hard', 'hard'),
  ]

  it('excludes zero-history workers from avg/gap', () => {
    const history: ShiftSchedule[] = [
      shift('2026-09-01', 'morning', [{ laneId: 'easy', workerIds: ['w1'] }]),
      shift('2026-09-02', 'morning', [{ laneId: 'easy', workerIds: ['w2'] }]),
    ]
    const a = computeTeamAnalytics(workers, lanes, history)
    expect(a.workersWithData).toBe(2)
    expect(a.workersWithoutData).toBe(1)
    expect(a.loadGap).toBe(
      Math.round((a.maxLoad - a.minLoad) * 10) / 10,
    )
    expect(reliefScore(a.needRelief[0]!) >= reliefScore(a.needRelief[1]!)).toBe(
      true,
    )
  })

  it('counts hard on the calendar day after a night, not mere chronological adjacency', () => {
    const history: ShiftSchedule[] = [
      // Classic: night 1.9 → hard morning 2.9
      shift('2026-09-01', 'night', [{ laneId: 'easy', workerIds: ['w1'] }]),
      shift('2026-09-02', 'morning', [
        { laneId: 'hard', workerIds: ['w1'] },
        { laneId: 'easy', workerIds: ['w2'] },
      ]),
      // Hard days later after a night — must NOT count for w2
      shift('2026-09-03', 'night', [{ laneId: 'easy', workerIds: ['w2'] }]),
      shift('2026-09-06', 'afternoon', [
        { laneId: 'hard', workerIds: ['w2'] },
      ]),
      // Hard the day BEFORE night — must NOT count for w3
      shift('2026-09-10', 'afternoon', [
        { laneId: 'hard', workerIds: ['w3'] },
      ]),
      shift('2026-09-10', 'night', [{ laneId: 'easy', workerIds: ['w3'] }]),
    ]

    const a = computeTeamAnalytics(workers, lanes, history)
    expect(a.hardAfterNightTotal).toBe(1)
    expect(a.hardAfterNightEvents).toHaveLength(1)
    expect(a.hardAfterNightEvents[0]).toMatchObject({
      workerId: 'w1',
      nightDate: '2026-09-01',
      date: '2026-09-02',
      laneId: 'hard',
      shiftType: 'morning',
    })
  })

  it('counts Leon-style night then afternoon hard the next calendar day', () => {
    const history: ShiftSchedule[] = [
      shift('2026-09-19', 'night', [{ laneId: 'easy', workerIds: ['w1'] }]),
      shift('2026-09-20', 'afternoon', [
        { laneId: 'hard', workerIds: ['w1'] },
      ]),
    ]
    const a = computeTeamAnalytics(workers, lanes, history)
    expect(a.hardAfterNightTotal).toBe(1)
    expect(a.hardAfterNightEvents[0]).toMatchObject({
      nightDate: '2026-09-19',
      date: '2026-09-20',
      shiftType: 'afternoon',
    })
  })

  it('lists ×1 lane concentration but filter removes them', () => {
    const history: ShiftSchedule[] = [
      shift('2026-09-01', 'morning', [
        { laneId: 'easy', workerIds: ['w1'] },
        { laneId: 'hard', workerIds: ['w2'] },
      ]),
      shift('2026-09-02', 'morning', [
        { laneId: 'easy', workerIds: ['w1'] },
      ]),
    ]
    const a = computeTeamAnalytics(workers, lanes, history)
    const easy = a.lanes.find((l) => l.laneId === 'easy')!
    const hard = a.lanes.find((l) => l.laneId === 'hard')!
    expect(easy.topWorkerCount).toBe(2)
    expect(hard.topWorkerCount).toBe(1)
    const repeats = filterLaneRepeats(a.lanes)
    expect(repeats.every((l) => l.topWorkerCount >= 2)).toBe(true)
    expect(repeats.map((l) => l.laneId)).toEqual(['easy'])
  })
})

function stubLane(
  partial: Partial<LaneConcentration> & { laneId: string },
): LaneConcentration {
  return {
    laneId: partial.laneId,
    laneName: partial.laneName ?? partial.laneId,
    intensity: partial.intensity ?? 'medium',
    totalAssignments: partial.totalAssignments ?? 1,
    uniqueWorkers: partial.uniqueWorkers ?? 1,
    topWorkerId: partial.topWorkerId ?? 'w',
    topWorkerName: partial.topWorkerName ?? 'x',
    topWorkerCount: partial.topWorkerCount ?? 1,
    concentration: partial.concentration ?? 1,
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

function stubLaneDef(id: string, intensity: Lane['intensity']): Lane {
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
  shiftType: ShiftSchedule['shiftType'],
  assignments: ShiftSchedule['assignments'],
): ShiftSchedule {
  return {
    id: `${date}-${shiftType}`,
    date,
    shiftType,
    activeLaneIds: assignments.map((a) => a.laneId),
    presentWorkerIds: assignments.flatMap((a) => a.workerIds),
    assignments,
    createdAt: '',
    updatedAt: '',
  }
}
