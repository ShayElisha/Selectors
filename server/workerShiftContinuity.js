const DEFAULT_INSPECTOR_SHIFTS = [
  { id: 'morning', startMinutes: 6 * 60, endMinutes: 14 * 60 + 30 },
  { id: 'afternoon', startMinutes: 14 * 60 + 30, endMinutes: 21 * 60 + 30 },
  { id: 'night', startMinutes: 21 * 60 + 30, endMinutes: 6 * 60 },
]

function shiftRange(shift, shiftModels = []) {
  const model =
    shiftModels.find((item) => item.id === shift?.shiftType) ??
    DEFAULT_INSPECTOR_SHIFTS.find((item) => item.id === shift?.shiftType)
  if (!model) return null
  const start = Number(model.startMinutes)
  let end = Number(model.endMinutes)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  if (end <= start) end += 24 * 60
  return { start, end }
}

function workerInterval(shift, workerId, presets, shiftModels) {
  const bounds = shiftRange(shift, shiftModels)
  if (!bounds) return null

  const presetId = shift?.workerWindows?.[workerId]
  const preset = Array.isArray(presets)
    ? presets.find((item) => item.id === presetId)
    : null
  let start = bounds.start
  let end = bounds.end
  if (preset) {
    start = Number(preset.start)
    end = Number(preset.end)
    if (!Number.isFinite(start) || !Number.isFinite(end)) return null
    if (end <= start) end += 24 * 60
    if (bounds.start >= 12 * 60 && start < 12 * 60 && preset.end > preset.start) {
      start += 24 * 60
      end += 24 * 60
    }
  }

  const adjustment = shift?.windowAdjustments?.[workerId] ?? {}
  start += Math.max(0, Number(adjustment.lateMinutes) || 0)
  end -= Math.max(0, Number(adjustment.earlyMinutes) || 0)
  const leftAt = shift?.earlyLeaveAt?.[workerId]
  if (Number.isFinite(Number(leftAt))) {
    const leaveMinute = Number(leftAt)
    const absoluteLeave =
      bounds.start >= 12 * 60 && leaveMinute < 12 * 60
        ? leaveMinute + 24 * 60
        : leaveMinute
    end = Math.min(end, absoluteLeave)
  }
  return end > start ? { start, end } : null
}

function sameAudience(a, b) {
  return (a?.audience ?? 'inspector') === (b?.audience ?? 'inspector')
}

function shiftStartsAfter(source, target, shiftModels) {
  if (!source || !target || source.date !== target.date) return false
  const sourceRange = shiftRange(source, shiftModels)
  const targetRange = shiftRange(target, shiftModels)
  return Boolean(sourceRange && targetRange && targetRange.start > sourceRange.start)
}

export function hasOpenWorkerContinuation(
  shift,
  workerId,
  history,
  workerWindowPresets,
  shiftModels,
) {
  const interval = workerInterval(
    shift,
    workerId,
    workerWindowPresets,
    shiftModels,
  )
  if (!interval) return false
  return history.some((candidate) => {
    if (
      candidate.id === shift.id ||
      candidate.date !== shift.date ||
      !sameAudience(shift, candidate) ||
      candidate.signOff?.signedAt ||
      !(candidate.presentWorkerIds ?? []).includes(workerId) ||
      !shiftStartsAfter(shift, candidate, shiftModels)
    ) {
      return false
    }
    const target = shiftRange(candidate, shiftModels)
    return Boolean(
      target &&
        target.start <= interval.end &&
        target.end > interval.start,
    )
  })
}

function hasValue(record, key) {
  return Object.prototype.hasOwnProperty.call(record ?? {}, key)
}

function personalHoursChanged(previous, next, workerId) {
  const oldWindow = previous.workerWindows?.[workerId]
  const newWindow = next.workerWindows?.[workerId]
  const oldAdjustment = previous.windowAdjustments?.[workerId] ?? {}
  const newAdjustment = next.windowAdjustments?.[workerId] ?? {}
  return (
    oldWindow !== newWindow ||
    oldAdjustment.lateMinutes !== newAdjustment.lateMinutes ||
    oldAdjustment.earlyMinutes !== newAdjustment.earlyMinutes
  )
}

