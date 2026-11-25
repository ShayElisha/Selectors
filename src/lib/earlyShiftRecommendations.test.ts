import { describe, expect, it } from 'vitest'
import type {
  Lane,
  ShiftModel,
  ShiftSchedule,
  Worker,
  WorkerWindowPreset,
} from '../types'
import { earlyShiftRecommendations } from './earlyShiftRecommendations'

const models: ShiftModel[] = [
  { id: 'morning', name: 'בוקר', startMinutes: 6 * 60, endMinutes: 14 * 60 + 30, order: 0 },
  { id: 'afternoon', name: 'צהריים', startMinutes: 14 * 60 + 30, endMinutes: 21 * 60 + 30, order: 1 },
  { id: 'night', name: 'לילה', startMinutes: 21 * 60 + 30, endMinutes: 6 * 60, order: 2 },
]

const presets: WorkerWindowPreset[] = [
  {
    id: '1830-0630',
    label: '18:30–06:30',
    name: 'לילה מוקדם',
    start: 18 * 60 + 30,
    end: 6 * 60 + 30,
    order: 0,
  },
  {
    id: '1830-2130',
    label: '18:30–21:30',
    name: 'משמרת אב קצרה',
    start: 18 * 60 + 30,
    end: 21 * 60 + 30,
    order: 1,
  },
  {
    id: '2100-0630',
    label: '21:00–06:30',
    name: 'כמעט סוף צהריים',
    start: 21 * 60,
    end: 6 * 60 + 30,
    order: 2,
  },
]

function lane(id: string, name: string): Lane {
  return {
    id,
    name,
    staffingStandard: 2,
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

function shift(
  partial: Partial<ShiftSchedule> &
    Pick<ShiftSchedule, 'id' | 'date' | 'shiftType'>,
): ShiftSchedule {
  return {
    presentWorkerIds: [],
    activeLaneIds: [],
    assignments: [],
    createdAt: '2026-11-24T10:00:00.000Z',
    updatedAt: '2026-11-24T10:00:00.000Z',
    ...partial,
  }
}

describe('earlyShiftRecommendations', () => {
  it('suggests a night worker who starts during the afternoon shift', () => {
    const afternoon = shift({
      id: 'afternoon-1',
      date: '2026-11-24',
      shiftType: 'afternoon',
      presentWorkerIds: ['a'],
      activeLaneIds: ['lane-1'],
      staffingOverrides: { 'lane-1': 2 },
      assignments: [{ laneId: 'lane-1', workerIds: ['a', ''] }],
    })
    const night = shift({
      id: 'night-1',
      date: '2026-11-24',
      shiftType: 'night',
      presentWorkerIds: ['early'],
      activeLaneIds: ['lane-1'],
      assignments: [{ laneId: 'lane-1', workerIds: ['early'] }],
      workerWindows: { early: '1830-0630' },
    })

    const recommendations = earlyShiftRecommendations({
      current: afternoon,
      history: [afternoon, night],
      workers: [worker('a', 'עובד א'), worker('early', 'דני לילה')],
      lanes: [lane('lane-1', 'נתיב 1')],
      models,
      presets,
    })

    expect(recommendations).toHaveLength(1)
    expect(recommendations[0]).toMatchObject({
      workerId: 'early',
      workerName: 'דני לילה',
      sourceShiftName: 'לילה',
      startsAt: '18:30',
      laneId: 'lane-1',
      windowPreset: expect.objectContaining({
        id: '1830-0630',
        start: 18 * 60 + 30,
        end: 6 * 60 + 30,
      }),
    })
  })

  it('suggests when night uses a short afternoon-shaped window (משמרת אב קצרה)', () => {
    const afternoon = shift({
      id: 'afternoon-1',
      date: '2026-11-24',
      shiftType: 'afternoon',
      presentWorkerIds: [],
      activeLaneIds: ['lane-1'],
      staffingOverrides: { 'lane-1': 1 },
      assignments: [{ laneId: 'lane-1', workerIds: [''] }],
    })
    const night = shift({
      id: 'night-1',
      date: '2026-11-24',
      shiftType: 'night',
      presentWorkerIds: ['aryeh'],
      activeLaneIds: ['lane-1'],
      assignments: [{ laneId: 'lane-1', workerIds: ['aryeh'] }],
      workerWindows: { aryeh: '1830-2130' },
    })

    const recommendations = earlyShiftRecommendations({
      current: afternoon,
      history: [night],
      workers: [worker('aryeh', 'אריה כהן')],
      lanes: [lane('lane-1', 'נתיב 1')],
      models,
      presets,
    })

    expect(recommendations).toHaveLength(1)
    expect(recommendations[0]).toMatchObject({
      workerId: 'aryeh',
      workerName: 'אריה כהן',
      startsAt: '18:30',
      sourceShiftName: 'לילה',
    })
  })

  it('does not suggest workers already present on the current shift', () => {
    const afternoon = shift({
      id: 'afternoon-1',
      date: '2026-11-24',
      shiftType: 'afternoon',
      presentWorkerIds: ['early'],
      activeLaneIds: ['lane-1'],
      assignments: [{ laneId: 'lane-1', workerIds: ['early'] }],
    })
    const night = shift({
      id: 'night-1',
      date: '2026-11-24',
      shiftType: 'night',
      presentWorkerIds: ['early'],
      activeLaneIds: ['lane-1'],
      assignments: [{ laneId: 'lane-1', workerIds: ['early'] }],
      workerWindows: { early: '1830-0630' },
    })

    expect(
      earlyShiftRecommendations({
        current: afternoon,
        history: [afternoon, night],
        workers: [worker('early', 'דני לילה')],
        lanes: [lane('lane-1', 'נתיב 1')],
        models,
        presets,
      }),
    ).toEqual([])
  })

  it('does not suggest arrivals within the last hour of the current shift', () => {
    const afternoon = shift({
      id: 'afternoon-1',
      date: '2026-11-24',
      shiftType: 'afternoon',
      presentWorkerIds: [],
      activeLaneIds: ['lane-1'],
      staffingOverrides: { 'lane-1': 1 },
      assignments: [{ laneId: 'lane-1', workerIds: [''] }],
    })
    const night = shift({
      id: 'night-1',
      date: '2026-11-24',
      shiftType: 'night',
      presentWorkerIds: ['late'],
      activeLaneIds: ['lane-1'],
      assignments: [{ laneId: 'lane-1', workerIds: ['late'] }],
      workerWindows: { late: '2100-0630' },
    })

    expect(
      earlyShiftRecommendations({
        current: afternoon,
        history: [night],
        workers: [worker('late', 'מגיע מאוחר')],
        lanes: [lane('lane-1', 'נתיב 1')],
        models,
        presets,
      }),
    ).toEqual([])
  })

  it('returns nothing when there is no later shift in history', () => {
    const afternoon = shift({
      id: 'afternoon-1',
      date: '2026-11-24',
      shiftType: 'afternoon',
      presentWorkerIds: [],
      activeLaneIds: ['lane-1'],
      assignments: [{ laneId: 'lane-1', workerIds: [''] }],
    })

    expect(
      earlyShiftRecommendations({
        current: afternoon,
        history: [afternoon],
        workers: [worker('early', 'דני לילה')],
        lanes: [lane('lane-1', 'נתיב 1')],
        models,
        presets,
      }),
    ).toEqual([])
  })
})
