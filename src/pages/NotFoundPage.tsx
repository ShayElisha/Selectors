import { Link } from 'react-router-dom'
import { PublicPage } from '../components/PublicPage'
import { SectionCard } from '../components/ui'

function Missing({ standalone }: { standalone?: boolean }) {
  return (
    <SectionCard
      title="העמוד לא נמצא"
      subtitle="הכתובת הזו לא קיימת בשיבוצון."
    >
      <p className="text-sm leading-relaxed text-ink-soft">
        ייתכן שהקישור ישן, או שהוקלדה כתובת לא נכונה.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link to="/" className="ui-btn ui-btn-primary">
          לראשי
        </Link>
        {!standalone ? (
          <Link to="/help" className="ui-btn ui-btn-ghost">
            שאלות נפוצות
          </Link>
        ) : (
          <Link to="/login" className="ui-btn ui-btn-ghost">
            להתחברות
          </Link>
        )}
      </div>
    </SectionCard>
  )
}

export function NotFoundPage({ standalone = false }: { standalone?: boolean }) {
  if (standalone) {
    return (
      <PublicPage>
        <Missing standalone />
      </PublicPage>
    )
  }
  return <Missing />
}
