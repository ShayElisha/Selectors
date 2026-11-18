import { describe, expect, it } from 'vitest'
import { workerShiftEnd, workerShiftHasEnded } from './workerShiftStatus'
import type { ShiftModel, ShiftSchedule, WorkerWindowPreset } from '../types'

const models: ShiftModel[] = [
  { id: 'morning', name: 'בוקר', startMinutes: 360, endMinutes: 870, order: 0 },
  { id: 'night', name: 'לילה', startMinutes: 1290, endMinutes: 390, order: 1 },
]
const presets: WorkerWindowPreset[] = [
  { id: 'short', label: 'קצר', start: 360, end: 840 },
  { id: 'overnight', label: 'לילה', start: 1290, end: 390 },
]
const shift: ShiftSchedule = {
  id: 'shift-1',
  date: '2026-11-18',
  shiftType: 'morning',
  activeLaneIds: [],
  presentWorkerIds: ['worker-1'],
  assignments: [],
  createdAt: '2026-11-18T00:00:00.000Z',
  updatedAt: '2026-11-18T00:00:00.000Z',
}

describe('workerShiftEnd', () => {
  it('uses the personal window and early adjustment when configured', () => {
    const end = workerShiftEnd(
      {
        ...shift,
        workerWindows: { 'worker-1': 'short' },
        windowAdjustments: { 'worker-1': { earlyMinutes: 30 } },
      },
      'worker-1',
      models,
      presets,
    )

    expect(end?.minutes).toBe(13 * 60 + 30)
    expect(end?.dayOffset).toBe(0)
  })

  it('uses the next-day end for overnight shifts', () => {
    const end = workerShiftEnd(
      { ...shift, shiftType: 'night', workerWindows: { 'worker-1': 'overnight' } },
      'worker-1',
      models,
      presets,
    )

    expect(end?.minutes).toBe(6 * 60 + 30)
    expect(end?.dayOffset).toBe(1)
    expect(end?.timestamp).toBe(
      new Date(2026, 10, 19, 6, 30).getTime(),
    )
  })

  it('anchors daytime personal hours after an overnight shift starts', () => {
    const end = workerShiftEnd(
      { ...shift, shiftType: 'night', workerWindows: { 'worker-1': 'short' } },
      'worker-1',
      models,
      presets,
    )

    expect(end?.minutes).toBe(14 * 60)
    expect(end?.dayOffset).toBe(1)
  })

  it('uses a recorded early leave as the end time', () => {
    const end = workerShiftEnd(
      { ...shift, earlyLeaveAt: { 'worker-1': 13 * 60 } },
      'worker-1',
      models,
      presets,
    )
    expect(end?.minutes).toBe(13 * 60)
  })

  it('reports completion based on the planned end, without mutating the shift', () => {
    const now = new Date(2026, 10, 18, 14, 0).getTime()
    expect(workerShiftHasEnded(shift, 'worker-1', models, presets, now)).toBe(false)
    expect(
      workerShiftHasEnded(shift, 'worker-1', models, presets, now + 60 * 60_000),
    ).toBe(true)
    expect(shift.presentWorkerIds).toEqual(['worker-1'])
  })
})
