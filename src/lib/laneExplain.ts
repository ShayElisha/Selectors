import { INTENSITY_LABELS } from '../constants'
import type { Lane, Worker } from '../types'

type ExplainRow = {
  laneId: string
  workerId: string
  reasons: string[]
  decision?: string
  laneSummary?: string
}

function rotationHint(reasons: string[], decision?: string): string {
  const text = [...reasons, decision ?? ''].join(' ')
  if (text.includes('עומס') || text.includes('נטל')) return 'עומס'
  if (text.includes('רוטציה') || text.includes('ביקור') || text.includes('לא היה')) {
    return 'רוטציה'
  }
  return 'רוטציה/עומס'
}

function certLabel(lane: Lane): string {
  if (lane.requiredCertifications.length === 0) return 'ללא דרישת הסמכה'
  if (lane.requiredCertifications.length === 1) {
    return `דורש הסמכת ${lane.requiredCertifications[0]}`
  }
  return `דורש הסמכות: ${lane.requiredCertifications.join(' · ')}`
}

export function buildLaneSummaryText(
  lane: Lane,
  placementCount: number,
  sampleReasons: string[],
  sampleDecision?: string,
): string {
  const intensity = INTENSITY_LABELS[lane.intensity]
  const strategy = rotationHint(sampleReasons, sampleDecision)
  return `${placementCount} משובצים · ${certLabel(lane)} · עומס ${intensity} · נבחר לפי ${strategy}`
}

export function buildLaneSummaries(
  explanations: ExplainRow[],
  lanes: Lane[],
  _workers: Worker[],
): Map<string, string> {
  const laneById = new Map(lanes.map((l) => [l.id, l]))
  const counts = new Map<string, number>()
  const firstByLane = new Map<string, ExplainRow>()

  for (const row of explanations) {
    if (!row.reasons.length) continue
    counts.set(row.laneId, (counts.get(row.laneId) ?? 0) + 1)
    if (!firstByLane.has(row.laneId)) firstByLane.set(row.laneId, row)
  }

  const out = new Map<string, string>()
  for (const [laneId, count] of counts) {
    const lane = laneById.get(laneId)
    if (!lane) continue
    const sample = firstByLane.get(laneId)!
    out.set(
      laneId,
      buildLaneSummaryText(lane, count, sample.reasons, sample.decision),
    )
  }
  return out
}
