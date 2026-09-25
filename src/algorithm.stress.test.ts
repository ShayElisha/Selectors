import { describe, expect, it } from 'vitest'
import {
  buildWorkerProfile,
  evaluateBoard,
  isBoardBetter,
  isQualified,
  runAssignmentAlgorithm,
  type EvaluateBoardContext,
} from './algorithm'
import type { Intensity, Lane, LaneAssignment, ShiftSchedule, Worker } from './types'

const STRESS_ROUNDS = 1000

function worker(
  id: string,
  name: string,
  certifications: string[] = [],
  opts?: Partial<Worker>,
): Worker {
  return {
    id,
    fullName: name,
    phone: '0500000000',
    certifications,
    status: 'active',
    isInspector: true,
    isManager: false,
    ...opts,
  }
}

function lane(
  id: string,
  name: string,
  opts: Partial<Lane> & { intensity: Intensity },
): Lane {
  return {
    id,
    name,
    staffingStandard: 1,
    requiredCertifications: [],
    ...opts,
  }
}

function shift(
  id: string,
  date: string,
  shiftType: ShiftSchedule['shiftType'],
  assignments: ShiftSchedule['assignments'],
  presentWorkerIds: string[],
  activeLaneIds: string[],
): ShiftSchedule {
  return {
    id,
    date,
    shiftType,
    activeLaneIds,
    presentWorkerIds,
    assignments,
    createdAt: `${date}T00:00:00.000Z`,
    updatedAt: `${date}T00:00:00.000Z`,
  }
}

function mulberry32(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)]!
}

function assertLegalBoard(
  assignments: LaneAssignment[],
  lanes: Lane[],
  workers: Worker[],
): void {
  const laneById = new Map(lanes.map((l) => [l.id, l]))
  const workerById = new Map(workers.map((w) => [w.id, w]))
  const seen = new Set<string>()
  for (const a of assignments) {
    const lane = laneById.get(a.laneId)
    expect(lane).toBeTruthy()
    for (const wid of a.workerIds) {
      if (!wid) continue
      expect(seen.has(wid)).toBe(false)
      seen.add(wid)
      const w = workerById.get(wid)
      expect(w).toBeTruthy()
      expect(isQualified(w!, lane!)).toBe(true)
    }
  }
}

/** True if an unassigned qualified worker can still fill an empty תקן slot. */
function hasDirectStaffingHole(
  assignments: LaneAssignment[],
  unassignedWorkerIds: string[],
  lanes: Lane[],
  workers: Worker[],
): boolean {
  const laneById = new Map(lanes.map((l) => [l.id, l]))
  const workerById = new Map(workers.map((w) => [w.id, w]))
  for (const a of assignments) {
    const lane = laneById.get(a.laneId)
    if (!lane) continue
    const filled = a.workerIds.filter(Boolean).length
    if (filled >= lane.staffingStandard) continue
    for (const id of unassignedWorkerIds) {
      const w = workerById.get(id)
      if (w && isQualified(w, lane)) return true
    }
  }
  return false
}

function understaffedCount(assignments: LaneAssignment[], lanes: Lane[]): number {
  const laneById = new Map(lanes.map((l) => [l.id, l]))
  let n = 0
  for (const a of assignments) {
    const lane = laneById.get(a.laneId)
    if (!lane) continue
    n += Math.max(0, lane.staffingStandard - a.workerIds.filter(Boolean).length)
  }
  return n
}

