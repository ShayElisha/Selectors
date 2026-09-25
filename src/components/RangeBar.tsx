import { Calendar } from 'lucide-react'
import { Ltr } from './ui'
import { formatShiftDate, pluralizeHe } from '../lib/hebrew'

export type RangePresetId = '7' | '14' | '30' | 'all' | 'custom'

const LABELS: Record<RangePresetId, string> = {
  '7': '7 ימים',
  '14': '14 ימים',
  '30': '30 ימים',
  all: 'הכל',
  custom: 'טווח מותאם',
}

export function RangeBar({
  value,
  onChange,
  presets,
  customFrom,
  customTo,
  onCustomFromChange,
  onCustomToChange,
  shiftsInRange,
  fromDate,
  toDate,
}: {
  value: RangePresetId
  onChange: (id: RangePresetId) => void
  presets: readonly RangePresetId[]
  customFrom: string
  customTo: string
  onCustomFromChange: (v: string) => void
  onCustomToChange: (v: string) => void
  shiftsInRange?: number
  fromDate?: string
  toDate?: string
}) {
  return (
    <div className="flex flex-col gap-2">
      <div
        className="flex flex-wrap items-center gap-1 rounded-xl border border-line bg-surface p-1 text-xs sm:text-[13px]"
        role="group"
        aria-label="בחירת טווח תאריכים"
      >
        {presets.map((id) => {
          const selected = value === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => onChange(id)}
              aria-pressed={selected}
              className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                selected
                  ? 'bg-brand text-white shadow-sm'
                  : 'text-ink-soft hover:text-ink'
              }`}
            >
              {id === 'custom' ? (
                <Calendar className="size-3.5 shrink-0" aria-hidden />
              ) : null}
              {LABELS[id]}
            </button>
          )
        })}
      </div>

      {value === 'custom' ? (
        <div className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface/60 px-3 py-2.5">
          <label className="text-[13px]">
            <span className="mb-1 block text-ink-soft">מתאריך</span>
            <input
              type="date"
              className="rounded-lg border border-line bg-card px-2.5 py-1.5"
              value={customFrom}
              max={customTo || undefined}
              onChange={(e) => onCustomFromChange(e.target.value)}
            />
          </label>
          <label className="text-[13px]">
            <span className="mb-1 block text-ink-soft">עד תאריך</span>
            <input
              type="date"
              className="rounded-lg border border-line bg-card px-2.5 py-1.5"
              value={customTo}
              min={customFrom || undefined}
              onChange={(e) => onCustomToChange(e.target.value)}
            />
          </label>
          {customFrom && customTo ? (
            <p className="pb-1.5 text-[13px] text-ink-soft">
              <Ltr>
                {formatShiftDate(customFrom)} – {formatShiftDate(customTo)}
              </Ltr>
            </p>
          ) : null}
        </div>
      ) : null}

      {typeof shiftsInRange === 'number' ? (
        <p className="text-[13px] text-ink-soft">
          {pluralizeHe(shiftsInRange, {
            one: 'שיבוץ אחד בטווח',
            two: 'שני שיבוצים בטווח',
            many: 'שיבוצים בטווח',
          })}
          {fromDate || toDate ? (
            <>
              {' · '}
              <Ltr>
                {fromDate ? formatShiftDate(fromDate) : '…'}
                {' → '}
                {toDate ? formatShiftDate(toDate) : '…'}
              </Ltr>
            </>
          ) : (
            ' · כל ההיסטוריה'
          )}
        </p>
      ) : null}
    </div>
  )
}
