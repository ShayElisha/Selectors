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

export function formatOperationTime(value: string): string {
  const date = new Date(value)
  return Number.isFinite(date.getTime())
    ? date.toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })
    : value
}
