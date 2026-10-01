import { MAIN_SHIFT_BOUNDS } from './shiftCatalog'
import { formatMinutes } from './shiftModels'
import type { ShiftType } from '../types'

export function earlyLeaveOptions(shiftType: ShiftType): { minutes: number; label: string }[] {
  const bounds = MAIN_SHIFT_BOUNDS[shiftType]
  if (!bounds) return []
  const options: { minutes: number; label: string }[] = []
  for (let clock = bounds.start + 30; clock < bounds.end; clock += 30) {
    const minutes = clock >= 24 * 60 ? clock - 24 * 60 : clock
    options.push({ minutes, label: formatMinutes(minutes) })
  }
  return options
}

export function earlyLeaveCutoff(shiftType: ShiftType, leaveMinutes: number): number {
  const bounds = MAIN_SHIFT_BOUNDS[shiftType]
  if (bounds && bounds.end > 24 * 60 && leaveMinutes < 12 * 60) return leaveMinutes + 24 * 60
  return leaveMinutes
}
export function earlyLeaveFraction(shiftType: ShiftType, leaveMinutes: number): number {
  const bounds = MAIN_SHIFT_BOUNDS[shiftType]
  if (!bounds) return 1
  const start = bounds.start
  const end = bounds.end
  let at = leaveMinutes
  if (end > 24 * 60 && at < 12 * 60) at += 24 * 60
  const span = Math.max(1, end - start)
  return Math.min(1, Math.max(0, at - start) / span)
}
