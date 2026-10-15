import { useMemo, useState } from 'react'
import { Download, Pencil, Plus, Search, ShieldAlert, Trash2, Wrench, X } from 'lucide-react'
import { SHIFT_TYPE_LABELS } from '../constants'
import { useApp } from '../context/AppContext'
import { downloadIncidentsCsv } from '../lib/incidentsExport'
import type { IncidentRecord, IncidentSeverity, IncidentStatus, ShiftType } from '../types'
import { EmptyState, FieldLabel, SectionCard } from '../components/ui'

const SEVERITIES: { id: IncidentSeverity; label: string; color: string }[] = [
  { id: 'critical', label: 'קריטית', color: 'bg-hard-soft text-hard' },
  { id: 'high', label: 'גבוהה', color: 'bg-warn-soft text-warn' },
  { id: 'medium', label: 'בינונית', color: 'bg-accent-soft text-accent' },
  { id: 'low', label: 'נמוכה', color: 'bg-surface text-ink-soft' },
]

const STATUSES: { id: IncidentStatus; label: string }[] = [
  { id: 'open', label: 'פתוח' },
  { id: 'in_progress', label: 'בטיפול' },
  { id: 'resolved', label: 'טופל' },
]

const SHIFT_TYPES: ShiftType[] = ['morning', 'afternoonA', 'afternoonB', 'afternoon', 'night']

type IncidentDraft = Pick<IncidentRecord, 'title' | 'description' | 'severity' | 'status'> & {
  laneId: string
  shiftDate: string
  shiftType: ShiftType | ''
  handlingNotes: string
}

const EMPTY_DRAFT: IncidentDraft = {
  title: '',
  description: '',
  severity: 'medium',
  status: 'open',
  laneId: '',
  shiftDate: '',
  shiftType: '',
  handlingNotes: '',
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })
}

