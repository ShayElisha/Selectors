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
  { id: '0445-1730', label: '04:45–17:30', start: 4 * 60 + 45, end: 17 * 60 + 30 },
  { id: '0445-1830', label: '04:45–18:30', start: 4 * 60 + 45, end: 18 * 60 + 30 },
  { id: '0600-1500', label: '06:00–15:00', start: 6 * 60, end: 15 * 60 },
  { id: '0600-1730', label: '06:00–17:30', start: 6 * 60, end: 17 * 60 + 30 },
  { id: '0600-1830', label: '06:00–18:30', start: 6 * 60, end: 18 * 60 + 30 },
  { id: '1430-2130', label: '14:30–21:30', start: 14 * 60 + 30, end: 21 * 60 + 30 },
  { id: '1800-0630', label: '18:00–06:30', start: 18 * 60, end: 6 * 60 + 30 },
]

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
  if (!preset) return true
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
 * Cut points inside the shift from the selected personal windows,
 * including 06:00 when someone arrived at 04:45 (station change into the night round).
 */
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
  if (earlyArrival && six > shift.start && six < shift.end) cuts.add(six)
  return [...cuts].sort((a, b) => a - b)
}
