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
import {
  formatMinutes,
  formatShiftModelWindow,
  parseClock,
  resolveShiftModels,
  type ShiftModel,
} from '../lib/shiftModels'

function clockValue(minutes: number): string {
  return formatMinutes(minutes)
}

export function ShiftModelsPage() {
  const { data, module, saveShiftModels } = useApp()
  const models = useMemo(
    () => resolveShiftModels(data.shiftModels, module),
    [data.shiftModels, module],
  )
  const [name, setName] = useState('')
  const [start, setStart] = useState('06:00')
  const [end, setEnd] = useState('14:00')
  const [error, setError] = useState<string | null>(null)

  const persist = (next: ShiftModel[]) => {
    saveShiftModels(next.map((model, order) => ({ ...model, order })))
  }

  const add = () => {
    const trimmed = name.trim()
    const startMinutes = parseClock(start)
    const endMinutes = parseClock(end)
    if (trimmed.length < 2) {
      setError('נא להזין שם משמרת')
      return
    }
    if (models.some((model) => model.name === trimmed)) {
      setError('כבר יש משמרת בשם הזה')
      return
    }
    if (startMinutes == null || endMinutes == null) {
      setError('שעות לא תקינות')
      return
    }
    if (startMinutes === endMinutes) {
      setError('שעת ההתחלה והסיום לא יכולות להיות זהות')
      return
    }
    persist([
      ...models,
      {
        id: crypto.randomUUID(),
        name: trimmed,
        startMinutes,
        endMinutes,
        order: models.length,
      },
    ])
    setName('')
    setError(null)
    notify.success('המשמרת נוספה')
  }

  const update = (id: string, patch: Partial<ShiftModel>) => {
    persist(models.map((model) => (model.id === id ? { ...model, ...patch } : model)))
  }

  const remove = (model: ShiftModel) => {
    if (models.length === 1) {
      notify.error('חייבת להישאר לפחות משמרת אחת')
      return
    }
    if (data.history.some((shift) => shift.shiftType === model.id)) {
      notify.error('אי אפשר למחוק משמרת שכבר יש לה שיבוצים שמורים')
      return
    }
    if (!confirm(`למחוק את משמרת ${model.name}?`)) return
    persist(models.filter((item) => item.id !== model.id))
    notify.success('המשמרת נמחקה')
  }

  return (
    <div className="space-y-4">
      <SectionCard
        title={module === 'inspectors' ? 'משמרות הבודקים' : 'משמרות הסלקטורים'}
        subtitle="השעות כאן קובעות את השיבוץ, הדף הראשי וההיסטוריה של המודול הזה בלבד"
      >
        {models.length === 0 ? (
          <EmptyState title="אין משמרות" text="הוסיפו משמרת כדי להתחיל לשבץ." />
        ) : (
          <ul className="space-y-3">
            {models.map((model) => (
              <li
                key={model.id}
                className="grid gap-3 rounded-xl border border-line/70 bg-card p-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end"
              >
                <div>
                  <FieldLabel htmlFor={`shift-name-${model.id}`}>שם</FieldLabel>
                  <input
                    id={`shift-name-${model.id}`}
                    className="ui-field"
                    value={model.name}
                    onChange={(e) => update(model.id, { name: e.target.value })}
                  />
                </div>
                <div>
                  <FieldLabel htmlFor={`shift-start-${model.id}`}>התחלה</FieldLabel>
                  <input
                    id={`shift-start-${model.id}`}
                    className="ui-field"
                    type="time"
                    value={clockValue(model.startMinutes)}
                    onChange={(e) => {
                      const minutes = parseClock(e.target.value)
                      if (minutes != null) update(model.id, { startMinutes: minutes })
                    }}
                  />
                </div>
                <div>
                  <FieldLabel htmlFor={`shift-end-${model.id}`}>סיום</FieldLabel>
                  <input
                    id={`shift-end-${model.id}`}
                    className="ui-field"
                    type="time"
                    value={clockValue(model.endMinutes)}
                    onChange={(e) => {
                      const minutes = parseClock(e.target.value)
                      if (minutes != null) update(model.id, { endMinutes: minutes })
                    }}
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] text-ink-soft">
                    <Ltr>{formatShiftModelWindow(model)}</Ltr>
                  </span>
                  <button
                    type="button"
                    className="ui-btn ui-btn-ghost"
                    onClick={() => remove(model)}
                    aria-label={`מחיקת משמרת ${model.name}`}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard title="משמרת חדשה" subtitle="אפשר שהסיום יהיה אחרי חצות. המשמרת תסומן כלמחרת">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
          <div>
            <FieldLabel htmlFor="new-shift-name">שם</FieldLabel>
            <input
              id="new-shift-name"
              className="ui-field"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="למשל ערב"
            />
          </div>
          <div>
            <FieldLabel htmlFor="new-shift-start">התחלה</FieldLabel>
            <input
              id="new-shift-start"
              className="ui-field"
              type="time"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </div>
          <div>
            <FieldLabel htmlFor="new-shift-end">סיום</FieldLabel>
            <input
              id="new-shift-end"
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
