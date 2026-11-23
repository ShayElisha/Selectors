import { MAIN_SHIFT_BOUNDS, workerWindowById } from './shiftCatalog'
import {
  headcountDeficit,
  shiftHeadcountSnapshot,
  type ShiftHeadcountSnapshot,
} from './shiftStaffing'
import type { ShiftModel, ShiftSchedule, WorkerWindowPreset } from '../types'

export type WorkerShiftEnd = {
  minutes: number
  dayOffset: number
  timestamp: number
}

export type WorkerShiftInterval = {
  start: number
  end: number
}

export type LiveShiftHeadcountSnapshot = ShiftHeadcountSnapshot & {
  live: boolean
}

function shiftInterval(
  shift: Pick<
    ShiftSchedule,
    | 'date'
    | 'shiftType'
    | 'workerWindows'
    | 'windowAdjustments'
    | 'earlyLeaveAt'
  >,
  workerId: string,
  models: ShiftModel[],
  presets: WorkerWindowPreset[],
): WorkerShiftInterval | null {
  const model = models.find((item) => item.id === shift.shiftType)
  const fallback = MAIN_SHIFT_BOUNDS[shift.shiftType]
  if (!model && !fallback) return null

  const shiftStart = model?.startMinutes ?? fallback!.start
  let shiftEnd = model?.endMinutes ?? fallback!.end
  if (shiftEnd <= shiftStart) shiftEnd += 24 * 60
  const crossesMidnight = shiftEnd > 24 * 60

  const preset = workerWindowById(shift.workerWindows?.[workerId], presets)
  let start = shiftStart
  let end = shiftEnd
  if (preset) {
    const duration =
      preset.end > preset.start
        ? preset.end - preset.start
        : preset.end + 24 * 60 - preset.start
    const candidates = [-24 * 60, 0, 24 * 60].map((offset) => {
      const candidateStart = preset.start + offset
      const candidateEnd = candidateStart + duration
      const overlap = Math.max(
        0,
        Math.min(candidateEnd, shiftEnd) -
          Math.max(candidateStart, shiftStart),
      )
      return { start: candidateStart, end: candidateEnd, overlap }
    })
    const best = candidates.reduce((selected, candidate) =>
      candidate.overlap > selected.overlap ? candidate : selected,
    )
    start = best.start
    end = best.end
    if (crossesMidnight && best.overlap === 0 && preset.start < shiftStart) {
      start += 24 * 60
      end += 24 * 60
    }
  }

  const lateMinutes = Math.max(
    0,
    Number(shift.windowAdjustments?.[workerId]?.lateMinutes) || 0,
  )
  const earlyMinutes = Math.max(
    0,
    Number(shift.windowAdjustments?.[workerId]?.earlyMinutes) || 0,
  )
  start += lateMinutes
  end -= earlyMinutes

  const leaveAt = shift.earlyLeaveAt?.[workerId]
  if (leaveAt != null && Number.isFinite(Number(leaveAt))) {
    let leave = Number(leaveAt)
    if (leave < shiftStart && crossesMidnight) leave += 24 * 60
    end = Math.min(end, leave)
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
  const [year, month, day] = shift.date.split('-').map(Number)
  if (![year, month, day].every(Number.isFinite)) return null
  const dateAtMinutes = (minutes: number) =>
    new Date(year!, month! - 1, day!, 0, minutes).getTime()
  const interval = { start: dateAtMinutes(start), end: dateAtMinutes(end) }
  return Number.isFinite(interval.start) && Number.isFinite(interval.end)
    ? interval
    : null
}

export function workerShiftInterval(
  shift: Parameters<typeof shiftInterval>[0],
  workerId: string,
  models: ShiftModel[],
  presets: WorkerWindowPreset[],
): WorkerShiftInterval | null {
  return shiftInterval(shift, workerId, models, presets)
}

export function workerShiftEnd(
  shift: Parameters<typeof shiftInterval>[0],
  workerId: string,
  models: ShiftModel[],
  presets: WorkerWindowPreset[],
): WorkerShiftEnd | null {
  const interval = shiftInterval(shift, workerId, models, presets)
  if (!interval) return null
  const date = new Date(interval.end)
  const [year, month, day] = shift.date.split('-').map(Number)
  const shiftDate = Date.UTC(year!, month! - 1, day!)
  const endDate = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  const dayOffset = Math.round((endDate - shiftDate) / (24 * 60 * 60_000))
  return {
    minutes: date.getHours() * 60 + date.getMinutes(),
    dayOffset,
    timestamp: interval.end,
  }
}

export function workerShiftHasEnded(
  shift: Parameters<typeof shiftInterval>[0],
  workerId: string,
  models: ShiftModel[],
  presets: WorkerWindowPreset[],
  now = Date.now(),
): boolean {
  const interval = shiftInterval(shift, workerId, models, presets)
  return interval != null && interval.end <= now
}

/**
 * Current staffing against a shift's headcount target. Signed-off shifts retain
 * their final attendance snapshot; an open shift counts only workers whose
 * personal shift window includes the current time.
 */
export function liveShiftHeadcountSnapshot(
  shift: Pick<
    ShiftSchedule,
    | 'date'
    | 'shiftType'
    | 'presentWorkerIds'
    | 'headcountStandard'
    | 'workerWindows'
    | 'windowAdjustments'
    | 'earlyLeaveAt'
    | 'signOff'
  >,
  models: ShiftModel[],
  presets: WorkerWindowPreset[],
  now = Date.now(),
): LiveShiftHeadcountSnapshot {
  const snapshot = shiftHeadcountSnapshot(shift)
  if (shift.signOff?.signedAt) return { ...snapshot, live: false }

  const present = shift.presentWorkerIds.filter((workerId) => {
    const interval = shiftInterval(shift, workerId, models, presets)
    return interval != null && interval.start <= now && now < interval.end
  }).length
  return {
    ...snapshot,
    present,
    deficit: headcountDeficit(present, snapshot.standard),
    surplus: Math.max(0, present - (snapshot.standard ?? 0)),
    live: true,
  }
}