function randomScenario(seed: number): {
  lanes: Lane[]
  workers: Worker[]
  history: ShiftSchedule[]
  date: string
  shiftType: ShiftSchedule['shiftType']
} {
  const rng = mulberry32(seed)
  const certPool = ['מכס', 'טסלה', 'מלגזה', 'ראיונות']
  const intensities: Intensity[] = ['hard', 'medium', 'easy']
  const laneCount = 4 + Math.floor(rng() * 6) // 4–9
  const workerCount = 8 + Math.floor(rng() * 12) // 8–19

  const lanes: Lane[] = []
  for (let i = 0; i < laneCount; i++) {
    const intensity = pick(rng, intensities)
    const staffingStandard = (1 + Math.floor(rng() * 3)) as 1 | 2 | 3
    const reqCount = Math.floor(rng() * 3) // 0–2
    const requiredCertifications: string[] = []
    for (let c = 0; c < reqCount; c++) {
      const cert = pick(rng, certPool)
      if (!requiredCertifications.includes(cert)) {
        requiredCertifications.push(cert)
      }
    }
    lanes.push(
      lane(`L${i}`, `נתיב ${i}`, {
        intensity,
        staffingStandard,
        requiredCertifications,
        afternoonHandoff: intensity !== 'easy' && rng() < 0.25,
      }),
    )
  }

  const workers: Worker[] = []
  for (let i = 0; i < workerCount; i++) {
    const certs: string[] = []
    for (const c of certPool) {
      if (rng() < 0.35) certs.push(c)
    }
    // Ensure at least some forklift/מכס coverage overall by sprinkling
    if (i < 3 && certs.length === 0) certs.push(pick(rng, certPool))
    workers.push(
      worker(`W${i}`, `בודק ${i}`, certs, {
        isManager: i === 0 && rng() < 0.4,
      }),
    )
  }

  const history: ShiftSchedule[] = []
  const histDays = 3 + Math.floor(rng() * 6)
  for (let d = 0; d < histDays; d++) {
    const day = 10 - histDays + d
    const date = `2026-03-${String(Math.max(1, day)).padStart(2, '0')}`
    const shiftType = pick(rng, [
      'morning',
      'afternoon',
      'night',
    ] as ShiftSchedule['shiftType'][])
    const present = workers.filter(() => rng() < 0.7).map((w) => w.id)
    if (present.length === 0) present.push(workers[0]!.id)
    const assignments: LaneAssignment[] = []
    const used = new Set<string>()
    for (const l of lanes) {
      if (rng() < 0.4) continue
      const ids: string[] = []
      for (const wid of present) {
        if (used.has(wid)) continue
        const w = workers.find((x) => x.id === wid)!
        if (!isQualified(w, l)) continue
        if (rng() < 0.5) {
          ids.push(wid)
          used.add(wid)
        }
        if (ids.length >= l.staffingStandard) break
      }
      if (ids.length > 0) {
        assignments.push({ laneId: l.id, workerIds: ids })
      }
    }
    history.push(
      shift(
        `h${seed}-${d}`,
        date,
        shiftType,
        assignments,
        present,
        lanes.map((l) => l.id),
      ),
    )
  }

  return {
    lanes,
    workers,
    history,
    date: '2026-03-10',
    shiftType: pick(rng, ['morning', 'afternoon', 'night'] as const),
  }
}

describe('assignment stress — 1000 randomized rounds', () => {
  it(`runs ${STRESS_ROUNDS} scenarios: legal, max direct fill, staffing ≥ greedy`, () => {
    let legalOk = 0
    let fillOk = 0
    let staffingOk = 0

    for (let round = 0; round < STRESS_ROUNDS; round++) {
      const scenario = randomScenario(1000 + round * 997)
      const { lanes, workers, history, date, shiftType } = scenario
      const present = workers.filter((w) => w.status === 'active')

      const full = runAssignmentAlgorithm(lanes, present, history, lanes, {
        date,
        shiftType,
        rngSeed: `stress-${round}`,
      })
      const greedy = runAssignmentAlgorithm(lanes, present, history, lanes, {
        date,
        shiftType,
        rngSeed: `stress-${round}`,
        maxOptimizationPasses: 0,
      })

      assertLegalBoard(full.assignments, lanes, present)
      legalOk += 1

      const hole = hasDirectStaffingHole(
        full.assignments,
        full.unassignedWorkerIds,
        lanes,
        present,
      )
      expect(hole).toBe(false)
      fillOk += 1

      const fullUnder = understaffedCount(full.assignments, lanes)
      const greedyUnder = understaffedCount(greedy.assignments, lanes)
      expect(fullUnder).toBeLessThanOrEqual(greedyUnder)
      staffingOk += 1
    }

    expect(legalOk).toBe(STRESS_ROUNDS)
    expect(fillOk).toBe(STRESS_ROUNDS)
    expect(staffingOk).toBe(STRESS_ROUNDS)
  }, 180_000)

  it('is deterministic across stress seeds (sample)', () => {
    for (const seed of [0, 17, 42, 99, 256]) {
      const scenario = randomScenario(5000 + seed)
      const ctx = {
        date: scenario.date,
        shiftType: scenario.shiftType,
        rngSeed: `det-${seed}`,
      }
      const a = runAssignmentAlgorithm(
        scenario.lanes,
        scenario.workers,
        scenario.history,
        scenario.lanes,
        ctx,
      )
      const b = runAssignmentAlgorithm(
        scenario.lanes,
        scenario.workers,
        scenario.history,
        scenario.lanes,
        ctx,
      )
      expect(a.assignments).toEqual(b.assignments)
    }
  })
})

