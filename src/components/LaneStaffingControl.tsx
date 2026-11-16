import {
  staffingChoicesForLane,
  type StaffingStandard,
} from '../lib/shiftStaffing'
import type { Lane } from '../types'

type LaneStaffingControlProps = {
  lane: Pick<Lane, 'id' | 'name' | 'staffingStandard'>
  value: StaffingStandard
  onChange: (standard: StaffingStandard) => void
  disabled?: boolean
  className?: string
}

/** Quiet תקן select for board lane headers. */
export function LaneStaffingControl({
  lane,
  value,
  onChange,
  disabled = false,
  className = '',
}: LaneStaffingControlProps) {
  const choices = staffingChoicesForLane(lane)
  if (choices.length <= 1) {
    return (
      <span
        className={`text-[11px] font-medium tabular-nums text-ink-soft ${className}`}
      >
        תקן {value}
      </span>
    )
  }
  return (
    <label
      className={`inline-flex items-center gap-1 text-[11px] font-medium text-ink-soft ${className}`}
    >
      <span className="shrink-0">תקן</span>
      <select
        aria-label={`תקן עבור ${lane.name}`}
        disabled={disabled}
        value={value}
        onChange={(e) =>
          onChange(Number(e.target.value) as StaffingStandard)
        }
        className="ui-field min-h-7 w-auto min-w-[3.25rem] py-0.5 text-[11px] font-semibold tabular-nums"
      >
        {choices.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </label>
  )
}
