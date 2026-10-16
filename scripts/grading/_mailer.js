// Send one email through scripts/grading/send_report.py (Gmail, the app
// password in gmail_app_password.txt — the login the teacher schedule emails
// use). Node has no SMTP client and we add no package for one.
import { spawn } from 'node:child_process'
import { join } from 'node:path'

const SCRIPT = join('scripts', 'grading', 'send_report.py')

export function gmailMailer({ sender }) {
  if (!sender) throw new Error('GMAIL_SENDER is not set. Add GMAIL_SENDER=you@gmail.com to .env.local')
  return ({ to, subject, text, html, filename, pdf }) => new Promise((resolve, reject) => {
    const child = spawn('python', ['-X', 'utf8', '-E', SCRIPT])
    let err = ''
    child.stderr.on('data', d => { err += d.toString() })
    child.on('error', e => reject(new Error(`Could not start Python: ${e.message}`)))
    child.on('close', code => (code === 0 ? resolve() : reject(new Error(err.trim() || `send_report.py exited ${code}`))))
    child.stdin.end(JSON.stringify({ sender, to, subject, text, html, filename, pdfBase64: pdf.toString('base64') }))
  })
}
