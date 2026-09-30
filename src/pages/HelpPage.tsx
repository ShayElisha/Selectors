import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { PublicPage } from '../components/PublicPage'
import { SectionCard } from '../components/ui'

const QUESTIONS: { q: string; a: ReactNode }[] = [
  {
    q: 'מה זה שיבוצון?',
    a: 'כלי פנימי לשיבוץ בודקים וסלקטורים לנתיבים בשער יציאה. המערכת שומרת אנשים, הסמכות, נתיבים ואת היסטוריית המשמרות.',
  },
  {
    q: 'איך מתחברים?',
    a: 'עם מספר הטלפון של חשבון מנהל, ואז סיסמה. בכניסה הראשונה, אחרי סיסמה זמנית מהמייל, בוחרים סיסמה קבועה.',
  },
  {
    q: 'שכחתי את הסיסמה.',
    a: 'במסך ההתחברות בחרו איפוס סיסמה. אם המספר רשום כמנהל, תישלח סיסמה זמנית למייל שמשויך לחשבון.',
  },
  {
    q: 'איך מחליפים סיסמה כשכבר מחוברים?',
    a: 'מתפריט השם בפינה, בחרו «החלפת סיסמה». צריך את הסיסמה הנוכחית וסיסמה חדשה שעומדת בכללים.',
  },
  {
    q: 'למה אדם לא שובץ לנתיב?',
    a: 'הוא חייב להיות מסומן כנוכח, ולהחזיק את כל ההסמכות שהנתיב דורש. אדם אחד לא יושב בשני נתיבים באותו זמן, ומנהל שער שמונה למשמרת לא נכנס לנתיבים הרגילים.',
  },
  {
    q: 'איך נקבע מי יושב איפה?',
    a: (
      <>
        קודם כל הכללים הקשיחים (נוכחות, הסמכה, תקן). אחר כך העדפות כמו רוטציה
        ופיזור עומס. ההסבר המלא נמצא{' '}
        <Link
          to="/algorithm"
          className="font-semibold text-brand underline decoration-brand/40 underline-offset-4 hover:decoration-brand"
        >
          בכללי השיבוץ
        </Link>
        .
      </>
    ),
  },
  {
    q: 'מה ההבדל בין שיבוץ אחד לסבבים?',
    a: 'מנהל הארגון בוחר לכל חלקה: נתיב אחד עד סוף המשמרת, או התחלפות בסבבים. אצל סלקטורים בסבבים, נתיב נפתח רק בשעות שהוא פעיל, ואדם עם חלון שעות אישי נכנס רק לסבבים שבתוך החלון.',
  },
  {
    q: 'אפשר לתקן שיבוץ ידנית?',
    a: 'כן. השיבוץ האוטומטי הוא נקודת פתיחה. במסך השיבוץ אפשר להעביר אנשים, והשמירה נרשמת ביומן.',
  },
  {
    q: 'איפה רואים את הפרטים של אדם?',
    a: 'במאגר האנשים, לחצו על השם. נפתח פרופיל עם הסמכות, הנתיבים שהוא כשיר להם, והמשמרות האחרונות.',
  },
  {
    q: 'מצאתי תקלה.',
    a: (
      <>
        אפשר לשלוח{' '}
        <Link
          to="/report"
          className="font-semibold text-brand underline decoration-brand/40 underline-offset-4 hover:decoration-brand"
        >
          דיווח תקלה
        </Link>
        {' '}
        מהפוטר. תארו מה קרה ובאיזה מסך.
      </>
    ),
  },
]

export function HelpPage() {
  return (
    <PublicPage>
      <SectionCard
        title="שאלות נפוצות"
        subtitle="תשובות קצרות על התחברות, שיבוץ והשימוש היומיומי."
      >
        <div className="space-y-5">
          {QUESTIONS.map((item) => (
            <section key={item.q}>
              <h2 className="font-display text-base font-bold text-ink">{item.q}</h2>
              <p className="mt-1 text-sm leading-relaxed text-ink-soft">{item.a}</p>
            </section>
          ))}
        </div>
      </SectionCard>
    </PublicPage>
  )
}
