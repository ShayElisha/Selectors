import { describe, expect, it } from 'vitest'
import type { Lane, Worker } from '../types'
import { roundCutsForWindows } from './shiftCatalog'
import {
  applyLaneActivityHours,
  assignSelectorRounds,
  buildRoundWindows,
  setSelectorCell,
} from './selectorRounds'

function lane(id: string, name: string, certs: string[] = []): Lane {
  return {
    id,
    name,
    staffingStandard: 1,
    requiredCertifications: certs,
    intensity: 'medium',
  }
}

function worker(id: string, fullName: string, certs: string[] = []): Worker {
  return {
    id,
    fullName,
    phone: '',
    certifications: certs,
    status: 'active',
    isInspector: true,
    isManager: false,
  }
}

describe('buildRoundWindows', () => {
  it('starts each shift on the window start and steps two hours', () => {
    expect(buildRoundWindows('morning').map((w) => w.label)).toEqual([
      '06:00–08:00',
      '08:00–10:00',
      '10:00–12:00',
      '12:00–14:00',
      '14:00–15:00',
    ])
    expect(buildRoundWindows('afternoonA').map((w) => w.label)).toEqual([
      '14:30–16:30',
      '16:30–18:30',
    ])
    expect(buildRoundWindows('night').map((w) => w.label)).toEqual([
      '21:00–23:00',
      '23:00–01:00',
      '01:00–03:00',
      '03:00–05:00',
      '05:00–06:30',
    ])
  })
})

describe('assignSelectorRounds', () => {
  const lanes = [lane('a', 'נתיב 1'), lane('b', 'נתיב 2')]
  const workers = [worker('w1', 'אביב'), worker('w2', 'בני')]

  it('rotates selectors onto a different route each round', () => {
    const { rounds } = assignSelectorRounds({
      shiftType: 'morning',
      lanes,
      activeLaneIds: ['a', 'b'],
      workers,
    })
    const row = (i: number) =>
      rounds[i]!.assignments.map((a) => a.workerIds[0])
    const first = row(0)
    const second = row(1)
    expect(new Set(first).size).toBe(2)
    expect(second).not.toEqual(first)
    expect(rounds[0]!.assignments[0]!.workerIds[0]).not.toBe(
      rounds[1]!.assignments[0]!.workerIds[0],
    )
  })

  it('keeps a selector off a lane they are not certified for', () => {
    const certified = [
      lane('a', 'נתיב 1', ['מכס']),
      lane('b', 'נתיב 2'),
    ]
    const people = [
      worker('w1', 'אביב', ['מכס']),
      worker('w2', 'בני'),
    ]
    const { rounds } = assignSelectorRounds({
      shiftType: 'morning',
      lanes: certified,
      activeLaneIds: ['a', 'b'],
      workers: people,
    })
    for (const round of rounds) {
      const customs = round.assignments.find((a) => a.laneId === 'a')
      expect(customs?.workerIds[0]).toBe('w1')
    }
  })
})

describe('setSelectorCell', () => {
  it('moves a selector within the same round instead of duplicating them', () => {
    const { rounds } = assignSelectorRounds({
      shiftType: 'afternoon',
      lanes: [lane('a', 'נתיב 1'), lane('b', 'נתיב 2')],
      activeLaneIds: ['a', 'b'],
      workers: [worker('w1', 'אביב'), worker('w2', 'בני')],
    })
    const onA = rounds[0]!.assignments[0]!.workerIds[0]!
    const next = setSelectorCell(rounds, 0, 'b', 0, onA)
    const ids = next[0]!.assignments.flatMap((a) => a.workerIds.filter(Boolean))
    expect(ids.filter((id) => id === onA)).toHaveLength(1)
    expect(next[0]!.assignments[1]!.workerIds[0]).toBe(onA)
  })
})

describe('early 04:45 arrival', () => {
  it('opens the morning board at 04:45 and keeps later staff out of that round', () => {
    const { rounds } = assignSelectorRounds({
      shiftType: 'morning',
      lanes: [lane('a', 'נתיב 1'), lane('b', 'נתיב 2')],
      activeLaneIds: ['a', 'b'],
      workers: [worker('early', 'מוקדם'), worker('day', 'בוקר')],
      workerWindows: { early: '0445-1500' },
      nightPartners: [worker('night', 'לילה')],
    })
    expect(rounds[0]!.label).toBe('04:45–06:00')
    const first = rounds[0]!.assignments.flatMap((row) =>
      row.workerIds.filter(Boolean),
    )
    expect(first).toContain('early')
    expect(first).not.toContain('day')
    expect(first).toContain('night')
    const afterSix = rounds.find((round) => round.label.startsWith('06:00'))!
    expect(afterSix.assignments[0]!.workerIds).not.toContain('night')
  })
})

describe('personal windows', () => {
  it('stops a 17:30 window before the end of afternoon A', () => {
    const cuts = roundCutsForWindows('afternoonA', ['0600-1730', '0600-1830'])
    const labels = buildRoundWindows('afternoonA', cuts).map((w) => w.label)
    expect(labels).toEqual(['14:30–16:30', '16:30–17:30', '17:30–18:30'])
    const { rounds } = assignSelectorRounds({
      shiftType: 'afternoonA',
      lanes: [lane('a', 'נתיב 1')],
      activeLaneIds: ['a'],
      workers: [worker('early', 'מוקדם'), worker('late', 'מאוחר')],
      workerWindows: { early: '0600-1730', late: '0600-1830' },
    })
    const last = rounds[rounds.length - 1]!
    expect(last.label).toBe('17:30–18:30')
    expect(last.assignments[0]!.workerIds).toEqual(['late'])
  })

  it('clears an open draft outside lane activity hours', () => {
    const applied = applyLaneActivityHours(
      [
        {
          startMinutes: 6 * 60,
          endMinutes: 8 * 60,
          label: '06:00–08:00',
          assignments: [{ laneId: 'a', workerIds: ['w1'] }],
        },
        {
          startMinutes: 8 * 60,
          endMinutes: 10 * 60,
          label: '08:00–10:00',
          assignments: [{ laneId: 'a', workerIds: ['w1'] }],
        },
      ],
      [
        {
          ...lane('a', 'נתיב'),
          activeHours: [
            { start: 6 * 60, end: 8 * 60 },
            { start: 10 * 60, end: 12 * 60 },
          ],
        },
      ],
      ['נותרו 1 מקומות ריקים בסבבים — אין מספיק סלקטורים מוסמכים לכל הנתיבים'],
    )
    expect(applied.changed).toBe(true)
    expect(applied.rounds[0]!.assignments[0]!.workerIds).toEqual(['w1'])
    expect(applied.rounds[1]!.assignments[0]!.workerIds).toEqual([])
    expect(applied.warnings.some((warning) => warning.startsWith('נותרו'))).toBe(
      false,
    )
  })
})
