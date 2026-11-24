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
import { workerWindowIdFromTimes } from './shiftCatalog'
import { workerShiftInterval } from './workerShiftStatus'

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
  windowPreset: WorkerWindowPreset
  windowPresets: WorkerWindowPreset[]
  laneId?: string
  laneName?: string
}

function localDayStart(date: string): number | null {
  const [year, month, day] = date.split('-').map(Number)
  if (![year, month, day].every(Number.isFinite)) return null
  const timestamp = new Date(year!, month! - 1, day!).getTime()
  return Number.isFinite(timestamp) ? timestamp : null
}

function sameAudience(left: EarlyShiftSource, right: CurrentShift): boolean {
  return (left.audience ?? 'inspector') === (right.audience ?? 'inspector')
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

/** Find workers scheduled for a later shift whose personal hours begin in this shift. */
export function earlyShiftRecommendations(args: {
  current: CurrentShift
  history: ShiftSchedule[]
  workers: Worker[]
  lanes: Lane[]
  models: ShiftModel[]
  presets: WorkerWindowPreset[]
  now?: number
}): EarlyShiftRecommendation[] {
  const now = args.now ?? Date.now()
  if (args.current.signOff?.signedAt) return []
  const currentModel = args.models.find(
    (model) => model.id === args.current.shiftType,
  )
  const dayStart = localDayStart(args.current.date)
  if (!currentModel || dayStart == null) return []

  const currentStart = dayStart + currentModel.startMinutes * 60_000
  const currentEnd =
    dayStart + shiftModelAbsoluteEnd(currentModel) * 60_000
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
      const leftOrder = args.models.find((model) => model.id === left.shiftType)?.order ?? 0
      const rightOrder = args.models.find((model) => model.id === right.shiftType)?.order ?? 0
      return leftOrder - rightOrder || left.updatedAt.localeCompare(right.updatedAt)
    }) as EarlyShiftSource[]
  const workersById = new Map(args.workers.map((worker) => [worker.id, worker]))
  const seen = new Set(args.current.presentWorkerIds)
  const recommendations: EarlyShiftRecommendation[] = []

  for (const source of sources) {
    const sourceModel = args.models.find((model) => model.id === source.shiftType)
    if (!sourceModel) continue
    let sourceStartMinutes = sourceModel.startMinutes
    if (sourceStartMinutes <= currentModel.startMinutes) {
      sourceStartMinutes += 24 * 60
    }
    const sourceStart = dayStart + sourceStartMinutes * 60_000
    const handoffAt = Math.min(currentEnd, sourceStart)
    if (handoffAt <= currentStart) continue

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
      const interval = workerShiftInterval(
        source,
        workerId,
        args.models,
        args.presets,
      )
      if (
        !interval ||
        interval.start < currentStart ||
        interval.start >= handoffAt ||
        interval.end <= sourceStart ||
        interval.end <= now
      ) {
        continue
      }

      const startDate = new Date(interval.start)
      const endDate = new Date(handoffAt)
      const start = startDate.getHours() * 60 + startDate.getMinutes()
      const end = endDate.getHours() * 60 + endDate.getMinutes()
      if (start === end) continue

      const presetId = workerWindowIdFromTimes(start, end)
      const allPresets = [
        ...(source.workerWindowPresets ?? []),
        ...args.presets.filter(
          (preset) =>
            !source.workerWindowPresets?.some((local) => local.id === preset.id),
        ),
      ]
      const matchingPreset = allPresets.find(
        (preset) => preset.id === presetId || (preset.start === start && preset.end === end),
      )
      const windowPreset: WorkerWindowPreset =
        matchingPreset ?? {
          id: presetId,
          label: `${formatMinutes(start)}–${formatMinutes(end)} · חפיפה`,
          name: 'השלמה למשמרת הבאה',
          start,
          end,
          order: allPresets.length,
        }
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
        startsAt: formatMinutes(start),
        windowPreset,
        windowPresets: allPresets,
        ...(lane ? { laneId: lane.id, laneName: lane.name } : {}),
      })
      seen.add(workerId)
    }
  }

  return recommendations
}
