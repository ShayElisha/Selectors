import { useEffect, useRef, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import { notify } from '../lib/notify'
import { SectionCard } from '../components/ui'
import type { AssignmentMode, AssignmentModes } from '../lib/assignmentMode'

const SECTIONS: { id: keyof AssignmentModes; title: string; people: string }[] = [
  { id: 'selectors', title: 'חלקת הסלקטורים', people: 'הסלקטורים' },
  { id: 'inspectors', title: 'חלקת הבודקים', people: 'הבודקים' },
]

const CHOICES: { id: AssignmentMode; title: string; text: string }[] = [
  {
    id: 'rounds',
    title: 'שיבוצים בסבבים',
    text: 'המשמרת מתחלקת לסבבים, ובכל סבב האנשים משובצים מחדש לנתיבים.',
  },
  {
    id: 'single',
    title: 'שיבוץ אחד לכל המשמרת',
    text: 'כל אדם משובץ לנתיב אחד, ונשאר בו עד סוף המשמרת.',
  },
]

export function OrgSettingsPage() {
  const { user, assignmentModes, roundMinutes, saveAssignmentModes, saveRoundMinutes } =
    useApp()
  const [draft, setDraft] = useState<AssignmentModes>(assignmentModes)
  const [saving, setSaving] = useState(false)
  const savedModes = useRef(assignmentModes)

  useEffect(() => {
    setDraft((current) => {
      const untouched =
        current.selectors === savedModes.current.selectors &&
        current.inspectors === savedModes.current.inspectors
      savedModes.current = assignmentModes
      return untouched ? assignmentModes : current
    })
  }, [assignmentModes])

  if (!user?.isOrgManager) return <Navigate to="/" replace />

  const visible = SECTIONS.filter((section) => user.modules[section.id])
  const dirty =
    draft.selectors !== assignmentModes.selectors ||
    draft.inspectors !== assignmentModes.inspectors

  const save = async () => {
    setSaving(true)
    try {
      await saveAssignmentModes(draft)
      notify.success('הגדרות השיבוץ נשמרו')
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'שמירת ההגדרות נכשלה')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <SectionCard
        title="הגדרות שיבוץ"
        subtitle="לכל חלקה אפשר לבחור אם האנשים מתחלפים בסבבים או נשארים בנתיב אחד לכל המשמרת. ההגדרה חלה על משמרות חדשות. שיבוצים שכבר נשמרו נשארים כמו שהיו."
      >
        {visible.length === 0 ? (
          <p className="text-sm text-ink-soft">אין חלקות פתוחות בארגון.</p>
        ) : (
          <div className="space-y-6">
            {visible.map((section) => (
              <fieldset key={section.id} className="min-w-0">
                <legend className="font-display text-base font-bold text-ink">
                  {section.title}
                </legend>
                <p className="mt-1 text-[13px] text-ink-soft">
                  איך לשבץ את {section.people} במשמרת.
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {CHOICES.map((choice) => {
                    const selected = draft[section.id] === choice.id
                    return (
                      <label
                        key={choice.id}
                        className={`flex cursor-pointer gap-3 rounded-xl border p-3 transition ${
                          selected
                            ? 'border-brand/40 bg-brand-soft/60'
                            : 'border-line/80 bg-card hover:border-brand/20'
                        }`}
                      >
                        <input
                          type="radio"
                          className="mt-1 size-4 shrink-0 accent-[var(--color-brand)]"
                          name={`assignment-${section.id}`}
                          checked={selected}
                          onChange={() =>
                            setDraft((current) => ({
                              ...current,
                              [section.id]: choice.id,
                            }))
                          }
                        />
                        <span>
                          <span className="block text-sm font-semibold text-ink">
                            {choice.title}
                          </span>
                          <span className="mt-1 block text-[13px] leading-relaxed text-ink-soft">
                            {choice.text}
                          </span>
                        </span>
                      </label>
                    )
                  })}
                </div>
                {draft[section.id] === 'rounds' ? (
                  <label className="mt-3 block text-[13px] text-ink-soft">
                    אורך סבב
                    <select
                      className="ui-field mt-1 max-w-xs"
                      value={roundMinutes[section.id]}
                      onChange={(e) =>
                        void saveRoundMinutes({
                          ...roundMinutes,
                          [section.id]: Number(e.target.value),
                        })
                      }
                    >
                      <option value={60}>שעה</option>
                      <option value={90}>שעה וחצי</option>
                      <option value={120}>שעתיים</option>
                      <option value={180}>שלוש שעות</option>
                    </select>
                  </label>
                ) : null}
              </fieldset>
            ))}
            <div className="flex justify-end">
              <button
                type="button"
                disabled={!dirty || saving}
                onClick={() => void save()}
                className="ui-btn ui-btn-primary disabled:opacity-40"
              >
                {saving ? 'שומר…' : 'שמירת הגדרות'}
              </button>
            </div>
          </div>
        )}
      </SectionCard>
      <p className="text-sm text-ink-soft">
        <Link
          to="/algorithm"
          className="font-semibold text-brand underline decoration-brand/40 underline-offset-4 hover:decoration-brand"
        >
          כללי השיבוץ בשפה פשוטה
        </Link>
      </p>
    </div>
  )
}
