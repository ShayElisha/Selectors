import {
  SHORT_RETURN_DAYS,
  buildWorkerProfile,
  isQualified,
  needsAfternoonNightRecovery,
} from '../algorithm'
import { effectiveStaffingStandard, type StaffingOverrides } from './shiftStaffing'
import type {
  Lane,
  LaneAssignment,
  ShiftSchedule,
  ShiftType,
  Worker,
} from '../types'

/** ASSUMPTION — max characters for a lane note shown in share/export. */
export const LANE_NOTE_MAX_LENGTH = 200

export type WarningSeverity = 'error' | 'warning' | 'info'

export type BoardIssue = {
  severity: 'error' | 'warning'
  code:
    | 'duplicate_worker'
    | 'unqualified'
    | 'short_return'
    | 'recovering_hard'
    | 'understaffed'
  message: string
  laneId?: string
  workerId?: string
}

export type BoardSnapshot = {
  assignments: { laneId: string; workerIds: string[]; notes: string }[]
}

/**
 * Classifies algorithm warning strings by Hebrew prefixes/patterns.
 * Fragile: depends on copy produced by the algorithm module — do not treat as a stable API.
 */
export function classifyWarning(text: string): WarningSeverity {
  const t = text.trim()
  if (
    t.includes('אין עובדים מוסמכים') ||
    t.includes('נשאר ריק') ||
    t.includes('מגבלת הסמכות')
  ) {
    return 'error'
  }
  if (t.startsWith('שיפור לוח:')) return 'info'
  if (
    t.includes('הורחב מאגר') ||
    t.includes('הורחבה העדפת') ||
    t.includes('התאוששות') ||
    t.includes('מרווח טוב') ||
    t.includes('סף') ||
    t.includes('מילוי תקן גובר') ||
    t.includes('הועדפו מועמדים') ||
    t.includes('חזרה קצרה')
  ) {
    return 'warning'
  }
  return 'warning'
}

/** Parse optimization info into Hebrew with pluralizeHe; null if not that message. */
export function formatOptimizationInfo(text: string): string | null {
  const n = parseOptimizationSwapCount(text)
  if (n == null || n <= 0) return null
  return optimizationInfoFromSwaps(n)
}

