import { MAIN_SHIFT_BOUNDS, workerWindowById } from './shiftCatalog'
import type { ShiftModel, ShiftSchedule, WorkerWindowPreset } from '../types'

export type WorkerShiftEnd = {
  minutes: number
  dayOffset: number
  timestamp: number
}

export function workerShiftEnd(
  shift: Pick<
    ShiftSchedule,
    'date' | 'shiftType' | 'workerWindows' | 'windowAdjustments' | 'earlyLeaveAt'
  >,
  workerId: string,
  models: ShiftModel[],
  presets: WorkerWindowPreset[],
): WorkerShiftEnd | null {
  const model = models.find((item) => item.id === shift.shiftType)
  const fallback = MAIN_SHIFT_BOUNDS[shift.shiftType]
  if (!model && !fallback) return null

  const shiftStart = model?.startMinutes ?? fallback!.start
  let shiftEnd = model?.endMinutes ?? fallback!.end
  if (shiftEnd <= shiftStart) shiftEnd += 24 * 60

  const preset = workerWindowById(shift.workerWindows?.[workerId], presets)
  let end = shiftEnd
  if (preset) {
    const start = preset.start
    end = preset.end
    if (end <= start) end += 24 * 60
    if (shiftStart >= 12 * 60 && start < 12 * 60 && preset.end > preset.start) {
      end += 24 * 60
    }
  }

  const earlyMinutes = Math.max(
    0,
    Number(shift.windowAdjustments?.[workerId]?.earlyMinutes) || 0,
  )
  end -= earlyMinutes

  const leaveAt = shift.earlyLeaveAt?.[workerId]
  if (leaveAt != null && Number.isFinite(Number(leaveAt))) {
    let leave = Number(leaveAt)
    if (leave < shiftStart && shiftEnd > 24 * 60) leave += 24 * 60
    end = Math.min(end, leave)
  }

  if (!Number.isFinite(end) || end <= 0) return null
  const dayOffset = Math.floor(end / (24 * 60))
  const minutes = ((end % (24 * 60)) + 24 * 60) % (24 * 60)
  const [year, month, day] = shift.date.split('-').map(Number)
  if (![year, month, day].every(Number.isFinite)) return null
  const timestamp = new Date(year!, month! - 1, day!, 0, end).getTime()
  if (!Number.isFinite(timestamp)) return null
  return { minutes, dayOffset, timestamp }
}

export function workerShiftHasEnded(
  shift: Parameters<typeof workerShiftEnd>[0],
  workerId: string,
  models: ShiftModel[],
  presets: WorkerWindowPreset[],
  now = Date.now(),
): boolean {
  const end = workerShiftEnd(shift, workerId, models, presets)
  return end != null && end.timestamp <= now
}
