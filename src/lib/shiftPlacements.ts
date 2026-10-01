import { usesRounds } from './assignmentMode'
import type { ShiftSchedule } from '../types'

export interface ShiftPlacement {
  laneId: string
  workerId: string
  /**
   * Share of one full shift this cell represents.
   * A lane board placement is 1.
   * A selector round is that round's minutes divided by the shift's rounds,
   * so a person who works every round still totals about one shift.
   * A mid-shift segment is the minutes sat divided by the full shift.
   */
  weight: number
  /** Selector rounds only: index inside `shift.rounds`. */
  roundIndex?: number
  /** Selector rounds only: clock label, e.g. 06:00–08:00. */
  roundLabel?: string
}

function roundMinutes(start: number, end: number): number {
  return Math.max(0, end - start)
}

function wholeBoardPlacements(shift: ShiftSchedule): ShiftPlacement[] {
  const rounds = shift.rounds ?? []
  if (usesRounds(shift) && rounds.length > 0) {
    const minutes = rounds.map((round) =>
      roundMinutes(round.startMinutes, round.endMinutes),
    )
    const total = minutes.reduce((sum, n) => sum + n, 0) || 1
    const out: ShiftPlacement[] = []
    rounds.forEach((round, index) => {
      const weight = minutes[index]! / total
      for (const assignment of round.assignments) {
        for (const workerId of assignment.workerIds) {
          if (!workerId) continue
          out.push({
            laneId: assignment.laneId,
            workerId,
            weight,
            roundIndex: index,
            roundLabel: round.label,
          })
        }
      }
    })
    return out
  }

  const out: ShiftPlacement[] = []
  for (const assignment of shift.assignments ?? []) {
    for (const workerId of assignment.workerIds) {
      if (!workerId) continue
      out.push({ laneId: assignment.laneId, workerId, weight: 1 })
    }
  }
  return out
}

/** Lane cells that count toward load and statistics. */
export function shiftPlacements(shift: ShiftSchedule): ShiftPlacement[] {
  const segments = shift.seatSegments ?? []
  const span = shift.seatSpan
  const base = wholeBoardPlacements(shift)
  if (!segments.length || !span || (usesRounds(shift) && (shift.rounds?.length ?? 0) > 0)) {
    return base
  }
  const length = Math.max(1, span.endMinutes - span.startMinutes)
  const covered = new Set(segments.map((segment) => segment.workerId))
  const fromSegments: ShiftPlacement[] = []
  for (const segment of segments) {
    const minutes = Math.max(0, segment.toMinutes - segment.fromMinutes)
    if (!segment.workerId || !segment.laneId || minutes <= 0) continue
    fromSegments.push({
      laneId: segment.laneId,
      workerId: segment.workerId,
      weight: minutes / length,
    })
  }
  return [
    ...fromSegments,
    ...base.filter((placement) => !covered.has(placement.workerId)),
  ]
}