export function parseOptimizationSwapCount(text: string): number | null {
  const m = text.match(/^שיפור לוח:\s*(\d+)\s*החלפות/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

/** Cleaner pluralized optimization line from swap count. */
export function optimizationInfoFromSwaps(swaps: number): string {
  if (swaps <= 0) return ''
  if (swaps === 1) return 'בוצעה החלפה אחת לשיפור האיזון'
  if (swaps === 2) return 'בוצעו שתי החלפות לשיפור האיזון'
  return `בוצעו ${swaps} החלפות לשיפור האיזון`
}

export function snapshotBoard(
  assignments: LaneAssignment[],
): BoardSnapshot {
  return {
    assignments: assignments
      .map((a) => ({
        laneId: a.laneId,
        workerIds: a.workerIds.map((id) => id || ''),
        notes: a.notes?.trim() ?? '',
      }))
      .sort((a, b) => a.laneId.localeCompare(b.laneId)),
  }
}

export function boardsEqual(a: BoardSnapshot, b: BoardSnapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function countAssignmentChanges(
  baseline: BoardSnapshot,
  current: BoardSnapshot,
): number {
  const byId = new Map(baseline.assignments.map((a) => [a.laneId, a]))
  let n = 0
  for (const cur of current.assignments) {
    const prev = byId.get(cur.laneId)
    if (!prev) {
      n += 1
      continue
    }
    if (prev.notes !== cur.notes) n += 1
    const len = Math.max(prev.workerIds.length, cur.workerIds.length)
    for (let i = 0; i < len; i += 1) {
      if ((prev.workerIds[i] || '') !== (cur.workerIds[i] || '')) n += 1
    }
  }
  return n
}

export type StaffingChipKind = 'ok' | 'over' | 'under'

export function staffingChipKind(
  filled: number,
  standard: number,
): StaffingChipKind {
  if (filled > standard) return 'over'
  if (filled < standard) return 'under'
  return 'ok'
}

export function missingCertsForLane(
  worker: Worker,
  lane: Lane,
): string[] {
  return lane.requiredCertifications.filter(
    (c) => !worker.certifications.includes(c),
  )
}

export function validateBoard(opts: {
  assignments: LaneAssignment[]
  lanes: Lane[]
  workers: Worker[]
  history: ShiftSchedule[]
  date: string
  shiftType: ShiftType
  overrides?: StaffingOverrides | null
}): BoardIssue[] {
  const {
    assignments,
    lanes,
    workers,
    history,
    date,
    shiftType,
    overrides,
  } = opts
  const issues: BoardIssue[] = []
  const workerById = new Map(workers.map((w) => [w.id, w]))
  const laneById = new Map(lanes.map((l) => [l.id, l]))
  const seen = new Map<string, string>()

  for (const a of assignments) {
    const lane = laneById.get(a.laneId)
    if (!lane) continue
    const std = effectiveStaffingStandard(lane, overrides)
    const filled = a.workerIds.filter(Boolean).length
    if (filled < std) {
      issues.push({
        severity: 'error',
        code: 'understaffed',
        laneId: lane.id,
        message: `נתיב ${lane.name}: משובצים ${filled} מתוך תקן ${std}`,
      })
    }

    for (const wid of a.workerIds) {
      if (!wid) continue
      const prevLane = seen.get(wid)
      if (prevLane) {
        const w = workerById.get(wid)
        issues.push({
          severity: 'error',
          code: 'duplicate_worker',
          laneId: lane.id,
          workerId: wid,
          message: `${w?.fullName ?? 'בודק'} משובץ ביותר מנתיב אחד`,
        })
      } else {
        seen.set(wid, lane.id)
      }

      const w = workerById.get(wid)
      if (w && !isQualified(w, lane)) {
        const missing = missingCertsForLane(w, lane)
        issues.push({
          severity: 'warning',
          code: 'unqualified',
          laneId: lane.id,
          workerId: wid,
          message: `${w.fullName} ללא הסמכה לנתיב ${lane.name}${
            missing.length ? ` (חסר: ${missing.join(' · ')})` : ''
          } — שיבוץ ידני בלבד`,
        })
      }

      if (w && lane.intensity === 'hard') {
        const recovering = needsAfternoonNightRecovery(
          wid,
          history,
          date,
          shiftType,
        )
        if (recovering) {
          issues.push({
            severity: 'warning',
            code: 'recovering_hard',
            laneId: lane.id,
            workerId: wid,
            message: `${w.fullName} יצא/ה מלילה אתמול ושובץ/ה לנתיב קשה (${lane.name})`,
          })
        }
      }

      if (w) {
        const profile = buildWorkerProfile(
          wid,
          history,
          lanes,
          shiftType,
          date,
        )
        const days = profile.daysSinceLastVisit.get(lane.id)
        if (days != null && days <= SHORT_RETURN_DAYS) {
          const when =
            days <= 0.5
              ? 'מוקדם יותר היום'
              : days <= 1
                ? 'אתמול'
                : `לפני ${days} ימים`
          issues.push({
            severity: 'warning',
            code: 'short_return',
            laneId: lane.id,
            workerId: wid,
            message: `${w.fullName} חוזר/ת לנתיב ${lane.name} תוך ${SHORT_RETURN_DAYS} ימים (${when})`,
          })
        }
      }
    }
  }

  return issues
}

export function lastVisitLabel(
  days: number | undefined,
): string | null {
  if (days == null) return 'לא הייתה'
  if (days === 0) return 'מוקדם יותר היום'
  if (days === 1) return 'אתמול'
  return `לפני ${days} ימים`
}

export function pickExplainChips(reasons: string[]): string[] {
  const chips: string[] = []
  for (const r of reasons) {
    if (chips.length >= 4) break
    if (r.includes('סדר מילוי') || r.includes('#')) continue
    if (r.length > 48) chips.push(`${r.slice(0, 45)}…`)
    else chips.push(r)
  }
  if (chips.length === 0) {
    return reasons.slice(0, 3).map((r) =>
      r.length > 48 ? `${r.slice(0, 45)}…` : r,
    )
  }
  return chips
}

export function findWhyNotLine(reasons: string[]): string | null {
  const line = reasons.find((r) => r.includes('למה לא'))
  return line ?? null
}

export function partitionWarnings(warnings: string[]): {
  errors: string[]
  warnings: string[]
  info: string[]
} {
  const errors: string[] = []
  const warns: string[] = []
  const info: string[] = []
  for (const w of warnings) {
    const s = classifyWarning(w)
    if (s === 'error') errors.push(w)
    else if (s === 'info') info.push(w)
    else warns.push(w)
  }
  return { errors, warnings: warns, info }
}
