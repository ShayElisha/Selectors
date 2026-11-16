type LeaveGuard = () => boolean

const guards = new Set<LeaveGuard>()

/** Register a page-level dirty check. Return true if leaving is allowed. */
export function registerUnsavedLeaveGuard(guard: LeaveGuard): () => void {
  guards.add(guard)
  return () => {
    guards.delete(guard)
  }
}

/** True when every registered guard allows leaving (or confirms). */
export function allowLeaveUnsaved(): boolean {
  for (const guard of guards) {
    if (!guard()) return false
  }
  return true
}
