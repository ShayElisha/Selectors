import type { FrozenLane, Lane } from '../types'

/**
 * Check if we should prompt to unfreeze lanes when a worker is added.
 * 
 * @returns true if we should show the unfreeze prompt
 */
export function shouldPromptUnfreeze(args: {
  frozenLanes: FrozenLane[]
  currentHeadcount: number
  requiredStandard: number
  newWorkerId: string
}): boolean {
  const { frozenLanes, currentHeadcount, requiredStandard } = args

  if (frozenLanes.length === 0) return false
  if (currentHeadcount < requiredStandard) return false

  const lastDecision = getLastDecisionForFrozenLanes(frozenLanes)
  if (!lastDecision) return true

  if (lastDecision.decision === 'unfrozen') return false

  const excessSinceLastDecision = currentHeadcount - lastDecision.headcount
  if (excessSinceLastDecision >= 2) {
    return true
  }

  return false
}

/**
 * Get the most recent decision across all frozen lanes.
 */
function getLastDecisionForFrozenLanes(
  frozenLanes: FrozenLane[]
): { at: string; atMinutes: number; headcount: number; decision: 'keep_frozen' | 'unfrozen' } | null {
  let latest: { at: string; atMinutes: number; headcount: number; decision: 'keep_frozen' | 'unfrozen' } | null = null

  for (const lane of frozenLanes) {
    if (!lane.decisionHistory || lane.decisionHistory.length === 0) continue
    const last = lane.decisionHistory[lane.decisionHistory.length - 1]
    if (last && (!latest || last.atMinutes > latest.atMinutes)) {
      latest = last
    }
  }

  return latest
}

/**
 * Record a user decision about unfreezing.
 */
export function recordUnfreezeDecision(
  frozenLanes: FrozenLane[],
  decision: 'keep_frozen' | 'unfrozen',
  atMinutes: number,
  headcount: number
): FrozenLane[] {
  const now = new Date().toISOString()

  return frozenLanes.map((lane) => ({
    ...lane,
    decisionHistory: [
      ...(lane.decisionHistory || []),
      {
        at: now,
        atMinutes,
        headcount,
        decision,
      },
    ],
  }))
}

/**
 * Create frozen lane records for a list of lane IDs.
 */
export function createFrozenLanes(
  laneIds: string[],
  reason: string,
  atMinutes: number
): FrozenLane[] {
  const now = new Date().toISOString()

  return laneIds.map((laneId) => ({
    laneId,
    frozenAtMinutes: atMinutes,
    frozenAt: now,
    reason,
    decisionHistory: [],
  }))
}

/**
 * Get a user-friendly summary of frozen lanes.
 */
export function frozenLanesSummary(
  frozenLanes: FrozenLane[],
  lanes: Lane[]
): string {
  if (frozenLanes.length === 0) return ''

  const laneMap = new Map(lanes.map((l) => [l.id, l]))
  const names = frozenLanes
    .map((fl) => laneMap.get(fl.laneId)?.name || '?')
    .join(', ')

  if (frozenLanes.length === 1) {
    return `נתיב ${names} קפוא`
  }

  return `${frozenLanes.length} נתיבים קפואים: ${names}`
}

/**
 * Get lane IDs from frozen lane records (for backward compatibility).
 */
export function frozenLaneIds(frozenLanes: FrozenLane[]): string[] {
  return frozenLanes.map((fl) => fl.laneId)
}

/**
 * Check if a specific lane is frozen.
 */
export function isLaneFrozen(laneId: string, frozenLanes: FrozenLane[]): boolean {
  return frozenLanes.some((fl) => fl.laneId === laneId)
}
