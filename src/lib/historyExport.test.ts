import { describe, expect, it } from 'vitest'
import { buildHistoryCsv } from './historyExport'
import type { Lane, ShiftSchedule, Worker } from '../types'

function worker(id: string, name: string): Worker {
  return {
    id,
    fullName: name,
    phone: '050',
    certifications: [],
    status: 'active',
    isInspector: true,
    isManager: false,
  }
}

function lane(id: string, name: string): Lane {
  return {
    id,
    name,
    staffingStandard: 2,
    requiredCertifications: [],
    intensity: 'medium',
  }
}

describe('buildHistoryCsv', () => {
  it('builds CSV with BOM, Hebrew headers, and lane rows', () => {
    const workers = [worker('w1', 'דני'), worker('w2', 'שי')]
    const lanes = [lane('l1', 'מכס')]
    const shifts: ShiftSchedule[] = [
      {
        id: 's1',
        date: '2026-09-20',
        shiftType: 'morning',
        presentWorkerIds: ['w1', 'w2'],
        activeLaneIds: ['l1'],
        assignments: [{ laneId: 'l1', workerIds: ['w1'], notes: 'דגש' }],
        staffingOverrides: { l1: 1 },
        gateManagerWorkerId: 'w2',
        createdAt: '2026-09-20T06:00:00.000Z',
        updatedAt: '2026-09-20T06:00:00.000Z',
      },
    ]

    const csv = buildHistoryCsv(shifts, {
      workers,
      lanes,
      fromDate: '2026-09-01',
      toDate: '2026-09-30',
    })

    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('היסטוריית שיבוצים')
    expect(csv).toContain('תאריך')
    expect(csv).toContain('מכס')
    expect(csv).toContain('דני')
    expect(csv).toContain('שי')
    expect(csv).toContain('בוקר')
    expect(csv).toContain('דגש')
    expect(csv).toContain('טווח: 2026-09-01 עד 2026-09-30')
  })

  it('sorts lane rows alphabetically within each shift', () => {
    const shifts: ShiftSchedule[] = [
      {
        id: 's1',
        date: '2026-09-20',
        shiftType: 'morning',
        presentWorkerIds: ['w1'],
        activeLaneIds: ['l2', 'l1'],
        assignments: [
          { laneId: 'l2', workerIds: ['w1'] },
          { laneId: 'l1', workerIds: ['w1'] },
        ],
        createdAt: '2026-09-20T06:00:00.000Z',
        updatedAt: '2026-09-20T06:00:00.000Z',
      },
    ]
    const csv = buildHistoryCsv(shifts, {
      workers: [worker('w1', 'דני')],
      lanes: [lane('l2', 'נתיב ב'), lane('l1', 'נתיב א')],
    })

    expect(csv.indexOf('2026-09-20,בוקר,נתיב א')).toBeLessThan(
      csv.indexOf('2026-09-20,בוקר,נתיב ב'),
    )
  })
})
