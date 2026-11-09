import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Shield } from 'lucide-react'
import { INTENSITY_LABELS } from '../constants'
import { isGateManagerLane } from '../lib/gateManager'
import { Ltr, TraineeBadge } from './ui'
import { effectiveStaffingStandard } from '../lib/shiftStaffing'
import type {
  Intensity,
  Lane,
  SelectorRound,
  ShiftSchedule,
  StaffingStandard,
  Worker,
} from '../types'

export type GatePerson = {
  id: string
  name: string
  trainingRole?: 'trainee' | 'mentor'
}

export type GateIsland = {
  laneId: string
  name: string
  intensity: Intensity
  required: StaffingStandard
  workers: GatePerson[]
  missing: number
}

function minutesOfDay(date = new Date()): number {
  return date.getHours() * 60 + date.getMinutes()
}

function roundContains(round: SelectorRound, minutes: number): boolean {
  const start = round.startMinutes
  const end = round.endMinutes
  if (end > start) return minutes >= start && minutes < end
  return minutes >= start || minutes < end
}

/** Live round if possible; otherwise nearest upcoming, else last. */
export function spotlightRoundIndex(
  rounds: SelectorRound[],
  minutes = minutesOfDay(),
): number {
  if (rounds.length === 0) return 0
  const live = rounds.findIndex((round) => roundContains(round, minutes))
  if (live >= 0) return live
  const upcoming = rounds.findIndex((round) => {
    if (round.endMinutes > round.startMinutes) return minutes < round.startMinutes
    return minutes < round.startMinutes && minutes >= round.endMinutes
  })
  if (upcoming >= 0) return upcoming
  return rounds.length - 1
}

function peopleFromIds(
  ids: string[],
  workers: Worker[],
): GatePerson[] {
  return ids.filter(Boolean).map((id) => {
    const worker = workers.find((item) => item.id === id)
    return {
      id,
      name: worker?.fullName ?? id,
      trainingRole: worker?.trainingRole,
    }
  })
}

function islandsFromAssignments(
  shift: ShiftSchedule,
  lanes: Lane[],
  workers: Worker[],
  assignments: { laneId: string; workerIds: string[] }[],
): GateIsland[] {
  const order = new Map(lanes.map((lane, index) => [lane.id, index]))
  const islands: GateIsland[] = []
  for (const laneId of shift.activeLaneIds) {
    const lane = lanes.find((item) => item.id === laneId)
    if (!lane || isGateManagerLane(lane)) continue
    const assigned = peopleFromIds(
      assignments.find((row) => row.laneId === laneId)?.workerIds ?? [],
      workers,
    )
    const required = effectiveStaffingStandard(lane, shift.staffingOverrides)
    islands.push({
      laneId,
      name: lane.name,
      intensity: lane.intensity,
      required,
      workers: assigned,
      missing: Math.max(0, required - assigned.length),
    })
  }
  return islands.sort(
    (a, b) =>
      (order.get(a.laneId) ?? 0) - (order.get(b.laneId) ?? 0) ||
      a.name.localeCompare(b.name, 'he'),
  )
}

/** Staggered “throat of the gate” coordinates in percent. */
function gateCoordinates(count: number): { x: number; y: number }[] {
  if (count <= 0) return []
  const cols = count <= 3 ? count : count <= 6 ? 3 : count <= 10 ? 4 : 5
  const rows = Math.ceil(count / cols)
  return Array.from({ length: count }, (_, index) => {
    const row = Math.floor(index / cols)
    const col = index % cols
    const inRow = Math.min(cols, count - row * cols)
    const rowWidth = 62 + row * 6
    const startX = (100 - rowWidth) / 2
    const step = inRow <= 1 ? 0 : rowWidth / (inRow - 1)
    const x = startX + col * step
    const y = 14 + (row / Math.max(rows - 1, 1)) * 62 + ((col % 2) * 3.5)
    const sway = Math.sin((index + 1) * 1.7) * 3.2
    return {
      x: Math.min(92, Math.max(8, x + sway)),
      y: Math.min(86, Math.max(10, y)),
    }
  })
}

function IslandNode({
  island,
  x,
  y,
  delayMs,
}: {
  island: GateIsland
  x: number
  y: number
  delayMs: number
}) {
  const filled = island.missing <= 0 && island.workers.length > 0
  const empty = island.workers.length === 0
  return (
    <article
      className={`gate-island gate-island--${island.intensity} ${
        island.missing > 0 ? 'gate-island--gap' : filled ? 'gate-island--ok' : ''
      } ${empty ? 'gate-island--empty' : ''}`}
      style={{
        left: `${x}%`,
        top: `${y}%`,
        animationDelay: `${delayMs}ms`,
      }}
    >
      <div className="gate-island__aura" aria-hidden />
      <div className="gate-island__card">
        <header className="gate-island__head">
          <div className="min-w-0">
            <h3 className="gate-island__title">{island.name}</h3>
            <p className="gate-island__meta">
              {INTENSITY_LABELS[island.intensity]} · תקן {island.required}
            </p>
          </div>
          <span
            className={`gate-island__status ${
              island.missing > 0 ? 'is-gap' : 'is-ok'
            }`}
            aria-label={
              island.missing > 0 ? `חסר ${island.missing}` : 'מאויש'
            }
          >
            {island.missing > 0 ? (
              <AlertTriangle className="size-5" aria-hidden />
            ) : (
              <CheckCircle2 className="size-5" aria-hidden />
            )}
          </span>
        </header>
        <ul className="gate-island__people">
          {island.workers.length === 0 ? (
            <li className="gate-island__vacant">פנוי</li>
          ) : (
            island.workers.map((person) => (
              <li key={person.id} className="gate-island__person">
                <span className="truncate">{person.name}</span>
                {person.trainingRole === 'trainee' ? <TraineeBadge /> : null}
              </li>
            ))
          )}
        </ul>
        {island.missing > 0 ? (
          <p className="gate-island__gap">חסר {island.missing}</p>
        ) : null}
      </div>
    </article>
  )
}

