import type { ShiftType, WorkerWindowPreset } from '../types'

export type { WorkerWindowPreset }

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

function clockDigits(minutes: number): string {
  const day = 24 * 60
  const m = ((minutes % day) + day) % day
  const h = Math.floor(m / 60)
  const min = m % 60
  return `${String(h).padStart(2, '0')}${String(min).padStart(2, '0')}`
}

function clockLabel(minutes: number): string {
  const digits = clockDigits(minutes)
  return `${digits.slice(0, 2)}:${digits.slice(2)}`
}

export function workerWindowIdFromTimes(start: number, end: number): string {
  return `${clockDigits(start)}-${clockDigits(end)}`
}

export function workerWindowLabelFromTimes(start: number, end: number): string {
  return `${clockLabel(start)}–${clockLabel(end)}`
}

// Worker window presets are stored in the database only.
// No fallback - must be configured in the database.

export function normalizeWorkerWindowPresets(
  raw: unknown,
): WorkerWindowPreset[] {
  if (!Array.isArray(raw)) return []
  const out: WorkerWindowPreset[] = []
  const seen = new Set<string>()
  raw.forEach((item, index) => {
    if (!item || typeof item !== 'object') return
    const row = item as Partial<WorkerWindowPreset>
    const start = Number(row.start)
    const end = Number(row.end)
    if (!Number.isFinite(start) || !Number.isFinite(end)) return
    if (start === end) return
    const startMinutes = Math.max(0, Math.round(start))
    const endMinutes = Math.max(0, Math.round(end))
    const id =
      String(row.id || '').trim() ||
      workerWindowIdFromTimes(startMinutes, endMinutes)
    if (!id || seen.has(id)) return
    seen.add(id)
    const customName = String(row.name || '').trim() || undefined
    const label =
      String(row.label || '').trim() ||
      customName ||
      workerWindowLabelFromTimes(startMinutes, endMinutes)
    out.push({
      id,
      label,
      name: customName,
      start: startMinutes,
      end: endMinutes,
      order: Number.isFinite(Number((row as { order?: number }).order))
        ? Number((row as { order?: number }).order)
        : index,
    })
  })
  return out.sort(
    (a, b) =>
      (a.order ?? 0) - (b.order ?? 0) ||
      a.start - b.start ||
      a.end - b.end ||
      a.label.localeCompare(b.label, 'he'),
  )
}

/** Saved presets for this module from the database. */
export function resolveWorkerWindows(
  saved?: WorkerWindowPreset[] | null,
): WorkerWindowPreset[] {
  return normalizeWorkerWindowPresets(saved)
}

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
  catalog?: WorkerWindowPreset[] | null,
): boolean {
  const preset = workerWindowById(windowId, catalog)
  if (!preset) return false
  const source = MAIN_SHIFT_BOUNDS[sourceType]
  const target = MAIN_SHIFT_BOUNDS[targetType]
  if (!source || !target) return false
  const span = windowInterval(preset, targetType)
  if (!(span.start < target.end && span.end > target.start)) return false
  const personalEnd = windowInterval(preset, sourceType).end
  return personalEnd > source.end
}

export type ContinuingAttendanceSource = {
  date: string
  shiftType: string
  audience?: string
  updatedAt: string
  presentWorkerIds: string[]
  gateManagerWorkerId?: string
  workerWindows?: Record<string, string>
  windowAdjustments?: Record<
    string,
    { lateMinutes?: number; earlyMinutes?: number }
  >
}

export type ContinuingAttendance = {
  workerIds: string[]
  workerWindows: Record<string, string>
  windowAdjustments: Record<
    string,
    { lateMinutes?: number; earlyMinutes?: number }
  >
  gateManagerWorkerId?: string
  /** At least one earlier same-day shift was found. */
  sourceFound: boolean
  /** Earlier shift had any personal-hour entries at all. */
  sourceHadWindows: boolean
}

/**
 * Workers from earlier same-day shifts whose personal hours continue into
 * the target shift — used to pre-mark attendance on the next shift.
 */
