import { useState } from 'react'
import { Star } from 'lucide-react'
import { PageLoader } from '../components/PageLoader'
import { SectionCard } from '../components/ui'
import { useWorkerPortal } from '../context/WorkerPortalContext'

const READ_KEY = 'shibutzon-worker-briefing-read'

function loadReadIds(): Set<string> {
  try {
    const raw = localStorage.getItem(READ_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as string[]
    return new Set(Array.isArray(parsed) ? parsed.map(String) : [])
  } catch {
    return new Set()
  }
}

function saveReadIds(ids: Set<string>) {
  localStorage.setItem(READ_KEY, JSON.stringify([...ids]))
}

export function WorkerBriefingsPage() {
  const { home, loading, error, refreshHome } = useWorkerPortal()
  const [readIds, setReadIds] = useState<Set<string>>(() => loadReadIds())
  const [openAnswers, setOpenAnswers] = useState<Set<string>>(new Set())

  const toggleRead = (id: string) => {
    setReadIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      saveReadIds(next)
      return next
    })
  }

  if (loading && !home) {
    return <PageLoader label="טוען נתונים…" />
  }

  if (!home) {
    return (
      <SectionCard title="תדריכים" subtitle={error || 'לא ניתן לטעון נתונים כרגע.'}>
        <button
          type="button"
          className="ui-btn ui-btn-primary"
          onClick={() => void refreshHome()}
        >
          נסו שוב
        </button>
      </SectionCard>
    )
  }

  const briefings = home.briefings || []
  const questions = home.questions || []

  return (
    <div className="space-y-4">
      <SectionCard
        title="תדריכים"
        subtitle="לקריאה בלבד. סמנו סעיף כ«נקרא» אחרי שעברתם עליו."
      >
        {briefings.length === 0 ? (
          <p className="text-sm text-ink-soft">אין סעיפי תדריך כרגע.</p>
        ) : (
          <div className="space-y-3">
            {briefings.map((section) => {
              const read = readIds.has(section.id)
              return (
                <article
                  key={section.id}
                  className={`rounded-xl border p-3 ${
                    read
                      ? 'border-line/60 bg-surface/30 opacity-80'
                      : 'border-line/80 bg-card'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-1.5 font-semibold text-ink">
                        {section.starred ? (
                          <Star
                            className="size-3.5 fill-brand text-brand"
                            aria-label="חשוב"
                          />
                        ) : null}
                        {section.title}
                      </p>
                      <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">
                        {section.body}
                      </p>
                    </div>
                    <button
                      type="button"
                      className={`ui-btn shrink-0 !px-2.5 !py-1.5 text-xs ${
                        read ? 'ui-btn-ghost' : 'ui-btn-secondary'
                      }`}
                      onClick={() => toggleRead(section.id)}
                    >
                      {read ? 'נקרא' : 'סמן כנקרא'}
                    </button>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </SectionCard>

      {questions.length > 0 ? (
        <SectionCard title="שאלות נפוצות" subtitle="לחצו לפתיחת התשובה.">
          <ul className="space-y-2">
            {questions.map((q) => {
              const open = openAnswers.has(q.id)
              return (
                <li key={q.id}>
                  <button
                    type="button"
                    className="w-full rounded-xl border border-line/70 bg-surface/40 px-3 py-2.5 text-start"
                    aria-expanded={open}
                    onClick={() =>
                      setOpenAnswers((prev) => {
                        const next = new Set(prev)
                        if (next.has(q.id)) next.delete(q.id)
                        else next.add(q.id)
                        return next
                      })
                    }
                  >
                    <p className="font-semibold text-ink">{q.prompt}</p>
                    {open ? (
                      <p className="mt-1.5 whitespace-pre-wrap text-sm text-ink-soft">
                        {q.answer}
                      </p>
                    ) : null}
                  </button>
                </li>
              )
            })}
          </ul>
        </SectionCard>
      ) : null}
    </div>
  )
}
