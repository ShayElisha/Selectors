import { workerShiftInterval } from './workerShiftStatus'
import { effectiveStaffingStandard } from './shiftStaffing'
import { isGateManagerLane } from './gateManager'
import type {
  Lane,
  ShiftModel,
  ShiftSchedule,
  StaffingStandard,
  WorkerWindowPreset,
} from '../types'

export type LaneLiveStatus = {
  activeWorkerIds: string[]
  activeWorkerSources: { workerId: string; shiftId: string }[]
  endedWorkerIds: string[]
  currentShiftEndedWorkerIds: string[]
  required: StaffingStandard
  missing: number
  autoClosed: boolean
  manuallyReopened: boolean
}

type LiveShift = Pick<
  ShiftSchedule,
  | 'id'
  | 'date'
  | 'shiftType'
  | 'audience'
  | 'activeLaneIds'
  | 'presentWorkerIds'
  | 'assignments'
  | 'rounds'
  | 'gateManagerWorkerId'
  | 'staffingOverrides'
  | 'workerWindows'
  | 'windowAdjustments'
  | 'earlyLeaveAt'
  | 'shiftDrops'
  | 'laneReopenedAt'
>

function roundContains(
  round: NonNullable<ShiftSchedule['rounds']>[number],
  minutes: number,
): boolean {
  return round.endMinutes > round.startMinutes
    ? minutes >= round.startMinutes && minutes < round.endMinutes
    : minutes >= round.startMinutes || minutes < round.endMinutes
}

function assignmentsAt(
  shift: LiveShift,
  laneId: string,
  minutes: number,
) {
  if (shift.rounds?.length) {
    return shift.rounds
      .filter((round) => roundContains(round, minutes))
      .flatMap((round) => round.assignments)
      .filter((assignment) => assignment.laneId === laneId)
  }
  return shift.assignments.filter((assignment) => assignment.laneId === laneId)
}

function allLaneWorkerIds(shift: LiveShift, laneId: string): string[] {
  const rows = shift.rounds?.length
    ? shift.rounds.flatMap((round) => round.assignments)
    : shift.assignments
  return [
    ...new Set(
      rows
        .filter((assignment) => assignment.laneId === laneId)
        .flatMap((assignment) => assignment.workerIds)
        .filter(Boolean),
    ),
  ]
}

function normalizedAudience(
  shift: Pick<ShiftSchedule, 'audience'>,
): string {
  return shift.audience ?? 'inspector'
}

function shiftDateDistance(left: string, right: string): number {
  const toUtcDay = (date: string) => {
    const [year, month, day] = date.split('-').map(Number)
    if (![year, month, day].every(Number.isFinite)) return NaN
    return Date.UTC(year!, month! - 1, day!)
  }
  const leftDay = toUtcDay(left)
  const rightDay = toUtcDay(right)
  if (!Number.isFinite(leftDay) || !Number.isFinite(rightDay)) {
    return Number.POSITIVE_INFINITY
  }
  return Math.abs(leftDay - rightDay) / (24 * 60 * 60_000)
}

export function laneLiveStatus(args: {
  shift: LiveShift
  history: ShiftSchedule[]
  lane: Lane
  models: ShiftModel[]
  presets: WorkerWindowPreset[]
  now?: number
}): LaneLiveStatus {
  const { shift, history, lane, models, presets } = args
  const now = args.now ?? Date.now()
  const minute = new Date(now).getHours() * 60 + new Date(now).getMinutes()
  const required = effectiveStaffingStandard(lane, shift.staffingOverrides)
  const candidates = [
    shift,
    ...history.filter(
      (item) =>
        item.id !== shift.id &&
        shiftDateDistance(item.date, shift.date) <= 1 &&
        normalizedAudience(item) === normalizedAudience(shift) &&
        item.activeLaneIds.includes(lane.id),
    ),
  ].filter(
    (item, index, list) =>
      list.findIndex((candidate) => candidate.id === item.id) === index,
  )

  const activeIds = new Set<string>()
  const endedIds = new Set<string>()
  const currentShiftEndedIds = new Set<string>()
  const activeSources = new Map<string, string>()
  let latestEndedAt = 0

  for (const candidate of candidates) {
    const activeAssignments = assignmentsAt(candidate, lane.id, minute)
    const activeAssignedIds = new Set(
      activeAssignments.flatMap((assignment) => assignment.workerIds).filter(Boolean),
    )
    for (const workerId of allLaneWorkerIds(candidate, lane.id)) {
      if (
        !candidate.presentWorkerIds.includes(workerId) ||
        (candidate.gateManagerWorkerId === workerId &&
          !isGateManagerLane(lane)) ||
        candidate.shiftDrops?.some(
          (drop) =>
            drop.workerId === workerId &&
            (drop.kind === 'cancel' || drop.kind === 'noshow'),
        )
      ) {
        continue
      }
      const interval = workerShiftInterval(
        candidate,
        workerId,
        models,
        presets,
      )
      if (!interval || interval.start > now) continue
      if (interval.end <= now) {
        endedIds.add(workerId)
        if (candidate.id === shift.id) currentShiftEndedIds.add(workerId)
        latestEndedAt = Math.max(latestEndedAt, interval.end)
      } else if (activeAssignedIds.has(workerId)) {
        activeIds.add(workerId)
        if (!activeSources.has(workerId)) {
          activeSources.set(workerId, candidate.id)
        }
      }
    }
  }

  for (const workerId of activeIds) {
    endedIds.delete(workerId)
    currentShiftEndedIds.delete(workerId)
  }
  const reopenedAt = shift.laneReopenedAt?.[lane.id]
  const reopenedTimestamp = reopenedAt ? new Date(reopenedAt).getTime() : NaN
  const manuallyReopened =
    Number.isFinite(reopenedTimestamp) &&
    latestEndedAt > 0 &&
    reopenedTimestamp >= latestEndedAt
  const missing = Math.max(0, required - activeIds.size)
  const autoClosed =
    endedIds.size > 0 &&
    missing > 0 &&
    !manuallyReopened

  return {
    activeWorkerIds: [...activeIds],
    activeWorkerSources: [...activeSources].map(([workerId, shiftId]) => ({
      workerId,
      shiftId,
    })),
    endedWorkerIds: [...endedIds],
    currentShiftEndedWorkerIds: [...currentShiftEndedIds],
    required,
    missing,
    autoClosed,
    manuallyReopened,
  }
}
