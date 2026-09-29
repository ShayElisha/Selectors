import type { AssignmentMode, ShiftAudience } from '../types'

export type { AssignmentMode }

export interface AssignmentModes {
  selectors: AssignmentMode
  inspectors: AssignmentMode
}

/** Matches the behavior the app had before this setting existed. */
export const DEFAULT_ASSIGNMENT_MODES: AssignmentModes = {
  selectors: 'rounds',
  inspectors: 'single',
}

export function normalizeAssignmentMode(
  value: unknown,
  fallback: AssignmentMode,
): AssignmentMode {
  return value === 'rounds' || value === 'single' ? value : fallback
}

export function normalizeAssignmentModes(raw: unknown): AssignmentModes {
  const src =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    selectors: normalizeAssignmentMode(src.selectors, 'rounds'),
    inspectors: normalizeAssignmentMode(src.inspectors, 'single'),
  }
}

export function assignmentModeOf(shift: {
  audience?: ShiftAudience
  assignmentMode?: AssignmentMode
  rounds?: unknown[]
}): AssignmentMode {
  if (shift.assignmentMode === 'rounds' || shift.assignmentMode === 'single') {
    return shift.assignmentMode
  }
  if (shift.audience === 'selector') return 'rounds'
  if (Array.isArray(shift.rounds) && shift.rounds.length > 0) return 'rounds'
  return 'single'
}

export function usesRounds(shift: {
  audience?: ShiftAudience
  assignmentMode?: AssignmentMode
  rounds?: unknown[]
}): boolean {
  return assignmentModeOf(shift) === 'rounds'
}
