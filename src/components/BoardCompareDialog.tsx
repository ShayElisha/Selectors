import { useEffect, useId, type ReactNode } from 'react'
import { Scale, Star } from 'lucide-react'
import type { AssignmentResult } from '../algorithm'
import type { Lane, LaneAssignment, Worker } from '../types'

function boardKey(assignments: LaneAssignment[]): string {
  return [...assignments]
    .map(
      (row) =>
        `${row.laneId}:${row.workerIds.filter(Boolean).slice().sort().join(',')}`,
    )
    .sort()
    .join('|')
}

function formatPoints(value: number): string {
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

function laneLabel(lanes: Lane[], laneId: string): string {
  return lanes.find((lane) => lane.id === laneId)?.name ?? laneId
}

function namesFor(
  workers: Worker[],
  ids: string[],
): string {
  const names = ids
    .filter(Boolean)
    .map((id) => workers.find((worker) => worker.id === id)?.fullName ?? id)
  return names.length > 0 ? names.join(' · ') : 'פנוי'
}

function OptionCard({
  title,
  detail,
  icon,
  result,
  other,
  lanes,
  workers,
  onChoose,
}: {
  title: string
  detail: string
  icon: ReactNode
  result: AssignmentResult
  other: AssignmentResult
  lanes: Lane[]
  workers: Worker[]
  onChoose: () => void
}) {
  const otherByLane = new Map(other.assignments.map((row) => [row.laneId, row]))
  const rows = result.assignments.filter((row) =>
    lanes.some((lane) => lane.id === row.laneId),
  )
  return (
    <section className="flex min-w-0 flex-1 flex-col rounded-2xl border border-line bg-surface/70 p-3 sm:p-4">
      <div className="flex items-start gap-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
          {icon}
        </span>
        <div>
          <h4 className="font-display text-base font-bold text-ink">{title}</h4>
          <p className="mt-0.5 text-[13px] leading-relaxed text-ink-soft">{detail}</p>
        </div>
      </div>
      <ul className="mt-3 space-y-1.5">
        {rows.map((row) => {
          const otherIds = (otherByLane.get(row.laneId)?.workerIds ?? [])
            .filter(Boolean)
            .slice()
            .sort()
            .join(',')
          const hereIds = row.workerIds.filter(Boolean).slice().sort().join(',')
          const differs = hereIds !== otherIds
          return (
            <li
              key={row.laneId}
              className={`rounded-xl px-2.5 py-2 text-[13px] ${
                differs ? 'bg-accent-soft/70 ring-1 ring-accent/25' : 'bg-card'
              }`}
            >
              <p className="font-semibold text-ink">{laneLabel(lanes, row.laneId)}</p>
              <p className="mt-0.5 text-ink-soft">{namesFor(workers, row.workerIds)}</p>
            </li>
          )
        })}
      </ul>
      <button
        type="button"
        onClick={onChoose}
        className="ui-btn ui-btn-primary mt-3 w-full"
      >
        בחירת החלופה הזו
      </button>
    </section>
  )
}

export function BoardCompareDialog({
  loadFair,
  hardExperience,
  lanes,
  workers,
  onClose,
  onChoose,
}: {
  loadFair: AssignmentResult
  hardExperience: AssignmentResult
  lanes: Lane[]
  workers: Worker[]
  onClose: () => void
  onChoose: (result: AssignmentResult, label: string) => void
}) {
  const titleId = useId()
  const same = boardKey(loadFair.assignments) === boardKey(hardExperience.assignments)
  const fairDetail =
    (loadFair.loadSpread ?? 0) <= 0
      ? 'העומס בין המשובצים כמעט זהה.'
      : `פער העומס בין המשובצים: ${formatPoints(loadFair.loadSpread ?? 0)} נקודות.`
  const hardSeats = hardExperience.hardSeats ?? 0
  const experienceDetail =
    hardSeats === 0
      ? 'אין נתיבים קשים במשמרת הזו.'
      : `בנתיבים הקשים יושבים אנשים עם יותר ניסיון בקשה: ${hardExperience.experiencedHardSeats ?? 0} מתוך ${hardSeats}.`

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[200] flex items-end justify-center bg-ink/40 p-3 sm:items-center sm:p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-line bg-card p-4 shadow-xl sm:p-5"
      >
        <h3 id={titleId} className="font-display text-lg font-bold text-ink">
          השוואת חלופות שיבוץ
        </h3>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
          שתי הצעות לאותם נוכחים ונתיבים. הבחירה מחליפה את הלוח. השמירה נשארת בנפרד.
          שורות מסומנות הן מקומות שבהם החלופות לא מסכימות.
        </p>
        {same ? (
          <p className="mt-3 rounded-xl bg-surface px-3 py-2 text-[13px] font-medium text-ink">
            שתי החלופות יצאו זהות. אפשר לבחור אחת ולהמשיך לשמירה.
          </p>
        ) : null}
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <OptionCard
            title="הוגנות בעומס"
            detail={fairDetail}
            icon={<Scale className="size-4" aria-hidden />}
            result={loadFair}
            other={hardExperience}
            lanes={lanes}
            workers={workers}
            onChoose={() => onChoose(loadFair, 'הוגנות בעומס')}
          />
          <OptionCard
            title="ניסיון בנתיבים קשים"
            detail={experienceDetail}
            icon={<Star className="size-4" aria-hidden />}
            result={hardExperience}
            other={loadFair}
            lanes={lanes}
            workers={workers}
            onChoose={() => onChoose(hardExperience, 'ניסיון בנתיבים קשים')}
          />
        </div>
        <div className="mt-4 flex justify-end">
          <button type="button" onClick={onClose} className="ui-btn ui-btn-secondary min-h-10">
            ביטול
          </button>
        </div>
      </div>
    </div>
  )
}
