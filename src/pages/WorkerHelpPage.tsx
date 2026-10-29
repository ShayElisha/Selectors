import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  Bell,
  BookOpen,
  ClipboardList,
  History,
  Phone,
  Shield,
  Timer,
  UserRound,
} from 'lucide-react'
import { SectionCard } from '../components/ui'
import { useWorkerPortalPaths } from '../lib/workerPortalPaths'

function Step({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof ClipboardList
  title: string
  children: React.ReactNode
}) {
  return (
    <li className="flex gap-3 rounded-xl border border-line/70 bg-surface/40 p-3">
      <span className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand/10 text-brand">
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="font-semibold text-ink">{title}</p>
        <div className="mt-1 text-sm leading-relaxed text-ink-soft">{children}</div>
      </div>
    </li>
  )
}

export function WorkerHelpPage() {
  const { portalTitle, home, path } = useWorkerPortalPaths()
  return (
    <div className="space-y-4">
      <SectionCard
        title="איך משתמשים — מדריך קצר"
        subtitle={`למי שמגיע לראשונה ל${portalTitle} של שיבוצון.`}
      >
        <ol className="space-y-3">
          <Step icon={ClipboardList} title="מסך «עכשיו»">
            כאן רואים אם יש לכם משמרת קרובה או פעילה, וטיימר עד ההתחלה או עד
            הסיום. השיבוץ לנתיב מוצג רק אחרי שמתחילה המשמרת.
          </Step>
          <Step icon={Timer} title="לפני המשמרת">
            תופיע ספירה לאחור. כ־60 דקות לפני ההתחלה תקבלו תזכורת במרכז ההתראות
            (ואם אישרתם — גם התראת דפדפן).
          </Step>
          <Step icon={Shield} title="מנהל המשמרת">
            אם שובץ מנהל שער למשמרת, תראו את השם ואפשרות להתקשר או לשלוח
            WhatsApp ישירות ממסך «עכשיו».
          </Step>
          <Step icon={UserRound} title="סימון הגעה">
            אחרי תחילת המשמרת לחצו «הגעתי» כדי שהמנהלים יראו שאתם נוכחים.
          </Step>
          <Step icon={BookOpen} title="תדריכים">
            במסך התדריכים יש חומרים שהמנהלים מעדכנים. תדריכים מסומנים כחשובים
            מופיעים גם בהתראות.
          </Step>
          <Step icon={History} title="היסטוריה">
            אפשר לראות משמרות מהחודש האחרון וסטטיסטיקה של נתיבים שכבר התחילו.
          </Step>
          <Step icon={Bell} title="התראות">
            הודעות ממנהלים, שינויי שיבוץ ותזכורות משמרת. מומלץ לאשר התראות
            דפדפן בפרופיל כדי לא לפספס.
          </Step>
          <Step icon={Phone} title="אנשי קשר">
            במסך «אנשי קשר» מופיעים כל עובדי המחלקה (מנהלים ועמיתים) ואנשי קשר
            שהוגדרו — עם כפתור חיוג ו־WhatsApp ישירות מהטלפון.
          </Step>
          <Step icon={AlertTriangle} title="דיווח תקלה">
            במסך «תקלות» אפשר לשלוח דיווח. התקלה נפתחת ביומן רק אחרי שאישור
            מנהל המשמרת מתקבל.
          </Step>
          <Step icon={UserRound} title="פרטים וסיסמה">
            בפרופיל רואים טלפון והסמכות (לקריאה). החלפת סיסמה — מתפריט או
            מהפרופיל.
          </Step>
        </ol>

        <div className="mt-5 flex flex-wrap gap-2">
          <Link to={home} className="ui-btn ui-btn-primary">
            למסך עכשיו
          </Link>
          <Link to={path('profile')} className="ui-btn ui-btn-secondary">
            להתראות דפדפן
          </Link>
        </div>
      </SectionCard>
    </div>
  )
}
