import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowRight, Mail, Phone } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { CertChips, IntensityBadge, Ltr, SectionCard } from '../components/ui'
import { SHIFT_TYPE_LABELS } from '../constants'
import { isQualified } from '../algorithm'
import { formatShiftDate } from '../lib/hebrew'
import { isGateManagerLane } from '../lib/gateManager'
import {
  formatIsraeliMobile,
  orderedCertifications,
  personInitials,
  statusLabel,
  workerShiftHistoryCount,
} from '../lib/workersHelpers'
import type { ShiftSchedule, ShiftType } from '../types'

const SHIFT_ORDER: Record<ShiftType, number> = {
  morning: 0,
  afternoon: 1,
  afternoonA: 1,
  afternoonB: 2,
  night: 3,
}

function laneIdsFor(shift: ShiftSchedule, workerId: string): string[] {
  const ids = new Set<string>()
  for (const row of shift.assignments) {
    if (row.workerIds.includes(workerId)) ids.add(row.laneId)
  }
  for (const round of shift.rounds ?? []) {
    for (const row of round.assignments) {
      if (row.workerIds.includes(workerId)) ids.add(row.laneId)
    }
  }
  return [...ids]
}

export function WorkerProfilePage() {
  const { workerId = '' } = useParams()
  const id = decodeURIComponent(workerId)
  const { data, module, loading } = useApp()
  const worker = data.workers.find((w) => w.id === id)
  const noun = module === 'inspectors' ? 'בודק' : 'סלקטור'

  const history = useMemo(() => {
    if (!worker) return []
    return data.history
      .filter((shift) => {
        if (shift.presentWorkerIds.includes(worker.id)) return true
        if (shift.gateManagerWorkerId === worker.id) return true
        return laneIdsFor(shift, worker.id).length > 0
      })
      .sort((a, b) => {
        if (a.date !== b.date) return b.date.localeCompare(a.date)
        return SHIFT_ORDER[b.shiftType] - SHIFT_ORDER[a.shiftType]
      })
  }, [data.history, worker])

  const laneName = useMemo(() => {
    const map = new Map(data.lanes.map((lane) => [lane.id, lane.name]))
    return (laneId: string) => map.get(laneId) ?? 'נתיב שנמחק'
  }, [data.lanes])

  if (loading && data.workers.length === 0) {
    return <p className="text-sm text-ink-soft">טוען…</p>
  }

  if (!worker) {
    return (
      <SectionCard title={`פרופיל ${noun}`} subtitle="האדם לא נמצא במאגר הזה.">
        <Link to="/workers" className="ui-btn ui-btn-primary">
          חזרה למאגר
        </Link>
      </SectionCard>
    )
  }

  const catalogLanes = data.lanes.filter((lane) => !isGateManagerLane(lane))
  const qualified = catalogLanes.filter((lane) => isQualified(worker, lane))
  const certs = orderedCertifications(data.certificationsCatalog, worker.certifications)
  const phone = formatIsraeliMobile(worker.phone)
  const shifts = workerShiftHistoryCount(data.history, worker.id)
  const gateShifts = data.history.filter((shift) => shift.gateManagerWorkerId === worker.id)
    .length

  return (
    <div className="space-y-4">
      <Link
        to="/workers"
        className="inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-brand hover:text-brand-deep"
      >
        <ArrowRight className="size-4" aria-hidden />
        חזרה למאגר
      </Link>

      <SectionCard
        title={worker.fullName}
        subtitle={`פרופיל ${noun}`}
        actions={
          <span
            className="flex size-12 items-center justify-center rounded-full bg-brand text-sm font-bold text-white"
            aria-hidden
          >
            {personInitials(worker.fullName)}
          </span>
        }
      >
        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-ink-soft">סטטוס</dt>
            <dd className="font-semibold text-ink">{statusLabel(worker.status)}</dd>
          </div>
          <div>
            <dt className="text-ink-soft">תפקיד</dt>
            <dd className="font-semibold text-ink">
              {[
                worker.isInspector ? noun : null,
                worker.isOrgManager ? 'מנהל ארגון' : worker.isManager ? 'מנהל משמרת' : null,
              ]
                .filter(Boolean)
                .join(' · ') || 'ללא תפקיד פעיל'}
            </dd>
          </div>
          <div>
            <dt className="text-ink-soft">טלפון</dt>
            <dd>
              <a
                href={`tel:${phone.replace(/\D/g, '')}`}
                className="inline-flex items-center gap-1.5 font-semibold text-brand"
              >
                <Phone className="size-3.5" aria-hidden />
                <Ltr>{phone}</Ltr>
              </a>
            </dd>
          </div>
          <div>
            <dt className="text-ink-soft">מייל</dt>
            <dd>
              {worker.email ? (
                <a
                  href={`mailto:${worker.email}`}
                  className="inline-flex max-w-full items-center gap-1.5 font-semibold text-brand"
                >
                  <Mail className="size-3.5 shrink-0" aria-hidden />
                  <span className="truncate" dir="ltr">
                    {worker.email}
                  </span>
                </a>
              ) : (
                <span className="text-ink-soft">—</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-ink-soft">משמרות במאגר</dt>
            <dd className="font-semibold text-ink">{shifts}</dd>
          </div>
          <div>
            <dt className="text-ink-soft">פעמים כמנהל שער</dt>
            <dd className="font-semibold text-ink">{gateShifts}</dd>
          </div>
        </dl>
      </SectionCard>

      <SectionCard title="הסמכות" subtitle={`${certs.length} הסמכות רשומות`}>
        <CertChips items={certs} />
      </SectionCard>

      <SectionCard
        title="נתיבים כשירים"
        subtitle={`${qualified.length} מתוך ${catalogLanes.length} נתיבים`}
      >
        {qualified.length === 0 ? (
          <p className="text-sm text-ink-soft">אין נתיב שההסמכות הנוכחיות פותחות.</p>
        ) : (
          <ul className="divide-y divide-line/70">
            {qualified.map((lane) => (
              <li
                key={lane.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
              >
                <span className="font-semibold text-ink">{lane.name}</span>
                <span className="flex items-center gap-2 text-ink-soft">
                  <IntensityBadge intensity={lane.intensity} />
                  <span>תקן {lane.staffingStandard}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="משמרות אחרונות" subtitle="מהחדש לישן">
        {history.length === 0 ? (
          <p className="text-sm text-ink-soft">עדיין אין משמרות שמורות עבור האדם הזה.</p>
        ) : (
          <ul className="divide-y divide-line/70">
            {history.slice(0, 12).map((shift) => {
              const names = laneIdsFor(shift, worker.id).map(laneName)
              const gate = shift.gateManagerWorkerId === worker.id
              return (
                <li key={shift.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5 text-sm">
                  <div>
                    <Link
                      to={`/history/${encodeURIComponent(shift.id)}`}
                      className="font-semibold text-ink hover:text-brand hover:underline"
                    >
                      {formatShiftDate(shift.date)} · {SHIFT_TYPE_LABELS[shift.shiftType]}
                    </Link>
                    <p className="mt-0.5 text-ink-soft">
                      {gate ? 'מנהל שער' : names.length > 0 ? names.join(', ') : 'נוכח, בלי שיבוץ לנתיב'}
                    </p>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </SectionCard>
    </div>
  )
}