function removeWorkerFromShift(shift, workerId) {
  const workerWindows = { ...(shift.workerWindows ?? {}) }
  const windowAdjustments = { ...(shift.windowAdjustments ?? {}) }
  delete workerWindows[workerId]
  delete windowAdjustments[workerId]

  const earlyLeaveAt = { ...(shift.earlyLeaveAt ?? {}) }
  delete earlyLeaveAt[workerId]

  const withoutWorker = (rows = []) =>
    rows.map((row) => ({
      ...row,
      workerIds: (row.workerIds ?? []).filter((id) => id !== workerId),
    }))

  return {
    ...shift,
    presentWorkerIds: (shift.presentWorkerIds ?? []).filter(
      (id) => id !== workerId,
    ),
    workerWindows,
    windowAdjustments,
    earlyLeaveAt,
    assignments: withoutWorker(shift.assignments),
    ...(Array.isArray(shift.rounds)
      ? {
          rounds: shift.rounds.map((round) => ({
            ...round,
            assignments: withoutWorker(round.assignments),
          })),
        }
      : {}),
    ...(shift.gateManagerWorkerId === workerId
      ? { gateManagerWorkerId: undefined }
      : {}),
    ...(Array.isArray(shift.explanations)
      ? {
          explanations: shift.explanations.filter(
            (item) => item.workerId !== workerId,
          ),
        }
      : {}),
    ...(Array.isArray(shift.manualPlacements)
      ? {
          manualPlacements: shift.manualPlacements.filter(
            (item) => item.workerId !== workerId,
          ),
        }
      : {}),
    ...(Array.isArray(shift.trainingPairs)
      ? {
          trainingPairs: shift.trainingPairs.filter(
            (item) =>
              item.traineeId !== workerId && item.mentorId !== workerId,
          ),
        }
      : {}),
  }
}

export function syncContinuedWorkerHours({
  previous,
  next,
  history,
  workerWindowPresets,
  shiftModels,
  updatedAt,
}) {
  if (!previous || !next || !sameAudience(previous, next)) {
    return { updates: [], lockedShiftIds: [] }
  }

  const workersToSync = (next.presentWorkerIds ?? []).filter(
    (workerId) =>
      (previous.presentWorkerIds ?? []).includes(workerId) &&
      personalHoursChanged(previous, next, workerId),
  )
  if (workersToSync.length === 0) return { updates: [], lockedShiftIds: [] }

  const updates = new Map()
  const lockedShiftIds = new Set()
  for (const target of history) {
    if (
      target.id === next.id ||
      target.date !== next.date ||
      !sameAudience(next, target) ||
      !shiftStartsAfter(next, target, shiftModels)
    ) {
      continue
    }

    let updated = target
    for (const workerId of workersToSync) {
      if (!(target.presentWorkerIds ?? []).includes(workerId)) continue
      const oldWindow = previous.workerWindows?.[workerId]
      const targetWindow = target.workerWindows?.[workerId]
      if (targetWindow !== oldWindow) continue

      const interval = workerInterval(
        next,
        workerId,
        workerWindowPresets,
        shiftModels,
      )
      const targetRange = shiftRange(target, shiftModels)
      const continues =
        interval &&
        targetRange &&
        targetRange.start < interval.end &&
        targetRange.end > interval.start

      if (target.signOff?.signedAt) {
        lockedShiftIds.add(target.id)
        continue
      }

      if (!continues) {
        updated = removeWorkerFromShift(updated, workerId)
        continue
      }

      const workerWindows = { ...(updated.workerWindows ?? {}) }
      const windowAdjustments = { ...(updated.windowAdjustments ?? {}) }
      const nextWindow = next.workerWindows?.[workerId]
      if (nextWindow) workerWindows[workerId] = nextWindow
      else delete workerWindows[workerId]

      const adjustment = next.windowAdjustments?.[workerId]
      if (
        adjustment &&
        (adjustment.lateMinutes || adjustment.earlyMinutes)
      ) {
        windowAdjustments[workerId] = { ...adjustment }
      } else {
        delete windowAdjustments[workerId]
      }
      updated = { ...updated, workerWindows, windowAdjustments }
    }

    if (updated !== target) {
      updates.set(target.id, { ...updated, updatedAt })
    }
  }

  return { updates: [...updates.values()], lockedShiftIds: [...lockedShiftIds] }
}

export function workerHoursInterval(
  shift,
  workerId,
  workerWindowPresets,
  shiftModels,
) {
  return workerInterval(shift, workerId, workerWindowPresets, shiftModels)
}

export function shiftClockRange(shift, shiftModels) {
  return shiftRange(shift, shiftModels)
}
