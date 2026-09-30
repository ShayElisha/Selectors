import { useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { useApp } from '../context/AppContext'
import { AppFooter } from '../components/AppFooter'
import { SectionCard } from '../components/ui'

export function PrivacyPage() {
  const { user } = useApp()
  const location = useLocation()
  const backTo = user?.role === 'super_admin' ? '/admin' : user ? '/' : '/login'

  useEffect(() => {
    const id = location.hash.replace(/^#/, '')
    if (!id) return
    const el = document.getElementById('policy')
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [location.hash])

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 py-8 sm:py-10">
      <Link
        to={backTo}
        className="mb-5 inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-brand hover:text-brand-deep"
      >
        <ArrowRight className="size-4" aria-hidden />
        חזרה
      </Link>

      <SectionCard
        title="מדיניות שימוש ופרטיות"
        subtitle="עדכון אחרון: ספטמבר 2026 · מסמך אחד לשימוש פנימי בארגון"
      >
        <div
          id="policy"
          className="scroll-mt-6 space-y-6 text-sm leading-relaxed text-ink sm:text-[0.9375rem]"
        >
          <p className="text-ink-soft">
            שיבוצון (GATE OUT) הוא כלי פנימי לשיבוץ בודקים וסלקטורים לנתיבים
            בשער יציאה. העמוד הזה מסביר גם מי רשאי להשתמש במערכת ולאיזו מטרה,
            וגם איזה מידע נשמר, מי רואה אותו, ומה מצופה ממי שנכנס. אין כאן
            שני מסמכים נפרדים: כללי השימוש והפרטיות חלים יחד על כל כניסה למערכת.
          </p>

          <section>
            <h2 className="mb-1.5 font-display text-base font-bold text-brand-deep">
              למי המערכת
            </h2>
            <p className="text-ink-soft">
              הכניסה מיועדת למנהלים שהארגון אישר: מנהל משמרת או מנהל ארגון, לפי
              החלקה ששויכה לחשבון (בודקים, סלקטורים, או שתיהן). סופר-אדמין רואה
              רק את ניהול הארגונים, לא את השיבוץ היומי. עובד שאין לו חשבון מנהל
              לא מתחבר למערכת; השם והפרטים שלו נשמרים כדי שאפשר יהיה לשבץ אותו.
            </p>
          </section>

          <section>
            <h2 className="mb-1.5 font-display text-base font-bold text-brand-deep">
              לאיזו מטרה משתמשים
            </h2>
            <p className="text-ink-soft">
              השימוש הוא לתפעול המשמרת בלבד: בניית לוח, בדיקה מי כשיר לאיזה
              נתיב, מעקב אחרי היסטוריה, תדריך, אנשי קשר של עמילי מכס, ודיווח
              תקלה במערכת. אין להשתמש במידע לצורך אישי, פרסום, או העברה למי
              שאינו צריך אותו כדי להפעיל את המשמרת.
            </p>
          </section>

          <section>
            <h2 className="mb-1.5 font-display text-base font-bold text-brand-deep">
              מה מותר ומה אסור
            </h2>
            <ul className="list-disc space-y-1 pr-5 text-ink-soft">
              <li>להתחבר רק עם החשבון האישי, ולא להעביר טלפון, סיסמה או קישור התחברות לאחר.</li>
              <li>לשבץ, לעדכן נוכחות, ולתקן לוח לפי מה שנדרש במשמרת.</li>
              <li>לייצא או לשתף שיבוץ (למשל בוואטסאפ או בקובץ) רק למי שנמצא במעגל העבודה של אותה משמרת.</li>
              <li>אין להעתיק את המאגר, את היומן, או את פרטי הקשר של עמילי המכס החוצה מהארגון.</li>
              <li>אין לנסות להיכנס לארגון אחר, לחשבון של מישהו אחר, או לנתונים שאינם שייכים לחלקה שלך.</li>
              <li>אין להזין במערכת תוכן שאינו קשור לעבודה, כולל מידע רגיש שאין בו צורך לשיבוץ.</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-1.5 font-display text-base font-bold text-brand-deep">
              איזה מידע נשמר
            </h2>
            <ul className="list-disc space-y-1 pr-5 text-ink-soft">
              <li>על האנשים: שם מלא, טלפון, הסמכות, סטטוס (פעיל, לא פעיל, ארכיון) וסוג התפקיד. למנהל נשמרת גם כתובת מייל, כדי לשלוח סיסמה זמנית.</li>
              <li>על הנתיבים: שם, תקן איוש, הסמכות נדרשות, עוצמה, שעות פתיחה, וסימון של נתיב החלפת צהריים.</li>
              <li>על המשמרת: תאריך, סוג משמרת, מי נוכח, מי מנהל השער, שיבוץ לנתיבים, סבבים, חלונות שעות, והערות שהוזנו בלוח.</li>
              <li>תוכן שמנהלים כותבים יחד: תדריך, בנק שאלות, דגמי משמרת, ורשימת עמילי מכס עם שמות וטלפונים.</li>
              <li>יומן פעולות: למשל התחברות, שמירת שיבוץ, החלפת סיסמה, איפוס סיסמה, ושינוי הגדרות. ביומן נשמרים שם, טלפון, מועד ותיאור קצר.</li>
              <li>דיווח תקלה: כותרת, תיאור, מיקום במסך, שם וטלפון של הפונה, והארגון שאליו הוא משויך.</li>
              <li>סיסמה אינה נשמרת כטקסט. נשמר רק ערך מוצפן, שאי אפשר לשחזר ממנו את הסיסמה.</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-1.5 font-display text-base font-bold text-brand-deep">
              למה משתמשים במידע
            </h2>
            <p className="text-ink-soft">
              כדי לזהות מי נכנס, לבנות שיבוץ לפי נוכחות והסמכות, להציג היסטוריה
              וניתוח פנימי, לשמור תדריך ואנשי קשר, ולשלוח למנהל סיסמה זמנית או
              הודעה על ארגון שאושר. שיבוץ שמשתמש בוחר לשתף נשלח רק ליעד שהוא
              בחר, למשל הודעת וואטסאפ או קובץ. המידע לא משמש לפרסום, ולא נמכר
              ולא מועבר לגורם שאינו מפעיל את המערכת או את הארגון.
            </p>
          </section>

          <section>
            <h2 className="mb-1.5 font-display text-base font-bold text-brand-deep">
              מי רואה מה
            </h2>
            <p className="text-ink-soft">
              מנהל רואה את הנתונים של הארגון שלו, ורק בחלקה שפתוחה לו. מנהל
              ארגון רואה את שתי החלקות, אם שתיהן פתוחות, ויכול לשנות את אופן
              השיבוץ. אנשים בארגון אחר לא רואים את המאגר. סופר-אדמין רואה שמות
              ארגונים ובקשות הצטרפות, לא את לוחות המשמרת. ייצוא ושיתוף יוצאים
              מהמערכת רק כשמשתמש מחובר בוחר לעשות זאת.
            </p>
          </section>

          <section>
            <h2 className="mb-1.5 font-display text-base font-bold text-brand-deep">
              איפה המידע נשמר
            </h2>
            <p className="text-ink-soft">
              הנתונים נשמרים במסד הנתונים של המערכת, בנפרד לפי הארגון והחלקה.
              במכשיר נשמרים גם עותק מקומי של הנתונים, טיוטת שיבוץ שלא נשמרה,
              ופרטי ההתחברות לחידוש הכניסה. מי שמשתמש במחשב משותף צריך לצאת
              מהמערכת בסיום. סיסמה זמנית ואיפוס נשלחים למייל של המנהל; אחרי
              הכניסה הראשונה בוחרים סיסמה קבועה, והסיסמה הזמנית חדלה לשמש.
            </p>
          </section>

          <section>
            <h2 className="mb-1.5 font-display text-base font-bold text-brand-deep">
              כמה זמן המידע נשמר
            </h2>
            <p className="text-ink-soft">
              היסטוריית המשמרות, היומן, והמאגר נשארים כל עוד הארגון משתמש
              במערכת, כדי שאפשר יהיה לשחזר שיבוץ ולבדוק עומס. עובד שאפשר
              להעביר לארכיון או להשבית מפסיק להופיע בשיבוץ הפעיל, אבל הרשומה
              ההיסטורית לא נמחקת מעצמה. בקשה לעדכון או למחיקה מופנית למנהל
              הארגון, והוא מחליט מה אפשר להסיר בלי לפגוע בתיעוד המשמרות
              שנדרש לעבודה.
            </p>
          </section>

          <section>
            <h2 className="mb-1.5 font-display text-base font-bold text-brand-deep">
              אחריות מי שנכנס
            </h2>
            <p className="text-ink-soft">
              מי שנכנס אחראי למה שהוא משנה בלוח ובמאגר, ולמה שהוא מייצא החוצה.
              חובה לשמור על סודיות השמות, הטלפונים, והערות השיבוץ, ולהשתמש בהם
              רק להפעלת המשמרת. אם סיסמה נחשפה, או שנכנסים ממכשיר שאינו אישי,
              יש להחליף סיסמה ולצאת מהמערכת. תקלה או חשד לשימוש לא מורשה
              אפשר לדווח מדף דיווח התקלה, או למנהל הארגון.
            </p>
          </section>

          <section>
            <h2 className="mb-1.5 font-display text-base font-bold text-brand-deep">
              יצירת קשר
            </h2>
            <p className="text-ink-soft">
              שאלה על השימוש, בקשה לעדכן או למחוק פרט, או בירור מי ראה מידע —
              פונים למנהל הארגון. תקלה טכנית אפשר לשלוח גם מדף דיווח התקלה;
              בדיווח נשמרים השם והטלפון, כדי שאפשר יהיה לחזור אל הפונה.
            </p>
          </section>
        </div>
      </SectionCard>

      <AppFooter className="mt-10" />
    </div>
  )
}
