import { Shield, Trash2 } from 'lucide-react'
import { IntensityBadge, Ltr } from './ui'
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
  editable?: boolean
  onChange?: (
    roundIndex: number,
    laneId: string,
    slotIndex: number,
    workerId: string | null,
  ) => void
  onRemoveLane?: (laneId: string) => void
}) {
  const byId = new Map(workers.map((w) => [w.id, w]))
  const nameOf = (id: string) => byId.get(id)?.fullName ?? id

  if (lanes.length === 0 || rounds.length === 0) {
    return (
      <p className="text-[13px] text-ink-soft">
        אין סבבים להצגה. בחרו נתיבים וסלקטורים נוכחים, ואז הריצו שיבוץ.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {ramashName !== undefined ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-semibold text-ink">
          <Shield className="size-4 text-brand" aria-hidden />
          <span>מנהל משמרת</span>
          <span>{ramashName.trim() || 'לא סומן'}</span>
        </p>
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
                            className="inline-flex size-6 items-center justify-center rounded-full text-ink-soft transition hover:bg-hard-soft hover:text-hard"
                            title="הסר את הנתיב מהמשמרת"
                            aria-label={`הסר את הנתיב ${lane.name}`}
                          >
                            <Trash2 className="size-3.5" aria-hidden />
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
              <tr key={round.label} className="bg-card">
                <th className="sticky right-0 z-10 whitespace-nowrap bg-card px-3 py-2 text-start font-semibold text-ink">
                  <Ltr>{round.label}</Ltr>
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
                        <span className="text-[12px] font-medium text-ink-soft">
                          סגור
                        </span>
                      </td>
                    )
                  }
                  const assignment = round.assignments.find(
                    (a) => a.laneId === lane.id,
                  )
                  const standard = effectiveStaffingStandard(lane, overrides)
                  const filled = [...(assignment?.workerIds ?? [])]
                  while (filled.length < standard) filled.push('')
                  const slots = filled.slice(0, Math.max(standard, filled.filter(Boolean).length))
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
                              onChange={(e) =>
                                onChange?.(
                                  roundIndex,
                                  lane.id,
                                  slotIndex,
                                  e.target.value || null,
                                )
                              }
                            >
                              <option value="">—</option>
                              {workers.map((w) => (
                                <option key={w.id} value={w.id}>
                                  {w.fullName}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span
                              key={`${lane.id}-${slotIndex}`}
                              className="font-medium text-ink"
                            >
                              {workerId ? nameOf(workerId) : '—'}
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
