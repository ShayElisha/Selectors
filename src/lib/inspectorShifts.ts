import type { ShiftType } from '../types'

/** Gate-out inspectors: one board per shift, no two-hour rounds. */
export const INSPECTOR_SHIFT_TYPES: ShiftType[] = ['morning', 'afternoon', 'night']

export const INSPECTOR_SHIFT_WINDOWS: Record<
  'morning' | 'afternoon' | 'night',
  { start: string; end: string; nextDay?: boolean }
> = {
  morning: { start: '06:00', end: '14:30' },
  afternoon: { start: '14:30', end: '21:30' },
  night: { start: '21:30', end: '06:00', nextDay: true },
}

export function formatInspectorShiftWindow(
  shiftType: 'morning' | 'afternoon' | 'night',
): string {
  const w = INSPECTOR_SHIFT_WINDOWS[shiftType]
  if (w.nextDay) return `${w.start} עד ${w.end} (למחרת)`
  return `${w.start} עד ${w.end}`
}

function toDateISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** morning 06:00–14:30, afternoon 14:30–21:30, night 21:30–06:00. */
export function getInspectorShiftContext(now = new Date()): {
  date: string
  shiftType: 'morning' | 'afternoon' | 'night'
  windowLabel: string
} {
  const minutes = now.getHours() * 60 + now.getMinutes()
  const morningStart = 6 * 60
  const afternoonStart = 14 * 60 + 30
  const nightStart = 21 * 60 + 30

  if (minutes >= morningStart && minutes < afternoonStart) {
    return {
      date: toDateISO(now),
      shiftType: 'morning',
      windowLabel: '06:00–14:30',
    }
  }
  if (minutes >= afternoonStart && minutes < nightStart) {
    return {
      date: toDateISO(now),
      shiftType: 'afternoon',
      windowLabel: '14:30–21:30',
    }
  }
  if (minutes >= nightStart) {
    return {
      date: toDateISO(now),
      shiftType: 'night',
      windowLabel: '21:30–06:00',
    }
  }
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  return {
    date: toDateISO(yesterday),
    shiftType: 'night',
    windowLabel: '21:30–06:00',
  }
}
