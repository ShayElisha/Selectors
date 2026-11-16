import { describe, expect, it } from 'vitest'
import { buildShiftCloseSummary } from './shiftCloseSummary'
import type { Lane, ShiftDraft, Worker } from '../types'

const lanes: Lane[] = [
  {
    id: 'l1',
    name: 'נתיב 1',
    intensity: 'medium',
    requiredCerts: [],
    staffingStandard: 2,
  },
  {
    id: 'gm',
    name: 'מנהל שער',
    intensity: 'low',
    requiredCerts: [],
    staffingStandard: 1,
  },
]

const workers: Worker[] = [
  {
    id: 'w1',
    fullName: 'דני כהן',
    phone: '0500000001',
    kind: 'manager',
    certs: [],
    active: true,
  },
  {
    id: 'w2',
    fullName: 'רוני לוי',
    phone: '0500000002',
    kind: 'worker',
    certs: [],
    active: true,
  },
]

function baseDraft(partial: Partial<ShiftDraft> = {}): ShiftDraft {
  return {
    id: 's1',
    date: '2026-03-16',
    shiftType: 'morning',
    activeLaneIds: ['l1'],
    presentWorkerIds: ['w1', 'w2'],
    assignments: [{ laneId: 'l1', workerIds: ['w2'] }],
    unassignedWorkerIds: [],
    warnings: [],
    ...partial,
  }
}

describe('buildShiftCloseSummary', () => {
  it('reports missing slots and manager', () => {
    const summary = buildShiftCloseSummary(baseDraft(), lanes, workers)
    expect(summary.managerMissing).toBe(true)
    expect(summary.filledSlots).toBe(1)
    expect(summary.requiredSlots).toBe(1)
    expect(summary.missingSlots).toBe(0)
  })

  it('counts understaffing with overrides', () => {
    const summary = buildShiftCloseSummary(
      baseDraft({
        gateManagerWorkerId: 'w1',
        staffingOverrides: { l1: 2 },
        assignments: [{ laneId: 'l1', workerIds: ['w2'] }],
      }),
      lanes,
      workers,
    )
    expect(summary.managerName).toBe('דני כהן')
    expect(summary.managerMissing).toBe(false)
    expect(summary.filledSlots).toBe(1)
    expect(summary.requiredSlots).toBe(2)
    expect(summary.missingSlots).toBe(1)
    expect(summary.understaffedLanes[0]?.name).toBe('נתיב 1')
  })
})
