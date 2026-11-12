import type { FrozenLane, Lane } from '../types'
import { laneOpenDuring } from './shiftCatalog'

/**
 * Filter frozen lanes to only those that are currently in their active hours.
 * Lanes without activeHours are always considered active.
 */
export function filterFrozenLanesByActiveHours(
  frozenLanes: FrozenLane[],
  lanes: Lane[],
  currentMinutes: number,
  roundMinutes: number = 120
): FrozenLane[] {
  const laneMap = new Map(lanes.map((l) => [l.id, l]))
  
  return frozenLanes.filter((fl) => {
    const lane = laneMap.get(fl.laneId)
    if (!lane) return false
    
    // If no activeHours, lane is always active
    if (!lane.activeHours || lane.activeHours.length === 0) return true
    
    // Check if lane is open during the current time window
    return laneOpenDuring(
      lane.activeHours,
      currentMinutes,
      currentMinutes + roundMinutes
    )
  })
}

/**
 * Check if we should prompt to unfreeze lanes when a worker is added.
 * Only considers lanes that are currently in their active hours.
 * 
 * @returns true if we should show the unfreeze prompt
 */
export function shouldPromptUnfreeze(args: {
  frozenLanes: FrozenLane[]
  currentHeadcount: number
  requiredStandard: number
  newWorkerId: string
  lanes?: Lane[]
  currentMinutes?: number
}): boolean {
  const { currentHeadcount, requiredStandard } = args
  
  // Filter to only lanes that are currently active
  let frozenLanes = args.frozenLanes
  if (args.lanes && args.currentMinutes != null) {
    frozenLanes = filterFrozenLanesByActiveHours(
      args.frozenLanes,
      args.lanes,
      args.currentMinutes
    )
  }

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
 * Optionally filters by current time to show only lanes in their active hours.
 */
export function frozenLanesSummary(
  frozenLanes: FrozenLane[],
  lanes: Lane[],
  currentMinutes?: number
): string {
  if (frozenLanes.length === 0) return ''
  
  // Filter to only currently active lanes if currentMinutes is provided
  const activeFrozenLanes = currentMinutes != null
    ? filterFrozenLanesByActiveHours(frozenLanes, lanes, currentMinutes)
    : frozenLanes

  if (activeFrozenLanes.length === 0) {
    return '' // All frozen lanes are currently outside their active hours
  }

  const laneMap = new Map(lanes.map((l) => [l.id, l]))
  const names = activeFrozenLanes
    .map((fl) => laneMap.get(fl.laneId)?.name || '?')
    .join(', ')

  if (activeFrozenLanes.length === 1) {
    return `נתיב ${names} קפוא`
  }

  return `${activeFrozenLanes.length} נתיבים קפואים: ${names}`
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
