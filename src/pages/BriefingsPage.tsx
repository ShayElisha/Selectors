import { useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronUp,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import { useApp } from '../context/AppContext'
import { notify } from '../lib/notify'
import {
  sortBriefingSections,
  sortQuestionBank,
} from '../lib/briefings'
import {
  EmptyState,
  FieldError,
  FieldLabel,
  SectionCard,
} from '../components/ui'
import type { InspectorQuestion } from '../types'

type Tab = 'briefing' | 'questions'

export function BriefingsPage() {
  const {
    data,
    upsertBriefingSection,
    deleteBriefingSection,
    reorderBriefingSections,
    upsertInspectorQuestion,
    deleteInspectorQuestion,
    reorderInspectorQuestions,
  } = useApp()

  const [tab, setTab] = useState<Tab>('briefing')
  const [editingSectionId, setEditingSectionId] = useState<string | null>(null)
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(
    null,
  )
  const [addingSection, setAddingSection] = useState(false)
  const [addingQuestion, setAddingQuestion] = useState(false)
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})

  const sections = useMemo(
    () => sortBriefingSections(data.briefingSections ?? []),
    [data.briefingSections],
  )
  const questions = useMemo(
    () => sortQuestionBank(data.questionBank ?? []),
    [data.questionBank],
  )

  const moveSection = (id: string, dir: -1 | 1) => {
    const ids = sections.map((s) => s.id)
    const i = ids.indexOf(id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j]!, ids[i]!]
    reorderBriefingSections(ids)
  }

  const moveQuestion = (id: string, dir: -1 | 1) => {
    const ids = questions.map((q) => q.id)
    const i = ids.indexOf(id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j]!, ids[i]!]
    reorderInspectorQuestions(ids)
  }

  const switchTab = (next: Tab) => {
    setTab(next)
    setAddingSection(false)
    setAddingQuestion(false)
    setEditingSectionId(null)
    setEditingQuestionId(null)
  }

  return (
    <div className="space-y-4">
      <SectionCard
        title="תדריכים"
        subtitle="סעיפי תדריך ושאלות לבודקים — כל המנהלים עורכים יחד"
        actions={
          tab === 'briefing' ? (
            <button
              type="button"
              onClick={() => {
                setAddingSection(true)
                setEditingSectionId(null)
              }}
              className="ui-btn ui-btn-primary !px-2.5 !py-1.5 text-xs sm:!px-3 sm:!py-2 sm:text-sm"
            >
              <Plus className="size-4" aria-hidden />
              הוספה
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setAddingQuestion(true)
                setEditingQuestionId(null)
              }}
              className="ui-btn ui-btn-primary !px-2.5 !py-1.5 text-xs sm:!px-3 sm:!py-2 sm:text-sm"
            >
              <Plus className="size-4" aria-hidden />
              הוספה
            </button>
          )
        }
      >
        <div
          className="mb-4 flex gap-1 rounded-xl bg-surface p-1 ring-1 ring-line"
          role="tablist"
          aria-label="תדריך או שאלות"
        >
          {(
            [
              {
                id: 'briefing' as const,
                label: `תדריך (${sections.length})`,
              },
              {
                id: 'questions' as const,
                label: `שאלות (${questions.length})`,
              },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => switchTab(t.id)}
              className={`min-h-10 flex-1 rounded-lg px-3 text-[13px] font-semibold tabular-nums focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ${
                tab === t.id
                  ? 'bg-card text-ink shadow-sm ring-1 ring-line'
                  : 'text-ink-soft hover:text-ink'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'briefing' ? (
          <>
            {addingSection ? (
              <div className="mb-4">
                <SectionEditor
                  onCancel={() => setAddingSection(false)}
                  onSave={(title, body) => {
                    upsertBriefingSection({ title, body })
                    setAddingSection(false)
                    notify.success('הסעיף נוסף')
                  }}
                />
              </div>
            ) : null}

            {sections.length === 0 && !addingSection ? (
              <EmptyState
                title="אין סעיפי תדריך"
                text="לחצו הוספה והכניסו את הדגשים לפתיחת משמרת."
                action={
                  <button
                    type="button"
                    className="ui-btn ui-btn-primary"
                    onClick={() => setAddingSection(true)}
                  >
                    <Plus className="size-4" aria-hidden />
                    הוספת סעיף
                  </button>
                }
              />
            ) : (
              <ul className="divide-y divide-line/80">
                {sections.map((s, idx) => (
                  <li
                    key={s.id}
                    className="py-3 first:pt-0 last:pb-0 sm:py-3.5"
                  >
                    {editingSectionId === s.id ? (
                      <SectionEditor
                        initialTitle={s.title}
                        initialBody={s.body}
                        onCancel={() => setEditingSectionId(null)}
                        onSave={(title, body) => {
                          upsertBriefingSection({ id: s.id, title, body })
                          setEditingSectionId(null)
                          notify.success('הסעיף עודכן')
                        }}
                      />
                    ) : (
                      <div className="flex gap-3">
                        <span className="mt-0.5 w-6 shrink-0 text-center text-sm font-bold tabular-nums text-ink-soft">
                          {idx + 1}.
                        </span>
                        <div className="min-w-0 flex-1">
                          <h3 className="font-display text-[15px] font-bold text-ink sm:text-base">
                            {s.title}
                          </h3>
                          {s.body ? (
                            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-ink-soft">
                              {s.body}
                            </p>
                          ) : null}
                          {s.updatedBy ? (
                            <p className="mt-1.5 text-[11px] text-ink-soft/70">
                              עודכן ע״י {s.updatedBy}
                            </p>
                          ) : null}
                        </div>
                        <ItemActions
                          onUp={() => moveSection(s.id, -1)}
                          onDown={() => moveSection(s.id, 1)}
                          canUp={idx > 0}
                          canDown={idx < sections.length - 1}
                          onEdit={() => {
                            setEditingSectionId(s.id)
                            setAddingSection(false)
                          }}
                          onDelete={() => {
                            deleteBriefingSection(s.id)
                            notify.success('הסעיף נמחק')
                          }}
                        />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <>
            {addingQuestion ? (
              <div className="mb-4">
                <QuestionEditor
                  onCancel={() => setAddingQuestion(false)}
                  onSave={(payload) => {
                    upsertInspectorQuestion(payload)
                    setAddingQuestion(false)
                    notify.success('השאלה נוספה')
                  }}
                />
              </div>
            ) : null}

            {questions.length === 0 && !addingQuestion ? (
              <EmptyState
                title="אין שאלות"
                text="הוסיפו שאלה ותשובה מילולית קצרה."
                action={
                  <button
                    type="button"
                    className="ui-btn ui-btn-primary"
                    onClick={() => setAddingQuestion(true)}
                  >
                    <Plus className="size-4" aria-hidden />
                    הוספת שאלה
                  </button>
                }
              />
            ) : (
              <ul className="space-y-3">
                {questions.map((q, idx) => (
                  <li key={q.id}>
                    {editingQuestionId === q.id ? (
                      <QuestionEditor
                        initial={q}
                        onCancel={() => setEditingQuestionId(null)}
                        onSave={(payload) => {
                          upsertInspectorQuestion({ ...payload, id: q.id })
                          setEditingQuestionId(null)
                          notify.success('השאלה עודכנה')
                        }}
                      />
                    ) : (
                      <QuestionRow
                        question={q}
                        index={idx}
                        open={Boolean(revealed[q.id])}
                        onToggle={() =>
                          setRevealed((prev) => ({
                            ...prev,
                            [q.id]: !prev[q.id],
                          }))
                        }
                        onUp={() => moveQuestion(q.id, -1)}
                        onDown={() => moveQuestion(q.id, 1)}
                        canUp={idx > 0}
                        canDown={idx < questions.length - 1}
                        onEdit={() => {
                          setEditingQuestionId(q.id)
                          setAddingQuestion(false)
                        }}
                        onDelete={() => {
                          deleteInspectorQuestion(q.id)
                          notify.success('השאלה נמחקה')
                        }}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </SectionCard>
    </div>
  )
}

function ItemActions({
  onUp,
  onDown,
  canUp,
  canDown,
  onEdit,
  onDelete,
}: {
  onUp: () => void
  onDown: () => void
  canUp: boolean
  canDown: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className="flex shrink-0 items-start gap-0.5">
      <IconBtn label="העלה" disabled={!canUp} onClick={onUp}>
        <ChevronUp className="size-3.5" />
      </IconBtn>
      <IconBtn label="הורד" disabled={!canDown} onClick={onDown}>
        <ChevronDown className="size-3.5" />
      </IconBtn>
      <IconBtn label="ערוך" onClick={onEdit}>
        <Pencil className="size-3.5" />
      </IconBtn>
      <IconBtn label="מחק" danger onClick={onDelete}>
        <Trash2 className="size-3.5" />
      </IconBtn>
    </div>
  )
}

function IconBtn({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex size-7 items-center justify-center rounded-lg text-ink-soft transition hover:bg-surface hover:text-ink disabled:opacity-30 ${
        danger ? 'hover:bg-hard-soft hover:text-hard' : ''
      }`}
    >
      {children}
    </button>
  )
}

