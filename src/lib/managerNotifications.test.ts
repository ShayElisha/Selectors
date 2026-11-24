import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearManagerNotices,
  ensureBoardQualityNotice,
  ensureCriticalFaultNotices,
  ensureCrossModuleConflictFromMessage,
  ensureCrossModuleConflictNotices,
  ensureHardLaneStreakNotices,
  ensureMissingWindowsNotice,
  ensureNewManagerNotice,
  ensurePendingEquipmentNotices,
  ensurePendingFaultNotices,
  ensureQualityDropAfterManualNotice,
  ensureSaveConflictNotice,
  ensureShiftEndNotice,
  ensureShiftOverdueNotice,
  ensureWorkerNoticeSendFailedNotice,
  clearSaveConflictNotices,
  findHardLaneStreaks,
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

  it('stores cross-module conflict notices', () => {
    const rows = ensureCrossModuleConflictNotices(
      [
        {
          workerId: 'w1',
          workerName: 'דני',
          otherModule: 'סלקטורים',
          date: '2026-11-16',
          shiftType: 'morning',
        },
      ],
      { shiftId: 's1' },
    )
    expect(rows[0]?.kind).toBe('cross_module')
    expect(
      ensureCrossModuleConflictFromMessage(
        'דני כבר משובץ/נוכח במודול סלקטורים באותו תאריך ומשמרת. לא ניתן לשבץ פעמיים בין מודולים.',
        { shiftId: 's1' },
      )?.kind,
    ).toBe('cross_module')
  })

  it('stores missing-windows and quality-drop notices; clears save-conflict', () => {
    ensureSaveConflictNotice({ message: 'קונפליקט גרסה', shiftId: 's1' })
    expect(listManagerNotices().some((n) => n.kind === 'save_conflict')).toBe(
      true,
    )
    clearSaveConflictNotices()
    expect(listManagerNotices().some((n) => n.kind === 'save_conflict')).toBe(
      false,
    )
    expect(
      ensureMissingWindowsNotice({
        shiftId: 's1',
        date: '2026-11-16',
        shiftType: 'morning',
        missingNames: ['דני', 'נועה'],
      })?.kind,
    ).toBe('missing_windows')
    expect(
      ensureQualityDropAfterManualNotice({
        shiftId: 's1',
        previousScore: 90,
        currentScore: null,
      })?.kind,
    ).toBe('quality_drop')
    expect(
      ensureQualityDropAfterManualNotice({
        shiftId: 's2',
        previousScore: 90,
        currentScore: 88,
      }),
    ).toBeNull()
  })

  it('detects hard-lane streaks of three and creates notices', () => {
    const lanes = [
      { id: 'hard', name: 'קשה', intensity: 'hard' as const },
      { id: 'easy', name: 'קל', intensity: 'easy' as const },
    ]
    const history = [
      {
        id: 'a',
        date: '2026-11-14',
        shiftType: 'morning' as const,
        assignments: [{ laneId: 'hard', workerIds: ['w1'] }],
      },
      {
        id: 'b',
        date: '2026-11-15',
        shiftType: 'morning' as const,
        assignments: [{ laneId: 'hard', workerIds: ['w1'] }],
      },
      {
        id: 'c',
        date: '2026-11-16',
        shiftType: 'morning' as const,
        assignments: [{ laneId: 'hard', workerIds: ['w1'] }],
      },
    ]
    const streaks = findHardLaneStreaks({ history, lanes, minStreak: 3 })
    expect(streaks).toEqual([
      { workerId: 'w1', count: 3, lastLaneNames: ['קשה'] },
    ])
    const notices = ensureHardLaneStreakNotices(
      streaks.map((row) => ({ ...row, workerName: 'דני' })),
      { shiftId: 'c' },
    )
    expect(notices[0]?.kind).toBe('hard_lane_streak')
  })

  it('stores critical-fault, new-manager, and notice-send-failed', () => {
    const critical: IncidentRecord = {
      id: 'inc-crit',
      kind: 'fault',
      title: 'שריפה',
      description: '',
      severity: 'critical',
      status: 'open',
      reportedByName: 'דני',
      createdAt: '2026-11-16T10:00:00.000Z',
      createdBy: 'דני',
      updatedAt: '2026-11-16T10:00:00.000Z',
      updatedBy: 'דני',
    }
    expect(ensureCriticalFaultNotices([critical])[0]?.kind).toBe(
      'critical_fault',
    )
    expect(
      ensureNewManagerNotice({ workerId: 'w9', workerName: 'מיכל' })?.kind,
    ).toBe('new_manager')
    expect(
      ensureWorkerNoticeSendFailedNotice({
        message: 'timeout',
        title: 'עדכון',
      })?.kind,
    ).toBe('notice_send_failed')
  })
})
