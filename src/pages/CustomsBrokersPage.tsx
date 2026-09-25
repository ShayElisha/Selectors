import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  Building2,
  Pencil,
  Phone,
  Plus,
  Search,
  Trash2,
  User,
  X,
} from 'lucide-react'
import { createPortal } from 'react-dom'
import { FieldError, FieldLabel, Ltr, SectionCard } from '../components/ui'
import { useApp } from '../context/AppContext'
import {
  filterCustomsBrokers,
  formatBrokerPhone,
  groupBrokersByInitial,
  HEBREW_ALPHABET,
  brokerInitial,
  normalizeBrokerPhoneDigits,
} from '../lib/customsBrokers'
import { pluralizeHe } from '../lib/hebrew'
import { notify } from '../lib/notify'
import type { CustomsBroker, CustomsBrokerContact } from '../types'

const PAGE_SIZE = 40

type BrokerModal =
  | { mode: 'add' }
  | { mode: 'edit'; broker: CustomsBroker }
  | null

type ContactModal =
  | { mode: 'add'; broker: CustomsBroker }
  | { mode: 'edit'; broker: CustomsBroker; contact: CustomsBrokerContact }
  | null

function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  children: React.ReactNode
  confirmLabel: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const titleId = useId()
  if (!open) return null
  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-end justify-center bg-ink/40 p-3 sm:items-center"
      role="presentation"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md overflow-hidden rounded-2xl border border-line bg-card p-4 shadow-[var(--shadow-panel-hover)] sm:p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id={titleId} className="font-display text-lg font-bold text-ink">
          {title}
        </h3>
        <div className="mt-2 text-sm text-ink-soft">{children}</div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            className="ui-btn ui-btn-ghost w-full min-w-0"
            onClick={onCancel}
          >
            ביטול
          </button>
          <button
            type="button"
            className="ui-btn ui-btn-primary w-full min-w-0 !bg-hard hover:!bg-hard"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function BrokerFormModal({
  state,
  onClose,
  onSave,
}: {
  state: Exclude<BrokerModal, null>
  onClose: () => void
  onSave: (name: string) => void
}) {
  const [name, setName] = useState(
    state.mode === 'edit' ? state.broker.name : '',
  )
  const [error, setError] = useState<string | null>(null)
  const titleId = useId()
  const inputRef = useRef<HTMLInputElement>(null)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError('נא להזין שם חברה')
      return
    }
    onSave(trimmed)
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-end justify-center bg-ink/40 p-3 sm:items-center"
      role="presentation"
      onClick={onClose}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md overflow-hidden rounded-2xl border border-line bg-card p-4 shadow-[var(--shadow-panel-hover)] sm:p-5"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <h3 id={titleId} className="font-display text-lg font-bold text-ink">
            {state.mode === 'edit' ? 'עריכת חברה' : 'הוספת חברת עמילות מכס'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-ink-soft hover:bg-surface"
            aria-label="סגור"
          >
            <X className="size-4" />
          </button>
        </div>
        <FieldLabel htmlFor="broker-name">שם החברה</FieldLabel>
        <input
          ref={inputRef}
          id="broker-name"
          className="ui-field mt-1 w-full"
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            setError(null)
          }}
          autoFocus
        />
        {error ? <FieldError message={error} /> : null}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            className="ui-btn ui-btn-ghost w-full min-w-0"
            onClick={onClose}
          >
            ביטול
          </button>
          <button type="submit" className="ui-btn ui-btn-primary w-full min-w-0">
            שמירה
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}

