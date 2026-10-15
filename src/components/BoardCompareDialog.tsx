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
  const componentLabels: Record<string, string> = {
    rotation: 'מרווח חזרה לעמדות', workload: 'איזון עומס', recovery: 'מנוחה אחרי לילה',
    hardBalance: 'איזון ניסיון בעמדות קשות', handoff: 'התאמת החלפת צהריים',
    versatility: 'שמירת עובדים רב־תכליתיים', intensityDist: 'פיזור רמות קושי',
    idleOnHard: 'התאמת מנוחה לעמדות קשות', staffing: 'כיסוי תקנים', stability: 'יציבות השיבוץ',
  }
  const weakestFactors = result.quality
    ? Object.entries(result.quality.components)
        .filter(([, value]) => value < 99.9)
        .sort((a, b) => a[1] - b[1])
        .slice(0, 3)
    : []
  const filledSeats = rows.reduce((sum, row) => sum + row.workerIds.filter(Boolean).length, 0)
  const requiredSeats = lanes.reduce((sum, lane) => sum + lane.staffingStandard, 0)
  const recommendations = [
    (result.quality?.understaffedSlots ?? 0) > 0
      ? `נותרו ${result.quality?.understaffedSlots} תקנים לא מאוישים; בדקו זמינות והסמכות או צמצמו נתיבים.`
      : '',
    (result.loadSpread ?? 0) > 4
      ? 'פער העומס עדיין גדול; בדקו אם חלופת הוגנות בעומס מתאימה יותר.'
      : '',
    (result.experiencedHardSeats ?? 0) < (result.hardSeats ?? 0)
      ? 'אפשר לשפר את הניסיון בעמדות הקשות אם יש עובדים כשירים נוספים.'
      : '',
  ].filter(Boolean)
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
      {result.quality ? (
        <div className="mt-3 rounded-xl border border-line bg-card p-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[13px] font-semibold text-ink">ציון איכות האלגוריתם</span>
            <span className="text-lg font-bold tabular-nums text-brand">{Math.round(result.quality.score)}/100</span>
          </div>
          <p className="mt-1 text-xs text-ink-soft">
            הציון מחושב כסכום המדדים כפול המשקלים שהאלגוריתם השתמש בהם, עם קנס על תקנים חסרים. אילוצי הסמכה ושיבוץ כפול הם תנאי חובה, לא נקודות בציון.
          </p>
          <p className="mt-1 text-xs text-ink-soft">כיסוי: {filledSeats}/{requiredSeats} תקנים · פער עומס: {formatPoints(result.loadSpread ?? 0)}</p>
          {weakestFactors.length ? (
            <p className="mt-1 text-xs text-ink-soft">
              הגורמים שהורידו את הציון: {weakestFactors.map(([key, value]) => `${componentLabels[key] ?? key} ${Math.round(value)} (משקל ${Math.round((result.quality?.weights[key as keyof typeof result.quality.weights] ?? 0) * 100)}%)`).join(' · ')}
            </p>
          ) : <p className="mt-1 text-xs text-easy">לא נמצאה ירידה משמעותית במדדי ההעדפה.</p>}
          {recommendations.length ? <ul className="mt-2 list-inside list-disc space-y-0.5 text-xs text-ink-soft">{recommendations.map((item) => <li key={item}>{item}</li>)}</ul> : null}
        </div>
      ) : null}
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
