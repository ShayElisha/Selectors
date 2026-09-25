import { isQualified } from '../algorithm'
import type {
  Lane,
  LaneAssignment,
  SelectorRound,
  ShiftType,
  Worker,
} from '../types'
import { isGateManagerLane } from './gateManager'
import {
  effectiveStaffingStandard,
  type StaffingOverrides,
} from './shiftStaffing'

const ROUND_MINUTES = 120
/** A leftover shorter than this is folded into the previous round. */
const MIN_OWN_ROUND = 45

const SHIFT_BOUNDS: Record<ShiftType, { start: number; end: number }> = {
  morning: { start: 6 * 60, end: 14 * 60 + 30 },
  afternoon: { start: 14 * 60 + 30, end: 21 * 60 + 30 },
  night: { start: 21 * 60 + 30, end: 24 * 60 + 6 * 60 },
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

/**
 * Time rows for a selector board: every two hours from the shift start.
 * A leftover under 45 minutes is attached to the last full round.
 */
export function buildRoundWindows(
  shiftType: ShiftType,
): Pick<SelectorRound, 'startMinutes' | 'endMinutes' | 'label'>[] {
  const { start, end } = SHIFT_BOUNDS[shiftType]
  const windows: Pick<SelectorRound, 'startMinutes' | 'endMinutes' | 'label'>[] =
    []
  let t = start
  while (t < end) {
    const next = t + ROUND_MINUTES
    if (next >= end) {
      windows.push({
        startMinutes: t,
        endMinutes: end,
        label: roundLabel(t, end),
      })
      break
    }
    const leftover = end - next
    if (leftover > 0 && leftover < MIN_OWN_ROUND) {
      windows.push({
        startMinutes: t,
        endMinutes: end,
        label: roundLabel(t, end),
      })
      break
    }
    windows.push({
      startMinutes: t,
      endMinutes: next,
      label: roundLabel(t, next),
    })
    t = next
  }
  return windows
}

export function selectorLanes(lanes: Lane[], activeLaneIds: string[]): Lane[] {
  const byId = new Map(lanes.map((l) => [l.id, l]))
  const out: Lane[] = []
  for (const id of activeLaneIds) {
    const lane = byId.get(id)
    if (!lane || isGateManagerLane(lane)) continue
    out.push(lane)
  }
  return out
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
): SelectorRound[] {
  const active = selectorLanes(lanes, activeLaneIds)
  return buildRoundWindows(shiftType).map((w) => ({
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
): Worker | null {
  const qualified = workers.filter(
    (w) => !used.has(w.id) && isQualified(w, lane),
  )
  if (qualified.length === 0) return null
  const rotated = (worker: Worker) => {
    const index = workers.indexOf(worker)
    const n = workers.length || 1
    return (index - roundIndex + n * 8) % n
  }
  qualified.sort((a, b) => {
    const score = (w: Worker) => {
      const stayed = prevLane.get(w.id) === lane.id ? 1 : 0
      return stayed * 100 + visitCount(visits, w.id, lane.id)
    }
    const byScore = score(a) - score(b)
    if (byScore !== 0) return byScore
    return rotated(a) - rotated(b)
  })
  return qualified[0] ?? null
}

export function assignSelectorRounds(args: {
  shiftType: ShiftType
  lanes: Lane[]
  activeLaneIds: string[]
  workers: Worker[]
  overrides?: StaffingOverrides | null
}): { rounds: SelectorRound[]; warnings: string[]; unassignedWorkerIds: string[] } {
  const active = selectorLanes(args.lanes, args.activeLaneIds)
  const workers = [...args.workers].sort((a, b) =>
    a.fullName.localeCompare(b.fullName, 'he'),
  )
  const windows = buildRoundWindows(args.shiftType)
  const warnings: string[] = []

  if (active.length === 0) {
    warnings.push('אין נתיבים לשיבוץ סלקטורים')
  }
  if (workers.length === 0) {
    warnings.push('אין סלקטורים נוכחים')
  }

  const visits = new Map<string, Map<string, number>>()
  const prevLane = new Map<string, string>()
  let emptySeats = 0

  const rounds: SelectorRound[] = windows.map((w, roundIndex) => {
    const used = new Set<string>()
    const nextPrev = new Map<string, string>()
    const assignments = active.map((lane) => {
      const std = effectiveStaffingStandard(lane, args.overrides)
      const workerIds: string[] = []
      for (let slot = 0; slot < std; slot++) {
        const pick = pickWorker(
          lane,
          workers,
          used,
          prevLane,
          visits,
          roundIndex,
        )
        if (!pick) {
          workerIds.push('')
          emptySeats += 1
          continue
        }
        used.add(pick.id)
        workerIds.push(pick.id)
        bumpVisit(visits, pick.id, lane.id)
        nextPrev.set(pick.id, lane.id)
      }
      return { laneId: lane.id, workerIds }
    })
    for (const [id, laneId] of nextPrev) prevLane.set(id, laneId)
    return { ...w, assignments }
  })

  if (emptySeats > 0 && workers.length > 0 && active.length > 0) {
    warnings.push(
      `נותרו ${emptySeats} מקומות ריקים בסבבים — אין מספיק סלקטורים מוסמכים לכל הנתיבים`,
    )
  }

  const placed = new Set(placedSelectorIds(rounds))
  const unassignedWorkerIds = workers
    .map((w) => w.id)
    .filter((id) => !placed.has(id))

  if (unassignedWorkerIds.length > 0 && active.length > 0) {
    warnings.push(
      `${unassignedWorkerIds.length} סלקטורים לא נכנסו לאף סבב`,
    )
  }

  return { rounds, warnings, unassignedWorkerIds }
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
