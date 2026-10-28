import { useCallback, useEffect, useState } from 'react'
import { Loader2, Star } from 'lucide-react'
import { fetchWorkerHomeRemote, type WorkerHomeResponse } from '../api'
import { SectionCard } from '../components/ui'
import { notify } from '../lib/notify'

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
  const [home, setHome] = useState<WorkerHomeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [readIds, setReadIds] = useState<Set<string>>(() => loadReadIds())
  const [openAnswers, setOpenAnswers] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setHome(await fetchWorkerHomeRemote())
    } catch (e) {
      notify.error(e instanceof Error ? e.message : 'טעינת התדריכים נכשלה')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

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
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-ink-soft">
        <Loader2 className="size-5 animate-spin" aria-hidden />
        טוען תדריכים…
      </div>
    )
  }

  const briefings = home?.briefings || []
  const questions = home?.questions || []

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
                    read ? 'border-line/50 bg-surface/40' : 'border-line/80 bg-card'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-display text-base font-bold text-ink">
                      {section.starred ? (
                        <Star className="me-1 inline size-4 text-warn" aria-hidden />
                      ) : null}
                      {section.title}
                    </h3>
                    <button
                      type="button"
                      className="ui-btn ui-btn-ghost !px-2 !py-1 text-xs"
                      onClick={() => toggleRead(section.id)}
                    >
                      {read ? 'נקרא' : 'סמן כנקרא'}
                    </button>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">
                    {section.body}
                  </p>
                </article>
              )
            })}
          </div>
        )}
      </SectionCard>

      {questions.length > 0 ? (
        <SectionCard
          title="בנק שאלות"
          subtitle="אפשר לפתוח תשובה לתרגול. התשובות מיועדות לתדרוך."
        >
          <div className="space-y-3">
            {questions.map((q) => {
              const open = openAnswers.has(q.id)
              return (
                <div key={q.id} className="rounded-xl border border-line/70 p-3">
                  <p className="text-sm font-semibold text-ink">{q.prompt}</p>
                  <button
                    type="button"
                    className="ui-btn ui-btn-ghost mt-2 !px-2 !py-1 text-xs"
                    onClick={() =>
                      setOpenAnswers((prev) => {
                        const next = new Set(prev)
                        if (next.has(q.id)) next.delete(q.id)
                        else next.add(q.id)
                        return next
                      })
                    }
                  >
                    {open ? 'הסתר תשובה' : 'הצג תשובה'}
                  </button>
                  {open ? (
                    <p className="mt-2 whitespace-pre-wrap text-sm text-ink-soft">
                      {q.answer}
                    </p>
                  ) : null}
                </div>
              )
            })}
          </div>
        </SectionCard>
      ) : null}
    </div>
  )
}
