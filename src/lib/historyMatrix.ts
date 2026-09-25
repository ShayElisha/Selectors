import { SHIFT_TYPE_LABELS } from '../constants'
import type { Lane, ShiftSchedule, ShiftType, Worker } from '../types'

const SHIFT_ORDER: Record<ShiftType, number> = {
  morning: 0,
  afternoon: 1,
  afternoonA: 1,
  afternoonB: 2,
  night: 3,
}

export interface HistoryColumn {
  key: string
  date: string
  shiftType: ShiftType
  shiftId: string
  dateLabel: string
  shiftLabel: string
}

export interface HistoryMatrixCell {
  laneNames: string[]
  presentOnly: boolean
}

export interface HistoryMatrixRow {
  workerId: string
  fullName: string
  cells: Record<string, HistoryMatrixCell>
}

function formatDateShort(date: string): string {
  try {
    return new Date(date + 'T12:00:00').toLocaleDateString('he-IL', {
      day: 'numeric',
      month: 'numeric',
    })
  } catch {
    return date
  }
}

function columnKey(date: string, shiftType: ShiftType, shiftId: string): string {
  return `${date}|${shiftType}|${shiftId}`
}

/**
 * Build worker × (date+shift) matrix with lane placements.
 * Columns ordered oldest→newest so in RTL they run right→left.
 * Within a day: morning → afternoon → night.
 */
export function buildHistoryMatrix(
  workers: Worker[],
  lanes: Lane[],
  history: ShiftSchedule[],
  options?: { fromDate?: string; toDate?: string },
): { columns: HistoryColumn[]; rows: HistoryMatrixRow[] } {
  const laneName = new Map(lanes.map((l) => [l.id, l.name]))
  const filtered = history.filter((h) => {
    if (options?.fromDate && h.date < options.fromDate) return false
    if (options?.toDate && h.date > options.toDate) return false
    return true
  })

  // Prefer latest revision per date+shiftType
  const bySlot = new Map<string, ShiftSchedule>()
  for (const h of filtered) {
    const slot = `${h.date}|${h.shiftType}`
    const prev = bySlot.get(slot)
    if (!prev || h.updatedAt > prev.updatedAt) bySlot.set(slot, h)
  }

  const shifts = [...bySlot.values()].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date)
    return SHIFT_ORDER[a.shiftType] - SHIFT_ORDER[b.shiftType]
  })

  const columns: HistoryColumn[] = shifts.map((h) => ({
    key: columnKey(h.date, h.shiftType, h.id),
    date: h.date,
    shiftType: h.shiftType,
    shiftId: h.id,
    dateLabel: formatDateShort(h.date),
    shiftLabel: SHIFT_TYPE_LABELS[h.shiftType],
  }))

  const workerIdsInHistory = new Set<string>()
  for (const h of shifts) {
    for (const a of h.assignments) {
      for (const wid of a.workerIds) {
        if (wid) workerIdsInHistory.add(wid)
      }
    }
    for (const wid of h.presentWorkerIds ?? []) workerIdsInHistory.add(wid)
  }

  const rowWorkers = workers
    .filter(
      (w) =>
        (w.status === 'active' && w.isInspector) ||
        workerIdsInHistory.has(w.id),
    )
    .slice()
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'he'))

  // Ensure anyone in history who was deleted still appears
  for (const id of workerIdsInHistory) {
    if (!rowWorkers.some((w) => w.id === id)) {
      rowWorkers.push({
        id,
        fullName: id,
        phone: '',
        certifications: [],
        status: 'inactive',
        isInspector: true,
        isManager: false,
      })
    }
  }
  rowWorkers.sort((a, b) => a.fullName.localeCompare(b.fullName, 'he'))

  const rows: HistoryMatrixRow[] = rowWorkers.map((w) => {
    const cells: Record<string, HistoryMatrixCell> = {}
    for (const h of shifts) {
      const key = columnKey(h.date, h.shiftType, h.id)
      const laneNames: string[] = []
      for (const a of h.assignments) {
        if (!a.workerIds.includes(w.id)) continue
        laneNames.push(laneName.get(a.laneId) ?? a.laneId)
      }
      const isGate = h.gateManagerWorkerId === w.id
      const presentOnly =
        laneNames.length === 0 &&
        !isGate &&
        (h.presentWorkerIds ?? []).includes(w.id)
      if (isGate && laneNames.length === 0) {
        cells[key] = { laneNames: ['מנהל שער'], presentOnly: false }
      } else if (laneNames.length > 0 || presentOnly) {
        cells[key] = { laneNames, presentOnly }
      }
    }
    return { workerId: w.id, fullName: w.fullName, cells }
  })

  // Drop workers with no cells in range
  const rowsWithData = rows.filter((r) => Object.keys(r.cells).length > 0)

  return { columns, rows: rowsWithData }
}
