import { daysBetweenLocal } from '../algorithm'
import { shiftPlacements } from './shiftPlacements'
import type { Intensity, ShiftSchedule, ShiftType, Worker } from '../types'
import type { WorkerLaneStats } from '../algorithm'

export type HeatLevel = 0 | 1 | 2 | 3 | 4

export interface HeatScaleOpts {
  /** Hottest cell count in the current filtered matrix (lanes × workers). */
  maxInData: number
  /**
   * Inclusive calendar span of the selected range, or `null` for all-time.
   * Shorter windows make the same absolute count “hotter”.
   */
  rangeDays: number | null
}

/**
 * Map a visit count to heat levels 0–4.
 *
 * Level 0 = empty. Levels 1–4 scale by both the matrix max and the selected
 * window: 2 visits in 14 days is hotter than 2 across all history, because
 * short ranges get a boost and all-time is dampened. Deterministic / pure.
 */
export function heatLevel(
  count: number,
  { maxInData, rangeDays }: HeatScaleOpts,
): HeatLevel {
  if (count <= 0 || maxInData <= 0) return 0

  const relative = count / maxInData
  const boost =
    rangeDays == null
      ? 0.7
      : rangeDays <= 14
        ? 1.35
        : rangeDays <= 30
          ? 1.0
          : Math.max(0.7, 30 / rangeDays)

  const score = relative * boost

  // At most one full shift never looks “hot”, even if it is the matrix max.
  if (count <= 1) return score >= 0.95 ? 2 : 1
  if (score < 0.28) return 1
  if (score < 0.48) return 2
  if (score < 0.72) return 3
  return 4
}

/** Tailwind / token class names for each heat level (number stays ink for contrast). */
export function heatCellClass(level: HeatLevel): string {
  switch (level) {
    case 0:
      return ''
    case 1:
      return 'heat-cell heat-cell-1'
    case 2:
      return 'heat-cell heat-cell-2'
    case 3:
      return 'heat-cell heat-cell-3'
    case 4:
      return 'heat-cell heat-cell-4'
  }
}

/** Inclusive day span between ISO dates, or null when open-ended. */
export function inclusiveRangeDays(
  fromDate: string | undefined,
  toDate: string | undefined,
): number | null {
  if (!fromDate || !toDate) return null
  const span = daysBetweenLocal(fromDate, toDate)
  if (!Number.isFinite(span) || span < 0) return null
  return span + 1
}

/** Strip Hebrew nikud / punctuation for search; lower-case for Latin. */
export function normalizeHeSearch(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0591-\u05C7]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .toLocaleLowerCase('he')
    .trim()
}

export function workerMatchesSearch(name: string, query: string): boolean {
  const q = normalizeHeSearch(query)
  if (!q) return true
  return normalizeHeSearch(name).includes(q)
}

export type TrackingSortKey =
  | 'name'
  | 'hard'
  | 'medium'
  | 'dayEasy'
  | 'load'
  | 'total'
  | `lane:${string}`

export type SortDir = 'asc' | 'desc'

export function sortValueForWorker(
  key: TrackingSortKey,
  worker: Worker,
  stats: WorkerLaneStats | undefined,
): string | number {
  if (key === 'name') return worker.fullName
  if (!stats) return 0
  if (key === 'hard') return stats.hardCount
  if (key === 'medium') return stats.mediumCount
  if (key === 'dayEasy') return stats.dayEasyCount
  if (key === 'load') return stats.effectiveLoad
  if (key === 'total') return stats.totalAssignments
  if (key.startsWith('lane:')) {
    const laneId = key.slice(5)
    return stats.byLane[laneId] ?? 0
  }
  return 0
}

export function compareTrackingRows(
  a: Worker,
  b: Worker,
  key: TrackingSortKey,
  dir: SortDir,
  statsByWorker: Map<string, WorkerLaneStats>,
): number {
  const va = sortValueForWorker(key, a, statsByWorker.get(a.id))
  const vb = sortValueForWorker(key, b, statsByWorker.get(b.id))
  let cmp = 0
  if (typeof va === 'string' && typeof vb === 'string') {
    cmp = va.localeCompare(vb, 'he')
  } else {
    cmp = Number(va) - Number(vb)
  }
  if (cmp === 0) {
    cmp = a.fullName.localeCompare(b.fullName, 'he')
  }
  return dir === 'asc' ? cmp : -cmp
}

