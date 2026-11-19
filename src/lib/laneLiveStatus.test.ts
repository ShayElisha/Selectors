import { describe, expect, it } from 'vitest'
import { laneLiveStatus } from './laneLiveStatus'
import type { Lane, ShiftModel, ShiftSchedule, WorkerWindowPreset } from '../types'

const lane: Lane = {
  id: 'lane-a',
  name: 'נתיב א',
  staffingStandard: 2,
  requiredCertifications: [],
  intensity: 'medium',
}

const models: ShiftModel[] = [
  { id: 'afternoon', name: 'צהריים', startMinutes: 14 * 60, endMinutes: 22 * 60, order: 0 },
  { id: 'afternoonB', name: 'משמרת חלופית', startMinutes: 16 * 60, endMinutes: 22 * 60, order: 1 },
  { id: 'night', name: 'לילה', startMinutes: 22 * 60, endMinutes: 6 * 60, order: 2 },
  { id: 'morning', name: 'בוקר', startMinutes: 4 * 60, endMinutes: 12 * 60, order: 3 },
]

const presets: WorkerWindowPreset[] = [
  { id: 'until-15', label: 'עד 15:00', start: 14 * 60, end: 15 * 60 },
  { id: 'until-17', label: 'עד 17:00', start: 16 * 60, end: 17 * 60 },
  { id: 'until-22', label: 'עד 22:00', start: 14 * 60, end: 22 * 60 },
  { id: 'overnight-until-04', label: 'עד 04:00', start: 22 * 60, end: 4 * 60 },
  { id: 'overnight-until-06', label: 'עד 06:00', start: 22 * 60, end: 6 * 60 },
  { id: 'morning-hours', label: '04:00–12:00', start: 4 * 60, end: 12 * 60 },
]

function shift(
  id: string,
  workerIds: string[],
  options: Partial<ShiftSchedule> = {},
): ShiftSchedule {
  return {
    id,
    date: '2026-11-18',
    shiftType: 'afternoon',
    activeLaneIds: ['lane-a'],
    presentWorkerIds: workerIds,
    assignments: [{ laneId: 'lane-a', workerIds }],
    staffingOverrides: { 'lane-a': 2 },
    createdAt: '2026-11-18T00:00:00.000Z',
    updatedAt: '2026-11-18T00:00:00.000Z',
    ...options,
  }
}

describe('laneLiveStatus', () => {
  const now = new Date(2026, 10, 18, 16, 0).getTime()

  it('counts the gate manager on the gate lane but not on regular lanes', () => {
    const gateLane: Lane = {
      id: 'gate',
      name: 'מנהל שער',
      staffingStandard: 1,
      requiredCertifications: [],
      intensity: 'medium',
    }
    const current = shift('current', ['gate-worker'], {
      activeLaneIds: ['lane-a', 'gate'],
      assignments: [
        { laneId: 'lane-a', workerIds: ['gate-worker'] },
        { laneId: 'gate', workerIds: ['gate-worker'] },
      ],
      staffingOverrides: { 'lane-a': 1, gate: 1 },
      gateManagerWorkerId: 'gate-worker',
    })

    expect(
      laneLiveStatus({
        shift: current,
        history: [current],
        lane: gateLane,
        models,
        presets,
        now,
      }),
    ).toMatchObject({
      activeWorkerIds: ['gate-worker'],
      missing: 0,
    })
    expect(
      laneLiveStatus({
        shift: current,
        history: [current],
        lane,
        models,
        presets,
        now,
      }).activeWorkerIds,
    ).toEqual([])
  })

  it('auto-closes a lane when a worker ends and active staffing falls below standard', () => {
    const current = shift('current', ['worker-1', 'worker-2'], {
      workerWindows: {
        'worker-1': 'until-15',
        'worker-2': 'until-22',
      },
    })

    expect(
      laneLiveStatus({
        shift: current,
        history: [current],
        lane,
        models,
        presets,
        now,
      }),
    ).toMatchObject({
      activeWorkerIds: ['worker-2'],
      endedWorkerIds: ['worker-1'],
      missing: 1,
      autoClosed: true,
    })
  })

  it('keeps the lane covered by an overlapping replacement shift', () => {
    const current = shift('current', ['worker-1', 'worker-2'], {
      workerWindows: {
        'worker-1': 'until-15',
        'worker-2': 'until-22',
      },
    })
    const replacement = shift(
      'replacement',
      ['worker-3'],
      {
        shiftType: 'afternoonB',
        workerWindows: { 'worker-3': 'until-22' },
      },
    )
    replacement.workerWindows = {
      'worker-3': 'until-22',
    }

    expect(
      laneLiveStatus({
        shift: current,
        history: [current, replacement],
        lane,
        models,
        presets,
        now,
      }),
    ).toMatchObject({
      activeWorkerIds: ['worker-2', 'worker-3'],
      missing: 0,
      autoClosed: false,
    })
  })

  it('does not count a replacement shift before its hours start', () => {
    const current = shift('current', ['worker-1', 'worker-2'], {
      workerWindows: {
        'worker-1': 'until-15',
        'worker-2': 'until-22',
      },
    })
    const replacement = shift(
      'replacement',
      ['worker-3'],
      {
        shiftType: 'afternoonB',
        workerWindows: { 'worker-3': 'until-17' },
      },
    )
    replacement.workerWindows = { 'worker-3': 'until-17' }
    const beforeReplacement = new Date(2026, 10, 18, 15, 30).getTime()

    expect(
      laneLiveStatus({
        shift: current,
        history: [current, replacement],
        lane,
        models,
        presets,
        now: beforeReplacement,
      }).autoClosed,
    ).toBe(true)
  })

  it('counts an overlapping replacement on the next calendar date', () => {
    const overnight = shift('overnight', ['worker-1', 'worker-2'], {
      shiftType: 'night',
      workerWindows: {
        'worker-1': 'overnight-until-04',
        'worker-2': 'overnight-until-06',
      },
    })
    const morning = shift(
      'morning',
      ['worker-3'],
      {
        date: '2026-11-19',
        shiftType: 'morning',
        workerWindows: { 'worker-3': 'morning-hours' },
      },
    )

    expect(
      laneLiveStatus({
        shift: overnight,
        history: [overnight, morning],
        lane,
        models,
        presets,
        now: new Date(2026, 10, 19, 4, 30).getTime(),
      }),
    ).toMatchObject({
      activeWorkerIds: ['worker-2', 'worker-3'],
      endedWorkerIds: ['worker-1'],
      missing: 0,
      autoClosed: false,
    })
  })

  it('honors manual reopen until another assigned worker ends', () => {
    const current = shift('current', ['worker-1', 'worker-2', 'worker-3'], {
      workerWindows: {
        'worker-1': 'until-15',
        'worker-2': 'until-22',
        'worker-3': 'until-17',
      },
      laneReopenedAt: {
        'lane-a': new Date(2026, 10, 18, 15, 30).toISOString(),
      },
    })

    expect(
      laneLiveStatus({
        shift: current,
        history: [current],
        lane,
        models,
        presets,
        now,
      }).autoClosed,
    ).toBe(false)

    expect(
      laneLiveStatus({
        shift: current,
        history: [current],
        lane,
        models,
        presets,
        now: new Date(2026, 10, 18, 17, 1).getTime(),
      }).autoClosed,
    ).toBe(true)
  })
})
