import {
  buildLaneLastSeatings,
  DEFAULT_PROGRESS_SEARCH_STARTS,
  isQualified,
  LAST_OCCUPANT_WINDOW_DAYS,
  type AssignmentProgress,
  type LaneLastSeating,
  type PlacementExplanation,
} from '../algorithm'
import type {
  Lane,
  LaneAssignment,
  RoundCohort,
  SelectorRound,
  ShiftSchedule,
  ShiftType,
  WindowAdjustment,
  Worker,
} from '../types'
import { isGateManagerLane } from './gateManager'
import { sortLanesByCatalogOrder } from './lanesCertHelpers'
import {
  boardStartMinutes,
  laneOpenDuring,
  MAIN_SHIFT_BOUNDS,
  onShiftClock,
  roundCutsForWindows,
  windowCoversRound,
} from './shiftCatalog'
import {
  effectiveStaffingStandard,
  effectiveStaffingStandardAtTime,
  type PeakHoursOverrides,
  type StaffingOverrides,
} from './shiftStaffing'

/** A leftover shorter than this is folded into the previous round. */
const MIN_OWN_ROUND = 45

export function buildRoundWindows(
  shiftType: ShiftType,
  cutMinutes: number[] = [],
  windowIds: Array<string | undefined> = [],
  bounds?: { start: number; end: number },
  roundMinutes = 120,
  /**
   * Exact ordered boundaries [start … end]. When provided, rounds follow these
   * hours instead of a uniform step; worker-window cuts still split a segment.
   */
  customBoundaries?: number[] | null,
): Pick<SelectorRound, 'startMinutes' | 'endMinutes' | 'label'>[] {
  const fallback = MAIN_SHIFT_BOUNDS[shiftType]
  const end = bounds?.end ?? fallback?.end
  const start = bounds?.start ?? (fallback ? boardStartMinutes(shiftType, windowIds) : undefined)
  if (start == null || end == null) return []
  const cuts = [...cutMinutes]
    .filter((point) => point > start && point < end)
    .sort((a, b) => a - b)
  const windows: Pick<SelectorRound, 'startMinutes' | 'endMinutes' | 'label'>[] =
    []

  const custom =
    Array.isArray(customBoundaries) && customBoundaries.length >= 2
      ? [...new Set(customBoundaries.map((n) => Math.round(n)))]
          .filter((n) => n >= start && n <= end)
          .sort((a, b) => a - b)
      : null
  if (custom && custom.length >= 2) {
    if (custom[0] !== start) custom.unshift(start)
    if (custom[custom.length - 1] !== end) custom.push(end)
    for (let i = 0; i < custom.length - 1; i++) {
      let t = custom[i]!
      const segmentEnd = custom[i + 1]!
      while (t < segmentEnd) {
        let next = segmentEnd
        const cut = cuts.find((point) => point > t && point < next)
        if (cut != null) next = cut
        windows.push({
          startMinutes: t,
          endMinutes: next,
          label: roundLabel(t, next),
        })
        t = next
      }
    }
    return windows
  }

  let t = start
  while (t < end) {
    let next = Math.min(t + Math.max(30, roundMinutes), end)
    const cut = cuts.find((point) => point > t && point < next)
    if (cut != null) next = cut
    if (next < end && end - next < MIN_OWN_ROUND && cut == null) next = end
    windows.push({
      startMinutes: t,
      endMinutes: next,
      label: roundLabel(t, next),
    })
    t = next
  }
  return windows
}