function SectionEditor({
  initialTitle = '',
  initialBody = '',
  onSave,
  onCancel,
}: {
  initialTitle?: string
  initialBody?: string
  onSave: (title: string, body: string) => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState(initialTitle)
  const [body, setBody] = useState(initialBody)
  const [touched, setTouched] = useState(false)
  const err = touched && !title.trim() ? 'נא להזין כותרת' : null

  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface/60 p-3 sm:p-4">
      <div>
        <FieldLabel htmlFor="brief-title">כותרת</FieldLabel>
        <input
          id="brief-title"
          className="ui-field bg-card"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="למשל: בטיחות בעמדות"
          autoFocus
        />
        <FieldError message={err} />
      </div>
      <div>
        <FieldLabel htmlFor="brief-body">תוכן</FieldLabel>
        <textarea
          id="brief-body"
          className="ui-field min-h-[5.5rem] bg-card"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="נקודות לתדריך…"
          rows={3}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="ui-btn ui-btn-primary"
          onClick={() => {
            setTouched(true)
            if (!title.trim()) return
            onSave(title.trim(), body.trim())
          }}
        >
          שמירה
        </button>
        <button type="button" className="ui-btn ui-btn-ghost" onClick={onCancel}>
          ביטול
        </button>
      </div>
    </div>
  )
}

function QuestionEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial?: InspectorQuestion
  onSave: (payload: { prompt: string; answer: string }) => void
  onCancel: () => void
}) {
  const [prompt, setPrompt] = useState(initial?.prompt ?? '')
  const [answer, setAnswer] = useState(initial?.answer ?? '')
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface/60 p-3 sm:p-4">
      <div>
        <FieldLabel htmlFor="q-prompt">שאלה</FieldLabel>
        <textarea
          id="q-prompt"
          className="ui-field min-h-[3.5rem] bg-card"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={2}
          autoFocus
        />
      </div>
      <div>
        <FieldLabel htmlFor="q-answer">תשובה מילולית</FieldLabel>
        <textarea
          id="q-answer"
          className="ui-field min-h-[5rem] bg-card"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          rows={3}
          placeholder="התשובה שצריך לדעת / לומר"
        />
      </div>
      <FieldError message={error} />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="ui-btn ui-btn-primary"
          onClick={() => {
            if (!prompt.trim()) {
              setError('נא להזין שאלה')
              return
            }
            if (!answer.trim()) {
              setError('נא להזין תשובה')
              return
            }
            onSave({ prompt: prompt.trim(), answer: answer.trim() })
          }}
        >
          שמירה
        </button>
        <button type="button" className="ui-btn ui-btn-ghost" onClick={onCancel}>
          ביטול
        </button>
      </div>
    </div>
  )
}

function QuestionRow({
  question,
  index,
  open,
  onToggle,
  onUp,
  onDown,
  canUp,
  canDown,
  onEdit,
  onDelete,
}: {
  question: InspectorQuestion
  index: number
  open: boolean
  onToggle: () => void
  onUp: () => void
  onDown: () => void
  canUp: boolean
  canDown: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className="rounded-xl border border-line/80 bg-surface/40 p-3 sm:p-3.5">
      <div className="flex gap-2">
        <span className="mt-0.5 w-5 shrink-0 text-sm font-bold tabular-nums text-ink-soft">
          {index + 1}.
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-ink">{question.prompt}</p>
          {open ? (
            <p className="mt-2 whitespace-pre-wrap rounded-lg border border-ok/25 bg-ok-soft/60 px-3 py-2 text-sm leading-relaxed text-ink">
              {question.answer}
            </p>
          ) : (
            <button
              type="button"
              onClick={onToggle}
              className="mt-2 text-sm font-semibold text-brand hover:text-brand-deep"
            >
              הצג תשובה
            </button>
          )}
          {open ? (
            <button
              type="button"
              onClick={onToggle}
              className="mt-1.5 text-xs font-medium text-ink-soft hover:text-ink"
            >
              הסתר תשובה
            </button>
          ) : null}
        </div>
        <ItemActions
          onUp={onUp}
          onDown={onDown}
          canUp={canUp}
          canDown={canDown}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      </div>
    </div>
  )
}
