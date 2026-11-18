import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { notify } from '../lib/notify'
import { FieldError, FieldLabel, Ltr } from './ui'
import { parseClock } from '../lib/shiftModels'
import {
  resolveWorkerWindows,
  workerWindowIdFromTimes,
  workerWindowLabelFromTimes,
} from '../lib/shiftCatalog'

interface AddWorkerWindowDialogProps {
  onClose: () => void
  onAdded?: (windowId: string) => void
}

export function AddWorkerWindowDialog({ onClose, onAdded }: AddWorkerWindowDialogProps) {
  const { data, saveWorkerWindowPresets } = useApp()
  const presets = resolveWorkerWindows(data.workerWindowPresets)
  
  const [start, setStart] = useState('06:00')
  const [end, setEnd] = useState('15:00')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

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
    const trimmedName = name.trim()
    const newPreset = {
      id,
      label: trimmedName || workerWindowLabelFromTimes(startMinutes, endMinutes),
      name: trimmedName || undefined,
      start: startMinutes,
      end: endMinutes,
      order: presets.length,
    }
    
    saveWorkerWindowPresets([...presets, newPreset].map((preset, order) => ({
      ...preset,
      order,
    })))
    
    setError(null)
    notify.success('חלון השעות נוסף')
    onAdded?.(id)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold text-ink">
            הוספת שעות אישיות חדשות
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-ink-soft hover:bg-line hover:text-ink"
            aria-label="סגור"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <FieldLabel htmlFor="window-name">שם (אופציונלי)</FieldLabel>
            <input
              id="window-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder='לדוגמה: "בוקר", "צהריים"'
              className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-ink placeholder:text-ink-soft focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <FieldLabel htmlFor="window-start">שעת התחלה</FieldLabel>
              <Ltr>
                <input
                  id="window-start"
                  type="time"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                />
              </Ltr>
            </div>

            <div>
              <FieldLabel htmlFor="window-end">שעת סיום</FieldLabel>
              <Ltr>
                <input
                  id="window-end"
                  type="time"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
                />
              </Ltr>
            </div>
          </div>

          {error && <FieldError message={error} />}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={add}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2 font-medium text-white hover:bg-brand-dark"
            >
              <Plus className="size-4" />
              הוסף
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-line bg-paper px-4 py-2 font-medium text-ink hover:bg-line"
            >
              ביטול
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
