import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Info, Shield, X } from 'lucide-react'
import { explainSavedBoard } from '../algorithm'
import { INTENSITY_LABELS } from '../constants'
import { useApp } from '../context/AppContext'
import { isGateManagerLane } from '../lib/gateManager'
import { visibleExplanationReasons } from './AssignmentExplainDialog'
import { Ltr, TraineeBadge } from './ui'
import { effectiveStaffingStandard } from '../lib/shiftStaffing'
import type {
  Intensity,
  Lane,
  LaneAssignment,
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
  notes?: string
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
  assignments: LaneAssignment[],
): GateIsland[] {
  const order = new Map(lanes.map((lane, index) => [lane.id, index]))
  const islands: GateIsland[] = []
  for (const laneId of shift.activeLaneIds) {
    const lane = lanes.find((item) => item.id === laneId)
    if (!lane || isGateManagerLane(lane)) continue
    const row = assignments.find((item) => item.laneId === laneId)
    const assigned = peopleFromIds(row?.workerIds ?? [], workers)
    const required = effectiveStaffingStandard(lane, shift.staffingOverrides)
    islands.push({
      laneId,
      name: lane.name,
      intensity: lane.intensity,
      required,
      workers: assigned,
      missing: Math.max(0, required - assigned.length),
      notes: row?.notes,
    })
  }
  return islands.sort(
    (a, b) =>
      (order.get(a.laneId) ?? 0) - (order.get(b.laneId) ?? 0) ||
      a.name.localeCompare(b.name, 'he'),
  )
}

