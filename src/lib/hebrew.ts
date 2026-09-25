import type { ShiftType } from '../types'

export interface HebrewPluralForms {
  /** e.g. "נתיב אחד" */
  one: string
  /** e.g. "שני נתיבים" */
  two: string
  /** plural noun only, e.g. "נתיבים" → rendered as "5 נתיבים" */
  many: string
}

/**
 * Hebrew count + noun forms.
 * 0 uses the many form with the number (e.g. "0 נתיבים").
 */
export function pluralizeHe(n: number, forms: HebrewPluralForms): string {
  const count = Math.trunc(n)
  if (count === 1) return forms.one
  if (count === 2) return forms.two
  return `${count} ${forms.many}`
}

/** Single page-wide date format: D.M.YYYY (e.g. 19.9.2026). */
export function formatShiftDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  if (!y || !m || !d) return isoDate
  return `${d}.${m}.${y}`
}

/** Compact title date without year when same calendar year as `now`. */
export function formatShiftDateShort(
  isoDate: string,
  now = new Date(),
): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  if (!y || !m || !d) return isoDate
  if (y === now.getFullYear()) return `${d}.${m}`
  return `${d}.${m}.${y}`
}

const SHIFT_WINDOWS: Record<
  ShiftType,
  { start: string; end: string; nextDay?: boolean }
> = {
  morning: { start: '06:00', end: '14:30' },
  afternoon: { start: '14:30', end: '21:30' },
  night: { start: '21:30', end: '06:00', nextDay: true },
}

/** Human-readable shift window; night marks next-day end. */
export function formatShiftWindow(shiftType: ShiftType): string {
  const w = SHIFT_WINDOWS[shiftType]
  if (w.nextDay) {
    return `${w.start} עד ${w.end} (למחרת)`
  }
  return `${w.start} עד ${w.end}`
}

export function shiftWindowParts(shiftType: ShiftType): {
  start: string
  end: string
  nextDay: boolean
} {
  const w = SHIFT_WINDOWS[shiftType]
  return { start: w.start, end: w.end, nextDay: Boolean(w.nextDay) }
}
