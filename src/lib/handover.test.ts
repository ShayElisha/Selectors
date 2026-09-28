import { describe, expect, it } from 'vitest'
import type { Lane, Worker } from '../types'
import { buildHandoverText } from './handover'

function lane(id: string, name: string): Lane {
  return {
    id,
    name,
    staffingStandard: 1,
    requiredCertifications: [],
    intensity: 'medium',
  }
}

function worker(id: string, fullName: string): Worker {
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

describe('buildHandoverText', () => {
  it('collects notes, an empty lane, and people who continue', () => {
    const text = buildHandoverText({
      date: '2026-09-27',
      shiftType: 'morning',
      lanes: [lane('a', 'מוביליות'), lane('b', 'מכס')],
      workers: [worker('stay', 'אוריה כהן'), worker('done', 'אדיר דאי')],
      activeLaneIds: ['a', 'b'],
      presentWorkerIds: ['stay', 'done'],
      workerWindows: { stay: '0600-1830', done: '0600-1500' },
      assignments: [
        { laneId: 'b', workerIds: ['done'], notes: 'פתוח מול המכס' },
        { laneId: 'a', workerIds: ['stay'] },
      ],
      rounds: [
        {
          startMinutes: 13 * 60,
          endMinutes: 15 * 60,
          label: '13:00–15:00',
          assignments: [
            { laneId: 'a', workerIds: ['stay'] },
            { laneId: 'b', workerIds: [] },
          ],
        },
      ],
    })
    expect(text).toContain('הערות')
    expect(text).toContain('מכס: פתוח מול המכס')
    expect(text).toContain('נתיב בלי בודק')
    expect(text).toContain('• מכס')
    expect(text).not.toContain('מוביליות')
    expect(text).toContain('ממשיכים לצהריים א')
    expect(text).toContain('אוריה כהן')
    expect(text).not.toContain('אדיר דאי')
  })
})
