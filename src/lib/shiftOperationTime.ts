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

export function isValidOperationTime(
  value: string | null | undefined,
): value is string {
  if (!value) return false
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) && timestamp <= Date.now()
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

export function formatOperationTime(value: string): string {
  const date = new Date(value)
  return Number.isFinite(date.getTime())
    ? date.toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })
    : value
}
