import {
  buildLaneLastSeatings,
  buildWorkerProfile,
  isQualified,
  shiftBalanceDelta,
  sortCandidatesForLane,
} from '../algorithm'
import { isGateManagerLane } from './gateManager'
import { assignSelectorRounds } from './selectorRounds'
import { formatMinutes } from './shiftModels'
import type {
  Lane,
  LaneAssignment,
  SeatSegment,
  SelectorRound,
  ShiftChangeMove,
  ShiftSchedule,
  ShiftType,
  Worker,
  WindowAdjustment,
} from '../types'

export interface SelfHealPlan {
  removedWorkerId: string
  atMinutes: number
  presentWorkerIds: string[]
  gateManagerWorkerId?: string
  assignments: LaneAssignment[]
  rounds: SelectorRound[]
  frozenLaneIds: string[]
  seatSegments?: SeatSegment[]
  seatSpan?: { startMinutes: number; endMinutes: number }
  highlights: { laneId: string; roundIndex?: number; tone: 'filled' | 'frozen' }[]
  moves: ShiftChangeMove[]
  lines: string[]
  summary: string
  healed: boolean
}

export function clockOnShift(minutes: number, start: number, end: number): number {
  if (end > 24 * 60 && minutes < 12 * 60) return minutes + 24 * 60
  if (minutes < start && end > start && minutes < 12 * 60 && start >= 12 * 60) {
    return minutes + 24 * 60
  }
  return minutes
}

/** Where "now" sits inside this shift. Future shifts count from the start. */
export function removalMinute(args: {
  shiftDate: string
  startMinutes: number
  endMinutes: number
  now?: Date
}): number {
  const end =
    args.endMinutes <= args.startMinutes ? args.endMinutes + 24 * 60 : args.endMinutes
  const now = args.now ?? new Date()
  const today = localISODate(now)
  if (args.shiftDate > today) return args.startMinutes
  if (args.shiftDate < today) return end
  const clock = clockOnShift(now.getHours() * 60 + now.getMinutes(), args.startMinutes, end)
  return Math.min(end, Math.max(args.startMinutes, clock))
}

function localISODate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function lanePriority(lane: Lane): number {
  if (lane.afternoonHandoff) return 0
  if (lane.intensity === 'hard') return 1
  if (lane.intensity === 'medium') return 2
  return 3
}

function nameOf(workers: Worker[], id: string): string {
  return workers.find((worker) => worker.id === id)?.fullName ?? id
}

function loadLine(args: {
  name: string
  laneName: string
  from: number
  to: number
  span: number
  intensity: Lane['intensity']
  shiftType: ShiftType
}): string {
  const minutes = Math.max(0, args.to - args.from)
  const weight =
    shiftBalanceDelta(args.intensity, args.shiftType) * (minutes / Math.max(1, args.span))
  const rounded = Math.round(weight * 100) / 100
  return `${args.name} – ${args.laneName} [${formatMinutes(args.from)}–${formatMinutes(args.to)}] | משקל עומס: ${rounded.toFixed(2)}`
}

function copyAssignments(rows: LaneAssignment[]): LaneAssignment[] {
  return rows.map((row) => ({ ...row, workerIds: [...row.workerIds] }))
}

function clearWorker(rows: LaneAssignment[], workerId: string): LaneAssignment[] {
  return rows.map((row) => ({
    ...row,
    workerIds: row.workerIds.map((id) => (id === workerId ? '' : id)),
  }))
}

function setSeat(
  rows: LaneAssignment[],
  laneId: string,
  slotIndex: number,
  workerId: string,
): LaneAssignment[] {
  return rows.map((row) => {
    if (row.laneId !== laneId) return row
    const workerIds = [...row.workerIds]
    while (workerIds.length <= slotIndex) workerIds.push('')
    workerIds[slotIndex] = workerId
    return { ...row, workerIds }
  })
}

