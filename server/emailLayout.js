import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const LOGO_CID = 'gateout-logo@shibutzon'
const LOGO_PATH = join(__dirname, '..', 'public', 'gate-out-logo.png')

const BRAND = {
  deep: '#0f3350',
  brand: '#1a4a6e',
  accent: '#c45c26',
  ink: '#0f1c2e',
  soft: '#3d4f66',
  line: '#d5dee8',
  surface: '#f3f6f9',
  card: '#ffffff',
  ok: '#1f7a4c',
  okSoft: '#d8efe3',
}

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function appDisplayName() {
  const name = String(process.env.APP_NAME || 'שיבוצון · CHECK IN').trim()
  return name || 'שיבוצון · CHECK IN'
}

const DEFAULT_APP_URL = 'https://shibutzon.vercel.app'

export function appPublicUrl() {
  const raw =
    process.env.APP_URL || process.env.PUBLIC_APP_URL || DEFAULT_APP_URL
  return String(raw).replace(/\/+$/, '')
}

/** Prefer hosted logo on Vercel; CID only when the PNG exists next to the function. */
export function logoImgSrc() {
  const base = appPublicUrl()
  if (base) return `${base}/gate-out-logo.png`
  return null
}

/** Inline CID attachment for the brand logo (when file exists). */
export function logoAttachment() {
  try {
    if (!existsSync(LOGO_PATH)) return null
    return {
      filename: 'gate-out-logo.png',
      content: readFileSync(LOGO_PATH),
      cid: LOGO_CID,
      contentType: 'image/png',
      contentDisposition: 'inline',
    }
  } catch {
    return null
  }
}

function logoHtmlBlock() {
  const hosted = logoImgSrc()
  if (hosted) {
    return `
      <img src="${escapeHtml(hosted)}" width="56" height="56" alt="CHECK IN"
        style="display:block;width:56px;height:56px;border:0;border-radius:12px;" />
    `
  }
  try {
    if (existsSync(LOGO_PATH)) {
      return `
      <img src="cid:${LOGO_CID}" width="56" height="56" alt="CHECK IN"
        style="display:block;width:56px;height:56px;border:0;border-radius:12px;" />
    `
    }
  } catch {
    /* ignore */
  }
  // Fallback mark (matches site favicon) when PNG is missing
  return `
    <div style="width:56px;height:56px;border-radius:12px;background:${BRAND.brand};text-align:center;line-height:56px;color:#fff;font-family:Arial,sans-serif;font-weight:700;font-size:11px;letter-spacing:0.08em;">
      CI
    </div>
  `
}

/**
 * Professional RTL email shell aligned with site brand.
 * @param {{
 *   preheader?: string
 *   title: string
 *   eyebrow?: string
 *   greeting?: string
 *   bodyHtml: string
 *   footerNote?: string
 * }} opts
 */
export function renderBrandedEmail({
  preheader = '',
  title,
  eyebrow = 'CHECK IN',
  greeting = '',
  bodyHtml,
  footerNote = 'מייל זה נשלח אוטומטית ממערכת שיבוצון · לשימוש פנימי בלבד',
}) {
  const appName = escapeHtml(appDisplayName())
  const loginUrl = appPublicUrl()
  const ctaRows = `
          <tr>
            <td align="center" style="padding:8px 24px 4px;">
              <a href="${escapeHtml(loginUrl)}"
                style="display:inline-block;background:${BRAND.accent};color:#ffffff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;padding:12px 22px;border-radius:12px;">
                כניסה לשיבוצון
              </a>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:6px 24px 20px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;">
              <a href="${escapeHtml(loginUrl)}" style="color:${BRAND.brand};text-decoration:underline;">${escapeHtml(loginUrl)}</a>
            </td>
          </tr>`

  return `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.surface};-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
    ${escapeHtml(preheader)}
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.surface};padding:28px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:${BRAND.card};border:1px solid ${BRAND.line};border-radius:16px;overflow:hidden;box-shadow:0 8px 24px rgba(15,28,46,0.06);">
          <!-- Header -->
          <tr>
            <td style="background:${BRAND.deep};padding:22px 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td width="64" valign="middle" style="padding-left:14px;">
                    ${logoHtmlBlock()}
                  </td>
                  <td valign="middle" align="right">
                    <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.18em;color:${BRAND.accent};text-transform:uppercase;">
                      ${escapeHtml(eyebrow)}
                    </div>
                    <div style="font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:700;color:#ffffff;line-height:1.25;margin-top:4px;">
                      שיבוצון
                    </div>
                    <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:rgba(255,255,255,0.78);margin-top:2px;">
                      ניהול ושיבוץ עמדות סלקטורים
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:28px 24px 8px;font-family:Arial,Helvetica,sans-serif;color:${BRAND.ink};direction:rtl;text-align:right;">
              <h1 style="margin:0 0 14px;font-size:20px;line-height:1.35;font-weight:700;color:${BRAND.deep};">
                ${escapeHtml(title)}
              </h1>
              ${
                greeting
                  ? `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${BRAND.ink};">שלום <strong>${escapeHtml(greeting)}</strong>,</p>`
                  : ''
              }
              ${bodyHtml}
            </td>
          </tr>

          ${ctaRows}

          <!-- Footer -->
          <tr>
            <td style="border-top:1px solid ${BRAND.line};background:${BRAND.surface};padding:16px 24px;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.55;color:${BRAND.soft};text-align:center;direction:rtl;">
              <div style="font-weight:700;color:${BRAND.brand};letter-spacing:0.12em;font-size:10px;text-transform:uppercase;margin-bottom:4px;">CHECK IN</div>
              <div>${escapeHtml(footerNote)}</div>
              <div style="margin-top:6px;color:${BRAND.soft};">${appName}</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

