# NDA Tracker

An internal tool used by LWS Pune teaching staff for tracking NDA (National Defence Academy entrance exam) coaching performance. Admins upload OMR-scanned exam results, tag questions with chapter and subtopic metadata, and analyse student performance across exams, chapters, and time. Teachers and students access read-only views of the same data through dedicated portals.

Production: `nda-tracker.vercel.app`.

---

## Documentation

| File | Purpose |
|---|---|
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | Narrative onboarding for new contributors. Read first. |
| [`DATABASE_SCHEMA.md`](./DATABASE_SCHEMA.md) | Column-level Supabase schema reference. |
| [`OPERATIONS.md`](./OPERATIONS.md) | Triage runbook for known production failure modes. |
| [`SECURITY.md`](./SECURITY.md) | Auth model, RLS policies, PII handling, secret management. |
| [`CLAUDE.md`](./CLAUDE.md) | Operational reference: commands, conventions, decisions log, "what not to change". |

---

## Quick start

```bash
npm install
npm run dev          # Vite dev server on localhost:5173 (admin mode, writes to data/faculty-data.json)
npm run test         # Vitest single pass
npm run test:watch
npm run lint
```

The dev server is admin mode by default. Mock data lives in `data/faculty-data.json` (gitignored — keeps its historical name even though the role is now "admin"). To work against production Supabase, set the env vars listed below and visit the deployed URL.

---

## Tech stack

- React 19 + Vite 8 (single-page app, no SSR)
- Tailwind CSS 3
- Zustand 5 (state — sliced under `src/store/slices/`)
- Supabase (Postgres + Auth, 10 tables — see `DATABASE_SCHEMA.md`)
- Vitest 4 + React Testing Library 16 (601 tests)
- Vercel serverless functions for student login + WhatsApp send + dev data file proxy
- Python for OMR-result delivery scripts (`send_results_whatsapp.py`, `send_schedule.py`)

---

## Environment

The app runs without Supabase env vars (returns a null client; dev mode uses the local JSON file). For production behaviour:

| Variable | Where it lives | Used by |
|---|---|---|
| `VITE_SUPABASE_URL` | Vercel dashboard | Browser client |
| `VITE_SUPABASE_ANON_KEY` | Vercel dashboard | Browser client |
| `SUPABASE_SERVICE_ROLE_KEY` | Local shell (one-off scripts only) | `migrate_*.js`, `sync_*.js`, `create_teacher_account.js` |
| `WABRIDGE_*` | `.env.local` / Vercel | `api/send-whatsapp.js`, `send_results_whatsapp.py` |
| Gmail SMTP creds | `.env.local` | `send_schedule.py` |

Never commit secrets. See `SECURITY.md` for the full secret-management policy.

---

## Running tests

```bash
npm run test                              # all tests
npx vitest run src/lib/analytics          # one directory
npx vitest run --reporter=verbose         # detailed output
```

Python tests:

```bash
pip install pytest tzdata
pytest tests/
```

---

## Deployment

- **Production:** every push to `main` triggers a Vercel deploy. No staging environment.
- **GitHub Pages (legacy):** `npm run deploy` builds with `--base=/nda-tracker/` and pushes to `gh-pages`. The static site loads but student/teacher login does not work without serverless functions. Direct users to the Vercel URL.

See `OPERATIONS.md` for triage steps when a deploy breaks.

---

## License

Private / internal. No external license granted.
