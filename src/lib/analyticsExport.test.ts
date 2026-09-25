import { describe, expect, it } from 'vitest'
import { buildAnalyticsCsv } from './analyticsExport'
import type { TeamAnalytics } from './analytics'

const emptyAnalytics = (): TeamAnalytics => ({
  shiftsInRange: 2,
  workersWithData: 1,
  workersWithoutData: 0,
  avgLoad: 3.5,
  maxLoad: 5,
  minLoad: 2,
  loadGap: 3,
  hardAfterNightTotal: 1,
  hardAfterNightEvents: [
    {
      workerId: 'w1',
      fullName: 'אבי',
      nightDate: '2026-09-19',
      date: '2026-09-20',
      shiftType: 'afternoon',
      laneId: 'h',
      laneName: 'קשה',
    },
  ],
  shiftMix: { morning: 1, afternoon: 1, afternoonA: 0, afternoonB: 0, night: 0 },
  needRelief: [],
  gotRest: [],
  workers: [
    {
      workerId: 'w1',
      fullName: 'אבי',
      effectiveLoad: 5,
      hardCount: 2,
      dayEasyCount: 1,
      nightEasyCount: 0,
      mediumCount: 0,
      totalAssignments: 3,
      shiftsCount: 2,
      shiftsByType: { morning: 1, afternoon: 1, afternoonA: 0, afternoonB: 0, night: 0 },
      hardByShift: { morning: 1, afternoon: 1, afternoonA: 0, afternoonB: 0, night: 0 },
      topLaneId: 'h',
      topLaneName: 'קשה',
      topLaneCount: 2,
      hardAfterNightCount: 1,
    },
  ],
  lanes: [
    {
      laneId: 'h',
      laneName: 'קשה',
      intensity: 'hard',
      totalAssignments: 2,
      uniqueWorkers: 1,
      topWorkerId: 'w1',
      topWorkerName: 'אבי',
      topWorkerCount: 2,
      concentration: 1,
    },
  ],
})

describe('analyticsExport', () => {
  it('builds multi-section CSV with BOM and Hebrew headers', () => {
    const csv = buildAnalyticsCsv(emptyAnalytics(), {
      fromDate: '2026-09-01',
      toDate: '2026-09-30',
      shortReturn: {
        shortReturnPlacements: 1,
        totalDayPlacements: 4,
        rate: 0.25,
        maxDays: 2,
      },
    })
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('סטטיסטיקות ואנליזה')
    expect(csv).toContain('בודקים — עומס ושיבוצים')
    expect(csv).toContain('נתיבים — ריכוז וחזרות')
    expect(csv).toContain('קשה אחרי לילה')
    expect(csv).toContain('אבי')
    expect(csv).toContain('25%')
  })
})
