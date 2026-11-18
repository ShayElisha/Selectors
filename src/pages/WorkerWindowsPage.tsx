import { useMemo, useState } from 'react'
import { Plus, Trash2, Edit2, X, Check } from 'lucide-react'
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

function displayLabel(preset: WorkerWindowPreset): string {
  const named = String(preset.name || '').trim()
  return named || workerWindowLabelFromTimes(preset.start, preset.end)
}

export function WorkerWindowsPage() {
  const { data, module, saveWorkerWindowPresets } = useApp()
  const presets = useMemo(
    () => {
      const resolved = resolveWorkerWindows(data.workerWindowPresets)
      console.log('WorkerWindowsPage - loaded presets:', {
        dataPresets: data.workerWindowPresets?.length ?? 0,
        resolved: resolved.length,
      })
      return resolved
    },
    [data.workerWindowPresets],
  )
  const [start, setStart] = useState('06:00')
  const [end, setEnd] = useState('15:00')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editStart, setEditStart] = useState('')
  const [editEnd, setEditEnd] = useState('')

  const persist = async (next: WorkerWindowPreset[]): Promise<boolean> => {
    const normalized = next.map((preset, order) => {
      const named = String(preset.name || '').trim() || undefined
      return {
        ...preset,
        name: named,
        label: named || workerWindowLabelFromTimes(preset.start, preset.end),
        order,
      }
    })
    try {
      await saveWorkerWindowPresets(normalized)
      return true
    } catch (error) {
      notify.error(
        error instanceof Error ? error.message : 'שמירת חלונות השעות נכשלה',
      )
      return false
    }
  }

  const add = async () => {
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
    const trimmedName = name.trim()
    const saved = await persist([
      ...presets,
      {
        id,
        label: trimmedName || workerWindowLabelFromTimes(startMinutes, endMinutes),
        name: trimmedName || undefined,
        start: startMinutes,
        end: endMinutes,
        order: presets.length,
      },
    ])
    if (!saved) return
    setError(null)
    setName('')
    notify.success('חלון השעות נוסף')
  }

  const startEdit = (preset: WorkerWindowPreset) => {
    setEditingId(preset.id)
    setEditName(preset.name || '')
    setEditStart(clockValue(preset.start))
    setEditEnd(clockValue(preset.end))
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditName('')
    setEditStart('')
    setEditEnd('')
  }

  const saveEdit = async () => {
    if (!editingId) return
    const startMinutes = parseClock(editStart)
    const endMinutes = parseClock(editEnd)
    if (startMinutes == null || endMinutes == null) {
      notify.error('שעות לא תקינות')
      return
    }
    if (startMinutes === endMinutes) {
      notify.error('שעת ההתחלה והסיום לא יכולות להיות זהות')
      return
    }
    const customName = editName.trim() || undefined
    const saved = await persist(
      presets.map((preset) => {
        if (preset.id !== editingId) return preset
        return {
          ...preset,
          start: startMinutes,
          end: endMinutes,
          name: customName,
          label:
            customName ||
            workerWindowLabelFromTimes(startMinutes, endMinutes),
        }
      }),
    )
    if (!saved) return
    notify.success('השעות עודכנו')
    cancelEdit()
  }

  const remove = async (preset: WorkerWindowPreset) => {
    if (presets.length === 1) {
      notify.error('חייבת להישאר לפחות אפשרות שעות אחת')
      return
    }
    if (!confirm(`למחוק את ${displayLabel(preset)}?`)) return
    const saved = await persist(presets.filter((item) => item.id !== preset.id))
    if (!saved) return
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
        subtitle={`הרשימה כאן מופיעה בנוכחות תחת «בחר משמרת» — לכל מודול בנפרד (${presets.length} שעות)`}
      >
        {presets.length === 0 ? (
          <EmptyState 
            title="אין שעות" 
            text="הוסיפו חלון שעות כדי לבחור בנוכחות. אם הוספתם ואין כאן - יש בעיה בשמירה." 
          />
        ) : (
          <ul className="space-y-3">
            {presets.map((preset) => (
              <li
                key={preset.id}
                className="rounded-xl border border-line/70 bg-card p-4"
              >
                {editingId === preset.id ? (
                  <div className="space-y-3">
                    <div>
                      <FieldLabel htmlFor={`edit-name-${preset.id}`}>
                        שם משמרת (אופציונלי)
                      </FieldLabel>
                      <input
                        id={`edit-name-${preset.id}`}
                        className="ui-field"
                        type="text"
                        placeholder="למשל: בוקר ארוך, צהריים קצר"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        autoFocus
                      />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <FieldLabel htmlFor={`edit-start-${preset.id}`}>
                          שעת התחלה
                        </FieldLabel>
                        <input
                          id={`edit-start-${preset.id}`}
                          className="ui-field"
                          type="time"
                          value={editStart}
                          onChange={(e) => setEditStart(e.target.value)}
                        />
                      </div>
                      <div>
                        <FieldLabel htmlFor={`edit-end-${preset.id}`}>
                          שעת סיום
                        </FieldLabel>
                        <input
                          id={`edit-end-${preset.id}`}
                          className="ui-field"
                          type="time"
                          value={editEnd}
                          onChange={(e) => setEditEnd(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="flex gap-2 justify-end">
                      <button
                        type="button"
                        className="ui-btn ui-btn-ghost gap-2"
                        onClick={cancelEdit}
                      >
                        <X className="size-4" aria-hidden />
                        ביטול
                      </button>
                      <button
                        type="button"
                        className="ui-btn ui-btn-primary gap-2"
                        onClick={saveEdit}
                      >
                        <Check className="size-4" aria-hidden />
                        שמירה
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-baseline gap-2">
                        <h3 className="text-lg font-semibold text-ink">
                          {preset.name || 'ללא שם'}
                        </h3>
                        {preset.name && (
                          <span className="text-sm text-ink-soft">
                            <Ltr>
                              {workerWindowLabelFromTimes(preset.start, preset.end)}
                            </Ltr>
                          </span>
                        )}
                      </div>
                      {!preset.name && (
                        <p className="text-sm text-ink-soft mt-1">
                          <Ltr>
                            {workerWindowLabelFromTimes(preset.start, preset.end)}
                          </Ltr>
                        </p>
                      )}
                      <div className="flex gap-4 mt-2 text-sm">
                        <div>
                          <span className="text-ink-soft">התחלה: </span>
                          <span className="font-medium text-ink">
                            <Ltr>{clockValue(preset.start)}</Ltr>
                          </span>
                        </div>
                        <div>
                          <span className="text-ink-soft">סיום: </span>
                          <span className="font-medium text-ink">
                            <Ltr>{clockValue(preset.end)}</Ltr>
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="ui-btn ui-btn-ghost gap-2"
                        onClick={() => startEdit(preset)}
                        aria-label={`עריכת ${displayLabel(preset)}`}
                      >
                        <Edit2 className="size-4" aria-hidden />
                        <span className="hidden sm:inline">עריכה</span>
                      </button>
                      <button
                        type="button"
                        className="ui-btn ui-btn-ghost text-error hover:bg-error/10 gap-2"
                        onClick={() => remove(preset)}
                        aria-label={`מחיקת ${displayLabel(preset)}`}
                      >
                        <Trash2 className="size-4" aria-hidden />
                        <span className="hidden sm:inline">מחיקה</span>
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <SectionCard
        title="חלון שעות חדש"
        subtitle="אפשר שהסיום יהיה אחרי חצות. החלון יופיע מיד בבחירת משמרת בנוכחות"
      >
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
          <div>
            <FieldLabel htmlFor="new-win-name">שם משמרת (אופציונלי)</FieldLabel>
            <input
              id="new-win-name"
              className="ui-field"
              type="text"
              placeholder="למשל: בוקר ארוך, צהריים, לילה"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
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