function ContactFormModal({
  state,
  onClose,
  onSave,
}: {
  state: Exclude<ContactModal, null>
  onClose: () => void
  onSave: (name: string, phone: string) => void
}) {
  const [name, setName] = useState(
    state.mode === 'edit' ? state.contact.name : '',
  )
  const [phone, setPhone] = useState(
    state.mode === 'edit' ? state.contact.phone : '',
  )
  const [error, setError] = useState<string | null>(null)
  const titleId = useId()

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const digits = normalizeBrokerPhoneDigits(phone)
    if (!digits) {
      setError('נא להזין מספר טלפון תקין')
      return
    }
    onSave(name.trim(), formatBrokerPhone(digits))
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-end justify-center bg-ink/40 p-3 sm:items-center"
      role="presentation"
      onClick={onClose}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md overflow-hidden rounded-2xl border border-line bg-card p-4 shadow-[var(--shadow-panel-hover)] sm:p-5"
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <div className="mb-3 flex items-start justify-between gap-2">
          <div>
            <h3 id={titleId} className="font-display text-lg font-bold text-ink">
              {state.mode === 'edit' ? 'עריכת איש קשר' : 'הוספת איש קשר'}
            </h3>
            <p className="mt-0.5 text-[13px] text-ink-soft">{state.broker.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-ink-soft hover:bg-surface"
            aria-label="סגור"
          >
            <X className="size-4" />
          </button>
        </div>
        <FieldLabel htmlFor="contact-name">שם (אופציונלי)</FieldLabel>
        <input
          id="contact-name"
          className="ui-field mt-1 w-full"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="למשל: מוטי / משרד"
        />
        <div className="mt-3">
          <FieldLabel htmlFor="contact-phone">טלפון</FieldLabel>
          <input
            id="contact-phone"
            className="ui-field mt-1 w-full"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value)
              setError(null)
            }}
            inputMode="tel"
            dir="ltr"
            autoFocus
          />
        </div>
        {error ? <FieldError message={error} /> : null}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            className="ui-btn ui-btn-ghost w-full min-w-0"
            onClick={onClose}
          >
            ביטול
          </button>
          <button type="submit" className="ui-btn ui-btn-primary w-full min-w-0">
            שמירה
          </button>
        </div>
      </form>
    </div>,
    document.body,
  )
}