function IslandNode({
  island,
  delayMs,
  selected,
  onSelect,
}: {
  island: GateIsland
  delayMs: number
  selected: boolean
  onSelect: () => void
}) {
  const filled = island.missing <= 0 && island.workers.length > 0
  const empty = island.workers.length === 0
  return (
    <button
      type="button"
      className={`gate-island gate-island--${island.intensity} ${
        island.missing > 0 ? 'gate-island--gap' : filled ? 'gate-island--ok' : ''
      } ${empty ? 'gate-island--empty' : ''} ${selected ? 'is-selected' : ''}`}
      style={{ animationDelay: `${delayMs}ms` }}
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`פרטי עמדה ${island.name}`}
    >
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
            aria-hidden
          >
            {island.missing > 0 ? (
              <AlertTriangle className="size-5" />
            ) : (
              <CheckCircle2 className="size-5" />
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
        <p className="gate-island__hint">
          <Info className="size-3.5 shrink-0" aria-hidden />
          לחיצה להסבר שיבוץ
        </p>
        {island.missing > 0 ? (
          <p className="gate-island__gap">חסר {island.missing}</p>
        ) : null}
      </div>
    </button>
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
  const { data } = useApp()
  const [now, setNow] = useState(() => Date.now())
  const [selectedLaneId, setSelectedLaneId] = useState<string | null>(null)
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

  const currentAssignments = useMemo(() => {
    if (hasRounds) return rounds[activeRoundIndex]?.assignments ?? []
    return shift.assignments
  }, [hasRounds, rounds, activeRoundIndex, shift.assignments])

  const islands = useMemo(
    () => islandsFromAssignments(shift, lanes, workers, currentAssignments),
    [shift, lanes, workers, currentAssignments],
  )

  useEffect(() => {
    if (selectedLaneId && !islands.some((island) => island.laneId === selectedLaneId)) {
      setSelectedLaneId(null)
    }
  }, [islands, selectedLaneId])

  const explanations = useMemo(() => {
    const activeLanes = lanes
      .filter(
        (lane) =>
          shift.activeLaneIds.includes(lane.id) && !isGateManagerLane(lane),
      )
      .map((lane) => ({
        ...lane,
        staffingStandard: effectiveStaffingStandard(lane, shift.staffingOverrides),
      }))
    const rebuilt = explainSavedBoard({
      assignments: currentAssignments,
      activeLanes,
      presentWorkers: workers.filter(
        (worker) =>
          shift.presentWorkerIds.includes(worker.id) &&
          worker.id !== shift.gateManagerWorkerId,
      ),
      history: data.history.filter((item) => item.id !== shift.id),
      allLanes: lanes,
      date: shift.date,
      shiftType: shift.shiftType,
    })
    const byKey = new Map<string, (typeof rebuilt)[number]>()
    for (const item of rebuilt) {
      byKey.set(`${item.laneId}:${item.workerId}`, item)
    }
    for (const item of shift.explanations ?? []) {
      const reasons = visibleExplanationReasons(item.reasons)
      if (!reasons.length && !item.decision) continue
      const key = `${item.laneId}:${item.workerId}`
      const prev = byKey.get(key)
      byKey.set(key, {
        ...prev,
        ...item,
        laneId: item.laneId,
        workerId: item.workerId,
        reasons: item.reasons?.length ? item.reasons : prev?.reasons ?? [],
        candidateRanking: item.candidateRanking ?? prev?.candidateRanking,
        decision: item.decision ?? prev?.decision,
      })
    }
    return [...byKey.values()]
  }, [
    currentAssignments,
    data.history,
    lanes,
    shift.activeLaneIds,
    shift.date,
    shift.explanations,
    shift.gateManagerWorkerId,
    shift.id,
    shift.presentWorkerIds,
    shift.shiftType,
    shift.staffingOverrides,
    workers,
  ])

  const selected = islands.find((island) => island.laneId === selectedLaneId) ?? null

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
        </div>
        <div className="gate-map__grid">
          {islands.map((island, index) => (
            <IslandNode
              key={island.laneId}
              island={island}
              delayMs={index * 55}
              selected={island.laneId === selectedLaneId}
              onSelect={() =>
                setSelectedLaneId((current) =>
                  current === island.laneId ? null : island.laneId,
                )
              }
            />
          ))}
        </div>
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
              <div
                key={`${round.startMinutes}-${round.label}`}
                className={`gate-map__tick ${state}`}
              >
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

      {selected ? (
        <div
          className="gate-detail"
          role="dialog"
          aria-modal="true"
          aria-label={`הסבר שיבוץ · ${selected.name}`}
        >
          <button
            type="button"
            className="gate-detail__backdrop board-kiosk__exit"
            aria-label="סגירה"
            onClick={() => setSelectedLaneId(null)}
          />
          <div className="gate-detail__panel">
            <header className="gate-detail__head">
              <div className="min-w-0">
                <p className="gate-detail__eyebrow">הסבר שיבוץ</p>
                <h3 className="gate-detail__title">{selected.name}</h3>
                <p className="gate-detail__meta">
                  {INTENSITY_LABELS[selected.intensity]} ·{' '}
                  {selected.workers.length}/{selected.required} מאוישים
                  {activeRound ? (
                    <>
                      {' · '}
                      <Ltr>{activeRound.label}</Ltr>
                    </>
                  ) : null}
                </p>
              </div>
              <button
                type="button"
                className="gate-detail__close board-kiosk__exit"
                onClick={() => setSelectedLaneId(null)}
                aria-label="סגירת ההסבר"
              >
                <X className="size-5" aria-hidden />
              </button>
            </header>

            <div className="gate-detail__body">
              {selected.workers.length === 0 ? (
                <p className="gate-detail__empty">אין משובצים בעמדה הזו כרגע.</p>
              ) : (
                selected.workers.map((person) => {
                  const explanation = explanations.find(
                    (item) =>
                      item.laneId === selected.laneId &&
                      item.workerId === person.id,
                  )
                  const reasons = explanation
                    ? visibleExplanationReasons(explanation.reasons)
                    : []
                  return (
                    <section key={person.id} className="gate-detail__person">
                      <div className="gate-detail__person-head">
                        <span className="gate-detail__person-name">
                          {person.name}
                        </span>
                        {person.trainingRole === 'trainee' ? (
                          <TraineeBadge />
                        ) : null}
                      </div>
                      {reasons.length > 0 ? (
                        <>
                          <p className="gate-detail__section-label">
                            למה שובץ כאן
                          </p>
                          <ul className="gate-detail__reasons">
                            {reasons.map((reason) => (
                              <li key={reason}>{reason}</li>
                            ))}
                          </ul>
                        </>
                      ) : (
                        <p className="gate-detail__empty">
                          אין הסבר שמור לשיבוץ הזה.
                        </p>
                      )}
                      {explanation?.decision ? (
                        <div className="gate-detail__decision">
                          <p className="gate-detail__section-label">מה הכריע?</p>
                          <p>{explanation.decision}</p>
                        </div>
                      ) : null}
                    </section>
                  )
                })
              )}
              {selected.notes ? (
                <p className="gate-detail__notes">{selected.notes}</p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
