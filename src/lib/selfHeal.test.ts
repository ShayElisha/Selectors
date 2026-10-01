import { describe, expect, it } from 'vitest'
import { accumulateLoadBalance, groupShiftsByDate } from '../algorithm'
import { planRemoval, removalMinute } from './selfHeal'
import type { Lane, ShiftSchedule, Worker } from '../types'

function worker(id: string, name: string, certifications: string[] = []): Worker {
  return {
    id,
    fullName: name,
    phone: '0500000000',
    certifications,
    status: 'active',
    isInspector: true,
    isManager: false,
  }
}

function lane(
  id: string,
  name: string,
  intensity: Lane['intensity'],
  extra: Partial<Lane> = {},
): Lane {
  return {
    id,
    name,
    intensity,
    staffingStandard: 1,
    requiredCertifications: extra.requiredCertifications ?? [],
    ...extra,
  }
}

const morning = {
  date: '2026-03-10',
  shiftType: 'morning' as const,
  presentWorkerIds: ['leave', 'spare', 'easy'],
  assignments: [
    { laneId: 'hard', workerIds: ['leave'] },
    { laneId: 'easy', workerIds: ['easy'] },
  ],
  rounds: [],
  activeLaneIds: ['hard', 'easy'],
}

describe('self-heal board', () => {
  const lanes = [
    lane('hard', 'קשה', 'hard', { requiredCertifications: ['c'] }),
    lane('easy', 'קל', 'easy', { requiredCertifications: ['c'] }),
  ]
  const workers = [
    worker('leave', 'עוזב', ['c']),
    worker('spare', 'עתודה', ['c']),
    worker('easy', 'קלן', ['c']),
  ]

  it('fills a vacated hard lane from someone who is waiting', () => {
    const { healed } = planRemoval({
      draft: morning,
      workerId: 'leave',
      workers,
      lanes,
      history: [],
      startMinutes: 6 * 60,
      endMinutes: 14 * 60,
      atMinutes: 10 * 60,
    })
    expect(healed.assignments.find((row) => row.laneId === 'hard')?.workerIds).toEqual([
      'spare',
    ])
    expect(healed.frozenLaneIds).not.toContain('easy')
    expect(healed.moves[0]?.fromLaneId).toBeNull()
    expect(healed.seatSegments?.some((segment) => segment.workerId === 'leave')).toBe(true)
    expect(healed.lines.some((line) => line.includes('עוזב') && line.includes('משקל עומס'))).toBe(
      true,
    )
  })

  it('moves someone from an easy lane when nobody is waiting, and freezes that lane', () => {
    const { healed } = planRemoval({
      draft: { ...morning, presentWorkerIds: ['leave', 'easy'] },
      workerId: 'leave',
      workers,
      lanes,
      history: [],
      startMinutes: 6 * 60,
      endMinutes: 14 * 60,
      atMinutes: 10 * 60,
    })
    expect(healed.assignments.find((row) => row.laneId === 'hard')?.workerIds).toEqual([
      'easy',
    ])
    expect(healed.assignments.find((row) => row.laneId === 'easy')?.workerIds).toEqual([''])
    expect(healed.frozenLaneIds).toContain('easy')
    expect(healed.highlights.some((item) => item.tone === 'frozen')).toBe(true)
  })

  it('does not give the person who left a rest day, and scales the load by time sat', () => {
    const { healed } = planRemoval({
      draft: { ...morning, presentWorkerIds: ['leave', 'spare'] },
      workerId: 'leave',
      workers,
      lanes,
      history: [],
      startMinutes: 6 * 60,
      endMinutes: 14 * 60,
      atMinutes: 10 * 60,
    })
    const shift: ShiftSchedule = {
      id: 's',
      date: '2026-03-10',
      shiftType: 'morning',
      activeLaneIds: ['hard'],
      presentWorkerIds: healed.presentWorkerIds,
      assignments: healed.assignments,
      seatSegments: healed.seatSegments,
      seatSpan: healed.seatSpan,
      createdAt: '2026-03-10T00:00:00.000Z',
      updatedAt: '2026-03-10T00:00:00.000Z',
    }
    const laneMap = new Map(lanes.map((item) => [item.id, item]))
    const balance = accumulateLoadBalance(
      'leave',
      groupShiftsByDate([shift]),
      laneMap,
      '2026-03-10',
      '2026-03-10',
      { family: 'morning' },
    )
    expect(balance.net).toBeGreaterThan(0)
    expect(balance.net).toBeLessThan(3.5)
  })

  it('keeps a future shift at the start of the window', () => {
    expect(
      removalMinute({
        shiftDate: '2099-01-01',
        startMinutes: 360,
        endMinutes: 840,
        now: new Date(2026, 2, 10, 12, 0, 0),
      }),
    ).toBe(360)
  })
})