export function CustomsBrokersPage() {
  const {
    data,
    upsertCustomsBroker,
    deleteCustomsBroker,
    upsertCustomsBrokerContact,
    deleteCustomsBrokerContact,
  } = useApp()

  const [query, setQuery] = useState('')
  const [letter, setLetter] = useState<string | null>(null)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const [brokerModal, setBrokerModal] = useState<BrokerModal>(null)
  const [contactModal, setContactModal] = useState<ContactModal>(null)
  const [deleteTarget, setDeleteTarget] = useState<
    | { kind: 'broker'; broker: CustomsBroker }
    | { kind: 'contact'; broker: CustomsBroker; contact: CustomsBrokerContact }
    | null
  >(null)

  const brokers = data.customsBrokers ?? []
  const searched = useMemo(
    () => filterCustomsBrokers(brokers, query),
    [brokers, query],
  )
  const availableLetters = useMemo(() => {
    const set = new Set(searched.map((b) => brokerInitial(b.name)))
    return set
  }, [searched])
  const filtered = useMemo(() => {
    if (!letter) return searched
    return searched.filter((b) => brokerInitial(b.name) === letter)
  }, [searched, letter])

  useEffect(() => {
    setVisibleCount(PAGE_SIZE)
  }, [query, letter])

  const visibleBrokers = useMemo(
    () => filtered.slice(0, visibleCount),
    [filtered, visibleCount],
  )
  const groups = useMemo(
    () => groupBrokersByInitial(visibleBrokers),
    [visibleBrokers],
  )
  const contactCount = useMemo(
    () => filtered.reduce((n, b) => n + b.contacts.length, 0),
    [filtered],
  )
  const hasMore = visibleCount < filtered.length

  return (
    <div className="space-y-4 overflow-x-hidden pb-8">
      <SectionCard
        title="עמילי מכס"
        subtitle="חברות עמילות מכס ואנשי קשר — לחיצה על מספר מתקשרת"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[13px] font-semibold text-ink-soft tabular-nums">
              {pluralizeHe(filtered.length, {
                one: 'חברה אחת',
                two: 'שתי חברות',
                many: 'חברות',
              })}
              {' · '}
              {pluralizeHe(contactCount, {
                one: 'איש קשר אחד',
                two: 'שני אנשי קשר',
                many: 'אנשי קשר',
              })}
            </p>
            <button
              type="button"
              className="ui-btn ui-btn-primary !py-1.5 text-xs"
              onClick={() => setBrokerModal({ mode: 'add' })}
            >
              <Plus className="size-3.5" aria-hidden />
              הוספת חברה
            </button>
          </div>
        }
      >
        <div className="relative">
          <Search
            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-ink-soft"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setLetter(null)
            }}
            placeholder="חיפוש לפי חברה, שם או טלפון"
            aria-label="חיפוש עמילי מכס"
            className="ui-field w-full pe-3 ps-10"
          />
        </div>
        <div
          className="mt-3 flex flex-wrap gap-1"
          role="toolbar"
          aria-label="סינון לפי אות"
        >
          <button
            type="button"
            onClick={() => setLetter(null)}
            aria-pressed={letter === null}
            className={`min-w-8 rounded-lg px-2 py-1.5 text-[12px] font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
              letter === null
                ? 'bg-brand text-white'
                : 'bg-surface text-ink-soft ring-1 ring-line hover:bg-brand/10 hover:text-brand'
            }`}
          >
            הכל
          </button>
          {HEBREW_ALPHABET.map((ch) => {
            const has = availableLetters.has(ch)
            const active = letter === ch
            return (
              <button
                key={ch}
                type="button"
                disabled={!has}
                onClick={() => setLetter(ch)}
                aria-pressed={active}
                title={has ? `חברות באות ${ch}` : `אין חברות באות ${ch}`}
                className={`size-8 rounded-lg text-[13px] font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-default disabled:opacity-30 ${
                  active
                    ? 'bg-brand text-white'
                    : has
                      ? 'bg-surface text-ink ring-1 ring-line hover:bg-brand/10 hover:text-brand'
                      : 'bg-surface text-ink-soft ring-1 ring-line'
                }`}
              >
                {ch}
              </button>
            )
          })}
          {availableLetters.has('#') ? (
            <button
              type="button"
              onClick={() => setLetter('#')}
              aria-pressed={letter === '#'}
              className={`min-w-8 rounded-lg px-2 py-1.5 text-[12px] font-bold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                letter === '#'
                  ? 'bg-brand text-white'
                  : 'bg-surface text-ink-soft ring-1 ring-line hover:bg-brand/10 hover:text-brand'
              }`}
            >
              #
            </button>
          ) : null}
        </div>
      </SectionCard>

      {filtered.length === 0 ? (
        <div className="ui-empty">
          <p className="ui-empty-title">לא נמצאו תוצאות</p>
          <p className="ui-empty-text">
            {query.trim() || letter
              ? 'נסו אות אחרת, שם חברה או מספר טלפון.'
              : 'הוסיפו חברת עמילות מכס להתחלה.'}
          </p>
          {!query.trim() && !letter ? (
            <button
              type="button"
              className="ui-btn ui-btn-primary mt-2"
              onClick={() => setBrokerModal({ mode: 'add' })}
            >
              הוספת חברה
            </button>
          ) : (
            <button
              type="button"
              className="ui-btn ui-btn-secondary mt-2"
              onClick={() => {
                setQuery('')
                setLetter(null)
              }}
            >
              נקה סינון
            </button>
          )}
        </div>
      ) : (
        <div className="min-w-0 space-y-4">
          {groups.map(({ initial, brokers: list }) => (
            <section key={initial} className="min-w-0 space-y-2">
              <h2 className="sticky top-0 z-10 bg-surface/95 py-1.5 text-sm font-bold text-brand backdrop-blur-sm">
                {initial}
              </h2>
              <ul className="grid min-w-0 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {list.map((broker) => (
                  <li
                    key={broker.id}
                    className="min-w-0 overflow-hidden rounded-2xl border border-line bg-card p-3 shadow-sm sm:p-3.5"
                  >
                    <div className="mb-2 flex min-w-0 items-start gap-2">
                      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand">
                        <Building2 className="size-4" aria-hidden />
                      </span>
                      <h3 className="min-w-0 flex-1 truncate text-[15px] font-bold leading-snug text-ink">
                        {broker.name}
                      </h3>
                      <div className="flex shrink-0 gap-0.5">
                        <button
                          type="button"
                          className="rounded-lg p-1.5 text-ink-soft hover:bg-surface hover:text-brand"
                          title="עריכת חברה"
                          aria-label={`עריכת ${broker.name}`}
                          onClick={() =>
                            setBrokerModal({ mode: 'edit', broker })
                          }
                        >
                          <Pencil className="size-3.5" aria-hidden />
                        </button>
                        <button
                          type="button"
                          className="rounded-lg p-1.5 text-ink-soft hover:bg-hard-soft hover:text-hard"
                          title="מחיקת חברה"
                          aria-label={`מחיקת ${broker.name}`}
                          onClick={() =>
                            setDeleteTarget({ kind: 'broker', broker })
                          }
                        >
                          <Trash2 className="size-3.5" aria-hidden />
                        </button>
                      </div>
                    </div>
                    <ul className="min-w-0 space-y-1.5">
                      {broker.contacts.map((c) => (
                        <li
                          key={c.id}
                          className="group flex min-w-0 items-center gap-1"
                        >
                          <a
                            href={`tel:${c.phoneDigits}`}
                            className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden rounded-xl border border-transparent px-2 py-1.5 transition hover:border-brand/30 hover:bg-brand/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                          >
                            <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface text-ink-soft ring-1 ring-line">
                              {c.name ? (
                                <User className="size-3.5" aria-hidden />
                              ) : (
                                <Phone className="size-3.5" aria-hidden />
                              )}
                            </span>
                            <span className="min-w-0 flex-1 overflow-hidden">
                              {c.name ? (
                                <span className="block truncate text-[13px] font-semibold text-ink">
                                  {c.name}
                                </span>
                              ) : null}
                              <Ltr className="block truncate text-[13px] font-medium text-brand tabular-nums">
                                {c.phone}
                              </Ltr>
                            </span>
                            <Phone
                              className="size-3.5 shrink-0 text-brand/70"
                              aria-hidden
                            />
                            <span className="sr-only">התקשר</span>
                          </a>
                          <button
                            type="button"
                            className="shrink-0 rounded-lg p-1.5 text-ink-soft opacity-70 hover:bg-surface hover:text-brand sm:opacity-0 sm:group-hover:opacity-100"
                            title="עריכת איש קשר"
                            aria-label={`עריכת איש קשר ${c.name || c.phone}`}
                            onClick={() =>
                              setContactModal({
                                mode: 'edit',
                                broker,
                                contact: c,
                              })
                            }
                          >
                            <Pencil className="size-3.5" aria-hidden />
                          </button>
                          <button
                            type="button"
                            className="shrink-0 rounded-lg p-1.5 text-ink-soft opacity-70 hover:bg-hard-soft hover:text-hard sm:opacity-0 sm:group-hover:opacity-100"
                            title="מחיקת איש קשר"
                            aria-label={`מחיקת איש קשר ${c.name || c.phone}`}
                            onClick={() =>
                              setDeleteTarget({
                                kind: 'contact',
                                broker,
                                contact: c,
                              })
                            }
                          >
                            <Trash2 className="size-3.5" aria-hidden />
                          </button>
                        </li>
                      ))}
                    </ul>
                    <button
                      type="button"
                      className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-line px-2 py-1.5 text-[12px] font-semibold text-ink-soft transition hover:border-brand/40 hover:bg-brand/5 hover:text-brand"
                      onClick={() =>
                        setContactModal({ mode: 'add', broker })
                      }
                    >
                      <Plus className="size-3.5" aria-hidden />
                      הוספת איש קשר
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {hasMore ? (
            <div className="flex justify-center pt-1">
              <button
                type="button"
                className="ui-btn ui-btn-secondary"
                onClick={() =>
                  setVisibleCount((n) => n + PAGE_SIZE)
                }
              >
                הצג עוד ({filtered.length - visibleCount} נותרו)
              </button>
            </div>
          ) : null}
        </div>
      )}

      {brokerModal ? (
        <BrokerFormModal
          state={brokerModal}
          onClose={() => setBrokerModal(null)}
          onSave={(name) => {
            if (brokerModal.mode === 'edit') {
              upsertCustomsBroker({ id: brokerModal.broker.id, name })
              notify.success('החברה עודכנה')
            } else {
              upsertCustomsBroker({ name })
              notify.success('החברה נוספה')
            }
            setBrokerModal(null)
          }}
        />
      ) : null}

      {contactModal ? (
        <ContactFormModal
          state={contactModal}
          onClose={() => setContactModal(null)}
          onSave={(name, phone) => {
            if (contactModal.mode === 'edit') {
              upsertCustomsBrokerContact(contactModal.broker.id, {
                id: contactModal.contact.id,
                name,
                phone,
              })
              notify.success('איש הקשר עודכן')
            } else {
              upsertCustomsBrokerContact(contactModal.broker.id, {
                name,
                phone,
              })
              notify.success('איש הקשר נוסף')
            }
            setContactModal(null)
          }}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        title={
          deleteTarget?.kind === 'broker' ? 'מחיקת חברה' : 'מחיקת איש קשר'
        }
        confirmLabel="מחיקה"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (!deleteTarget) return
          if (deleteTarget.kind === 'broker') {
            deleteCustomsBroker(deleteTarget.broker.id)
            notify.success('החברה נמחקה')
          } else {
            deleteCustomsBrokerContact(
              deleteTarget.broker.id,
              deleteTarget.contact.id,
            )
            notify.success('איש הקשר נמחק')
          }
          setDeleteTarget(null)
        }}
      >
        {deleteTarget?.kind === 'broker' ? (
          <p>
            למחוק את «{deleteTarget.broker.name}» ואת כל אנשי הקשר שלה?
          </p>
        ) : deleteTarget?.kind === 'contact' ? (
          <p>
            למחוק את{' '}
            {deleteTarget.contact.name || deleteTarget.contact.phone} מ«
            {deleteTarget.broker.name}»?
          </p>
        ) : null}
      </ConfirmDialog>
    </div>
  )
}