/**
 * @param {{ fullName: string, tempPassword: string, reason: 'invite' | 'reset' }} opts
 */
export function buildTempPasswordEmail({ fullName, tempPassword, reason }) {
  const isReset = reason === 'reset'
  const title = isReset ? 'איפוס סיסמה' : 'ברוכים הבאים למערכת המנהלים'
  const preheader = isReset
    ? 'סיסמה זמנית לאיפוס החשבון בשיבוצון'
    : 'סיסמה זמנית להתחברות ראשונה לשיבוצון'
  const intro = isReset
    ? 'התקבלה בקשה לאיפוס סיסמה בחשבון המנהל שלך. השתמשו בסיסמה הזמנית למטה כדי להתחבר, ואז הגדירו סיסמה קבועה חדשה.'
    : 'סומנת כמנהל/ת במערכת השיבוץ. להלן סיסמה זמנית להתחברות ראשונה. לאחר הכניסה תידרש/י להגדיר סיסמה קבועה.'

  const bodyHtml = `
    <p style="margin:0 0 16px;font-size:14px;line-height:1.65;color:${BRAND.soft};">
      ${escapeHtml(intro)}
    </p>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;background:${BRAND.surface};border:1px solid ${BRAND.line};border-radius:12px;">
      <tr>
        <td style="padding:16px 18px;text-align:center;">
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.14em;color:${BRAND.accent};text-transform:uppercase;margin-bottom:8px;">
            קוד זמני — 6 ספרות
          </div>
          <div style="font-family:Consolas,'Courier New',monospace;font-size:22px;font-weight:700;letter-spacing:0.08em;color:${BRAND.deep};direction:ltr;unicode-bidi:bidi-override;">
            ${escapeHtml(tempPassword)}
          </div>
        </td>
      </tr>
    </table>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;">
      <tr>
        <td style="padding:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;color:${BRAND.deep};">
          מה הלאה?
        </td>
      </tr>
      <tr>
        <td style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.7;color:${BRAND.soft};">
          1. היכנסו לאתר עם מספר הטלפון והסיסמה הזמנית<br/>
          2. הגדירו סיסמה קבועה (אות גדולה, ספרה וסימן מיוחד)<br/>
          3. המשיכו לשיבוץ המשמרת כרגיל
        </td>
      </tr>
    </table>

    <p style="margin:0 0 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.6;color:${BRAND.soft};">
      הסיסמה הזמנית תקפה ל־24 שעות בלבד.
    </p>
    <p style="margin:0;padding:12px 14px;background:${BRAND.okSoft};border-radius:10px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.55;color:${BRAND.ok};">
      אם לא ביקשתם פעולה זו — התעלמו מהמייל ופנו למנהל המערכת.
    </p>
  `

  const text = [
    `שלום ${fullName || ''},`,
    '',
    intro,
    '',
    `סיסמה זמנית: ${tempPassword}`,
    'הסיסמה הזמנית תקפה ל־24 שעות בלבד.',
    '',
    'מה הלאה?',
    '1. היכנסו לאתר עם הטלפון והסיסמה הזמנית',
    '2. הגדירו סיסמה קבועה',
    '3. המשיכו לשיבוץ',
    '',
    appPublicUrl() ? `כניסה: ${appPublicUrl()}` : '',
    '',
    'אם לא ביקשתם פעולה זו — פנו למנהל המערכת.',
    '',
    appDisplayName(),
  ]
    .filter((line) => line !== undefined)
    .join('\n')

  return {
    subject: `${appDisplayName()} — ${title}`,
    text,
    html: renderBrandedEmail({
      preheader,
      title,
      greeting: fullName || '',
      bodyHtml,
    }),
  }
}