function firstEmpty(row: LaneAssignment | undefined, workerGone: string): number {
  const ids = row?.workerIds ?? []
  const index = ids.findIndex((id) => !id || id === workerGone)
  return index === -1 ? ids.length : index
}

export function planRemoval(args: {
  draft: {
    date: string
    shiftType: ShiftType
    presentWorkerIds: string[]
    gateManagerWorkerId?: string
    assignments: LaneAssignment[]
    rounds: SelectorRound[]
    activeLaneIds: string[]
    frozenLaneIds?: string[]
    staffingOverrides?: ShiftSchedule['staffingOverrides']
    workerWindows?: Record<string, string>
    windowAdjustments?: Record<string, WindowAdjustment>
    staggerRounds?: boolean
    assignmentMode?: ShiftSchedule['assignmentMode']
    audience?: ShiftSchedule['audience']
  }
  workerId: string
  workers: Worker[]
  lanes: Lane[]
  history: ShiftSchedule[]
  startMinutes: number
  endMinutes: number
  atMinutes: number
  rounds?: boolean
  roundMinutes?: number
  bounds?: { start: number; end: number }
}): { healed: SelfHealPlan; manual: SelfHealPlan } {
  const healed = args.rounds
    ? planRoundRemoval(args, true)
    : planLaneRemoval(args, true)
  const manual = args.rounds
    ? planRoundRemoval(args, false)
    : planLaneRemoval(args, false)
  return { healed, manual }
}

function basePlan(
  args: Parameters<typeof planRemoval>[0],
  presentWorkerIds: string[],
): Pick<
  SelfHealPlan,
  | 'removedWorkerId'
  | 'atMinutes'
  | 'presentWorkerIds'
  | 'gateManagerWorkerId'
  | 'moves'
  | 'highlights'
  | 'lines'
  | 'frozenLaneIds'
> {
  return {
    removedWorkerId: args.workerId,
    atMinutes: args.atMinutes,
    presentWorkerIds,
    gateManagerWorkerId:
      args.draft.gateManagerWorkerId === args.workerId
        ? undefined
        : args.draft.gateManagerWorkerId,
    moves: [],
    highlights: [],
    lines: [],
    frozenLaneIds: [...(args.draft.frozenLaneIds ?? [])],
  }
}

