import { Shield, Trash2 } from 'lucide-react'
import { IntensityBadge, Ltr } from './ui'
import { WorkerCombobox } from './WorkerCombobox'
import { effectiveStaffingStandard } from '../lib/shiftStaffing'
import { laneOpenDuring } from '../lib/shiftCatalog'
import type { Lane, SelectorRound, Worker } from '../types'
import type { StaffingOverrides } from '../lib/shiftStaffing'

export function SelectorRoundTable({
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
}: {
  rounds: SelectorRound[]
  lanes: Lane[]
  workers: Worker[]
  overrides?: StaffingOverrides | null
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
}) {
  const options = workers.map((worker) => ({ worker }))

  if (lanes.length === 0 || rounds.length === 0) {
    return (
      <p className="text-[13px] text-ink-soft">
        אין סבבים להצגה. בחרו נתיבים וסלקטורים נוכחים, ואז הריצו שיבוץ.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      {ramashName !== undefined ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-2 rounded-2xl border border-line/70 bg-card px-4 py-3 text-[13px] font-semibold text-ink shadow-sm">
          <Shield className="size-4 text-brand" aria-hidden />
          <span>מנהל משמרת</span>
          {editable && onManagerChange ? (
            <select
              className="ui-field min-w-40 py-1.5 text-sm font-semibold"
              aria-label="בחירת מנהל משמרת"
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
      ) : null}
      {rounds.map((round, roundIndex) => (
        <section key={`${round.cohort ?? ''}-${round.label}`} className="space-y-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-brand px-2.5 py-1 text-[12px] font-bold text-white">
              <Ltr>{round.label}</Ltr>
            </span>
            {round.cohort ? (
              <span className="rounded-full bg-surface px-2.5 py-1 text-[12px] font-medium text-ink-soft ring-1 ring-line/80">
                {round.cohort === 'half' ? 'חצי שעה' : 'שעה עגולה'}
              </span>
            ) : null}
          </div>
          <div className="grid touch-pan-y grid-cols-1 gap-4 min-[900px]:grid-cols-2">
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
              return (
                <div
                  key={lane.id}
                  style={{ animationDelay: `${laneIndex * 20}ms` }}
                  className={`board-lane-card board-lane-card--${lane.intensity} relative rounded-2xl border border-line bg-card p-4 shadow-sm`}
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <h4 className="min-w-0 font-display text-base font-semibold tracking-tight text-ink sm:text-[17px]">
                          {lane.name}
                        </h4>
                        <IntensityBadge intensity={lane.intensity} />
                        {open && filled >= standard ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ok">
                            <span className="size-1.5 rounded-full bg-ok" aria-hidden />
                            מאויש
                          </span>
                        ) : open ? (
                          <span className="inline-flex min-h-6 items-center gap-1 rounded-full bg-warn-soft px-2 py-0.5 text-xs font-semibold text-warn ring-1 ring-warn/20">
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
                        className="lane-card-action inline-flex size-9 shrink-0 items-center justify-center rounded-[10px] text-ink-soft transition hover:bg-hard-soft hover:text-hard"
                        title="הסר נתיב מהמשמרת"
                        aria-label={`הסר נתיב ${lane.name} מהמשמרת`}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </button>
                    ) : null}
                  </div>
                  <div className="mt-3 space-y-2">
                    {open ? (
                      slots.map((workerId, slotIndex) => (
                        <div key={`${lane.id}-${slotIndex}`} className="flex min-w-0 items-center gap-2">
                          {standard > 1 ? (
                            <span className="w-4 shrink-0 text-[11px] text-ink-soft tabular-nums">
                              {slotIndex + 1}.
                            </span>
                          ) : null}
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
