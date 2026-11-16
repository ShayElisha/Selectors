import { describe, expect, it } from 'vitest'
import {
  buildShiftCloseSummary,
  type ShiftCloseDraft,
} from './shiftCloseSummary'
import type { Lane, Worker } from '../types'

const lanes: Lane[] = [
  {
    id: 'l1',
    name: 'נתיב 1',
    intensity: 'medium',
    requiredCertifications: [],
    staffingStandard: 2,
  },
  {
    id: 'gm',
    name: 'מנהל שער',
    intensity: 'easy',
    requiredCertifications: [],
    staffingStandard: 1,
  },
]

const workers: Worker[] = [
  {
    id: 'w1',
    fullName: 'דני כהן',
    phone: '0500000001',
    certifications: [],
    status: 'active',
    isInspector: false,
    isManager: true,
  },
  {
    id: 'w2',
    fullName: 'רוני לוי',
    phone: '0500000002',
    certifications: [],
    status: 'active',
    isInspector: true,
    isManager: false,
  },
]

function baseDraft(partial: Partial<ShiftCloseDraft> = {}): ShiftCloseDraft {
  return {
    assignmentMode: 'single',
    activeLaneIds: ['l1'],
    assignments: [{ laneId: 'l1', workerIds: ['w2'] }],
    unassignedWorkerIds: [],
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
