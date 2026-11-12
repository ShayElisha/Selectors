import { describe, expect, it } from 'vitest'
import {
  createFrozenLanes,
  filterFrozenLanesByActiveHours,
  frozenLaneIds,
  frozenLanesSummary,
  isLaneFrozen,
  recordUnfreezeDecision,
  shouldPromptUnfreeze,
} from './frozenLanes'
import type { FrozenLane, Lane } from '../types'

describe('frozenLanes', () => {
  const mockLanes: Lane[] = [
    {
      id: 'lane-a',
      name: 'נתיב א\'',
      staffingStandard: 2,
      requiredCertifications: [],
      intensity: 'easy',
    },
    {
      id: 'lane-b',
      name: 'נתיב ב\'',
      staffingStandard: 2,
      requiredCertifications: [],
      intensity: 'medium',
    },
  ]

  describe('createFrozenLanes', () => {
    it('creates frozen lane records with metadata', () => {
      const laneIds = ['lane-a', 'lane-b']
      const reason = 'חוסר בכוח אדם'
      const atMinutes = 225 // 09:45

      const result = createFrozenLanes(laneIds, reason, atMinutes)

      expect(result).toHaveLength(2)
      expect(result[0]).toMatchObject({
        laneId: 'lane-a',
        reason: 'חוסר בכוח אדם',
        frozenAtMinutes: 225,
        decisionHistory: [],
      })
      expect(result[0]?.frozenAt).toBeTruthy()
    })
  })

  describe('frozenLaneIds', () => {
    it('extracts lane IDs from frozen lane records', () => {
      const frozenLanes: FrozenLane[] = [
        {
          laneId: 'lane-a',
          frozenAtMinutes: 225,
          frozenAt: '2024-01-01T09:45:00Z',
          reason: 'test',
          decisionHistory: [],
        },
        {
          laneId: 'lane-b',
          frozenAtMinutes: 225,
          frozenAt: '2024-01-01T09:45:00Z',
          reason: 'test',
          decisionHistory: [],
        },
      ]

      const result = frozenLaneIds(frozenLanes)

      expect(result).toEqual(['lane-a', 'lane-b'])
    })
  })

  describe('isLaneFrozen', () => {
    it('returns true if lane is frozen', () => {
      const frozenLanes: FrozenLane[] = [
        {
          laneId: 'lane-a',
          frozenAtMinutes: 225,
          frozenAt: '2024-01-01T09:45:00Z',
          reason: 'test',
          decisionHistory: [],
        },
      ]

      expect(isLaneFrozen('lane-a', frozenLanes)).toBe(true)
      expect(isLaneFrozen('lane-b', frozenLanes)).toBe(false)
    })
  })

  describe('frozenLanesSummary', () => {
    it('returns empty string for no frozen lanes', () => {
      expect(frozenLanesSummary([], mockLanes)).toBe('')
    })

    it('returns singular summary for one frozen lane', () => {
      const frozenLanes: FrozenLane[] = [
        {
          laneId: 'lane-a',
          frozenAtMinutes: 225,
          frozenAt: '2024-01-01T09:45:00Z',
          reason: 'test',
          decisionHistory: [],
        },
      ]

      const result = frozenLanesSummary(frozenLanes, mockLanes)

      expect(result).toContain('נתיב א\'')
      expect(result).toContain('קפוא')
    })

    it('returns plural summary for multiple frozen lanes', () => {
      const frozenLanes: FrozenLane[] = [
        {
          laneId: 'lane-a',
          frozenAtMinutes: 225,
          frozenAt: '2024-01-01T09:45:00Z',
          reason: 'test',
          decisionHistory: [],
        },
        {
          laneId: 'lane-b',
          frozenAtMinutes: 225,
          frozenAt: '2024-01-01T09:45:00Z',
          reason: 'test',
          decisionHistory: [],
        },
      ]

      const result = frozenLanesSummary(frozenLanes, mockLanes)

      expect(result).toContain('2 נתיבים קפואים')
      expect(result).toContain('נתיב א\'')
      expect(result).toContain('נתיב ב\'')
    })
  })

  describe('recordUnfreezeDecision', () => {
    it('records keep_frozen decision', () => {
      const frozenLanes: FrozenLane[] = [
        {
          laneId: 'lane-a',
          frozenAtMinutes: 225,
          frozenAt: '2024-01-01T09:45:00Z',
          reason: 'test',
          decisionHistory: [],
        },
      ]

      const result = recordUnfreezeDecision(
        frozenLanes,
        'keep_frozen',
        240, // 10:00
        15  // headcount
      )

      expect(result[0]?.decisionHistory).toHaveLength(1)
      expect(result[0]?.decisionHistory?.[0]).toMatchObject({
        atMinutes: 240,
        headcount: 15,
        decision: 'keep_frozen',
      })
    })

    it('records unfrozen decision', () => {
      const frozenLanes: FrozenLane[] = [
        {
          laneId: 'lane-a',
          frozenAtMinutes: 225,
          frozenAt: '2024-01-01T09:45:00Z',
          reason: 'test',
          decisionHistory: [],
        },
      ]

      const result = recordUnfreezeDecision(
        frozenLanes,
        'unfrozen',
        240,
        15
      )

      expect(result[0]?.decisionHistory).toHaveLength(1)
      expect(result[0]?.decisionHistory?.[0]?.decision).toBe('unfrozen')
    })

    it('appends to existing decision history', () => {
      const frozenLanes: FrozenLane[] = [
        {
          laneId: 'lane-a',
          frozenAtMinutes: 225,
          frozenAt: '2024-01-01T09:45:00Z',
          reason: 'test',
          decisionHistory: [
            {
              at: '2024-01-01T10:00:00Z',
              atMinutes: 240,
              headcount: 12,
              decision: 'keep_frozen',
            },
          ],
        },
      ]

      const result = recordUnfreezeDecision(
        frozenLanes,
        'unfrozen',
        270, // 10:30
        15
      )

      expect(result[0]?.decisionHistory).toHaveLength(2)
      expect(result[0]?.decisionHistory?.[1]?.decision).toBe('unfrozen')
    })
  })

  describe('filterFrozenLanesByActiveHours', () => {
    it('includes lanes without activeHours', () => {
      const frozenLanes: FrozenLane[] = [
        {
          laneId: 'lane-a',
          frozenAtMinutes: 225,
          frozenAt: '2024-01-01T09:45:00Z',
          reason: 'test',
          decisionHistory: [],
        },
      ]

      const result = filterFrozenLanesByActiveHours(
        frozenLanes,
        mockLanes,
        600, // 10:00
        120  // 2 hours
      )

      expect(result).toHaveLength(1)
    })

    it('includes lanes that are currently in their active hours', () => {
      const lanesWithHours: Lane[] = [
        {
          ...mockLanes[0]!,
          activeHours: [{ start: 360, end: 720 }], // 06:00-12:00
        },
      ]

      const frozenLanes: FrozenLane[] = [
        {
          laneId: 'lane-a',
          frozenAtMinutes: 225,
          frozenAt: '2024-01-01T09:45:00Z',
          reason: 'test',
          decisionHistory: [],
        },
      ]

      const result = filterFrozenLanesByActiveHours(
        frozenLanes,
        lanesWithHours,
        600, // 10:00 - within active hours
        120
      )

      expect(result).toHaveLength(1)
    })

    it('excludes lanes that are outside their active hours', () => {
      const lanesWithHours: Lane[] = [
        {
          ...mockLanes[0]!,
          activeHours: [{ start: 360, end: 480 }], // 06:00-08:00
        },
      ]

      const frozenLanes: FrozenLane[] = [
        {
          laneId: 'lane-a',
          frozenAtMinutes: 225,
          frozenAt: '2024-01-01T09:45:00Z',
          reason: 'test',
          decisionHistory: [],
        },
      ]

      const result = filterFrozenLanesByActiveHours(
        frozenLanes,
        lanesWithHours,
        600, // 10:00 - outside active hours (06:00-08:00)
        120
      )

      expect(result).toHaveLength(0)
    })

    it('handles multiple active hour ranges', () => {
      const lanesWithHours: Lane[] = [
        {
          ...mockLanes[0]!,
          activeHours: [
            { start: 360, end: 480 },   // 06:00-08:00
            { start: 600, end: 720 },   // 10:00-12:00
          ],
        },
      ]

      const frozenLanes: FrozenLane[] = [
        {
          laneId: 'lane-a',
          frozenAtMinutes: 225,
          frozenAt: '2024-01-01T09:45:00Z',
          reason: 'test',
          decisionHistory: [],
        },
      ]

      // Test during first range (need to fit entire 2-hour window)
      let result = filterFrozenLanesByActiveHours(
        frozenLanes,
        lanesWithHours,
        360, // 06:00 - in first range, 2-hour window fits (06:00-08:00)
        120
      )
      expect(result).toHaveLength(1)

      // Test during gap
      result = filterFrozenLanesByActiveHours(
        frozenLanes,
        lanesWithHours,
        540, // 09:00 - in gap between ranges
        120
      )
      expect(result).toHaveLength(0)

      // Test during second range (need to fit entire 2-hour window)
      result = filterFrozenLanesByActiveHours(
        frozenLanes,
        lanesWithHours,
        600, // 10:00 - in second range, 2-hour window fits (10:00-12:00)
        120
      )
      expect(result).toHaveLength(1)
    })
  })

  describe('shouldPromptUnfreeze', () => {
    it('returns false if no frozen lanes', () => {
      const result = shouldPromptUnfreeze({
        frozenLanes: [],
        currentHeadcount: 15,
        requiredStandard: 14,
        newWorkerId: 'worker-1',
      })

      expect(result).toBe(false)
    })

    it('returns false if headcount insufficient', () => {
      const frozenLanes: FrozenLane[] = [
        {
          laneId: 'lane-a',
          frozenAtMinutes: 225,
          frozenAt: '2024-01-01T09:45:00Z',
          reason: 'test',
          decisionHistory: [],
        },
      ]

      const result = shouldPromptUnfreeze({
        frozenLanes,
        currentHeadcount: 12,
        requiredStandard: 14,
        newWorkerId: 'worker-1',
      })

      expect(result).toBe(false)
    })

    it('returns true if headcount sufficient and no previous decisions', () => {
      const frozenLanes: FrozenLane[] = [
        {
          laneId: 'lane-a',
          frozenAtMinutes: 225,
          frozenAt: '2024-01-01T09:45:00Z',
          reason: 'test',
          decisionHistory: [],
        },
      ]

      const result = shouldPromptUnfreeze({
        frozenLanes,
        currentHeadcount: 15,
        requiredStandard: 14,
        newWorkerId: 'worker-1',
      })

      expect(result).toBe(true)
    })

    it('returns false if user already chose to unfreeze', () => {
      const frozenLanes: FrozenLane[] = [
        {
          laneId: 'lane-a',
          frozenAtMinutes: 225,
          frozenAt: '2024-01-01T09:45:00Z',
          reason: 'test',
          decisionHistory: [
            {
              at: '2024-01-01T10:00:00Z',
              atMinutes: 240,
              headcount: 15,
              decision: 'unfrozen',
            },
          ],
        },
      ]

      const result = shouldPromptUnfreeze({
        frozenLanes,
        currentHeadcount: 16,
        requiredStandard: 14,
        newWorkerId: 'worker-1',
      })

      expect(result).toBe(false)
    })

    it('returns false if user chose keep_frozen and headcount increase is small', () => {
      const frozenLanes: FrozenLane[] = [
        {
          laneId: 'lane-a',
          frozenAtMinutes: 225,
          frozenAt: '2024-01-01T09:45:00Z',
          reason: 'test',
          decisionHistory: [
            {
              at: '2024-01-01T10:00:00Z',
              atMinutes: 240,
              headcount: 14,
              decision: 'keep_frozen',
            },
          ],
        },
      ]

      const result = shouldPromptUnfreeze({
        frozenLanes,
        currentHeadcount: 15, // +1 from last decision
        requiredStandard: 14,
        newWorkerId: 'worker-1',
      })

      expect(result).toBe(false)
    })

    it('returns true if user chose keep_frozen but headcount increased significantly (+2)', () => {
      const frozenLanes: FrozenLane[] = [
        {
          laneId: 'lane-a',
          frozenAtMinutes: 225,
          frozenAt: '2024-01-01T09:45:00Z',
          reason: 'test',
          decisionHistory: [
            {
              at: '2024-01-01T10:00:00Z',
              atMinutes: 240,
              headcount: 14,
              decision: 'keep_frozen',
            },
          ],
        },
      ]

      const result = shouldPromptUnfreeze({
        frozenLanes,
        currentHeadcount: 16, // +2 from last decision
        requiredStandard: 14,
        newWorkerId: 'worker-1',
      })

      expect(result).toBe(true)
    })

    it('returns false if all frozen lanes are outside their active hours', () => {
      const lanesWithHours: Lane[] = [
        {
          ...mockLanes[0]!,
          activeHours: [{ start: 360, end: 480 }], // 06:00-08:00
        },
      ]

      const frozenLanes: FrozenLane[] = [
        {
          laneId: 'lane-a',
          frozenAtMinutes: 225,
          frozenAt: '2024-01-01T09:45:00Z',
          reason: 'test',
          decisionHistory: [],
        },
      ]

      const result = shouldPromptUnfreeze({
        frozenLanes,
        currentHeadcount: 15,
        requiredStandard: 14,
        newWorkerId: 'worker-1',
        lanes: lanesWithHours,
        currentMinutes: 600, // 10:00 - outside active hours
      })

      expect(result).toBe(false)
    })

    it('returns true if at least one frozen lane is in its active hours', () => {
      const lanesWithHours: Lane[] = [
        {
          ...mockLanes[0]!,
          activeHours: [{ start: 360, end: 840 }], // 06:00-14:00
        },
        {
          ...mockLanes[1]!,
          activeHours: [{ start: 720, end: 960 }], // 12:00-16:00
        },
      ]

      const frozenLanes: FrozenLane[] = [
        {
          laneId: 'lane-a',
          frozenAtMinutes: 225,
          frozenAt: '2024-01-01T09:45:00Z',
          reason: 'test',
          decisionHistory: [],
        },
        {
          laneId: 'lane-b',
          frozenAtMinutes: 225,
          frozenAt: '2024-01-01T09:45:00Z',
          reason: 'test',
          decisionHistory: [],
        },
      ]

      const result = shouldPromptUnfreeze({
        frozenLanes,
        currentHeadcount: 15,
        requiredStandard: 14,
        newWorkerId: 'worker-1',
        lanes: lanesWithHours,
        currentMinutes: 600, // 10:00 - lane-a is active (06:00-14:00), lane-b is not (starts at 12:00)
      })

      expect(result).toBe(true)
    })
  })
})
