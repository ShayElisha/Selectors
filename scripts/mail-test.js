#!/usr/bin/env node
/**
 * Server-side mail smoke test.
 * Usage: npm run mail:test
 */
import 'dotenv/config'
import { sendTestEmail } from '../server/mail.js'

async function main() {
  const to = process.argv[2] || process.env.SMTP_USER
  console.log('[mail:test] שולח מייל בדיקה אל', to || '(לא הוגדר)')
  try {
    const result = await sendTestEmail({ to })
    if (result.devLogged) {
      console.log(
        '[mail:test] SMTP לא מוגדר במלואו — המייל לא נשלח. מלאו SMTP_HOST / SMTP_USER / SMTP_PASS ב-.env',
      )
      process.exitCode = 1
      return
    }
    console.log('[mail:test] נשלח בהצלחה')
  } catch (err) {
    console.error(
      '[mail:test] נכשל:',
      err instanceof Error ? err.message : err,
    )
    process.exitCode = 1
  }
}

main()
