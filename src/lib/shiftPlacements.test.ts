import { describe, expect, it } from 'vitest'
import { placementLoadOnDay } from '../algorithm'
import type { Lane, ShiftSchedule } from '../types'
import { shiftPlacements } from './shiftPlacements'

function inspectorShift(): ShiftSchedule {
  return {
    id: 'i',
    date: '2026-09-25',
    shiftType: 'morning',
    activeLaneIds: ['a'],
    presentWorkerIds: ['w1'],
    assignments: [{ laneId: 'a', workerIds: ['w1'] }],
    createdAt: '',
    updatedAt: '',
  }
}

describe('shiftPlacements', () => {
  it('counts an inspector lane placement as a full shift', () => {
    expect(shiftPlacements(inspectorShift())).toEqual([
      { laneId: 'a', workerId: 'w1', weight: 1 },
    ])
  })

  it('splits a selector shift across rounds by duration', () => {
    const shift: ShiftSchedule = {
      ...inspectorShift(),
      audience: 'selector',
      assignments: [],
      rounds: [
        {
          startMinutes: 6 * 60,
          endMinutes: 8 * 60,
          label: '06:00–08:00',
          assignments: [{ laneId: 'hard', workerIds: ['w1'] }],
        },
        {
          startMinutes: 8 * 60,
          endMinutes: 10 * 60,
          label: '08:00–10:00',
          assignments: [{ laneId: 'easy', workerIds: ['w1'] }],
        },
      ],
    }
    const placed = shiftPlacements(shift)
    expect(placed).toHaveLength(2)
    expect(placed[0]).toMatchObject({ laneId: 'hard', weight: 0.5 })
    expect(placed[1]).toMatchObject({ laneId: 'easy', weight: 0.5 })
    expect(placed.reduce((n, p) => n + p.weight, 0)).toBe(1)
  })

  it('gives a full selector shift the same load as one inspector placement', () => {
    const hard: Lane = {
      id: 'hard',
      name: 'קשה',
      staffingStandard: 1,
      requiredCertifications: [],
      intensity: 'hard',
    }
    const lanes = new Map([[hard.id, hard]])
    const base = inspectorShift()
    const inspector: ShiftSchedule = {
      ...base,
      assignments: [{ laneId: 'hard', workerIds: ['w1'] }],
    }
    const selector: ShiftSchedule = {
      ...base,
      audience: 'selector',
      assignments: [],
      rounds: [
        {
          startMinutes: 360,
          endMinutes: 480,
          label: '06:00–08:00',
          assignments: [{ laneId: 'hard', workerIds: ['w1'] }],
        },
        {
          startMinutes: 480,
          endMinutes: 600,
          label: '08:00–10:00',
          assignments: [{ laneId: 'hard', workerIds: ['w1'] }],
        },
      ],
    }
    expect(placementLoadOnDay('w1', [selector], lanes)).toBe(
      placementLoadOnDay('w1', [inspector], lanes),
    )
  })
})
