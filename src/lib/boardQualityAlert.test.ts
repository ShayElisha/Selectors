import { describe, expect, it } from 'vitest'
import {
  assessBoardQualityAlert,
  collectRecentQualityScores,
} from './boardQualityAlert'
import type { ShiftSchedule } from '../types'

function historyShift(score: number, id: string): ShiftSchedule {
  return {
    id,
    date: `2025-01-${id.padStart(2, '0')}`,
    shiftType: 'morning',
    activeLaneIds: [],
    presentWorkerIds: [],
    assignments: [],
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    assignmentQuality: { score, at: '2025-01-01T00:00:00.000Z' },
  }
}

describe('boardQualityAlert', () => {
  it('returns null with fewer than five history scores', () => {
    expect(assessBoardQualityAlert(50, [70, 72, 71, 73])).toBeNull()
  })

  it('warns when score is moderately below median', () => {
    const history = [80, 82, 81, 83, 79, 84]
    const alert = assessBoardQualityAlert(60, history)
    expect(alert?.level).toBe('warn')
  })

  it('flags bad when score is far below median', () => {
    const history = [80, 82, 81, 83, 79, 84]
    const alert = assessBoardQualityAlert(45, history)
    expect(alert?.level).toBe('bad')
  })

  it('collectRecentQualityScores reads assignmentQuality from history', () => {
    const history = [
      historyShift(70, '1'),
      historyShift(75, '2'),
      { ...historyShift(90, '3'), assignmentQuality: undefined },
    ]
    expect(collectRecentQualityScores(history)).toEqual([70, 75])
  })
})
