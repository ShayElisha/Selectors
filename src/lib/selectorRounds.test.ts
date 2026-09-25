import { describe, expect, it } from 'vitest'
import type { Lane, Worker } from '../types'
import {
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
      '12:00–14:30',
    ])
    expect(buildRoundWindows('afternoon').map((w) => w.label)).toEqual([
      '14:30–16:30',
      '16:30–18:30',
      '18:30–20:30',
      '20:30–21:30',
    ])
    expect(buildRoundWindows('night').map((w) => w.label)).toEqual([
      '21:30–23:30',
      '23:30–01:30',
      '01:30–03:30',
      '03:30–06:00',
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
