import { computeWorkerLaneStats } from '../algorithm'
import type { Lane, ShiftSchedule, ShiftType, Worker } from '../types'

export interface WorkerAnalyticsRow {
  workerId: string
  fullName: string
  effectiveLoad: number
  hardCount: number
  dayEasyCount: number
  nightEasyCount: number
  mediumCount: number
  totalAssignments: number
  shiftsCount: number
  shiftsByType: Record<ShiftType, number>
  hardByShift: Record<ShiftType, number>
  topLaneId: string | null
  topLaneName: string | null
  topLaneCount: number
  hardAfterNightCount: number
}

export interface LaneConcentration {
  laneId: string
  laneName: string
  intensity: Lane['intensity']
  totalAssignments: number
  uniqueWorkers: number
  topWorkerId: string
  topWorkerName: string
  topWorkerCount: number
  /** Share of assignments on the single most frequent worker (0–1) */
  concentration: number
}

/** One hard placement on the calendar day after a night shift ends (06:00). */
export interface HardAfterNightEvent {
  workerId: string
  fullName: string
  /** Start calendar date of the night shift (e.g. 19.9 → ends 06:00 on 20.9). */
  nightDate: string
  /** Calendar date of the hard placement (must be the day after nightDate). */
  date: string
  shiftType: ShiftType
  laneId: string
  laneName: string
}

export interface TeamAnalytics {
  shiftsInRange: number
  workersWithData: number
  workersWithoutData: number
  avgLoad: number
  maxLoad: number
  minLoad: number
  loadGap: number
  hardAfterNightTotal: number
  hardAfterNightEvents: HardAfterNightEvent[]
  shiftMix: Record<ShiftType, number>
  /** Full ranked list: relief score high → low (UI slices top 5). */
  needRelief: WorkerAnalyticsRow[]
  /** Full ranked list: relief score low → high. */
  gotRest: WorkerAnalyticsRow[]
  workers: WorkerAnalyticsRow[]
  /** All lanes with assignments; UI filters repeats via filterLaneRepeats. */
  lanes: LaneConcentration[]
}

const EMPTY_SHIFT: Record<ShiftType, number> = {
  morning: 0,
  afternoon: 0,
  night: 0,
}

/**
 * ASSUMPTION — no fairness-gap thresholds existed in the product.
 * good: gap &lt; ATTENTION; attention: ATTENTION ≤ gap &lt; HIGH; high: gap ≥ HIGH.
 */
export const FAIRNESS_GAP_ATTENTION = 3
export const FAIRNESS_GAP_HIGH = 6

export type FairnessGapStatus = 'good' | 'attention' | 'high'

export function fairnessGapStatus(gap: number): FairnessGapStatus {
  if (gap >= FAIRNESS_GAP_HIGH) return 'high'
  if (gap >= FAIRNESS_GAP_ATTENTION) return 'attention'
  return 'good'
}

export type LoadDeviation = 'above' | 'near' | 'below'

/** Near = within 0.5 load points of the team mean (display only). */
export function loadDeviationFromMean(
  value: number,
  mean: number,
): LoadDeviation {
  const d = value - mean
  if (Math.abs(d) < 0.5) return 'near'
  return d > 0 ? 'above' : 'below'
}

/** Primary load ÷ shifts worked; null when no shifts. */
export function loadPerShift(
  effectiveLoad: number,
  shiftsCount: number,
): number | null {
  if (shiftsCount <= 0) return null
  return Math.round((effectiveLoad / shiftsCount) * 10) / 10
}

/** Lanes where the top inspector repeated (≥2 visits). Sorted by count, then share. */
export function filterLaneRepeats(
  lanes: LaneConcentration[],
): LaneConcentration[] {
  return lanes
    .filter((l) => l.topWorkerCount >= 2)
    .slice()
    .sort(
      (a, b) =>
        b.topWorkerCount - a.topWorkerCount ||
        b.concentration - a.concentration ||
        b.totalAssignments - a.totalAssignments,
    )
}

export function formatLoadOneDecimal(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1)
}

function filterHistory(
  history: ShiftSchedule[],
  fromDate?: string,
  toDate?: string,
): ShiftSchedule[] {
  return history.filter((h) => {
    if (fromDate && h.date < fromDate) return false
    if (toDate && h.date > toDate) return false
    return true
  })
}

