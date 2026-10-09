import { placementBalancePoints } from '../algorithm'
import { shiftPlacements } from './shiftPlacements'
import type { AuditLogEntry } from '../api'
import type { Lane, ShiftSchedule } from '../types'

export const WEEKDAY_LABELS = [
  'ראשון',
  'שני',
  'שלישי',
  'רביעי',
  'חמישי',
  'שישי',
  'שבת',
] as const

export interface WeekdayHardLoad {
  weekday: number
  label: string
  hard: number
}

export interface LaneUse {
  laneId: string
  name: string
  shifts: number
  filled: number
  /** Filled shift-equivalents divided by shifts the lane was open. */
  rate: number
}

export interface MonthLoad {
  month: string
  load: number
}

export interface OverrideReport {
  auto: number
  manual: number
  /** Manual overrides divided by automatic proposals. Null when there were none. */
  rate: number | null
}

function inRange(date: string, from?: string, to?: string): boolean {
  if (from && date < from) return false
  if (to && date > to) return false
  return true
}

function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00`).getDay()
}

/** Hard-lane work grouped by weekday, inside the chosen dates. */
export function hardLoadByWeekday(
  history: ShiftSchedule[],
  lanes: Lane[],
  from?: string,
  to?: string,
): WeekdayHardLoad[] {
  const intensity = new Map(lanes.map((lane) => [lane.id, lane.intensity]))
  const hard = Array.from({ length: 7 }, () => 0)
  for (const shift of history) {
    if (!inRange(shift.date, from, to)) continue
    const day = weekdayOf(shift.date)
    for (const placement of shiftPlacements(shift)) {
      if (intensity.get(placement.laneId) !== 'hard') continue
      hard[day] = (hard[day] ?? 0) + placement.weight
    }
  }
  return hard.map((value, weekday) => ({
    weekday,
    label: WEEKDAY_LABELS[weekday] ?? '',
    hard: Math.round(value * 10) / 10,
  }))
}

export function busiestHardWeekday(
  rows: WeekdayHardLoad[],
): WeekdayHardLoad | null {
  const ranked = [...rows].sort((a, b) => b.hard - a.hard || a.weekday - b.weekday)
  const top = ranked[0]
  if (!top || top.hard <= 0) return null
  return top
}

/** How full each lane was. A selector round counts as its share of the shift. */
export function laneUtilization(
  history: ShiftSchedule[],
  lanes: Lane[],
  from?: string,
  to?: string,
): LaneUse[] {
  const filled = new Map<string, number>()
  const shifts = new Map<string, number>()
  for (const shift of history) {
    if (!inRange(shift.date, from, to)) continue
    const seen = new Set<string>()
    for (const placement of shiftPlacements(shift)) {
      filled.set(
        placement.laneId,
        (filled.get(placement.laneId) ?? 0) + placement.weight,
      )
      seen.add(placement.laneId)
    }
    for (const laneId of shift.activeLaneIds) seen.add(laneId)
    for (const laneId of seen) {
      shifts.set(laneId, (shifts.get(laneId) ?? 0) + 1)
    }
  }
  return lanes
    .map((lane) => {
      const open = shifts.get(lane.id) ?? 0
      const used = filled.get(lane.id) ?? 0
      return {
        laneId: lane.id,
        name: lane.name,
        shifts: open,
        filled: Math.round(used * 10) / 10,
        rate: open > 0 ? used / open : 0,
      }
    })
    .filter((row) => row.shifts > 0)
    .sort((a, b) => b.rate - a.rate || b.filled - a.filled)
}

/**
 * Net work by calendar month. Someone who continues from morning into
 * the afternoon gets the afternoon points times 1.20. There is no 14-day
 * floor here, so the line can rise and fall.
 */
export function monthlyLoadTrend(
  history: ShiftSchedule[],
  lanes: Lane[],
): MonthLoad[] {
  const byId = new Map(lanes.map((lane) => [lane.id, lane]))
  const morningIds = new Map<string, Set<string>>()
  for (const shift of history) {
    if (shift.shiftType !== 'morning') continue
    const set = morningIds.get(shift.date) ?? new Set<string>()
    for (const placement of shiftPlacements(shift)) set.add(placement.workerId)
    const manager = shift.gateManagerWorkerId?.trim()
    if (manager) set.add(manager)
    morningIds.set(shift.date, set)
  }
  const totals = new Map<string, number>()
  for (const shift of history) {
    const month = shift.date.slice(0, 7)
    if (!/^\d{4}-\d{2}$/.test(month)) continue
    const continued = morningIds.get(shift.date)
    let delta = 0
    for (const placement of shiftPlacements(shift)) {
      const lane = byId.get(placement.laneId)
      if (!lane) continue
      delta +=
        placementBalancePoints(
          lane.intensity,
          shift.shiftType,
          continued?.has(placement.workerId) ?? false,
        ) * placement.weight
    }
    totals.set(month, (totals.get(month) ?? 0) + delta)
  }
  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, load]) => ({ month, load: Math.round(load * 10) / 10 }))
}

/** How often a saved change replaced the algorithm's proposal. */
export function overrideReport(
  logs: Pick<AuditLogEntry, 'action' | 'at'>[],
  from?: string,
  to?: string,
): OverrideReport {
  let auto = 0
  let manual = 0
  for (const row of logs) {
    const day = row.at.slice(0, 10)
    if (!inRange(day, from, to)) continue
    if (row.action === 'auto_assign') auto += 1
    else if (row.action === 'manual_assign' || row.action === 'manual_swap') {
      manual += 1
    }
  }
  return {
    auto,
    manual,
    rate: auto + manual > 0 ? manual / (auto + manual) : null,
  }
}

export type AssignmentFixKind = 'kept' | 'hard' | 'return' | 'handoff' | 'other'

export interface AssignmentHealth {
  kept: number
  hard: number
  return: number
  handoff: number
  other: number
  total: number
}

const FIX_TAGS: Record<Exclude<AssignmentFixKind, 'kept'>, string> = {
  hard: 'איכות:קשה',
  return: 'איכות:חזרה',
  handoff: 'איכות:החלפה',
  other: 'איכות:אחר',
}

export function assignmentFixTag(kind: Exclude<AssignmentFixKind, 'kept'>): string {
  return FIX_TAGS[kind]
}

export function primaryAssignmentFix(
  kinds: Array<Exclude<AssignmentFixKind, 'kept'>>,
): Exclude<AssignmentFixKind, 'kept'> {
  if (kinds.includes('handoff')) return 'handoff'
  if (kinds.includes('return')) return 'return'
  if (kinds.includes('hard')) return 'hard'
  return 'other'
}

export function assignmentFixKind(input: {
  intensity?: 'easy' | 'medium' | 'hard'
  afternoonHandoff?: boolean
  returnsToLastSeat?: boolean
}): Exclude<AssignmentFixKind, 'kept'> {
  if (input.afternoonHandoff) return 'handoff'
  if (input.returnsToLastSeat) return 'return'
  if (input.intensity === 'hard') return 'hard'
  return 'other'
}

function fixKindFromDetails(details: string): Exclude<AssignmentFixKind, 'kept'> {
  if (details.includes(FIX_TAGS.handoff)) return 'handoff'
  if (details.includes(FIX_TAGS.return)) return 'return'
  if (details.includes(FIX_TAGS.hard)) return 'hard'
  return 'other'
}

/** Pie slices for assignment quality: boards left as proposed, and why a person was moved. */
export function assignmentHealth(
  logs: Pick<AuditLogEntry, 'action' | 'at' | 'details'>[],
  from?: string,
  to?: string,
): AssignmentHealth {
  const health: AssignmentHealth = {
    kept: 0,
    hard: 0,
    return: 0,
    handoff: 0,
    other: 0,
    total: 0,
  }
  for (const row of logs) {
    const day = row.at.slice(0, 10)
    if (!inRange(day, from, to)) continue
    if (row.action === 'auto_assign') health.kept += 1
    else if (row.action === 'manual_assign' || row.action === 'manual_swap') {
      health[fixKindFromDetails(row.details || '')] += 1
    } else continue
    health.total += 1
  }
  return health
}

export function completedShiftCount(
  history: ShiftSchedule[],
  from?: string,
  to?: string,
): number {
  return history.filter((shift) => inRange(shift.date, from, to)).length
}
