import { useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { notify } from '../lib/notify'
import {
  EmptyState,
  FieldError,
  FieldLabel,
  Ltr,
  SectionCard,
} from '../components/ui'
import { parseClock } from '../lib/shiftModels'
import {
  resolveWorkerWindows,
  workerWindowIdFromTimes,
  workerWindowLabelFromTimes,
  type WorkerWindowPreset,
} from '../lib/shiftCatalog'

function clockValue(minutes: number): string {
  const day = 24 * 60
  const m = ((minutes % day) + day) % day
  const h = Math.floor(m / 60)
  const min = m % 60
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

export function WorkerWindowsPage() {
  const { data, module, saveWorkerWindowPresets } = useApp()
  const presets = useMemo(
    () => resolveWorkerWindows(data.workerWindowPresets),
    [data.workerWindowPresets],
  )
  const [start, setStart] = useState('06:00')
  const [end, setEnd] = useState('15:00')
  const [error, setError] = useState<string | null>(null)

  const persist = (next: WorkerWindowPreset[]) => {
    saveWorkerWindowPresets(
      next.map((preset, order) => ({
        ...preset,
        label: workerWindowLabelFromTimes(preset.start, preset.end),
        order,
      })),
    )
  }

  const add = () => {
    const startMinutes = parseClock(start)
    const endMinutes = parseClock(end)
    if (startMinutes == null || endMinutes == null) {
      setError('שעות לא תקינות')
      return
    }
    if (startMinutes === endMinutes) {
      setError('שעת ההתחלה והסיום לא יכולות להיות זהות')
      return
    }
    const id = workerWindowIdFromTimes(startMinutes, endMinutes)
    if (presets.some((preset) => preset.id === id)) {
      setError('כבר יש חלון שעות כזה')
      return
    }
    persist([
      ...presets,
      {
        id,
        label: workerWindowLabelFromTimes(startMinutes, endMinutes),
        start: startMinutes,
        end: endMinutes,
        order: presets.length,
      },
    ])
    setError(null)
    notify.success('חלון השעות נוסף')
  }

  const update = (id: string, patch: Partial<Pick<WorkerWindowPreset, 'start' | 'end'>>) => {
    persist(
      presets.map((preset) => {
        if (preset.id !== id) return preset
        const startMinutes = patch.start ?? preset.start
        const endMinutes = patch.end ?? preset.end
        return {
          ...preset,
          start: startMinutes,
          end: endMinutes,
          label: workerWindowLabelFromTimes(startMinutes, endMinutes),
        }
      }),
    )
  }

  const remove = (preset: WorkerWindowPreset) => {
    if (presets.length === 1) {
      notify.error('חייבת להישאר לפחות אפשרות שעות אחת')
      return
    }
    if (!confirm(`למחוק את ${preset.label}?`)) return
    persist(presets.filter((item) => item.id !== preset.id))
    notify.success('חלון השעות נמחק')
  }

  const title =
    module === 'inspectors'
      ? 'שעות אישיות לבודקים'
      : module === 'security'
        ? 'שעות אישיות למאבטחים'
        : 'שעות אישיות לסלקטורים'

  return (
    <div className="space-y-4">
      <SectionCard
        title={title}
        subtitle="הרשימה כאן מופיעה בנוכחות תחת «בחר משמרת» — לכל מודול בנפרד"
      >
        {presets.length === 0 ? (
          <EmptyState title="אין שעות" text="הוסיפו חלון שעות כדי לבחור בנוכחות." />
        ) : (
          <ul className="space-y-3">
            {presets.map((preset) => (
              <li
                key={preset.id}
                className="grid gap-3 rounded-xl border border-line/70 bg-card p-3 sm:grid-cols-[auto_auto_1fr_auto] sm:items-end"
              >
                <div>
                  <FieldLabel htmlFor={`win-start-${preset.id}`}>התחלה</FieldLabel>
                  <input
                    id={`win-start-${preset.id}`}
                    className="ui-field"
                    type="time"
                    value={clockValue(preset.start)}
                    onChange={(e) => {
                      const minutes = parseClock(e.target.value)
                      if (minutes != null) update(preset.id, { start: minutes })
                    }}
                  />
                </div>
                <div>
                  <FieldLabel htmlFor={`win-end-${preset.id}`}>סיום</FieldLabel>
                  <input
                    id={`win-end-${preset.id}`}
                    className="ui-field"
                    type="time"
                    value={clockValue(preset.end)}
                    onChange={(e) => {
                      const minutes = parseClock(e.target.value)
                      if (minutes != null) update(preset.id, { end: minutes })
                    }}
                  />
                </div>
                <div className="flex items-center">
                  <span className="text-[13px] font-semibold text-ink">
                    <Ltr>{preset.label}</Ltr>
                  </span>
                </div>
                <button
                  type="button"
                  className="ui-btn ui-btn-ghost justify-self-start sm:justify-self-end"
                  onClick={() => remove(preset)}
                  aria-label={`מחיקת ${preset.label}`}
                >
                  <Trash2 className="size-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        title="חלון שעות חדש"
        subtitle="אפשר שהסיום יהיה אחרי חצות. החלון יופיע מיד בבחירת משמרת בנוכחות"
      >
        <div className="grid gap-3 sm:grid-cols-[auto_auto_auto] sm:items-end">
          <div>
            <FieldLabel htmlFor="new-win-start">התחלה</FieldLabel>
            <input
              id="new-win-start"
              className="ui-field"
              type="time"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </div>
          <div>
            <FieldLabel htmlFor="new-win-end">סיום</FieldLabel>
            <input
              id="new-win-end"
              className="ui-field"
              type="time"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </div>
          <button type="button" className="ui-btn ui-btn-primary gap-2" onClick={add}>
            <Plus className="size-4" aria-hidden />
            הוספה
          </button>
        </div>
        <FieldError message={error} />
      </SectionCard>
    </div>
  )
}
