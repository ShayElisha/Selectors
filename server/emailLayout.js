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
  return process.env.APP_NAME || 'שיבוצון · GATE OUT'
}

export function appPublicUrl() {
  const raw =
    process.env.APP_URL ||
    process.env.PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')
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
      <img src="${escapeHtml(hosted)}" width="56" height="56" alt="GATE OUT"
        style="display:block;width:56px;height:56px;border:0;border-radius:12px;" />
    `
  }
  try {
    if (existsSync(LOGO_PATH)) {
      return `
      <img src="cid:${LOGO_CID}" width="56" height="56" alt="GATE OUT"
        style="display:block;width:56px;height:56px;border:0;border-radius:12px;" />
    `
    }
  } catch {
    /* ignore */
  }
  // Fallback mark (matches site favicon) when PNG is missing
  return `
    <div style="width:56px;height:56px;border-radius:12px;background:${BRAND.brand};text-align:center;line-height:56px;color:#fff;font-family:Arial,sans-serif;font-weight:700;font-size:11px;letter-spacing:0.08em;">
      GO
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
  eyebrow = 'GATE OUT',
  greeting = '',
  bodyHtml,
  footerNote = 'מייל זה נשלח אוטומטית ממערכת שיבוצון · לשימוש פנימי בלבד',
}) {
  const appName = escapeHtml(appDisplayName())
  const loginUrl = appPublicUrl()
  const cta = loginUrl
    ? `
      <tr>
        <td align="center" style="padding:8px 0 4px;">
          <a href="${escapeHtml(loginUrl)}"
            style="display:inline-block;background:${BRAND.accent};color:#ffffff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;padding:12px 22px;border-radius:12px;">
            כניסה לשיבוצון
          </a>
        </td>
      </tr>
      <tr>
        <td align="center" style="padding:6px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:${BRAND.soft};">
          או העתיקו: ${escapeHtml(loginUrl)}
        </td>
      </tr>
    `
    : ''

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
                      ניהול ושיבוץ עמדות שער יציאה
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

          ${cta ? `<tr><td style="padding:8px 24px 20px;">${cta}</td></tr>` : '<tr><td style="height:12px;"></td></tr>'}

          <!-- Footer -->
          <tr>
            <td style="border-top:1px solid ${BRAND.line};background:${BRAND.surface};padding:16px 24px;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.55;color:${BRAND.soft};text-align:center;direction:rtl;">
              <div style="font-weight:700;color:${BRAND.brand};letter-spacing:0.12em;font-size:10px;text-transform:uppercase;margin-bottom:4px;">GATE OUT</div>
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
            סיסמה זמנית
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
          1. היכנסו למערכת עם מספר הטלפון והסיסמה הזמנית<br/>
          2. הגדירו סיסמה קבועה (אות גדולה, ספרה וסימן מיוחד)<br/>
          3. המשיכו לשיבוץ המשמרת כרגיל
        </td>
      </tr>
    </table>

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
    '',
    'מה הלאה?',
    '1. היכנסו עם הטלפון והסיסמה הזמנית',
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
    text: `בדיקת SMTP הצליחה.\nזמן: ${at}\n`,
    html: renderBrandedEmail({
      preheader: 'בדיקת שליחת מייל משיבוצון',
      title: 'בדיקת שליחת מייל',
      bodyHtml,
    }),
  }
}