export function collectContinuingAttendance(opts: {
  history: ContinuingAttendanceSource[]
  date: string
  shiftType: ShiftType
  audience?: string
  catalog?: WorkerWindowPreset[] | null
}): ContinuingAttendance {
  const sourceTypes = earlierShiftsToContinue(opts.shiftType)
  const empty: ContinuingAttendance = {
    workerIds: [],
    workerWindows: {},
    windowAdjustments: {},
    sourceFound: false,
    sourceHadWindows: false,
  }
  if (sourceTypes.length === 0) return empty

  const audience = opts.audience ?? 'inspector'
  const workerIds: string[] = []
  const workerWindows: Record<string, string> = {}
  const windowAdjustments: ContinuingAttendance['windowAdjustments'] = {}
  let gateManagerWorkerId: string | undefined
  let sourceFound = false
  let sourceHadWindows = false

  const consider = (
    source: ContinuingAttendanceSource,
    sourceType: ShiftType,
    id: string,
  ) => {
    const saved = source.workerWindows?.[id]
    if (
      !continuesIntoShift(sourceType, saved, opts.shiftType, opts.catalog)
    ) {
      return false
    }
    if (!workerIds.includes(id)) workerIds.push(id)
    if (
      saved &&
      workerWindowById(saved, opts.catalog) &&
      !workerWindows[id]
    ) {
      workerWindows[id] = saved
    }
    const adjustment = source.windowAdjustments?.[id]
    if (adjustment && !windowAdjustments[id]) {
      windowAdjustments[id] = { ...adjustment }
    }
    return true
  }

  // Process the closest preceding shift first so its personal-hour choice and
  // adjustments win when the same worker appears in multiple earlier shifts.
  for (const sourceType of [...sourceTypes].reverse()) {
    const matches = opts.history.filter(
      (shift) => shift.date === opts.date && shift.shiftType === sourceType,
    )
    const sameAudience = matches.filter(
      (shift) => (shift.audience ?? 'inspector') === audience,
    )
    const source = (sameAudience.length > 0 ? sameAudience : matches).sort(
      (a, b) => b.updatedAt.localeCompare(a.updatedAt),
    )[0]
    if (!source) continue
    sourceFound = true
    if (Object.keys(source.workerWindows ?? {}).length > 0) {
      sourceHadWindows = true
    }
    for (const id of source.presentWorkerIds) {
      consider(source, sourceType, id)
    }
    const sourceGate = source.gateManagerWorkerId?.trim()
    if (sourceGate && consider(source, sourceType, sourceGate) && !gateManagerWorkerId) {
      gateManagerWorkerId = sourceGate
    }
  }

  return {
    workerIds,
    workerWindows,
    windowAdjustments,
    ...(gateManagerWorkerId ? { gateManagerWorkerId } : {}),
    sourceFound,
    sourceHadWindows,
  }
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

export function workerWindowById(
  id: string | undefined,
  catalog?: WorkerWindowPreset[] | null,
): WorkerWindowPreset | undefined {
  if (!id) return undefined
  const list = catalog ?? []
  return list.find((w) => w.id === id)
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

const WINDOW_STEPS = [0, 15, 30, 45, 60]

/** Late arrival or early leave, snapped to a quarter hour, at most one hour. */
export function clampWindowStep(value: unknown): number {
  const n = Number(value)
  return WINDOW_STEPS.includes(n) ? n : 0
}

/** A round is assignable only when it sits fully inside the person's hours. */
export function windowCoversRound(
  windowId: string | undefined,
  shiftType: ShiftType,
  roundStart: number,
  roundEnd: number,
  adjustment?: { lateMinutes?: number; earlyMinutes?: number },
  catalog?: WorkerWindowPreset[] | null,
): boolean {
  const preset = workerWindowById(windowId, catalog)
  const shift = MAIN_SHIFT_BOUNDS[shiftType]
  const late = clampWindowStep(adjustment?.lateMinutes)
  const early = clampWindowStep(adjustment?.earlyMinutes)
  if (!shift) return Boolean(windowId)
  if (!preset) {
    return roundStart >= shift.start + late && roundEnd <= shift.end - early
  }
  const span = windowInterval(preset, shiftType)
  return roundStart >= span.start + late && roundEnd <= span.end - early
}

/**
 * Whether a personal window may be used on this official shift.
 * - No window → whole shift (eligible).
 * - Native window starts at/near the shift start (or earlier for morning).
 * - Long morning windows may continue into afternoon only via continuesIntoShift.
 */
export function windowFitsShift(
  windowId: string | undefined,
  shiftType: ShiftType,
  catalog?: WorkerWindowPreset[] | null,
): boolean {
  if (!windowId) return true
  const preset = workerWindowById(windowId, catalog)
  const shift = MAIN_SHIFT_BOUNDS[shiftType]
  if (!preset || !shift) return false
  const span = windowInterval(preset, shiftType)
  if (!(span.start < shift.end && span.end > shift.start)) return false

  const nativeSlack = 15
  const native =
    span.start >= shift.start - nativeSlack &&
    span.start <= shift.start + nativeSlack
  if (native) return span.end > shift.start

  if (span.start < shift.start && span.end > shift.start) {
    const earlier = earlierShiftsToContinue(shiftType)
    if (earlier.length === 0) return true
    return earlier.some((source) =>
      continuesIntoShift(source, windowId, shiftType, catalog),
    )
  }
  return false
}

export function presetsOverlappingShift(
  shiftType: ShiftType,
  catalog?: WorkerWindowPreset[] | null,
): WorkerWindowPreset[] {
  const list = catalog ?? []
  return list.filter((preset) =>
    windowFitsShift(preset.id, shiftType, catalog),
  )
}

/**
 * Share of one official shift covered by a worker's personal hours
 * (window + late/early). Full overlap → 1; partial hours → fraction.
 * Used for single-board (inspector) load / statistics weighting.
 */
export function boardHoursWeight(opts: {
  shiftType: ShiftType
  windowId?: string | null
  lateMinutes?: number | null
  earlyMinutes?: number | null
  catalog?: WorkerWindowPreset[] | null
}): number {
  const shift = MAIN_SHIFT_BOUNDS[opts.shiftType]
  if (!shift) return 1
  const late = clampWindowStep(opts.lateMinutes)
  const early = clampWindowStep(opts.earlyMinutes)
  const preset = workerWindowById(opts.windowId ?? undefined, opts.catalog)
  const personal = preset
    ? windowInterval(preset, opts.shiftType)
    : { start: shift.start, end: shift.end }
  const start = Math.max(personal.start + late, shift.start)
  const end = Math.min(personal.end - early, shift.end)
  const worked = Math.max(0, end - start)
  const full = Math.max(1, shift.end - shift.start)
  return Math.min(1, worked / full)
}

/**
 * Morning board normally starts at 06:00. People who arrive at 04:45
 * need a leading round so they can sit with the night shift until 06:00.
 */
export function boardStartMinutes(
  shiftType: ShiftType,
  windowIds: Array<string | undefined>,
  catalog?: WorkerWindowPreset[] | null,
): number {
  const shift = MAIN_SHIFT_BOUNDS[shiftType]
  if (!shift) return 6 * 60
  let start = shift.start
  const early = 4 * 60 + 45
  if (!windowIds.some((id) => workerWindowById(id, catalog)?.start === early))
    return start
  const mapped = onShiftClock(early, shiftType)
  if (mapped < start && start - mapped <= 3 * 60) start = mapped
  return start
}

export function roundCutsForWindows(
  shiftType: ShiftType,
  windowIds: Array<string | undefined>,
  catalog?: WorkerWindowPreset[] | null,
): number[] {
  const shift = MAIN_SHIFT_BOUNDS[shiftType]
  if (!shift) return []
  const cuts = new Set<number>()
  let earlyArrival = false
  for (const id of windowIds) {
    const preset = workerWindowById(id, catalog)
    if (!preset) continue
    if (preset.start === 4 * 60 + 45) earlyArrival = true
    const span = windowInterval(preset, shiftType)
    for (const point of [span.start, span.end]) {
      if (point > shift.start && point < shift.end) cuts.add(point)
    }
  }
  const six = onShiftClock(6 * 60, shiftType)
  const openedAt = boardStartMinutes(shiftType, windowIds, catalog)
  if (earlyArrival && six > openedAt && six < shift.end) cuts.add(six)
  return [...cuts].sort((a, b) => a - b)
}
