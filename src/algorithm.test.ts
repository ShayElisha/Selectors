import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BOARD_WEIGHTS,
  accumulateLoadBalance,
  buildWorkerProfile,
  calculateShiftWeightedRotationScore,
  computeWorkerLaneStats,
  dedupeShiftsByDateAndType,
  evaluateBoard,
  groupShiftsByDate,
  isBoardBetter,
  isQualified,
  needsAfternoonNightRecovery,
  runAssignmentAlgorithm,
  runMultiPassOptimization,
  type EvaluateBoardContext,
} from './algorithm'
import type { Lane, ShiftSchedule, Worker } from './types'

function worker(
  id: string,
  name: string,
  certifications: string[] = [],
): Worker {
  return {
    id,
    fullName: name,
    phone: '0500000000',
    certifications,
    status: 'active',
    isInspector: true,
    isManager: false,
  }
}

function lane(
  id: string,
  name: string,
  opts: Partial<Lane> & { intensity: Lane['intensity'] },
): Lane {
  return {
    id,
    name,
    staffingStandard: opts.staffingStandard ?? 1,
    requiredCertifications: opts.requiredCertifications ?? [],
    intensity: opts.intensity,
    ...(opts.afternoonHandoff ? { afternoonHandoff: true } : {}),
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

function profilesFor(
  workers: Worker[],
  lanes: Lane[],
  history: ShiftSchedule[],
  shiftType: ShiftSchedule['shiftType'],
  date: string,
) {
  const map = new Map()
  for (const w of workers) {
    map.set(
      w.id,
      buildWorkerProfile(w.id, history, lanes, shiftType, date, 14),
    )
  }
  return map
}

describe('assignment algorithm — hard constraints & soft objectives', () => {
  const hard = lane('hard', 'קשה', {
    intensity: 'hard',
    requiredCertifications: ['forklift'],
  })
  const medium = lane('med', 'בינוני', { intensity: 'medium' })
  const easy = lane('easy', 'קל', { intensity: 'easy' })
  const customs = lane('customs', 'מכס', {
    intensity: 'medium',
    afternoonHandoff: true,
  })

  it('Test 1 — worker qualification is a hard constraint', () => {
    const alice = worker('a', 'Alice', [])
    const bob = worker('b', 'Bob', ['forklift'])
    const result = runAssignmentAlgorithm(
      [hard, easy],
      [alice, bob],
      [],
      [hard, easy],
      { date: '2026-03-10', shiftType: 'morning', rngSeed: 1 },
    )
    const hardAsg = result.assignments.find((a) => a.laneId === 'hard')
    expect(hardAsg?.workerIds).toEqual(['b'])
    expect(isQualified(alice, hard)).toBe(false)
    expect(isQualified(bob, hard)).toBe(true)
  })

  it('Test 2 — worker cannot be assigned twice in the same shift', () => {
    const workers = [
      worker('a', 'A', ['forklift']),
      worker('b', 'B'),
      worker('c', 'C'),
    ]
    const lanes = [hard, medium, easy]
    const result = runAssignmentAlgorithm(lanes, workers, [], lanes, {
      date: '2026-03-10',
      shiftType: 'morning',
      rngSeed: 2,
    })
    const ids = result.assignments.flatMap((a) => a.workerIds.filter(Boolean))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('Test 3 — night → afternoon recovery prefers easy over hard', () => {
    const recovering = worker('r', 'Recovering', ['forklift'])
    const fresh = worker('f', 'Fresh', ['forklift'])
    const extra = worker('e', 'Extra')
    const history = [
      shift(
        'n1',
        '2026-03-09',
        'night',
        [{ laneId: 'hard', workerIds: ['r'] }],
        ['r'],
        ['hard'],
      ),
    ]
    expect(
      needsAfternoonNightRecovery('r', history, '2026-03-10', 'afternoon'),
    ).toBe(true)
    expect(
      needsAfternoonNightRecovery('r', history, '2026-03-10', 'morning'),
    ).toBe(false)
    expect(
      needsAfternoonNightRecovery('r', history, '2026-03-11', 'afternoon'),
    ).toBe(false)

    const result = runAssignmentAlgorithm(
      [hard, easy, medium],
      [recovering, fresh, extra],
      history,
      [hard, easy, medium],
      { date: '2026-03-10', shiftType: 'afternoon', rngSeed: 3 },
    )
    const hardAsg = result.assignments.find((a) => a.laneId === 'hard')
    expect(hardAsg?.workerIds.includes('r')).toBe(false)
  })

  it('counts night placements in lane rotation', () => {
    const history = [
      shift(
        'n1',
        '2026-03-08',
        'night',
        [{ laneId: 'hard', workerIds: ['a'] }],
        ['a'],
        ['hard'],
      ),
      shift(
        'm1',
        '2026-03-05',
        'morning',
        [{ laneId: 'hard', workerIds: ['a'] }],
        ['a'],
        ['hard'],
      ),
    ]
    const profile = buildWorkerProfile(
      'a',
      history,
      [hard, easy],
      'morning',
      '2026-03-10',
      14,
    )
    expect(profile.rotationLaneCounts.get('hard')).toBe(2)
    expect(profile.rotationWeightedVisits.get('hard')).toBeCloseTo(1.5 + 1.2)
    expect(profile.daysSinceLastVisit.get('hard')).toBe(2)
    expect(profile.hardCount).toBe(2)
  })

  it('computeWorkerLaneStats counts night shifts in lane totals', () => {
    const history = [
      shift(
        'n1',
        '2026-03-08',
        'night',
        [{ laneId: 'hard', workerIds: ['a'] }],
        ['a'],
        ['hard'],
      ),
      shift(
        'm1',
        '2026-03-05',
        'morning',
        [{ laneId: 'hard', workerIds: ['a'] }],
        ['a'],
        ['hard'],
      ),
      shift(
        'a1',
        '2026-03-06',
        'afternoon',
        [{ laneId: 'easy', workerIds: ['a'] }],
        ['a'],
        ['easy'],
      ),
    ]
    const [stats] = computeWorkerLaneStats(
      [worker('a', 'A')],
      [hard, easy],
      history,
    )
    expect(stats?.byLane.hard).toBe(2)
    expect(stats?.byLane.easy).toBe(1)
    expect(stats?.totalAssignments).toBe(3)
    expect(stats?.hardCount).toBe(2)
    expect(stats?.hardByShift.night).toBe(1)
    expect(stats?.nightEasyCount).toBe(0)
  })

  it('computeWorkerLaneStats counts selector rounds as shares of one shift', () => {
    const rounds = (laneId: string) => [
      {
        startMinutes: 360,
        endMinutes: 480,
        label: '06:00–08:00',
        assignments: [{ laneId, workerIds: ['a'] }],
      },
      {
        startMinutes: 480,
        endMinutes: 600,
        label: '08:00–10:00',
        assignments: [{ laneId: 'easy', workerIds: ['a'] }],
      },
    ]
    const history = [
      {
        ...shift('s1', '2026-03-05', 'morning', [], ['a'], ['hard', 'easy']),
        audience: 'selector' as const,
        rounds: rounds('hard'),
      },
      {
        ...shift('s2', '2026-03-06', 'morning', [], ['a'], ['hard']),
        audience: 'selector' as const,
        rounds: rounds('hard').map((r) =>
          r.label === '08:00–10:00'
            ? { ...r, assignments: [{ laneId: 'hard', workerIds: ['a'] }] }
            : r,
        ),
      },
    ]
    const [stats] = computeWorkerLaneStats(
      [worker('a', 'A')],
      [hard, easy],
      history,
    )
    expect(stats?.byLane.hard).toBeCloseTo(1.5)
    expect(stats?.byLane.easy).toBeCloseTo(0.5)
    expect(stats?.totalAssignments).toBeCloseTo(2)
    expect(stats?.hardCount).toBeCloseTo(1.5)
  })

  it('Test 4 — morning → afternoon handoff prefers afternoon-only on handoff lane', () => {
    const continuer = worker('c', 'Continuer')
    const afternoonOnly = worker('o', 'AfternoonOnly')
    const filler = worker('x', 'Filler')
    const history = [
      shift(
        'm1',
        '2026-03-10',
        'morning',
        [{ laneId: 'customs', workerIds: ['c'] }],
        ['c', 'x'],
        ['customs', 'easy'],
      ),
    ]
    const result = runAssignmentAlgorithm(
      [customs, easy],
      [continuer, afternoonOnly, filler],
      history,
      [customs, easy],
      { date: '2026-03-10', shiftType: 'afternoon', rngSeed: 4 },
    )
    const customsAsg = result.assignments.find((a) => a.laneId === 'customs')
    expect(customsAsg?.workerIds[0]).toBe('o')
  })

  it('Test 5 — hard workload balance prefers lower hard-count worker', () => {
    const heavy = worker('h', 'Heavy', ['forklift'])
    const light = worker('l', 'Light', ['forklift'])
    const filler = worker('z', 'Z')
    const history: ShiftSchedule[] = []
    for (let i = 1; i <= 5; i++) {
      const d = `2026-02-${String(i).padStart(2, '0')}`
      history.push(
        shift(
          `h${i}`,
          d,
          'morning',
          [{ laneId: 'hard', workerIds: ['h'] }],
          ['h'],
          ['hard'],
        ),
      )
    }
    const result = runAssignmentAlgorithm(
      [hard, easy],
      [heavy, light, filler],
      history,
      [hard, easy],
      { date: '2026-03-10', shiftType: 'morning', rngSeed: 5 },
    )
    const hardAsg = result.assignments.find((a) => a.laneId === 'hard')
    expect(hardAsg?.workerIds[0]).toBe('l')
  })

  it('prefers a low-load worker for a hard lane', () => {
    const light = worker('light', 'קלה', ['forklift'])
    const busy = worker('busy', 'עמוס', ['forklift'])
    const history: ShiftSchedule[] = []
    for (let i = 1; i <= 8; i++) {
      const d = `2026-03-${String(i).padStart(2, '0')}`
      history.push(
        shift(
          `b${i}`,
          d,
          'morning',
          [{ laneId: 'med', workerIds: ['busy'] }],
          ['busy'],
          ['med'],
        ),
      )
    }
    history.push(
      shift(
        'r1',
        '2026-03-02',
        'afternoon',
        [{ laneId: 'easy', workerIds: ['light'] }],
        ['light'],
        ['easy'],
      ),
    )
    const result = runAssignmentAlgorithm(
      [hard, easy],
      [light, busy],
      history,
      [hard, medium, easy],
      { date: '2026-03-16', shiftType: 'morning', rngSeed: 21 },
    )
    const hardAsg = result.assignments.find((a) => a.laneId === 'hard')
    expect(hardAsg?.workerIds[0]).toBe('light')
    const note = result.explanations.find((e) => e.workerId === 'light')
    expect(note?.reasons.some((r) => r.includes('עומס'))).toBe(true)
  })

  it('does not put a short-return worker on a hard lane just because their load is lower', () => {
    const quiet = worker('quiet', 'שקטה', ['forklift'])
    const steady = worker('steady', 'יציב', ['forklift'])
    const history = [
      shift(
        'q',
        '2026-03-15',
        'morning',
        [{ laneId: 'hard', workerIds: ['quiet'] }],
        ['quiet'],
        ['hard'],
      ),
    ]
    for (let i = 1; i <= 6; i++) {
      const d = `2026-03-${String(i + 8).padStart(2, '0')}`
      history.push(
        shift(
          `s${i}`,
          d,
          'morning',
          [{ laneId: 'easy', workerIds: ['steady'] }],
          ['steady'],
          ['easy'],
        ),
      )
    }
    const result = runAssignmentAlgorithm(
      [hard, easy],
      [quiet, steady],
      history,
      [hard, easy],
      { date: '2026-03-16', shiftType: 'morning', rngSeed: 22 },
    )
    const hardAsg = result.assignments.find((a) => a.laneId === 'hard')
    expect(hardAsg?.workerIds[0]).toBe('steady')
  })

  it('Test 6 — rotation fairness prefers farther last visit', () => {
    const recent = worker('r', 'Recent')
    const far = worker('f', 'Far')
    const history = [
      shift(
        's1',
        '2026-03-09',
        'morning',
        [{ laneId: 'easy', workerIds: ['r'] }],
        ['r'],
        ['easy'],
      ),
      shift(
        's2',
        '2026-02-20',
        'morning',
        [{ laneId: 'easy', workerIds: ['f'] }],
        ['f'],
        ['easy'],
      ),
    ]
    const result = runAssignmentAlgorithm(
      [easy],
      [recent, far],
      history,
      [easy],
      { date: '2026-03-10', shiftType: 'morning', rngSeed: 6 },
    )
    expect(result.assignments[0]?.workerIds[0]).toBe('f')
  })

  it('Test 7 — same lane repetition is discouraged when alternative exists', () => {
    const a = worker('a', 'A')
    const b = worker('b', 'B')
    const history = [
      shift(
        's1',
        '2026-03-09',
        'morning',
        [{ laneId: 'med', workerIds: ['a'] }],
        ['a'],
        ['med'],
      ),
    ]
    const result = runAssignmentAlgorithm(
      [medium],
      [a, b],
      history,
      [medium],
      { date: '2026-03-10', shiftType: 'morning', rngSeed: 7 },
    )
    expect(result.assignments[0]?.workerIds[0]).toBe('b')
  })

  it('does not return yesterday’s occupant when other qualified people exist', () => {
    const shahar = worker('shahar', 'שחר')
    const freshA = worker('a', 'א')
    const freshB = worker('b', 'ב')
    const customs = lane('customs', 'מכס', { intensity: 'medium' })
    const other = lane('other', 'אחר', { intensity: 'easy' })
    const history = [
      shift(
        'sat',
        '2026-03-14',
        'afternoon',
        [{ laneId: 'customs', workerIds: ['shahar'] }],
        ['shahar'],
        ['customs'],
      ),
    ]
    const result = runAssignmentAlgorithm(
      [customs, other],
      [shahar, freshA, freshB],
      history,
      [customs, other],
      { date: '2026-03-15', shiftType: 'morning', rngSeed: 11 },
    )
    const customsIds =
      result.assignments.find((a) => a.laneId === 'customs')?.workerIds ?? []
    expect(customsIds.includes('shahar')).toBe(false)
  })

  it('Test 8 — understaffing is reported when not enough workers', () => {
    const only = worker('a', 'Only', ['forklift'])
    const result = runAssignmentAlgorithm(
      [hard, medium, easy],
      [only],
      [],
      [hard, medium, easy],
      { date: '2026-03-10', shiftType: 'morning', rngSeed: 8 },
    )
    expect(result.understaffedLaneIds.length).toBeGreaterThan(0)
    expect(
      result.assignments.flatMap((a) => a.workerIds).filter(Boolean).length,
    ).toBe(1)
  })

  it('Test 9 — optimizer never violates qualification', () => {
    const alice = worker('a', 'Alice', [])
    const bob = worker('b', 'Bob', ['forklift'])
    const carol = worker('c', 'Carol')
    const lanes = [hard, medium, easy]
    const workers = [alice, bob, carol]
    const profiles = profilesFor(workers, lanes, [], 'morning', '2026-03-10')
    const illegal = [
      { laneId: 'hard', workerIds: ['a'] },
      { laneId: 'med', workerIds: ['b'] },
      { laneId: 'easy', workerIds: ['c'] },
    ]
    const opt = runMultiPassOptimization({
      assignments: illegal,
      unassignedWorkerIds: [],
      lanes,
      workersById: new Map(workers.map((w) => [w.id, w])),
      profiles,
      maxPasses: 20,
      currentShiftType: 'morning',
      recoveringIds: new Set(),
      morning: null,
      baselineAssignments: illegal,
    })
    for (const a of opt.assignments) {
      const ln = lanes.find((l) => l.id === a.laneId)!
      for (const wid of a.workerIds) {
        if (!wid) continue
        const w = workers.find((x) => x.id === wid)!
        expect(isQualified(w, ln)).toBe(true)
      }
    }
  })

  it('Test 10 — optimizer improves or preserves global objective', () => {
    const workers = [
      worker('a', 'A', ['forklift']),
      worker('b', 'B', ['forklift']),
      worker('c', 'C'),
      worker('d', 'D'),
    ]
    const lanes = [hard, medium, easy]
    const history = [
      shift(
        's1',
        '2026-03-08',
        'morning',
        [
          { laneId: 'hard', workerIds: ['a'] },
          { laneId: 'med', workerIds: ['c'] },
        ],
        ['a', 'c'],
        ['hard', 'med'],
      ),
    ]
    const profiles = profilesFor(workers, lanes, history, 'morning', '2026-03-10')
    const greedy = runAssignmentAlgorithm(lanes, workers, history, lanes, {
      date: '2026-03-10',
      shiftType: 'morning',
      rngSeed: 10,
      maxOptimizationPasses: 0,
    })
    const ctx: EvaluateBoardContext = {
      lanes,
      workersById: new Map(workers.map((w) => [w.id, w])),
      profiles,
      recoveringIds: new Set(),
      morning: null,
      currentShiftType: 'morning',
      baselineAssignments: greedy.assignments,
    }
    const before = evaluateBoard(greedy.assignments, ctx)
    const opt = runMultiPassOptimization({
      assignments: greedy.assignments,
      unassignedWorkerIds: greedy.unassignedWorkerIds,
      lanes,
      workersById: ctx.workersById,
      profiles,
      maxPasses: 30,
      currentShiftType: 'morning',
      recoveringIds: new Set(),
      morning: null,
      baselineAssignments: greedy.assignments,
    })
    const after = evaluateBoard(opt.assignments, ctx)
    expect(after.legal).toBe(true)
    expect(
      isBoardBetter(after, before) || after.score >= before.score - 1e-6,
    ).toBe(true)
  })

  it('Test 11 — deterministic result with same seed', () => {
    const workers = [
      worker('a', 'A', ['forklift']),
      worker('b', 'B'),
      worker('c', 'C'),
      worker('d', 'D', ['forklift']),
    ]
    const lanes = [hard, medium, easy]
    const history = [
      shift(
        's1',
        '2026-03-05',
        'night',
        [{ laneId: 'hard', workerIds: ['a'] }],
        ['a'],
        ['hard'],
      ),
    ]
    const ctx = {
      date: '2026-03-10',
      shiftType: 'morning' as const,
      rngSeed: 'det-seed-42',
    }
    const r1 = runAssignmentAlgorithm(lanes, workers, history, lanes, ctx)
    const r2 = runAssignmentAlgorithm(lanes, workers, history, lanes, ctx)
    expect(r1.assignments).toEqual(r2.assignments)
    expect(r1.unassignedWorkerIds).toEqual(r2.unassignedWorkerIds)
  })

  it('Test 12 — optimizer does not make board worse than greedy', () => {
    const workers = [
      worker('a', 'A', ['forklift']),
      worker('b', 'B', ['forklift']),
      worker('c', 'C'),
      worker('d', 'D'),
      worker('e', 'E'),
    ]
    const lanes = [hard, medium, easy]
    const history: ShiftSchedule[] = []
    for (let i = 1; i <= 4; i++) {
      history.push(
        shift(
          `h${i}`,
          `2026-03-0${i}`,
          'morning',
          [
            { laneId: 'hard', workerIds: [i % 2 === 0 ? 'a' : 'b'] },
            { laneId: 'easy', workerIds: ['c'] },
          ],
          ['a', 'b', 'c'],
          ['hard', 'easy'],
        ),
      )
    }
    const profiles = profilesFor(workers, lanes, history, 'morning', '2026-03-10')
    const greedy = runAssignmentAlgorithm(lanes, workers, history, lanes, {
      date: '2026-03-10',
      shiftType: 'morning',
      rngSeed: 12,
      maxOptimizationPasses: 0,
    })
    const full = runAssignmentAlgorithm(lanes, workers, history, lanes, {
      date: '2026-03-10',
      shiftType: 'morning',
      rngSeed: 12,
      maxOptimizationPasses: 40,
    })
    const ctx: EvaluateBoardContext = {
      lanes,
      workersById: new Map(workers.map((w) => [w.id, w])),
      profiles,
      recoveringIds: new Set(),
      morning: null,
      currentShiftType: 'morning',
      baselineAssignments: greedy.assignments,
    }
    const gScore = evaluateBoard(greedy.assignments, ctx)
    const fScore = evaluateBoard(full.assignments, ctx)
    expect(fScore.legal).toBe(true)
    expect(fScore.score + 1e-6).toBeGreaterThanOrEqual(gScore.score)
  })

  it('edge — empty workers / empty lanes', () => {
    const emptyW = runAssignmentAlgorithm([easy], [], [], [easy], {
      date: '2026-03-10',
      shiftType: 'morning',
    })
    expect(emptyW.understaffedLaneIds).toEqual(['easy'])
    expect(emptyW.warnings.length).toBeGreaterThan(0)

    const emptyL = runAssignmentAlgorithm([], [worker('a', 'A')], [], [], {
      date: '2026-03-10',
      shiftType: 'morning',
    })
    expect(emptyL.assignments).toEqual([])
    expect(emptyL.unassignedWorkerIds).toEqual(['a'])
  })

  it('weights sum approximately to 1', () => {
    const sum = Object.values(DEFAULT_BOARD_WEIGHTS).reduce((a, b) => a + b, 0)
    expect(sum).toBeCloseTo(1, 5)
  })

  it('prefers non-short-return worker when both are qualified', () => {
    const recent = worker('recent', 'Recent', ['forklift'])
    const fresh = worker('fresh', 'Fresh', ['forklift'])
    const history = [
      shift(
        'm1',
        '2026-03-09',
        'morning',
        [{ laneId: 'hard', workerIds: ['recent'] }],
        ['recent'],
        ['hard'],
      ),
    ]
    const result = runAssignmentAlgorithm(
      [hard],
      [recent, fresh],
      history,
      [hard],
      { date: '2026-03-10', shiftType: 'morning', rngSeed: 11 },
    )
    const hardAsg = result.assignments.find((a) => a.laneId === 'hard')
    expect(hardAsg?.workerIds[0]).toBe('fresh')
  })

  it('raw rotation score differentiates D≤1 cases that clamp to 0', () => {
    const yesterday = calculateShiftWeightedRotationScore(1, 1.5, 1.5)
    const earlierToday = calculateShiftWeightedRotationScore(0.5, 1.5, 1.5)
    const threeVisits = calculateShiftWeightedRotationScore(1, 4.5, 1.5)
    expect(yesterday.score).toBe(0)
    expect(earlierToday.score).toBe(0)
    expect(yesterday.rawScore).not.toBe(earlierToday.rawScore)
    expect(threeVisits.rawScore).toBeLessThan(yesterday.rawScore)
    expect(threeVisits.volumePenalty).toBeGreaterThan(yesterday.volumePenalty)
  })

  it('optimizer can fill an empty understaffed lane from unassigned', () => {
    const workers = [
      worker('a', 'A', ['forklift']),
      worker('b', 'B'),
      worker('c', 'C'),
    ]
    const lanes = [hard, easy]
    const profiles = profilesFor(workers, lanes, [], 'morning', '2026-03-10')
    // Greedy-like understaffed board: hard empty, easy filled, two free
    const understaffed = [
      { laneId: 'hard', workerIds: [] as string[] },
      { laneId: 'easy', workerIds: ['b'] },
    ]
    const opt = runMultiPassOptimization({
      assignments: understaffed,
      unassignedWorkerIds: ['a', 'c'],
      lanes,
      workersById: new Map(workers.map((w) => [w.id, w])),
      profiles,
      maxPasses: 20,
      currentShiftType: 'morning',
      recoveringIds: new Set(),
      morning: null,
      baselineAssignments: understaffed,
    })
    const hardAsg = opt.assignments.find((a) => a.laneId === 'hard')
    expect(hardAsg?.workerIds).toContain('a')
  })

  it('history duplicates are not double-counted in profile', () => {
    const dup1 = shift(
      's1',
      '2026-03-08',
      'morning',
      [{ laneId: 'hard', workerIds: ['a'] }],
      ['a'],
      ['hard'],
    )
    const dup2 = {
      ...dup1,
      id: 's2',
      updatedAt: '2026-03-08T12:00:00.000Z',
      assignments: [{ laneId: 'hard', workerIds: ['a'] }],
    }
    expect(dedupeShiftsByDateAndType([dup1, dup2])).toHaveLength(1)
    const p = buildWorkerProfile(
      'a',
      [dup1, dup2],
      [hard],
      'morning',
      '2026-03-10',
      14,
    )
    expect(p.hardCount).toBe(1)
    expect(p.shiftsSeen).toBe(1)
  })

  it('same-day morning hard counts toward afternoon load', () => {
    const history = [
      shift(
        'm1',
        '2026-03-10',
        'morning',
        [{ laneId: 'hard', workerIds: ['a'] }],
        ['a'],
        ['hard'],
      ),
    ]
    const p = buildWorkerProfile(
      'a',
      history,
      [hard],
      'afternoon',
      '2026-03-10',
      14,
    )
    expect(p.lastWasHard).toBe(true)
    expect(p.hardCount).toBe(1)
    // Rest credit (−2) plus a hard morning (+2) lands on zero.
    expect(p.load).toBe(0)
  })

  it('rest days decay cumulative load vs continuous work', () => {
    const continuous = [
      shift(
        'c1',
        '2026-03-08',
        'morning',
        [{ laneId: 'hard', workerIds: ['a'] }],
        ['a'],
        ['hard'],
      ),
      shift(
        'c2',
        '2026-03-09',
        'morning',
        [{ laneId: 'hard', workerIds: ['a'] }],
        ['a'],
        ['hard'],
      ),
    ]
    const withRest = [
      shift(
        'r1',
        '2026-03-08',
        'morning',
        [{ laneId: 'hard', workerIds: ['a'] }],
        ['a'],
        ['hard'],
      ),
      // 2026-03-09 — rest day (no shifts / not on duty)
    ]
    const pCont = buildWorkerProfile(
      'a',
      continuous,
      [hard],
      'morning',
      '2026-03-10',
      14,
    )
    const pRest = buildWorkerProfile(
      'a',
      withRest,
      [hard],
      'morning',
      '2026-03-10',
      14,
    )
    // Days before the shifts count as rest and sit on the floor (−2).
    // One hard morning brings that to 0; the following rest day returns to −2.
    // Two hard mornings end at +2.
    expect(pRest.load).toBe(-2)
    expect(pCont.load).toBeGreaterThan(pRest.load)
    expect(pCont.load).toBe(2)
  })
  it('day-easy credit and easy-only day decay lower load vs hard day', () => {
    const easyLane = lane('easy', 'קל', { intensity: 'easy' })
    const hardOnly = [
      shift(
        'h1',
        '2026-03-08',
        'morning',
        [{ laneId: 'hard', workerIds: ['a'] }],
        ['a'],
        ['hard'],
      ),
    ]
    const easyOnly = [
      shift(
        'e1',
        '2026-03-08',
        'morning',
        [{ laneId: 'easy', workerIds: ['a'] }],
        ['a'],
        ['easy'],
      ),
    ]
    const pHard = buildWorkerProfile(
      'a',
      hardOnly,
      [hard, easyLane],
      'morning',
      '2026-03-09',
      14,
    )
    const pEasy = buildWorkerProfile(
      'a',
      easyOnly,
      [hard, easyLane],
      'morning',
      '2026-03-09',
      14,
    )
    // Rest days before the shift fill the floor (−2).
    // Hard morning cancels that credit (0). Easy morning stays at the floor.
    expect(pHard.load).toBe(0)
    expect(pEasy.load).toBe(-2)
    expect(pEasy.load).toBeLessThan(pHard.load)
  })
})

describe('accumulateLoadBalance', () => {
  const hardLane = lane('hard', 'קשה', {
    intensity: 'hard',
    requiredCertifications: [],
  })
  const easyLane = lane('easy', 'קל', { intensity: 'easy' })

  it('offsets a hard morning with one day off, and does not go below the floor', () => {
    const laneMap = new Map([['hard', hardLane]])
    const byDate = groupShiftsByDate([
      shift(
        'm1',
        '2026-03-08',
        'morning',
        [{ laneId: 'hard', workerIds: ['a'] }],
        ['a'],
        ['hard'],
      ),
    ])
    const balance = accumulateLoadBalance(
      'a',
      byDate,
      laneMap,
      '2026-03-08',
      '2026-03-09',
    )
    // hard morning +2, next day off −2 → 0. A further day off stops at −2.
    expect(balance.net).toBe(0)
    expect(balance.rose).toBe(2)
    expect(balance.fell).toBe(2)
    const floored = accumulateLoadBalance(
      'a',
      byDate,
      laneMap,
      '2026-03-08',
      '2026-03-10',
    )
    expect(floored.net).toBe(-2)
    expect(floored.fell).toBe(4)
  })

  it('treats hard morning and hard afternoon as equal, and stacks them the same day', () => {
    const laneMap = new Map([['hard', hardLane]])
    const one = accumulateLoadBalance(
      'a',
      groupShiftsByDate([
        shift(
          'm',
          '2026-03-08',
          'morning',
          [{ laneId: 'hard', workerIds: ['a'] }],
          ['a'],
          ['hard'],
        ),
      ]),
      laneMap,
      '2026-03-08',
      '2026-03-08',
    )
    const both = accumulateLoadBalance(
      'a',
      groupShiftsByDate([
        shift(
          'm',
          '2026-03-08',
          'morning',
          [{ laneId: 'hard', workerIds: ['a'] }],
          ['a'],
          ['hard'],
        ),
        shift(
          'a1',
          '2026-03-08',
          'afternoon',
          [{ laneId: 'hard', workerIds: ['a'] }],
          ['a'],
          ['hard'],
        ),
      ]),
      laneMap,
      '2026-03-08',
      '2026-03-08',
    )
    expect(one.net).toBe(2)
    expect(both.net).toBe(4)
  })

  it('counts an easy day as a small drop and a hard night as two hard days', () => {
    const laneMap = new Map([
      ['easy', easyLane],
      ['hard', hardLane],
    ])
    const easy = accumulateLoadBalance(
      'a',
      groupShiftsByDate([
        shift(
          'e1',
          '2026-03-08',
          'morning',
          [{ laneId: 'easy', workerIds: ['a'] }],
          ['a'],
          ['easy'],
        ),
      ]),
      laneMap,
      '2026-03-08',
      '2026-03-08',
    )
    const night = accumulateLoadBalance(
      'a',
      groupShiftsByDate([
        shift(
          'n1',
          '2026-03-08',
          'night',
          [{ laneId: 'hard', workerIds: ['a'] }],
          ['a'],
          ['hard'],
        ),
      ]),
      laneMap,
      '2026-03-08',
      '2026-03-08',
    )
    expect(easy.net).toBe(-1)
    expect(night.net).toBe(4)
  })

  it('counts every selector round of one afternoon as one shift', () => {
    const laneMap = new Map([['hard', hardLane]])
    const base = shift(
      'r',
      '2026-03-08',
      'afternoon',
      [],
      ['a'],
      ['hard'],
    )
    const balance = accumulateLoadBalance(
      'a',
      groupShiftsByDate([
        {
          ...base,
          assignmentMode: 'rounds',
          rounds: [
            {
              startMinutes: 14 * 60,
              endMinutes: 16 * 60,
              label: '14:00–16:00',
              assignments: [{ laneId: 'hard', workerIds: ['a'] }],
            },
            {
              startMinutes: 16 * 60,
              endMinutes: 18 * 60,
              label: '16:00–18:00',
              assignments: [{ laneId: 'hard', workerIds: ['a'] }],
            },
          ],
        },
      ]),
      laneMap,
      '2026-03-08',
      '2026-03-08',
    )
    expect(balance.net).toBe(2)
  })

  it('treats present-only day as on duty without adding placement points', () => {
    const laneMap = new Map([['hard', hardLane]])
    const byDate = groupShiftsByDate([
      shift('m1', '2026-03-08', 'morning', [], ['a'], ['hard']),
    ])
    const balance = accumulateLoadBalance(
      'a',
      byDate,
      laneMap,
      '2026-03-08',
      '2026-03-08',
    )
    expect(balance.net).toBe(0)
    expect(balance.rose).toBe(0)
    expect(balance.fell).toBe(0)
  })
})

describe('benchmark smoke', () => {
  it('runs medium board and reports metrics', () => {
    const lanes: Lane[] = []
    for (let i = 0; i < 12; i++) {
      lanes.push(
        lane(`L${i}`, `Lane ${i}`, {
          intensity: i % 3 === 0 ? 'hard' : i % 3 === 1 ? 'medium' : 'easy',
          requiredCertifications: i % 4 === 0 ? ['forklift'] : [],
          staffingStandard: i % 5 === 0 ? 2 : 1,
        }),
      )
    }
    const workers: Worker[] = []
    for (let i = 0; i < 40; i++) {
      workers.push(
        worker(`W${i}`, `Worker ${i}`, i % 3 === 0 ? ['forklift'] : []),
      )
    }
    const history: ShiftSchedule[] = []
    for (let d = 1; d <= 7; d++) {
      const date = `2026-02-${String(d).padStart(2, '0')}`
      history.push(
        shift(
          `hist-${d}`,
          date,
          d % 3 === 0 ? 'night' : 'morning',
          lanes.slice(0, 8).map((l, idx) => ({
            laneId: l.id,
            workerIds: [`W${(d + idx) % 40}`],
          })),
          workers.map((w) => w.id),
          lanes.map((l) => l.id),
        ),
      )
    }

    const t0 = performance.now()
    const greedy = runAssignmentAlgorithm(lanes, workers, history, lanes, {
      date: '2026-03-01',
      shiftType: 'morning',
      rngSeed: 'bench',
      maxOptimizationPasses: 0,
    })
    const tGreedy = performance.now()
    const full = runAssignmentAlgorithm(lanes, workers, history, lanes, {
      date: '2026-03-01',
      shiftType: 'morning',
      rngSeed: 'bench',
      maxOptimizationPasses: 25,
    })
    const tFull = performance.now()

    const profiles = profilesFor(workers, lanes, history, 'morning', '2026-03-01')
    const ctx: EvaluateBoardContext = {
      lanes,
      workersById: new Map(workers.map((w) => [w.id, w])),
      profiles,
      recoveringIds: new Set(),
      morning: null,
      currentShiftType: 'morning',
      baselineAssignments: greedy.assignments,
    }
    const gEval = evaluateBoard(greedy.assignments, ctx)
    const fEval = evaluateBoard(full.assignments, ctx)

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          greedyMs: +(tGreedy - t0).toFixed(1),
          fullMs: +(tFull - tGreedy).toFixed(1),
          assignments: full.assignments
            .flatMap((a) => a.workerIds)
            .filter(Boolean).length,
          understaffed: full.understaffedLaneIds.length,
          greedyScore: +gEval.score.toFixed(2),
          fullScore: +fEval.score.toFixed(2),
          minDaysSince: fEval.minDaysSince,
          totalRotation: +fEval.totalRotation.toFixed(1),
        },
        null,
        2,
      ),
    )

    expect(fEval.score + 1e-6).toBeGreaterThanOrEqual(gEval.score)
    expect(tFull - t0).toBeLessThan(30_000)
  })
})
