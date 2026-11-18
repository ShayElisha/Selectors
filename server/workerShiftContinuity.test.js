import { describe, expect, it } from 'vitest'
import {
  hasOpenWorkerContinuation,
  syncContinuedWorkerHours,
} from './workerShiftContinuity.js'

const shiftModels = [
  { id: 'morning', startMinutes: 360, endMinutes: 870, order: 0 },
  { id: 'afternoon', startMinutes: 870, endMinutes: 1290, order: 1 },
  { id: 'night', startMinutes: 1290, endMinutes: 360, order: 2 },
]
const presets = [
  { id: 'morning', start: 360, end: 870 },
  { id: 'long', start: 360, end: 1110 },
]

function shift(id, shiftType, extra = {}) {
  return {
    id,
    date: '2026-11-18',
    shiftType,
    audience: 'inspector',
    presentWorkerIds: ['worker-1'],
    workerWindows: {},
    windowAdjustments: {},
    assignments: [{ laneId: 'lane-1', workerIds: ['worker-1'] }],
    createdAt: '2026-11-18T06:00:00.000Z',
    updatedAt: '2026-11-18T06:00:00.000Z',
    ...extra,
  }
}

describe('hasOpenWorkerContinuation', () => {
  it('holds payroll until an overlapping later shift is closed', () => {
    const morning = shift('morning-shift', 'morning', {
      workerWindows: { 'worker-1': 'long' },
    })
    const afternoon = shift('afternoon-shift', 'afternoon')
    const history = [morning, afternoon]

    expect(
      hasOpenWorkerContinuation(
        morning,
        'worker-1',
        history,
        presets,
        shiftModels,
      ),
    ).toBe(true)

    afternoon.signOff = { signedAt: '2026-11-18T21:30:00.000Z' }
    expect(
      hasOpenWorkerContinuation(
        morning,
        'worker-1',
        history,
        presets,
        shiftModels,
      ),
    ).toBe(false)
  })

  it('does not delay for workers absent from later shifts', () => {
    const morning = shift('morning-shift', 'morning', {
      workerWindows: { 'worker-1': 'long' },
    })
    const afternoon = shift('afternoon-shift', 'afternoon', {
      presentWorkerIds: [],
    })

    expect(
      hasOpenWorkerContinuation(
        morning,
        'worker-1',
        [morning, afternoon],
        presets,
        shiftModels,
      ),
    ).toBe(false)
  })

  it('waits through a directly adjacent full shift when the same inspector continues', () => {
    const morning = shift('morning-shift', 'morning')
    const afternoon = shift('afternoon-shift', 'afternoon')

    expect(
      hasOpenWorkerContinuation(
        morning,
        'worker-1',
        [morning, afternoon],
        presets,
        shiftModels,
      ),
    ).toBe(true)
  })
})

describe('syncContinuedWorkerHours', () => {
  it('updates the existing next shift and removes the worker when hours no longer overlap', () => {
    const previous = shift('morning-shift', 'morning', {
      workerWindows: { 'worker-1': 'long' },
    })
    const next = {
      ...previous,
      workerWindows: { 'worker-1': 'morning' },
    }
    const afternoon = shift('afternoon-shift', 'afternoon', {
      workerWindows: { 'worker-1': 'long' },
    })

    const result = syncContinuedWorkerHours({
      previous,
      next,
      history: [previous, afternoon],
      workerWindowPresets: presets,
      shiftModels,
      updatedAt: '2026-11-18T14:00:00.000Z',
    })

    expect(result.lockedShiftIds).toEqual([])
    expect(result.updates).toHaveLength(1)
    expect(result.updates[0]).toMatchObject({
      id: 'afternoon-shift',
      presentWorkerIds: [],
      workerWindows: {},
      assignments: [{ laneId: 'lane-1', workerIds: [] }],
    })
  })

  it('updates personal hours on an already-created continuing shift', () => {
    const previous = shift('morning-shift', 'morning', {
      workerWindows: { 'worker-1': 'long' },
    })
    const next = {
      ...previous,
      workerWindows: { 'worker-1': 'longer' },
    }
    const afternoon = shift('afternoon-shift', 'afternoon', {
      workerWindows: { 'worker-1': 'long' },
    })

    const result = syncContinuedWorkerHours({
      previous,
      next,
      history: [previous, afternoon],
      workerWindowPresets: [
        ...presets,
        { id: 'longer', start: 360, end: 1230 },
      ],
      shiftModels,
      updatedAt: '2026-11-18T14:00:00.000Z',
    })

    expect(result.updates).toMatchObject([
      { id: 'afternoon-shift', workerWindows: { 'worker-1': 'longer' } },
    ])
  })

  it('reports a closed continuation instead of silently leaving hours out of sync', () => {
    const previous = shift('morning-shift', 'morning', {
      workerWindows: { 'worker-1': 'long' },
    })
    const next = {
      ...previous,
      workerWindows: { 'worker-1': 'morning' },
    }
    const afternoon = shift('afternoon-shift', 'afternoon', {
      workerWindows: { 'worker-1': 'long' },
      signOff: { signedAt: '2026-11-18T21:30:00.000Z' },
    })

    const result = syncContinuedWorkerHours({
      previous,
      next,
      history: [previous, afternoon],
      workerWindowPresets: presets,
      shiftModels,
      updatedAt: '2026-11-18T14:00:00.000Z',
    })

    expect(result.lockedShiftIds).toEqual(['afternoon-shift'])
    expect(result.updates).toEqual([])
  })
})
