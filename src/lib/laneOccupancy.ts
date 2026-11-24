import type {
  Lane,
  SeatSegment,
  ShiftModel,
  ShiftSchedule,
  WorkerWindowPreset,
} from '../types'
import { effectiveStaffingStandard } from './shiftStaffing'
import { formatMinutes, shiftModelAbsoluteEnd } from './shiftModels'
import { MAIN_SHIFT_BOUNDS } from './shiftCatalog'
import { workerShiftWindowMinutes } from './workerShiftStatus'

export type LaneOccupantSegment = {
  workerId: string
  fromMinutes: number
  toMinutes: number
  label: string
}

export type LaneOccupancyRow = {
  laneId: string
  name: string
  intensity: Lane['intensity'] | null
  staffingStandard: number | null
  /** Final assignment ids (may include sequential occupants). */
  workerIds: string[]
  /** Time-sliced occupants for clear history display. */
  occupants: LaneOccupantSegment[]
  /** Peak concurrent people in the lane (for תקן checks). */
  peakConcurrent: number
}

/** Saved schedule or in-progress draft — occupancy only needs placement fields. */
export type LaneOccupancyShift = Pick<
  ShiftSchedule,
  | 'date'
  | 'shiftType'
  | 'activeLaneIds'
  | 'assignments'
  | 'staffingOverrides'
  | 'seatSegments'
  | 'seatSpan'
  | 'shiftOperationEvents'
  | 'workerWindows'
  | 'workerWindowPresets'
  | 'windowAdjustments'
  | 'earlyLeaveAt'
>

function shiftSpanMinutes(
  shift: Pick<ShiftSchedule, 'shiftType' | 'seatSpan'>,
  models: ShiftModel[],
): { startMinutes: number; endMinutes: number } {
  if (shift.seatSpan) return shift.seatSpan
  const model = models.find((item) => item.id === shift.shiftType)
  if (model) {
    return {
      startMinutes: model.startMinutes,
      endMinutes: shiftModelAbsoluteEnd(model),
    }
  }
  const fallback = MAIN_SHIFT_BOUNDS[shift.shiftType]
  return {
    startMinutes: fallback?.start ?? 0,
    endMinutes: fallback?.end ?? 24 * 60,
  }
}

function minutesFromIso(
  value: string | null | undefined,
  date: string,
  spanStart: number,
): number | null {
  if (!value) return null
  const stamp = new Date(value).getTime()
  if (!Number.isFinite(stamp)) return null
  const [year, month, day] = date.split('-').map(Number)
  if (![year, month, day].every(Number.isFinite)) return null
  const dayStart = new Date(year!, month! - 1, day!).getTime()
  if (!Number.isFinite(dayStart)) return null
  let minutes = Math.round((stamp - dayStart) / 60_000)
  // Overnight entries that land after midnight map past 24h when needed.
  if (minutes < spanStart - 12 * 60) minutes += 24 * 60
  return minutes
}

function segmentLabel(fromMinutes: number, toMinutes: number): string {
  return `${formatMinutes(fromMinutes)}–${formatMinutes(toMinutes)}`
}

function peakConcurrent(segments: LaneOccupantSegment[]): number {
  if (segments.length === 0) return 0
  const edges: { at: number; delta: number }[] = []
  for (const segment of segments) {
    edges.push({ at: segment.fromMinutes, delta: 1 })
    edges.push({ at: segment.toMinutes, delta: -1 })
  }
  edges.sort((left, right) => left.at - right.at || left.delta - right.delta)
  let current = 0
  let peak = 0
  for (const edge of edges) {
    current += edge.delta
    peak = Math.max(peak, current)
  }
  return peak
}

function segmentsFromSeatData(
  shift: LaneOccupancyShift,
  laneId: string,
  span: { startMinutes: number; endMinutes: number },
): LaneOccupantSegment[] {
  return (shift.seatSegments ?? [])
    .filter((segment) => segment.laneId === laneId && segment.workerId)
    .map((segment) => {
      const fromMinutes = Math.max(span.startMinutes, segment.fromMinutes)
      const toMinutes = Math.min(span.endMinutes, segment.toMinutes)
      return {
        workerId: segment.workerId,
        fromMinutes,
        toMinutes,
        label: segmentLabel(fromMinutes, toMinutes),
      }
    })
    .filter((segment) => segment.toMinutes > segment.fromMinutes)
    .sort(
      (left, right) =>
        left.fromMinutes - right.fromMinutes ||
        left.workerId.localeCompare(right.workerId),
    )
}

