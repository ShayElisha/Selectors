import { officialShiftInterval, workerShiftInterval } from './workerShiftStatus'
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
  | 'workerWindowPresets'
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

  const official = officialShiftInterval(shift, models)
  // Future shifts are not live yet; after the official end the board is a
  // finished roster — do not treat everyone as "ended mid-shift".
  const shiftHasStarted = official != null && now >= official.start
  const shiftStillOpen = official != null && now < official.end
  const trackLiveEnds = shiftHasStarted && shiftStillOpen

  const activeIds = new Set<string>()
  const endedIds = new Set<string>()
  const currentShiftEndedIds = new Set<string>()
  const activeSources = new Map<string, string>()

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
        // Neighboring/history coverage still tracks ended people; the open
        // board only flags mid-shift leavers while THIS shift is live.
        endedIds.add(workerId)
        if (
          trackLiveEnds &&
          candidate.id === shift.id &&
          (official == null || interval.end < official.end)
        ) {
          currentShiftEndedIds.add(workerId)
        }
      } else if (activeAssignedIds.has(workerId)) {
        activeIds.add(workerId)
        if (!activeSources.has(workerId)) {
          activeSources.set(workerId, candidate.id)
        }
      }
    }
  }

  // After the official shift ends, keep seated people looking active so the
  // finished board stays a normal roster (edits/swaps still allowed).
  if (!shiftStillOpen) {
    currentShiftEndedIds.clear()
    for (const workerId of allLaneWorkerIds(shift, lane.id)) {
      if (
        !shift.presentWorkerIds.includes(workerId) ||
        (shift.gateManagerWorkerId === workerId && !isGateManagerLane(lane)) ||
        shift.shiftDrops?.some(
          (drop) =>
            drop.workerId === workerId &&
            (drop.kind === 'cancel' || drop.kind === 'noshow'),
        )
      ) {
        continue
      }
      activeIds.add(workerId)
      if (!activeSources.has(workerId)) {
        activeSources.set(workerId, shift.id)
      }
      endedIds.delete(workerId)
    }
  }

  for (const workerId of activeIds) {
    endedIds.delete(workerId)
    currentShiftEndedIds.delete(workerId)
  }
  // Manual reopen only cares about ends on THIS shift — neighboring days
  // must not keep tomorrow's lanes looking "auto-closed".
  let latestCurrentEndedAt = 0
  for (const workerId of currentShiftEndedIds) {
    const interval = workerShiftInterval(shift, workerId, models, presets)
    if (interval) latestCurrentEndedAt = Math.max(latestCurrentEndedAt, interval.end)
  }
  const reopenedAt = shift.laneReopenedAt?.[lane.id]
  const reopenedTimestamp = reopenedAt ? new Date(reopenedAt).getTime() : NaN
  const manuallyReopened =
    Number.isFinite(reopenedTimestamp) &&
    latestCurrentEndedAt > 0 &&
    reopenedTimestamp >= latestCurrentEndedAt
  const missing = Math.max(0, required - activeIds.size)
  // Auto-close is live-only: someone finished mid-shift and staffing dropped.
  const autoClosed =
    trackLiveEnds &&
    currentShiftEndedIds.size > 0 &&
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