describe('assignment extreme cases', () => {
  const hard = lane('hard', 'קשה', {
    intensity: 'hard',
    requiredCertifications: ['מלגזה'],
    staffingStandard: 2,
  })
  const easy = lane('easy', 'קל', { intensity: 'easy', staffingStandard: 2 })
  const med = lane('med', 'בינוני', { intensity: 'medium' })

  it('staffing-first: board with fewer holes beats higher soft score', () => {
    const workers = [
      worker('a', 'A', ['מלגזה']),
      worker('b', 'B'),
    ]
    const lanes = [hard, easy]
    const profiles = new Map(
      workers.map((w) => [
        w.id,
        buildWorkerProfile(w.id, [], lanes, 'morning', '2026-03-10'),
      ]),
    )
    const ctx: EvaluateBoardContext = {
      lanes,
      workersById: new Map(workers.map((w) => [w.id, w])),
      profiles,
      recoveringIds: new Set(),
      morning: null,
      currentShiftType: 'morning',
    }
    const fuller = evaluateBoard(
      [
        { laneId: 'hard', workerIds: ['a'] },
        { laneId: 'easy', workerIds: ['b'] },
      ],
      ctx,
    )
    const holey = evaluateBoard(
      [
        { laneId: 'hard', workerIds: ['a'] },
        { laneId: 'easy', workerIds: [] },
      ],
      ctx,
    )
    expect(fuller.legal && holey.legal).toBe(true)
    expect(fuller.understaffedSlots).toBeLessThan(holey.understaffedSlots)
    expect(isBoardBetter(fuller, holey)).toBe(true)
  })

  it('fills multi-slot תקן when enough qualified workers exist', () => {
    const workers = [
      worker('a', 'A', ['מלגזה']),
      worker('b', 'B', ['מלגזה']),
      worker('c', 'C'),
      worker('d', 'D'),
    ]
    const result = runAssignmentAlgorithm(
      [hard, easy],
      workers,
      [],
      [hard, easy],
      { date: '2026-03-10', shiftType: 'morning', rngSeed: 7 },
    )
    const hardA = result.assignments.find((a) => a.laneId === 'hard')
    const easyA = result.assignments.find((a) => a.laneId === 'easy')
    expect(hardA?.workerIds.filter(Boolean)).toHaveLength(2)
    expect(easyA?.workerIds.filter(Boolean)).toHaveLength(2)
    expect(result.understaffedLaneIds).toEqual([])
  })

  it('forced recovery onto hard still stays legal when no alternative', () => {
    const recovering = worker('r', 'Recovering', ['מלגזה'])
    const other = worker('o', 'Other') // cannot do hard
    const history = [
      shift(
        'n1',
        '2026-03-09',
        'night',
        [{ laneId: 'easy', workerIds: ['r'] }],
        ['r'],
        ['easy'],
      ),
    ]
    const result = runAssignmentAlgorithm(
      [hard],
      [recovering, other],
      history,
      [hard, easy],
      { date: '2026-03-10', shiftType: 'afternoon', rngSeed: 3 },
    )
    assertLegalBoard(result.assignments, [hard], [recovering, other])
    const hardA = result.assignments.find((a) => a.laneId === 'hard')
    expect(hardA?.workerIds.filter(Boolean)).toContain('r')
    expect(
      result.warnings.some((w) => w.includes('אחרי לילה') || w.includes('קשה')),
    ).toBe(true)
  })

  it('manager morning→afternoon recovery prefers easy when available', () => {
    const mgr = worker('m', 'Manager', [], {
      isManager: true,
      isInspector: true,
    })
    const insp = worker('i', 'Inspector', ['מלגזה'])
    const history = [
      shift(
        'm1',
        '2026-03-10',
        'morning',
        [{ laneId: 'med', workerIds: ['m'] }],
        ['m', 'i'],
        ['med', 'hard', 'easy'],
      ),
    ]
    const result = runAssignmentAlgorithm(
      [hard, easy],
      [mgr, insp],
      history,
      [hard, easy, med],
      { date: '2026-03-10', shiftType: 'afternoon', rngSeed: 5 },
    )
    assertLegalBoard(result.assignments, [hard, easy], [mgr, insp])
    const hardA = result.assignments.find((a) => a.laneId === 'hard')
    const easyA = result.assignments.find((a) => a.laneId === 'easy')
    // Manager recovering should land on easy; forklift inspector on hard
    expect(hardA?.workerIds).toContain('i')
    expect(easyA?.workerIds).toContain('m')
  })

  it('maximizes fill under scarce certifications', () => {
    const specialist = worker('s', 'Specialist', ['מלגזה'])
    const generalists = [
      worker('g1', 'G1'),
      worker('g2', 'G2'),
      worker('g3', 'G3'),
    ]
    const result = runAssignmentAlgorithm(
      [hard, easy, med],
      [specialist, ...generalists],
      [],
      [hard, easy, med],
      { date: '2026-03-10', shiftType: 'morning', rngSeed: 9 },
    )
    assertLegalBoard(result.assignments, [hard, easy, med], [
      specialist,
      ...generalists,
    ])
    expect(
      hasDirectStaffingHole(
        result.assignments,
        result.unassignedWorkerIds,
        [hard, easy, med],
        [specialist, ...generalists],
      ),
    ).toBe(false)
    const hardA = result.assignments.find((a) => a.laneId === 'hard')
    expect(hardA?.workerIds.filter(Boolean)).toContain('s')
  })
})
