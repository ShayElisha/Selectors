import type { ShiftSchedule } from '../types'

export interface ShiftPlacement {
  laneId: string
  workerId: string
  /**
   * Share of one full shift this cell represents.
   * A lane board placement is 1.
   * A selector round is that round's minutes divided by the shift's rounds,
   * so a person who works every round still totals about one shift.
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

/** Lane cells that count toward load and statistics. */
export function shiftPlacements(shift: ShiftSchedule): ShiftPlacement[] {
  const rounds = shift.rounds ?? []
  if (shift.audience === 'selector' && rounds.length > 0) {
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
