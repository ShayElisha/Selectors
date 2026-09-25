import type { Intensity, ShiftType } from './types'

export const INTENSITY_LABELS: Record<Intensity, string> = {
  easy: 'קל',
  medium: 'בינוני',
  hard: 'קשה',
}

export const INTENSITY_SCORE: Record<Intensity, number> = {
  easy: 1,
  medium: 2,
  hard: 3,
}

/**
 * Night shifts weigh heavier: an "easy" night post is not a real rest day.
 * Multipliers apply on top of effectiveIntensityScore().
 */
export const SHIFT_LOAD_MULTIPLIER: Record<ShiftType, number> = {
  morning: 1,
  afternoon: 1,
  night: 1.75,
}

/**
 * Effective workload points for fairness.
 * Night + easy counts as medium before the night multiplier (no day-easy credit).
 */
export function effectiveIntensityScore(
  intensity: Intensity,
  shiftType: ShiftType,
): number {
  const base =
    shiftType === 'night' && intensity === 'easy'
      ? INTENSITY_SCORE.medium
      : INTENSITY_SCORE[intensity]
  return base * SHIFT_LOAD_MULTIPLIER[shiftType]
}

/** True only when an easy lane on a day shift (morning/afternoon) */
export function countsAsDayEasy(
  intensity: Intensity,
  shiftType: ShiftType,
): boolean {
  return intensity === 'easy' && shiftType !== 'night'
}

export const SHIFT_TYPE_LABELS: Record<ShiftType, string> = {
  morning: 'בוקר',
  afternoon: 'צהריים',
  night: 'לילה',
}

/** Latest saved shift for a date + shift type, optionally ignoring one id (current draft). */
export function findShiftForSlot(
  history: {
    id: string
    date: string
    shiftType: ShiftType
    updatedAt?: string
    audience?: string
  }[],
  date: string,
  shiftType: ShiftType,
  excludeId?: string,
  audience?: 'inspector' | 'selector',
): { id: string; date: string; shiftType: ShiftType; updatedAt?: string } | null {
  const matches = history.filter(
    (h) =>
      h.date === date &&
      h.shiftType === shiftType &&
      (!excludeId || h.id !== excludeId) &&
      (audience == null ||
        (audience === 'selector'
          ? h.audience === 'selector'
          : h.audience !== 'selector')),
  )
  if (matches.length === 0) return null
  return matches.sort((a, b) =>
    (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''),
  )[0]!
}

export function shiftSlotConflictMessage(
  date: string,
  shiftType: ShiftType,
): string {
  const dateLabel = new Date(`${date}T12:00:00`).toLocaleDateString('he-IL')
  return `כבר קיים שיבוץ ל-${dateLabel} · משמרת ${SHIFT_TYPE_LABELS[shiftType]}. לא ניתן ליצור שיבוץ כפול לאותו תאריך ומשמרת.`
}

/** Display hours for each shift window */
export const SHIFT_WINDOW_LABELS: Record<ShiftType, string> = {
  morning: '06:00–14:30',
  afternoon: '14:30–21:30',
  night: '21:30–06:00',
}

function toDateISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * Current operational shift by clock:
 * morning 06:00–14:30, afternoon 14:30–21:30, night 21:30–06:00.
 * Night after midnight still belongs to the previous calendar date.
 */
export function getCurrentShiftContext(now = new Date()): {
  date: string
  shiftType: ShiftType
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
      windowLabel: SHIFT_WINDOW_LABELS.morning,
    }
  }
  if (minutes >= afternoonStart && minutes < nightStart) {
    return {
      date: toDateISO(now),
      shiftType: 'afternoon',
      windowLabel: SHIFT_WINDOW_LABELS.afternoon,
    }
  }
  if (minutes >= nightStart) {
    return {
      date: toDateISO(now),
      shiftType: 'night',
      windowLabel: SHIFT_WINDOW_LABELS.night,
    }
  }
  // 00:00–05:59 → night that started yesterday evening
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  return {
    date: toDateISO(yesterday),
    shiftType: 'night',
    windowLabel: SHIFT_WINDOW_LABELS.night,
  }
}

export const DEFAULT_CERTIFICATIONS = [
  'בדיקת דרכונים',
  'בידוק ביטחוני',
  'נתיב מהיר',
  'כבודה',
  'ראיון',
  'מפקד נתיב',
]

export const STORAGE_KEY = 'shibutzon-v2'