export function GateMapKiosk({
  shift,
  lanes,
  workers,
}: {
  shift: ShiftSchedule
  lanes: Lane[]
  workers: Worker[]
}) {
  const [now, setNow] = useState(() => Date.now())
  const rounds = shift.rounds ?? []
  const hasRounds = rounds.length > 0

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(id)
  }, [])

  const activeRoundIndex = useMemo(
    () => (hasRounds ? spotlightRoundIndex(rounds, minutesOfDay(new Date(now))) : 0),
    [hasRounds, rounds, now],
  )

  const activeRound = hasRounds ? rounds[activeRoundIndex] : null

  const islands = useMemo(() => {
    const assignments = hasRounds
      ? (rounds[activeRoundIndex]?.assignments ?? [])
      : shift.assignments
    return islandsFromAssignments(shift, lanes, workers, assignments)
  }, [shift, lanes, workers, hasRounds, rounds, activeRoundIndex])

  const coords = useMemo(() => gateCoordinates(islands.length), [islands.length])

  const ramashName = shift.gateManagerWorkerId
    ? workers.find((worker) => worker.id === shift.gateManagerWorkerId)?.fullName
    : undefined

  const assignedIds = new Set(islands.flatMap((island) => island.workers.map((p) => p.id)))
  const unassigned = shift.presentWorkerIds
    .filter((id) => !assignedIds.has(id) && id !== shift.gateManagerWorkerId)
    .map((id) => {
      const worker = workers.find((item) => item.id === id)
      return {
        id,
        name: worker?.fullName ?? id,
        trainingRole: worker?.trainingRole,
      } satisfies GatePerson
    })

  const missingTotal = islands.reduce((sum, island) => sum + island.missing, 0)
  const staffed = islands.reduce(
    (sum, island) => sum + Math.min(island.required, island.workers.length),
    0,
  )
  const required = islands.reduce((sum, island) => sum + island.required, 0)

  return (
    <div className="gate-map" role="region" aria-label="מפת שער חיה">
      <div className="gate-map__status">
        <div className="gate-map__stat">
          <span className="gate-map__stat-label">כיסוי</span>
          <span className="gate-map__stat-value tabular-nums">
            {staffed}/{required}
          </span>
        </div>
        <div
          className={`gate-map__stat ${missingTotal > 0 ? 'is-gap' : 'is-ok'}`}
        >
          <span className="gate-map__stat-label">
            {missingTotal > 0 ? 'חוסרים' : 'סטטוס'}
          </span>
          <span className="gate-map__stat-value">
            {missingTotal > 0 ? `חסר ${missingTotal}` : 'מלא'}
          </span>
        </div>
        {ramashName ? (
          <div className="gate-map__stat gate-map__ramash">
            <Shield className="size-4 shrink-0 opacity-80" aria-hidden />
            <div className="min-w-0">
              <span className="gate-map__stat-label">מנהל משמרת</span>
              <span className="gate-map__stat-value truncate">{ramashName}</span>
            </div>
          </div>
        ) : null}
        {activeRound ? (
          <div className="gate-map__stat gate-map__live">
            <span className="gate-map__live-dot" aria-hidden />
            <div className="min-w-0">
              <span className="gate-map__stat-label">סבב בזרקור</span>
              <span className="gate-map__stat-value">
                <Ltr>{activeRound.label}</Ltr>
              </span>
            </div>
          </div>
        ) : null}
      </div>

      <div className="gate-map__stage">
        <div className="gate-map__corridor" aria-hidden>
          <span className="gate-map__beam" />
          <span className="gate-map__beam gate-map__beam--delay" />
          <span className="gate-map__throat" />
        </div>
        {islands.map((island, index) => {
          const point = coords[index] ?? { x: 50, y: 40 }
          return (
            <IslandNode
              key={island.laneId}
              island={island}
              x={point.x}
              y={point.y}
              delayMs={index * 70}
            />
          )
        })}
      </div>

      {hasRounds ? (
        <div className="gate-map__timeline" aria-label="סבבים">
          {rounds.map((round, index) => {
            const state =
              index === activeRoundIndex
                ? 'is-live'
                : index < activeRoundIndex
                  ? 'is-past'
                  : 'is-next'
            return (
              <div key={`${round.startMinutes}-${round.label}`} className={`gate-map__tick ${state}`}>
                <span className="gate-map__tick-dot" aria-hidden />
                <span className="gate-map__tick-label">
                  <Ltr>{round.label}</Ltr>
                </span>
              </div>
            )
          })}
        </div>
      ) : null}

      {unassigned.length > 0 ? (
        <div className="gate-map__bench">
          <span className="gate-map__bench-label">לא שובצו</span>
          <ul className="gate-map__bench-list">
            {unassigned.map((person) => (
              <li key={person.id} className="gate-map__bench-person">
                <span className="truncate">{person.name}</span>
                {person.trainingRole === 'trainee' ? <TraineeBadge /> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
