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

async function readLogoFile(file: File): Promise<string> {
  const allowed = ['image/png', 'image/jpeg', 'image/webp']
  if (!allowed.includes(file.type)) {
    throw new Error('הלוגו צריך להיות PNG, JPG או WEBP')
  }
  const url = URL.createObjectURL(file)
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('לא ניתן לקרוא את התמונה'))
      el.src = url
    })
    const size = 256
    const scale = Math.min(1, size / Math.max(image.width, image.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.width * scale))
    canvas.height = Math.max(1, Math.round(image.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('לא ניתן לעבד את התמונה')
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    const data = canvas.toDataURL('image/jpeg', 0.85)
    if (data.length > 180_000) throw new Error('התמונה גדולה מדי. בחרו לוגו קטן יותר')
    return data
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function OrgSettingsPage() {
  const {
    user,
    assignmentModes,
    roundMinutes,
    staggerRounds,
    saveAssignmentModes,
    saveRoundMinutes,
    saveStaggerRounds,
    orgProfile,
    saveOrgProfile,
  } = useApp()
  const [orgName, setOrgName] = useState(orgProfile.name || user?.orgName || '')
  const [logo, setLogo] = useState(orgProfile.logo)
  const [profileSaving, setProfileSaving] = useState(false)
  const [draft, setDraft] = useState<AssignmentModes>(assignmentModes)
  const [saving, setSaving] = useState(false)
  const savedModes = useRef(assignmentModes)

  useEffect(() => {
    setOrgName(orgProfile.name || user?.orgName || '')
    setLogo(orgProfile.logo)
  }, [orgProfile, user?.orgName])

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

  const saveProfile = async () => {
    setProfileSaving(true)
    try {
      await saveOrgProfile({ name: orgName.trim(), logo })
      notify.success('פרטי הארגון נשמרו')
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'שמירת פרטי הארגון נכשלה')
    } finally {
      setProfileSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <SectionCard
        title="פרטי הארגון"
        subtitle="השם והלוגו מופיעים ליד תיאור הארגון בכותרת. סימן שיבוצון נשאר במקומו."
      >
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex size-24 items-center justify-center overflow-hidden rounded-2xl border border-line/80 bg-surface">
            {logo ? (
              <img src={logo} alt="" className="size-full object-contain" />
            ) : (
              <span className="px-2 text-center text-[12px] text-ink-soft">אין לוגו</span>
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-3">
            <label className="block text-sm font-semibold text-ink">
              שם הארגון
              <input
                className="ui-field mt-1"
                value={orgName}
                maxLength={80}
                onChange={(e) => setOrgName(e.target.value)}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <label className="ui-btn ui-btn-secondary cursor-pointer">
                בחירת לוגו
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    e.target.value = ''
                    if (!file) return
                    void readLogoFile(file)
                      .then(setLogo)
                      .catch((err) =>
                        notify.error(
                          err instanceof Error ? err.message : 'העלאת הלוגו נכשלה',
                        ),
                      )
                  }}
                />
              </label>
              {logo ? (
                <button
                  type="button"
                  className="ui-btn ui-btn-ghost"
                  onClick={() => setLogo('')}
                >
                  הסרת לוגו
                </button>
              ) : null}
            </div>
            <button
              type="button"
              className="ui-btn ui-btn-primary disabled:opacity-40"
              disabled={profileSaving || orgName.trim().length < 2}
              onClick={() => void saveProfile()}
            >
              {profileSaving ? 'שומר…' : 'שמירת פרטי הארגון'}
            </button>
          </div>
        </div>
      </SectionCard>
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
                {section.id === 'selectors' && draft[section.id] === 'rounds' ? (
                  <label className="mt-3 flex items-start gap-2 text-[13px] text-ink">
                    <input
                      type="checkbox"
                      className="mt-0.5 size-4 accent-[var(--color-brand)]"
                      checked={staggerRounds.selectors}
                      onChange={(e) =>
                        void saveStaggerRounds({
                          ...staggerRounds,
                          selectors: e.target.checked,
                        }).catch((err: unknown) =>
                          notify.error(
                            err instanceof Error ? err.message : 'שמירת הסבבים המדורגים נכשלה',
                          ),
                        )
                      }
                    />
                    <span>
                      <span className="font-semibold">סבבים מדורגים</span>
                      <span className="mt-0.5 block text-ink-soft">
                        חלק מהסלקטורים מתחלפים בשעה עגולה וחלק בחצי שעה, כדי שהשער לא יישאר ריק באמצע ההחלפה. חל על משמרות חדשות.
                      </span>
                    </span>
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
