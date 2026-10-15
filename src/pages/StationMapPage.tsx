import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Box, CalendarDays, Check, Layers3, UsersRound } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { EmptyState, Ltr, PersonChip, SectionCard } from '../components/ui'
import { effectiveStaffingStandard } from '../lib/shiftStaffing'
import { currentShiftModel, resolveShiftModels, shiftModelLabel } from '../lib/shiftModels'
import { formatShiftModelWindow } from '../lib/shiftModels'
import { isGateManagerLane } from '../lib/gateManager'
import { formatShiftDate } from '../lib/hebrew'
import type { Lane, LaneAssignment, ShiftSchedule, ShiftType, StaffingStandard } from '../types'

type Station = {
  lane: Lane
  assignment: LaneAssignment | undefined
  workerIds: string[]
  required: StaffingStandard
  missing: number
}

function selectedShift(data: ReturnType<typeof useApp>['data'], date: string, type: ShiftType, audience: 'selector' | 'inspector') {
  return [...data.history]
    .filter((shift) => shift.date === date && shift.shiftType === type && (audience === 'selector' ? shift.audience === 'selector' : shift.audience !== 'selector'))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
}

function assignmentsForShift(shift: ShiftSchedule, roundIndex: number): LaneAssignment[] {
  if (shift.rounds?.length) return shift.rounds[Math.min(roundIndex, shift.rounds.length - 1)]?.assignments ?? []
  return shift.assignments
}

function StationCard({ station, active, onClick, workerNames }: {
  station: Station
  active: boolean
  onClick: () => void
  workerNames: Map<string, string>
}) {
  const hasGap = station.missing > 0
  const Icon = hasGap ? AlertTriangle : Check
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`group relative min-h-[142px] w-full text-start transition duration-200 hover:-translate-y-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand [transform-style:preserve-3d] ${active ? 'z-10' : ''}`}
    >
      <span className={`absolute inset-x-2 bottom-0 top-3 rounded-xl opacity-80 [transform:translateZ(-12px)] ${hasGap ? 'bg-hard/25' : 'bg-brand/20'}`} aria-hidden />
      <span className={`relative flex h-full min-h-[142px] flex-col rounded-xl border p-3 shadow-[0_12px_18px_-10px_rgb(20_35_55/0.28)] [transform:perspective(900px)_rotateX(5deg)] transition group-hover:shadow-[0_18px_22px_-12px_rgb(20_35_55/0.36)] ${hasGap ? 'border-hard/30 bg-card' : 'border-line bg-card'} ${active ? 'ring-2 ring-brand ring-offset-2 ring-offset-surface' : ''}`}>
        <span className="flex items-start justify-between gap-2">
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold text-ink">{station.lane.name}</span>
            <span className="mt-0.5 block text-[11px] text-ink-soft">{isGateManagerLane(station.lane) ? 'עמדת מנהל' : 'עמדת שיבוץ'}</span>
          </span>
          <span className={`inline-flex size-7 shrink-0 items-center justify-center rounded-lg ${hasGap ? 'bg-hard-soft text-hard' : 'bg-ok-soft text-ok'}`}>
            <Icon className="size-4" aria-hidden />
          </span>
        </span>
        <span className="mt-3 flex flex-wrap gap-1.5">
          {station.workerIds.length ? station.workerIds.slice(0, 3).map((id) => (
            <span key={id} className="max-w-full truncate rounded-full bg-surface px-2 py-1 text-[11px] font-medium text-ink">{workerNames.get(id) || 'עובד לא מזוהה'}</span>
          )) : <span className="text-xs text-ink-soft">אין משובצים</span>}
          {station.workerIds.length > 3 ? <span className="rounded-full bg-surface px-2 py-1 text-[11px] text-ink-soft">+{station.workerIds.length - 3}</span> : null}
        </span>
        <span className={`mt-auto pt-3 text-xs font-bold ${hasGap ? 'text-hard' : 'text-ok'}`}>
          {hasGap ? `חסר ${station.missing}` : `${station.workerIds.length} / ${station.required} מאוישים`}
        </span>
      </span>
    </button>
  )
}

