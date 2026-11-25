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

  it('only reports current-shift ended workers separately from yesterday shifts', () => {
    const current = shift('current', ['today-worker'], {
      date: '2026-11-19',
      shiftType: 'morning',
      workerWindows: { 'today-worker': 'until-15' },
    })
    const yesterday = shift('yesterday', ['yesterday-worker'], {
      date: '2026-11-18',
      shiftType: 'afternoon',
      workerWindows: { 'yesterday-worker': 'until-15' },
    })

    // 11:00 — morning (04:00–12:00) still open; worker ended early at 15:00 window
    // is not on morning. Use afternoon at 16:00 with early leaver instead.
    const afternoon = shift('afternoon-live', ['early', 'late'], {
      date: '2026-11-19',
      shiftType: 'afternoon',
      workerWindows: { early: 'until-15', late: 'until-22' },
    })

    expect(
      laneLiveStatus({
        shift: afternoon,
        history: [afternoon, yesterday],
        lane,
        models,
        presets,
        now: new Date(2026, 10, 19, 16, 0).getTime(),
      }),
    ).toMatchObject({
      currentShiftEndedWorkerIds: ['early'],
      activeWorkerIds: ['late'],
    })

    // After the official morning ends, do not flag finished workers as mid-shift ends.
    expect(
      laneLiveStatus({
        shift: current,
        history: [current, yesterday],
        lane,
        models,
        presets,
        now: new Date(2026, 10, 19, 16, 0).getTime(),
      }),
    ).toMatchObject({
      currentShiftEndedWorkerIds: [],
      autoClosed: false,
      activeWorkerIds: ['today-worker'],
    })
  })

  it('hides ended markers after the official shift ends', () => {
    const morning = shift('morning-done', ['full-shift'], {
      date: '2026-11-25',
      shiftType: 'morning',
      workerWindows: { 'full-shift': 'morning-hours' },
      staffingOverrides: { 'lane-a': 1 },
    })

    expect(
      laneLiveStatus({
        shift: morning,
        history: [morning],
        lane: { ...lane, staffingStandard: 1 },
        models,
        presets,
        now: new Date(2026, 10, 25, 17, 8).getTime(),
      }),
    ).toMatchObject({
      currentShiftEndedWorkerIds: [],
      autoClosed: false,
      activeWorkerIds: ['full-shift'],
      missing: 0,
    })
  })

  it('does not flag mid-shift ends when live tracking is disabled (history view)', () => {
    const afternoon = shift('history-view', ['early', 'late'], {
      date: '2026-11-25',
      shiftType: 'afternoon',
      workerWindows: { early: 'until-15', late: 'until-22' },
    })

    expect(
      laneLiveStatus({
        shift: afternoon,
        history: [afternoon],
        lane,
        models,
        presets,
        now: new Date(2026, 10, 25, 16, 0).getTime(),
        trackLiveEnds: false,
      }),
    ).toMatchObject({
      currentShiftEndedWorkerIds: [],
      autoClosed: false,
      activeWorkerIds: expect.arrayContaining(['early', 'late']),
    })
  })

  it('does not auto-close tomorrow from today\'s ended workers', () => {
    const tomorrow = shift('tomorrow', ['tomorrow-worker'], {
      date: '2026-11-19',
      shiftType: 'morning',
      workerWindows: { 'tomorrow-worker': 'morning-hours' },
      staffingOverrides: { 'lane-a': 1 },
    })
    const today = shift('today', ['today-worker'], {
      date: '2026-11-18',
      shiftType: 'afternoon',
      workerWindows: { 'today-worker': 'until-15' },
      staffingOverrides: { 'lane-a': 1 },
    })

    expect(
      laneLiveStatus({
        shift: tomorrow,
        history: [tomorrow, today],
        lane: { ...lane, staffingStandard: 1 },
        models,
        presets,
        // Evening before tomorrow's morning — today worker already ended,
        // tomorrow worker has not started yet.
        now: new Date(2026, 10, 18, 20, 0).getTime(),
      }),
    ).toMatchObject({
      activeWorkerIds: [],
      endedWorkerIds: ['today-worker'],
      currentShiftEndedWorkerIds: [],
      missing: 1,
      autoClosed: false,
    })
  })

  it('does not auto-close a manned future morning before it starts', () => {
    const tomorrow = shift('tomorrow', ['ella', 'leon'], {
      date: '2026-11-24',
      shiftType: 'morning',
      staffingOverrides: { 'lane-a': 1 },
    })
    const today = shift('today', ['ella', 'leon'], {
      date: '2026-11-23',
      shiftType: 'morning',
      staffingOverrides: { 'lane-a': 1 },
    })

    expect(
      laneLiveStatus({
        shift: tomorrow,
        history: [tomorrow, today],
        lane: { ...lane, staffingStandard: 1 },
        models: [
          {
            id: 'morning',
            name: 'בוקר',
            startMinutes: 6 * 60,
            endMinutes: 15 * 60,
            order: 0,
          },
          ...models,
        ],
        presets: [],
        now: new Date(2026, 10, 23, 21, 15).getTime(),
      }),
    ).toMatchObject({
      autoClosed: false,
      manuallyReopened: false,
      currentShiftEndedWorkerIds: [],
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
