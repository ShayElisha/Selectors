import type { ShiftType } from '../types'

/** Minutes from local midnight. Values above 24h are the next morning. */
export type ClockRange = { start: number; end: number }

export const MAIN_SHIFT_BOUNDS: Record<ShiftType, ClockRange> = {
  morning: { start: 6 * 60, end: 15 * 60 },
  afternoonA: { start: 14 * 60 + 30, end: 18 * 60 + 30 },
  afternoonB: { start: 18 * 60, end: 21 * 60 + 30 },
  /** Kept so older saved shifts still open. */
  afternoon: { start: 14 * 60 + 30, end: 21 * 60 + 30 },
  night: { start: 21 * 60, end: 24 * 60 + 6 * 60 + 30 },
}

export const SELECTABLE_SHIFT_TYPES: ShiftType[] = [
  'morning',
  'afternoonA',
  'afternoonB',
  'night',
]

export interface WorkerWindowPreset {
  id: string
  label: string
  start: number
  end: number
}

/** Personal hours chosen on attendance. End is exclusive of later rounds. */
export const WORKER_WINDOWS: WorkerWindowPreset[] = [
  { id: '0445-1500', label: '04:45–15:00', start: 4 * 60 + 45, end: 15 * 60 },
  { id: '0445-1645', label: '04:45–16:45', start: 4 * 60 + 45, end: 16 * 60 + 45 },
  { id: '0445-1730', label: '04:45–17:30', start: 4 * 60 + 45, end: 17 * 60 + 30 },
  { id: '0445-1830', label: '04:45–18:30', start: 4 * 60 + 45, end: 18 * 60 + 30 },
  { id: '0600-1500', label: '06:00–15:00', start: 6 * 60, end: 15 * 60 },
  { id: '0600-1645', label: '06:00–16:45', start: 6 * 60, end: 16 * 60 + 45 },
  { id: '0600-1730', label: '06:00–17:30', start: 6 * 60, end: 17 * 60 + 30 },
  { id: '0600-1830', label: '06:00–18:30', start: 6 * 60, end: 18 * 60 + 30 },
  { id: '1430-2130', label: '14:30–21:30', start: 14 * 60 + 30, end: 21 * 60 + 30 },
  { id: '1800-0630', label: '18:00–06:30', start: 18 * 60, end: 6 * 60 + 30 },
]

/** Afternoon A continues morning; afternoon B continues morning and afternoon A. */
export function earlierShiftsToContinue(shiftType: ShiftType): ShiftType[] {
  if (shiftType === 'afternoonA' || shiftType === 'afternoon') return ['morning']
  if (shiftType === 'afternoonB') return ['morning', 'afternoonA']
  return []
}

export function shiftFollowsMorning(shiftType: ShiftType): boolean {
  return shiftType === 'afternoonA' || shiftType === 'afternoon'
}

/**
 * True when someone on an earlier shift is still working after that shift
 * ends and their hours reach the target shift.
 * "כל המשמרת" ends with the earlier shift and does not continue.
 */
export function continuesIntoShift(
  sourceType: ShiftType,
  windowId: string | undefined,
  targetType: ShiftType,
): boolean {
  const preset = workerWindowById(windowId)
  if (!preset) return false
  const source = MAIN_SHIFT_BOUNDS[sourceType]
  const target = MAIN_SHIFT_BOUNDS[targetType]
  const span = windowInterval(preset, targetType)
  if (!(span.start < target.end && span.end > target.start)) return false
  const personalEnd = windowInterval(preset, sourceType).end
  return personalEnd > source.end
}

/** Lane is open for a round only when the round sits inside one activity window. */
export function laneOpenDuring(
  hours: { start: number; end: number }[] | undefined,
  roundStart: number,
  roundEnd: number,
): boolean {
  if (!hours || hours.length === 0) return true
  return hours.some((span) => {
    let start = span.start
    let end = span.end
    if (roundStart >= 24 * 60 && start < 12 * 60) {
      start += 24 * 60
      end += 24 * 60
    }
    if (end <= start) end += 24 * 60
    return roundStart >= start && roundEnd <= end
  })
}

export function workerWindowById(id: string | undefined): WorkerWindowPreset | undefined {
  if (!id) return undefined
  return WORKER_WINDOWS.find((w) => w.id === id)
}

/** Map a clock time onto a shift that may run past midnight. */
export function onShiftClock(minutes: number, shiftType: ShiftType): number {
  const shift = MAIN_SHIFT_BOUNDS[shiftType]
  if (shift.end > 24 * 60 && minutes < 12 * 60) return minutes + 24 * 60
  return minutes
}

export function windowInterval(
  preset: WorkerWindowPreset,
  shiftType: ShiftType,
): ClockRange {
  const start = onShiftClock(preset.start, shiftType)
  let end = onShiftClock(preset.end, shiftType)
  if (end <= start) end += 24 * 60
  return { start, end }
}

/** A round is assignable only when it sits fully inside the person's hours. */
export function windowCoversRound(
  windowId: string | undefined,
  shiftType: ShiftType,
  roundStart: number,
  roundEnd: number,
): boolean {
  const preset = workerWindowById(windowId)
  const shift = MAIN_SHIFT_BOUNDS[shiftType]
  if (!preset) {
    return roundStart >= shift.start && roundEnd <= shift.end
  }
  const span = windowInterval(preset, shiftType)
  return roundStart >= span.start && roundEnd <= span.end
}

export function presetsOverlappingShift(shiftType: ShiftType): WorkerWindowPreset[] {
  const shift = MAIN_SHIFT_BOUNDS[shiftType]
  return WORKER_WINDOWS.filter((preset) => {
    const span = windowInterval(preset, shiftType)
    return span.start < shift.end && span.end > shift.start
  })
}

/**
 * Morning board normally starts at 06:00. People who arrive at 04:45
 * need a leading round so they can sit with the night shift until 06:00.
 */
export function boardStartMinutes(
  shiftType: ShiftType,
  windowIds: Array<string | undefined>,
): number {
  const shift = MAIN_SHIFT_BOUNDS[shiftType]
  let start = shift.start
  const early = 4 * 60 + 45
  if (!windowIds.some((id) => workerWindowById(id)?.start === early)) return start
  const mapped = onShiftClock(early, shiftType)
  if (mapped < start && start - mapped <= 3 * 60) start = mapped
  return start
}
export function roundCutsForWindows(
  shiftType: ShiftType,
  windowIds: Array<string | undefined>,
): number[] {
  const shift = MAIN_SHIFT_BOUNDS[shiftType]
  const cuts = new Set<number>()
  let earlyArrival = false
  for (const id of windowIds) {
    const preset = workerWindowById(id)
    if (!preset) continue
    if (preset.start === 4 * 60 + 45) earlyArrival = true
    const span = windowInterval(preset, shiftType)
    for (const point of [span.start, span.end]) {
      if (point > shift.start && point < shift.end) cuts.add(point)
    }
  }
  const six = onShiftClock(6 * 60, shiftType)
  const openedAt = boardStartMinutes(shiftType, windowIds)
  if (earlyArrival && six > openedAt && six < shift.end) cuts.add(six)
  return [...cuts].sort((a, b) => a - b)
}
