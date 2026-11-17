import { describe, expect, it } from 'vitest'
import { timingBadgesForWorker } from './shiftTimingBadges'

describe('timingBadgesForWorker', () => {
  it('marks late and early leave', () => {
    const badges = timingBadgesForWorker({
      workerId: 'w1',
      windowAdjustments: { w1: { lateMinutes: 15, earlyMinutes: 30 } },
      earlyLeaveAt: { w1: 14 * 60 },
    })
    expect(badges.map((b) => b.kind)).toEqual(['late', 'early', 'left'])
    expect(badges[0]?.shortLabel).toContain('15')
  })

  it('includes personal shift window hours', () => {
    const badges = timingBadgesForWorker({
      workerId: 'w1',
      workerWindows: { w1: '0600-1500' },
    })
    expect(badges.map((b) => b.kind)).toEqual(['hours'])
    expect(badges[0]?.shortLabel).toBe('06:00–15:00')
  })
})
