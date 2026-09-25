import { formatShiftDateShort, pluralizeHe } from './hebrew'
import { normalizeHeSearch, workerMatchesSearch } from './trackingHeatmap'
import { effectiveStaffingStandard } from './shiftStaffing'
import type { Lane, ShiftSchedule, ShiftType, Worker } from '../types'

export const SHIFT_SLOT_ORDER: ShiftType[] = [
  'morning',
  'afternoonA',
  'afternoon',
  'afternoonB',
  'night',
]

export interface DaySlot {
  shiftType: ShiftType
  shift: ShiftSchedule | null
  /** Selector round-board for the same date and shift type, when saved. */
  selectorShift: ShiftSchedule | null
}

export interface HistoryDayCard {
  date: string
  slots: DaySlot[]
}

export type PresentHealth =
  | { kind: 'ok' }
  | { kind: 'unassigned'; count: number; workerIds: string[] }

/** Distinct assigned worker ids on a saved shift. */
export function assignedWorkerIds(shift: ShiftSchedule): string[] {
  const ids = new Set<string>()
  const sources = shift.rounds?.length
    ? shift.rounds.flatMap((round) => round.assignments)
    : shift.assignments
  for (const a of sources) {
    for (const id of a.workerIds) {
      if (id) ids.add(id)
    }
  }
  return [...ids]
}

/** Present vs assigned health from the saved record only. */
export function presentAssignedHealth(shift: ShiftSchedule): PresentHealth {
  const assigned = new Set(assignedWorkerIds(shift))
  const gate = shift.gateManagerWorkerId?.trim() || ''
  const missing = shift.presentWorkerIds.filter(
    (id) => id && id !== gate && !assigned.has(id),
  )
  if (missing.length === 0) return { kind: 'ok' }
  return { kind: 'unassigned', count: missing.length, workerIds: missing }
}

export function countPlaced(shift: ShiftSchedule): number {
  return assignedWorkerIds(shift).length
}

/** Group filtered shifts into day cards with morning/afternoon/night slots (newest first). */
export function groupHistoryDays(
  history: ShiftSchedule[],
  options?: { fromDate?: string; toDate?: string },
): HistoryDayCard[] {
  const filtered = history.filter((h) => {
    if (options?.fromDate && h.date < options.fromDate) return false
    if (options?.toDate && h.date > options.toDate) return false
    return true
  })

  const byDate = new Map<
    string,
    Map<ShiftType, { inspector: ShiftSchedule | null; selector: ShiftSchedule | null }>
  >()
  for (const h of filtered) {
    const map = byDate.get(h.date) ?? new Map()
    const pair = map.get(h.shiftType) ?? { inspector: null, selector: null }
    const key = h.audience === 'selector' ? 'selector' : 'inspector'
    const prev = pair[key]
    if (!prev || h.updatedAt > prev.updatedAt) pair[key] = h
    map.set(h.shiftType, pair)
    byDate.set(h.date, map)
  }

  return [...byDate.keys()]
    .sort((a, b) => b.localeCompare(a))
    .map((date) => {
      const map = byDate.get(date)!
      return {
        date,
        slots: SHIFT_SLOT_ORDER.map((shiftType) => {
          const pair = map.get(shiftType)
          return {
            shiftType,
            shift: pair?.inspector ?? null,
            selectorShift: pair?.selector ?? null,
          }
        }),
      }
    })
}