function planLaneRemoval(
  args: Parameters<typeof planRemoval>[0],
  refill: boolean,
): SelfHealPlan {
  const leaving = args.workers.find((worker) => worker.id === args.workerId)
  const presentWorkerIds = args.draft.presentWorkerIds.filter((id) => id !== args.workerId)
  const plan = basePlan(args, presentWorkerIds)
  let assignments = clearWorker(copyAssignments(args.draft.assignments ?? []), args.workerId)
  const laneById = new Map(args.lanes.map((lane) => [lane.id, lane]))
  const vacated = (args.draft.assignments ?? []).flatMap((row) =>
    row.workerIds
      .map((id, slotIndex) => ({ id, slotIndex, laneId: row.laneId }))
      .filter((seat) => seat.id === args.workerId),
  )
  vacated.sort((a, b) => {
    const laneA = laneById.get(a.laneId)
    const laneB = laneById.get(b.laneId)
    return lanePriority(laneA ?? { intensity: 'easy' } as Lane) -
      lanePriority(laneB ?? { intensity: 'easy' } as Lane)
  })

  const profiles = new Map(
    presentWorkerIds.map((id) => [
      id,
      buildWorkerProfile(id, args.history, args.lanes, args.draft.shiftType, args.draft.date),
    ]),
  )
  const lastSeatings = buildLaneLastSeatings(
    args.history,
    args.draft.date,
    args.draft.shiftType,
  )
  const end =
    args.endMinutes <= args.startMinutes ? args.endMinutes + 24 * 60 : args.endMinutes
  const span = Math.max(1, end - args.startMinutes)
  const segments: SeatSegment[] = []
  if (leaving && vacated.length > 0 && args.atMinutes > args.startMinutes) {
    const lane = laneById.get(vacated[0]!.laneId)
    if (lane) {
      segments.push({
        workerId: leaving.id,
        laneId: lane.id,
        fromMinutes: args.startMinutes,
        toMinutes: args.atMinutes,
      })
      plan.lines.push(
        loadLine({
          name: leaving.fullName,
          laneName: lane.name,
          from: args.startMinutes,
          to: args.atMinutes,
          span,
          intensity: lane.intensity,
          shiftType: args.draft.shiftType,
        }),
      )
    }
  }

  for (const seat of vacated) {
    const lane = laneById.get(seat.laneId)
    if (!lane || isGateManagerLane(lane)) continue
    if (!refill) {
      if (!plan.frozenLaneIds.includes(lane.id)) plan.frozenLaneIds.push(lane.id)
      plan.highlights.push({ laneId: lane.id, tone: 'frozen' })
      continue
    }
    const seated = new Set(assignments.flatMap((row) => row.workerIds.filter(Boolean)))
    const pool = args.workers.filter(
      (worker) =>
        presentWorkerIds.includes(worker.id) &&
        worker.status === 'active' &&
        !seated.has(worker.id) &&
        worker.id !== plan.gateManagerWorkerId &&
        isQualified(worker, lane),
    )
    const ranked = sortCandidatesForLane(pool, {
      lane,
      profiles,
      otherOpen: [],
      currentShiftType: args.draft.shiftType,
      morning: null,
      recoveringIds: new Set(),
      lastSeatings,
    })
    let chosen = ranked[0]
    let fromLaneId: string | null = null
    if (!chosen && (lane.intensity === 'hard' || lane.afternoonHandoff)) {
      const donors: Worker[] = []
      for (const row of assignments) {
        const source = laneById.get(row.laneId)
        if (!source || source.intensity !== 'easy' || source.afternoonHandoff) continue
        if (isGateManagerLane(source)) continue
        for (const id of row.workerIds) {
          if (!id) continue
          const worker = args.workers.find((item) => item.id === id)
          if (worker && isQualified(worker, lane)) donors.push(worker)
        }
      }
      const rankedDonors = sortCandidatesForLane(donors, {
        lane,
        profiles,
        otherOpen: [],
        currentShiftType: args.draft.shiftType,
        morning: null,
        lastSeatings,
        recoveringIds: new Set(),
      })
      chosen = rankedDonors[0]
      if (chosen) {
        const sourceRow = assignments.find((row) => row.workerIds.includes(chosen!.id))
        fromLaneId = sourceRow?.laneId ?? null
        if (fromLaneId) {
          assignments = clearWorker(assignments, chosen.id)
          const source = laneById.get(fromLaneId)
          const still = assignments
            .find((row) => row.laneId === fromLaneId)
            ?.workerIds.some(Boolean)
          if (source && !still && !plan.frozenLaneIds.includes(fromLaneId)) {
            plan.frozenLaneIds.push(fromLaneId)
            plan.highlights.push({ laneId: fromLaneId, tone: 'frozen' })
          }
        }
      }
    }
    if (!chosen) {
      if (!plan.frozenLaneIds.includes(lane.id)) plan.frozenLaneIds.push(lane.id)
      plan.highlights.push({ laneId: lane.id, tone: 'frozen' })
      continue
    }
    const slot = firstEmpty(
      assignments.find((row) => row.laneId === seat.laneId),
      '',
    )
    assignments = setSeat(assignments, seat.laneId, slot === -1 ? seat.slotIndex : slot, chosen.id)
    plan.moves.push({ workerId: chosen.id, fromLaneId, toLaneId: seat.laneId })
    plan.highlights.push({ laneId: seat.laneId, tone: 'filled' })
    if (fromLaneId && args.atMinutes > args.startMinutes) {
      segments.push({
        workerId: chosen.id,
        laneId: fromLaneId,
        fromMinutes: args.startMinutes,
        toMinutes: args.atMinutes,
      })
    }
    segments.push({
      workerId: chosen.id,
      laneId: seat.laneId,
      fromMinutes: args.atMinutes,
      toMinutes: end,
    })
    plan.lines.push(
      loadLine({
        name: nameOf(args.workers, chosen.id),
        laneName: lane.name,
        from: args.atMinutes,
        to: end,
        span,
        intensity: lane.intensity,
        shiftType: args.draft.shiftType,
      }),
    )
  }

  const summary = plan.moves.length
    ? `הוצא ${nameOf(args.workers, args.workerId)}. הנתיב אויש מחדש.`
    : vacated.length
      ? `הוצא ${nameOf(args.workers, args.workerId)}. לא נמצא מחליף, והנתיב סומן כמוקפא.`
      : `הוצא ${nameOf(args.workers, args.workerId)} מהנוכחות.`
  return {
    ...plan,
    assignments,
    rounds: args.draft.rounds,
    seatSegments: segments.length ? segments : undefined,
    seatSpan: segments.length
      ? { startMinutes: args.startMinutes, endMinutes: end }
      : undefined,
    summary,
    healed: plan.moves.length > 0,
  }
}

