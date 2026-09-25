import { describe, expect, it } from 'vitest'
import type { ShiftSchedule, Worker } from '../types'
import {
  assignedWorkerIds,
  filterDayCards,
  groupHistoryDays,
  historyDayLabel,
  monthKey,
  presentAssignedHealth,
  shiftCountsLabel,
  shiftMatchesSearch,
} from './historyList'

function worker(id: string, fullName: string): Worker {
  return {
    id,
    fullName,
    phone: '',
    certifications: [],
    status: 'active',
    isInspector: true,
    isManager: false,
  }
}

function shift(
  id: string,
  date: string,
  shiftType: ShiftSchedule['shiftType'],
  opts: {
    present?: string[]
    assignments?: { laneId: string; workerIds: string[] }[]
    activeLaneIds?: string[]
  } = {},
): ShiftSchedule {
  const assignments = opts.assignments ?? []
  return {
    id,
    date,
    shiftType,
    activeLaneIds: opts.activeLaneIds ?? assignments.map((a) => a.laneId),
    presentWorkerIds: opts.present ?? [],
    assignments,
    createdAt: '',
    updatedAt: id,
  }
}

describe('groupHistoryDays', () => {
  it('fills missing slots as null and sorts newest first', () => {
    const history = [
      shift('a', '2026-09-20', 'morning', {
        assignments: [{ laneId: 'l1', workerIds: ['w1'] }],
      }),
      shift('b', '2026-09-20', 'night', {
        assignments: [{ laneId: 'l1', workerIds: ['w2'] }],
      }),
      shift('c', '2026-09-19', 'afternoon', {
        assignments: [{ laneId: 'l1', workerIds: ['w1'] }],
      }),
    ]
    const days = groupHistoryDays(history)
    expect(days.map((d) => d.date)).toEqual(['2026-09-20', '2026-09-19'])
    expect(days[0]!.slots.map((s) => s.shiftType)).toEqual([
      'morning',
      'afternoonA',
      'afternoon',
      'afternoonB',
      'night',
    ])
    expect(days[0]!.slots[0]!.shift?.id).toBe('a')
    expect(days[0]!.slots[1]!.shift).toBeNull()
    expect(days[0]!.slots[4]!.shift?.id).toBe('b')
  })
})

describe('presentAssignedHealth', () => {
  it('ok when all present are assigned', () => {
    const s = shift('x', '2026-09-20', 'morning', {
      present: ['w1', 'w2'],
      assignments: [
        { laneId: 'l1', workerIds: ['w1'] },
        { laneId: 'l2', workerIds: ['w2'] },
      ],
    })
    expect(presentAssignedHealth(s)).toEqual({ kind: 'ok' })
  })

  it('reports unassigned present workers', () => {
    const s = shift('x', '2026-09-20', 'morning', {
      present: ['w1', 'w2', 'w3'],
      assignments: [{ laneId: 'l1', workerIds: ['w1'] }],
    })
    const h = presentAssignedHealth(s)
    expect(h.kind).toBe('unassigned')
    if (h.kind === 'unassigned') {
      expect(h.count).toBe(2)
      expect(h.workerIds).toEqual(['w2', 'w3'])
    }
  })
})

describe('historyDayLabel / monthKey', () => {
  it('labels today and yesterday', () => {
    const now = new Date(2026, 8, 20)
    expect(historyDayLabel('2026-09-20', now).relative).toBe('היום')
    expect(historyDayLabel('2026-09-19', now).relative).toBe('אתמול')
    expect(historyDayLabel('2026-09-18', now).relative).toBeNull()
    expect(historyDayLabel('2026-09-20', now).dateText).toBe('20.9')
    expect(monthKey('2026-09-20')).toBe('2026-09')
  })
})

describe('search / filter / counts', () => {
  const workers = new Map([
    ['w1', worker('w1', 'שי אלישע')],
    ['w2', worker('w2', 'לאון קולסניק')],
  ])

  it('matches inspector names', () => {
    const s = shift('x', '2026-09-20', 'morning', {
      present: ['w1'],
      assignments: [{ laneId: 'l1', workerIds: ['w1'] }],
    })
    expect(shiftMatchesSearch(s, 'שי', workers)).toBe(true)
    expect(shiftMatchesSearch(s, 'לאון', workers)).toBe(false)
  })

  it('filters day cards by shift type', () => {
    const days = groupHistoryDays([
      shift('a', '2026-09-20', 'morning', {
        assignments: [{ laneId: 'l1', workerIds: ['w1'] }],
      }),
      shift('b', '2026-09-20', 'night', {
        assignments: [{ laneId: 'l1', workerIds: ['w2'] }],
      }),
      shift('c', '2026-09-19', 'morning', {
        assignments: [{ laneId: 'l1', workerIds: ['w1'] }],
      }),
    ])
    const filtered = filterDayCards(days, {
      search: '',
      shiftTypes: new Set(['night']),
      workersById: workers,
    })
    expect(filtered.map((d) => d.date)).toEqual(['2026-09-20'])
    expect(filtered[0]!.slots.some((s) => s.shiftType === 'night' && s.shift)).toBe(
      true,
    )
  })

  it('pluralizes counts without 1 נתיבים', () => {
    const s = shift('x', '2026-09-20', 'morning', {
      present: ['w1'],
      activeLaneIds: ['l1'],
      assignments: [{ laneId: 'l1', workerIds: ['w1'] }],
    })
    expect(shiftCountsLabel(s)).toContain('נתיב אחד')
    expect(shiftCountsLabel(s)).not.toContain('1 נתיבים')
  })
})

describe('assignedWorkerIds', () => {
  it('dedupes', () => {
    const s = shift('x', '2026-09-20', 'morning', {
      assignments: [
        { laneId: 'l1', workerIds: ['w1', 'w1'] },
        { laneId: 'l2', workerIds: ['w1', 'w2'] },
      ],
    })
    expect(assignedWorkerIds(s).sort()).toEqual(['w1', 'w2'])
  })
})