export function todayISO(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

export function daysAgoISO(days: number, now = new Date()): string {
  const d = new Date(now)
  d.setDate(d.getDate() - days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Weekday + relative label for a day card header. */
export function historyDayLabel(
  isoDate: string,
  now = new Date(),
): { relative: string | null; weekday: string; dateText: string } {
  const today = todayISO(now)
  const y = new Date(now)
  y.setDate(y.getDate() - 1)
  const yesterday = todayISO(y)

  let relative: string | null = null
  if (isoDate === today) relative = 'היום'
  else if (isoDate === yesterday) relative = 'אתמול'

  let weekday = ''
  try {
    weekday = new Date(`${isoDate}T12:00:00`).toLocaleDateString('he-IL', {
      weekday: 'long',
    })
  } catch {
    weekday = ''
  }

  return {
    relative,
    weekday,
    dateText: formatShiftDateShort(isoDate, now),
  }
}

export function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7)
}

export function monthSeparatorLabel(isoMonth: string): string {
  const [y, m] = isoMonth.split('-').map(Number)
  if (!y || !m) return isoMonth
  try {
    return new Date(y, m - 1, 1).toLocaleDateString('he-IL', {
      month: 'long',
      year: 'numeric',
    })
  } catch {
    return isoMonth
  }
}

export function shiftMatchesSearch(
  shift: ShiftSchedule,
  query: string,
  workersById: Map<string, Worker>,
): boolean {
  const q = normalizeHeSearch(query)
  if (!q) return true
  for (const id of assignedWorkerIds(shift)) {
    const name = workersById.get(id)?.fullName
    if (name && workerMatchesSearch(name, query)) return true
  }
  for (const id of shift.presentWorkerIds) {
    const name = workersById.get(id)?.fullName
    if (name && workerMatchesSearch(name, query)) return true
  }
  return false
}

export function filterDayCards(
  days: HistoryDayCard[],
  opts: {
    search: string
    shiftTypes: Set<ShiftType> | 'all'
    workersById: Map<string, Worker>
  },
): HistoryDayCard[] {
  return days.filter((day) =>
    day.slots.some((slot) => {
      const shifts = [slot.shift, slot.selectorShift].filter(
        (s): s is ShiftSchedule => Boolean(s),
      )
      if (shifts.length === 0) return false
      if (opts.shiftTypes !== 'all' && !opts.shiftTypes.has(slot.shiftType)) {
        return false
      }
      if (!opts.search.trim()) return true
      return shifts.some((shift) =>
        shiftMatchesSearch(shift, opts.search, opts.workersById),
      )
    }),
  )
}

export function laneRowsForShift(
  shift: ShiftSchedule,
  lanesById: Map<string, Lane>,
): {
  laneId: string
  name: string
  intensity: Lane['intensity'] | null
  staffingStandard: number | null
  workerIds: string[]
}[] {
  return shift.assignments
    .map((a) => {
      const lane = lanesById.get(a.laneId)
      return {
        laneId: a.laneId,
        name: lane?.name ?? 'נתיב שהוסר',
        intensity: lane?.intensity ?? null,
        staffingStandard: lane
          ? effectiveStaffingStandard(lane, shift.staffingOverrides)
          : null,
        workerIds: a.workerIds.filter(Boolean),
      }
    })
    .filter((r) => r.workerIds.length > 0 || shift.activeLaneIds.includes(r.laneId))
}

export function buildHistoryBackupJson(data: {
  workers: Worker[]
  lanes: Lane[]
  history: ShiftSchedule[]
  certificationsCatalog: string[]
  revision?: number
}): string {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      revision: data.revision ?? 0,
      workers: data.workers,
      lanes: data.lanes,
      history: data.history,
      certificationsCatalog: data.certificationsCatalog,
    },
    null,
    2,
  )
}

export function downloadTextFile(
  contents: string,
  filename: string,
  mime: string,
): void {
  const blob = new Blob([contents], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function shiftCountsLabel(shift: ShiftSchedule): string {
  const lanes = shift.activeLaneIds.length
  const placed = countPlaced(shift)
  const present = shift.presentWorkerIds.length
  const parts = [
    pluralizeHe(lanes, {
      one: 'נתיב אחד',
      two: 'שני נתיבים',
      many: 'נתיבים',
    }),
    pluralizeHe(placed, {
      one: 'משובץ אחד',
      two: 'שני משובצים',
      many: 'משובצים',
    }),
    pluralizeHe(present, {
      one: 'נוכח אחד',
      two: 'שני נוכחים',
      many: 'נוכחים',
    }),
  ]
  if (shift.audience === 'selector') {
    const rounds = shift.rounds?.length ?? 0
    parts.unshift(
      rounds > 0 ? `סלקטורים · ${rounds} סבבים` : 'סלקטורים',
    )
  }
  return parts.join(' · ')
}
