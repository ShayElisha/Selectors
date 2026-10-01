import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  createSystemMessageRemote,
  deleteOrganizationRemote,
  extendOrganizationRestoreRemote,
  fetchBugReportsRemote,
  fetchOrganizationsRemote,
  fetchSystemMessagesRemote,
  purgeOrganizationRemote,
  restoreOrganizationRemote,
  reviewOrganizationRemote,
  setBugReportHandledRemote,
  type BugReportSummary,
  type OrganizationSummary,
} from '../api'
import { AppFooter } from '../components/AppFooter'
import { BrandMark } from '../components/BrandMark'
import { ThemeToggle } from '../components/ThemeToggle'
import { useApp } from '../context/AppContext'
import { notify } from '../lib/notify'
import { Ltr } from '../components/ui'

const STATUS_LABEL = {
  pending: 'ממתין',
  approved: 'מאושר',
  rejected: 'נדחה',
  suspended: 'מושעה',
  deleted: 'נמחק',
} as const

type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected' | 'suspended' | 'no_module'
type ModuleFilter = 'all' | 'selectors' | 'inspectors' | 'none'

function noModule(org: OrganizationSummary) {
  return org.status === 'approved' && !org.modules.selectors && !org.modules.inspectors
}

function OrgTable({
  orgs,
  busyId,
  onOpen,
  onPatch,
  onApprove,
  onSuspend,
  onResume,
  onRemove,
}: {
  orgs: OrganizationSummary[]
  busyId: string | null
  onOpen: (org: OrganizationSummary) => void
  onPatch: (org: OrganizationSummary, body: Parameters<typeof reviewOrganizationRemote>[1]) => void
  onApprove: (org: OrganizationSummary) => void
  onSuspend: (org: OrganizationSummary) => void
  onResume: (org: OrganizationSummary) => void
  onRemove: (org: OrganizationSummary) => void
}) {
  if (orgs.length === 0) {
    return <p className="px-4 py-6 text-sm text-ink-soft">אין ארגונים ברשימה הזו.</p>
  }
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse text-right text-sm">
        <thead>
          <tr className="border-b border-line/70 bg-surface/80 text-[12px] text-ink-soft">
            <th className="px-3 py-3 font-semibold">ארגון</th>
            <th className="px-3 py-3 font-semibold">מנהל</th>
            <th className="px-3 py-3 font-semibold">סטטוס</th>
            <th className="px-3 py-3 font-semibold">מודולים</th>
            <th className="px-3 py-3 font-semibold">פעולות</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line/60">
          {orgs.map((org) => {
            const busy = busyId === org.id
            const blocked = noModule(org)
            return (
              <tr key={org.id} className={`align-top ${blocked ? 'bg-warn-soft/70' : ''}`}>
                <td className="px-3 py-3">
                  <button
                    type="button"
                    className="font-semibold text-ink underline-offset-2 hover:underline"
                    onClick={() => onOpen(org)}
                  >
                    {org.name}
                  </button>
                  {blocked ? (
                    <p className="mt-1 max-w-[16rem] text-[12px] font-semibold leading-relaxed text-warn">
                      מאושר, אבל בלי מודול — המנהל לא יכול להיכנס.
                    </p>
                  ) : null}
                </td>
                <td className="px-3 py-3 text-ink-soft">
                  <div>{org.manager?.fullName || '—'}</div>
                  <div><Ltr>{org.manager?.phone || ''}</Ltr></div>
                  <div><Ltr>{org.manager?.email || ''}</Ltr></div>
                </td>
                <td className="px-3 py-3">{STATUS_LABEL[org.status]}</td>
                <td className="px-3 py-3">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={org.modules.selectors}
                      disabled={busy || org.status !== 'approved'}
                      onChange={(e) =>
                        void onPatch(org, {
                          modules: {
                            selectors: e.target.checked,
                            inspectors: org.modules.inspectors,
                          },
                        })
                      }
                    />
                    סלקטורים
                  </label>
                  <label className="mt-2 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={org.modules.inspectors}
                      disabled={busy || org.status !== 'approved'}
                      onChange={(e) =>
                        void onPatch(org, {
                          modules: {
                            selectors: org.modules.selectors,
                            inspectors: e.target.checked,
                          },
                        })
                      }
                    />
                    בודקים
                  </label>
                </td>
                <td className="px-3 py-3">
                  <div className="flex flex-wrap gap-2">
                    {org.status !== 'approved' && org.status !== 'suspended' && org.status !== 'deleted' && (
                      <button
                        type="button"
                        className="ui-btn ui-btn-primary"
                        disabled={busy}
                        onClick={() => onApprove(org)}
                      >
                        אישור
                      </button>
                    )}
                    {org.status === 'rejected' || org.status === 'suspended' ? (
                      <button
                        type="button"
                        className="ui-btn ui-btn-secondary"
                        disabled={busy}
                        onClick={() => onResume(org)}
                      >
                        חידוש גישה
                      </button>
                    ) : null}
                    {org.status === 'approved' ? (
                      <button
                        type="button"
                        className="ui-btn ui-btn-secondary"
                        disabled={busy}
                        onClick={() => onSuspend(org)}
                      >
                        השעיה
                      </button>
                    ) : null}
                    {org.status !== 'rejected' && org.status !== 'deleted' && org.status !== 'suspended' && (
                      <button
                        type="button"
                        className="ui-btn ui-btn-secondary"
                        disabled={busy}
                        onClick={() => void onPatch(org, { status: 'rejected' })}
                      >
                        דחייה
                      </button>
                    )}
                    <button
                      type="button"
                      className="ui-btn ui-btn-danger"
                      disabled={busy}
                      onClick={() => void onRemove(org)}
                    >
                      מחיקה
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function weekStart(iso: string): string | null {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  const day = (date.getDay() + 6) % 7
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - day)
  return date.toISOString().slice(0, 10)
}

function recentWeeks(count = 8): string[] {
  const keys: string[] = []
  const cursor = new Date()
  cursor.setHours(0, 0, 0, 0)
  const day = (cursor.getDay() + 6) % 7
  cursor.setDate(cursor.getDate() - day)
  for (let i = count - 1; i >= 0; i -= 1) {
    const date = new Date(cursor)
    date.setDate(cursor.getDate() - i * 7)
    keys.push(date.toISOString().slice(0, 10))
  }
  return keys
}

function inLastDays(iso: string | undefined, days: number): boolean {
  if (!iso) return false
  const time = new Date(iso).getTime()
  return Number.isFinite(time) && Date.now() - time <= days * 24 * 60 * 60 * 1000
}

function moduleLabel(org: OrganizationSummary): string {
  const labels = [
    org.modules.selectors ? 'סלקטורים' : '',
    org.modules.inspectors ? 'בודקים' : '',
  ].filter(Boolean)
  return labels.length > 0 ? labels.join(' · ') : 'אין'
}

function BarChart({
  title,
  series,
}: {
  title: string
  series: { label: string; value: number; tone?: string }[]
}) {
  const max = Math.max(1, ...series.map((item) => item.value))
  return (
    <section className="rounded-xl border border-line/70 bg-card p-4">
      <h2 className="font-display text-base font-bold text-ink">{title}</h2>
      <ul className="mt-3 space-y-2">
        {series.map((item) => (
          <li key={item.label}>
            <div className="mb-1 flex justify-between text-[12px] text-ink-soft">
              <span>{item.label}</span>
              <span>{item.value}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-surface">
              <div
                className={`h-full rounded-full ${item.tone || 'bg-brand'}`}
                style={{ width: `${Math.round((item.value / max) * 100)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function SuperAdminPage() {
  const { user, logout } = useApp()
  const [rows, setRows] = useState<OrganizationSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [moduleFilter, setModuleFilter] = useState<ModuleFilter>('all')
  const [selected, setSelected] = useState<OrganizationSummary | null>(null)
  const [approve, setApprove] = useState<OrganizationSummary | null>(null)
  const [approveModules, setApproveModules] = useState({
    selectors: true,
    inspectors: false,
  })
  const [deleteTarget, setDeleteTarget] = useState<OrganizationSummary | null>(null)
  const [deleteTyped, setDeleteTyped] = useState('')
  const [purgeTarget, setPurgeTarget] = useState<OrganizationSummary | null>(null)
  const [purgeName, setPurgeName] = useState('')
  const [purgePassword, setPurgePassword] = useState('')
  const [messageTitle, setMessageTitle] = useState('')
  const [messageBody, setMessageBody] = useState('')
  const [systemMessages, setSystemMessages] = useState<{ id: string; title: string; body: string; at: string }[]>([])
  const [messageBusy, setMessageBusy] = useState(false)
  const [reports, setReports] = useState<BugReportSummary[]>([])
  const [reportFilter, setReportFilter] = useState<'open' | 'handled' | 'all'>('open')
  const [openReportId, setOpenReportId] = useState<string | null>(null)
  const [reportBusyId, setReportBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setRows(await fetchOrganizationsRemote())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'טעינת הארגונים נכשלה')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (user?.role !== 'super_admin') return
    void load()
  }, [load, user?.role])

  useEffect(() => {
    if (user?.role !== 'super_admin') return
    let stop = false
    void fetchBugReportsRemote()
      .then((list) => {
        if (!stop) setReports(list)
      })
      .catch((err) => {
        if (!stop) setError(err instanceof Error ? err.message : 'טעינת הדיווחים נכשלה')
      })
    return () => {
      stop = true
    }
  }, [user?.role])

  useEffect(() => {
    if (user?.role !== 'super_admin') return
    let stop = false
    void fetchSystemMessagesRemote()
      .then((list) => {
        if (!stop) setSystemMessages(list)
      })
      .catch(() => {
        if (!stop) setSystemMessages([])
      })
    return () => {
      stop = true
    }
  }, [user?.role])

  const live = useMemo(() => rows.filter((org) => org.status !== 'deleted'), [rows])
  const counts = useMemo(() => {
    const month = new Date().getMonth()
    const year = new Date().getFullYear()
    const rejectedThisMonth = live.filter((org) => {
      if (!org.rejectedAt) return false
      const date = new Date(org.rejectedAt)
      return date.getMonth() === month && date.getFullYear() === year
    }).length
    const approved = live.filter((org) => org.status === 'approved')
    return {
      pending: live.filter((org) => org.status === 'pending').length,
      approved: approved.length,
      rejected: live.filter((org) => org.status === 'rejected').length,
      rejectedThisMonth,
      noModule: live.filter(noModule).length,
      loginWeek: live.filter((org) => inLastDays(org.lastLoginAt, 7)).length,
      idleMonth: approved.filter((org) => !inLastDays(org.lastLoginAt, 30)).length,
      neverSinceApproval: approved.filter((org) => !org.lastLoginAt).length,
      openModules: approved.reduce(
        (sum, org) => sum + Number(org.modules.selectors) + Number(org.modules.inspectors),
        0,
      ),
    }
  }, [live])

  const filtered = useMemo(() => {
    const q = query.trim()
    return live.filter((org) => {
      if (q && !`${org.name} ${org.manager?.fullName || ''}`.includes(q)) return false
      if (statusFilter === 'pending' && org.status !== 'pending') return false
      if (statusFilter === 'approved' && org.status !== 'approved') return false
      if (statusFilter === 'rejected' && org.status !== 'rejected') return false
      if (statusFilter === 'suspended' && org.status !== 'suspended') return false
      if (statusFilter === 'no_module' && !noModule(org)) return false
      if (moduleFilter === 'selectors' && !org.modules.selectors) return false
      if (moduleFilter === 'inspectors' && !org.modules.inspectors) return false
      if (moduleFilter === 'none' && (org.modules.selectors || org.modules.inspectors)) return false
      return true
    })
  }, [live, query, statusFilter, moduleFilter])

  const pending = filtered.filter((org) => org.status === 'pending')
  const rest = filtered.filter((org) => org.status !== 'pending' && org.status !== 'deleted')
  const deleted = rows.filter((org) => org.status === 'deleted')
  const weeks = recentWeeks()
  const joinSeries = weeks.map((key) => ({
    label: key.slice(5),
    value: live.filter((org) => weekStart(org.createdAt) === key).length,
  }))
  const decisionSeries = [
    { label: 'אישורים', value: live.filter((org) => org.approvedAt).length, tone: 'bg-ok' },
    { label: 'דחיות', value: live.filter((org) => org.rejectedAt).length, tone: 'bg-hard' },
  ]

  const exportList = () => {
    const header = [
      'ארגון',
      'סטטוס',
      'מודולים',
      'הצטרפות',
      'אישור',
      'דחייה',
      'כניסה אחרונה',
    ]
    const lines = live.map((org) =>
      [
        org.name,
        STATUS_LABEL[org.status],
        moduleLabel(org),
        org.createdAt,
        org.approvedAt || '',
        org.rejectedAt || '',
        org.lastLoginAt || '',
      ]
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(','),
    )
    const summary = [
      `מאושרים,${counts.approved}`,
      `ממתינים,${counts.pending}`,
      `נדחו החודש,${counts.rejectedThisMonth}`,
      `נכנסו ב-7 ימים,${counts.loginWeek}`,
      `לא נכנסו 30 יום,${counts.idleMonth}`,
      `לא נכנסו מאז האישור,${counts.neverSinceApproval}`,
      `מודולים פתוחים,${counts.openModules}`,
    ]
    const csv = `\uFEFF${summary.join('\n')}\n\n${header.join(',')}\n${lines.join('\n')}`
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'organizations.csv'
    link.click()
    URL.revokeObjectURL(url)
  }

  const remove = async (org: OrganizationSummary) => {
    if (deleteTyped.trim() !== org.name.trim()) return
    setBusyId(org.id)
    try {
      await deleteOrganizationRemote(org.id)
      setRows((current) => current.filter((row) => row.id !== org.id))
      if (selected?.id === org.id) setSelected(null)
      setDeleteTarget(null)
      setDeleteTyped('')
      notify.success('הארגון סומן למחיקה. אפשר לשחזר בתוך 7 ימים')
      await load()
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'מחיקת הארגון נכשלה')
    } finally {
      setBusyId(null)
    }
  }

  const restore = async (org: OrganizationSummary) => {
    setBusyId(org.id)
    try {
      const saved = await restoreOrganizationRemote(org.id)
      setRows((current) => current.map((row) => (row.id === saved.id ? saved : row)))
      notify.success('הארגון שוחזר')
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'השחזור נכשל')
    } finally {
      setBusyId(null)
    }
  }

  const extend = async (org: OrganizationSummary) => {
    setBusyId(org.id)
    try {
      const saved = await extendOrganizationRestoreRemote(org.id)
      setRows((current) => current.map((row) => (row.id === saved.id ? saved : row)))
      notify.success('חלון השחזור הוארך בשבעה ימים')
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'הארכת החלון נכשלה')
    } finally {
      setBusyId(null)
    }
  }

  const purge = async (org: OrganizationSummary) => {
    if (purgeName.trim() !== org.name.trim() || !purgePassword) return
    setBusyId(org.id)
    try {
      await purgeOrganizationRemote(org.id, purgeName.trim(), purgePassword)
      setRows((current) => current.filter((row) => row.id !== org.id))
      setPurgeTarget(null)
      setPurgeName('')
      setPurgePassword('')
      notify.success('הארגון נמחק לצמיתות')
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'המחיקה הסופית נכשלה')
    } finally {
      setBusyId(null)
    }
  }

  const patch = async (
    org: OrganizationSummary,
    body: Parameters<typeof reviewOrganizationRemote>[1],
  ) => {
    setBusyId(org.id)
    try {
      const saved = await reviewOrganizationRemote(org.id, body)
      setRows((current) => current.map((row) => (row.id === saved.id ? saved : row)))
      setSelected((current) => (current?.id === saved.id ? saved : current))
      notify.success('הארגון עודכן')
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'העדכון נכשל')
    } finally {
      setBusyId(null)
    }
  }

  const confirmApprove = async () => {
    if (!approve) return
    if (!approveModules.selectors && !approveModules.inspectors) {
      notify.error('בחרו לפחות מודול אחד')
      return
    }
    await patch(approve, { status: 'approved', modules: approveModules })
    setApprove(null)
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 py-8 sm:px-6">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <BrandMark className="size-12" />
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight text-ink">סופר אדמין</h1>
            <p className="mt-1 text-sm text-ink-soft">
              {user?.fullName} · אישור ארגונים ופתיחת סלקטורים או בודקים
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button type="button" className="ui-btn ui-btn-secondary" onClick={logout}>יציאה</button>
        </div>
      </header>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ['מאושרים', counts.approved],
          ['ממתינים', counts.pending],
          ['נדחו החודש', counts.rejectedThisMonth],
          ['מודולים פתוחים', counts.openModules],
          ['נכנסו ב־7 ימים', counts.loginWeek],
          ['לא נכנסו 30 יום', counts.idleMonth],
          ['לא נכנסו מאז האישור', counts.neverSinceApproval],
          ['בלי מודול', counts.noModule],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-xl border border-line/70 bg-card px-3 py-3">
            <p className="text-[12px] text-ink-soft">{label}</p>
            <p className="font-display text-2xl font-bold text-ink">{value}</p>
          </div>
        ))}
      </div>

      <div className="mb-4 grid gap-3 lg:grid-cols-2">
        <BarChart title="הצטרפויות לפי שבוע" series={joinSeries} />
        <BarChart title="אישורים מול דחיות" series={decisionSeries} />
      </div>

      <section className="mb-4 rounded-xl border border-line/70 bg-card px-4 py-4">
        <h2 className="font-display text-lg font-bold text-ink">הודעה לכל הארגונים</h2>
        <p className="mt-1 text-[13px] text-ink-soft">
          ההודעה מופיעה בדף הבית של כל המנהלים.
        </p>
        <label className="mt-3 block text-sm font-medium text-ink">
          כותרת
          <input
            className="ui-field mt-1"
            value={messageTitle}
            onChange={(event) => setMessageTitle(event.target.value)}
            maxLength={120}
          />
        </label>
        <label className="mt-3 block text-sm font-medium text-ink">
          תוכן
          <textarea
            className="ui-field mt-1 min-h-24"
            value={messageBody}
            onChange={(event) => setMessageBody(event.target.value)}
            maxLength={2000}
          />
        </label>
        <button
          type="button"
          className="ui-btn ui-btn-primary mt-3"
          disabled={messageBusy}
          onClick={() => {
            setMessageBusy(true)
            void createSystemMessageRemote({ title: messageTitle, body: messageBody })
              .then((message) => {
                setSystemMessages((current) => [message, ...current])
                setMessageTitle('')
                setMessageBody('')
                notify.success('ההודעה נשלחה לכל הארגונים')
              })
              .catch((err) => {
                setError(err instanceof Error ? err.message : 'שליחת ההודעה נכשלה')
              })
              .finally(() => setMessageBusy(false))
          }}
        >
          פרסום הודעה
        </button>
        {systemMessages.length > 0 ? (
          <ul className="mt-4 space-y-2">
            {systemMessages.slice(0, 5).map((message) => (
              <li key={message.id} className="rounded-lg bg-surface px-3 py-2 text-sm">
                <p className="font-semibold text-ink">{message.title}</p>
                <p className="mt-0.5 whitespace-pre-wrap text-ink-soft">{message.body}</p>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="mb-4 overflow-hidden rounded-xl border border-line/70 bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line/70 bg-surface/80 px-4 py-3">
          <h2 className="font-display text-lg font-bold text-ink">
            דיווחי תקלה ({reports.filter((report) => !report.handled).length} פתוחים)
          </h2>
          <div className="flex gap-1" role="group" aria-label="סינון דיווחים">
            {(
              [
                ['open', 'פתוחים'],
                ['handled', 'טופלו'],
                ['all', 'הכל'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setReportFilter(id)}
                className={`rounded-lg px-2.5 py-1 text-[12px] font-semibold ${
                  reportFilter === id ? 'bg-brand text-white' : 'text-ink-soft hover:bg-card'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {reports.filter((report) =>
          reportFilter === 'all' ? true : reportFilter === 'handled' ? report.handled : !report.handled,
        ).length === 0 ? (
          <p className="px-4 py-6 text-sm text-ink-soft">אין דיווחים ברשימה הזו.</p>
        ) : (
          <ul className="divide-y divide-line/60">
            {reports
              .filter((report) =>
                reportFilter === 'all'
                  ? true
                  : reportFilter === 'handled'
                    ? report.handled
                    : !report.handled,
              )
              .map((report) => {
                const open = openReportId === report.id
                const when = report.at
                  ? new Date(report.at).toLocaleString('he-IL', {
                      day: 'numeric',
                      month: 'numeric',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })
                  : ''
                return (
                  <li key={report.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <button
                        type="button"
                        className="min-w-0 text-right"
                        onClick={() => setOpenReportId(open ? null : report.id)}
                      >
                        <p className="font-semibold text-ink">{report.title}</p>
                        <p className="mt-1 text-[13px] text-ink-soft">
                          {report.orgName || 'בלי ארגון'}
                          {report.contactName ? ` · ${report.contactName}` : ''}
                          {' · '}
                          <Ltr>{report.contactPhone || '—'}</Ltr>
                          {when ? ` · ${when}` : ''}
                        </p>
                      </button>
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-md px-2 py-0.5 text-[12px] font-bold ${
                            report.handled
                              ? 'bg-ok-soft text-ok'
                              : 'bg-warn-soft text-warn'
                          }`}
                        >
                          {report.handled ? 'טופל' : 'פתוח'}
                        </span>
                        <button
                          type="button"
                          className="ui-btn ui-btn-secondary"
                          disabled={reportBusyId === report.id}
                          onClick={() => {
                            setReportBusyId(report.id)
                            void setBugReportHandledRemote(report.id, !report.handled)
                              .then((next) => {
                                setReports((current) =>
                                  current.map((item) => (item.id === next.id ? next : item)),
                                )
                              })
                              .catch((err) => {
                                setError(err instanceof Error ? err.message : 'עדכון הדיווח נכשל')
                              })
                              .finally(() => setReportBusyId(null))
                          }}
                        >
                          {report.handled ? 'החזר לטיפול' : 'סמן כטופל'}
                        </button>
                      </div>
                    </div>
                    {open ? (
                      <div className="mt-3 rounded-xl bg-surface px-3 py-2 text-sm leading-relaxed text-ink">
                        {report.where ? (
                          <p className="mb-1 text-[13px] text-ink-soft">איפה: {report.where}</p>
                        ) : null}
                        <p className="whitespace-pre-wrap">{report.details}</p>
                      </div>
                    ) : null}
                  </li>
                )
              })}
          </ul>
        )}
      </section>

      <div className="mb-4 flex flex-wrap gap-2">
        <input
          className="ui-field min-w-[12rem] flex-1"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="חיפוש לפי שם ארגון או מנהל"
          aria-label="חיפוש ארגונים"
        />
        <select
          className="ui-field w-auto"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          aria-label="סינון לפי סטטוס"
        >
          <option value="all">כל הסטטוסים</option>
          <option value="pending">ממתין</option>
          <option value="approved">מאושר</option>
          <option value="rejected">נדחה</option>
          <option value="suspended">מושעה</option>
          <option value="no_module">בלי מודול</option>
        </select>
        <button type="button" className="ui-btn ui-btn-secondary" onClick={exportList}>
          ייצוא רשימה
        </button>
        <select
          className="ui-field w-auto"
          value={moduleFilter}
          onChange={(e) => setModuleFilter(e.target.value as ModuleFilter)}
          aria-label="סינון לפי מודול"
        >
          <option value="all">כל המודולים</option>
          <option value="selectors">סלקטורים</option>
          <option value="inspectors">בודקים</option>
          <option value="none">בלי מודול</option>
        </select>
      </div>

      {selected ? (
        <section className="mb-4 rounded-xl border border-line/70 bg-card p-4">
          <div className="flex items-start justify-between gap-3">
            <h2 className="font-display text-xl font-bold text-ink">{selected.name}</h2>
            <button type="button" className="ui-btn ui-btn-ghost" onClick={() => setSelected(null)}>סגירה</button>
          </div>
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <div><dt className="text-ink-soft">סטטוס</dt><dd className="font-semibold">{STATUS_LABEL[selected.status]}</dd></div>
            <div><dt className="text-ink-soft">מודולים</dt><dd className="font-semibold">{moduleLabel(selected)}</dd></div>
            <div><dt className="text-ink-soft">מנהל</dt><dd className="font-semibold">{selected.manager?.fullName || '—'}</dd></div>
            <div><dt className="text-ink-soft">טלפון</dt><dd><Ltr>{selected.manager?.phone || '—'}</Ltr></dd></div>
            <div><dt className="text-ink-soft">מייל</dt><dd><Ltr>{selected.manager?.email || '—'}</Ltr></dd></div>
            <div>
              <dt className="text-ink-soft">תאריך הצטרפות</dt>
              <dd>{selected.createdAt ? new Date(selected.createdAt).toLocaleString('he-IL') : '—'}</dd>
            </div>
            <div>
              <dt className="text-ink-soft">תאריך אישור</dt>
              <dd>{selected.approvedAt ? new Date(selected.approvedAt).toLocaleString('he-IL') : '—'}</dd>
            </div>
            <div>
              <dt className="text-ink-soft">תאריך דחייה</dt>
              <dd>{selected.rejectedAt ? new Date(selected.rejectedAt).toLocaleString('he-IL') : '—'}</dd>
            </div>
            <div>
              <dt className="text-ink-soft">כניסה אחרונה</dt>
              <dd>{selected.lastLoginAt ? new Date(selected.lastLoginAt).toLocaleString('he-IL') : 'עדיין לא נכנס'}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      {error && (
        <p className="mb-4 rounded-xl border border-hard/30 bg-hard/10 px-3 py-2 text-sm text-hard">{error}</p>
      )}

      {loading ? (
        <p className="text-sm text-ink-soft">טוען ארגונים…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-line/70 bg-card px-4 py-8 text-center text-sm text-ink-soft">
          עדיין אין ארגונים רשומים.
        </p>
      ) : (
        <div className="space-y-4">
          <section className="overflow-hidden rounded-xl border border-warn/30 bg-card">
            <h2 className="border-b border-warn/20 bg-warn-soft px-4 py-3 font-display text-lg font-bold text-ink">
              ממתינים לאישור ({pending.length})
            </h2>
            <OrgTable
              orgs={pending}
              busyId={busyId}
              onOpen={setSelected}
              onPatch={patch}
              onApprove={(org) => {
                setApproveModules({ selectors: true, inspectors: false })
                setApprove(org)
              }}
              onSuspend={(org) => void patch(org, { status: 'suspended' })}
              onResume={(org) =>
                void patch(org, {
                  status: org.status === 'rejected' && !org.approvedAt ? 'pending' : 'approved',
                })
              }
              onRemove={(org) => {
                setDeleteTyped('')
                setDeleteTarget(org)
              }}
            />
          </section>
          <section className="overflow-hidden rounded-xl border border-line/70 bg-card">
            <h2 className="border-b border-line/70 bg-surface/80 px-4 py-3 font-display text-lg font-bold text-ink">
              מאושרים, מושעים ונדחים ({rest.length})
            </h2>
            <OrgTable
              orgs={rest}
              busyId={busyId}
              onOpen={setSelected}
              onPatch={patch}
              onApprove={(org) => {
                setApproveModules({ selectors: true, inspectors: false })
                setApprove(org)
              }}
              onSuspend={(org) => void patch(org, { status: 'suspended' })}
              onResume={(org) =>
                void patch(org, {
                  status: org.status === 'rejected' && !org.approvedAt ? 'pending' : 'approved',
                })
              }
              onRemove={(org) => {
                setDeleteTyped('')
                setDeleteTarget(org)
              }}
            />
          </section>
          {deleted.length > 0 ? (
            <section className="overflow-hidden rounded-xl border border-line/70 bg-card">
              <h2 className="border-b border-line/70 px-4 py-3 font-display text-lg font-bold text-ink">
                נמחקו לאחרונה ({deleted.length})
              </h2>
              <ul className="divide-y divide-line/60">
                {deleted.map((org) => (
                  <li key={org.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                    <div>
                      <p className="font-semibold text-ink">{org.name}</p>
                      <p className="text-[12px] text-ink-soft">
                        {org.restoreUntil
                          ? `אפשר לשחזר עד ${org.restoreUntil.slice(0, 10)}`
                          : 'אפשר לשחזר עד שבעה ימים מהמחיקה'}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="ui-btn ui-btn-secondary"
                        disabled={busyId === org.id}
                        onClick={() => void restore(org)}
                      >
                        שחזור
                      </button>
                      <button
                        type="button"
                        className="ui-btn ui-btn-secondary"
                        disabled={busyId === org.id}
                        onClick={() => void extend(org)}
                      >
                        הארכת חלון
                      </button>
                      <button
                        type="button"
                        className="ui-btn ui-btn-danger"
                        disabled={busyId === org.id}
                        onClick={() => {
                          setPurgeName('')
                          setPurgePassword('')
                          setPurgeTarget(org)
                        }}
                      >
                        מחיקה לצמיתות
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}

      {deleteTarget ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-3 sm:items-center">
          <div className="w-full max-w-md rounded-2xl border border-line bg-card p-4 shadow-xl">
            <h3 className="font-display text-lg font-bold text-ink">מחיקת {deleteTarget.name}</h3>
            <p className="mt-1 text-sm text-ink-soft">
              הנתונים נשמרים שבעה ימים, ואז נמחקים. כדי לאשר, הקלידו את שם הארגון.
            </p>
            <input
              className="ui-field mt-3"
              value={deleteTyped}
              onChange={(e) => setDeleteTyped(e.target.value)}
              aria-label="שם הארגון לאישור מחיקה"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="ui-btn ui-btn-ghost"
                onClick={() => setDeleteTarget(null)}
              >
                ביטול
              </button>
              <button
                type="button"
                className="ui-btn ui-btn-danger disabled:opacity-40"
                disabled={deleteTyped.trim() !== deleteTarget.name.trim()}
                onClick={() => void remove(deleteTarget)}
              >
                מחיקה
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {purgeTarget ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-3 sm:items-center">
          <div className="w-full max-w-md rounded-2xl border border-line bg-card p-4 shadow-xl">
            <h3 className="font-display text-lg font-bold text-ink">
              מחיקה לצמיתות של {purgeTarget.name}
            </h3>
            <p className="mt-1 text-sm text-ink-soft">
              הפעולה מוחקת את הארגון בלי אפשרות שחזור. הקלידו את שם הארגון ואת סיסמת סופר אדמין.
            </p>
            <input
              className="ui-field mt-3"
              value={purgeName}
              onChange={(e) => setPurgeName(e.target.value)}
              aria-label="שם הארגון לאישור מחיקה סופית"
              placeholder="שם הארגון"
            />
            <input
              className="ui-field mt-2"
              type="password"
              value={purgePassword}
              onChange={(e) => setPurgePassword(e.target.value)}
              aria-label="סיסמת סופר אדמין"
              placeholder="סיסמת סופר אדמין"
              autoComplete="current-password"
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="ui-btn ui-btn-ghost"
                onClick={() => setPurgeTarget(null)}
              >
                ביטול
              </button>
              <button
                type="button"
                className="ui-btn ui-btn-danger disabled:opacity-40"
                disabled={
                  purgeName.trim() !== purgeTarget.name.trim() || !purgePassword
                }
                onClick={() => void purge(purgeTarget)}
              >
                מחיקה לצמיתות
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {approve ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-3 sm:items-center">
          <div className="w-full max-w-md rounded-2xl border border-line bg-card p-4 shadow-xl">
            <h3 className="font-display text-lg font-bold text-ink">אישור {approve.name}</h3>
            <p className="mt-1 text-sm text-ink-soft">בחרו לפחות מודול אחד, כדי שהמנהל יוכל להיכנס.</p>
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={approveModules.selectors}
                onChange={(e) => setApproveModules((m) => ({ ...m, selectors: e.target.checked }))}
              />
              סלקטורים
            </label>
            <label className="mt-2 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={approveModules.inspectors}
                onChange={(e) => setApproveModules((m) => ({ ...m, inspectors: e.target.checked }))}
              />
              בודקים
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="ui-btn ui-btn-ghost" onClick={() => setApprove(null)}>ביטול</button>
              <button type="button" className="ui-btn ui-btn-primary" onClick={() => void confirmApprove()}>אישור הארגון</button>
            </div>
          </div>
        </div>
      ) : null}

      <AppFooter className="mt-10" />
    </div>
  )
}
