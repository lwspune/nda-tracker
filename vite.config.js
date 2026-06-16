import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { spawn } from 'child_process'

// ── Read key=value pairs from .env.local ──────────────────────────────────
function readEnvLocal() {
  try {
    return Object.fromEntries(
      readFileSync('.env.local', 'utf-8')
        .split('\n')
        .map(l => l.match(/^([A-Z_]+)=(.*)$/))
        .filter(Boolean)
        .map(m => [m[1], m[2].trim()])
    )
  } catch { return {} }
}

// ── Dev-only plugin: persists faculty data and students DB to disk ─────────
//
// /api/data          GET  → data/faculty-data.json  (or null)
//                    POST → writes data/faculty-data.json
//
// /api/students-db   GET  → students_db.json  (or null)
//                    POST → writes students_db.json
//                           body must be the full students_db.json object
//
// Both bypass the 5MB localStorage limit and survive browser cache clears.
function localDataPlugin() {
  const dataFile       = resolve('./data/faculty-data.json')
  const studentsDbFile = resolve('./students_db.json')

  function makeHandler(filePath) {
    return (req, res) => {
      if (req.method === 'GET') {
        res.setHeader('Content-Type', 'application/json')
        res.end(existsSync(filePath) ? readFileSync(filePath, 'utf-8') : 'null')

      } else if (req.method === 'POST') {
        let body = ''
        req.on('data', chunk => { body += chunk })
        req.on('end', () => {
          try {
            const dir = dirname(filePath)
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
            writeFileSync(filePath, body, 'utf-8')
            res.statusCode = 200
            res.end('ok')
          } catch (e) {
            res.statusCode = 500
            res.end(e.message)
          }
        })

      } else {
        res.statusCode = 405
        res.end('Method Not Allowed')
      }
    }
  }

  return {
    name: 'local-data',
    configureServer(server) {
      server.middlewares.use('/api/data',        makeHandler(dataFile))
      server.middlewares.use('/api/students-db', makeHandler(studentsDbFile))

      // POST /api/send-schedule  { mode: 'weekly'|'daily'|'exam-reminder', teacherId?: string, daysAhead?: 1|2 }
      // Spawns send_schedule.py and returns { ok, sent, skipped, lines[] }
      server.middlewares.use('/api/send-schedule', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('Method Not Allowed'); return }

        let body = ''
        req.on('data', chunk => { body += chunk })
        req.on('end', () => {
          try {
            const { mode, teacherId, daysAhead } = JSON.parse(body || '{}')
            const sender = readEnvLocal().GMAIL_SENDER || process.env.GMAIL_SENDER

            if (!sender) {
              res.statusCode = 400
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: 'GMAIL_SENDER not set. Add GMAIL_SENDER=you@gmail.com to .env.local' }))
              return
            }

            if (mode !== 'weekly' && mode !== 'daily' && mode !== 'exam-reminder') {
              res.statusCode = 400
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: 'mode must be "weekly", "daily", or "exam-reminder"' }))
              return
            }

            let args
            if (mode === 'exam-reminder') {
              const n = Number(daysAhead)
              if (n !== 1 && n !== 2) {
                res.statusCode = 400
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify({ error: 'daysAhead must be 1 or 2 for exam-reminder mode' }))
                return
              }
              args = ['-X', 'utf8', 'send_schedule.py', '--exam-reminder', String(n)]
              if (teacherId) args.push('--teacher-id', teacherId)
            } else {
              args = ['-X', 'utf8', 'send_schedule.py', `--${mode}`]
              if (teacherId) args.push('--teacher-id', teacherId)
            }

            const child = spawn('python', args, {
              env: { ...process.env, GMAIL_SENDER: sender },
            })

            const lines = []
            child.stdout.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => lines.push(l)))
            child.stderr.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => lines.push('ERR: ' + l)))

            child.on('close', code => {
              let sent = 0, skipped = 0
              const summary = lines.find(l => l.startsWith('Done.'))
              if (summary) {
                const sm = summary.match(/Sent:\s*(\d+)/);    if (sm) sent    = +sm[1]
                const sk = summary.match(/Skipped:\s*(\d+)/); if (sk) skipped = +sk[1]
              }
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ ok: code === 0, sent, skipped, lines }))
            })
          } catch (e) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: e.message }))
          }
        })
      })

      // POST /api/send-late-notifications  /  /api/send-lecture-absences
      // In dev we re-use the same Vercel JS handlers, with a tiny shim that
      // parses the JSON body and adapts res to the Vercel res shape.
      function makeApiShim(handlerPath) {
        return (req, res) => {
          if (req.method !== 'POST') { res.statusCode = 405; res.end('Method Not Allowed'); return }
          let body = ''
          req.on('data', c => { body += c })
          req.on('end', async () => {
            try {
              req.body = JSON.parse(body || '{}')
              res.status = (c) => { res.statusCode = c; return res }
              res.json   = (data) => {
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify(data))
              }
              const { default: handler } = await import(handlerPath)
              await handler(req, res)
            } catch (e) {
              res.statusCode = 500
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ ok: false, error: e.message }))
            }
          })
        }
      }
      server.middlewares.use('/api/send-late-notifications', makeApiShim('./api/send-late-notifications.js'))
      server.middlewares.use('/api/send-lecture-absences',   makeApiShim('./api/send-lecture-absences.js'))
      server.middlewares.use('/api/send-exam-absence',       makeApiShim('./api/send-exam-absence.js'))
      server.middlewares.use('/api/send-homework-pending',   makeApiShim('./api/send-homework-pending.js'))
      server.middlewares.use('/api/teacher-account',         makeApiShim('./api/teacher-account.js'))
      server.middlewares.use('/api/sync-calendar',           makeApiShim('./api/sync-calendar.js'))

      // POST /api/send-whatsapp  { examName? }
      // Spawns send_results_whatsapp.py and returns { ok, sent, skipped, lines[] }
      server.middlewares.use('/api/send-whatsapp', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end('Method Not Allowed'); return }

        let body = ''
        req.on('data', chunk => { body += chunk })
        req.on('end', () => {
          try {
            const { examName, redirectTo, students, monitorMobiles } = JSON.parse(body || '{}')

            const args = ['-X', 'utf8', 'send_results_whatsapp.py']
            if (examName)  args.push('--exam', examName)
            if (redirectTo) args.push('--redirect-to', redirectTo)
            if (students?.length) args.push('--students', students.join(','))
            if (monitorMobiles?.length) args.push('--monitor', monitorMobiles.join(','))

            const child = spawn('python', args)

            const lines = []
            child.stdout.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => lines.push(l)))
            child.stderr.on('data', d => d.toString().split('\n').filter(Boolean).forEach(l => lines.push('ERR: ' + l)))

            child.on('close', code => {
              let sent = 0, skipped = 0
              const summary = lines.find(l => l.startsWith('Done.'))
              if (summary) {
                const sm = summary.match(/Sent:\s*(\d+)/);    if (sm) sent    = +sm[1]
                const sk = summary.match(/Skipped:\s*(\d+)/); if (sk) skipped = +sk[1]
              }
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ ok: code === 0, sent, skipped, lines }))
            })
          } catch (e) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: e.message }))
          }
        })
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), localDataPlugin()],
  resolve: {
    alias: {
      // xlsx probes `require('stream')` at module init to enable optional
      // streaming. Vite 8 externalises `stream` for the browser and the stub
      // throws on property access (`.Readable`), crashing the bundle at startup.
      // Alias to an empty module so the optional check short-circuits.
      stream: resolve('./src/stubs/empty.js'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.js'],
  },
})