export interface LaneVisit {
  id: string
  date: string
  shiftType: ShiftType
  daysAgo: number
  /** Shift-equivalents spent on this lane (1 = a full inspector placement). */
  share: number
  /** Clock labels of selector rounds on this lane, in board order. */
  rounds: string[]
  /** Left this lane and came back later in the same shift. */
  returned: boolean
}

/** Whole numbers stay bare; fractions show one decimal. */
export function formatShiftShare(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  const rounded = Math.round(n * 10) / 10
  if (Math.abs(rounded - Math.round(rounded)) < 1e-9) {
    return String(Math.round(rounded))
  }
  return rounded.toFixed(1)
}

/** True when the round indexes skip a gap (left and came back). */
export function roundsAreSplit(indexes: number[]): boolean {
  const sorted = [...new Set(indexes)].sort((a, b) => a - b)
  if (sorted.length < 2) return false
  return sorted[sorted.length - 1]! - sorted[0]! + 1 !== sorted.length
}

export function laneReturnKey(workerId: string, laneId: string): string {
  return `${workerId}\0${laneId}`
}

/** Visits behind a matrix cell, newest first. */
export function listWorkerLaneVisits(
  history: ShiftSchedule[],
  workerId: string,
  laneId: string,
  options?: { fromDate?: string; toDate?: string; today?: string },
): LaneVisit[] {
  const today =
    options?.today ??
    (() => {
      const d = new Date()
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    })()

  const visits: LaneVisit[] = []
  for (const shift of history) {
    if (shift.shiftType === 'night') continue
    if (options?.fromDate && shift.date < options.fromDate) continue
    if (options?.toDate && shift.date > options.toDate) continue
    const rounds: string[] = []
    const indexes: number[] = []
    let share = 0
    for (const placement of shiftPlacements(shift)) {
      if (placement.workerId !== workerId) continue
      if (placement.laneId !== laneId) continue
      share += placement.weight
      if (placement.roundLabel) rounds.push(placement.roundLabel)
      if (placement.roundIndex != null) indexes.push(placement.roundIndex)
    }
    if (share <= 0) continue
    visits.push({
      id: shift.id,
      date: shift.date,
      shiftType: shift.shiftType,
      daysAgo: daysBetweenLocal(shift.date, today),
      share,
      rounds,
      returned: roundsAreSplit(indexes),
    })
  }

  visits.sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date)
    return shiftTypeOrder(b.shiftType) - shiftTypeOrder(a.shiftType)
  })
  return visits
}

/**
 * Worker×lane pairs where the person left a lane and returned later
 * in the same selector shift, inside the selected date window.
 */
export function workerLaneReturnKeys(
  history: ShiftSchedule[],
  options?: { fromDate?: string; toDate?: string },
): Set<string> {
  const keys = new Set<string>()
  for (const shift of history) {
    if (shift.shiftType === 'night') continue
    if (options?.fromDate && shift.date < options.fromDate) continue
    if (options?.toDate && shift.date > options.toDate) continue
    const indexes = new Map<string, number[]>()
    for (const placement of shiftPlacements(shift)) {
      if (placement.roundIndex == null) continue
      const key = laneReturnKey(placement.workerId, placement.laneId)
      const list = indexes.get(key)
      if (list) list.push(placement.roundIndex)
      else indexes.set(key, [placement.roundIndex])
    }
    for (const [key, list] of indexes) {
      if (roundsAreSplit(list)) keys.add(key)
    }
  }
  return keys
}

function shiftTypeOrder(t: ShiftType): number {
  if (t === 'night') return 3
  if (t === 'afternoon') return 2
  return 1
}

/** Hebrew relative day label for a visit. */
export function formatVisitRecency(daysAgo: number): string {
  if (daysAgo <= 0) return 'מוקדם יותר היום'
  if (daysAgo === 1) return 'אתמול'
  return `לפני ${daysAgo} ימים`
}

export function formatLoadOneDecimal(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1)
}

export function teamAverageLoad(stats: WorkerLaneStats[]): number {
  if (stats.length === 0) return 0
  const sum = stats.reduce((acc, s) => acc + s.effectiveLoad, 0)
  return Math.round((sum / stats.length) * 10) / 10
}

export function maxLaneCount(stats: WorkerLaneStats[]): number {
  let max = 0
  for (const s of stats) {
    for (const n of Object.values(s.byLane)) {
      if (n > max) max = n
    }
  }
  return max
}

export function filterLanesByIntensity<T extends { intensity: Intensity }>(
  lanes: T[],
  filter: Intensity | 'all',
): T[] {
  if (filter === 'all') return lanes
  return lanes.filter((l) => l.intensity === filter)
}
