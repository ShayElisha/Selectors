import {
  ROTATION_LOOKBACK_DAYS,
  SHORT_RETURN_DAYS,
  buildWorkerProfile,
} from '../algorithm'
import type { Lane, ShiftSchedule, Worker } from '../types'

export type ShortReturnQuality = {
  /** Day-shift placements that revisit a lane within maxDays. */
  shortReturnPlacements: number
  /** All day-shift placements considered. */
  totalDayPlacements: number
  /** shortReturnPlacements / totalDayPlacements (0 when empty). */
  rate: number
  maxDays: number
}

/**
 * Share of day-shift (morning/afternoon) placements that return to the same
 * lane within `maxDays` (default SHORT_RETURN_DAYS), using prior history only.
 * Night shifts are excluded from both numerator and denominator.
 */
export function computeShortReturnRate(
  history: ShiftSchedule[],
  workers: Worker[],
  lanes: Lane[],
  options?: { maxDays?: number; fromDate?: string; toDate?: string },
): ShortReturnQuality {
  const maxDays = options?.maxDays ?? SHORT_RETURN_DAYS
  const workerIds = new Set(workers.map((w) => w.id))
  const sorted = [...history]
    .filter((h) => {
      if (options?.fromDate && h.date < options.fromDate) return false
      if (options?.toDate && h.date > options.toDate) return false
      return true
    })
    .sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date)
      const order = { morning: 0, afternoon: 1, night: 2 }
      return order[a.shiftType] - order[b.shiftType]
    })

  let shortReturnPlacements = 0
  let totalDayPlacements = 0

  for (let i = 0; i < sorted.length; i++) {
    const shift = sorted[i]!
    if (shift.shiftType === 'night') continue

    const prior = sorted.slice(0, i)
    for (const a of shift.assignments) {
      for (const wid of a.workerIds) {
        if (!wid || !workerIds.has(wid)) continue
        totalDayPlacements += 1
        const profile = buildWorkerProfile(
          wid,
          prior,
          lanes,
          shift.shiftType,
          shift.date,
          ROTATION_LOOKBACK_DAYS,
        )
        const D = profile.daysSinceLastVisit.get(a.laneId)
        if (D != null && D <= maxDays) shortReturnPlacements += 1
      }
    }
  }

  return {
    shortReturnPlacements,
    totalDayPlacements,
    rate:
      totalDayPlacements === 0
        ? 0
        : shortReturnPlacements / totalDayPlacements,
    maxDays,
  }
}

/** Parse optimizer improvement count from algorithm warning strings. */
export function parseOptimizerImprovingPasses(warnings: string[]): number {
  for (const w of warnings) {
    const m = w.match(/(\d+)\s*שיפורים אחרי הסיבוב הראשון/)
    if (m) return Number(m[1])
  }
  return 0
}
