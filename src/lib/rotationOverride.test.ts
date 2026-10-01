import { describe, expect, it } from 'vitest'
import { rotationOverrideWarning } from './rotationOverride'
import type { Lane, ShiftSchedule, Worker } from '../types'

function person(id: string, name: string): Worker {
  return {
    id,
    fullName: name,
    phone: '050',
    certifications: ['c'],
    status: 'active',
    isInspector: true,
    isManager: false,
  }
}

const lane: Lane = {
  id: 'h',
  name: 'קשה',
  staffingStandard: 1,
  requiredCertifications: ['c'],
  intensity: 'hard',
}

function shift(date: string, workerId: string): ShiftSchedule {
  return {
    id: date,
    date,
    shiftType: 'morning',
    activeLaneIds: ['h'],
    presentWorkerIds: [workerId],
    assignments: [{ laneId: 'h', workerIds: [workerId] }],
    createdAt: `${date}T00:00:00.000Z`,
    updatedAt: `${date}T00:00:00.000Z`,
  }
}

describe('rotation override warning', () => {
  it('warns when a manual pick returns to the lane while someone else is farther away', () => {
    const message = rotationOverrideWarning({
      lane,
      worker: person('recent', 'קרוב'),
      alternatives: [person('far', 'רחוק')],
      history: [shift('2026-03-09', 'recent')],
      lanes: [lane],
      shiftType: 'morning',
      date: '2026-03-10',
    })
    expect(message).toContain('כלל הרוטציה נעקף')
    expect(message).toContain('רחוק')
  })

  it('stays quiet when the chosen person is not a short return', () => {
    const message = rotationOverrideWarning({
      lane,
      worker: person('far', 'רחוק'),
      alternatives: [person('recent', 'קרוב')],
      history: [shift('2026-03-09', 'recent')],
      lanes: [lane],
      shiftType: 'morning',
      date: '2026-03-10',
    })
    expect(message).toBeNull()
  })
})