/** Rebuild lane timeline from assignment changes when seatSegments are missing. */
function segmentsFromOperations(
  shift: LaneOccupancyShift,
  laneId: string,
  span: { startMinutes: number; endMinutes: number },
): LaneOccupantSegment[] {
  const events = [...(shift.shiftOperationEvents ?? [])].sort((left, right) => {
    const leftAt = new Date(left.effectiveAt ?? left.recordedAt).getTime()
    const rightAt = new Date(right.effectiveAt ?? right.recordedAt).getTime()
    return leftAt - rightAt
  })
  if (events.length === 0) return []

  const open = new Map<string, number>()
  const closed: LaneOccupantSegment[] = []

  const closeWorker = (workerId: string, atMinutes: number) => {
    const fromMinutes = open.get(workerId)
    if (fromMinutes == null) return
    open.delete(workerId)
    const toMinutes = Math.max(fromMinutes, Math.min(span.endMinutes, atMinutes))
    if (toMinutes > fromMinutes) {
      closed.push({
        workerId,
        fromMinutes,
        toMinutes,
        label: segmentLabel(fromMinutes, toMinutes),
      })
    }
  }

  // Seed with people who were on the lane before the first documented change.
  const firstChangeAt = events
    .map((event) => minutesFromIso(event.effectiveAt ?? event.recordedAt, shift.date, span.startMinutes))
    .find((value) => value != null)
  const seedUntil = firstChangeAt ?? span.endMinutes
  const finalIds = new Set(
    (shift.assignments.find((row) => row.laneId === laneId)?.workerIds ?? []).filter(
      Boolean,
    ),
  )
  const touched = new Set<string>()
  for (const event of events) {
    if (event.fromLaneId === laneId || event.toLaneId === laneId) {
      touched.add(event.workerId)
    }
  }
  for (const workerId of finalIds) {
    if (touched.has(workerId)) continue
    open.set(workerId, span.startMinutes)
  }
  // People removed from this lane later were present from the start until removal.
  for (const event of events) {
    if (event.fromLaneId === laneId && event.kind !== 'worker_assigned') {
      if (!open.has(event.workerId) && !finalIds.has(event.workerId)) {
        open.set(event.workerId, span.startMinutes)
      }
    }
  }

  for (const event of events) {
    const at =
      minutesFromIso(event.effectiveAt ?? event.recordedAt, shift.date, span.startMinutes) ??
      seedUntil
    if (event.fromLaneId === laneId) {
      closeWorker(event.workerId, at)
    }
    if (event.toLaneId === laneId) {
      if (!open.has(event.workerId)) open.set(event.workerId, Math.max(span.startMinutes, at))
    }
  }

  for (const [workerId, fromMinutes] of open) {
    closed.push({
      workerId,
      fromMinutes,
      toMinutes: span.endMinutes,
      label: segmentLabel(fromMinutes, span.endMinutes),
    })
  }

  return closed.sort(
    (left, right) =>
      left.fromMinutes - right.fromMinutes ||
      left.workerId.localeCompare(right.workerId),
  )
}

function wholeShiftOccupants(
  shift: LaneOccupancyShift,
  laneId: string,
  span: { startMinutes: number; endMinutes: number },
  models: ShiftModel[],
  presets: WorkerWindowPreset[],
): LaneOccupantSegment[] {
  const ids = (
    shift.assignments.find((row) => row.laneId === laneId)?.workerIds ?? []
  ).filter(Boolean)
  return ids
    .map((workerId) => {
      const window = workerShiftWindowMinutes(shift, workerId, models, presets)
      const fromMinutes = Math.max(
        span.startMinutes,
        window?.startMinutes ?? span.startMinutes,
      )
      const toMinutes = Math.min(
        span.endMinutes,
        window?.endMinutes ?? span.endMinutes,
      )
      if (toMinutes <= fromMinutes) return null
      return {
        workerId,
        fromMinutes,
        toMinutes,
        label: segmentLabel(fromMinutes, toMinutes),
      }
    })
    .filter(Boolean) as LaneOccupantSegment[]
}

/**
 * Intersect a station segment with personal hours:
 * - start-of-shift + personal end → e.g. 14:30–18:30
 * - mid-shift start → start–shift/personal end
 * - mid start + mid end → exact from–to
 */
function clipSegmentToDutyWindow(
  segment: LaneOccupantSegment,
  shift: LaneOccupancyShift,
  span: { startMinutes: number; endMinutes: number },
  models: ShiftModel[],
  presets: WorkerWindowPreset[],
): LaneOccupantSegment | null {
  const window = workerShiftWindowMinutes(
    shift,
    segment.workerId,
    models,
    presets,
  )
  const fromMinutes = Math.max(
    span.startMinutes,
    segment.fromMinutes,
    window?.startMinutes ?? span.startMinutes,
  )
  const toMinutes = Math.min(
    span.endMinutes,
    segment.toMinutes,
    window?.endMinutes ?? span.endMinutes,
  )
  if (toMinutes <= fromMinutes) return null
  return {
    ...segment,
    fromMinutes,
    toMinutes,
    label: segmentLabel(fromMinutes, toMinutes),
  }
}

function clipOccupantsToPersonalWindows(
  occupants: LaneOccupantSegment[],
  shift: LaneOccupancyShift,
  span: { startMinutes: number; endMinutes: number },
  models: ShiftModel[],
  presets: WorkerWindowPreset[],
): LaneOccupantSegment[] {
  return occupants
    .map((segment) =>
      clipSegmentToDutyWindow(segment, shift, span, models, presets),
    )
    .filter(Boolean) as LaneOccupantSegment[]
}

