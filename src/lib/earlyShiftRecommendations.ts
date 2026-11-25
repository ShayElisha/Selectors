import { isQualified } from '../algorithm'
import type {
  Lane,
  ShiftModel,
  ShiftSchedule,
  Worker,
  WorkerWindowPreset,
} from '../types'
import { effectiveStaffingStandard } from './shiftStaffing'
import {
  formatMinutes,
  shiftModelAbsoluteEnd,
} from './shiftModels'
import {
  MIN_PERSONAL_START_BEFORE_SHIFT_END,
  workerWindowById,
} from './shiftCatalog'

type EarlyShiftSource = Pick<
  ShiftSchedule,
  | 'id'
  | 'date'
  | 'shiftType'
  | 'audience'
  | 'presentWorkerIds'
  | 'assignments'
  | 'workerWindows'
  | 'workerWindowPresets'
  | 'windowAdjustments'
  | 'earlyLeaveAt'
  | 'signOff'
>

type CurrentShift = Pick<
  ShiftSchedule,
  | 'id'
  | 'date'
  | 'shiftType'
  | 'audience'
  | 'presentWorkerIds'
  | 'activeLaneIds'
  | 'assignments'
  | 'staffingOverrides'
  | 'frozenLaneIds'
  | 'workerWindows'
  | 'workerWindowPresets'
  | 'windowAdjustments'
  | 'earlyLeaveAt'
  | 'shiftDrops'
  | 'signOff'
>

export type EarlyShiftRecommendation = {
  workerId: string
  workerName: string
  sourceShiftType: string
  sourceShiftName: string
  startsAt: string
  /** Personal hours from the later shift (kept as-is; clipped when shown on current). */
  windowPreset: WorkerWindowPreset
  windowPresets: WorkerWindowPreset[]
  laneId?: string
  laneName?: string
}

function sameAudience(left: EarlyShiftSource, right: CurrentShift): boolean {
  return (left.audience ?? 'inspector') === (right.audience ?? 'inspector')
}

function catalogForShift(
  shift: Pick<EarlyShiftSource, 'workerWindowPresets'>,
  presets: WorkerWindowPreset[],
): WorkerWindowPreset[] {
  return [
    ...(shift.workerWindowPresets ?? []),
    ...presets.filter(
      (preset) =>
        !shift.workerWindowPresets?.some((local) => local.id === preset.id),
    ),
  ]
}

/** Clock-minute start of a personal window on the shift's calendar day. */
function personalStartMinutes(
  preset: WorkerWindowPreset,
  currentStartMinutes: number,
  sourceStartMinutes: number,
): number {
  let start = preset.start
  // Night windows that begin before midnight stay on the same calendar day.
  // If the preset start is after the later shift's official start, it does not
  // overlap the current shift as an early arrival.
  if (start < currentStartMinutes && sourceStartMinutes > currentStartMinutes) {
    start += 24 * 60
  }
  return start
}

function availableLaneForWorker(args: {
  current: CurrentShift
  source: EarlyShiftSource
  worker: Worker
  lanes: Lane[]
}): Lane | undefined {
  const sourceLaneId = args.source.assignments.find((assignment) =>
    assignment.workerIds.includes(args.worker.id),
  )?.laneId
  const lanesById = new Map(args.lanes.map((lane) => [lane.id, lane]))
  const assignedByLane = new Map(
    args.current.assignments.map((assignment) => [
      assignment.laneId,
      assignment.workerIds.filter(Boolean).length,
    ]),
  )
  const candidates = args.current.activeLaneIds.flatMap((laneId) => {
    const lane = lanesById.get(laneId)
    if (
      !lane ||
      lane.roundsDisabled ||
      args.current.frozenLaneIds?.includes(laneId) ||
      !isQualified(args.worker, lane)
    ) {
      return []
    }
    const openSeats =
      effectiveStaffingStandard(lane, args.current.staffingOverrides) -
      (assignedByLane.get(laneId) ?? 0)
    return openSeats > 0 ? [{ lane, openSeats }] : []
  })
  candidates.sort(
    (left, right) =>
      Number(right.lane.id === sourceLaneId) - Number(left.lane.id === sourceLaneId) ||
      (right.lane.requiredCertifications?.length ?? 0) -
        (left.lane.requiredCertifications?.length ?? 0) ||
      left.openSeats - right.openSeats,
  )
  return candidates[0]?.lane
}

