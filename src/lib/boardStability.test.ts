import { describe, expect, it } from 'vitest'
import type { ShiftSchedule } from '../types'
import {
  boardStabilitySummary,
  stabilityFromEditCount,
  shiftBoardStability,
} from './boardStability'

function shift(editCount?: number, edited = false): ShiftSchedule {
  const stamp = '2026-03-01T08:00:00.000Z'
  return {
    id: 's1',
    date: '2026-03-01',
    shiftType: 'morning',
    activeLaneIds: [],
    presentWorkerIds: [],
    assignments: [],
    createdAt: stamp,
    updatedAt: edited ? '2026-03-01T09:00:00.000Z' : stamp,
    ...(editCount != null ? { editCount } : {}),
  }
}

describe('boardStability', () => {
  it('labels high stability when editCount is at most one', () => {
    expect(stabilityFromEditCount(0).label).toBe('יציבות גבוהה')
    expect(stabilityFromEditCount(1).label).toBe('יציבות גבוהה')
    expect(stabilityFromEditCount(4).label).toBe('עריכות רבות')
  })

  it('uses editCount or updatedAt heuristic on shifts', () => {
    expect(shiftBoardStability(shift(0)).changes).toBe(0)
    expect(shiftBoardStability(shift(undefined, true)).changes).toBe(1)
  })

  it('summarizes average edits in range', () => {
    const summary = boardStabilitySummary(
      [shift(0), shift(2), shift(1)],
      '2026-03-01',
      '2026-03-31',
    )
    expect(summary.shifts).toBe(3)
    expect(summary.avgEditCount).toBe(1)
    expect(summary.highStabilityShare).toBe(67)
  })
})
