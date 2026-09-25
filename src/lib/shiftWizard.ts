import { isQualified } from '../algorithm'
import { normalizeHeSearch } from './trackingHeatmap'
import {
  effectiveStaffingStandard,
  normalizeStaffingOverrides,
  type StaffingOverrides,
} from './shiftStaffing'
import { orderedCertifications } from './workersHelpers'
import { formatShiftDate, pluralizeHe } from './hebrew'
import type { Lane, ShiftSchedule, ShiftType, Worker } from '../types'

/**
 * ASSUMPTION — "ok" means at least one spare qualified-present inspector
 * beyond the lane תקן (K >= standard + FEASIBILITY_OK_MARGIN).
 */
export const FEASIBILITY_OK_MARGIN = 1

export type FeasibilityStatus = 'ok' | 'tight' | 'insufficient'

export type LaneFeasibility = {
  laneId: string
  laneName: string
  standard: number
  qualified: number
  status: FeasibilityStatus
  /** e.g. missing cert requirement messages */
  messages: string[]
}

export type FeasibilityPreview = {
  lanes: LaneFeasibility[]
  present: number
  totalStandard: number
  /** present - totalStandard (can be negative) */
  surplus: number
  insufficientCount: number
  tightCount: number
}

export function feasibilityStatus(
  qualified: number,
  standard: number,
): FeasibilityStatus {
  if (qualified < standard) return 'insufficient'
  if (qualified < standard + FEASIBILITY_OK_MARGIN) return 'tight'
  return 'ok'
}

/**
 * Preliminary staffing check for the wizard.
 * Per-lane K >= standard is necessary but NOT sufficient: the same qualified
 * inspectors may be counted toward multiple lanes.
 */
export function computeFeasibilityPreview(
  lanes: Lane[],
  activeLaneIds: string[],
  presentWorkerIds: string[],
  workers: Worker[],
  overrides?: StaffingOverrides | null,
): FeasibilityPreview {
  const presentWorkers = workers.filter((w) =>
    presentWorkerIds.includes(w.id),
  )
  const activeSet = new Set(activeLaneIds)
  const selected = lanes.filter((l) => activeSet.has(l.id))
  let totalStandard = 0
  let insufficientCount = 0
  let tightCount = 0
  const rows: LaneFeasibility[] = []

  for (const lane of selected) {
    const standard = effectiveStaffingStandard(lane, overrides)
    totalStandard += standard
    const probe: Lane = { ...lane, staffingStandard: standard }
    let qualified = 0
    for (const w of presentWorkers) {
      if (isQualified(w, probe)) qualified += 1
    }
    const status = feasibilityStatus(qualified, standard)
    if (status === 'insufficient') insufficientCount += 1
    if (status === 'tight') tightCount += 1

    const messages: string[] = []
    if (status === 'insufficient' && lane.requiredCertifications.length > 0) {
      const missingCerts = lane.requiredCertifications.filter(
        (c) => !presentWorkers.some((w) => w.certifications.includes(c)),
      )
      if (missingCerts.length > 0) {
        messages.push(
          `נתיב ${lane.name} דורש ${missingCerts.join(' · ')}, ואין נוכח עם ההסמכה`,
        )
      } else {
        messages.push(
          `נתיב ${lane.name}: ${qualified} מוסמכים נוכחים מתוך תקן ${standard}`,
        )
      }
    } else if (status === 'insufficient') {
      messages.push(
        `נתיב ${lane.name}: ${qualified} נוכחים מתוך תקן ${standard}`,
      )
    }

    rows.push({
      laneId: lane.id,
      laneName: lane.name,
      standard,
      qualified,
      status,
      messages,
    })
  }

  const present = presentWorkers.length
  return {
    lanes: rows,
    present,
    totalStandard,
    surplus: present - totalStandard,
    insufficientCount,
    tightCount,
  }
}

export function canAdvanceFromLanes(activeLaneCount: number): {
  ok: boolean
  reason: string | null
} {
  if (activeLaneCount === 0) {
    return { ok: false, reason: 'בחרו לפחות נתיב אחד' }
  }
  return { ok: true, reason: null }
}

