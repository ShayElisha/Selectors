import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearManagerNotices,
  ensureBoardQualityNotice,
  ensurePendingEquipmentNotices,
  ensurePendingFaultNotices,
  ensureShiftEndNotice,
  ensureShiftOverdueNotice,
  isActingGateManager,
  listManagerNotices,
  markAllManagerNoticesRead,
} from './managerNotifications'
import type { IncidentRecord } from '../types'

describe('managerNotifications', () => {
  beforeEach(() => {
    clearManagerNotices()
  })

  it('matches gate manager by user id or phone', () => {
    expect(
      isActingGateManager({
        userId: 'w1',
        gateManagerWorkerId: 'w1',
      }),
    ).toBe(true)
    expect(
      isActingGateManager({
        userId: 'other',
        userPhone: '050-1234567',
        gateManagerWorkerId: 'w2',
        workers: [{ id: 'w2', phone: '0501234567' }],
      }),
    ).toBe(true)
    expect(
      isActingGateManager({
        userId: 'other',
        gateManagerWorkerId: 'w2',
        workers: [{ id: 'w2', phone: '0501234567' }],
      }),
    ).toBe(false)
  })

  it('does not notify before the shift window ends', () => {
    const now = new Date()
    now.setHours(14, 40, 0, 0)
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const d = String(now.getDate()).padStart(2, '0')
    const notice = ensureShiftEndNotice({
      shiftId: `s-early-${Date.now()}`,
      date: `${y}-${m}-${d}`,
      shiftType: 'morning',
      signedOff: false,
      viewerIsGateManager: true,
      now,
    })
    expect(notice).toBeNull()
    expect(listManagerNotices()).toHaveLength(0)
  })

  it('creates a shift-end notice only for the gate manager after end', () => {
    const now = new Date()
    now.setHours(15, 0, 0, 0)
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const d = String(now.getDate()).padStart(2, '0')
    const date = `${y}-${m}-${d}`
    expect(
      ensureShiftEndNotice({
        shiftId: 's-other',
        date,
        shiftType: 'morning',
        signedOff: false,
        viewerIsGateManager: false,
        now,
      }),
    ).toBeNull()

    const notice = ensureShiftEndNotice({
      shiftId: `s-${Date.now()}`,
      date,
      shiftType: 'morning',
      signedOff: false,
      viewerIsGateManager: true,
      now,
    })
    expect(notice?.kind).toBe('shift_end')
    expect(notice?.title).toContain('הסתיימה')
    expect(listManagerNotices().length).toBeGreaterThan(0)
    markAllManagerNoticesRead()
    expect(listManagerNotices().every((n) => n.read)).toBe(true)
  })

  it('escalates to overdue after ~60 minutes past end for gate manager', () => {
    const now = new Date()
    now.setHours(16, 5, 0, 0)
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const d = String(now.getDate()).padStart(2, '0')
    const date = `${y}-${m}-${d}`
    expect(
      ensureShiftOverdueNotice({
        shiftId: 's-overdue',
        date,
        shiftType: 'morning',
        signedOff: false,
        viewerIsGateManager: false,
        now,
      }),
    ).toBeNull()
    const notice = ensureShiftOverdueNotice({
      shiftId: 's-overdue',
      date,
      shiftType: 'morning',
      signedOff: false,
      viewerIsGateManager: true,
      now,
    })
    expect(notice?.kind).toBe('shift_overdue')
  })

  it('creates fault and equipment notices for pending items', () => {
    const fault: IncidentRecord = {
      id: 'inc-1',
      kind: 'fault',
      title: 'דלת תקועה',
      description: '',
      severity: 'medium',
      status: 'pending_approval',
      reportedByName: 'דני',
      createdAt: '2026-11-16T10:00:00.000Z',
      createdBy: 'דני',
      updatedAt: '2026-11-16T10:00:00.000Z',
      updatedBy: 'דני',
    }
    const faults = ensurePendingFaultNotices([fault])
    expect(faults[0]?.kind).toBe('fault')
    expect(faults[0]?.view).toBe('incidents')

    const equipment = ensurePendingEquipmentNotices([
      {
        id: 'eq-1',
        workerName: 'נועה',
        equipmentLabel: 'וסט',
        status: 'pending',
        createdAt: '2026-11-16T10:05:00.000Z',
      },
      {
        id: 'eq-2',
        workerName: 'נועה',
        equipmentLabel: 'מכשיר',
        status: 'approved',
      },
    ])
    expect(equipment).toHaveLength(1)
    expect(equipment[0]?.kind).toBe('equipment')
  })

  it('stores a board quality notice', () => {
    const notice = ensureBoardQualityNotice({
      shiftId: 's-q',
      level: 'bad',
      message: 'ציון נמוך מהרגיל',
    })
    expect(notice?.kind).toBe('board_quality')
    expect(listManagerNotices().some((n) => n.kind === 'board_quality')).toBe(
      true,
    )
  })
})
