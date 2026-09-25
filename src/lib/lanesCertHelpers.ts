import { isQualified } from '../algorithm'
import { normalizeHeSearch } from './trackingHeatmap'
import { orderedCertifications } from './workersHelpers'
import type { Intensity, Lane, ShiftSchedule, Worker } from '../types'

/** ASSUMPTION — warn when qualified count is at most standard + this margin. */
export const QUALIFIED_THIN_MARGIN = 1

/** ASSUMPTION — max length for a new certification name. */
export const MAX_CERT_NAME_LENGTH = 40

/** ASSUMPTION — certs with fewer active holders than this are “thin”. */
export const THIN_CERT_HOLDER_THRESHOLD = 3

export type LaneSortKey =
  | 'name'
  | 'intensity'
  | 'standard'
  | 'qualified'
  | 'handoff'
export type SortDir = 'asc' | 'desc'

export type CoverageTone = 'ok' | 'warn' | 'error'

export function normalizeCertName(name: string): string {
  return normalizeHeSearch(name.trim())
}

export function isDuplicateCertName(
  catalog: string[],
  candidate: string,
): boolean {
  const n = normalizeCertName(candidate)
  if (!n) return false
  return catalog.some((c) => normalizeCertName(c) === n)
}

export function isDuplicateLaneName(
  lanes: Lane[],
  candidate: string,
  excludeId?: string,
): boolean {
  const n = normalizeHeSearch(candidate.trim())
  if (!n) return false
  return lanes.some(
    (l) =>
      l.id !== excludeId && normalizeHeSearch(l.name.trim()) === n,
  )
}

export function activeInspectors(workers: Worker[]): Worker[] {
  return workers.filter((w) => w.status === 'active' && w.isInspector)
}

export function qualifiedCountForLane(
  lane: Pick<Lane, 'requiredCertifications'>,
  workers: Worker[],
): { qualified: number; active: number } {
  const active = activeInspectors(workers)
  const probe: Lane = {
    id: '_',
    name: '_',
    staffingStandard: 1,
    requiredCertifications: lane.requiredCertifications,
    intensity: 'medium',
  }
  let qualified = 0
  for (const w of active) {
    if (isQualified(w, probe)) qualified += 1
  }
  return { qualified, active: active.length }
}

export function coverageTone(
  qualified: number,
  standard: number,
): CoverageTone {
  if (qualified < standard) return 'error'
  if (qualified <= standard + QUALIFIED_THIN_MARGIN) return 'warn'
  return 'ok'
}

export function certUsage(
  cert: string,
  workers: Worker[],
  lanes: Lane[],
): { workers: number; lanes: number; activeWorkers: number } {
  let workerHits = 0
  let activeHits = 0
  for (const w of workers) {
    if (w.certifications.includes(cert)) {
      workerHits += 1
      if (w.status === 'active' && w.isInspector) activeHits += 1
    }
  }
  const laneHits = lanes.filter((l) =>
    l.requiredCertifications.includes(cert),
  ).length
  return { workers: workerHits, lanes: laneHits, activeWorkers: activeHits }
}

export type CertStatusKind = 'unused' | 'in_use' | 'dangling_req'

export function certStatusKind(
  usage: { workers: number; lanes: number },
): CertStatusKind {
  if (usage.lanes > 0 && usage.workers === 0) return 'dangling_req'
  if (usage.workers > 0 || usage.lanes > 0) return 'in_use'
  return 'unused'
}

export function canDeleteCertification(usage: {
  workers: number
  lanes: number
}): boolean {
  return usage.workers === 0 && usage.lanes === 0
}

export function laneHistoryCount(
  history: ShiftSchedule[],
  laneId: string,
): number {
  let n = 0
  for (const shift of history) {
    const inActive = shift.activeLaneIds.includes(laneId)
    const inAssigned = shift.assignments.some(
      (a) => a.laneId === laneId && a.workerIds.some(Boolean),
    )
    if (inActive || inAssigned) n += 1
  }
  return n
}

export function summarizeLanes(lanes: Lane[]): {
  count: number
  totalStandard: number
  easy: number
  medium: number
  hard: number
} {
  let totalStandard = 0
  let easy = 0
  let medium = 0
  let hard = 0
  for (const l of lanes) {
    totalStandard += l.staffingStandard
    if (l.intensity === 'easy') easy += 1
    else if (l.intensity === 'hard') hard += 1
    else medium += 1
  }
  return { count: lanes.length, totalStandard, easy, medium, hard }
}

const INTENSITY_RANK: Record<Intensity, number> = {
  easy: 0,
  medium: 1,
  hard: 2,
}

export function compareLanes(
  a: Lane,
  b: Lane,
  key: LaneSortKey,
  dir: SortDir,
  qualifiedById: Map<string, number>,
): number {
  let cmp = 0
  if (key === 'name') cmp = a.name.localeCompare(b.name, 'he')
  else if (key === 'intensity') {
    cmp = INTENSITY_RANK[a.intensity] - INTENSITY_RANK[b.intensity]
  } else if (key === 'standard') {
    cmp = a.staffingStandard - b.staffingStandard
  } else if (key === 'qualified') {
    cmp =
      (qualifiedById.get(a.id) ?? 0) - (qualifiedById.get(b.id) ?? 0)
  } else {
    cmp = Number(a.afternoonHandoff) - Number(b.afternoonHandoff)
  }
  if (cmp === 0) cmp = a.name.localeCompare(b.name, 'he')
  return dir === 'asc' ? cmp : -cmp
}

export function orderedLaneCerts(
  catalog: string[],
  required: string[],
): string[] {
  return orderedCertifications(catalog, required)
}

export function thinDependentLanesCount(
  lanes: Lane[],
  workers: Worker[],
  threshold = THIN_CERT_HOLDER_THRESHOLD,
): number {
  const active = activeInspectors(workers)
  const holderCount = (cert: string) =>
    active.filter((w) => w.certifications.includes(cert)).length

  let n = 0
  for (const lane of lanes) {
    if (lane.requiredCertifications.length === 0) continue
    const thin = lane.requiredCertifications.some(
      (c) => holderCount(c) > 0 && holderCount(c) < threshold,
    )
    if (thin) n += 1
  }
  return n
}

export function formsLaneEqual(
  a: Omit<Lane, 'id'>,
  b: Omit<Lane, 'id'>,
): boolean {
  if (a.name.trim() !== b.name.trim()) return false
  if (a.staffingStandard !== b.staffingStandard) return false
  if (a.intensity !== b.intensity) return false
  if (Boolean(a.afternoonHandoff) !== Boolean(b.afternoonHandoff)) return false
  if (a.requiredCertifications.length !== b.requiredCertifications.length)
    return false
  const setB = new Set(b.requiredCertifications)
  return a.requiredCertifications.every((c) => setB.has(c))
}

export function typedNameMatches(typed: string, name: string): boolean {
  return typed.trim().replace(/\s+/g, ' ') === name.trim().replace(/\s+/g, ' ')
}
