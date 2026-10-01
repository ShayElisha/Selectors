import {
  SHORT_RETURN_DAYS,
  buildWorkerProfile,
  isQualified,
  isShortReturnToLane,
  rotationSpacingBetter,
} from '../algorithm'
import type { Lane, ShiftSchedule, Worker } from '../types'

export function rotationOverrideWarning(args: {
  lane: Lane
  worker: Worker
  alternatives: Worker[]
  history: ShiftSchedule[]
  lanes: Lane[]
  shiftType: ShiftSchedule['shiftType']
  date: string
}): string | null {
  if (!isQualified(args.worker, args.lane)) return null
  const chosen = buildWorkerProfile(
    args.worker.id,
    args.history,
    args.lanes,
    args.shiftType,
    args.date,
  )
  if (!isShortReturnToLane(chosen, args.lane.id)) return null
  let betterName = ''
  let betterDays: number | null = null
  for (const other of args.alternatives) {
    if (other.id === args.worker.id) continue
    if (other.status !== 'active' || !isQualified(other, args.lane)) continue
    const profile = buildWorkerProfile(
      other.id,
      args.history,
      args.lanes,
      args.shiftType,
      args.date,
    )
    if (isShortReturnToLane(profile, args.lane.id)) continue
    if (!rotationSpacingBetter(profile, chosen, args.lane.id)) continue
    const days = profile.daysSinceLastVisit.get(args.lane.id)
    if (betterDays == null || (days != null && days > betterDays)) {
      betterName = other.fullName
      betterDays = days ?? null
    }
  }
  if (!betterName) return null
  const chosenDays = chosen.daysSinceLastVisit.get(args.lane.id)
  const gap =
    betterDays != null && chosenDays != null ? Math.round((betterDays - chosenDays) * 10) / 10 : null
  const harm = gap != null && gap > 0 ? ` הפגיעה ברוטציה היא כ־${gap} ימים.` : ''
  return `${args.worker.fullName} חוזר/ת ל${args.lane.name} תוך ${SHORT_RETURN_DAYS} ימים. כלל הרוטציה נעקף — ${betterName} היה עדיף.${harm}`
}
