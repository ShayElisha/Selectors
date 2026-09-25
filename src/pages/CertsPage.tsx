import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  MoreHorizontal,
  Plus,
  Trash2,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { AnchoredMenu } from '../components/AnchoredMenu'
import { notify } from '../lib/notify'
import {
  EmptyState,
  FieldError,
  FieldLabel,
  Ltr,
  SectionCard,
  Skeleton,
} from '../components/ui'
import {
  MAX_CERT_NAME_LENGTH,
  THIN_CERT_HOLDER_THRESHOLD,
  canDeleteCertification,
  certStatusKind,
  certUsage,
  isDuplicateCertName,
  thinDependentLanesCount,
} from '../lib/lanesCertHelpers'
import { orderedCertifications } from '../lib/workersHelpers'

function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  confirmDisabled,
  danger,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  children: React.ReactNode
  confirmLabel: string
  confirmDisabled?: boolean
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const titleId = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    previouslyFocused.current = document.activeElement as HTMLElement | null
    const t = window.setTimeout(() => cancelRef.current?.focus(), 0)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(t)
      document.removeEventListener('keydown', onKey)
      previouslyFocused.current?.focus?.()
    }
  }, [open, onCancel])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-ink/40 p-3 sm:items-center sm:p-4 no-print"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-line bg-card p-4 shadow-[var(--shadow-panel-hover)] animate-fade-up sm:p-5"
      >
        <h3
          id={titleId}
          className="font-display text-base font-bold text-ink sm:text-lg"
        >
          {title}
        </h3>
        <div className="mt-2 space-y-2 text-[13px] leading-relaxed text-ink-soft">
          {children}
        </div>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="ui-btn ui-btn-secondary min-h-10 px-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            ביטול
          </button>
          <button
            type="button"
            disabled={confirmDisabled}
            onClick={onConfirm}
            className={`ui-btn min-h-10 px-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-40 ${
              danger
                ? 'border border-hard bg-hard text-white hover:bg-hard/90'
                : 'ui-btn-primary'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

function StatusChip({ kind }: { kind: ReturnType<typeof certStatusKind> }) {
  if (kind === 'dangling_req') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-hard-soft px-1.5 py-0.5 text-[11px] font-bold text-hard ring-1 ring-hard/20">
        <AlertTriangle className="size-3" aria-hidden />
        נדרשת בנתיב אך אין בודק שמחזיק בה
      </span>
    )
  }
  if (kind === 'in_use') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-ok-soft px-1.5 py-0.5 text-[11px] font-bold text-ok ring-1 ring-ok/20">
        <CheckCircle2 className="size-3" aria-hidden />
        בשימוש
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-surface px-1.5 py-0.5 text-[11px] font-bold text-ink-soft ring-1 ring-line">
      <CircleDashed className="size-3" aria-hidden />
      לא בשימוש
    </span>
  )
}

function CertMenu({
  name,
  canDelete,
  blockReason,
  onDelete,
}: {
  name: string
  canDelete: boolean
  blockReason: string | null
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        btnRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="relative no-print" ref={rootRef}>
      <button
        ref={btnRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`פעולות עבור הסמכה ${name}`}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex size-10 items-center justify-center rounded-lg text-ink-soft hover:bg-surface hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <MoreHorizontal className="size-5" aria-hidden />
      </button>
      <AnchoredMenu open={open} anchorRef={btnRef} width={192}>
          {canDelete ? (
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 px-3 py-2.5 text-start text-[13px] font-semibold text-hard hover:bg-hard-soft"
              onClick={() => {
                setOpen(false)
                onDelete()
              }}
            >
              <Trash2 className="size-3.5" aria-hidden />
              מחיקה
            </button>
          ) : (
            <p
              role="menuitem"
              aria-disabled="true"
              className="max-w-[14rem] px-3 py-2.5 text-[12px] leading-snug text-ink-soft"
            >
              {blockReason}
            </p>
          )}
      </AnchoredMenu>
    </div>
  )
}

export function CertsPage() {
  const { data, loading, error, addCertification, removeCertification, setView } =
    useApp()
  const [name, setName] = useState('')
  const [touched, setTouched] = useState(false)
  const [deleteName, setDeleteName] = useState<string | null>(null)
  const inputId = useId()
  const errId = useId()

  const ordered = useMemo(
    () =>
      orderedCertifications(
        data.certificationsCatalog,
        data.certificationsCatalog,
      ),
    [data.certificationsCatalog],
  )

  const thinNote = useMemo(
    () => thinDependentLanesCount(data.lanes, data.workers),
    [data.lanes, data.workers],
  )

  const trimmed = name.trim()
  const tooLong = trimmed.length > MAX_CERT_NAME_LENGTH
  const dup = isDuplicateCertName(data.certificationsCatalog, trimmed)
  const nameError = !trimmed
    ? touched
      ? 'נא להזין שם הסמכה'
      : null
    : tooLong
      ? `עד ${MAX_CERT_NAME_LENGTH} תווים`
      : dup
        ? 'הסמכה בשם זה כבר קיימת'
        : null
  const canSubmit = Boolean(trimmed) && !tooLong && !dup

  const showToast = useCallback((msg: string) => {
    notify.success(msg)
  }, [])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (!canSubmit) return
    addCertification(trimmed)
    setName('')
    setTouched(false)
    showToast('ההסמכה נוספה')
  }

  if (loading && data.certificationsCatalog.length === 0) {
    return (
      <SectionCard
        title="קטלוג הסמכות"
        subtitle="בשיבוץ אוטומטי משובצים רק מוסמכים. ידנית אפשר לבחור גם בודק ללא הסמכה — והוא יסומן בלוח."
      >
        <div className="space-y-2" aria-busy>
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-xl" />
          ))}
        </div>
      </SectionCard>
    )
  }

  return (
    <div className="certs-print-root space-y-4">
      <SectionCard
        title="קטלוג הסמכות"
        subtitle="בשיבוץ אוטומטי משובצים רק מוסמכים. ידנית אפשר לבחור גם בודק ללא הסמכה — והוא יסומן בלוח."
        printRoot
      >
        {error ? (
          <p className="mb-3 text-[13px] font-medium text-hard" role="alert">
            {error}
          </p>
        ) : null}

        <form
          onSubmit={submit}
          className="mb-5 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end"
        >
          <div>
            <FieldLabel htmlFor={inputId}>שם הסמכה חדשה</FieldLabel>
            <input
              id={inputId}
              className="ui-field bg-surface"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={MAX_CERT_NAME_LENGTH + 5}
              aria-invalid={Boolean(nameError) || undefined}
              aria-describedby={nameError ? errId : undefined}
            />
            <span id={errId}>
              <FieldError message={nameError} />
            </span>
          </div>
          <button
            type="submit"
            disabled={!canSubmit}
            className="ui-btn ui-btn-primary disabled:opacity-40"
          >
            <Plus className="size-4" aria-hidden />
            הוספה
          </button>
        </form>

        {thinNote > 0 ? (
          <p className="mb-3 text-[13px] text-ink-soft tabular-nums">
            <Ltr>{thinNote}</Ltr> נתיבים תלויים בהסמכה עם פחות מ־
            {THIN_CERT_HOLDER_THRESHOLD} מחזיקים פעילים
          </p>
        ) : null}

        {ordered.length === 0 ? (
          <EmptyState
            title="עדיין אין הסמכות"
            text="הוסיפו הסמכות לקטלוג כדי לדרוש אותן בנתיבים."
          />
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[640px] border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-line">
                    <th
                      scope="col"
                      className="px-2 py-2 text-start text-[12px] font-semibold text-ink-soft"
                    >
                      הסמכה
                    </th>
                    <th
                      scope="col"
                      className="px-2 py-2 text-start text-[12px] font-semibold text-ink-soft"
                    >
                      בודקים
                    </th>
                    <th
                      scope="col"
                      className="px-2 py-2 text-start text-[12px] font-semibold text-ink-soft"
                    >
                      נתיבים
                    </th>
                    <th
                      scope="col"
                      className="px-2 py-2 text-start text-[12px] font-semibold text-ink-soft"
                    >
                      סטטוס
                    </th>
                    <th scope="col" className="px-2 py-2 no-print">
                      <span className="sr-only">פעולות</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {ordered.map((c) => {
                    const usage = certUsage(c, data.workers, data.lanes)
                    const kind = certStatusKind(usage)
                    const deletable = canDeleteCertification(usage)
                    return (
                      <tr key={c} className="h-14 border-b border-line/70">
                        <td className="px-2 py-1.5 font-semibold text-ink">
                          {c}
                        </td>
                        <td className="px-2 py-1.5 tabular-nums text-ink-soft">
                          <Ltr>{usage.workers}</Ltr> בודקים
                        </td>
                        <td className="px-2 py-1.5 tabular-nums text-ink-soft">
                          <Ltr>{usage.lanes}</Ltr> נתיבים
                        </td>
                        <td className="px-2 py-1.5">
                          <StatusChip kind={kind} />
                        </td>
                        <td className="px-2 py-1.5 no-print">
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setView('workers')}
                              className="text-[12px] font-semibold text-brand underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                            >
                              הצגת בודקים
                            </button>
                            <button
                              type="button"
                              onClick={() => setView('lanes')}
                              className="text-[12px] font-semibold text-brand underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                            >
                              הצגת נתיבים
                            </button>
                            <CertMenu
                              name={c}
                              canDelete={deletable}
                              blockReason={
                                deletable
                                  ? null
                                  : `הסר תחילה מ־${usage.lanes} נתיבים ומ־${usage.workers} בודקים (המערכת לא מנקה הפניות אוטומטית)`
                              }
                              onDelete={() => setDeleteName(c)}
                            />
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <ul className="space-y-2 md:hidden">
              {ordered.map((c) => {
                const usage = certUsage(c, data.workers, data.lanes)
                const kind = certStatusKind(usage)
                const deletable = canDeleteCertification(usage)
                return (
                  <li
                    key={c}
                    className="rounded-xl border border-line/70 bg-card p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-ink">{c}</p>
                        <p className="mt-1 text-[13px] text-ink-soft tabular-nums">
                          <Ltr>{usage.workers}</Ltr> בודקים ·{' '}
                          <Ltr>{usage.lanes}</Ltr> נתיבים
                        </p>
                        <div className="mt-2">
                          <StatusChip kind={kind} />
                        </div>
                        <div className="mt-2 flex flex-wrap gap-3 no-print">
                          <button
                            type="button"
                            onClick={() => setView('workers')}
                            className="text-[12px] font-semibold text-brand"
                          >
                            הצגת בודקים
                          </button>
                          <button
                            type="button"
                            onClick={() => setView('lanes')}
                            className="text-[12px] font-semibold text-brand"
                          >
                            הצגת נתיבים
                          </button>
                        </div>
                      </div>
                      <CertMenu
                        name={c}
                        canDelete={deletable}
                        blockReason={
                          deletable
                            ? null
                            : `הסר תחילה מ־${usage.lanes} נתיבים ומ־${usage.workers} בודקים`
                        }
                        onDelete={() => setDeleteName(c)}
                      />
                    </div>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </SectionCard>

      <ConfirmDialog
        open={Boolean(deleteName)}
        title="מחיקת הסמכה"
        confirmLabel="מחיקה"
        danger
        onCancel={() => setDeleteName(null)}
        onConfirm={() => {
          if (!deleteName) return
          const usage = certUsage(deleteName, data.workers, data.lanes)
          if (!canDeleteCertification(usage)) return
          removeCertification(deleteName)
          setDeleteName(null)
          showToast('ההסמכה הוסרה מהקטלוג')
        }}
      >
        {deleteName ? (
          <p>
            למחוק את ההסמכה <strong>{deleteName}</strong> מהקטלוג? היא אינה
            בשימוש אצל בודקים או נתיבים.
          </p>
        ) : null}
      </ConfirmDialog>
    </div>
  )
}
