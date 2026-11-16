import { isQualified } from '../algorithm'
import { missingCertsForLane } from './boardHelpers'
import type { Lane, Worker, WindowAdjustment } from '../types'

export type WhyNotSelected = {
  workerId: string
  workerName: string
  reasons: string[]
}

type RankingRow = {
  workerId: string
  rank: number
}

/**
 * Plain-language reasons a present worker was not chosen for a lane seat.
 * Uses certs, windows, occupancy, and optional auto-assign ranking.
 */
export function explainWhyNotSelected(opts: {
  lane: Lane
  presentWorkers: Worker[]
  selectedWorkerIds: string[]
  windowAdjustments?: Record<string, WindowAdjustment> | null
  candidateRanking?: RankingRow[] | null
  limit?: number
}): WhyNotSelected[] {
  const selected = new Set(opts.selectedWorkerIds.filter(Boolean))
  const rankById = new Map(
    (opts.candidateRanking ?? []).map((row) => [row.workerId, row.rank]),
  )
  const out: WhyNotSelected[] = []

  for (const worker of opts.presentWorkers) {
    if (selected.has(worker.id)) continue
    const reasons: string[] = []

    if (!isQualified(worker, opts.lane)) {
      const missing = missingCertsForLane(worker, opts.lane)
      reasons.push(
        missing.length
          ? `חסרה הסמכה: ${missing.join(' · ')}`
          : 'אין את כל ההסמכות שנדרשות לנתיב',
      )
    }

    const adj = opts.windowAdjustments?.[worker.id]
    if ((adj?.lateMinutes ?? 0) > 0) {
      reasons.push(`מגיע באיחור של ${adj!.lateMinutes} דק׳ — פחות זמין בתחילת המשמרת`)
    }
    if ((adj?.earlyMinutes ?? 0) > 0) {
      reasons.push(`יוצא ${adj!.earlyMinutes} דק׳ מוקדם — כיסוי חלקי`)
    }

    if (rankById.has(worker.id)) {
      const rank = rankById.get(worker.id)!
      reasons.push(
        `דורג במקום ${rank} בסדר ההעדפה — מועמדים לפניו תפסו את המקומות`,
      )
    } else if (reasons.length === 0) {
      reasons.push(
        'לא נבחר: כבר שובץ במקום אחר, או שלא נכנס לדירוג של הנתיב הזה',
      )
    }

    if (reasons.length) {
      out.push({
        workerId: worker.id,
        workerName: worker.fullName,
        reasons,
      })
    }
  }

  out.sort((a, b) => a.workerName.localeCompare(b.workerName, 'he'))
  return out.slice(0, opts.limit ?? 12)
}