export function StationMapPage() {
  const { data, module } = useApp()
  const moduleKey = module === 'inspectors' ? 'inspectors' : 'selectors'
  const models = useMemo(() => resolveShiftModels(data.shiftModels, moduleKey), [data.shiftModels, moduleKey])
  const initial = currentShiftModel(models)
  const [date, setDate] = useState(initial.date)
  const [shiftType, setShiftType] = useState<ShiftType>(initial.model.id as ShiftType)
  const [roundIndex, setRoundIndex] = useState(0)
  const [selectedLaneId, setSelectedLaneId] = useState<string | null>(null)
  useEffect(() => {
    if (!models.some((model) => model.id === shiftType)) {
      const current = currentShiftModel(models)
      setShiftType(current.model.id as ShiftType)
      setDate(current.date)
      setRoundIndex(0)
      setSelectedLaneId(null)
    }
  }, [models, shiftType])
  const audience = module === 'inspectors' ? 'inspector' : 'selector'
  const shift = useMemo(() => selectedShift(data, date, shiftType, audience), [data, date, shiftType, audience])
  const workerNames = useMemo(() => new Map(data.workers.map((worker) => [worker.id, worker.fullName])), [data.workers])
  const rounds = shift?.rounds ?? []
  const currentRoundIndex = Math.min(roundIndex, Math.max(rounds.length - 1, 0))
  const currentAssignments = useMemo(() => shift ? assignmentsForShift(shift, currentRoundIndex) : [], [shift, currentRoundIndex])
  const stations = useMemo(() => {
    if (!shift) return []
    return shift.activeLaneIds
      .map((laneId) => {
        const lane = data.lanes.find((item) => item.id === laneId)
        if (!lane) return null
        const assignment = currentAssignments.find((item) => item.laneId === laneId)
        const workerIds = (assignment?.workerIds ?? []).filter(Boolean)
        const required = effectiveStaffingStandard(lane, shift.staffingOverrides)
        return { lane, assignment, workerIds, required, missing: Math.max(0, required - workerIds.length) }
      })
      .filter((station): station is Station => station !== null)
  }, [shift, data.lanes, currentAssignments])
  const selectedStation = stations.find((station) => station.lane.id === selectedLaneId) ?? null
  const staffed = stations.reduce((sum, station) => sum + Math.min(station.required, station.workerIds.length), 0)
  const required = stations.reduce((sum, station) => sum + station.required, 0)
  const gaps = stations.reduce((sum, station) => sum + station.missing, 0)
  const assignedWorkerIds = new Set(stations.flatMap((station) => station.workerIds))
  const unassignedWorkerIds = (shift?.presentWorkerIds ?? []).filter((id) => !assignedWorkerIds.has(id))

  return (
    <div className="space-y-4">
      <SectionCard
        title="מפת עמדות חיה"
        subtitle="מפה תלת־ממדית סכמטית של העמדות והכיסוי לפי השיבוץ השמור."
        actions={
          <div className="grid w-full grid-cols-1 gap-2 sm:w-auto sm:grid-cols-2">
            <label className="relative">
              <CalendarDays className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-ink-soft" aria-hidden />
              <input type="date" aria-label="תאריך המשמרת" className="ui-input w-full ps-9" value={date} onChange={(event) => { setDate(event.target.value); setSelectedLaneId(null) }} />
            </label>
            <select aria-label="סוג המשמרת" className="ui-input" value={shiftType} onChange={(event) => { setShiftType(event.target.value as ShiftType); setRoundIndex(0); setSelectedLaneId(null) }}>
              {models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
            </select>
          </div>
        }
      >
        <div className="mb-4 grid gap-2 sm:grid-cols-3">
          <div className="flex items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5"><UsersRound className="size-5 text-brand" aria-hidden /><div><p className="text-xs text-ink-soft">עמדות מאוישות</p><p className="font-bold text-ink"><Ltr>{staffed} / {required}</Ltr></p></div></div>
          <div className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${gaps ? 'border-hard/30 bg-hard-soft' : 'border-line bg-surface'}`}><AlertTriangle className={`size-5 ${gaps ? 'text-hard' : 'text-ok'}`} aria-hidden /><div><p className="text-xs text-ink-soft">מקומות חסרים</p><p className="font-bold text-ink"><Ltr>{gaps}</Ltr></p></div></div>
          <div className="flex items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5"><Layers3 className="size-5 text-brand" aria-hidden /><div><p className="text-xs text-ink-soft">משמרת נבחרת</p><p className="font-bold text-ink">{shiftModelLabel(models, shiftType)} · <Ltr>{formatShiftDate(date)}</Ltr></p></div></div>
        </div>
        {rounds.length > 1 ? (
          <label className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-ink">סבב
            <select className="ui-input" value={currentRoundIndex} onChange={(event) => setRoundIndex(Number(event.target.value))}>
              {rounds.map((round, index) => <option key={`${round.startMinutes}-${index}`} value={index}>{round.label || `סבב ${index + 1}`}</option>)}
            </select>
          </label>
        ) : null}
        {shift ? (
          <div className="relative isolate overflow-hidden rounded-2xl border border-line/70 bg-gradient-to-br from-brand/5 via-surface to-ok-soft/40 p-4 sm:p-7">
            <div className="pointer-events-none absolute inset-0 opacity-40" aria-hidden style={{ backgroundImage: 'linear-gradient(to right, var(--color-line, #94a3b8) 1px, transparent 1px), linear-gradient(to bottom, var(--color-line, #94a3b8) 1px, transparent 1px)', backgroundSize: '36px 36px', maskImage: 'linear-gradient(to bottom, black, transparent)' }} />
            <div className="relative mx-auto grid max-w-5xl grid-cols-1 gap-x-5 gap-y-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {stations.map((station) => (
                <StationCard key={station.lane.id} station={station} active={station.lane.id === selectedLaneId} onClick={() => setSelectedLaneId((current) => current === station.lane.id ? null : station.lane.id)} workerNames={workerNames} />
              ))}
            </div>
            {stations.length === 0 ? <EmptyState title="לא הוגדרו עמדות במשמרת הזו" text="בחר תאריך או משמרת אחרים, או הוסף עמדות לשיבוץ." /> : null}
            <div className="relative mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-line/70 pt-3 text-xs text-ink-soft">
              <span className="inline-flex items-center gap-1.5"><Box className="size-3.5" aria-hidden />העמדות מוצגות בפריסה תלת־ממדית סכמטית</span>
              {shift.signOff?.signedAt ? <span>משמרת נסגרה · {shift.signOff.signerName}</span> : null}
              {shift.shiftEvents?.length ? <span>{shift.shiftEvents.length} עדכונים במהלך המשמרת</span> : null}
            </div>
          </div>
        ) : (
          <EmptyState title="אין שיבוץ שמור למועד שנבחר" text="בחר תאריך ומשמרת שיש להם שיבוץ כדי להציג את מפת העמדות." />
        )}
      </SectionCard>

      {selectedStation ? (
        <SectionCard title={selectedStation.lane.name} subtitle="פרטי העמדה והכיסוי בסבב הנבחר" actions={<span className={`rounded-full px-2.5 py-1 text-xs font-bold ${selectedStation.missing ? 'bg-hard-soft text-hard' : 'bg-ok-soft text-ok'}`}>{selectedStation.missing ? `חסר ${selectedStation.missing}` : 'מאויש'}</span>}>
          {selectedStation.workerIds.length ? <div className="flex flex-wrap gap-2">{selectedStation.workerIds.map((id) => <PersonChip key={id} name={workerNames.get(id) || 'עובד לא מזוהה'} />)}</div> : <p className="text-sm text-ink-soft">לא שובץ עובד לעמדה.</p>}
          {selectedStation.assignment?.notes ? <p className="mt-3 rounded-lg bg-surface p-3 text-sm text-ink">{selectedStation.assignment.notes}</p> : null}
          <p className="mt-3 text-xs text-ink-soft">תקן: {selectedStation.required} · {rounds.length > 1 ? rounds[currentRoundIndex]?.label : formatShiftModelWindow(models.find((model) => model.id === shiftType) || models[0]!)}</p>
        </SectionCard>
      ) : null}

      {shift && unassignedWorkerIds.length ? (
        <SectionCard title={`לא משובצים בסבב הזה (${unassignedWorkerIds.length})`} subtitle="עובדים שנכללים במצבת המשמרת אך אינם מופיעים בעמדות בסבב הנבחר.">
          <div className="flex flex-wrap gap-2">{unassignedWorkerIds.map((id) => <PersonChip key={id} name={workerNames.get(id) || 'עובד לא מזוהה'} />)}</div>
        </SectionCard>
      ) : null}
    </div>
  )
}
