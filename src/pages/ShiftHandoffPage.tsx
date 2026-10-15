import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, ClipboardPenLine, Loader2, Plus, RotateCcw } from 'lucide-react'
import { createShiftHandoffRemote, fetchShiftHandoffs, updateShiftHandoffRemote } from '../api'
import { EmptyState, FieldLabel, Ltr, SectionCard } from '../components/ui'
import { SHIFT_TYPE_LABELS } from '../constants'
import { useApp } from '../context/AppContext'
import { notify } from '../lib/notify'
import { formatShiftDate } from '../lib/hebrew'
import type { ShiftHandoffNote, ShiftType } from '../types'

const SHIFT_TYPES: ShiftType[] = ['morning', 'afternoonA', 'afternoonB', 'afternoon', 'night']

function today() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function when(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('he-IL', { dateStyle: 'medium', timeStyle: 'short' })
}

export function ShiftHandoffPage() {
  const { data } = useApp()
  const [notes, setNotes] = useState<ShiftHandoffNote[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [details, setDetails] = useState('')
  const [date, setDate] = useState(today)
  const [shiftType, setShiftType] = useState<ShiftType | ''>('')
  const [ownerWorkerId, setOwnerWorkerId] = useState('')
  const [dueDate, setDueDate] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setNotes(await fetchShiftHandoffs())
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'טעינת סיכומי המשמרת נכשלה'
      setError(message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const openNotes = useMemo(() => notes.filter((note) => note.status === 'open'), [notes])
  const closedNotes = useMemo(() => notes.filter((note) => note.status === 'closed'), [notes])

  const addNote = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!title.trim() || !details.trim()) return
    setSaving(true)
    try {
      const created = await createShiftHandoffRemote({ title, details, date, shiftType, ownerWorkerId, dueDate })
      setNotes((current) => [created, ...current])
      setTitle('')
      setDetails('')
      setOwnerWorkerId('')
      setDueDate('')
      notify.success('נוסף לסיכום המשמרת')
    } catch (cause) {
      notify.error(cause instanceof Error ? cause.message : 'שמירת הסיכום נכשלה')
    } finally {
      setSaving(false)
    }
  }

  const setStatus = async (note: ShiftHandoffNote, status: 'open' | 'closed') => {
    try {
      const updated = await updateShiftHandoffRemote(note.id, { status })
      setNotes((current) => current.map((item) => item.id === note.id ? { ...updated, id: note.id } : item))
      notify.success(status === 'closed' ? 'הנושא סומן כטופל' : 'הנושא נפתח מחדש')
    } catch (cause) {
      notify.error(cause instanceof Error ? cause.message : 'עדכון הסיכום נכשל')
    }
  }

  const updateResponsibility = async (note: ShiftHandoffNote, patch: { ownerWorkerId?: string; dueDate?: string }) => {
    try {
      const updated = await updateShiftHandoffRemote(note.id, patch)
      setNotes((current) => current.map((item) => item.id === note.id ? { ...updated, id: note.id } : item))
    } catch (cause) {
      notify.error(cause instanceof Error ? cause.message : 'עדכון האחראי או מועד היעד נכשל')
    }
  }

  const renderNote = (note: ShiftHandoffNote) => (
    <article key={note.id} className="rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-ink">{note.title}</h3>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink-soft">{note.details}</p>
          <p className="mt-2 text-xs text-ink-soft">
            {note.createdBy} · <Ltr>{when(note.createdAt)}</Ltr>
            {note.date ? <> · {SHIFT_TYPE_LABELS[note.shiftType as ShiftType] || 'משמרת'} · <Ltr>{formatShiftDate(note.date)}</Ltr></> : null}
          </p>
          {note.ownerWorkerId || note.dueDate ? (
            <p className={`mt-1 text-xs ${note.status === 'open' && note.dueDate && note.dueDate < today() ? 'font-semibold text-hard' : 'text-ink-soft'}`}>
              {note.ownerWorkerId ? `אחראי: ${data.workers.find((worker) => worker.id === note.ownerWorkerId)?.fullName ?? 'עובד לא זמין'}` : 'ללא אחראי'}
              {note.dueDate ? ` · יעד: ${formatShiftDate(note.dueDate)}${note.status === 'open' && note.dueDate < today() ? ' · באיחור' : ''}` : ''}
            </p>
          ) : null}
          {note.status === 'open' ? (
            <div className="mt-2 flex flex-wrap gap-2">
              <label className="grid gap-1 text-xs text-ink-soft">אחראי
                <select className="ui-input min-h-9 py-1 text-xs" value={note.ownerWorkerId || ''} onChange={(event) => void updateResponsibility(note, { ownerWorkerId: event.target.value })}>
                  <option value="">לא הוקצה</option>
                  {data.workers.filter((worker) => worker.status === 'active').map((worker) => <option key={worker.id} value={worker.id}>{worker.fullName}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-xs text-ink-soft">מועד יעד
                <input type="date" className="ui-input min-h-9 py-1 text-xs" value={note.dueDate || ''} onChange={(event) => void updateResponsibility(note, { dueDate: event.target.value })} />
              </label>
            </div>
          ) : null}
          {note.status === 'closed' && note.closedBy ? <p className="mt-1 text-xs text-ink-soft">טופל על ידי {note.closedBy}{note.closedAt ? <> · <Ltr>{when(note.closedAt)}</Ltr></> : null}</p> : null}
        </div>
        <button type="button" className="ui-btn ui-btn-secondary shrink-0" onClick={() => void setStatus(note, note.status === 'open' ? 'closed' : 'open')}>
          {note.status === 'open' ? <><Check className="size-4" aria-hidden />סימון כטופל</> : <><RotateCcw className="size-4" aria-hidden />פתיחה מחדש</>}
        </button>
      </div>
    </article>
  )

  return (
    <div className="space-y-4">
      <SectionCard title="סיכום ומסירת משמרת" subtitle="עדכונים משותפים למנהלים: אירועים, חוסרים ונושאים פתוחים להעברה למנהל הבא.">
        <form onSubmit={(event) => void addNote(event)} className="grid gap-3 rounded-xl border border-line bg-surface p-4">
          <FieldLabel htmlFor="handoff-title">כותרת</FieldLabel>
          <input id="handoff-title" className="ui-input w-full" maxLength={120} required value={title} onChange={(event) => setTitle(event.target.value)} placeholder="למשל: חוסר בכיסוי בנתיב 4" />
          <FieldLabel htmlFor="handoff-details">פרטים ומה צריך להעביר</FieldLabel>
          <textarea id="handoff-details" className="ui-input min-h-28 w-full resize-y" maxLength={4000} required value={details} onChange={(event) => setDetails(event.target.value)} placeholder="מה קרה, מה כבר טופל ומה נדרש מהמנהל הבא?" />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium text-ink" htmlFor="handoff-date">תאריך משמרת (אופציונלי)<input id="handoff-date" type="date" className="ui-input" value={date} onChange={(event) => setDate(event.target.value)} /></label>
            <label className="grid gap-1.5 text-sm font-medium text-ink" htmlFor="handoff-shift">משמרת (אופציונלי)<select id="handoff-shift" className="ui-input" value={shiftType} onChange={(event) => setShiftType(event.target.value as ShiftType | '')}><option value="">לא משויך למשמרת</option>{SHIFT_TYPES.map((type) => <option key={type} value={type}>{SHIFT_TYPE_LABELS[type]}</option>)}</select></label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium text-ink" htmlFor="handoff-owner">אחראי להמשך טיפול<select id="handoff-owner" className="ui-input" value={ownerWorkerId} onChange={(event) => setOwnerWorkerId(event.target.value)}><option value="">לא הוקצה</option>{data.workers.filter((worker) => worker.status === 'active').sort((a, b) => a.fullName.localeCompare(b.fullName, 'he')).map((worker) => <option key={worker.id} value={worker.id}>{worker.fullName}</option>)}</select></label>
            <label className="grid gap-1.5 text-sm font-medium text-ink" htmlFor="handoff-due-date">מועד יעד (אופציונלי)<input id="handoff-due-date" type="date" className="ui-input" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
          </div>
          <div className="flex justify-end"><button type="submit" className="ui-btn ui-btn-primary" disabled={saving || !title.trim() || !details.trim()}>{saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />}הוספה למסירה</button></div>
        </form>
      </SectionCard>
      <SectionCard title={`נושאים פתוחים (${openNotes.length})`} subtitle="הנושאים נשמרים ומשותפים בין מנהלי הארגון.">
        {loading ? <div className="flex items-center gap-2 py-6 text-sm text-ink-soft"><Loader2 className="size-4 animate-spin" aria-hidden />טוען סיכומים…</div> : error ? <div role="alert" className="rounded-lg bg-hard-soft p-3 text-sm text-hard">{error}<button type="button" className="ui-btn ui-btn-secondary ms-2" onClick={() => void load()}>ניסיון חוזר</button></div> : openNotes.length ? <div className="space-y-2">{openNotes.map(renderNote)}</div> : <EmptyState title="אין נושאים פתוחים" text="אפשר להוסיף כאן אירוע או משימה להעברה למנהל הבא." action={<ClipboardPenLine className="mx-auto size-5 text-ink-soft" aria-hidden />} />}
      </SectionCard>
      {closedNotes.length ? <SectionCard title={`טופלו (${closedNotes.length})`}><div className="space-y-2">{closedNotes.map(renderNote)}</div></SectionCard> : null}
    </div>
  )
}