/** Chronological: date asc, then morning → afternoon → night */
function sortChronological(history: ShiftSchedule[]): ShiftSchedule[] {
  const order: Record<ShiftType, number> = {
    morning: 0,
    afternoon: 1,
    night: 2,
  }
  return [...history].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date)
    return order[a.shiftType] - order[b.shiftType]
  })
}

/** Next local calendar day for an ISO YYYY-MM-DD date. */
export function nextLocalDateISO(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + 1)
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}

/**
 * «קשה אחרי לילה»: night shift dated D (21:00→06:00 next morning),
 * then a hard-lane placement on calendar day D+1 (e.g. afternoon the same day the night ended).
 * Does NOT mean “worked the day before a night”, and does not count a hard shift
 * merely because the worker’s previous saved shift was a night weeks earlier.
 */
function collectHardAfterNight(
  workerId: string,
  fullName: string,
  historyAsc: ShiftSchedule[],
  laneIntensity: Map<string, Lane['intensity']>,
  laneNames: Map<string, string>,
): { count: number; events: HardAfterNightEvent[] } {
  const nightDates: string[] = []
  /** date → first hard lane + shift type that day for this worker */
  const hardOnDate = new Map<
    string,
    { laneId: string; shiftType: ShiftType }
  >()

  for (const shift of historyAsc) {
    let placed = false
    let hardLaneId: string | null = null
    for (const a of shift.assignments) {
      if (!a.workerIds.includes(workerId)) continue
      placed = true
      if (laneIntensity.get(a.laneId) === 'hard' && !hardLaneId) {
        hardLaneId = a.laneId
      }
    }
    if (!placed) continue
    if (shift.shiftType === 'night') nightDates.push(shift.date)
    if (hardLaneId && !hardOnDate.has(shift.date)) {
      hardOnDate.set(shift.date, {
        laneId: hardLaneId,
        shiftType: shift.shiftType,
      })
    }
  }

  const events: HardAfterNightEvent[] = []
  const seenNext = new Set<string>()
  for (const nightDate of nightDates) {
    const next = nextLocalDateISO(nightDate)
    const key = `${nightDate}->${next}`
    if (seenNext.has(key)) continue
    const hard = hardOnDate.get(next)
    if (!hard) continue
    // Hard on the next calendar day must not itself be another night-only pairing edge:
    // morning/afternoon (or night) hard on D+1 all count as "came back after night ended".
    seenNext.add(key)
    events.push({
      workerId,
      fullName,
      nightDate,
      date: next,
      shiftType: hard.shiftType,
      laneId: hard.laneId,
      laneName: laneNames.get(hard.laneId) ?? hard.laneId,
    })
  }

  return { count: events.length, events }
}

/** Relief ranking score — unchanged from prior product logic. */
export function reliefScore(w: {
  effectiveLoad: number
  hardCount: number
  dayEasyCount: number
}): number {
  return w.effectiveLoad * 2 + w.hardCount - w.dayEasyCount * 1.5
}

