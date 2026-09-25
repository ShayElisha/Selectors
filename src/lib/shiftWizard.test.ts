import { describe, expect, it } from 'vitest'
import type { Lane, ShiftSchedule, Worker } from '../types'
import {
  FEASIBILITY_OK_MARGIN,
  attendanceStepSummary,
  canAdvanceFromAttendance,
  canAdvanceFromLanes,
  computeFeasibilityPreview,
  deficitMessage,
  feasibilityStatus,
  formatSetupDateLine,
  laneSelectionFromShift,
  lanesStepSummary,
  mostRecentShiftOfType,
  presentIdsFromShift,
  relativeDayLabel,
  workerMatchesNameQuery,
} from './shiftWizard'

function lane(
  partial: Partial<Lane> & Pick<Lane, 'id' | 'name'>,
): Lane {
  return {
    staffingStandard: 1,
    requiredCertifications: [],
    intensity: 'medium',
    ...partial,
  }
}

function worker(
  partial: Partial<Worker> & Pick<Worker, 'id' | 'fullName'>,
): Worker {
  return {
    phone: '0501111111',
    certifications: [],
    status: 'active',
    isInspector: true,
    isManager: false,
    ...partial,
  }
}

function shift(
  partial: Partial<ShiftSchedule> &
    Pick<ShiftSchedule, 'id' | 'date' | 'shiftType'>,
): ShiftSchedule {
  return {
    activeLaneIds: [],
    presentWorkerIds: [],
    assignments: [],
    createdAt: '',
    updatedAt: partial.updatedAt ?? '',
    ...partial,
  }
}

describe('feasibility', () => {
  it('classifies ok / tight / insufficient', () => {
    expect(feasibilityStatus(3, 2)).toBe('ok')
    expect(feasibilityStatus(2, 2)).toBe('tight')
    expect(feasibilityStatus(1, 2)).toBe('insufficient')
    expect(FEASIBILITY_OK_MARGIN).toBe(1)
  })

  it('computes preview and deficit', () => {
    const lanes = [
      lane({
        id: 'l1',
        name: '9-10',
        requiredCertifications: ['מכס'],
        staffingStandard: 2,
      }),
      lane({ id: 'l2', name: 'פתוח', staffingStandard: 1 }),
    ]
    const workers = [
      worker({ id: 'w1', fullName: 'א', certifications: ['מכס'] }),
      worker({ id: 'w2', fullName: 'ב', certifications: [] }),
    ]
    const preview = computeFeasibilityPreview(
      lanes,
      ['l1', 'l2'],
      ['w1', 'w2'],
      workers,
      { l1: 2 },
    )
    expect(preview.totalStandard).toBe(3)
    expect(preview.present).toBe(2)
    expect(preview.surplus).toBe(-1)
    expect(preview.lanes.find((r) => r.laneId === 'l1')?.status).toBe(
      'insufficient',
    )
    expect(
      preview.lanes.find((r) => r.laneId === 'l1')?.messages[0],
    ).toContain('מוסמכים')
    expect(deficitMessage(preview)).toContain('חסרים')
  })

  it('defaults shift תקן to 1 when no override', () => {
    const lanes = [
      lane({ id: 'l1', name: 'א', staffingStandard: 2 }),
      lane({ id: 'l2', name: 'ב', staffingStandard: 1 }),
    ]
    const preview = computeFeasibilityPreview(
      lanes,
      ['l1', 'l2'],
      ['w1'],
      [worker({ id: 'w1', fullName: 'א' })],
    )
    expect(preview.totalStandard).toBe(2)
    expect(preview.lanes.every((r) => r.standard === 1)).toBe(true)
  })

  it('mentions missing cert when nobody holds it', () => {
    const lanes = [
      lane({
        id: 'l1',
        name: '9-10',
        requiredCertifications: ['מכס'],
        staffingStandard: 1,
      }),
    ]
    const workers = [worker({ id: 'w1', fullName: 'א', certifications: [] })]
    const preview = computeFeasibilityPreview(
      lanes,
      ['l1'],
      ['w1'],
      workers,
    )
    expect(preview.lanes[0]?.messages[0]).toContain('מכס')
  })

  it('respects staffing overrides', () => {
    const lanes = [lane({ id: 'l1', name: 'א', staffingStandard: 2 })]
    const workers = [
      worker({ id: 'w1', fullName: 'א' }),
      worker({ id: 'w2', fullName: 'ב' }),
    ]
    const preview = computeFeasibilityPreview(
      lanes,
      ['l1'],
      ['w1', 'w2'],
      workers,
      { l1: 2 },
    )
    expect(preview.lanes[0]?.standard).toBe(2)
    expect(preview.lanes[0]?.status).toBe('tight')
  })
})

describe('gating and summaries', () => {
  it('blocks empty selections', () => {
    expect(canAdvanceFromLanes(0).ok).toBe(false)
    expect(canAdvanceFromAttendance(0).ok).toBe(false)
    expect(canAdvanceFromLanes(2).ok).toBe(true)
    expect(lanesStepSummary(2, 5)).toContain('תקן 5')
    expect(attendanceStepSummary(3, 10)).toBe('3 מתוך 10 נוכחים')
  })
})

describe('last shift helpers', () => {
  it('picks most recent of type and extracts ids/standards', () => {
    const history = [
      shift({
        id: 'a',
        date: '2026-01-01',
        shiftType: 'morning',
        activeLaneIds: ['l1'],
        presentWorkerIds: ['w1'],
        updatedAt: '1',
      }),
      shift({
        id: 'b',
        date: '2026-01-02',
        shiftType: 'morning',
        activeLaneIds: ['l2', 'l3'],
        presentWorkerIds: ['w2'],
        staffingOverrides: { l2: 2 },
        updatedAt: '2',
      }),
      shift({
        id: 'c',
        date: '2026-01-03',
        shiftType: 'night',
        activeLaneIds: ['l9'],
        presentWorkerIds: ['w9'],
        updatedAt: '3',
      }),
    ]
    const last = mostRecentShiftOfType(history, 'morning')
    expect(last?.id).toBe('b')
    expect(laneSelectionFromShift(last!).laneIds).toEqual(['l2', 'l3'])
    expect(laneSelectionFromShift(last!).hadSavedStandards).toBe(true)
    expect(presentIdsFromShift(last!)).toEqual(['w2'])
  })
})

describe('date and search', () => {
  it('relative labels and name search', () => {
    const now = new Date(2026, 8, 20)
    expect(relativeDayLabel('2026-09-20', now)).toBe('היום')
    expect(relativeDayLabel('2026-09-21', now)).toBe('מחר')
    expect(formatSetupDateLine('2026-09-20', now)).toContain('היום')
    expect(workerMatchesNameQuery({ fullName: 'אביב חי' }, 'אביב')).toBe(true)
    expect(workerMatchesNameQuery({ fullName: 'אביב חי' }, 'דני')).toBe(false)
  })
})
