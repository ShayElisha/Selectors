import { SHIFT_TYPE_LABELS } from '../constants'
import { formatShiftDate } from './hebrew'
import { continuesIntoShift, laneOpenDuring } from './shiftCatalog'
import { effectiveStaffingStandard, type StaffingOverrides } from './shiftStaffing'
import type {
  Lane,
  LaneAssignment,
  SelectorRound,
  ShiftType,
  Worker,
} from '../types'

export function nextOperationalShift(shiftType: ShiftType): ShiftType | null {
  if (shiftType === 'morning') return 'afternoonA'
  if (shiftType === 'afternoon' || shiftType === 'afternoonA') return 'afternoonB'
  if (shiftType === 'afternoonB') return 'night'
  return null
}

export function buildHandoverText(args: {
  date: string
  shiftType: ShiftType
  lanes: Lane[]
  workers: Worker[]
  activeLaneIds: string[]
  presentWorkerIds: string[]
  workerWindows?: Record<string, string>
  assignments: LaneAssignment[]
  rounds?: SelectorRound[]
  staffingOverrides?: StaffingOverrides | null
}): string {
  const laneById = new Map(args.lanes.map((lane) => [lane.id, lane]))
  const nameOf = (id: string) =>
    args.workers.find((worker) => worker.id === id)?.fullName ?? id

  const notes = args.assignments
    .map((assignment) => {
      const text = assignment.notes?.trim()
      if (!text) return null
      const lane = laneById.get(assignment.laneId)
      return `• ${lane?.name ?? 'נתיב'}: ${text.replace(/\s+/g, ' ')}`
    })
    .filter((line): line is string => Boolean(line))

  const gaps = emptyHandoverLanes(args, laneById)
  const next = nextOperationalShift(args.shiftType)
  const continuers = next
    ? args.presentWorkerIds
        .filter((id) =>
          continuesIntoShift(
            args.shiftType,
            args.workerWindows?.[id],
            next,
          ),
        )
        .map(nameOf)
        .sort((a, b) => a.localeCompare(b, 'he'))
    : []

  const nextLabel = next ? SHIFT_TYPE_LABELS[next] : ''
  return [
    `מסירה · ${SHIFT_TYPE_LABELS[args.shiftType]} · ${formatShiftDate(args.date)}`,
    '',
    'הערות',
    notes.length > 0 ? notes.join('\n') : 'אין',
    '',
    'נתיב בלי בודק',
    gaps.length > 0 ? gaps.map((name) => `• ${name}`).join('\n') : 'אין',
    '',
    next
      ? `ממשיכים ל${nextLabel}`
      : 'ממשיכים למשמרת הבאה',
    continuers.length > 0
      ? continuers.map((name) => `• ${name}`).join('\n')
      : 'אין',
  ].join('\n')
}

function emptyHandoverLanes(
  args: {
    activeLaneIds: string[]
    assignments: LaneAssignment[]
    rounds?: SelectorRound[]
    staffingOverrides?: StaffingOverrides | null
  },
  laneById: Map<string, Lane>,
): string[] {
  const rounds = args.rounds ?? []
  if (rounds.length > 0) {
    const last = rounds[rounds.length - 1]!
    return args.activeLaneIds.flatMap((laneId) => {
      const lane = laneById.get(laneId)
      if (!lane) return []
      if (
        !laneOpenDuring(lane.activeHours, last.startMinutes, last.endMinutes)
      ) {
        return []
      }
      const filled = (
        last.assignments.find((assignment) => assignment.laneId === laneId)
          ?.workerIds ?? []
      ).filter(Boolean)
      const standard = effectiveStaffingStandard(lane, args.staffingOverrides)
      if (filled.length >= standard) return []
      return [lane.name]
    })
  }

  return args.activeLaneIds.flatMap((laneId) => {
    const lane = laneById.get(laneId)
    if (!lane) return []
    const filled = (
      args.assignments.find((assignment) => assignment.laneId === laneId)
        ?.workerIds ?? []
    ).filter(Boolean)
    const standard = effectiveStaffingStandard(lane, args.staffingOverrides)
    if (filled.length >= standard) return []
    return [lane.name]
  })
}