export function computeTeamAnalytics(
  workers: Worker[],
  lanes: Lane[],
  history: ShiftSchedule[],
  options?: { fromDate?: string; toDate?: string },
): TeamAnalytics {
  const filtered = filterHistory(history, options?.fromDate, options?.toDate)
  const historyAsc = sortChronological(filtered)
  const laneMap = new Map(lanes.map((l) => [l.id, l]))
  const laneIntensity = new Map(lanes.map((l) => [l.id, l.intensity]))
  const laneNames = new Map(lanes.map((l) => [l.id, l.name]))
  const nameById = new Map(workers.map((w) => [w.id, w.fullName]))

  const baseStats = computeWorkerLaneStats(workers, lanes, filtered)

  const shiftMix: Record<ShiftType, number> = { ...EMPTY_SHIFT }
  for (const h of filtered) shiftMix[h.shiftType] += 1

  const allHardEvents: HardAfterNightEvent[] = []

  const workersRows: WorkerAnalyticsRow[] = baseStats.map((s) => {
    const shiftsByType: Record<ShiftType, number> = { ...EMPTY_SHIFT }
    let shiftsCount = 0

    for (const shift of filtered) {
      const placed = shift.assignments.some((a) =>
        a.workerIds.includes(s.workerId),
      )
      if (!placed) continue
      shiftsCount += 1
      shiftsByType[shift.shiftType] += 1
    }

    let topLaneId: string | null = null
    let topLaneCount = 0
    for (const [laneId, n] of Object.entries(s.byLane)) {
      if (n > topLaneCount) {
        topLaneCount = n
        topLaneId = laneId
      }
    }

    const fullName = nameById.get(s.workerId) ?? s.workerId
    const { count: hardAfterNightCount, events } = collectHardAfterNight(
      s.workerId,
      fullName,
      historyAsc,
      laneIntensity,
      laneNames,
    )
    allHardEvents.push(...events)

    return {
      workerId: s.workerId,
      fullName,
      effectiveLoad: s.effectiveLoad,
      hardCount: s.hardCount,
      dayEasyCount: s.dayEasyCount,
      nightEasyCount: s.nightEasyCount,
      mediumCount: s.mediumCount,
      totalAssignments: s.totalAssignments,
      shiftsCount,
      shiftsByType,
      hardByShift: { ...s.hardByShift },
      topLaneId,
      topLaneName: topLaneId
        ? (laneMap.get(topLaneId)?.name ?? topLaneId)
        : null,
      topLaneCount,
      hardAfterNightCount,
    }
  })

  const withData = workersRows.filter((w) => w.totalAssignments > 0)
  const loads = withData.map((w) => w.effectiveLoad)
  const avgLoad =
    loads.length === 0
      ? 0
      : Math.round((loads.reduce((a, b) => a + b, 0) / loads.length) * 10) / 10
  const maxLoad = loads.length ? Math.max(...loads) : 0
  const minLoad = loads.length ? Math.min(...loads) : 0

  const scored = [...withData].sort(
    (a, b) => reliefScore(b) - reliefScore(a) || b.effectiveLoad - a.effectiveLoad,
  )

  const needRelief = scored
  const gotRest = [...scored].reverse()

  const laneWorkerCounts = new Map<string, Map<string, number>>()
  for (const shift of filtered) {
    if (shift.shiftType === 'night') continue
    for (const a of shift.assignments) {
      if (!laneMap.has(a.laneId)) continue
      const map = laneWorkerCounts.get(a.laneId) ?? new Map()
      for (const wid of a.workerIds) {
        if (!wid) continue
        map.set(wid, (map.get(wid) ?? 0) + 1)
      }
      laneWorkerCounts.set(a.laneId, map)
    }
  }

  const laneRows: LaneConcentration[] = lanes
    .map((lane) => {
      const map = laneWorkerCounts.get(lane.id) ?? new Map()
      let total = 0
      let topWorkerId = ''
      let topWorkerCount = 0
      for (const [wid, n] of map) {
        total += n
        if (n > topWorkerCount) {
          topWorkerCount = n
          topWorkerId = wid
        }
      }
      return {
        laneId: lane.id,
        laneName: lane.name,
        intensity: lane.intensity,
        totalAssignments: total,
        uniqueWorkers: map.size,
        topWorkerId,
        topWorkerName: topWorkerId
          ? (nameById.get(topWorkerId) ?? topWorkerId)
          : '—',
        topWorkerCount,
        concentration: total > 0 ? topWorkerCount / total : 0,
      }
    })
    .filter((l) => l.totalAssignments > 0)
    .sort(
      (a, b) =>
        b.concentration - a.concentration ||
        b.totalAssignments - a.totalAssignments,
    )

  allHardEvents.sort((a, b) => b.date.localeCompare(a.date))

  return {
    shiftsInRange: filtered.length,
    workersWithData: withData.length,
    workersWithoutData: workersRows.length - withData.length,
    avgLoad,
    maxLoad,
    minLoad,
    loadGap: Math.round((maxLoad - minLoad) * 10) / 10,
    hardAfterNightTotal: withData.reduce((s, w) => s + w.hardAfterNightCount, 0),
    hardAfterNightEvents: allHardEvents,
    shiftMix,
    needRelief,
    gotRest,
    workers: [...withData].sort((a, b) => b.effectiveLoad - a.effectiveLoad),
    lanes: laneRows,
  }
}
