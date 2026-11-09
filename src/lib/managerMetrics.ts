import type { AuditLogEntry } from '../api'

export interface ManagerMetricRow {
  managerId: string
  managerName: string
  autoCount: number
  manualCount: number
  /** Manual actions divided by auto + manual for this manager. */
  overrideRate: number | null
  avgAutoDurationMs: number | null
}

const ASSIGN_ACTIONS = new Set(['auto_assign', 'manual_assign', 'manual_swap'])

function inRange(day: string, from?: string, to?: string): boolean {
  if (from && day < from) return false
  if (to && day > to) return false
  return true
}

/** Parse assignment duration from audit details (`durationMs=1234` or Hebrew ms text). */
export function parseAutoDurationMs(details: string): number | null {
  const text = details || ''
  const tagged = text.match(/durationMs=(\d+)/i)
  if (tagged) {
    const n = Number(tagged[1])
    return Number.isFinite(n) && n >= 0 ? n : null
  }
  const hebrew = text.match(/(\d+)\s*ms\b/i)
  if (hebrew) {
    const n = Number(hebrew[1])
    return Number.isFinite(n) && n >= 0 ? n : null
  }
  return null
}

function managerKey(actor: AuditLogEntry['actor']): {
  id: string
  name: string
} {
  const id = actor?.id?.trim() || 'unknown'
  const name = actor?.fullName?.trim() || 'מנהל לא מזוהה'
  return { id, name }
}

/** Per-manager auto vs manual assignment activity from audit logs. */
export function managerMetrics(
  logs: Pick<AuditLogEntry, 'action' | 'at' | 'actor' | 'details'>[],
  from?: string,
  to?: string,
): ManagerMetricRow[] {
  const buckets = new Map<
    string,
    {
      name: string
      auto: number
      manual: number
      durations: number[]
    }
  >()

  for (const row of logs) {
    if (!ASSIGN_ACTIONS.has(row.action)) continue
    const day = row.at.slice(0, 10)
    if (!inRange(day, from, to)) continue
    const { id, name } = managerKey(row.actor)
    const bucket = buckets.get(id) ?? {
      name,
      auto: 0,
      manual: 0,
      durations: [],
    }
    if (row.action === 'auto_assign') {
      bucket.auto += 1
      const ms = parseAutoDurationMs(row.details || '')
      if (ms != null) bucket.durations.push(ms)
    } else {
      bucket.manual += 1
    }
    buckets.set(id, bucket)
  }

  return [...buckets.entries()]
    .map(([managerId, bucket]) => {
      const total = bucket.auto + bucket.manual
      const avgAutoDurationMs =
        bucket.durations.length > 0
          ? Math.round(
              bucket.durations.reduce((sum, n) => sum + n, 0) /
                bucket.durations.length,
            )
          : null
      return {
        managerId,
        managerName: bucket.name,
        autoCount: bucket.auto,
        manualCount: bucket.manual,
        overrideRate: total > 0 ? bucket.manual / total : null,
        avgAutoDurationMs,
      }
    })
    .filter((row) => row.autoCount > 0 || row.manualCount > 0)
    .sort(
      (a, b) =>
        b.manualCount + b.autoCount - (a.manualCount + a.autoCount) ||
        a.managerName.localeCompare(b.managerName, 'he'),
    )
}
