import { useState, type FormEvent } from 'react'
import { submitBugReportRemote } from '../api'
import { PublicPage } from '../components/PublicPage'
import { FieldLabel, SectionCard } from '../components/ui'
import { useApp } from '../context/AppContext'
import { notify } from '../lib/notify'

export function ReportPage() {
  const { user } = useApp()
  const [title, setTitle] = useState('')
  const [details, setDetails] = useState('')
  const [where, setWhere] = useState('')
  const [contactName, setContactName] = useState('')
  const [contactPhone, setContactPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await submitBugReportRemote({
        title,
        details,
        where,
        contactName: user ? user.fullName : contactName,
        contactPhone: user ? user.phone : contactPhone,
      })
      setSent(true)
      notify.success('הדיווח נשמר')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שליחת הדיווח נכשלה')
    } finally {
      setBusy(false)
    }
  }

  return (
    <PublicPage>
      <SectionCard
        title="דיווח תקלה"
        subtitle="תארו מה קרה. הדיווח נשמר עם השם והטלפון, כדי שאפשר יהיה לחזור אליכם."
      >
        {sent ? (
          <p className="text-sm leading-relaxed text-ink-soft">
            תודה. הדיווח התקבל. אם המייל בשרת מוגדר, עותק נשלח גם לשם.
          </p>
        ) : (
          <form onSubmit={(e) => void submit(e)} className="space-y-4">
            <div>
              <FieldLabel htmlFor="bug-title">כותרת</FieldLabel>
              <input
                id="bug-title"
                className="ui-field"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
                required
                disabled={busy}
              />
            </div>
            <div>
              <FieldLabel htmlFor="bug-where">איפה זה קרה</FieldLabel>
              <input
                id="bug-where"
                className="ui-field"
                value={where}
                onChange={(e) => setWhere(e.target.value)}
                placeholder="למשל מסך השיבוץ, אחרי לחיצה על שיבוץ אוטומטי"
                maxLength={200}
                disabled={busy}
              />
            </div>
            <div>
              <FieldLabel htmlFor="bug-details">מה קרה</FieldLabel>
              <textarea
                id="bug-details"
                className="ui-field min-h-32 resize-y"
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                maxLength={4000}
                required
                disabled={busy}
              />
            </div>
            {!user ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <FieldLabel htmlFor="bug-name">שם</FieldLabel>
                  <input
                    id="bug-name"
                    className="ui-field"
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    maxLength={80}
                    required
                    disabled={busy}
                  />
                </div>
                <div>
                  <FieldLabel htmlFor="bug-phone">טלפון</FieldLabel>
                  <input
                    id="bug-phone"
                    className="ui-field"
                    value={contactPhone}
                    onChange={(e) => setContactPhone(e.target.value)}
                    dir="ltr"
                    inputMode="tel"
                    maxLength={20}
                    required
                    disabled={busy}
                  />
                </div>
              </div>
            ) : null}
            {error ? (
              <p className="text-sm font-medium text-hard" role="alert">
                {error}
              </p>
            ) : null}
            <button
              type="submit"
              className="ui-btn ui-btn-primary disabled:opacity-40"
              disabled={busy}
            >
              {busy ? 'שולח…' : 'שליחת דיווח'}
            </button>
          </form>
        )}
      </SectionCard>
    </PublicPage>
  )
}
