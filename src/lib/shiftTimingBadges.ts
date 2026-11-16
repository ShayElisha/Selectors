import type { WindowAdjustment } from '../types'

export type TimingBadge = {
  kind: 'late' | 'early' | 'left'
  label: string
  shortLabel: string
}

/** Visible late / early / left-early markers for the assignment board. */
export function timingBadgesForWorker(opts: {
  workerId: string
  windowAdjustments?: Record<string, WindowAdjustment> | null
  earlyLeaveAt?: Record<string, number> | null
}): TimingBadge[] {
  const badges: TimingBadge[] = []
  const adj = opts.windowAdjustments?.[opts.workerId]
  const late = Number(adj?.lateMinutes || 0)
  const early = Number(adj?.earlyMinutes || 0)
  const leftAt = opts.earlyLeaveAt?.[opts.workerId]

  if (late > 0) {
    badges.push({
      kind: 'late',
      label: `מגיע באיחור של ${late} דק׳`,
      shortLabel: `איחור ${late}׳`,
    })
  }
  if (early > 0) {
    badges.push({
      kind: 'early',
      label: `יוצא ${early} דק׳ מוקדם`,
      shortLabel: `יציאה ${early}׳`,
    })
  }
  if (leftAt != null && Number.isFinite(leftAt)) {
    const hh = String(Math.floor(leftAt / 60) % 24).padStart(2, '0')
    const mm = String(leftAt % 60).padStart(2, '0')
    badges.push({
      kind: 'left',
      label: `עזב את המשמרת ב־${hh}:${mm}`,
      shortLabel: `עזב ${hh}:${mm}`,
    })
  }
  return badges
}

export function timingBadgeClass(kind: TimingBadge['kind']): string {
  if (kind === 'late') {
    return 'bg-warn-soft text-warn ring-warn/25'
  }
  if (kind === 'left') {
    return 'bg-hard-soft text-hard ring-hard/25'
  }
  return 'bg-accent-soft text-accent ring-accent/25'
}
