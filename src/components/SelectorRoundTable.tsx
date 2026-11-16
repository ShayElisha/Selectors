import { CheckCircle2, CircleDashed, Shield, Trash2 } from 'lucide-react'
import { INTENSITY_LABELS } from '../constants'
import { IntensityBadge, Ltr, TimingBadges } from './ui'
import { WorkerCombobox } from './WorkerCombobox'
import { effectiveStaffingStandard } from '../lib/shiftStaffing'
import { laneOpenDuring } from '../lib/shiftCatalog'
import {
  timingBadgesForWorker,
} from '../lib/shiftTimingBadges'
import type { Lane, SelectorRound, WindowAdjustment, Worker } from '../types'
import type { StaffingOverrides } from '../lib/shiftStaffing'

export function SelectorRoundTable({
  rounds,
  lanes,
  workers,
  overrides,
  windowAdjustments,
  earlyLeaveAt,
  ramashName,
  managerOptions,
  managerId,
  onManagerChange,
  editable = false,
  onChange,
  onRemoveLane,
  layout = 'cards',
  compact = false,
  managerRequired = false,
  stickyOffsetClass = 'top-14',
}: {
  rounds: SelectorRound[]
  lanes: Lane[]
  workers: Worker[]
  overrides?: StaffingOverrides | null
  windowAdjustments?: Record<string, WindowAdjustment> | null
  earlyLeaveAt?: Record<string, number> | null
  /** Shift manager shown above the round table. */
  ramashName?: string
  /** Active managers who can be chosen while editing the board. */
  managerOptions?: { id: string; fullName: string }[]
  managerId?: string
  onManagerChange?: (workerId: string | null) => void
  editable?: boolean
  onChange?: (
    roundIndex: number,
    laneId: string,
    slotIndex: number,
    workerId: string | null,
  ) => void
  onRemoveLane?: (laneId: string) => void
  /** Home keeps the previous time-by-lane table. The shift board uses cards. */
  layout?: 'cards' | 'table'
  /** Denser cards — more routes visible without scrolling. */
  compact?: boolean
  /** Block-style validation when manager is required but missing. */
  managerRequired?: boolean
  /** Sticky offset under the page header (Tailwind top-* class). */
  stickyOffsetClass?: string
}) {
  const options = workers.map((worker) => {
    const timing = timingBadgesForWorker({
      workerId: worker.id,
      windowAdjustments,
      earlyLeaveAt,
    })
    return {
      worker,
      description: timing.map((b) => b.shortLabel).join(' · ') || undefined,
    }
  })

  if (lanes.length === 0 || rounds.length === 0) {
    return (
      <p className="text-[13px] text-ink-soft">
        אין סבבים להצגה. בחרו נתיבים וסלקטורים נוכחים, ואז הריצו שיבוץ.
      </p>
    )
  }

  if (layout === 'table') {
    return (
      <SelectorRoundLegacyTable
        rounds={rounds}
        lanes={lanes}
        workers={workers}
        overrides={overrides}
        ramashName={ramashName}
        managerOptions={managerOptions}
        managerId={managerId}
        onManagerChange={onManagerChange}
        editable={editable}
        onChange={onChange}
        onRemoveLane={onRemoveLane}
        managerRequired={managerRequired}
      />
    )
  }

  const managerMissing =
    managerRequired && editable && onManagerChange && !(managerId ?? '').trim()

  return (
    <div className={compact ? 'space-y-3' : 'space-y-4'}>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-soft">
        <span className="font-semibold text-ink">מקרא:</span>
        <span className="inline-flex items-center gap-1">
          <span className="size-2 rounded-full bg-ok" aria-hidden />
          מאויש
        </span>
        <span className="inline-flex items-center gap-1">
          <CircleDashed className="size-3 text-warn" aria-hidden />
          חסר בתקן
        </span>
        <span>פס צד = עומס הנתיב (קל / בינוני / קשה)</span>
      </p>
      {ramashName !== undefined ? (
        <div
          className={`rounded-2xl border bg-card px-4 py-3 text-[13px] font-semibold text-ink shadow-sm ${
            managerMissing
              ? 'border-hard/40 ring-1 ring-hard/20'
              : 'border-line/70'
          }`}
        >
          <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
            <Shield className="size-4 text-brand" aria-hidden />
            <span>
              מנהל משמרת
              {managerRequired ? (
                <span className="text-hard" aria-hidden>
                  {' '}
                  *
                </span>
              ) : null}
            </span>
            {editable && onManagerChange ? (
              <select
                className={`ui-field min-w-40 py-1.5 text-sm font-semibold ${
                  managerMissing ? 'border-hard ring-1 ring-hard/30' : ''
                }`}
                aria-label="בחירת מנהל משמרת (שדה חובה)"
                aria-required={managerRequired || undefined}
                aria-invalid={managerMissing || undefined}
                value={managerId ?? ''}
                onChange={(event) => onManagerChange(event.target.value || null)}
              >
                <option value="">
                  {(managerOptions?.length ?? 0) === 0
                    ? 'אין מנהל שהוא גם בודק'
                    : 'בחרו מנהל משמרת'}
                </option>
                {(managerOptions ?? []).map((manager) => (
                  <option key={manager.id} value={manager.id}>
                    {manager.fullName}
                  </option>
                ))}
              </select>
            ) : (
              <span>{ramashName.trim() || 'לא סומן'}</span>
            )}
          </div>
          {managerMissing ? (
            <p className="mt-1.5 text-xs font-semibold text-hard" role="alert">
              חובה לבחור מנהל משמרת לפני שמירה או סגירה
            </p>
          ) : null}
        </div>
      ) : null}
      {rounds.map((round, roundIndex) => (
        <section key={`${round.cohort ?? ''}-${round.label}`} className="space-y-2.5">
          <div
            className={`sticky z-20 -mx-1 flex flex-wrap items-center gap-1.5 bg-bg/95 px-1 py-1.5 backdrop-blur-sm ${stickyOffsetClass}`}
          >
            <span className="rounded-full bg-brand px-2.5 py-1 text-[12px] font-bold text-white">
              <Ltr>{round.label}</Ltr>
            </span>
            {round.cohort ? (
              <span className="rounded-full bg-surface px-2.5 py-1 text-[12px] font-medium text-ink-soft ring-1 ring-line/80">
                {round.cohort === 'half' ? 'חצי שעה' : 'שעה עגולה'}
              </span>
            ) : null}
          </div>
          <div
            className={`grid touch-pan-y grid-cols-1 ${
              compact
                ? 'gap-2.5 min-[640px]:grid-cols-2 min-[1100px]:grid-cols-3'
                : 'gap-4 min-[900px]:grid-cols-2'
            }`}
          >
            {lanes.map((lane, laneIndex) => {
              const open = laneOpenDuring(
                lane.activeHours,
                round.startMinutes,
                round.endMinutes,
              )
              const standard = effectiveStaffingStandard(lane, overrides)
              const assignment = round.assignments.find((item) => item.laneId === lane.id)
              const filledIds = [...(assignment?.workerIds ?? [])]
              while (open && filledIds.length < standard) filledIds.push('')
              const slots = open
                ? filledIds.slice(0, Math.max(standard, filledIds.filter(Boolean).length))
                : []
              const filled = slots.filter(Boolean).length
              const intensityLabel = INTENSITY_LABELS[lane.intensity]
              const statusLabel = !open
                ? 'סגור'
                : filled >= standard
                  ? 'מאויש'
                  : `${filled} מתוך ${standard}`
              return (
                <div
                  key={lane.id}
                  style={{ animationDelay: `${laneIndex * 20}ms` }}
                  className={`board-lane-card board-lane-card--${lane.intensity} relative rounded-2xl border border-line bg-card shadow-sm ${
                    compact ? 'p-3' : 'p-4'
                  }`}
                  aria-label={`${lane.name}, עומס ${intensityLabel}, ${statusLabel}`}
                  title={`${lane.name} · עומס ${intensityLabel} · ${statusLabel}`}
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <h4
                          className={`min-w-0 font-display font-semibold tracking-tight text-ink ${
                            compact ? 'text-[15px]' : 'text-base sm:text-[17px]'
                          }`}
                        >
                          {lane.name}
                        </h4>
                        <IntensityBadge intensity={lane.intensity} />
                        {open && filled >= standard ? (
                          <span
                            className="inline-flex items-center gap-1 text-xs font-semibold text-ok"
                            title="הנתיב מאויש במלואו"
                            aria-label="מאויש"
                          >
                            <CheckCircle2 className="size-3.5" aria-hidden />
                            מאויש
                          </span>
                        ) : open ? (
                          <span
                            className="inline-flex min-h-6 items-center gap-1 rounded-full bg-warn-soft px-2 py-0.5 text-xs font-semibold text-warn ring-1 ring-warn/20"
                            title={`חסר בתקן: ${filled} מתוך ${standard}`}
                            aria-label={`חסר בתקן ${filled} מתוך ${standard}`}
                          >
                            <CircleDashed className="size-3.5" aria-hidden />
                            <Ltr>
                              {filled}/{standard}
                            </Ltr>
                          </span>
                        ) : (
                          <span className="rounded-full bg-surface px-2 py-0.5 text-xs font-semibold text-ink-soft ring-1 ring-line">
                            סגור
                          </span>
                        )}
                      </div>
                    </div>
                    {editable && onRemoveLane ? (
                      <button
                        type="button"
                        onClick={() => onRemoveLane(lane.id)}
                        className="lane-card-action inline-flex size-11 shrink-0 items-center justify-center rounded-[10px] text-ink-soft transition hover:bg-hard-soft hover:text-hard focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                        title="הסר נתיב מהמשמרת"
                        aria-label={`הסר נתיב ${lane.name} מהמשמרת`}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </button>
                    ) : null}
                  </div>
                  <div className={compact ? 'mt-2 space-y-1.5' : 'mt-3 space-y-2'}>
                    {open ? (
                      slots.map((workerId, slotIndex) => (
                        <div key={`${lane.id}-${slotIndex}`} className="flex min-w-0 items-center gap-2">
                          {standard > 1 ? (
                            <span className="w-4 shrink-0 text-[11px] text-ink-soft tabular-nums">
                              {slotIndex + 1}.
                            </span>
                          ) : null}
                          <div className="min-w-0 flex-1 space-y-1">
                            <WorkerCombobox
                              options={options}
                              value={workerId}
                              placeholder="פנוי"
                              ariaLabel={`${lane.name} ${round.label}${
                                slots.length > 1 ? ` מקום ${slotIndex + 1}` : ''
                              }`}
                              searchNoun="עובד"
                              disabled={!editable}
                              onChange={(nextId) =>
                                onChange?.(roundIndex, lane.id, slotIndex, nextId)
                              }
                            />
                            {workerId ? (
                              <TimingBadges
                                badges={timingBadgesForWorker({
                                  workerId,
                                  windowAdjustments,
                                  earlyLeaveAt,
                                })}
                              />
                            ) : null}
                          </div>
                        </div>
                      ))
                    ) : (
                      <p className="text-[13px] font-medium text-ink-soft">
                        הנתיב סגור בשעות האלה
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

function SelectorRoundLegacyTable({
  rounds,
  lanes,
  workers,
  overrides,
  ramashName,
  managerOptions,
  managerId,
  onManagerChange,
  editable = false,
  onChange,
  onRemoveLane,
  managerRequired = false,
}: {
  rounds: SelectorRound[]
  lanes: Lane[]
  workers: Worker[]
  overrides?: StaffingOverrides | null
  ramashName?: string
  managerOptions?: { id: string; fullName: string }[]
  managerId?: string
  onManagerChange?: (workerId: string | null) => void
  editable?: boolean
  onChange?: (
    roundIndex: number,
    laneId: string,
    slotIndex: number,
    workerId: string | null,
  ) => void
  onRemoveLane?: (laneId: string) => void
  managerRequired?: boolean
}) {
  const byId = new Map(workers.map((worker) => [worker.id, worker]))
  const nameOf = (id: string) => byId.get(id)?.fullName ?? id
  const managerMissing =
    managerRequired && editable && onManagerChange && !(managerId ?? '').trim()

  return (
    <div className="space-y-2">
      {ramashName !== undefined ? (
        <div
          className={`rounded-2xl border bg-card px-4 py-3 text-[13px] font-semibold text-ink shadow-sm ${
            managerMissing ? 'border-hard/40 ring-1 ring-hard/20' : 'border-line/70'
          }`}
        >
          <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
          <Shield className="size-4 text-brand" aria-hidden />
          <span>
            מנהל משמרת
            {managerRequired ? (
              <span className="text-hard" aria-hidden>
                {' '}
                *
              </span>
            ) : null}
          </span>
          {editable && onManagerChange ? (
            <select
              className={`ui-field min-w-40 py-1.5 text-sm font-semibold ${
                managerMissing ? 'border-hard ring-1 ring-hard/30' : ''
              }`}
              aria-label="בחירת מנהל משמרת (שדה חובה)"
              aria-required={managerRequired || undefined}
              aria-invalid={managerMissing || undefined}
              value={managerId ?? ''}
              onChange={(event) => onManagerChange(event.target.value || null)}
            >
              <option value="">
                {(managerOptions?.length ?? 0) === 0
                  ? 'אין מנהל שהוא גם בודק'
                  : 'בחרו מנהל משמרת'}
              </option>
              {(managerOptions ?? []).map((manager) => (
                <option key={manager.id} value={manager.id}>
                  {manager.fullName}
                </option>
              ))}
            </select>
          ) : (
            <span>{ramashName.trim() || 'לא סומן'}</span>
          )}
          </div>
          {managerMissing ? (
            <p className="mt-1.5 text-xs font-semibold text-hard" role="alert">
              חובה לבחור מנהל משמרת לפני שמירה או סגירה
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="max-w-full overflow-hidden rounded-2xl border border-line/70 bg-card shadow-[var(--shadow-panel)]">
        <div className="max-w-full overflow-x-auto overscroll-x-contain">
          <table className="w-max min-w-full border-collapse text-right text-[13px]">
            <thead>
              <tr className="border-b border-line/70 bg-gradient-to-l from-brand/[0.07] via-surface to-surface">
                <th className="sticky right-0 z-10 bg-surface/95 px-3 py-2.5 text-[11px] font-semibold tracking-wide text-ink-soft">
                  שעה
                </th>
                {lanes.map((lane) => {
                  const standard = effectiveStaffingStandard(lane, overrides)
                  return (
                    <th
                      key={lane.id}
                      className="px-3 py-2.5 text-[11px] font-semibold tracking-wide text-ink"
                    >
                      <div className="flex flex-col items-start gap-1">
                        <span className="inline-flex items-center gap-1">
                          {lane.name}
                          {editable && onRemoveLane ? (
                            <button
                              type="button"
                              onClick={() => onRemoveLane(lane.id)}
                              className="inline-flex size-11 items-center justify-center rounded-full text-ink-soft transition hover:bg-hard-soft hover:text-hard"
                              title="הסר נתיב מהמשמרת"
                              aria-label={`הסר נתיב ${lane.name} מהמשמרת`}
                            >
                              <Trash2 className="size-4" aria-hidden />
                            </button>
                          ) : null}
                        </span>
                        <span className="flex flex-wrap items-center gap-1 font-normal">
                          <IntensityBadge intensity={lane.intensity} />
                          <span className="text-ink-soft">תקן {standard}</span>
                        </span>
                      </div>
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody className="divide-y divide-line/60">
              {rounds.map((round, roundIndex) => (
                <tr key={`${round.cohort ?? ''}-${round.label}`} className="bg-card">
                  <th className="sticky right-0 z-10 whitespace-nowrap bg-card px-3 py-2 text-start font-semibold text-ink">
                    <Ltr>{round.label}</Ltr>
                    {round.cohort ? (
                      <span className="mt-0.5 block text-[10px] font-normal text-ink-soft">
                        {round.cohort === 'half' ? 'חצי שעה' : 'שעה עגולה'}
                      </span>
                    ) : null}
                  </th>
                  {lanes.map((lane) => {
                    const open = laneOpenDuring(
                      lane.activeHours,
                      round.startMinutes,
                      round.endMinutes,
                    )
                    if (!open) {
                      return (
                        <td key={lane.id} className="px-2 py-2 align-top">
                          <span className="text-[12px] font-medium text-ink-soft">סגור</span>
                        </td>
                      )
                    }
                    const assignment = round.assignments.find((item) => item.laneId === lane.id)
                    const standard = effectiveStaffingStandard(lane, overrides)
                    const filled = [...(assignment?.workerIds ?? [])]
                    while (filled.length < standard) filled.push('')
                    const slots = filled.slice(
                      0,
                      Math.max(standard, filled.filter(Boolean).length),
                    )
                    return (
                      <td key={lane.id} className="px-2 py-2 align-top">
                        <div className="flex min-w-[9.5rem] flex-col gap-1.5">
                          {slots.map((workerId, slotIndex) =>
                            editable ? (
                              <select
                                key={`${lane.id}-${slotIndex}`}
                                className="ui-field !py-1.5 !text-xs"
                                aria-label={`${lane.name} ${round.label}${
                                  slots.length > 1 ? ` מקום ${slotIndex + 1}` : ''
                                }`}
                                value={workerId}
                                onChange={(event) =>
                                  onChange?.(
                                    roundIndex,
                                    lane.id,
                                    slotIndex,
                                    event.target.value || null,
                                  )
                                }
                              >
                                <option value="">—</option>
                                {workers.map((worker) => (
                                  <option key={worker.id} value={worker.id}>
                                    {worker.fullName}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span
                                key={`${lane.id}-${slotIndex}`}
                                className="inline-flex flex-wrap items-center gap-1 font-medium text-ink"
                              >
                                {workerId ? nameOf(workerId) : '—'}
                                {workerId &&
                                byId.get(workerId)?.trainingRole ===
                                  'trainee' ? (
                                  <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-[10px] font-bold text-accent ring-1 ring-accent/25">
                                    מתלמד
                                  </span>
                                ) : null}
                              </span>
                            ),
                          )}
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