function planRoundRemoval(
  args: Parameters<typeof planRemoval>[0],
  refill: boolean,
): SelfHealPlan {
  const presentWorkerIds = args.draft.presentWorkerIds.filter((id) => id !== args.workerId)
  const plan = basePlan(args, presentWorkerIds)
  const staff = args.workers.filter(
    (worker) =>
      presentWorkerIds.includes(worker.id) && worker.id !== plan.gateManagerWorkerId,
  )
  const rounds = refill
    ? assignSelectorRounds({
        shiftType: args.draft.shiftType,
        lanes: args.lanes,
        activeLaneIds: args.draft.activeLaneIds,
        workers: staff,
        overrides: args.draft.staffingOverrides,
        workerWindows: args.draft.workerWindows,
        bounds: args.bounds,
        roundMinutes: args.roundMinutes,
        stagger: args.draft.staggerRounds,
        windowAdjustments: args.draft.windowAdjustments,
        existingRounds: args.draft.rounds,
        freezeBeforeMinutes: args.atMinutes,
        history: args.history,
        date: args.draft.date,
        roster: args.workers,
      }).rounds
    : (args.draft.rounds ?? []).map((round) =>
        round.endMinutes <= args.atMinutes
          ? round
          : {
              ...round,
              assignments: round.assignments.map((row) => ({
                ...row,
                workerIds: row.workerIds.map((id) => (id === args.workerId ? '' : id)),
              })),
            },
      )
  for (const round of rounds) {
    const previous = (args.draft.rounds ?? []).find((item) => item.startMinutes === round.startMinutes)
    if (!previous || round.endMinutes <= args.atMinutes) continue
    for (const row of round.assignments) {
      const before = previous.assignments.find((item) => item.laneId === row.laneId)
      const nextIds = row.workerIds.filter(Boolean).join(',')
      const prevIds = (before?.workerIds ?? []).filter(Boolean).join(',')
      if (nextIds !== prevIds) {
        plan.highlights.push({
          laneId: row.laneId,
          roundIndex: rounds.indexOf(round),
          tone: nextIds ? 'filled' : 'frozen',
        })
      }
    }
  }
  const leaver = nameOf(args.workers, args.workerId)
  const summary = refill
    ? `הוצא ${leaver}. הסבבים מהשעה הזו ואילך חושבו מחדש. סבבים שנגמרו נשארו כמו שהיו.`
    : `הוצא ${leaver} מהסבבים שטרם נגמרו. הסבבים שנגמרו נשארו כמו שהיו.`
  return {
    ...plan,
    assignments: args.draft.assignments,
    rounds,
    summary,
    lines: [summary],
    healed: refill,
  }
}
