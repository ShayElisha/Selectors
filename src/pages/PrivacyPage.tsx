import { useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { AppFooter } from '../components/AppFooter'
import { SectionCard } from '../components/ui'

export function PrivacyPage() {
  const { user } = useApp()
  const location = useLocation()
  const backTo = user ? '/' : '/login'

  useEffect(() => {
    const id = location.hash.replace(/^#/, '')
    if (!id) return
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [location.hash])

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-8 sm:py-10">
      <Link
        to={backTo}
        className="mb-5 inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-brand hover:text-brand-deep"
      >
        <ArrowRight className="size-4" aria-hidden />
        חזרה
      </Link>

      <SectionCard
        title="מדיניות שימוש ופרטיות"
        subtitle="עדכון אחרון: ספטמבר 2026 · לשימוש פנימי בארגון"
      >
        <p className="ui-eyebrow mb-4">GATE OUT</p>

        <div className="space-y-5 text-sm leading-relaxed text-ink sm:text-[0.9375rem]">
          <section id="terms" className="scroll-mt-6">
            <h2 className="mb-1.5 font-display text-base font-bold text-brand-deep">
              מדיניות שימוש
            </h2>
            <p className="text-ink-soft">
              שיבוצון (GATE OUT) הוא כלי ארגוני פנימי לניהול שיבוץ בודקים בשער
              יציאה. השימוש במערכת מיועד לעובדים ומנהלים מורשים בלבד, ולמטרות
              תפעול המשמרת בלבד. אין להעביר גישה או לייצא מידע מחוץ למעגל העבודה
              הנדרש.
            </p>
          </section>

          <section id="privacy" className="scroll-mt-6">
            <h2 className="mb-1.5 font-display text-base font-bold text-brand-deep">
              פרטיות — איזה מידע נאסף
            </h2>
            <ul className="list-disc space-y-1 pr-5 text-ink-soft">
              <li>שם מלא, מספר טלפון וכתובת מייל (למנהלים)</li>
              <li>הסמכות, סטטוס פעילות ותפקיד ניהולי</li>
              <li>נתוני משמרות: תאריך, סוג משמרת, נוכחות ושיבוץ לעמדות</li>
              <li>הערות שיבוץ (אם הוזנו) ויומן פעולות מערכת (למשל התחברות ושמירה)</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-1.5 font-display text-base font-bold text-brand-deep">
              שימוש במידע
            </h2>
            <p className="text-ink-soft">
              המידע משמש לאימות התחברות מנהלים, יצירת ועדכון שיבוצים, הצגת
              היסטוריה וניתוחים פנימיים, ושיתוף שיבוץ (למשל בוואטסאפ) לפי בחירת
              המשתמש המורשה. אין שימוש במידע לפרסום או למסירה לצדדים שלישיים
              שאינם חלק מהפעלת המערכת.
            </p>
          </section>

          <section>
            <h2 className="mb-1.5 font-display text-base font-bold text-brand-deep">
              אחסון וגישה
            </h2>
            <p className="text-ink-soft">
              הנתונים נשמרים בשרת הארגון ובמכשיר המשתמש (למשל מטמון/טיוטת
              שיבוץ מקומית). סיסמאות מנהלים נשמרות כהאש מוצפן בלבד; סיסמאות
              זמניות ואיפוס נשלחים למייל המנהל. גישה למערכת מוגבלת למנהלים
              מורשים. יש להימנע משיתוף פרטי התחברות או ייצוא מידע מחוץ למעגל
              העבודה הנדרש.
            </p>
          </section>

          <section>
            <h2 className="mb-1.5 font-display text-base font-bold text-brand-deep">
              אחריות המשתמש
            </h2>
            <p className="text-ink-soft">
              באחריות המשתמש לשמור על סודיות המידע האישי המוצג במערכת ולהשתמש
              בו רק למטרות תפעול המשמרת.
            </p>
          </section>

          <section>
            <h2 className="mb-1.5 font-display text-base font-bold text-brand-deep">
              יצירת קשר
            </h2>
            <p className="text-ink-soft">
              לשאלות בנוגע לפרטיות או לעדכון/מחיקת נתונים — יש לפנות למנהל
              המערכת בארגון.
            </p>
          </section>
        </div>
      </SectionCard>

      <AppFooter className="mt-10" />
    </div>
  )
}
