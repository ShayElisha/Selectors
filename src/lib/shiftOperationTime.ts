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

export function isMidShiftOperationTime(
  shiftDate: string,
  shiftType: string,
  effectiveAt: string | null | undefined,
  models: readonly Pick<ShiftModel, 'id' | 'startMinutes'>[],
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

export function filterMidShiftOperationEvents<
  T extends { effectiveAt: string | null | undefined },
>(
  events: readonly T[] | null | undefined,
  shiftDate: string,
  shiftType: string,
  models: readonly Pick<ShiftModel, 'id' | 'startMinutes'>[],
): T[] {
  return (events ?? []).filter((event) =>
    isMidShiftOperationTime(shiftDate, shiftType, event.effectiveAt, models),
  )
}

export function formatOperationTime(value: string): string {
  const date = new Date(value)
  return Number.isFinite(date.getTime())
    ? date.toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })
    : value
}
