import { shiftBalanceDelta } from '../algorithm'
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
 * Net work by calendar month. Easy days pull the month down and hard
 * nights pull it up, without the 14-day floor, so the line can rise and fall.
 */
export function monthlyLoadTrend(
  history: ShiftSchedule[],
  lanes: Lane[],
): MonthLoad[] {
  const byId = new Map(lanes.map((lane) => [lane.id, lane]))
  const totals = new Map<string, number>()
  for (const shift of history) {
    const month = shift.date.slice(0, 7)
    if (!/^\d{4}-\d{2}$/.test(month)) continue
    let delta = 0
    for (const placement of shiftPlacements(shift)) {
      const lane = byId.get(placement.laneId)
      if (!lane) continue
      delta += shiftBalanceDelta(lane.intensity, shift.shiftType) * placement.weight
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

export function completedShiftCount(
  history: ShiftSchedule[],
  from?: string,
  to?: string,
): number {
  return history.filter((shift) => inRange(shift.date, from, to)).length
}
