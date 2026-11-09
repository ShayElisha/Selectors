import type { ShiftSchedule } from '../types'

export type BoardQualityAlert = {
  level: 'ok' | 'warn' | 'bad'
  message: string
}

export function assessBoardQualityAlert(
  currentScore: number,
  historyScores: number[],
): BoardQualityAlert | null {
  if (historyScores.length < 5) return null
  const sorted = [...historyScores].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median =
    sorted.length % 2 === 0
      ? (sorted[mid - 1]! + sorted[mid]!) / 2
      : sorted[mid]!
  const gap = median - currentScore
  if (gap >= 25) {
    return {
      level: 'bad',
      message: `ציון השיבוץ (${Math.round(currentScore)}) נמוך במיוחד לעומת החציון האחרון (${Math.round(median)}). כדאי לבדוק זמינות, הסמכות או לנסות שיבוץ חלופי.`,
    }
  }
  if (gap >= 15) {
    return {
      level: 'warn',
      message: `ציון השיבוץ (${Math.round(currentScore)}) נמוך מהרגיל לעומת משמרות אחרונות (חציון ${Math.round(median)}).`,
    }
  }
  return null
}

export function collectRecentQualityScores(
  history: ShiftSchedule[],
  options?: { limit?: number; beforeDate?: string },
): number[] {
  const limit = options?.limit ?? 30
  const rows = history
    .filter((h) => {
      if (!h.assignmentQuality?.score) return false
      if (options?.beforeDate && h.date >= options.beforeDate) return false
      return true
    })
    .sort((a, b) => {
      const at = a.assignmentQuality!.at
      const bt = b.assignmentQuality!.at
      return bt.localeCompare(at)
    })
  return rows.slice(0, limit).map((h) => h.assignmentQuality!.score)
}