/** Public helper for home/history labels when a flat assignment has no segments. */
export function workerDutyTimeLabel(
  shift: LaneOccupancyShift,
  workerId: string,
  models: ShiftModel[] = [],
  presets: WorkerWindowPreset[] = [],
): string {
  const span = shiftSpanMinutes(shift, models)
  const catalog = [
    ...presets,
    ...(shift.workerWindowPresets ?? []).filter(
      (local) => !presets.some((preset) => preset.id === local.id),
    ),
  ]
  const clipped = clipSegmentToDutyWindow(
    {
      workerId,
      fromMinutes: span.startMinutes,
      toMinutes: span.endMinutes,
      label: '',
    },
    shift,
    span,
    models,
    catalog,
  )
  return clipped?.label ?? segmentLabel(span.startMinutes, span.endMinutes)
}

export function laneOccupancyRowsForShift(
  shift: LaneOccupancyShift,
  lanesById: Map<string, Lane>,
  models: ShiftModel[] = [],
  presets: WorkerWindowPreset[] = [],
): LaneOccupancyRow[] {
  const span = shiftSpanMinutes(shift, models)
  const catalog = [
    ...presets,
    ...(shift.workerWindowPresets ?? []).filter(
      (local) => !presets.some((preset) => preset.id === local.id),
    ),
  ]
  const laneIds = [
    ...new Set([
      ...shift.activeLaneIds,
      ...shift.assignments.map((row) => row.laneId),
      ...(shift.seatSegments ?? []).map((segment) => segment.laneId),
    ]),
  ]
  const order = [...lanesById.keys()]
  const index = new Map(order.map((id, i) => [id, i]))

  return laneIds
    .map((laneId) => {
      const lane = lanesById.get(laneId)
      const workerIds = (
        shift.assignments.find((row) => row.laneId === laneId)?.workerIds ?? []
      ).filter(Boolean)
      let occupants = segmentsFromSeatData(shift, laneId, span)
      if (occupants.length === 0) {
        occupants = segmentsFromOperations(shift, laneId, span)
      }
      if (occupants.length === 0) {
        occupants = wholeShiftOccupants(shift, laneId, span, models, catalog)
      } else {
        occupants = clipOccupantsToPersonalWindows(
          occupants,
          shift,
          span,
          models,
          catalog,
        )
        // Assignment members missing from seat/ops still get a personal duty row.
        const seen = new Set(occupants.map((item) => item.workerId))
        for (const extra of wholeShiftOccupants(
          shift,
          laneId,
          span,
          models,
          catalog,
        )) {
          if (seen.has(extra.workerId)) continue
          occupants.push(extra)
          seen.add(extra.workerId)
        }
        occupants.sort(
          (left, right) =>
            left.fromMinutes - right.fromMinutes ||
            left.workerId.localeCompare(right.workerId),
        )
      }
      return {
        laneId,
        name: lane?.name ?? 'נתיב שהוסר',
        intensity: lane?.intensity ?? null,
        staffingStandard: lane
          ? effectiveStaffingStandard(lane, shift.staffingOverrides)
          : null,
        workerIds,
        occupants,
        peakConcurrent: peakConcurrent(occupants),
      }
    })
    .filter(
      (row) =>
        row.occupants.length > 0 ||
        row.workerIds.length > 0 ||
        shift.activeLaneIds.includes(row.laneId),
    )
    .sort(
      (left, right) =>
        (index.get(left.laneId) ?? Number.MAX_SAFE_INTEGER) -
          (index.get(right.laneId) ?? Number.MAX_SAFE_INTEGER) ||
        left.name.localeCompare(right.name, 'he'),
    )
}

/** Close/open seat segments for a mid-shift board change. */
export function applySeatOccupancyChange(args: {
  segments: SeatSegment[] | undefined
  span: { startMinutes: number; endMinutes: number }
  atMinutes: number
  removed?: { workerId: string; laneId: string }
  added?: { workerId: string; laneId: string }
}): SeatSegment[] {
  const at = Math.min(
    args.span.endMinutes,
    Math.max(args.span.startMinutes, args.atMinutes),
  )
  let next = [...(args.segments ?? [])]

  if (args.removed) {
    const { workerId, laneId } = args.removed
    next = next.flatMap((segment) => {
      if (segment.workerId !== workerId || segment.laneId !== laneId) {
        return [segment]
      }
      if (segment.toMinutes <= at || segment.fromMinutes >= at) {
        return segment.toMinutes <= at ? [segment] : []
      }
      return [
        {
          ...segment,
          toMinutes: at,
        },
      ]
    })
  }

  if (args.added) {
    const { workerId, laneId } = args.added
    next = next.filter(
      (segment) =>
        !(
          segment.workerId === workerId &&
          segment.laneId === laneId &&
          segment.fromMinutes >= at
        ),
    )
    if (args.span.endMinutes > at) {
      next.push({
        workerId,
        laneId,
        fromMinutes: at,
        toMinutes: args.span.endMinutes,
      })
    }
  }

  return next.filter((segment) => segment.toMinutes > segment.fromMinutes)
}
