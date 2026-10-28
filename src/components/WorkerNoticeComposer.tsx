import { useState } from 'react'
import { BellRing, Mail } from 'lucide-react'
import { createWorkerNoticeRemote } from '../api'
import { SectionCard } from './ui'
import { notify } from '../lib/notify'

/** Manager UI: broadcast a notice to the worker portal bell. */
export function WorkerNoticeComposer({
  compact = false,
}: {
  compact?: boolean
}) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)

  const send = async () => {
    const t = title.trim()
    const b = body.trim()
    if (t.length < 2 || b.length < 2) {
      notify.warning('נא למלא כותרת ותוכן להודעה')
      return
    }
    setBusy(true)
    try {
      await createWorkerNoticeRemote({ title: t, body: b })
      setTitle('')
      setBody('')
      notify.success('ההודעה נשלחה להתראות העובדים')
    } catch (e) {
      notify.error(e instanceof Error ? e.message : 'שליחת ההודעה נכשלה')
    } finally {
      setBusy(false)
    }
  }

  return (
    <SectionCard
      title="הודעה להתראות העובדים"
      subtitle="תופיע בפעמון בפורטל העובדים של המודול הנוכחי (בודקים או סלקטורים)."
    >
      <div className={`space-y-3 ${compact ? '' : ''}`}>
        <p className="flex items-start gap-2 text-[13px] text-ink-soft">
          <BellRing className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
          עובדים עם גישת התחברות יראו את ההודעה במרכז ההתראות.
        </p>
        <label className="block text-sm">
          <span className="text-ink-soft">כותרת</span>
          <input
            className="ui-field mt-1"
            value={title}
            maxLength={120}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="לדוגמה: עדכון למשמרת הערב"
          />
        </label>
        <label className="block text-sm">
          <span className="text-ink-soft">תוכן</span>
          <textarea
            className="ui-field mt-1 min-h-24 resize-y"
            value={body}
            maxLength={2000}
            onChange={(e) => setBody(e.target.value)}
            placeholder="הודעה קצרה שתוצג לעובדים"
          />
        </label>
        <button
          type="button"
          className="ui-btn ui-btn-primary"
          disabled={busy}
          onClick={() => void send()}
        >
          <Mail className="size-4" aria-hidden />
          {busy ? 'שולח…' : 'שליחה להתראות העובדים'}
        </button>
      </div>
    </SectionCard>
  )
}