function infoCard(label, value) {
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;background:${BRAND.surface};border:1px solid ${BRAND.line};border-radius:12px;">
      <tr>
        <td style="padding:16px 18px;text-align:center;">
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.14em;color:${BRAND.accent};text-transform:uppercase;margin-bottom:8px;">
            ${escapeHtml(label)}
          </div>
          <div style="font-family:Arial,Helvetica,sans-serif;font-size:18px;font-weight:700;color:${BRAND.deep};">
            ${escapeHtml(value)}
          </div>
        </td>
      </tr>
    </table>`
}

/**
 * Confirmation after a manager registers a new organization.
 * @param {{ fullName: string, organizationName: string }} opts
 */
export function buildOrganizationCreatedEmail({ fullName, organizationName }) {
  const title = 'הבקשה להקמת הארגון התקבלה'
  const intro =
    'קיבלנו את הבקשה לפתוח ארגון בשיבוצון. הבקשה ממתינה לאישור. אחרי האישור אפשר להיכנס עם מספר הטלפון והסיסמה שהגדרתם בהרשמה.'
  const bodyHtml = `
    <p style="margin:0 0 16px;font-size:14px;line-height:1.65;color:${BRAND.soft};">
      ${escapeHtml(intro)}
    </p>
    ${infoCard('הארגון', organizationName || '')}
    <p style="margin:0;font-size:13px;line-height:1.65;color:${BRAND.soft};">
      אין צורך להירשם שוב. כשהארגון יאושר תישלח הודעה נוספת לאותה כתובת.
    </p>
  `
  const text = [
    `שלום ${fullName || ''},`,
    '',
    intro,
    '',
    `הארגון: ${organizationName || ''}`,
    '',
    'אין צורך להירשם שוב. כשהארגון יאושר תישלח הודעה נוספת.',
    '',
    appPublicUrl() ? `כניסה: ${appPublicUrl()}` : '',
    '',
    appDisplayName(),
  ]
    .filter((line) => line !== '')
    .join('\n')
  return {
    subject: `${appDisplayName()} — ${title}`,
    text,
    html: renderBrandedEmail({
      preheader: `הבקשה עבור ${organizationName || 'הארגון'} התקבלה וממתינה לאישור`,
      title,
      greeting: fullName || '',
      bodyHtml,
    }),
  }
}

/**
 * Sent when a super admin approves the organization.
 * @param {{ fullName: string, organizationName: string }} opts
 */
export function buildOrganizationApprovedEmail({ fullName, organizationName }) {
  const title = 'הארגון אושר'
  const intro =
    'הארגון אושר במערכת השיבוץ. אפשר להיכנס עם מספר הטלפון והסיסמה מההרשמה.'
  const bodyHtml = `
    <p style="margin:0 0 16px;font-size:14px;line-height:1.65;color:${BRAND.soft};">
      ${escapeHtml(intro)}
    </p>
    ${infoCard('הארגון', organizationName || '')}
    <p style="margin:0 0 16px;font-size:13px;line-height:1.7;color:${BRAND.soft};">
      1. היכנסו עם מספר הטלפון והסיסמה שהגדרתם<br/>
      2. אם עדיין אין מודול פתוח, הכניסה תיפתח ברגע שיופעלו סלקטורים או בודקים
    </p>
    <p style="margin:0;padding:12px 14px;background:${BRAND.okSoft};border-radius:10px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.55;color:${BRAND.ok};">
      אם לא פתחתם את הארגון — פנו למנהל המערכת.
    </p>
  `
  const text = [
    `שלום ${fullName || ''},`,
    '',
    intro,
    '',
    `הארגון: ${organizationName || ''}`,
    '',
    '1. היכנסו עם מספר הטלפון והסיסמה מההרשמה',
    '2. אם עדיין אין מודול פתוח, הכניסה תיפתח כשיופעלו סלקטורים או בודקים',
    '',
    appPublicUrl() ? `כניסה: ${appPublicUrl()}` : '',
    '',
    appDisplayName(),
  ]
    .filter((line) => line !== '')
    .join('\n')
  return {
    subject: `${appDisplayName()} — ${title}`,
    text,
    html: renderBrandedEmail({
      preheader: `${organizationName || 'הארגון'} אושר. אפשר להיכנס לשיבוצון`,
      title,
      greeting: fullName || '',
      bodyHtml,
    }),
  }
}

export function buildOrganizationRejectedEmail({ fullName, organizationName }) {
  const title = 'הבקשה לארגון נדחתה'
  const intro = 'הבקשה לפתוח את הארגון בשיבוצון נדחתה. אי אפשר להיכנס עם החשבון הזה.'
  const bodyHtml = `
    <p style="margin:0 0 16px;font-size:14px;line-height:1.65;color:${BRAND.soft};">${escapeHtml(intro)}</p>
    ${infoCard('הארגון', organizationName || '')}
  `
  return {
    subject: `${appDisplayName()} — ${title}`,
    text: `שלום ${fullName || ''},\n\n${intro}\n\nהארגון: ${organizationName || ''}\n`,
    html: renderBrandedEmail({
      preheader: intro,
      title,
      greeting: fullName || '',
      bodyHtml,
    }),
  }
}

export function buildModulesOpenedEmail({ fullName, organizationName, modules }) {
  const opened = [
    modules?.selectors ? 'סלקטורים' : '',
    modules?.inspectors ? 'בודקים' : '',
  ].filter(Boolean)
  const title = 'נפתח מודול בארגון'
  const intro = `נפתחו המודולים: ${opened.join(' ו') || 'מודול'}. אפשר להיכנס לשיבוצון.`
  const bodyHtml = `
    <p style="margin:0 0 16px;font-size:14px;line-height:1.65;color:${BRAND.soft};">${escapeHtml(intro)}</p>
    ${infoCard('הארגון', organizationName || '')}
  `
  return {
    subject: `${appDisplayName()} — ${title}`,
    text: `שלום ${fullName || ''},\n\n${intro}\n\nהארגון: ${organizationName || ''}\n${appPublicUrl()}\n`,
    html: renderBrandedEmail({
      preheader: intro,
      title,
      greeting: fullName || '',
      bodyHtml,
    }),
  }
}

export function buildNewOrganizationAdminEmail({ organizationName, managerName, phone, email }) {
  const title = 'נרשם ארגון חדש'
  const intro = 'ארגון חדש ממתין לאישור במסך הסופר אדמין.'
  const bodyHtml = `
    <p style="margin:0 0 16px;font-size:14px;line-height:1.65;color:${BRAND.soft};">${escapeHtml(intro)}</p>
    ${infoCard('הארגון', organizationName || '')}
    <p style="margin:0;font-size:13px;line-height:1.7;color:${BRAND.soft};">
      מנהל: ${escapeHtml(managerName || '')}<br/>
      טלפון: ${escapeHtml(phone || '')}<br/>
      מייל: ${escapeHtml(email || '')}
    </p>
  `
  return {
    subject: `${appDisplayName()} — ${title}: ${organizationName || ''}`,
    text: `${intro}\nהארגון: ${organizationName || ''}\nמנהל: ${managerName || ''}\nטלפון: ${phone || ''}\nמייל: ${email || ''}\n`,
    html: renderBrandedEmail({ preheader: intro, title, bodyHtml }),
  }
}

/**
 * @param {{ at?: string }} [opts]
 */
export function buildTestEmail(opts = {}) {
  const at = opts.at || new Date().toISOString()
  const bodyHtml = `
    <p style="margin:0 0 14px;font-size:14px;line-height:1.65;color:${BRAND.soft};">
      זוהי הודעת בדיקה ממערכת <strong style="color:${BRAND.deep};">שיבוצון</strong>.
      אם קיבלתם את המייל — הגדרות ה־SMTP תקינות.
    </p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.surface};border:1px solid ${BRAND.line};border-radius:12px;">
      <tr>
        <td style="padding:14px 16px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${BRAND.soft};direction:ltr;text-align:left;">
          ${escapeHtml(at)}
        </td>
      </tr>
    </table>
  `
  return {
    subject: `${appDisplayName()} — בדיקת שליחת מייל`,
    text: `בדיקת SMTP הצליחה.\nזמן: ${at}\nכניסה: ${appPublicUrl()}\n`,
    html: renderBrandedEmail({
      preheader: 'בדיקת שליחת מייל משיבוצון',
      title: 'בדיקת שליחת מייל',
      bodyHtml,
    }),
  }
}
