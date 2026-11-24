import type { ShiftModel } from '../types'

export function toLocalDateTimeInput(date = new Date()): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

export function fromLocalDateTimeInput(value: string): string | null {
  const date = new Date(value)
  return value &&
    Number.isFinite(date.getTime()) &&
    date.getTime() <= Date.now()
    ? date.toISOString()
    : null
}

export function shiftStartTimestamp(
  dateValue: string,
  startMinutes: number,
): string | null {
  const [year, month, day] = dateValue.split('-').map(Number)
  if (
    ![year, month, day, startMinutes].every(Number.isFinite) ||
    month! < 1 ||
    month! > 12 ||
    day! < 1 ||
    day! > 31
  ) {
    return null
  }
  const date = new Date(year!, month! - 1, day!)
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month! - 1 ||
    date.getDate() !== day
  ) {
    return null
  }
  date.setMinutes(startMinutes)
  return date.toISOString()
}

type ShiftClockModel = Pick<ShiftModel, 'id' | 'startMinutes'> &
  Partial<Pick<ShiftModel, 'endMinutes'>>

export function isMidShiftOperationTime(
  shiftDate: string,
  shiftType: string,
  effectiveAt: string | null | undefined,
  models: readonly ShiftClockModel[],
): boolean {
  if (!effectiveAt) return false
  const model = models.find((item) => item.id === shiftType)
  if (!model) return false
  const shiftStart = shiftStartTimestamp(shiftDate, model.startMinutes)
  if (!shiftStart) return false
  const effectiveTime = new Date(effectiveAt).getTime()
  const shiftStartTime = new Date(shiftStart).getTime()
  return (
    Number.isFinite(effectiveTime) &&
    Number.isFinite(shiftStartTime) &&
    effectiveTime > shiftStartTime &&
    effectiveTime <= Date.now()
  )
}

/** Station changes that belong on the history timeline (including planned later entries). */
export function isDocumentedStationChangeTime(
  shiftDate: string,
  shiftType: string,
  effectiveAt: string | null | undefined,
  models: readonly ShiftClockModel[],
): boolean {
  if (!effectiveAt) return false
  const model = models.find((item) => item.id === shiftType)
  if (!model) return false
  const shiftStart = shiftStartTimestamp(shiftDate, model.startMinutes)
  if (!shiftStart) return false
  const effectiveTime = new Date(effectiveAt).getTime()
  const shiftStartTime = new Date(shiftStart).getTime()
  if (
    !Number.isFinite(effectiveTime) ||
    !Number.isFinite(shiftStartTime) ||
    effectiveTime <= shiftStartTime
  ) {
    return false
  }
  if (model.endMinutes == null || !Number.isFinite(model.endMinutes)) {
    return true
  }
  let endMinutes = model.endMinutes
  if (endMinutes <= model.startMinutes) endMinutes += 24 * 60
  const shiftEnd = shiftStartTimestamp(shiftDate, endMinutes)
  const shiftEndTime = shiftEnd ? new Date(shiftEnd).getTime() : Number.NaN
  return !Number.isFinite(shiftEndTime) || effectiveTime <= shiftEndTime
}

export function filterMidShiftOperationEvents<
  T extends { effectiveAt: string | null | undefined },
>(
  events: readonly T[] | null | undefined,
  shiftDate: string,
  shiftType: string,
  models: readonly ShiftClockModel[],
): T[] {
  return (events ?? []).filter((event) =>
    isDocumentedStationChangeTime(
      shiftDate,
      shiftType,
      event.effectiveAt,
      models,
    ),
  )
}

export function formatOperationTime(value: string): string {
  const date = new Date(value)
  return Number.isFinite(date.getTime())
    ? date.toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })
    : value
}