/**
 * Suggest workers from a later same-day shift whose personal hours begin
 * during the current shift. Never auto-adds — manager opts in from the board.
 */
export function earlyShiftRecommendations(args: {
  current: CurrentShift
  history: ShiftSchedule[]
  workers: Worker[]
  lanes: Lane[]
  models: ShiftModel[]
  presets: WorkerWindowPreset[]
  now?: number
}): EarlyShiftRecommendation[] {
  if (args.current.signOff?.signedAt) return []
  const currentModel = args.models.find(
    (model) => model.id === args.current.shiftType,
  )
  if (!currentModel) return []

  const currentStartMinutes = currentModel.startMinutes
  const currentEndMinutes = shiftModelAbsoluteEnd(currentModel)
  const currentOrder = currentModel.order
  const sources = args.history
    .filter(
      (shift) =>
        shift.id !== args.current.id &&
        shift.date === args.current.date &&
        sameAudience(shift, args.current) &&
        !shift.signOff?.signedAt &&
        (args.models.find((model) => model.id === shift.shiftType)?.order ?? -1) >
          currentOrder,
    )
    .sort((left, right) => {
      const leftOrder =
        args.models.find((model) => model.id === left.shiftType)?.order ?? 0
      const rightOrder =
        args.models.find((model) => model.id === right.shiftType)?.order ?? 0
      return leftOrder - rightOrder || left.updatedAt.localeCompare(right.updatedAt)
    }) as EarlyShiftSource[]

  const workersById = new Map(args.workers.map((worker) => [worker.id, worker]))
  const seen = new Set(args.current.presentWorkerIds)
  const recommendations: EarlyShiftRecommendation[] = []

  for (const source of sources) {
    const sourceModel = args.models.find((model) => model.id === source.shiftType)
    if (!sourceModel) continue

    let sourceStartMinutes = sourceModel.startMinutes
    if (sourceStartMinutes <= currentStartMinutes) {
      sourceStartMinutes += 24 * 60
    }
    const handoffMinutes = Math.min(currentEndMinutes, sourceStartMinutes)
    if (handoffMinutes <= currentStartMinutes) continue

    const allPresets = catalogForShift(source, args.presets)

    for (const workerId of source.presentWorkerIds) {
      if (
        seen.has(workerId) ||
        args.current.shiftDrops?.some((drop) => drop.workerId === workerId)
      ) {
        continue
      }
      const worker = workersById.get(workerId)
      const windowId = source.workerWindows?.[workerId]
      if (!worker || worker.status !== 'active' || !worker.isInspector || !windowId) {
        continue
      }

      const sourcePreset = workerWindowById(windowId, allPresets)
      if (!sourcePreset) continue

      const start = personalStartMinutes(
        sourcePreset,
        currentStartMinutes,
        sourceStartMinutes,
      )
      // Early arrival: personal start falls inside the current shift, before
      // the later shift's official start (e.g. night at 18:30 during afternoon).
      // Also require more than an hour remaining until current shift end.
      if (start < currentStartMinutes || start >= handoffMinutes) continue
      if (currentEndMinutes - start <= MIN_PERSONAL_START_BEFORE_SHIFT_END) {
        continue
      }

      const startClock = start % (24 * 60)

      const lane = availableLaneForWorker({
        current: args.current,
        source,
        worker,
        lanes: args.lanes,
      })
      recommendations.push({
        workerId,
        workerName: worker.fullName,
        sourceShiftType: source.shiftType,
        sourceShiftName: sourceModel.name,
        startsAt: formatMinutes(startClock),
        // Keep the later shift's personal hours; display/seat logic clips to current.
        windowPreset: sourcePreset,
        windowPresets: allPresets,
        ...(lane ? { laneId: lane.id, laneName: lane.name } : {}),
      })
      seen.add(workerId)
    }
  }

  return recommendations
}