export function IncidentsPage() {
  const { data, upsertIncident, deleteIncident } = useApp()
  const incidents = data.incidents ?? []
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | IncidentStatus>('all')
  const [severityFilter, setSeverityFilter] = useState<'all' | IncidentSeverity>('all')
  const [editor, setEditor] = useState<IncidentDraft | null>(null)
  const [editingId, setEditingId] = useState<string | undefined>()

  const visible = useMemo(() => incidents
    .filter((item) => statusFilter === 'all' || item.status === statusFilter)
    .filter((item) => severityFilter === 'all' || item.severity === severityFilter)
    .filter((item) => {
      const text = `${item.title} ${item.description} ${item.handlingNotes ?? ''} ${item.createdBy} ${item.laneId ?? ''}`.toLocaleLowerCase('he')
      const laneName = item.laneId ? data.lanes.find((lane) => lane.id === item.laneId)?.name ?? '' : ''
      return `${text} ${laneName}`.includes(query.trim().toLocaleLowerCase('he'))
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  [incidents, statusFilter, severityFilter, query, data.lanes])

  const openEditor = (item?: IncidentRecord) => {
    setEditingId(item?.id)
    setEditor(item ? {
      title: item.title,
      description: item.description,
      severity: item.severity,
      status: item.status,
      laneId: item.laneId ?? '',
      shiftDate: item.shiftDate ?? '',
      shiftType: item.shiftType ?? '',
      handlingNotes: item.handlingNotes ?? '',
    } : { ...EMPTY_DRAFT })
  }

  const save = () => {
    if (!editor?.title.trim() || !editor.description.trim()) return
    upsertIncident({
      id: editingId,
      title: editor.title,
      description: editor.description,
      severity: editor.severity,
      status: editor.status,
      ...(editor.laneId ? { laneId: editor.laneId } : {}),
      ...(editor.shiftDate ? { shiftDate: editor.shiftDate } : {}),
      ...(editor.shiftType ? { shiftType: editor.shiftType } : {}),
    })
    setEditor(null)
    setEditingId(undefined)
  }

  const openCount = incidents.filter((item) => item.status === 'open').length
  const workingCount = incidents.filter((item) => item.status === 'in_progress').length
  const criticalCount = incidents.filter((item) => item.severity === 'critical' && item.status !== 'resolved').length

  return (
    <div className="space-y-4">
      <SectionCard
        title="יומן אירועים ותקלות"
        subtitle="תיעוד אירועים תפעוליים, תקלות ציוד והטיפול בהם לאורך זמן."
        actions={
          <>
            <button type="button" className="ui-btn ui-btn-secondary" onClick={() => downloadIncidentsCsv(visible, data.lanes)} disabled={!visible.length}>
              <Download className="size-4" aria-hidden /> ייצוא ({visible.length})
            </button>
            <button type="button" className="ui-btn ui-btn-primary" onClick={() => openEditor()}>
              <Plus className="size-4" aria-hidden /> דיווח אירוע
            </button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric label="כל האירועים" value={incidents.length} />
          <Metric label="פתוחים" value={openCount} tone={openCount ? 'warn' : 'normal'} />
          <Metric label="בטיפול" value={workingCount} tone="brand" />
          <Metric label="קריטיים פתוחים" value={criticalCount} tone={criticalCount ? 'hard' : 'normal'} />
        </div>
      </SectionCard>

      {editor ? (
        <SectionCard title={editingId ? 'עריכת דיווח' : 'דיווח אירוע חדש'} subtitle="תעדו מה קרה, היכן, ומה נעשה כדי לטפל בכך." actions={<button className="ui-btn ui-btn-ghost" type="button" onClick={() => setEditor(null)} aria-label="סגירה"><X className="size-4" /></button>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="כותרת *"><input className="ui-field" value={editor.title} onChange={(e) => setEditor({ ...editor, title: e.target.value })} placeholder="למשל: תקלה בשער צפוני" /></Field>
            <Field label="עמדה קשורה"><select className="ui-field" value={editor.laneId} onChange={(e) => setEditor({ ...editor, laneId: e.target.value })}><option value="">ללא עמדה מסוימת</option>{data.lanes.filter((lane) => lane.id !== 'gate-manager').map((lane) => <option key={lane.id} value={lane.id}>{lane.name}</option>)}</select></Field>
            <Field label="תיאור האירוע *" className="sm:col-span-2"><textarea className="ui-field min-h-24 resize-y" value={editor.description} onChange={(e) => setEditor({ ...editor, description: e.target.value })} placeholder="מה קרה? מי או מה הושפע?" /></Field>
            <Field label="חומרה"><select className="ui-field" value={editor.severity} onChange={(e) => setEditor({ ...editor, severity: e.target.value as IncidentSeverity })}>{SEVERITIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></Field>
            <Field label="סטטוס טיפול"><select className="ui-field" value={editor.status} onChange={(e) => setEditor({ ...editor, status: e.target.value as IncidentStatus })}>{STATUSES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></Field>
            <Field label="תאריך המשמרת"><input className="ui-field" type="date" value={editor.shiftDate} onChange={(e) => setEditor({ ...editor, shiftDate: e.target.value })} /></Field>
            <Field label="סוג משמרת"><select className="ui-field" value={editor.shiftType} onChange={(e) => setEditor({ ...editor, shiftType: e.target.value as ShiftType | '' })}><option value="">לא צוין</option>{SHIFT_TYPES.map((type) => <option key={type} value={type}>{SHIFT_TYPE_LABELS[type]}</option>)}</select></Field>
            <Field label="הטיפול שבוצע / מה נותר לעשות" className="sm:col-span-2"><textarea className="ui-field min-h-20 resize-y" value={editor.handlingNotes} onChange={(e) => setEditor({ ...editor, handlingNotes: e.target.value })} placeholder="פעולות שבוצעו, אחראי להמשך, ומה עדיין פתוח" /></Field>
          </div>
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setEditor(null)}>ביטול</button>
            <button type="button" className="ui-btn ui-btn-primary" onClick={save} disabled={!editor.title.trim() || !editor.description.trim()}>שמירת דיווח</button>
          </div>
        </SectionCard>
      ) : null}

      <SectionCard title="רשימת דיווחים" subtitle={`${visible.length} מתוך ${incidents.length} אירועים`}>
        <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_180px_180px]">
          <label className="relative block"><Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-soft" aria-hidden /><input className="ui-field pe-9" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="חיפוש לפי כותרת, תיאור או עמדה" aria-label="חיפוש אירועים" /></label>
          <select className="ui-field" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as 'all' | IncidentStatus)} aria-label="סינון לפי סטטוס"><option value="all">כל הסטטוסים</option>{STATUSES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
          <select className="ui-field" value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value as 'all' | IncidentSeverity)} aria-label="סינון לפי חומרה"><option value="all">כל רמות החומרה</option>{SEVERITIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
        </div>
        {visible.length === 0 ? (
          <EmptyState title={incidents.length ? 'לא נמצאו דיווחים' : 'עדיין אין אירועים ביומן'} text={incidents.length ? 'נסו לשנות את החיפוש או את הסינון.' : 'דווחו על אירוע או תקלה כדי שמנהלים יוכלו לתעד טיפול ולחזור אליו בהמשך.'} action={!incidents.length ? <button className="ui-btn ui-btn-primary" type="button" onClick={() => openEditor()}><Plus className="size-4" /> דיווח ראשון</button> : undefined} />
        ) : (
          <div className="space-y-3">
            {visible.map((item) => {
              const lane = data.lanes.find((candidate) => candidate.id === item.laneId)
              const severity = SEVERITIES.find((entry) => entry.id === item.severity)!
              const status = STATUSES.find((entry) => entry.id === item.status)!
              return (
                <article key={item.id} className="rounded-xl border border-line/80 bg-surface/60 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${severity.color}`}>{severity.label}</span>
                        <span className="rounded-full bg-card px-2.5 py-1 text-xs font-medium text-ink-soft ring-1 ring-line">{status.label}</span>
                        {lane ? <span className="inline-flex items-center gap-1 text-xs text-ink-soft"><Wrench className="size-3.5" />{lane.name}</span> : null}
                        {item.shiftDate ? <span className="text-xs text-ink-soft">{item.shiftDate}{item.shiftType ? ` · ${SHIFT_TYPE_LABELS[item.shiftType]}` : ''}</span> : null}
                      </div>
                      <h3 className="text-base font-bold text-ink">{item.title}</h3>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-ink-soft">{item.description}</p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <button type="button" className="ui-btn ui-btn-ghost !px-2" onClick={() => openEditor(item)} aria-label={`עריכת ${item.title}`}><Pencil className="size-4" /></button>
                      <button type="button" className="ui-btn ui-btn-ghost !px-2 text-hard" onClick={() => { if (window.confirm('למחוק את הדיווח מהיומן?')) deleteIncident(item.id) }} aria-label={`מחיקת ${item.title}`}><Trash2 className="size-4" /></button>
                    </div>
                  </div>
                  {item.handlingNotes ? <div className="mt-3 rounded-lg border border-line/60 bg-card px-3 py-2.5"><p className="mb-1 text-xs font-semibold text-ink"><ShieldAlert className="me-1 inline size-3.5" />טיפול והמשך</p><p className="whitespace-pre-wrap text-sm leading-6 text-ink-soft">{item.handlingNotes}</p></div> : null}
                  <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-line/60 pt-2.5 text-[11px] text-ink-soft"><span>נפתח: {item.createdBy} · {formatDate(item.createdAt)}</span>{item.updatedAt !== item.createdAt ? <span>עודכן: {item.updatedBy} · {formatDate(item.updatedAt)}</span> : null}</div>
                </article>
              )
            })}
          </div>
        )}
      </SectionCard>
    </div>
  )
}

function Metric({ label, value, tone = 'normal' }: { label: string; value: number; tone?: 'normal' | 'warn' | 'hard' | 'brand' }) {
  const styles = { normal: 'text-ink', warn: 'text-warn', hard: 'text-hard', brand: 'text-brand' }
  return <div className="rounded-xl border border-line/70 bg-surface/70 p-3"><p className="text-xs text-ink-soft">{label}</p><p className={`mt-1 text-2xl font-bold tabular-nums ${styles[tone]}`}>{value}</p></div>
}

function Field({ label, className = '', children }: { label: string; className?: string; children: React.ReactNode }) {
  return <div className={className}><FieldLabel>{label}</FieldLabel>{children}</div>
}