export function canAdvanceFromAttendance(presentCount: number): {
  ok: boolean
  reason: string | null
} {
  if (presentCount === 0) {
    return { ok: false, reason: 'סמנו לפחות בודק נוכח אחד' }
  }
  return { ok: true, reason: null }
}

export function lanesStepSummary(
  activeCount: number,
  totalStandard: number,
): string {
  return `${pluralizeHe(activeCount, {
    one: 'נתיב אחד',
    two: 'שני נתיבים',
    many: 'נתיבים',
  })} · תקן ${totalStandard}`
}

export function attendanceStepSummary(
  present: number,
  activeInspectors: number,
): string {
  return `${present} מתוך ${activeInspectors} נוכחים`
}

export function mostRecentShiftOfType(
  history: ShiftSchedule[],
  shiftType: ShiftType,
  excludeId?: string,
): ShiftSchedule | null {
  let best: ShiftSchedule | null = null
  for (const h of history) {
    if (h.shiftType !== shiftType) continue
    if (excludeId && h.id === excludeId) continue
    if (!best) {
      best = h
      continue
    }
    const byDate = h.date.localeCompare(best.date)
    if (byDate > 0) best = h
    else if (byDate === 0 && h.updatedAt > best.updatedAt) best = h
  }
  return best
}

export function laneSelectionFromShift(shift: ShiftSchedule): {
  laneIds: string[]
  staffingOverrides: StaffingOverrides
  hadSavedStandards: boolean
} {
  const staffingOverrides: StaffingOverrides = {
    ...normalizeOverrides(shift.staffingOverrides),
  }
  return {
    laneIds: [...shift.activeLaneIds],
    staffingOverrides,
    hadSavedStandards: Object.keys(staffingOverrides).length > 0,
  }
}

function normalizeOverrides(
  raw: StaffingOverrides | undefined,
): StaffingOverrides {
  return normalizeStaffingOverrides(raw)
}

export function presentIdsFromShift(shift: ShiftSchedule): string[] {
  return [...shift.presentWorkerIds]
}

export function workerMatchesNameQuery(
  worker: Pick<Worker, 'fullName'>,
  query: string,
): boolean {
  const q = normalizeHeSearch(query)
  if (!q) return true
  return normalizeHeSearch(worker.fullName).includes(q)
}

export function orderedCertChips(
  catalog: string[],
  held: string[],
): string[] {
  return orderedCertifications(catalog, held)
}

export function relativeDayLabel(
  isoDate: string,
  now = new Date(),
): 'היום' | 'מחר' | 'אתמול' | null {
  const [y, m, d] = isoDate.split('-').map(Number)
  if (!y || !m || !d) return null
  const target = new Date(y, m - 1, d)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const diff = Math.round(
    (target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000),
  )
  if (diff === 0) return 'היום'
  if (diff === 1) return 'מחר'
  if (diff === -1) return 'אתמול'
  return null
}

export function weekdayHe(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  if (!y || !m || !d) return ''
  return new Date(y, m - 1, d).toLocaleDateString('he-IL', { weekday: 'long' })
}

export function formatSetupDateLine(isoDate: string, now = new Date()): string {
  const rel = relativeDayLabel(isoDate, now)
  const base = `${weekdayHe(isoDate)} · ${formatShiftDate(isoDate)}`
  return rel ? `${base} · ${rel}` : base
}

export function shiftWindowDisplay(shiftType: ShiftType): string {
  if (shiftType === 'morning') return '06:00 עד 14:30'
  if (shiftType === 'afternoon') return '14:30 עד 21:30'
  return '21:30 עד 06:00 (למחרת)'
}

export function deficitMessage(preview: FeasibilityPreview): string | null {
  if (preview.surplus >= 0) return null
  const missing = Math.abs(preview.surplus)
  return `חסרים ${missing} בודקים לתקן הכולל`
}
