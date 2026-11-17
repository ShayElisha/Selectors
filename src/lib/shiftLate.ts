import type { WindowAdjustment } from '../types'

export const SHIFT_LATE_OPTIONS = [
  { value: 0, label: 'בזמן' },
  { value: 15, label: '15 דק׳' },
  { value: 30, label: '30 דק׳' },
  { value: 45, label: '45 דק׳' },
  { value: 60, label: 'שעה' },
] as const

export type ShiftLateMinutes = (typeof SHIFT_LATE_OPTIONS)[number]['value']

export function clampShiftLateMinutes(value: unknown): ShiftLateMinutes {
  const n = Number(value)
  if (n === 15 || n === 30 || n === 45 || n === 60) return n
  return 0
}

/**
 * Effective late for a worker: personal override only.
 * Shift-wide default late was removed from the product.
 */
export function effectiveLateMinutes(opts: {
  workerId: string
  windowAdjustments?: Record<string, WindowAdjustment> | null
  /** @deprecated Ignored — kept for call-site compatibility with old drafts. */
  defaultLateMinutes?: number | null
}): number {
  void opts.defaultLateMinutes
  const personal = opts.windowAdjustments?.[opts.workerId]
  if (personal && Object.prototype.hasOwnProperty.call(personal, 'lateMinutes')) {
    return clampShiftLateMinutes(personal.lateMinutes)
  }
  return 0
}

/** Merge personal late/early for algorithm / badges. */
export function effectiveWindowAdjustment(opts: {
  workerId: string
  windowAdjustments?: Record<string, WindowAdjustment> | null
  /** @deprecated Ignored — kept for call-site compatibility with old drafts. */
  defaultLateMinutes?: number | null
}): WindowAdjustment | undefined {
  const personal = opts.windowAdjustments?.[opts.workerId]
  const late = effectiveLateMinutes(opts)
  const early = Number(personal?.earlyMinutes || 0)
  if (!late && !early) return undefined
  return {
    lateMinutes: late || undefined,
    earlyMinutes: early || undefined,
  }
}