export function formatClock(minutes: number): string {
  const day = 24 * 60
  const m = ((minutes % day) + day) % day
  const h = Math.floor(m / 60)
  const min = m % 60
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

export function roundLabel(startMinutes: number, endMinutes: number): string {
  return `${formatClock(startMinutes)}–${formatClock(endMinutes)}`
}

export function selectorLanes(lanes: Lane[], activeLaneIds: string[]): Lane[] {
  const byId = new Map(lanes.map((l) => [l.id, l]))
  const out: Lane[] = []
  for (const id of activeLaneIds) {
    const lane = byId.get(id)
    if (!lane || isGateManagerLane(lane) || lane.roundsDisabled) continue
    out.push(lane)
  }
  return sortLanesByCatalogOrder(out, lanes)
}

function buildAssignmentWindows(args: {
  shiftType: ShiftType
  workers: Worker[]
  workerWindows?: Record<string, string>
  bounds?: { start: number; end: number }
  roundMinutes?: number
  stagger?: boolean
  customBoundaries?: number[] | null
}): Array<Pick<SelectorRound, 'startMinutes' | 'endMinutes' | 'label' | 'cohort'>> {
  const windowIds = args.workers.map((worker) => args.workerWindows?.[worker.id])
  const cuts = roundCutsForWindows(args.shiftType, windowIds)
  const hour = buildRoundWindows(
    args.shiftType,
    cuts,
    windowIds,
    args.bounds,
    args.roundMinutes,
    args.customBoundaries,
  )
  if (!args.stagger || hour.length === 0) return hour
  const first = hour[0]
  const last = hour[hour.length - 1]
  if (!first || !last) return hour
  const halfStart = first.startMinutes + 30
  if (halfStart >= last.endMinutes) {
    return hour.map((window) => ({ ...window, cohort: 'hour' as const }))
  }
  const halfBounds = args.customBoundaries
    ?.filter((point) => point >= halfStart && point <= last.endMinutes)
  const half = buildRoundWindows(
    args.shiftType,
    cuts,
    windowIds,
    { start: halfStart, end: last.endMinutes },
    args.roundMinutes,
    halfBounds && halfBounds.length >= 2 ? halfBounds : null,
  ).map((window) => ({ ...window, cohort: 'half' as const }))
  return [
    ...hour.map((window) => ({ ...window, cohort: 'hour' as const })),
    ...half,
  ].sort(
    (a, b) =>
      a.startMinutes - b.startMinutes ||
      (a.cohort === 'half' ? 1 : 0) - (b.cohort === 'half' ? 1 : 0),
  )
}

function emptyAssignments(
  lanes: Lane[],
  overrides?: StaffingOverrides | null,
): LaneAssignment[] {
  return lanes.map((lane) => ({
    laneId: lane.id,
    workerIds: Array.from(
      { length: effectiveStaffingStandard(lane, overrides) },
      () => '',
    ),
  }))
}

export function emptySelectorRounds(
  shiftType: ShiftType,
  lanes: Lane[],
  activeLaneIds: string[],
  overrides?: StaffingOverrides | null,
  cutMinutes: number[] = [],
  windowIds: Array<string | undefined> = [],
  roundMinutes = 120,
  bounds?: { start: number; end: number },
  customBoundaries?: number[] | null,
): SelectorRound[] {
  const active = selectorLanes(lanes, activeLaneIds)
  return buildRoundWindows(
    shiftType,
    cutMinutes,
    windowIds,
    bounds,
    roundMinutes,
    customBoundaries,
  ).map((w) => ({
    ...w,
    assignments: emptyAssignments(active, overrides),
  }))
}

function cloneRounds(rounds: SelectorRound[]): SelectorRound[] {
  return rounds.map((r) => ({
    ...r,
    assignments: r.assignments.map((a) => ({
      laneId: a.laneId,
      workerIds: [...a.workerIds],
      ...(a.notes?.trim() ? { notes: a.notes } : {}),
    })),
  }))
}

function roundOverlapMinutes(
  a: { startMinutes: number; endMinutes: number },
  b: { startMinutes: number; endMinutes: number },
): number {
  return Math.max(
    0,
    Math.min(a.endMinutes, b.endMinutes) - Math.max(a.startMinutes, b.startMinutes),
  )
}

function roundsStructureKey(rounds: SelectorRound[]): string {
  return rounds
    .map(
      (round) =>
        `${round.cohort ?? ''}:${round.startMinutes}-${round.endMinutes}`,
    )
    .join('|')
}

/**
 * Rebuild round windows from current org settings while copying placements
 * from overlapping old rounds (same cohort preferred).
 */
export function rebuildRoundsPreservingPlacements(args: {
  existing: SelectorRound[]
  shiftType: ShiftType
  lanes: Lane[]
  activeLaneIds: string[]
  workers?: Worker[]
  overrides?: StaffingOverrides | null
  workerWindows?: Record<string, string>
  bounds?: { start: number; end: number }
  roundMinutes?: number
  stagger?: boolean
  customBoundaries?: number[] | null
  /** When false, only rebuild empty windows (no placement copy). */
  preservePlacements?: boolean
}): { rounds: SelectorRound[]; changed: boolean } {
  const active = selectorLanes(args.lanes, args.activeLaneIds)
  const windows = buildAssignmentWindows({
    shiftType: args.shiftType,
    workers: args.workers ?? [],
    workerWindows: args.workerWindows,
    bounds: args.bounds,
    roundMinutes: args.roundMinutes,
    stagger: args.stagger,
    customBoundaries: args.customBoundaries,
  })
  const next: SelectorRound[] = windows.map((window) => ({
    ...window,
    assignments: emptyAssignments(active, args.overrides),
  }))

  if (args.preservePlacements === false) {
    return {
      rounds: next,
      changed: roundsStructureKey(args.existing) !== roundsStructureKey(next),
    }
  }

  for (const round of next) {
    const seatedInRound = new Set<string>()
    const candidates = args.existing.filter((old) => {
      if (round.cohort || old.cohort) return round.cohort === old.cohort
      return true
    })
    const pool = candidates.length > 0 ? candidates : args.existing
    let best: SelectorRound | null = null
    let bestOverlap = 0
    for (const old of pool) {
      const overlap = roundOverlapMinutes(round, old)
      if (overlap > bestOverlap) {
        bestOverlap = overlap
        best = old
      }
    }
    if (!best || bestOverlap <= 0) continue
    for (const row of round.assignments) {
      const source = best.assignments.find((item) => item.laneId === row.laneId)
      if (!source) continue
      if (source.notes?.trim()) row.notes = source.notes
      const slots = row.workerIds.length
      const filled: string[] = []
      for (const workerId of source.workerIds) {
        if (filled.length >= slots) break
        if (!workerId) {
          filled.push('')
          continue
        }
        if (seatedInRound.has(workerId)) {
          filled.push('')
          continue
        }
        seatedInRound.add(workerId)
        filled.push(workerId)
      }
      while (filled.length < slots) filled.push('')
      row.workerIds = filled
    }
  }

  return {
    rounds: next,
    changed: roundsStructureKey(args.existing) !== roundsStructureKey(next),
  }
}

export function setSelectorCell(
  rounds: SelectorRound[],
  roundIndex: number,
  laneId: string,
  slotIndex: number,
  workerId: string | null,
): SelectorRound[] {
  const next = cloneRounds(rounds)
  const round = next[roundIndex]
  if (!round) return next
  if (workerId && repeatsPreviousLane(rounds, roundIndex, laneId, workerId)) {
    return rounds
  }
  if (workerId) {
    for (const a of round.assignments) {
      a.workerIds = a.workerIds.map((id) => (id === workerId ? '' : id))
    }
  }
  const target = round.assignments.find((a) => a.laneId === laneId)
  if (!target) return next
  while (target.workerIds.length <= slotIndex) target.workerIds.push('')
  target.workerIds[slotIndex] = workerId ?? ''
  return next
}

export function clearWorkerFromRounds(
  rounds: SelectorRound[],
  workerId: string,
): SelectorRound[] {
  return rounds.map((r) => ({
    ...r,
    assignments: r.assignments.map((a) => ({
      ...a,
      workerIds: a.workerIds.map((id) => (id === workerId ? '' : id)),
    })),
  }))
}

/**
 * Lane from the previous round in the same sequence.
 * Without stagger that is the round just before. With stagger it is the
 * previous round of the same hour or half-hour group.
 */
export function previousRoundLane(
  rounds: SelectorRound[],
  roundIndex: number,
  workerId: string,
): string | null {
  const current = rounds[roundIndex]
  const stagger = Boolean(current?.cohort)
  for (let index = roundIndex - 1; index >= 0; index -= 1) {
    const round = rounds[index]
    if (!round) continue
    if (stagger && round.cohort !== current?.cohort) continue
    for (const assignment of round.assignments) {
      if (assignment.workerIds.includes(workerId)) return assignment.laneId
    }
    if (!stagger) return null
  }
  return null
}

/** Hard rule: the same lane cannot repeat on two consecutive rounds for one person. */
export function repeatsPreviousLane(
  rounds: SelectorRound[],
  roundIndex: number,
  laneId: string,
  workerId: string,
): boolean {
  return previousRoundLane(rounds, roundIndex, workerId) === laneId
}

export function selectorRoundsHavePlacements(rounds: SelectorRound[]): boolean {
  return rounds.some((r) =>
    r.assignments.some((a) => a.workerIds.some(Boolean)),
  )
}

export function placedSelectorIds(rounds: SelectorRound[]): string[] {
  const ids = new Set<string>()
  for (const r of rounds) {
    for (const a of r.assignments) {
      for (const id of a.workerIds) {
        if (id) ids.add(id)
      }
    }
  }
  return [...ids]
}

function visitCount(
  visits: Map<string, Map<string, number>>,
  workerId: string,
  laneId: string,
): number {
  return visits.get(workerId)?.get(laneId) ?? 0
}

function bumpVisit(
  visits: Map<string, Map<string, number>>,
  workerId: string,
  laneId: string,
) {
  const row = visits.get(workerId) ?? new Map<string, number>()
  row.set(laneId, (row.get(laneId) ?? 0) + 1)
  visits.set(workerId, row)
}

function pickWorker(
  lane: Lane,
  workers: Worker[],
  used: Set<string>,
  prevLane: Map<string, string>,
  visits: Map<string, Map<string, number>>,
  roundIndex: number,
  historical: Map<string, LaneLastSeating>,
  offset: number,
): Worker | null {
  const qualified = workers.filter(
    (w) =>
      !used.has(w.id) &&
      isQualified(w, lane) &&
      prevLane.get(w.id) !== lane.id,
  )
  if (qualified.length === 0) return null
  const rotated = (worker: Worker) => {
    const index = workers.indexOf(worker)
    const n = workers.length || 1
    return (index - roundIndex + offset + n * 8) % n
  }
  const wasLast = (worker: Worker) =>
    historical.get(lane.id)?.workerIds.includes(worker.id) ? 1 : 0
  qualified.sort((a, b) => {
    const byVisits =
      visitCount(visits, a.id, lane.id) - visitCount(visits, b.id, lane.id)
    if (byVisits !== 0) return byVisits
    const byLast = wasLast(a) - wasLast(b)
    if (byLast !== 0) return byLast
    return rotated(a) - rotated(b)
  })
  return qualified[0] ?? null
}

export type AssignSelectorRoundsArgs = {
  shiftType: ShiftType
  lanes: Lane[]
  activeLaneIds: string[]
  workers: Worker[]
  overrides?: StaffingOverrides | null
  /** Per-shift peak hours overrides (flexible for special shifts). */
  peakHoursOverrides?: PeakHoursOverrides | null
  /** workerId → personal window preset id */
  workerWindows?: Record<string, string>
  /**
   * Night staff still on duty. They join only rounds that start before 06:00,
   * together with the 04:45 arrivals.
   */
  nightPartners?: Worker[]
  /** Override the built-in shift clock when the module defines its own window. */
  bounds?: { start: number; end: number }
  /** Length of one round, in minutes. Default is two hours. */
  roundMinutes?: number
  /** Exact [start … end] boundaries from org settings (selectors). */
  customBoundaries?: number[] | null
  /** Half the people rotate on the hour, half on the half-hour. */
  stagger?: boolean
  /** Late arrival / early leave. Existing placements are left in place. */
  windowAdjustments?: Record<string, WindowAdjustment>
  /**
   * Keep rounds that already finished. `existingRounds` supplies those cells.
   * The cutoff is in the same minute space as `round.endMinutes`.
   */
  existingRounds?: SelectorRound[]
  freezeBeforeMinutes?: number
  /** Saved boards used to see who sat each lane last. */
  history?: ShiftSchedule[]
  date?: string
  /** Names for people who sat a lane last but are absent today. */
  roster?: Worker[]
  /**
   * How many full board starts to compare (each with a different rotation seed).
   * Sync default stays small for freeze / window edits; the progress runner
   * uses DEFAULT_PROGRESS_SEARCH_STARTS (1000), same as single-mode assign.
   */
  searchStarts?: number
  /** Rotation seed for a single attempt (used by the async multi-start runner). */
  seedOffset?: number
}

export type AssignSelectorRoundsResult = {
  rounds: SelectorRound[]
  warnings: string[]
  unassignedWorkerIds: string[]
  explanations: PlacementExplanation[]
  searchStats?: { starts: number; evaluations: number }
}

type RoundsAttempt = {
  rounds: SelectorRound[]
  emptySeats: number
  repeatBlocks: number
  lastHits: number
  explanations: PlacementExplanation[]
  unassignedCount: number
}

function isRoundsAttemptBetter(next: RoundsAttempt, best: RoundsAttempt): boolean {
  if (next.emptySeats !== best.emptySeats) {
    return next.emptySeats < best.emptySeats
  }
  if (next.lastHits !== best.lastHits) {
    return next.lastHits < best.lastHits
  }
  if (next.unassignedCount !== best.unassignedCount) {
    return next.unassignedCount < best.unassignedCount
  }
  return next.repeatBlocks < best.repeatBlocks
}

function yieldForProgressUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

export function assignSelectorRounds(
  args: AssignSelectorRoundsArgs,
): AssignSelectorRoundsResult {
  const active = selectorLanes(args.lanes, args.activeLaneIds)
  const workers = [...args.workers].sort((a, b) =>
    a.fullName.localeCompare(b.fullName, 'he'),
  )
  const windows = buildAssignmentWindows(args)
  const warnings: string[] = []

  if (active.length === 0) {
    warnings.push('אין נתיבים לשיבוץ סלקטורים')
  }
  if (workers.length === 0) {
    warnings.push('אין סלקטורים נוכחים')
  }

  const earlyCutoff = onShiftClock(6 * 60, args.shiftType)
  const partners = (args.nightPartners ?? []).filter(
    (partner) => !workers.some((worker) => worker.id === partner.id),
  )
  const orderedIds = [...workers, ...partners].map((worker) => worker.id)
  const cohortOf = (workerId: string): RoundCohort =>
    orderedIds.indexOf(workerId) % 2 === 0 ? 'hour' : 'half'
  const names = new Map(
    [...(args.roster ?? []), ...workers, ...partners].map((worker) => [
      worker.id,
      worker.fullName,
    ]),
  )
  const historical = args.date
    ? buildLaneLastSeatings(
        args.history ?? [],
        args.date,
        args.shiftType,
        LAST_OCCUPANT_WINDOW_DAYS,
      )
    : new Map<string, LaneLastSeating>()

  const buildAttempt = (offset: number) => {
  const visits = new Map<string, Map<string, number>>()
  const prevLane = new Map<string, string>()
  let emptySeats = 0
  let repeatBlocks = 0
  let lastHits = 0
  const explanations: PlacementExplanation[] = []

  const rounds: SelectorRound[] = windows.map((w, roundIndex) => {
    const existing = (args.existingRounds ?? []).find(
      (round) => round.startMinutes === w.startMinutes,
    )
    const frozen =
      args.freezeBeforeMinutes != null &&
      existing != null &&
      w.endMinutes <= args.freezeBeforeMinutes
    if (frozen) {
      const nextPrev = new Map<string, string>()
      for (const assignment of existing.assignments) {
        for (const workerId of assignment.workerIds) {
          if (!workerId) continue
          bumpVisit(visits, workerId, assignment.laneId)
          nextPrev.set(workerId, assignment.laneId)
        }
      }
      if (!args.stagger) prevLane.clear()
      for (const [id, laneId] of nextPrev) prevLane.set(id, laneId)
      return {
        ...w,
        cohort: existing.cohort,
        assignments: existing.assignments.map((assignment) => ({
          ...assignment,
          workerIds: [...assignment.workerIds],
        })),
      }
    }
    const used = new Set<string>()
    const nextPrev = new Map<string, string>()
    const pool =
      w.startMinutes < earlyCutoff ? [...workers, ...partners] : workers
    
    // Count available workers and active lanes for peak hours check
    const availableWorkers = pool.length
    const activeLanesCount = active.filter((lane) => 
      laneOpenDuring(lane.activeHours, w.startMinutes, w.endMinutes)
    ).length
    
    const assignments = active.map((lane) => {
      const open = laneOpenDuring(
        lane.activeHours,
        w.startMinutes,
        w.endMinutes,
      )
      const std = open
        ? effectiveStaffingStandardAtTime(lane, w.startMinutes, {
            staffingOverrides: args.overrides ?? undefined,
            peakHoursOverrides: args.peakHoursOverrides ?? undefined,
            availableWorkers,
            totalLanes: activeLanesCount,
          })
        : 0
      const workerIds: string[] = []
      for (let slot = 0; slot < std; slot++) {
        const eligible = pool.filter((worker) => {
          if (args.stagger && w.cohort && cohortOf(worker.id) !== w.cohort) {
            return false
          }
          return (
            windowCoversRound(
              args.workerWindows?.[worker.id],
              args.shiftType,
              w.startMinutes,
              w.endMinutes,
              args.windowAdjustments?.[worker.id],
            ) || partners.some((partner) => partner.id === worker.id)
          )
        })
        const pick = pickWorker(
          lane,
          eligible,
          used,
          prevLane,
          visits,
          roundIndex,
          historical,
          offset,
        )
        if (!pick) {
          workerIds.push('')
          emptySeats += 1
          const blocked = eligible.some(
            (worker) =>
              !used.has(worker.id) &&
              isQualified(worker, lane) &&
              prevLane.get(worker.id) === lane.id,
          )
          if (blocked) repeatBlocks += 1
          continue
        }
        used.add(pick.id)
        workerIds.push(pick.id)
        bumpVisit(visits, pick.id, lane.id)
        nextPrev.set(pick.id, lane.id)
        const seating = historical.get(lane.id)
        if (seating?.workerIds.includes(pick.id)) lastHits += 1
        const lastNames = (seating?.workerIds ?? [])
          .map((id) => names.get(id) ?? 'מי ששובץ אז')
          .join(' ו')
        const matched = seating?.workerIds.includes(pick.id) ?? false
        explanations.push({
          laneId: lane.id,
          workerId: pick.id,
          reasons: [
            `סבב ${w.label}: נבדק מי ישב אחרון ב«${lane.name}», וגם שהאדם לא חוזר על הנתיב של הסבב הקודם.`,
            seating
              ? matched
                ? `האחרון בנתיב היה ${lastNames}. ${pick.fullName} הוא אותו אדם, ושובץ כי לא נשאר מועמד אחר בלי רצף באותו נתיב.`
                : `האחרון בנתיב היה ${lastNames}. ${pick.fullName} אינו אותו אדם, ולכן הועדף.`
              : `אין שיבוץ קודם שמור ל«${lane.name}» ב־${LAST_OCCUPANT_WINDOW_DAYS} הימים האחרונים.`,
            `בסבבים של המשמרת הזו ישב/ה בנתיב ${visitCount(visits, pick.id, lane.id)} פעמים עד הסבב הזה, כולל אותו.`,
          ],
        })
      }
      return { laneId: lane.id, workerIds }
    })
    if (!args.stagger) prevLane.clear()
    for (const [id, laneId] of nextPrev) prevLane.set(id, laneId)
    return { ...w, assignments }
  })

    const placedIds = placedSelectorIds(rounds)
    return {
      rounds,
      emptySeats,
      repeatBlocks,
      lastHits,
      explanations,
      unassignedCount: workers.filter((w) => !placedIds.includes(w.id)).length,
    }
  }

  const attempts = Math.max(
    1,
    args.searchStarts ?? Math.min(8, Math.max(1, workers.length)),
  )
  const seedBase = args.seedOffset ?? 0
  let best = buildAttempt(seedBase)
  for (let offset = 1; offset < attempts; offset += 1) {
    const next = buildAttempt(seedBase + offset)
    if (isRoundsAttemptBetter(next, best)) best = next
  }

  return finalizeRoundsResult({
    best,
    workers,
    activeLength: active.length,
    attempts,
    warnings,
  })
}

function finalizeRoundsResult(input: {
  best: RoundsAttempt
  workers: Worker[]
  activeLength: number
  attempts: number
  warnings: string[]
}): AssignSelectorRoundsResult {
  const { best, workers, activeLength, attempts } = input
  const warnings = [...input.warnings]
  const { rounds, explanations } = best

  if (best.repeatBlocks > 0) {
    warnings.push('נחסם רצף של אותו נתיב בשני סבבים צמודים')
  }

  if (best.emptySeats > 0 && workers.length > 0 && activeLength > 0) {
    warnings.push(
      `נותרו ${best.emptySeats} מקומות ריקים בסבבים — אין מספיק סלקטורים מוסמכים לכל הנתיבים`,
    )
  }

  const placed = new Set(placedSelectorIds(rounds))
  const unassignedWorkerIds = workers
    .map((w) => w.id)
    .filter((id) => !placed.has(id))

  if (unassignedWorkerIds.length > 0 && activeLength > 0) {
    warnings.push(`${unassignedWorkerIds.length} סלקטורים לא נכנסו לאף סבב`)
  }

  if (attempts > 1) {
    warnings.push(
      `נבדקו ${attempts} סידורי סבבים ב־${attempts} התחלות, והשיבוץ שנבחר ממלא יותר מושבים וחוזר פחות למי שישבו אחרונים בנתיב`,
    )
  }

  return {
    rounds,
    warnings,
    unassignedWorkerIds,
    explanations,
    searchStats: { starts: attempts, evaluations: attempts },
  }
}

/**
 * Async multi-start runner for rounds — same budget as single-mode assign
 * (DEFAULT_PROGRESS_SEARCH_STARTS = 1000), with UI progress ticks.
 */
export async function assignSelectorRoundsWithProgress(
  args: AssignSelectorRoundsArgs,
  options?: {
    searchStarts?: number
    onProgress?: (progress: AssignmentProgress) => void
    yieldToUi?: () => Promise<void>
  },
): Promise<AssignSelectorRoundsResult> {
  const starts = Math.max(
    1,
    options?.searchStarts ?? DEFAULT_PROGRESS_SEARCH_STARTS,
  )
  const yieldToUi = options?.yieldToUi ?? yieldForProgressUi
  const report = (percent: number, done: number, evaluations: number) => {
    options?.onProgress?.({
      percent,
      startsDone: done,
      startsTotal: starts,
      evaluations,
    })
  }

  if (starts === 1) {
    const single = assignSelectorRounds({ ...args, searchStarts: 1, seedOffset: 0 })
    report(100, 1, 1)
    return single
  }

  await yieldToUi()
  let best: AssignSelectorRoundsResult | null = null
  let bestMeta: RoundsAttempt | null = null

  for (let i = 0; i < starts; i += 1) {
    const candidate = assignSelectorRounds({
      ...args,
      searchStarts: 1,
      seedOffset: i,
    })
    const meta: RoundsAttempt = {
      rounds: candidate.rounds,
      emptySeats: countEmptySeats(candidate.rounds),
      repeatBlocks: candidate.warnings.some((w) => w.includes('נחסם רצף'))
        ? 1
        : 0,
      lastHits: countLastHits(candidate.rounds, args),
      explanations: candidate.explanations,
      unassignedCount: candidate.unassignedWorkerIds.length,
    }
    if (!best || !bestMeta || isRoundsAttemptBetter(meta, bestMeta)) {
      best = candidate
      bestMeta = meta
    }
    report(Math.round(((i + 1) / starts) * 100), i + 1, i + 1)
    await yieldToUi()
  }

  if (!best || !bestMeta) {
    return assignSelectorRounds({ ...args, searchStarts: 1 })
  }

  const baseWarnings = best.warnings.filter((w) => !w.startsWith('נבדקו '))
  const checkNote = `נבדקו ${starts} לוחות סבבים ב־${starts} התחלות לפני שהשיבוץ הוצג`
  return {
    ...best,
    warnings: baseWarnings.includes(checkNote)
      ? baseWarnings
      : [...baseWarnings, checkNote],
    searchStats: { starts, evaluations: starts },
  }
}

function countEmptySeats(rounds: SelectorRound[]): number {
  let empty = 0
  for (const round of rounds) {
    for (const assignment of round.assignments) {
      for (const id of assignment.workerIds) {
        if (!id) empty += 1
      }
    }
  }
  return empty
}

function countLastHits(
  rounds: SelectorRound[],
  args: AssignSelectorRoundsArgs,
): number {
  if (!args.date) return 0
  const historical = buildLaneLastSeatings(
    args.history ?? [],
    args.date,
    args.shiftType,
    LAST_OCCUPANT_WINDOW_DAYS,
  )
  let hits = 0
  for (const round of rounds) {
    for (const assignment of round.assignments) {
      const seating = historical.get(assignment.laneId)
      if (!seating) continue
      for (const workerId of assignment.workerIds) {
        if (workerId && seating.workerIds.includes(workerId)) hits += 1
      }
    }
  }
  return hits
}

export function unassignedSelectorIds(
  presentWorkerIds: string[],
  rounds: SelectorRound[],
  gateManagerWorkerId?: string | null,
): string[] {
  const placed = new Set(placedSelectorIds(rounds))
  const gate = gateManagerWorkerId?.trim() || ''
  return presentWorkerIds.filter((id) => id && id !== gate && !placed.has(id))
}

const EMPTY_SEATS_WARNING = /^נותרו \d+ מקומות ריקים בסבבים/

/** Clear people from rounds that sit outside a lane's activity hours. */
export function applyLaneActivityHours(
  rounds: SelectorRound[],
  lanes: Lane[],
  warnings: string[],
  overrides?: StaffingOverrides | null,
  peakHoursOverrides?: PeakHoursOverrides | null,
  availableWorkers?: number,
): { rounds: SelectorRound[]; warnings: string[]; changed: boolean } {
  const byId = new Map(lanes.map((lane) => [lane.id, lane]))
  let cleared = false
  let emptySeats = 0
  const nextRounds = rounds.map((round) => ({
    ...round,
    assignments: round.assignments.map((assignment) => {
      const lane = byId.get(assignment.laneId)
      const open =
        !lane ||
        (!lane.roundsDisabled && laneOpenDuring(
          lane.activeHours,
          round.startMinutes,
          round.endMinutes,
        ))
      if (!open) {
        if (assignment.workerIds.some(Boolean)) {
          cleared = true
          return { ...assignment, workerIds: [] }
        }
        return assignment
      }
      if (!lane || lane.roundsDisabled) return assignment
      
      // Count active lanes for this round
      const activeLanesInRound = round.assignments.filter((a) => {
        const l = byId.get(a.laneId)
        return l && !l.roundsDisabled && laneOpenDuring(l.activeHours, round.startMinutes, round.endMinutes)
      }).length
      
      const standard = effectiveStaffingStandardAtTime(lane, round.startMinutes, {
        staffingOverrides: overrides ?? undefined,
        peakHoursOverrides: peakHoursOverrides ?? undefined,
        availableWorkers,
        totalLanes: activeLanesInRound,
      })
      const filled = assignment.workerIds.filter(Boolean).length
      if (filled < standard) emptySeats += standard - filled
      return assignment
    }),
  }))
  const kept = warnings.filter((warning) => !EMPTY_SEATS_WARNING.test(warning))
  const nextWarnings =
    emptySeats > 0
      ? [
          ...kept,
          `נותרו ${emptySeats} מקומות ריקים בסבבים — אין מספיק סלקטורים מוסמכים לכל הנתיבים`,
        ]
      : kept
  const warningsChanged =
    nextWarnings.length !== warnings.length ||
    nextWarnings.some((warning, index) => warning !== warnings[index])
  if (!cleared && !warningsChanged) {
    return { rounds, warnings, changed: false }
  }
  return {
    rounds: cleared ? nextRounds : rounds,
    warnings: nextWarnings,
    changed: true,
  }
}
