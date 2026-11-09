import type { ShiftSchedule } from '../types'

export interface BoardStability {
  score: number
  label: string
  changes: number
}

function inRange(date: string, from?: string, to?: string): boolean {
  if (from && date < from) return false
  if (to && date > to) return false
  return true
}

function editCountOf(shift: ShiftSchedule): number {
  if (typeof shift.editCount === 'number' && shift.editCount >= 0) {
    return shift.editCount
  }
  if (shift.updatedAt && shift.createdAt && shift.updatedAt !== shift.createdAt) {
    return 1
  }
  return 0
}

/** Score 0–100 from saved-board edit count (server `editCount` or created/updated heuristic). */
export function stabilityFromEditCount(editCount = 0): BoardStability {
  const changes = Math.max(0, Math.floor(editCount))
  let score: number
  if (changes <= 0) score = 100
  else if (changes === 1) score = 85
  else if (changes === 2) score = 65
  else if (changes <= 4) score = 45
  else score = 25
  const label =
    changes <= 1 ? 'יציבות גבוהה' : changes <= 3 ? 'עריכות בינוניות' : 'עריכות רבות'
  return { score, label, changes }
}

export function stabilityFromVersions(
  versionCount: number,
  placementChangeEvents = 0,
): BoardStability {
  const versions = Math.max(1, versionCount)
  const extra = Math.max(0, placementChangeEvents)
  const changes = Math.max(0, versions - 1 + extra)
  return stabilityFromEditCount(changes)
}

export function shiftBoardStability(shift: ShiftSchedule): BoardStability {
  return stabilityFromEditCount(editCountOf(shift))
}

export interface StabilitySummary {
  shifts: number
  avgEditCount: number
  highStabilityShare: number
  distribution: { label: string; count: number }[]
}

export function boardStabilitySummary(
  history: ShiftSchedule[],
  from?: string,
  to?: string,
): StabilitySummary {
  const rows = history.filter((shift) => inRange(shift.date, from, to))
  if (rows.length === 0) {
    return {
      shifts: 0,
      avgEditCount: 0,
      highStabilityShare: 0,
      distribution: [],
    }
  }
  const counts = rows.map((shift) => editCountOf(shift))
  const avgEditCount =
    Math.round((counts.reduce((sum, n) => sum + n, 0) / counts.length) * 10) / 10
  const high = counts.filter((n) => n <= 1).length
  const dist = new Map<string, number>()
  for (const shift of rows) {
    const { label } = shiftBoardStability(shift)
    dist.set(label, (dist.get(label) ?? 0) + 1)
  }
  return {
    shifts: rows.length,
    avgEditCount,
    highStabilityShare: Math.round((high / rows.length) * 100),
    distribution: [...dist.entries()].map(([label, count]) => ({ label, count })),
  }
}
