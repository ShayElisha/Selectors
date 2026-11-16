import type { ShiftSchedule, ShiftType } from '../types'

export type CrossModuleConflict = {
  workerId: string
  workerName: string
  otherModule: string
  otherShiftId: string
  date: string
  shiftType: ShiftType
}

type ModuleShiftBundle = {
  module: string
  label: string
  history: ShiftSchedule[]
}

/**
 * Detect same person appearing as present/assigned on another module's shift
 * for the same date + shift type (blocks double booking across modules).
 */
export function findCrossModuleConflicts(opts: {
  date: string
  shiftType: ShiftType
  workerIds: string[]
  workerNames: Map<string, string>
  /** Other modules' recent schedules (not the current module). */
  otherModules: ModuleShiftBundle[]
  excludeShiftId?: string
}): CrossModuleConflict[] {
  const wanted = new Set(opts.workerIds.filter(Boolean))
  if (!wanted.size) return []
  const conflicts: CrossModuleConflict[] = []

  for (const bundle of opts.otherModules) {
    for (const shift of bundle.history) {
      if (shift.date !== opts.date || shift.shiftType !== opts.shiftType) continue
      if (opts.excludeShiftId && shift.id === opts.excludeShiftId) continue
      const placed = new Set<string>([
        ...(shift.presentWorkerIds || []),
        ...(shift.assignments || []).flatMap((a) => a.workerIds || []),
        ...((shift.rounds || []).flatMap((r) =>
          (r.assignments || []).flatMap((a) => a.workerIds || []),
        ) as string[]),
      ])
      for (const id of wanted) {
        if (!placed.has(id)) continue
        conflicts.push({
          workerId: id,
          workerName: opts.workerNames.get(id) || id,
          otherModule: bundle.label,
          otherShiftId: shift.id,
          date: shift.date,
          shiftType: shift.shiftType,
        })
      }
    }
  }

  return conflicts
}
