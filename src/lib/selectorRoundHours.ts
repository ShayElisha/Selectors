import { formatMinutes, parseClock, shiftModelAbsoluteEnd } from './shiftModels'
import type { ShiftModel } from '../types'

/** Org setting: exact round-swap hours for selectors, per shift model. */
export type SelectorRoundHoursSettings = {
  enabled: boolean
  /**
   * Intermediate swap points only (absolute minutes on the shift timeline).
   * Shift start/end come from the shift model.
   */
  byShift: Record<string, number[]>
}

export const EMPTY_SELECTOR_ROUND_HOURS: SelectorRoundHoursSettings = {
  enabled: false,
  byShift: {},
}

export function normalizeSelectorRoundHours(
  raw: unknown,
): SelectorRoundHoursSettings {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_SELECTOR_ROUND_HOURS }
  const src = raw as Record<string, unknown>
  const byShift: Record<string, number[]> = {}
  const rawBy =
    src.byShift && typeof src.byShift === 'object'
      ? (src.byShift as Record<string, unknown>)
      : {}
  for (const [shiftId, value] of Object.entries(rawBy)) {
    const id = String(shiftId || '').trim()
    if (!id || !Array.isArray(value)) continue
    const points = value
      .map((item) => Number(item))
      .filter((n) => Number.isFinite(n) && n >= 0)
      .map((n) => Math.round(n))
    if (points.length === 0) continue
    byShift[id] = [...new Set(points)].sort((a, b) => a - b)
  }
  return {
    enabled: src.enabled === true,
    byShift,
  }
}

/** Map a clock time (0–1439) onto the absolute overnight timeline of a shift. */
export function absoluteOnShift(
  clockMinutes: number,
  start: number,
  absoluteEnd: number,
): number {
  const day = 24 * 60
  let abs = ((clockMinutes % day) + day) % day
  if (absoluteEnd > day && abs < start) abs += day
  return abs
}

export function clockFromAbsolute(absoluteMinutes: number): number {
  const day = 24 * 60
  return ((absoluteMinutes % day) + day) % day
}

/**
 * Build ordered boundaries [start … end] from optional intermediate swaps.
 * Returns null when custom hours are off or there are no usable points.
 */
export function customBoundariesForShift(
  settings: SelectorRoundHoursSettings | null | undefined,
  shiftId: string,
  bounds: { start: number; end: number } | undefined,
): number[] | null {
  if (!settings?.enabled || !bounds) return null
  const swaps = settings.byShift[shiftId] ?? []
  const points = [bounds.start, ...swaps, bounds.end]
    .filter((n) => Number.isFinite(n))
    .map((n) => Math.round(n))
    .filter((n) => n >= bounds.start && n <= bounds.end)
  const unique = [...new Set(points)].sort((a, b) => a - b)
  if (unique.length < 2) return null
  if (unique[0] !== bounds.start) unique.unshift(bounds.start)
  if (unique[unique.length - 1] !== bounds.end) unique.push(bounds.end)
  return unique
}

/** Suggest intermediate swaps from a uniform round length. */
export function suggestSwapsFromDuration(
  start: number,
  absoluteEnd: number,
  roundMinutes: number,
): number[] {
  const step = Math.max(30, roundMinutes)
  const swaps: number[] = []
  let t = start + step
  while (t < absoluteEnd) {
    if (absoluteEnd - t >= 45) swaps.push(t)
    t += step
  }
  return swaps
}

export function swapsAsClockLabels(swaps: number[]): string[] {
  return swaps.map((m) => formatMinutes(clockFromAbsolute(m)))
}

export function parseSwapClocksForModel(
  clocks: string[],
  model: ShiftModel,
): number[] {
  const start = model.startMinutes
  const end = shiftModelAbsoluteEnd(model)
  const out: number[] = []
  for (const clock of clocks) {
    const parsed = parseClock(clock)
    if (parsed == null) continue
    const abs = absoluteOnShift(parsed, start, end)
    if (abs > start && abs < end) out.push(abs)
  }
  return [...new Set(out)].sort((a, b) => a - b)
}

export function formatSwapEditorRows(
  swaps: number[],
  model: ShiftModel,
): string[] {
  const start = model.startMinutes
  const end = shiftModelAbsoluteEnd(model)
  return swaps
    .filter((m) => m > start && m < end)
    .map((m) => formatMinutes(clockFromAbsolute(m)))
}

export function previewRoundLabels(
  start: number,
  absoluteEnd: number,
  swaps: number[],
): string[] {
  const points = [
    start,
    ...swaps.filter((s) => s > start && s < absoluteEnd),
    absoluteEnd,
  ]
  const unique = [...new Set(points)].sort((a, b) => a - b)
  const labels: string[] = []
  for (let i = 0; i < unique.length - 1; i++) {
    const a = unique[i]!
    const b = unique[i + 1]!
    labels.push(
      `${formatMinutes(clockFromAbsolute(a))}–${formatMinutes(clockFromAbsolute(b))}`,
    )
  }
  return labels
}
